import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const points = await import("@/lib/points-config");

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
  assert.deepEqual(points.ACTION_CAP_KEYS.slice(-3), ["photo_upload", "profile_save", "name_change"]);
  assert.equal(points.ACTION_CAP_KEYS.length, 13);
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
