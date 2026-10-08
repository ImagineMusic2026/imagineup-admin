import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const achievements = await import("@/lib/achievements");

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
