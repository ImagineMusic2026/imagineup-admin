import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const achievements = await import("@/lib/achievements");

const DASHES = /[\u2013\u2014]/;

const LEVELS = [
  { number: 1, name: "Primeiro passo", minXp: 0 },
  { number: 2, name: "Na roda", minXp: 600 },
  { number: 3, name: "Pé de serra", minXp: 1500 },
];

test("o catálogo lido: regra, cor e situação; item fora do formato sai", () => {
  const catalog = achievements.parseAchievementsCatalog({
    version: 2,
    achievements: [
      { id: "pe-de-serra", title: "Pé de serra", icon: "star", tone: "points", rule: { type: "level", level: 3 }, status: "active", activatedAt: Timestamp.fromMillis(1000) },
      { id: "top-20", title: "Top 20", icon: "trophy", tone: "points", rule: { type: "rank", top: 20 }, status: "archived" },
      { id: "nova", title: "Nova", icon: "heart", tone: "action", rule: { type: "first", action: "like" } },
      { id: "quebrada", title: "Sem regra", icon: "star", tone: "points", rule: { type: "outra" } },
    ],
    updatedBy: { uid: "u1", name: "Bia" },
  });
  assert.equal(catalog.version, 2);
  assert.deepEqual(
    catalog.achievements.map((item) => [item.id, item.status]),
    [
      ["pe-de-serra", "active"],
      ["top-20", "archived"],
      ["nova", "draft"],
    ],
  );
  assert.equal(catalog.achievements[0].activatedAt.getTime(), 1000);
  assert.equal(catalog.updatedBy, "Bia");
  assert.equal(achievements.achievementsUsage(catalog.achievements), "3 de 100");
});

test("a regra por extenso, com o nome do nível da régua", () => {
  assert.equal(achievements.ruleText({ type: "level", level: 3 }, LEVELS), "Chegar ao nível 3 · Pé de serra");
  assert.equal(achievements.ruleText({ type: "level", level: 9 }, LEVELS), "Chegar ao nível 9");
  assert.equal(achievements.ruleText({ type: "first", action: "mission" }), "Primeira missão concluída");
  assert.equal(achievements.ruleText({ type: "rank", top: 20 }), "Top 20 do ranking");
});

test("o formulário confere o nível contra a régua de agora e o top até 200", () => {
  const form = { ...achievements.EMPTY_ACHIEVEMENT_FORM, title: "Na roda", level: "2" };
  assert.deepEqual(achievements.validateAchievement(form, 3).input, { title: "Na roda", icon: "star", tone: "points", rule: { type: "level", level: 2 } });
  assert.equal(achievements.validateAchievement({ ...form, level: "4" }, 3).errors.level, "Escolha um nível de 2 a 3.");
  assert.equal(achievements.validateAchievement({ ...form, level: "1" }, 3).errors.level, "Escolha um nível de 2 a 3.");
  assert.equal(achievements.validateAchievement({ ...form, ruleType: "rank", top: "201" }, 3).errors.top, "De 1 a 200.");
  assert.deepEqual(achievements.validateAchievement({ ...form, ruleType: "first", action: "share" }, null).input.rule, { type: "first", action: "share" });
  assert.equal(achievements.validateAchievement({ ...form, title: "" }, 3).errors.title, "Escreva o nome, até 40 caracteres.");
});

test("depois de publicada, a regra fica de fora das mudanças", () => {
  const published = achievements.parseAchievement({ id: "a", title: "A", icon: "star", tone: "points", rule: { type: "level", level: 3 }, status: "active", activatedAt: Timestamp.fromMillis(1) });
  const draft = { ...published, activatedAt: null };
  const input = { title: "B", icon: "heart", tone: "points", rule: { type: "level", level: 2 } };
  assert.deepEqual(achievements.achievementChanges(published, input), { title: "B", icon: "heart" });
  assert.deepEqual(achievements.achievementChanges(draft, input), { title: "B", icon: "heart", rule: { type: "level", level: 2 } });
  assert.deepEqual(achievements.achievementFormOf(published).level, "3");
  assert.equal(achievements.achievementFieldOf("achievement.rule.level"), "level");
  assert.equal(achievements.isKnownIcon("trophy"), true);
  assert.equal(achievements.isKnownIcon("goblet"), false);
});

test("a regra de sequência de check-in no catálogo: fica na lista, com os dias, e a regra sem os dias sai", () => {
  const catalog = achievements.parseAchievementsCatalog({
    version: 5,
    achievements: [
      { id: "sete-dias-a1b2", title: "7 dias seguidos", icon: "flame", tone: "action", rule: { type: "streak", days: 7 }, status: "active", activatedAt: Timestamp.fromMillis(2000) },
      { id: "um-ano-c3d4", title: "Um ano inteiro", icon: "flame", tone: "action", rule: { type: "streak", days: 365 } },
      { id: "sem-dias", title: "Sem dias", icon: "flame", tone: "action", rule: { type: "streak" } },
      { id: "dias-tortos", title: "Dias tortos", icon: "flame", tone: "action", rule: { type: "streak", days: "7" } },
      { id: "meio-dia", title: "Meio dia", icon: "flame", tone: "action", rule: { type: "streak", days: 7.5 } },
    ],
  });
  assert.deepEqual(
    catalog.achievements.map((item) => [item.id, item.rule, item.status]),
    [
      ["sete-dias-a1b2", { type: "streak", days: 7 }, "active"],
      ["um-ano-c3d4", { type: "streak", days: 365 }, "draft"],
    ],
  );
  // Com a regra conhecida, a conquista conta no uso e entra na lista que o `reorderAchievements` manda inteira.
  assert.equal(achievements.achievementsUsage(catalog.achievements), "2 de 100");
  assert.equal(achievements.RULE_TYPE_LABELS.streak, "Sequência de check-in");
  assert.deepEqual(Object.keys(achievements.RULE_TYPE_LABELS), ["level", "first", "rank", "streak"]);
  assert.equal(achievements.ruleText({ type: "streak", days: 30 }), "Sequência de 30 dias de check-in");
  assert.equal(achievements.ruleText({ type: "streak", days: 7 }, LEVELS), "Sequência de 7 dias de check-in");
  assert.equal(achievements.ruleText({ type: "streak", days: 1000 }), "Sequência de 1.000 dias de check-in");
});

test("o formulário da sequência: os dias de 2 a 1.000, num ramo próprio, que nunca vira regra de primeira vez", () => {
  assert.equal(achievements.ACHIEVEMENT_STREAK_MIN, 2);
  assert.equal(achievements.ACHIEVEMENT_STREAK_MAX, 1000);
  assert.equal(achievements.EMPTY_ACHIEVEMENT_FORM.days, "7");
  const form = { ...achievements.EMPTY_ACHIEVEMENT_FORM, title: "30 dias seguidos", icon: "flame", tone: "action", ruleType: "streak", days: "30" };
  assert.deepEqual(achievements.validateAchievement(form, 3), { errors: {}, input: { title: "30 dias seguidos", icon: "flame", tone: "action", rule: { type: "streak", days: 30 } } });
  // A régua não entra na conta da sequência: sem ela gravada, a regra vale igual.
  assert.deepEqual(achievements.validateAchievement(form, null).input.rule, { type: "streak", days: 30 });
  // As pontas da faixa valem, e a ação que ficou no formulário (a da regra de primeira vez) não vaza para a regra.
  for (const [days, rule] of [["2", { type: "streak", days: 2 }], ["1000", { type: "streak", days: 1000 }], [" 365 ", { type: "streak", days: 365 }]]) {
    assert.deepEqual(achievements.validateAchievement({ ...form, days, action: "share" }, 3).input.rule, rule, days);
  }
  for (const days of ["1", "0", "1001", "", " ", "7.5", "-7", "sete"]) {
    const checked = achievements.validateAchievement({ ...form, days }, 3);
    assert.deepEqual(checked, { errors: { days: "De 2 a 1.000." }, input: null }, JSON.stringify(days));
  }
  // Os campos das outras regras não atrapalham a de sequência, nem os dias as outras.
  assert.deepEqual(achievements.validateAchievement({ ...form, level: "", top: "999" }, 3).errors, {});
  assert.deepEqual(achievements.validateAchievement({ ...form, ruleType: "first", action: "like", days: "" }, 3).input.rule, { type: "first", action: "like" });
  assert.deepEqual(achievements.validateAchievement({ ...form, ruleType: "rank", top: "20", days: "0" }, 3).input.rule, { type: "rank", top: 20 });

  // O formulário de uma conquista gravada: os dias dela, e o 7 de sugestão nas outras regras.
  const saved = achievements.parseAchievement({ id: "cem-dias-e5f6", title: "100 dias seguidos", icon: "flame", tone: "action", rule: { type: "streak", days: 100 } });
  assert.deepEqual(achievements.achievementFormOf(saved), { title: "100 dias seguidos", icon: "flame", tone: "action", ruleType: "streak", level: "", action: "like", top: "20", days: "100" });
  assert.equal(achievements.achievementFormOf(achievements.parseAchievement({ id: "top-20", title: "Top 20", icon: "trophy", tone: "points", rule: { type: "rank", top: 20 } })).days, "7");
});

test("a sequência publicada tem a regra congelada, e os campos e as frases do servidor de antes e do novo", () => {
  const published = achievements.parseAchievement({ id: "sete-dias-a1b2", title: "7 dias seguidos", icon: "flame", tone: "action", rule: { type: "streak", days: 7 }, status: "active", activatedAt: Timestamp.fromMillis(1) });
  const draft = { ...published, activatedAt: null };
  const input = { title: "Uma semana", icon: "flame", tone: "action", rule: { type: "streak", days: 10 } };
  assert.deepEqual(achievements.achievementChanges(published, input), { title: "Uma semana" });
  assert.deepEqual(achievements.achievementChanges(draft, input), { title: "Uma semana", rule: { type: "streak", days: 10 } });
  assert.deepEqual(achievements.achievementChanges(draft, { ...input, title: "7 dias seguidos", rule: { type: "streak", days: 7 } }), {});
  assert.equal(achievements.sameRule({ type: "streak", days: 7 }, { type: "streak", days: 7 }), true);
  assert.equal(achievements.sameRule({ type: "streak", days: 7 }, { type: "streak", days: 30 }), false);

  // O servidor novo aponta os dias; o de antes não conhece o tipo e recusa a regra inteira.
  assert.equal(achievements.achievementFieldOf("achievement.rule.days"), "days");
  assert.equal(achievements.achievementFieldOf("achievement.rule"), "ruleType");
  assert.equal(achievements.isStreakRuleUnknown("achievement.rule", { type: "streak", days: 7 }), true);
  assert.equal(achievements.isStreakRuleUnknown("achievement.rule.days", { type: "streak", days: 7 }), false);
  assert.equal(achievements.isStreakRuleUnknown("achievement.rule", { type: "rank", top: 20 }), false);
  // Na edição que não mexeu na regra, ela não vai no pedido.
  assert.equal(achievements.isStreakRuleUnknown("achievement.rule", undefined), false);

  assert.equal(achievements.STREAK_KEY_OFF_TEXT, "O check-in diário está desligado: a conquista só aparece para os fãs com ele ligado.");
  assert.equal(achievements.STREAK_RULE_UNKNOWN_TEXT, "O servidor ainda não conhece a regra de sequência de check-in. Publique as funções antes de salvar.");
  assert.match(achievements.STREAK_DAYS_HINT, /^De 2 a 1\.000\. /);
  for (const text of [achievements.RULE_TYPE_LABELS.streak, achievements.STREAK_KEY_OFF_TEXT, achievements.STREAK_RULE_UNKNOWN_TEXT, achievements.STREAK_DAYS_HINT, achievements.ruleText({ type: "streak", days: 30 })]) {
    assert.doesNotMatch(text, DASHES, text);
  }
});

// Uma conquista com a regra e a situação pedidas; a publicada (agora ou antes) tem a data da primeira publicação.
const sample = (rule, status) =>
  achievements.parseAchievement({ id: "amostra-a1b2", title: rule.type === "streak" ? "7 dias seguidos" : "Top 20", icon: "flame", tone: "action", rule, status, ...(status === "draft" ? {} : { activatedAt: Timestamp.fromMillis(1) }) });
const STREAK = { type: "streak", days: 7 };
const RANK = { type: "rank", top: 20 };

test("a situação mostrada: a sequência publicada com a chave do check-in desligada não está no ar", () => {
  // As quatro combinações da publicada: de sequência ou não, com a chave desligada ou ligada.
  assert.equal(achievements.achievementState(sample(STREAK, "active"), false), "waiting");
  assert.equal(achievements.achievementState(sample(STREAK, "active"), true), "active");
  assert.equal(achievements.achievementState(sample(RANK, "active"), false), "active");
  assert.equal(achievements.achievementState(sample(RANK, "active"), true), "active");
  // As outras regras nunca dependem da chave.
  for (const rule of [{ type: "level", level: 3 }, { type: "first", action: "like" }]) assert.equal(achievements.achievementState(sample(rule, "active"), false), "active", rule.type);
  // O rascunho e a arquivada continuam como gravadas: a situação só muda para a publicada.
  for (const status of ["draft", "archived"]) {
    for (const rule of [STREAK, RANK]) {
      for (const enabled of [false, true]) assert.equal(achievements.achievementState(sample(rule, status), enabled), status, `${rule.type} ${status} ${enabled}`);
    }
  }
  // É só o que a tela mostra: a situação gravada, pela qual as ações decidem, não muda.
  assert.equal(sample(STREAK, "active").status, "active");

  // Os rótulos gravados continuam os mesmos, e a nova situação tem o dela.
  assert.deepEqual(achievements.ACHIEVEMENT_STATUS_LABELS, { draft: "Rascunho", active: "No ar", archived: "Arquivada" });
  assert.deepEqual(achievements.ACHIEVEMENT_STATE_LABELS, { draft: "Rascunho", active: "No ar", archived: "Arquivada", waiting: "Em espera" });
  assert.doesNotMatch(achievements.ACHIEVEMENT_STATE_LABELS.waiting, DASHES);
});

test("a confirmação e o aviso do Publicar: no ar só quando a conquista chega aos fãs", () => {
  const FIRST = "A conquista entra no app. Depois de publicada, a regra não muda; nome, ícone e cor continuam editáveis.";
  const AGAIN = "A conquista volta para o app com a mesma regra.";
  // As outras regras, com a chave desligada ou ligada, e a de sequência com a chave ligada: as frases de sempre, letra por letra.
  for (const [rule, enabled] of [[RANK, false], [RANK, true], [{ type: "level", level: 3 }, false], [{ type: "first", action: "like" }, false], [STREAK, true]]) {
    const label = `${rule.type} ${enabled}`;
    assert.equal(achievements.publishConfirmText(sample(rule, "draft"), enabled), FIRST, label);
    assert.equal(achievements.publishConfirmText(sample(rule, "archived"), enabled), AGAIN, label);
    assert.equal(achievements.publishedText(sample(rule, "draft"), enabled), `Conquista ${sample(rule, "draft").title} no ar.`, label);
  }
  assert.equal(achievements.publishedText(sample(RANK, "draft"), false), "Conquista Top 20 no ar.");
  assert.equal(achievements.publishedText(sample(STREAK, "draft"), true), "Conquista 7 dias seguidos no ar.");

  // A de sequência com a chave desligada fica publicada, mas não entra no app: nenhuma das três frases diz "no ar".
  const first = achievements.publishConfirmText(sample(STREAK, "draft"), false);
  const again = achievements.publishConfirmText(sample(STREAK, "archived"), false);
  const done = achievements.publishedText(sample(STREAK, "draft"), false);
  assert.equal(first, "A conquista fica publicada e entra no app quando o check-in diário for ligado. Depois de publicada, a regra não muda; nome, ícone e cor continuam editáveis.");
  assert.equal(again, "A conquista volta a ficar publicada, com a mesma regra, e entra no app quando o check-in diário for ligado.");
  assert.equal(done, "Conquista 7 dias seguidos publicada. Ela aparece para os fãs quando o check-in diário for ligado.");
  for (const text of [first, again, done]) {
    assert.doesNotMatch(text, /no ar/, text);
    assert.doesNotMatch(text, DASHES, text);
  }
});
