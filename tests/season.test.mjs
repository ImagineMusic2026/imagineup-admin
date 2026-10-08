import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const season = await import("@/lib/season");

/** Um instante pela hora de São Paulo (UTC-3, sem horário de verão). */
const sp = (local) => Date.parse(`${local}-03:00`);
const ts = (local) => Timestamp.fromMillis(sp(local));

const CONFIG = season.parseSeasonConfig({
  version: 7,
  season: { id: "sao-joao", name: "São João", startsAt: ts("2026-09-19T22:45:00"), endsAt: ts("2026-10-19T22:45:00"), leaderTitle: null },
  next: null,
  lastClosed: { id: "carnaval", name: "Carnaval", startsAt: ts("2026-07-29T12:00:00"), endsAt: ts("2026-08-28T12:00:00"), closedAt: ts("2026-08-28T12:02:00") },
});

test("o config/season lido, com o top padrão e a última fechada", () => {
  assert.equal(CONFIG.version, 7);
  assert.equal(CONFIG.season.topTarget, 10);
  assert.equal(CONFIG.season.leaderTitle, null);
  assert.equal(CONFIG.lastClosed.name, "Carnaval");
  assert.equal(CONFIG.lastClosed.closedAt.toISOString(), "2026-08-28T15:02:00.000Z");
  assert.deepEqual(season.parseSeasonConfig(undefined), { version: 0, season: null, next: null, lastClosed: null });
});

test("a situação pelo relógio e pelo arquivo da virada", () => {
  const def = CONFIG.season;
  assert.equal(season.seasonPhase(def, null, sp("2026-09-01T00:00:00")), "scheduled");
  assert.equal(season.seasonPhase(def, null, sp("2026-10-08T03:00:00")), "active");
  assert.equal(season.seasonPhase(def, null, sp("2026-10-19T23:00:00")), "awaiting-close");
  assert.equal(season.seasonPhase(def, "closing", sp("2026-10-19T23:00:00")), "closing");
  assert.equal(season.seasonPhase(def, null, sp("2026-10-19T23:30:00")), "late");
  assert.equal(season.seasonPhase(def, "closing", sp("2026-10-20T08:00:00")), "late");
  assert.equal(season.seasonPhase(def, "closed", sp("2026-10-20T08:00:00")), "awaiting-close");
  assert.equal(season.canRunClose("late", def, sp("2026-10-19T23:30:00")), true);
  assert.equal(season.canRunClose("awaiting-close", def, sp("2026-10-19T22:46:00")), true);
  assert.equal(season.canRunClose("awaiting-close", def, sp("2026-10-19T22:45:30")), false);
  assert.equal(season.canRunClose("active", def, sp("2026-10-08T03:00:00")), false);
  assert.equal(season.canRunClose(null, null, sp("2026-10-20T08:00:00")), false);
});

test("o resumo do cabeçalho", () => {
  assert.equal(season.seasonSummary(CONFIG, "active", sp("2026-10-08T03:00:00")), "São João em andamento, termina em 12 dias.");
  assert.equal(season.seasonSummary(CONFIG, "scheduled", sp("2026-09-18T22:45:00")), "São João agendada, começa em 1 dia.");
  assert.equal(season.seasonSummary({ ...CONFIG, season: null }, null, 0), "Nenhuma temporada agora. A última foi Carnaval.");
  assert.equal(season.seasonSummary({ version: 0, season: null, next: null, lastClosed: null }, null, 0), "Nenhuma temporada cadastrada.");
});

test("o formulário: o id pelo nome e a validação do servidor", () => {
  assert.equal(season.suggestSeasonId("Natal de Teste!"), "natal-de-teste");
  assert.equal(season.suggestSeasonId("São João 2027"), "sao-joao-2027");
  const form = { ...season.EMPTY_SEASON_FORM, name: "Natal", id: "natal", startsAt: "2026-12-01T00:00", endsAt: "2026-12-31T23:59" };
  const ok = season.validateSeason(form);
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.input, { id: "natal", name: "Natal", startsAt: sp("2026-12-01T00:00:00"), endsAt: sp("2026-12-31T23:59:00"), leaderTitle: null, topTarget: 10 });
  assert.equal(season.validateSeason({ ...form, id: "Natal!" }).errors.id, "Use de 3 a 40 letras minúsculas, números ou -.");
  assert.equal(season.validateSeason({ ...form, endsAt: "2026-11-01T00:00" }).errors.endsAt, "O fim precisa vir depois do início.");
  assert.equal(season.validateSeason({ ...form, endsAt: "2028-01-01T00:00" }).errors.endsAt, "No máximo 366 dias de temporada.");
  assert.equal(season.validateSeason({ ...form, topTarget: "51" }).errors.topTarget, "De 1 a 50.");
  assert.equal(season.validateSeason({ ...form, name: " " }).errors.name, "Escreva o nome, até 40 caracteres.");
  assert.equal(season.fieldOfDetail("next.endsAt"), "endsAt");
  assert.equal(season.fieldOfDetail("season"), null);
  const back = season.seasonFormOf(CONFIG.season);
  assert.equal(back.startsAt, "2026-09-19T22:45");
  assert.equal(back.idEdited, true);
});

test("ranking e pódio", () => {
  assert.equal(season.changeText(3), "subiu 3 posições");
  assert.equal(season.changeText(-1), "caiu 1 posição");
  assert.equal(season.changeText(0), "sem mudança na semana");
  const past = season.parsePastSeason("verao", { name: "Verão", startsAt: ts("2026-06-19T12:00:00"), endsAt: ts("2026-07-19T12:00:00"), rankedFans: 49, centrals: { nenho: {} } });
  assert.equal(past.id, "verao");
  assert.deepEqual(past.centrals, ["nenho"]);
  assert.deepEqual(season.parseStanding("u1", { displayName: "Renata", position: 1, points: 980, centrals: { nenho: { position: 3, points: 50 } } }, null), {
    uid: "u1",
    position: 1,
    points: 980,
    displayName: "Renata",
    photoURL: null,
    city: null,
  });
  assert.equal(season.parseStanding("u1", { position: 1, centrals: { nenho: { position: 3, points: 50 } } }, "nenho").position, 3);
  assert.equal(season.parseStanding("u1", { centrals: {} }, null), null);
});
