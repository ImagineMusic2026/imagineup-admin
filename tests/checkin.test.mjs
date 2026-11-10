import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// O check-in diário no painel, com o dublê no lugar do Firebase: o pedido do
// "Salvar check-in" ao `updatePointsConfig`, o que o servidor de antes
// responde (a chave `checkin` e a regra de sequência recusadas, sem gravar) e
// o que o servidor novo responde, e a conquista de sequência nos pedidos das
// conquistas, e as duas decisões do bloco: se o salvar passa pela confirmação
// (e com que versão o pedido sai) e a triagem da falha. O modelo do bloco e os
// textos estão em points-config.test.mjs e em achievements.test.mjs.

const calls = [];
let answer = null;
mock.module("@/lib/callable", {
  namedExports: {
    LONG_CALL_TIMEOUT_MS: 130_000,
    call: async (name, data) => {
      calls.push([name, data]);
      if (answer?.failure) throw answer.failure;
      return answer ?? { ok: true, version: data.expectedVersion + 1 };
    },
  },
});

const points = await import("@/lib/points-config");
const achievements = await import("@/lib/achievements");
const api = await import("@/lib/game-api");
const errors = await import("@/lib/errors");

// Um `config/points` como o de produção antes do servidor novo gravar a régua: sem o bloco do check-in.
const DOC = {
  version: 4,
  values: { like: 0, comment: 2, rsvp: 0, central_join: 10, invite_visit: 2, invite_signup: 10 },
  dailyLimits: { like: 50, comment: 20, rsvp: 10, central_join: 10, mission: null, invite_visit: null, invite_signup: 20 },
  actionCaps: {},
  levels: [
    { number: 1, name: "Primeiro passo", minXp: 0 },
    { number: 2, name: "Na roda", minXp: 600 },
  ],
};
const CONFIG = points.parsePointsConfig(DOC);

/** A recusa como o SDK entrega: o `invalid-request` do servidor com o campo em `details.field`. */
const refusal = (field) => ({ code: "functions/invalid-argument", message: "Pedido inválido.", details: { reason: "invalid-request", field } });
/** Outro bloco da régua, ou outra pessoa, salvou antes: a versão lida não vale mais. */
const CHANGED = { code: "functions/failed-precondition", message: "A configuração mudou enquanto você editava. Abra de novo e repita a mudança.", details: { reason: "config-changed", version: 5 } };
/** A resposta que se perdeu: sem motivo do servidor, o pedido pode ter gravado. */
const LOST = { code: "functions/deadline-exceeded", message: "deadline-exceeded" };

test("o Salvar check-in manda a versão lida e o bloco inteiro, e nada dos outros blocos", async () => {
  calls.length = 0;
  answer = null;
  // Sem mudança, não há pedido para mandar.
  assert.deepEqual(points.validateCheckin(points.checkinFormOf(CONFIG), CONFIG).changes, {});

  const ligar = points.validateCheckin({ ...points.checkinFormOf(CONFIG), enabled: true }, CONFIG).changes;
  const saved = await api.updatePointsConfig({ expectedVersion: CONFIG.version, ...ligar });
  assert.deepEqual(saved, { ok: true, version: 5 });
  assert.equal(points.checkinSaved(saved, CONFIG.version), true);

  const days = ["5", "5", "5", "5", "5", "5", "20"];
  const pontos = points.validateCheckin({ enabled: false, days }, CONFIG).changes;
  await api.updatePointsConfig({ expectedVersion: CONFIG.version, ...pontos });

  assert.deepEqual(calls, [
    ["updatePointsConfig", { expectedVersion: 4, checkin: { enabled: true, cycle: [3, 3, 4, 4, 5, 6, 15] } }],
    ["updatePointsConfig", { expectedVersion: 4, checkin: { enabled: false, cycle: [5, 5, 5, 5, 5, 5, 20] } }],
  ]);
  // A chave e o ciclo vão sempre juntos, e nada de `values` nem de `dailyLimits` vai com eles.
  for (const [, body] of calls) {
    assert.deepEqual(Object.keys(body), ["expectedVersion", "checkin"]);
    assert.deepEqual(Object.keys(body.checkin), ["enabled", "cycle"]);
    assert.equal(body.checkin.cycle.length, 7);
  }
});

test("a resposta sem a versão andar não vale como salvo", async () => {
  calls.length = 0;
  const ligar = points.validateCheckin({ ...points.checkinFormOf(CONFIG), enabled: true }, CONFIG).changes;
  // O servidor responde ok com a versão mandada quando o bloco gravado já é igual ao mandado: nada foi gravado agora.
  answer = { ok: true, version: 4 };
  assert.equal(points.checkinSaved(await api.updatePointsConfig({ expectedVersion: 4, ...ligar }), 4), false);
  assert.equal(points.checkinSaved({ ok: true, version: 3 }, 4), false);
  assert.equal(points.checkinSaved({ ok: true, version: 5 }, 4), true);
  // Sem a versão na resposta não dá para saber: vale como nos outros blocos, que não olham a versão.
  assert.equal(points.checkinSaved({ ok: true }, 4), true);
  assert.equal(points.checkinSaved({ ok: true, version: "5" }, 4), true);
  // O bloco assume o que mandou, na mesma versão: o formulário dele fica sem mudança, e salvar de novo não manda nada.
  const assumido = { ...CONFIG, checkin: ligar.checkin };
  assert.equal(assumido.version, 4);
  assert.deepEqual(points.checkinFormOf(assumido), { enabled: true, days: ["3", "3", "4", "4", "5", "6", "15"] });
  assert.deepEqual(points.validateCheckin(points.checkinFormOf(assumido), assumido), { errors: {}, changes: {} });
});

test("a chave que muda passa pela confirmação antes, e o pedido sai com a versão da régua de que o bloco saiu", async () => {
  calls.length = 0;
  answer = null;
  const form = points.checkinFormOf(CONFIG);
  const ligado = points.parsePointsConfig({ ...DOC, checkin: { enabled: true, cycle: [3, 3, 4, 4, 5, 6, 15] } });
  const blockOf = (changed, config) => points.validateCheckin(changed, config).changes.checkin;

  // De desligada para ligada: a confirmação de ligar, com o bloco e a versão lida.
  const ligar = points.checkinSaveStep(blockOf({ ...form, enabled: true }, CONFIG), CONFIG);
  assert.deepEqual(ligar, { confirm: "on", pending: { checkin: { enabled: true, cycle: [3, 3, 4, 4, 5, 6, 15] }, version: 4 } });
  // De ligada para desligada: a de desligar, também com os pontos mexidos junto.
  const desligar = points.checkinSaveStep(blockOf({ enabled: false, days: ["3", "3", "4", "4", "5", "6", "20"] }, ligado), ligado);
  assert.deepEqual(desligar, { confirm: "off", pending: { checkin: { enabled: false, cycle: [3, 3, 4, 4, 5, 6, 20] }, version: 4 } });
  // A mesma chave com outros pontos salva direto, com a chave desligada ou ligada.
  const pontos = points.checkinSaveStep(blockOf({ enabled: false, days: ["5", "5", "5", "5", "5", "5", "20"] }, CONFIG), CONFIG);
  assert.deepEqual(pontos, { confirm: null, pending: { checkin: { enabled: false, cycle: [5, 5, 5, 5, 5, 5, 20] }, version: 4 } });
  assert.equal(points.checkinSaveStep(blockOf({ enabled: true, days: ["5", "5", "5", "5", "5", "5", "20"] }, ligado), ligado).confirm, null);
  // Toda mudança da chave pede a confirmação, com qualquer ciclo: nunca vai direto ao servidor.
  for (const base of [CONFIG, ligado]) {
    for (const cycle of [base.checkin.cycle, [1, 1, 1, 1, 1, 1, 1], [999, 999, 999, 999, 999, 999, 999]]) {
      const step = points.checkinSaveStep({ enabled: !base.checkin.enabled, cycle }, base);
      assert.equal(step.confirm, base.checkin.enabled ? "off" : "on", JSON.stringify(cycle));
      assert.equal(step.pending.version, base.version);
    }
  }

  // Com a confirmação aberta, a página lê uma régua mais nova (outra pessoa salvou o bloco, na versão 5). O
  // pedido que sai da confirmação continua com a versão 4, a do bloco que ela mostra: o servidor responde
  // `config-changed`, em vez de gravar o bloco de antes por cima do da outra pessoa.
  const nova = points.parsePointsConfig({ ...DOC, version: 5, checkin: { enabled: true, cycle: [1, 1, 1, 1, 1, 1, 1] } });
  assert.equal(nova.version, 5);
  assert.deepEqual(points.checkinRequestOf(ligar.pending), { expectedVersion: 4, checkin: { enabled: true, cycle: [3, 3, 4, 4, 5, 6, 15] } });
  await api.updatePointsConfig(points.checkinRequestOf(ligar.pending));
  // O salvar direto leva a versão do bloco do mesmo jeito, e o passo montado da régua nova, a versão nova.
  await api.updatePointsConfig(points.checkinRequestOf(pontos.pending));
  await api.updatePointsConfig(points.checkinRequestOf(points.checkinSaveStep({ enabled: false, cycle: nova.checkin.cycle }, nova).pending));
  assert.deepEqual(calls, [
    ["updatePointsConfig", { expectedVersion: 4, checkin: { enabled: true, cycle: [3, 3, 4, 4, 5, 6, 15] } }],
    ["updatePointsConfig", { expectedVersion: 4, checkin: { enabled: false, cycle: [5, 5, 5, 5, 5, 5, 20] } }],
    ["updatePointsConfig", { expectedVersion: 5, checkin: { enabled: false, cycle: [1, 1, 1, 1, 1, 1, 1] } }],
  ]);
  for (const [, body] of calls) assert.deepEqual(Object.keys(body), ["expectedVersion", "checkin"]);
});

test("o servidor de antes recusa a chave checkin sem gravar; o novo aponta o dia; e a versão mudada pede a releitura", async () => {
  calls.length = 0;
  const ligar = points.validateCheckin({ ...points.checkinFormOf(CONFIG), enabled: true }, CONFIG).changes;
  const fieldOf = (failure) => (errors.reasonOf(failure) === "invalid-request" ? errors.errorDetails(failure).field : null);

  // O servidor de antes (o de produção até as funções do check-in saírem): a chave desconhecida volta como `invalid-request`, com o campo `checkin` sozinho.
  answer = { failure: refusal("checkin") };
  await assert.rejects(api.updatePointsConfig({ expectedVersion: 4, ...ligar }), (failure) => {
    assert.equal(points.isCheckinUnknown(fieldOf(failure)), true);
    assert.equal(points.checkinFieldOf(fieldOf(failure)), null);
    // Recusa de propósito: nada foi gravado, e a frase crua do servidor não diz o que fazer.
    assert.equal(errors.mayHaveRunOnServer(failure), false);
    assert.equal(errors.isConfigChanged(failure), false);
    assert.equal(errors.actionErrorMessage(failure), "Pedido inválido.");
    return true;
  });

  // O servidor novo recusando um valor: o campo de dentro, que vira o dia do ciclo.
  answer = { failure: refusal("checkin.cycle.6") };
  await assert.rejects(api.updatePointsConfig({ expectedVersion: 4, ...ligar }), (failure) => {
    assert.equal(points.isCheckinUnknown(fieldOf(failure)), false);
    assert.equal(points.checkinFieldOf(fieldOf(failure)), 7);
    return true;
  });
  for (const field of ["checkin.enabled", "checkin.cycle"]) {
    assert.equal(points.isCheckinUnknown(fieldOf(refusal(field))), false, field);
    assert.equal(points.checkinFieldOf(fieldOf(refusal(field))), null, field);
  }

  // Outro bloco da régua foi salvo antes: a versão lida não vale mais, e o campo nem é olhado.
  assert.equal(errors.isConfigChanged(CHANGED), true);
  assert.equal(fieldOf(CHANGED), null);
  assert.equal(points.isCheckinUnknown(fieldOf(CHANGED)), false);
  // A falha sem motivo pode ter gravado: a tela diz isso e lê de novo.
  assert.equal(errors.mayHaveRunOnServer(LOST), true);
  assert.equal(errors.actionErrorMessage(LOST), errors.UNCERTAIN_CHANGE_TEXT);
  assert.equal(points.isCheckinUnknown(fieldOf(LOST)), false);
});

test("a triagem da falha do Salvar check-in, na ordem do bloco: a versão mudada, o servidor de antes, o dia e o resto", () => {
  // A versão mudada ganha de tudo, mesmo que a recusa viesse com um campo junto.
  assert.deepEqual(points.checkinFailureOf(CHANGED), { kind: "changed" });
  assert.deepEqual(points.checkinFailureOf({ ...CHANGED, details: { ...CHANGED.details, field: "checkin" } }), { kind: "changed" });
  assert.deepEqual(points.checkinFailureOf({ ...CHANGED, details: { ...CHANGED.details, field: "checkin.cycle.6" } }), { kind: "changed" });
  // O `checkin` sozinho é o servidor de antes, que não conhece a chave.
  assert.deepEqual(points.checkinFailureOf(refusal("checkin")), { kind: "unknown" });
  // O `checkin.cycle.<i>` é o dia i + 1.
  assert.deepEqual(points.checkinFailureOf(refusal("checkin.cycle.6")), { kind: "day", day: 7 });
  assert.deepEqual(points.checkinFailureOf(refusal("checkin.cycle.0")), { kind: "day", day: 1 });
  // O resto fica com a frase do servidor. A recusa de propósito não gravou nada.
  for (const field of ["checkin.enabled", "checkin.cycle", "checkin.cycle.7", "values.like", "", undefined]) {
    assert.deepEqual(points.checkinFailureOf(refusal(field)), { kind: "other", uncertain: false }, String(field));
  }
  // O campo só conta no `invalid-request`: outra recusa com o mesmo campo não é o servidor de antes nem um dia.
  for (const field of ["checkin", "checkin.cycle.6"]) {
    const outra = { code: "functions/permission-denied", message: "Seu acesso ao painel não permite fazer isso nesta seção.", details: { reason: "no-section", field } };
    assert.deepEqual(points.checkinFailureOf(outra), { kind: "other", uncertain: false }, field);
  }
  // A resposta que se perdeu pode ter gravado: a tela lê de novo.
  assert.deepEqual(points.checkinFailureOf(LOST), { kind: "other", uncertain: true });
  for (const failure of [{ code: "functions/internal", message: "internal" }, { code: "functions/unavailable", message: "unavailable" }, new Error("a rede caiu"), null]) {
    assert.deepEqual(points.checkinFailureOf(failure), { kind: "other", uncertain: true }, String(failure?.code ?? failure));
  }
  // Dentro da confirmação, a falha incerta tem a frase do bloco, e não a das listas, que continua como era.
  assert.equal(errors.actionErrorMessage(LOST), errors.UNCERTAIN_CHANGE_TEXT);
  assert.equal(errors.UNCERTAIN_CHANGE_TEXT, "Não deu para confirmar se a mudança foi gravada. Confira a lista antes de repetir.");
  assert.notEqual(points.CHECKIN_UNCERTAIN_TEXT, errors.UNCERTAIN_CHANGE_TEXT);
});

test("a conquista de sequência nos pedidos: a regra com as duas chaves, e as recusas do servidor de antes e do novo", async () => {
  calls.length = 0;
  const form = { ...achievements.EMPTY_ACHIEVEMENT_FORM, title: "7 dias seguidos", icon: "flame", tone: "action", ruleType: "streak", days: "7" };
  const { input } = achievements.validateAchievement(form, CONFIG.levels.length);

  answer = { ok: true, version: 3, achievementId: "7-dias-seguidos-a1b2" };
  await api.createAchievement({ expectedVersion: 2, achievement: input });
  // O rascunho gravado, com outro número de dias no formulário: só a regra muda.
  const draft = achievements.parseAchievement({ id: "7-dias-seguidos-a1b2", ...input });
  const changes = achievements.achievementChanges(draft, { ...input, rule: { type: "streak", days: 10 } });
  answer = { ok: true, version: 4 };
  await api.updateAchievement({ expectedVersion: 3, achievementId: draft.id, changes });

  assert.deepEqual(calls, [
    ["createAchievement", { expectedVersion: 2, achievement: { title: "7 dias seguidos", icon: "flame", tone: "action", rule: { type: "streak", days: 7 } } }],
    ["updateAchievement", { expectedVersion: 3, achievementId: "7-dias-seguidos-a1b2", changes: { rule: { type: "streak", days: 10 } } }],
  ]);
  // O servidor confere a regra com exatamente as chaves `type` e `days`.
  assert.deepEqual(Object.keys(calls[0][1].achievement.rule), ["type", "days"]);

  // O servidor de antes não conhece o tipo: recusa a regra inteira, e o campo "Regra" ganha a frase própria.
  answer = { failure: refusal("achievement.rule") };
  await assert.rejects(api.createAchievement({ expectedVersion: 2, achievement: input }), (failure) => {
    const field = errors.errorDetails(failure).field;
    assert.equal(achievements.achievementFieldOf(field), "ruleType");
    assert.equal(achievements.isStreakRuleUnknown(field, input.rule), true);
    assert.equal(errors.mayHaveRunOnServer(failure), false);
    return true;
  });
  // O servidor novo, com os dias fora da faixa dele: o erro vai para o campo "Dias seguidos", com a frase do servidor.
  const days = refusal("achievement.rule.days");
  assert.equal(achievements.achievementFieldOf(errors.errorDetails(days).field), "days");
  assert.equal(achievements.isStreakRuleUnknown(errors.errorDetails(days).field, input.rule), false);
  assert.equal(errors.actionErrorMessage(days), "Pedido inválido.");
});
