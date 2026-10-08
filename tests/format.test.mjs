import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const format = await import("@/lib/format");

/** Um instante pela hora de São Paulo (UTC-3, sem horário de verão). */
const sp = (local) => new Date(`${local}-03:00`);

test("números, pontos e porcentagens em pt-BR", () => {
  assert.equal(format.formatNumber(12480), "12.480");
  assert.equal(format.formatNumber(12480.6), "12.481");
  assert.equal(format.formatNumber(Number.NaN), "0");
  assert.equal(format.formatPoints(1234), "1.234 pts");
  assert.equal(format.formatPoints(1), "1 pt");
  assert.equal(format.formatPoints(-1), "-1 pt");
  assert.equal(format.formatSigned(100), "+100");
  assert.equal(format.formatSigned(-50), "-50");
  assert.equal(format.formatSigned(0), "0");
  assert.equal(format.formatPercent(0.125), "12,5%");
  assert.equal(format.formatPercent(0.4), "40%");
  assert.equal(format.formatDecimal(22.46), "22,5");
});

test("variação contra o período anterior, com a frase para leitor de tela", () => {
  assert.deepEqual(format.formatDelta(112, 100, "os 30 dias anteriores"), {
    direction: "up",
    short: "+12%",
    text: "12% a mais que os 30 dias anteriores.",
  });
  assert.deepEqual(format.formatDelta(90, 100, "os 30 dias anteriores"), {
    direction: "down",
    short: "-10%",
    text: "10% a menos que os 30 dias anteriores.",
  });
  assert.equal(format.formatDelta(5, 0, "os 7 dias anteriores").direction, "new");
  assert.equal(format.formatDelta(5, 0, "os 7 dias anteriores").text, "Nada em os 7 dias anteriores.");
  assert.equal(format.formatDelta(0, 0, "x").direction, "flat");
  assert.equal(format.formatDelta(1000, 1000.2, "x").direction, "flat");
});

test("dias de calendário sem fuso e instantes em São Paulo", () => {
  const now = sp("2026-10-08T10:00:00");
  assert.equal(format.formatDay("2026-08-02", now), "2 ago");
  assert.equal(format.formatDay("2025-12-31", now), "31 dez 2025");
  // 00:30 do dia 8 em São Paulo ainda é 03:30 UTC do dia 8; 23:30 do dia 7 já é dia 8 em UTC.
  assert.equal(format.formatDay(sp("2026-10-07T23:30:00"), now), "7 out");
  assert.equal(format.formatWeekdayDay("2026-10-03", now), "sáb, 3 out");
  assert.equal(format.formatDayRange("2026-09-08", "2026-10-07", now), "de 8 set a 7 out");
  assert.equal(format.formatDayRange("2026-10-01", "2026-10-07", now), "de 1 a 7 out");
  assert.equal(format.formatTime(sp("2026-10-08T14:32:00")), "14:32");
  assert.equal(format.formatDateTime(sp("2026-10-06T14:30:00")), "6 de outubro, 14:30");
});

test("tempo relativo", () => {
  const now = sp("2026-10-08T15:00:00");
  assert.equal(format.formatRelative(sp("2026-10-08T14:59:40"), now), "agora");
  assert.equal(format.formatRelative(sp("2026-10-08T14:55:00"), now), "há 5 min");
  assert.equal(format.formatRelative(sp("2026-10-08T12:00:00"), now), "há 3 h");
  assert.equal(format.formatRelative(sp("2026-10-07T14:00:00"), now), "há 1 dia");
  assert.equal(format.formatRelative(sp("2026-10-06T10:00:00"), now), "há 2 dias");
  assert.equal(format.formatRelative(sp("2026-08-01T10:00:00"), now), "1 ago");
});

test("listas e contagens por extenso", () => {
  assert.equal(format.joinPt(["a"]), "a");
  assert.equal(format.joinPt(["a", "b", "c"]), "a, b e c");
  assert.equal(format.countLabel(1, "fã", "fãs"), "1 fã");
  assert.equal(format.countLabel(2400, "fã", "fãs"), "2.400 fãs");
});
