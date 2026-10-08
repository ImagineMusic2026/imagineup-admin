import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const { parseStatsDay } = await import("@/lib/stats");
const overview = await import("@/lib/overview");

function day(key, data) {
  return { ...parseStatsDay(key, data), closed: true };
}

const RANGE = { from: "2026-10-01", to: "2026-10-07" };

test("a faixa lida cobre o período, o anterior e o começo do mês e da semana de ontem", () => {
  assert.deepEqual(overview.overviewSpan(RANGE), { from: "2026-09-24", to: "2026-10-07" });
  // 7 dias terminando no dia 20: o mês começa antes do período anterior.
  assert.deepEqual(overview.overviewSpan({ from: "2026-10-14", to: "2026-10-20" }), { from: "2026-10-01", to: "2026-10-20" });
});

test("os cartões do período contra o anterior, com o ajuste da equipe à parte", () => {
  const days = [
    day("2026-09-27", { signups: { total: 4 }, totals: { earned: 100 }, actives: { day: 10 }, snapshot: { fans: 50 } }),
    day("2026-09-30", { snapshot: { fans: 60 }, actives: { day: 20, newInMonth: 30 } }),
    day("2026-10-01", {
      signups: { total: 5, invited: 2 },
      totals: { earned: 120, likes: 3, redeemRequested: 1, refunded: 50, redeemDelivered: 1 },
      bySource: { comment: { points: 20, events: 10 }, adjustment: { points: -30, events: 1 }, redeem: { points: 200, events: 1 } },
      byMission: { a: { completed: 2 }, b: { completed: 5 } },
      byAchievement: { x: { unlocked: 1 } },
      actives: { day: 30, newInWeek: 12, newInMonth: 12 },
    }),
    day("2026-10-05", { signups: { total: 3 }, actives: { day: 10, newInWeek: 7, newInMonth: 2 }, snapshot: { fans: 70 } }),
    day("2026-10-07", { actives: { day: 20, newInWeek: 1, newInMonth: 1 }, byMission: { a: { completed: 4 } } }),
  ];
  const numbers = overview.overviewNumbers(days, RANGE);
  assert.deepEqual(numbers.fans, { value: 70, day: "2026-10-05", change: 10 });
  assert.deepEqual(numbers.signups, { value: 8, previous: 4, invited: 2 });
  assert.deepEqual(numbers.earned, { value: 120, previous: 100 });
  assert.deepEqual(numbers.adjustments, { points: -30, events: 1 });
  assert.equal(numbers.activesAverage.value, 20);
  assert.equal(numbers.activesAverage.previous, 15);
  // Semana de 5 out até ontem (7 out); mês de outubro até ontem.
  assert.equal(numbers.activesWeek, 8);
  assert.equal(numbers.activesMonth, 15);
  assert.deepEqual(numbers.engagement.likes, { value: 3, previous: 0 });
  assert.deepEqual(numbers.store, { requested: 1, spent: 200, refunded: 50, delivered: 1 });
  assert.deepEqual(
    numbers.bySource.map((row) => row.source),
    ["redeem", "adjustment", "comment"],
  );
  assert.deepEqual(numbers.topMissions, [
    { id: "a", completed: 6 },
    { id: "b", completed: 5 },
  ]);
  assert.deepEqual(numbers.achievements, [{ id: "x", unlocked: 1 }]);
  assert.equal(numbers.daysWithData, 3);
});

test("sem retrato no período, os fãs ficam para o próximo fechamento; sem o dia de antes, sem variação", () => {
  const empty = overview.overviewNumbers([], RANGE);
  assert.equal(empty.fans, null);
  assert.equal(empty.daysWithData, 0);
  const noBefore = overview.overviewNumbers([day("2026-10-02", { snapshot: { fans: 9 } })], RANGE);
  assert.deepEqual(noBefore.fans, { value: 9, day: "2026-10-02", change: null });
});

test("o engajamento do gráfico e os dias que faltam", () => {
  assert.equal(overview.engagementOf(day("2026-10-01", { totals: { likes: 2, comments: 3, rsvps: 1, reports: 9 } })), 6);
  assert.deepEqual(overview.missingDays({ from: "2026-10-01", to: "2026-10-03" }, [day("2026-10-02", {})]), ["2026-10-01", "2026-10-03"]);
  assert.equal(overview.previousLabel(30), "os 30 dias anteriores");
});
