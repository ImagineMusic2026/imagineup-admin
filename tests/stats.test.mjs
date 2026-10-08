import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const stats = await import("@/lib/stats");

// As contas dos números do dia: a soma igual à do servidor
// (functions/src/points/close.test.ts), o estado do fechamento, os ativos da
// semana e do mês e a retenção por coorte.

test("soma toda folha numérica em qualquer profundidade, com o ausente valendo 0", () => {
  const sum = stats.sumStatsDocs([
    {
      day: "2026-10-05",
      totals: { earned: 10, earnedEvents: 2 },
      byArtist: { nenho: { joined: 1, bySource: { like: { points: 0, events: 3 } } } },
      actives: { day: 4, newInWeek: 1 },
      updatedAt: Timestamp.fromMillis(Date.parse("2026-10-05T15:00:00Z")),
    },
    {
      day: "2026-10-05",
      totals: { earned: 5, spent: 7 },
      byArtist: { nenho: { joined: 2 }, nettobrito: { left: 1 } },
      actives: { day: 1, newInMonth: 1 },
    },
  ]);
  assert.deepEqual(sum, {
    totals: { earned: 15, earnedEvents: 2, spent: 7 },
    byArtist: {
      nenho: { joined: 3, bySource: { like: { points: 0, events: 3 } } },
      nettobrito: { left: 1 },
    },
    actives: { day: 5, newInWeek: 1, newInMonth: 1 },
  });
});

test("ignora day, updatedAt e backfill do topo, datas, textos e números estranhos", () => {
  const sum = stats.sumStatsDocs([
    {
      day: "2026-10-05",
      backfill: true,
      signups: { total: 3 },
      updatedAt: Timestamp.fromMillis(0),
      marca: "texto",
      quando: Timestamp.fromMillis(1_000),
      lista: [1, 2, 3],
      totals: { earned: Number.NaN, spent: Infinity, refunded: 2 },
    },
    null,
    "não é documento",
    { signups: { total: 2, invited: 1 } },
  ]);
  assert.deepEqual(sum, { signups: { total: 5, invited: 1 }, totals: { refunded: 2 } });
});

test("campo novo nos shards entra na soma sem mudar código; sem shard, a soma é vazia", () => {
  assert.deepEqual(stats.sumStatsDocs([{ novidade: { porCentral: { nenho: 2 } } }, { novidade: { porCentral: { nenho: 3 } } }]), {
    novidade: { porCentral: { nenho: 5 } },
  });
  assert.deepEqual(stats.sumStatsDocs([]), {});
});

test("o dia lido tem todo campo, com o ausente valendo 0, e o retrato quando existe", () => {
  const closedAt = Timestamp.fromMillis(Date.parse("2026-10-08T03:20:00Z"));
  const day = stats.parseStatsDay("2026-10-07", {
    closed: true,
    closedAt,
    shardCount: 12,
    totals: { earned: 40 },
    bySource: { comment: { points: 20 } },
    byArtist: { nenho: { joined: 2, bySource: { like: { events: 3 } } } },
    cohorts: { "2026-W40": { active: 5 } },
    signups: { total: 9 },
    byOrigin: { kind: { post: { signups: 2 } }, utmCampaign: { "sao-joao": { signups: 2 }, _none: { signups: 7 } } },
    byMission: { "missao-a": { completed: 4 } },
    byAchievement: { "nivel-7": { unlocked: 1 } },
    byReward: { ingresso: { requested: 2, spent: 400 } },
    snapshot: {
      at: closedAt,
      fans: 1200,
      season: { id: "sao-joao", rankedFans: 300 },
      artists: { nenho: { members: 80, totalPoints: 9000 } },
    },
  });
  assert.equal(day.closed, true);
  assert.equal(day.closedAt.toISOString(), "2026-10-08T03:20:00.000Z");
  assert.equal(day.totals.earned, 40);
  assert.equal(day.totals.redeemCanceled, 0);
  assert.deepEqual(day.bySource.comment, { points: 20, events: 0 });
  assert.equal(day.byArtist.nenho.joined, 2);
  assert.equal(day.byArtist.nenho.left, 0);
  assert.deepEqual(day.byArtist.nenho.bySource.like, { points: 0, events: 3 });
  assert.deepEqual(day.actives, { day: 0, newInWeek: 0, newInMonth: 0 });
  assert.deepEqual(day.cohorts, { "2026-W40": 5 });
  assert.deepEqual(day.signups, { total: 9, invited: 0 });
  assert.deepEqual(day.byOrigin.kind.post, { signups: 2, visits: 0, links: 0 });
  assert.deepEqual(day.byOrigin.utmCampaign, { "sao-joao": 2, _none: 7 });
  assert.deepEqual(day.byOrigin.utmSource, {});
  assert.deepEqual(day.byMission, { "missao-a": 4 });
  assert.deepEqual(day.byAchievement, { "nivel-7": 1 });
  assert.equal(day.byReward.ingresso.spent, 400);
  assert.equal(day.byReward.ingresso.refunded, 0);
  assert.equal(day.snapshot.fans, 1200);
  assert.deepEqual(day.snapshot.season, { id: "sao-joao", rankedFans: 300 });
  assert.deepEqual(day.snapshot.artists.nenho, { members: 80, totalPoints: 9000 });

  const empty = stats.parseStatsDay("2026-10-06", {});
  assert.equal(empty.closed, false);
  assert.equal(empty.snapshot, null);
  assert.equal(empty.totals.likes, 0);

  const open = stats.statsDayFromShards("2026-10-08", [{ totals: { likes: 2 } }, { totals: { likes: 3 }, backfill: true }]);
  assert.equal(open.closed, false);
  assert.equal(open.shardCount, 2);
  assert.equal(open.totals.likes, 5);
});

test("o estado do fechamento nos quatro casos", () => {
  const today = "2026-10-08";
  assert.deepEqual(stats.closeState(null, today), { kind: "not-started" });
  assert.deepEqual(stats.closeState({ lastClosedDay: "lixo" }, today), { kind: "not-started" });
  assert.deepEqual(stats.closeState({ lastClosedDay: "2026-10-07" }, today), { kind: "ok", lastClosedDay: "2026-10-07" });
  assert.deepEqual(stats.closeState({ lastClosedDay: "2026-10-06" }, today), {
    kind: "yesterday-open",
    lastClosedDay: "2026-10-06",
  });
  assert.deepEqual(stats.closeState({ lastClosedDay: "2026-09-28" }, today), {
    kind: "late",
    lastClosedDay: "2026-09-28",
    firstOpenDay: "2026-09-29",
  });
});

function dayWith(key, data) {
  return { ...stats.parseStatsDay(key, data), closed: true };
}

test("somas, séries por dia e por semana, com o dia sem documento marcado", () => {
  const days = [
    dayWith("2026-10-05", { signups: { total: 3, invited: 1 } }),
    dayWith("2026-10-07", { signups: { total: 5 } }),
    { ...stats.parseStatsDay("2026-10-08", { signups: { total: 2 } }), closed: false },
  ];
  const range = { from: "2026-10-04", to: "2026-10-08" };
  assert.equal(stats.sumRange(days, (day) => day.signups.total), 10);
  assert.equal(stats.sumRange(days, (day) => day.signups.total, { from: "2026-10-05", to: "2026-10-07" }), 8);
  const series = stats.seriesByDay(range, days, (day) => day.signups.total);
  assert.deepEqual(
    series.map((point) => [point.day, point.value, point.missing, point.partial]),
    [
      ["2026-10-04", 0, true, false],
      ["2026-10-05", 3, false, false],
      ["2026-10-06", 0, true, false],
      ["2026-10-07", 5, false, false],
      ["2026-10-08", 2, false, true],
    ],
  );
  const weeks = stats.seriesByWeek(range, days, (day) => day.signups.total);
  assert.deepEqual(
    weeks.map((week) => [week.week, week.from, week.to, week.value, week.missing]),
    [
      ["2026-W40", "2026-10-04", "2026-10-04", 0, true],
      ["2026-W41", "2026-10-05", "2026-10-08", 10, true],
    ],
  );
  assert.deepEqual(
    stats.sumMaps(days, (day) => ({ total: day.signups.total })),
    { total: 10 },
  );
});

test("ativos únicos da semana e do mês somam newInWeek e newInMonth, nunca actives.day", () => {
  const days = [
    dayWith("2026-09-30", { actives: { day: 50, newInWeek: 10, newInMonth: 30 } }),
    dayWith("2026-10-01", { actives: { day: 40, newInWeek: 4, newInMonth: 40 } }),
    dayWith("2026-10-05", { actives: { day: 30, newInWeek: 25, newInMonth: 3 } }),
    dayWith("2026-10-06", { actives: { day: 35, newInWeek: 6, newInMonth: 2 } }),
    dayWith("2026-10-07", { actives: { day: 33, newInWeek: 5, newInMonth: 1 } }),
  ];
  assert.equal(stats.activesOf(days, { week: "2026-W41" }), 36);
  assert.equal(stats.activesOf(days, { week: "2026-W40" }), 14);
  assert.equal(stats.activesOf(days, { month: "2026-10" }), 46);
  assert.equal(stats.activesToDate(days, "week", "2026-10-06"), 31);
  assert.equal(stats.activesToDate(days, "month", "2026-10-07"), 46);
  assert.equal(stats.periodStart("week", "2026-10-07"), "2026-10-05");
  assert.equal(stats.periodStart("month", "2026-10-07"), "2026-10-01");
});

test("retenção por coorte: ativos da coorte na semana sobre os cadastros da semana dela", () => {
  const days = [
    // Semana 40 (28 set a 4 out): 10 cadastros, 8 ativos dela na própria semana.
    dayWith("2026-09-28", { signups: { total: 6 }, cohorts: { "2026-W40": { active: 5 } } }),
    dayWith("2026-10-02", { signups: { total: 4 }, cohorts: { "2026-W40": { active: 3 } } }),
    // Semana 41 (5 a 11 out): 4 ativos da coorte 40; 5 cadastros e 4 ativos da 41.
    dayWith("2026-10-05", { signups: { total: 5 }, cohorts: { "2026-W40": { active: 4 }, "2026-W41": { active: 4 } } }),
  ];
  const table = stats.retentionTable(days, ["2026-W40", "2026-W41"], "2026-10-07");
  assert.equal(table[0].signups, 10);
  assert.deepEqual(
    table[0].cells.map((cell) => [cell.offset, cell.active, cell.rate, cell.partial]),
    [
      [0, 8, 0.8, true],
      [1, 4, 0.4, true],
    ],
  );
  assert.equal(table[1].signups, 5);
  assert.deepEqual(
    table[1].cells.map((cell) => [cell.offset, cell.active, cell.rate]),
    [[0, 4, 0.8]],
  );
  // Coorte sem cadastro: sem porcentagem.
  assert.equal(stats.retentionTable([], ["2026-W41"], "2026-10-07")[0].cells[0].rate, null);
});

test("o retrato vale o do último dia que tem um, e o closedAt é o mais novo", () => {
  const days = [
    dayWith("2026-10-05", { snapshot: { fans: 100 }, closedAt: Timestamp.fromMillis(1) }),
    dayWith("2026-10-06", { closedAt: Timestamp.fromMillis(3) }),
    dayWith("2026-10-04", { snapshot: { fans: 90 }, closedAt: Timestamp.fromMillis(2) }),
  ];
  assert.equal(stats.lastSnapshot(days).day, "2026-10-05");
  assert.equal(stats.lastSnapshot(days).snapshot.fans, 100);
  assert.equal(stats.lastSnapshot([]), null);
  assert.equal(stats.lastClosedAt(days).getTime(), 3);
});

test("rótulos das origens e das campanhas", () => {
  assert.equal(stats.sourceLabel("invite_signup"), "Cadastro pelo link");
  assert.equal(stats.sourceLabel("adjustment"), "Ajuste da equipe");
  assert.equal(stats.sourceLabel("nova_origem"), "nova_origem");
  assert.equal(stats.originKindLabel("code"), "Código digitado");
  assert.equal(stats.utmLabel("_none"), "Sem campanha");
  assert.equal(stats.utmLabel("_other"), "Outras");
  assert.equal(stats.utmLabel("sao-joao"), "sao-joao");
});
