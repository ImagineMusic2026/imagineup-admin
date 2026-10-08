import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const day = await import("@/lib/day");

/** Um instante pela hora de São Paulo (UTC-3, sem horário de verão). */
const sp = (local) => Date.parse(`${local}-03:00`);

test("o dia de São Paulo perto da meia-noite e na virada do ano", () => {
  assert.equal(day.dayKey(sp("2026-10-07T23:59:59")), "2026-10-07");
  assert.equal(day.dayKey(sp("2026-10-08T00:00:00")), "2026-10-08");
  // 01:00 UTC do dia 1º de janeiro ainda é 31 de dezembro em São Paulo.
  assert.equal(day.dayKey(Date.parse("2027-01-01T01:00:00Z")), "2026-12-31");
  assert.equal(day.shiftDay("2026-12-31", 1), "2027-01-01");
  assert.equal(day.shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(day.dayStartMs("2026-10-08"), sp("2026-10-08T00:00:00"));
  assert.equal(day.daysBetween("2026-10-01", "2026-10-07"), 7);
});

test("semanas ISO e meses", () => {
  assert.equal(day.weekKey("2026-10-05"), "2026-W41");
  assert.equal(day.weekKey("2026-10-04"), "2026-W40");
  // 1º de janeiro de 2027 (sexta) ainda é da última semana de 2026.
  assert.equal(day.weekKey("2027-01-01"), "2026-W53");
  assert.equal(day.monthKey("2026-10-05"), "2026-10");
  assert.deepEqual(day.isoWeekDays("2026-W41"), [
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
    "2026-10-11",
  ]);
  assert.equal(day.isoWeekDays("2026-W53")[6], "2027-01-03");
  assert.equal(day.shiftWeek("2026-W53", 1), "2027-W01");
  assert.equal(day.shiftWeek("2026-W41", -2), "2026-W39");
  assert.equal(day.monthDays("2026-02").length, 28);
});

test("períodos terminando ontem e o anterior de mesmo tamanho", () => {
  const now = sp("2026-10-08T00:10:00");
  const range = day.rangeEndingYesterday(30, now);
  assert.deepEqual(range, { from: "2026-09-08", to: "2026-10-07" });
  assert.deepEqual(day.previousRange(range), { from: "2026-08-09", to: "2026-09-07" });
  assert.deepEqual(day.rangeEndingYesterday(7, now), { from: "2026-10-01", to: "2026-10-07" });
  assert.equal(day.daysOf(range).length, 30);
  assert.deepEqual(day.rangeStartingAt("2026-09-01", 7), { from: "2026-09-01", to: "2026-09-07" });
  assert.deepEqual(day.spanOf({ from: "2026-09-08", to: "2026-10-07" }, { from: "2026-08-09", to: "2026-09-07" }), {
    from: "2026-08-09",
    to: "2026-10-07",
  });
});

test("data e hora local no fuso do show e de volta", () => {
  assert.equal(day.localToMs("2026-11-21T22:00"), sp("2026-11-21T22:00:00"));
  // Manaus é UTC-4.
  assert.equal(day.localToMs("2026-11-21T22:00", "America/Manaus"), Date.parse("2026-11-22T02:00:00Z"));
  assert.equal(day.msToLocal(Date.parse("2026-11-22T02:00:00Z"), "America/Manaus"), "2026-11-21T22:00");
  assert.equal(day.msToLocal(sp("2026-10-08T09:05:00")), "2026-10-08T09:05");
  assert.equal(day.localToMs("21/11/2026 22:00"), null);
});
