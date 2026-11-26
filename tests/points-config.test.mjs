import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const points = await import("@/lib/points-config");

const DASHES = /[\u2013\u2014]/;
const sp = (local) => Date.parse(`${local}-03:00`);

const DOC = {
  version: 4,
  values: { like: 0, comment: 2, rsvp: 0, central_join: 10, invite_visit: 2, invite_signup: 10 },
  dailyLimits: { like: 50, comment: 20, rsvp: 10, central_join: 10, mission: null, invite_visit: null, invite_signup: 20 },
  actionCaps: { central_entry: 30, invite_visit_sent: 20, invite_link: 30, like_set: 300, comment_sent: 100, rsvp_set: 50, comment_report: 30, fan_block: 30, photo_set: 10, reward_redeem: 10 },
  levels: [
    { number: 1, name: "Primeiro passo", minXp: 0 },
    { number: 2, name: "Na roda", minXp: 600 },
    { number: 3, name: "Pé de serra", minXp: 1500 },
  ],
  updatedAt: Timestamp.fromMillis(sp("2026-10-06T14:30:00")),
  updatedBy: { uid: "u1", name: "Ana" },
};

const CONFIG = points.parsePointsConfig(DOC);

test("o documento gravado; sem documento ou na versão 0, nada", () => {
  assert.equal(CONFIG.version, 4);
  assert.equal(CONFIG.dailyLimits.invite_visit, null);
  assert.equal(CONFIG.actionCaps.like_set, 300);
  assert.equal(CONFIG.levels.length, 3);
  assert.equal(points.parsePointsConfig(undefined), null);
  assert.equal(points.parsePointsConfig({ ...DOC, version: 0 }), null);
  assert.equal(points.versionText(CONFIG), "Versão 4, alterada por Ana em 6 de outubro, 14:30.");
  assert.equal(points.versionText({ ...CONFIG, updatedBy: null }), "Versão 4, gravada em 6 de outubro, 14:30.");
  assert.equal(points.limitText(null), "Sem limite");
  assert.equal(points.limitText(1000), "1.000 por dia");
});

test("valores e limites: só o que mudou, o sem limite como null e os erros por linha", () => {
  const form = points.valuesFormOf(CONFIG);
  assert.deepEqual(form.invite_visit, { points: "2", limited: false, limit: "" });
  assert.deepEqual(points.validateValues(form, CONFIG), { errors: {}, changes: {} });

  const changed = {
    ...form,
    comment: { points: "3", limited: true, limit: "20" },
    like: { points: "0", limited: false, limit: "50" },
    invite_visit: { points: "2", limited: true, limit: "40" },
  };
  assert.deepEqual(points.validateValues(changed, CONFIG).changes, { values: { comment: 3 }, dailyLimits: { like: null, invite_visit: 40 } });

  const wrong = { ...form, comment: { points: "10001", limited: true, limit: "0" } };
  assert.deepEqual(points.validateValues(wrong, CONFIG), {
    errors: { comment: { points: "De 0 a 10.000.", limit: "De 1 a 1.000, ou sem limite." } },
    changes: null,
  });
});

test("tetos do dia de 1 a 10.000", () => {
  const form = points.capsFormOf(CONFIG);
  assert.deepEqual(points.validateCaps({ ...form, photo_set: "12" }, CONFIG).changes, { photo_set: 12 });
  assert.equal(points.validateCaps({ ...form, fan_block: "0" }, CONFIG).errors.fan_block, "De 1 a 10.000.");
});

test("níveis: o primeiro em 0, sempre subindo, nome até 40 e de 2 a 50 degraus", () => {
  const rows = points.levelsFormOf(CONFIG.levels);
  assert.deepEqual(points.validateLevelsForm(rows).levels, CONFIG.levels);
  const bad = rows.map((row, index) => (index === 2 ? { ...row, minXp: "600" } : index === 1 ? { ...row, name: " " } : row));
  const checked = points.validateLevelsForm(bad);
  assert.equal(checked.levels, null);
  assert.equal(checked.errors.n2.name, "Escreva o nome, até 40 caracteres.");
  assert.equal(checked.errors.n3.minXp, "Precisa ser maior que 600, o do nível 2.");
  assert.equal(points.validateLevelsForm([{ ...rows[0], minXp: "5" }, rows[1]]).errors.n1.minXp, "O nível 1 começa em 0 XP.");
  assert.equal(points.validateLevelsForm(rows.slice(0, 1)).message, "A régua tem de 2 a 50 níveis.");

  const added = points.addLevelRow(rows, "novo-1");
  assert.deepEqual(added.at(-1), { key: "novo-1", name: "", minXp: "2500" });
  assert.equal(points.sameLevels(CONFIG.levels, CONFIG.levels.map((level) => ({ ...level }))), true);
  assert.equal(points.levelsChangeXp(CONFIG.levels, CONFIG.levels.map((level) => ({ ...level, name: `${level.name}!` }))), false);
  assert.equal(points.levelsChangeXp(CONFIG.levels, CONFIG.levels.slice(0, 2)), true);
});

test("o level-in-use lista as conquistas que pedem o degrau que sai", () => {
  const catalog = [
    { id: "lenda", title: "Lenda", rule: { type: "level", level: 10 } },
    { id: "backstage", title: "Backstage", rule: { type: "level", level: 8 } },
  ];
  assert.equal(points.levelInUseList(["lenda"], catalog), "Conquista que pede um nível que sai: Lenda (nível 10).");
  assert.equal(
    points.levelInUseList(["backstage", "lenda", "sumiu"], catalog),
    "Conquistas que pedem um nível que sai: Backstage (nível 8), Lenda (nível 10) e sumiu.",
  );
});

test("os tetos novos na ordem do servidor, com o padrão dele na chave ausente ou fora da regra", () => {
  assert.deepEqual(points.ACTION_CAP_KEYS.slice(-10), ["photo_upload", "profile_save", "name_change", "fanclub_apply", "fanclub_post", "fanclub_upload", "fanclub_follow", "fanclub_reaction_set", "fanclub_comment_sent", "support_message"]);
  assert.equal(points.ACTION_CAP_KEYS.length, 20);
  // As candidaturas a fã-clube (seção 34, decisão 11): 3 por dia no servidor.
  assert.equal(points.ACTION_CAP_LABELS.fanclub_apply, "Candidaturas a fã-clube");
  assert.equal(points.DEFAULT_ACTION_CAPS.fanclub_apply, 3);
  assert.equal(CONFIG.actionCaps.fanclub_apply, 3);
  // As publicações, as fotos e os seguimentos de fã-clube (seção 34, decisões 11 e 34): 5, 10 e 30 por dia.
  assert.equal(points.ACTION_CAP_LABELS.fanclub_post, "Publicações de fã-clube");
  assert.equal(points.ACTION_CAP_LABELS.fanclub_upload, "Fotos de fã-clube");
  assert.equal(points.ACTION_CAP_LABELS.fanclub_follow, "Seguir fã-clubes");
  assert.equal(points.DEFAULT_ACTION_CAPS.fanclub_post, 5);
  assert.equal(points.DEFAULT_ACTION_CAPS.fanclub_upload, 10);
  assert.equal(points.DEFAULT_ACTION_CAPS.fanclub_follow, 30);
  assert.equal(points.ACTION_CAP_LABELS.photo_upload, "Envios de foto");
  assert.equal(points.ACTION_CAP_LABELS.profile_save, "Salvamentos do perfil");
  assert.equal(points.ACTION_CAP_LABELS.name_change, "Trocas de nome");

  // O documento gravado em 08/10/2026 não tem as três chaves: valem 20, 20 e 5.
  assert.equal(CONFIG.actionCaps.photo_upload, 20);
  assert.equal(CONFIG.actionCaps.profile_save, 20);
  assert.equal(CONFIG.actionCaps.name_change, 5);
  const torto = points.parsePointsConfig({ ...DOC, actionCaps: { ...DOC.actionCaps, like_set: 0, comment_sent: 20000, fan_block: 2.5, profile_save: 15 } });
  assert.equal(torto.actionCaps.like_set, 300);
  assert.equal(torto.actionCaps.comment_sent, 100);
  assert.equal(torto.actionCaps.fan_block, 30);
  assert.equal(torto.actionCaps.profile_save, 15);

  // Com o padrão no lugar, o bloco inteiro salva, e só o que mudou vai.
  const form = points.capsFormOf(CONFIG);
  assert.equal(form.name_change, "5");
  assert.deepEqual(points.validateCaps({ ...form, like_set: "250" }, CONFIG).changes, { like_set: 250 });
  assert.deepEqual(points.validateCaps({ ...form, name_change: "3" }, CONFIG).changes, { name_change: 3 });
  assert.equal(points.validateCaps({ ...form, profile_save: "0" }, CONFIG).errors.profile_save, "De 1 a 10.000.");
});

test("as origens e os tetos do fã-clube (37.5): o padrão do servidor na chave nunca gravada, e não Sem limite", () => {
  assert.deepEqual(points.VALUE_SOURCES.slice(-2), ["fanclub_like", "fanclub_comment"]);
  assert.equal(points.VALUE_LABELS.fanclub_like, "Reação no fã-clube");
  assert.equal(points.VALUE_LABELS.fanclub_comment, "Comentário no fã-clube");
  assert.match(points.VALUE_HINTS.fanclub_like, /Nasce em 0/);
  assert.match(points.VALUE_HINTS.fanclub_comment, /não conta nas missões/);
  assert.deepEqual(points.DEFAULT_DAILY_LIMITS, { fanclub_like: 50, fanclub_comment: 20 });
  assert.equal(points.ACTION_CAP_LABELS.fanclub_reaction_set, "Reações no fã-clube");
  assert.equal(points.ACTION_CAP_LABELS.fanclub_comment_sent, "Comentários no fã-clube");

  // O `config/points` de produção (o DOC) não tem as chaves novas: 0, 50 e 20, 300 e 100.
  assert.equal(CONFIG.values.fanclub_like, 0);
  assert.equal(CONFIG.values.fanclub_comment, 0);
  assert.equal(CONFIG.dailyLimits.fanclub_like, 50);
  assert.equal(CONFIG.dailyLimits.fanclub_comment, 20);
  assert.equal(CONFIG.actionCaps.fanclub_reaction_set, 300);
  assert.equal(CONFIG.actionCaps.fanclub_comment_sent, 100);
  // As origens de antes continuam: o limite ausente é sem limite.
  assert.equal(CONFIG.dailyLimits.invite_visit, null);

  // O sem limite gravado continua sem limite, e o gravado vale.
  const gravado = points.parsePointsConfig({ ...DOC, values: { ...DOC.values, fanclub_like: 5 }, dailyLimits: { ...DOC.dailyLimits, fanclub_like: null, fanclub_comment: 7 } });
  assert.equal(gravado.values.fanclub_like, 5);
  assert.equal(gravado.dailyLimits.fanclub_like, null);
  assert.equal(gravado.dailyLimits.fanclub_comment, 7);

  // Sem mexer, nada vai; com o valor novo, só ele vai (o servidor mantém o resto).
  const form = points.valuesFormOf(CONFIG);
  assert.deepEqual(form.fanclub_like, { points: "0", limited: true, limit: "50" });
  assert.deepEqual(points.validateValues(form, CONFIG).changes, {});
  assert.deepEqual(points.validateValues({ ...form, fanclub_comment: { points: "2", limited: true, limit: "20" } }, CONFIG).changes, { values: { fanclub_comment: 2 } });
  assert.deepEqual(points.validateCaps({ ...points.capsFormOf(CONFIG), fanclub_comment_sent: "80" }, CONFIG).changes, { fanclub_comment_sent: 80 });
});

test("o teto das mensagens de suporte (seção 38): 5 por dia somando os três tipos, no fim da lista", () => {
  assert.equal(points.ACTION_CAP_KEYS.at(-1), "support_message");
  assert.equal(points.ACTION_CAP_LABELS.support_message, "Mensagens de suporte");
  assert.equal(points.DEFAULT_ACTION_CAPS.support_message, 5);
  // O `config/points` de produção (o DOC) não tem a chave: vale o padrão do servidor.
  assert.equal(CONFIG.actionCaps.support_message, 5);
  const gravado = points.parsePointsConfig({ ...DOC, actionCaps: { ...DOC.actionCaps, support_message: 3 } });
  assert.equal(gravado.actionCaps.support_message, 3);
  // Sem mexer, nada vai; com o teto novo, só ele vai.
  const form = points.capsFormOf(CONFIG);
  assert.equal(form.support_message, "5");
  assert.deepEqual(points.validateCaps(form, CONFIG).changes, {});
  assert.deepEqual(points.validateCaps({ ...form, support_message: "8" }, CONFIG).changes, { support_message: 8 });
});

// O ciclo padrão do check-in, igual ao `DEFAULT_CHECKIN_CONFIG` do servidor.
const CYCLE = [3, 3, 4, 4, 5, 6, 15];

test("o check-in diário sem o bloco gravado: o padrão do servidor, com a chave desligada", () => {
  assert.deepEqual(points.DEFAULT_CHECKIN, { enabled: false, cycle: [3, 3, 4, 4, 5, 6, 15] });
  assert.equal(points.CHECKIN_CYCLE_DAYS, 7);
  assert.equal(points.CHECKIN_VALUE_MIN, 1);
  // O teto é do check-in, mais baixo que o dos valores por ação: quatro dígitos são cortados na trilha do app.
  assert.equal(points.CHECKIN_VALUE_MAX, 999);
  assert.equal(points.VALUE_MAX, 10000);
  // O `config/points` de produção (o DOC) não tem o bloco: a chave desligada e o ciclo padrão.
  assert.deepEqual(CONFIG.checkin, { enabled: false, cycle: CYCLE });
  assert.deepEqual(points.checkinFormOf(CONFIG), { enabled: false, days: ["3", "3", "4", "4", "5", "6", "15"] });

  // Cada leitura recebe uma cópia: mexer nela não muda o padrão nem a leitura seguinte.
  const lido = points.parsePointsConfig(DOC);
  lido.checkin.enabled = true;
  lido.checkin.cycle[6] = 99;
  assert.deepEqual(points.DEFAULT_CHECKIN, { enabled: false, cycle: [3, 3, 4, 4, 5, 6, 15] });
  assert.deepEqual(points.parsePointsConfig(DOC).checkin, { enabled: false, cycle: CYCLE });
  // O ciclo gravado também chega como cópia.
  const gravado = { enabled: true, cycle: [1, 2, 3, 4, 5, 6, 7] };
  const copia = points.parsePointsConfig({ ...DOC, checkin: gravado }).checkin;
  assert.deepEqual(copia, gravado);
  assert.notEqual(copia.cycle, gravado.cycle);
});

test("o check-in diário lido como o servidor lê: a chave só com true e o ciclo só com 7 inteiros de 0 a 999", () => {
  const checkinOf = (checkin) => points.parsePointsConfig({ ...DOC, checkin }).checkin;
  // Só o `true` liga.
  for (const enabled of ["true", 1, "sim", null, undefined, {}]) assert.equal(checkinOf({ enabled, cycle: CYCLE }).enabled, false, String(enabled));
  // Um dos dois sozinho: o outro fica no padrão.
  assert.deepEqual(checkinOf({ enabled: true }), { enabled: true, cycle: CYCLE });
  assert.deepEqual(checkinOf({ cycle: [10, 10, 10, 10, 10, 10, 10] }), { enabled: false, cycle: [10, 10, 10, 10, 10, 10, 10] });
  // O 0 e o 999 são tolerados ao ler.
  assert.deepEqual(checkinOf({ enabled: true, cycle: [0, 0, 0, 0, 0, 0, 999] }), { enabled: true, cycle: [0, 0, 0, 0, 0, 0, 999] });
  // O ciclo fora do formato vira o padrão inteiro, e a chave gravada continua valendo. O teto de ler segue o
  // de salvar: um valor acima de 999 (o 10.000 que já valeu, inclusive) derruba o ciclo todo.
  const tortos = [[3, 3, 4, 4, 5, 6], [3, 3, 4, 4, 5, 6, 15, 20], [3, 3, 4, 4, 5, 6, 1000], [3, 3, 4, 4, 5, 6, 10000], [1000, 3, 4, 4, 5, 6, 15], [3, 3, 4, 4, 5, 6, -1], [3, 3, 4, 4, 5, 6, 1.5], [3, 3, 4, 4, 5, 6, "15"], [3, 3, 4, 4, 5, 6, null], "3,3,4,4,5,6,15", { 0: 3 }, null];
  for (const cycle of tortos) assert.deepEqual(checkinOf({ enabled: true, cycle }), { enabled: true, cycle: CYCLE }, JSON.stringify(cycle));
  // O bloco fora do formato vira o padrão.
  for (const bloco of [null, "ligado", 7, true, [true, CYCLE]]) assert.deepEqual(checkinOf(bloco), points.DEFAULT_CHECKIN, JSON.stringify(bloco));
  // A chave que o painel não conhece dentro do bloco não atrapalha.
  assert.deepEqual(checkinOf({ enabled: true, cycle: CYCLE, lembrete: "20:00" }), { enabled: true, cycle: CYCLE });
});

test("o check-in não entra nos valores por ação: sem linha, sem values.checkin e sem dailyLimits.checkin", () => {
  assert.equal(points.VALUE_SOURCES.includes("checkin"), false);
  assert.equal("checkin" in points.VALUE_LABELS, false);
  assert.equal("checkin" in points.DEFAULT_DAILY_LIMITS, false);
  assert.equal(points.ACTION_CAP_KEYS.includes("checkin"), false);
  // O servidor novo grava `dailyLimits.checkin: null`, como o da missão; o painel não lê nem devolve.
  const gravado = points.parsePointsConfig({ ...DOC, values: { ...DOC.values, checkin: 5 }, dailyLimits: { ...DOC.dailyLimits, checkin: null }, checkin: { enabled: true, cycle: [1, 2, 3, 4, 5, 6, 7] } });
  assert.deepEqual(Object.keys(gravado.values), [...points.VALUE_SOURCES]);
  assert.deepEqual(Object.keys(gravado.dailyLimits), [...points.VALUE_SOURCES]);
  const form = points.valuesFormOf(gravado);
  assert.deepEqual(Object.keys(form), [...points.VALUE_SOURCES]);
  // Cada bloco manda só o dele: os valores sem o check-in, o check-in sem valores nem limites.
  assert.deepEqual(points.validateValues({ ...form, comment: { points: "3", limited: true, limit: "20" } }, gravado).changes, { values: { comment: 3 } });
  const checkin = points.validateCheckin({ ...points.checkinFormOf(gravado), enabled: false }, gravado).changes;
  assert.deepEqual(Object.keys(checkin), ["checkin"]);
  assert.deepEqual(checkin.checkin, { enabled: false, cycle: [1, 2, 3, 4, 5, 6, 7] });
});

test("o formulário do check-in: os sete dias de 1 a 999, e o bloco inteiro só quando algo mudou", () => {
  const form = points.checkinFormOf(CONFIG);
  // O nome de cada campo de dia é único na aba (o id do campo sai dele, como o `NumberCell` monta):
  // os sete diferem entre si, e nenhum outro rótulo da régua fala de check-in.
  const labels = form.days.map((_, index) => points.checkinDayLabel(index + 1));
  assert.equal(labels[0], "Pontos do dia 1 do check-in");
  assert.equal(labels[6], "Pontos do dia 7 do check-in");
  assert.equal(new Set(labels.map((label) => label.replace(/\W+/g, "-").toLowerCase())).size, 7);
  for (const other of [...Object.values(points.VALUE_LABELS), ...Object.values(points.ACTION_CAP_LABELS)]) assert.doesNotMatch(other, /check-in/i, other);

  // Sem mexer, nada vai.
  assert.deepEqual(points.validateCheckin(form, CONFIG), { errors: {}, changes: {} });
  // O mesmo número escrito de outro jeito não é mudança.
  assert.deepEqual(points.validateCheckin({ enabled: false, days: [" 3 ", "03", "4.0", "4", "5", "6", "15"] }, CONFIG), { errors: {}, changes: {} });
  // Ligar a chave manda a chave e o ciclo, como estão na tela.
  assert.deepEqual(points.validateCheckin({ ...form, enabled: true }, CONFIG).changes, { checkin: { enabled: true, cycle: CYCLE } });
  // Mudar um dia também manda os dois.
  const days = form.days.map((text, index) => (index === 6 ? "20" : text));
  assert.deepEqual(points.validateCheckin({ ...form, days }, CONFIG).changes, { checkin: { enabled: false, cycle: [3, 3, 4, 4, 5, 6, 20] } });
  // As pontas da faixa valem.
  assert.deepEqual(points.validateCheckin({ enabled: true, days: ["1", "1", "1", "1", "1", "1", "999"] }, CONFIG).changes, { checkin: { enabled: true, cycle: [1, 1, 1, 1, 1, 1, 999] } });

  // Os erros pelo dia do ciclo (de 1 a 7), com a frase da faixa; com erro, nada vai.
  assert.deepEqual(points.validateCheckin({ enabled: true, days: ["0", "3", "", "4,5", "1000", "6", "1.5"] }, CONFIG), {
    errors: { 1: "De 1 a 999.", 3: "De 1 a 999.", 4: "De 1 a 999.", 5: "De 1 a 999.", 7: "De 1 a 999." },
    changes: null,
  });
  assert.deepEqual(points.validateCheckin({ ...form, days: form.days.map((text, index) => (index === 2 ? "-4" : text)) }, CONFIG).errors, { 3: "De 1 a 999." });
  // O teto de antes, o 10.000 dos valores por ação, não vale mais para um dia do ciclo.
  assert.deepEqual(points.validateCheckin({ ...form, days: form.days.map((text, index) => (index === 6 ? "10000" : text)) }, CONFIG), { errors: { 7: "De 1 a 999." }, changes: null });

  // O 0 gravado é lido, mas não salva, nem para desligar: quem desliga é a chave, com o ciclo certo.
  const zerado = points.parsePointsConfig({ ...DOC, checkin: { enabled: true, cycle: [0, 3, 4, 4, 5, 6, 15] } });
  assert.deepEqual(points.checkinFormOf(zerado), { enabled: true, days: ["0", "3", "4", "4", "5", "6", "15"] });
  assert.deepEqual(points.validateCheckin({ ...points.checkinFormOf(zerado), enabled: false }, zerado), { errors: { 1: "De 1 a 999." }, changes: null });

  // Com a chave ligada no servidor, desligar manda o bloco inteiro também, e salvar igual não manda nada.
  const ligado = points.parsePointsConfig({ ...DOC, checkin: { enabled: true, cycle: [1, 2, 3, 4, 5, 6, 7] } });
  assert.deepEqual(points.validateCheckin(points.checkinFormOf(ligado), ligado).changes, {});
  assert.deepEqual(points.validateCheckin({ ...points.checkinFormOf(ligado), enabled: false }, ligado).changes, { checkin: { enabled: false, cycle: [1, 2, 3, 4, 5, 6, 7] } });
});

test("a recusa do servidor no check-in: o dia apontado, e o servidor de antes, que não conhece o bloco", () => {
  // O `checkin.cycle.<i>` é o dia i + 1.
  assert.equal(points.checkinFieldOf("checkin.cycle.0"), 1);
  assert.equal(points.checkinFieldOf("checkin.cycle.3"), 4);
  assert.equal(points.checkinFieldOf("checkin.cycle.6"), 7);
  for (const field of ["checkin.cycle.7", "checkin.cycle.-1", "checkin.cycle.x", "checkin.cycle.", "checkin.cycle", "checkin.cycle.1.2", "checkin.enabled", "checkin", "values.like", "", null, undefined, 3]) {
    assert.equal(points.checkinFieldOf(field), null, String(field));
  }
  // O `checkin` sozinho é o servidor de antes; um campo de dentro é o servidor novo recusando o valor.
  assert.equal(points.isCheckinUnknown("checkin"), true);
  for (const field of ["checkin.enabled", "checkin.cycle", "checkin.cycle.0", "values", "", null, undefined]) assert.equal(points.isCheckinUnknown(field), false, String(field));
});

test("os textos do check-in diário, como combinados e sem travessão nem meia-risca", () => {
  assert.equal(points.CHECKIN_OFF_TEXT, "Desligado: o app não mostra o check-in e o servidor não paga.");
  assert.equal(points.CHECKIN_ON_TEXT, "Ligado: o app mostra o check-in e o servidor paga os pontos do dia.");
  assert.deepEqual(points.CHECKIN_CONFIRM.on, {
    title: "Ligar o check-in diário?",
    text: "Os fãs passam a ver o check-in no app e a ganhar pontos por ele. A mudança vale em até 1 minuto.",
    action: "Ligar check-in",
  });
  assert.deepEqual(points.CHECKIN_CONFIRM.off, {
    title: "Desligar o check-in diário?",
    text: "O check-in some do app e ninguém pontua por ele. Quem ainda não fez o check-in de hoje perde a sequência se ele não voltar antes da meia-noite (horário de Brasília). Com um dia inteiro desligado, todas as sequências recomeçam do dia 1.",
    action: "Desligar check-in",
  });
  assert.equal(points.CHECKIN_SAVED_TEXT, "Check-in diário salvo.");
  assert.equal(points.CHECKIN_UNKNOWN_TEXT, "O servidor ainda não conhece o check-in diário. Publique as funções antes de salvar.");
  // A resposta com a versão parada: o bloco já estava assim no servidor, e a frase não manda salvar de novo.
  assert.equal(points.CHECKIN_UNCHANGED_TEXT, "O check-in diário já estava assim no servidor. A tela foi atualizada.");
  // A falha incerta na confirmação da chave manda conferir a linha do estado: a régua não tem lista.
  assert.equal(points.CHECKIN_UNCERTAIN_TEXT, "Não deu para confirmar se a mudança foi gravada. Volte e confira a linha do estado do check-in antes de repetir.");
  assert.doesNotMatch(points.CHECKIN_UNCERTAIN_TEXT, /lista/);
  // O ciclo explica a volta ao dia 1, e os marcos são conquistas, sem pontos.
  assert.match(points.CHECKIN_CYCLE_TEXT, /depois do dia 7, o ciclo volta ao dia 1/);
  assert.match(points.CHECKIN_MILESTONES_TEXT, /são conquistas/);
  assert.match(points.CHECKIN_MILESTONES_TEXT, /não dão pontos/);
  // A confirmação de ligar repete os pontos que vão junto.
  assert.equal(points.cycleSummary(CYCLE), "Pontos do dia 1 ao dia 7: 3, 3, 4, 4, 5, 6 e 15.");
  assert.equal(points.cycleSummary([1, 1, 1, 1, 1, 1, 999]), "Pontos do dia 1 ao dia 7: 1, 1, 1, 1, 1, 1 e 999.");

  const texts = [
    points.CHECKIN_OFF_TEXT,
    points.CHECKIN_ON_TEXT,
    points.CHECKIN_CYCLE_TEXT,
    points.CHECKIN_MILESTONES_TEXT,
    ...Object.values(points.CHECKIN_CONFIRM).flatMap((confirm) => Object.values(confirm)),
    points.CHECKIN_SAVED_TEXT,
    points.CHECKIN_UNKNOWN_TEXT,
    points.CHECKIN_UNCHANGED_TEXT,
    points.CHECKIN_UNCERTAIN_TEXT,
    points.cycleSummary(CYCLE),
  ];
  assert.equal(texts.length, 15);
  for (const text of texts) assert.doesNotMatch(text, DASHES, text);
});
