import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const { parseStatsDay } = await import("@/lib/stats");
const growth = await import("@/lib/growth");

function day(key, data) {
  return { ...parseStatsDay(key, data), closed: true };
}

const RANGE = { from: "2026-10-01", to: "2026-10-07" };

test("cadastros, convites, tipos de link, campanhas e origens do período", () => {
  const days = [
    day("2026-09-28", { signups: { total: 10, invited: 1 }, invites: { visits: 4, links: 2 } }),
    day("2026-10-02", {
      signups: { total: 8, invited: 3 },
      invites: { visits: 6, links: 5 },
      byOrigin: {
        kind: { post: { signups: 2, visits: 4, links: 3 }, code: { signups: 1 } },
        utmCampaign: { "sao-joao": { signups: 2 }, _none: { signups: 1 } },
        utmSource: { instagram: { signups: 3 } },
      },
    }),
    day("2026-10-06", {
      signups: { total: 2 },
      byOrigin: { kind: { artist: { visits: 2 } }, utmCampaign: { "lancamento-clipe": { signups: 1 } } },
    }),
  ];
  const numbers = growth.signupNumbers(days, RANGE);
  assert.deepEqual(numbers.signups, { value: 10, previous: 10 });
  assert.deepEqual(numbers.invited, { value: 3, previous: 1 });
  assert.deepEqual(numbers.visits, { value: 6, previous: 4 });
  assert.deepEqual(numbers.links, { value: 5, previous: 2 });
  assert.equal(numbers.invitedShare, 0.3);
  assert.deepEqual(
    numbers.byKind.map((row) => [row.kind, row.signups, row.visits, row.links]),
    [
      ["post", 2, 4, 3],
      ["code", 1, 0, 0],
      ["artist", 0, 2, 0],
    ],
  );
  assert.deepEqual(numbers.campaigns, [
    { key: "sao-joao", signups: 2, share: 0.5 },
    { key: "_none", signups: 1, share: 0.25 },
    { key: "lancamento-clipe", signups: 1, share: 0.25 },
  ]);
  assert.deepEqual(numbers.sources, [{ key: "instagram", signups: 3, share: 1 }]);
  assert.equal(growth.signupNumbers([], RANGE).invitedShare, null);
});

test("ativos: média por dia, semana e mês até ontem, e os anteriores inteiros", () => {
  assert.deepEqual(growth.activesSpan(RANGE), { from: "2026-09-01", to: "2026-10-07" });
  const days = [
    day("2026-09-10", { actives: { newInMonth: 40 } }),
    day("2026-09-29", { actives: { day: 6, newInWeek: 5, newInMonth: 2 } }),
    day("2026-10-01", { actives: { day: 10, newInWeek: 3, newInMonth: 10 } }),
    day("2026-10-05", { actives: { day: 20, newInWeek: 9, newInMonth: 4 } }),
    day("2026-10-08", { actives: { day: 99, newInWeek: 99, newInMonth: 99 } }),
  ];
  const numbers = growth.activeNumbers(days, RANGE);
  assert.deepEqual(numbers.averagePerDay, { value: 15, previous: 6 });
  assert.deepEqual(numbers.week, { current: 9, currentKey: "2026-W41", previous: 8, previousKey: "2026-W40" });
  assert.deepEqual(numbers.month, { current: 14, currentKey: "2026-10", previous: 42, previousKey: "2026-09" });
});

test("a retenção lê as 8 semanas inteiras antes da de ontem, até ontem", () => {
  const plan = growth.retentionPlan("2026-10-07");
  assert.equal(plan.cohorts.length, 8);
  assert.equal(plan.cohorts[0], "2026-W33");
  assert.equal(plan.cohorts[7], "2026-W40");
  assert.deepEqual(plan.range, { from: "2026-08-10", to: "2026-10-07" });
});

test("rótulos de mês e semana", () => {
  assert.equal(growth.monthLabel("2026-10"), "outubro de 2026");
  assert.equal(growth.weekLabel("2026-W41", (key) => key), "semana de 2026-10-05");
});
