import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const { parseStatsDay } = await import("@/lib/stats");
const compare = await import("@/lib/compare");

function day(key, data) {
  return { ...parseStatsDay(key, data), closed: true };
}

const DAYS = [
  day("2026-10-01", {
    byArtist: {
      nettobrito: { joined: 5, left: 1, earned: 30, likes: 4, bySource: { mission: { points: 10, events: 2 } } },
      nenho: { joined: 2, comments: 3 },
    },
    snapshot: { fans: 100, artists: { nettobrito: { members: 40, totalPoints: 900 }, nenho: { members: 30, totalPoints: 500 } } },
    byOrigin: { kind: { post: { signups: 2, visits: 5 } }, utmCampaign: { "sao-joao": { signups: 2 } } },
  }),
  day("2026-10-02", {
    byArtist: { nettobrito: { joined: 3 }, juninho: { joined: 1, reports: 1 } },
    byOrigin: { kind: { artist: { signups: 1, links: 4 } }, utmCampaign: { "lancamento-clipe": { signups: 3 } } },
  }),
  day("2026-10-05", {
    byArtist: { nenho: { joined: 1, left: 2 } },
    snapshot: { fans: 110, artists: { nettobrito: { members: 47, totalPoints: 1000 }, nenho: { members: 29, totalPoints: 520 } } },
  }),
];
const RANGE = { from: "2026-10-01", to: "2026-10-07" };

test("agrupa por dia até 7 dias e por semana ISO acima disso", () => {
  assert.equal(compare.groupingFor(RANGE), "day");
  assert.equal(compare.groupingFor({ from: "2026-09-08", to: "2026-10-07" }), "week");
  const weeks = compare.groupsOf({ from: "2026-10-03", to: "2026-10-07" }, "week");
  assert.deepEqual(
    weeks.map((group) => [group.key, group.days.length]),
    [
      ["2026-W40", 2],
      ["2026-W41", 3],
    ],
  );
});

test("o resumo de cada central: fluxos somados, membros pelos retratos", () => {
  const netto = compare.artistSummary(DAYS, RANGE, "nettobrito");
  assert.equal(netto.members, 47);
  assert.equal(netto.membersChange, 7);
  assert.equal(netto.joined, 8);
  assert.equal(netto.left, 1);
  assert.equal(netto.joinedMinusLeft, 7);
  assert.equal(netto.earned, 30);
  assert.equal(netto.likes, 4);
  assert.equal(netto.missions, 2);
  assert.equal(netto.totalPoints, 1000);
  // Sem retrato da central, nada de membros: só entradas menos saídas.
  const juninho = compare.artistSummary(DAYS, RANGE, "juninho");
  assert.equal(juninho.members, null);
  assert.equal(juninho.membersChange, null);
  assert.equal(juninho.joinedMinusLeft, 1);
  assert.equal(juninho.totalPoints, null);
});

test("as centrais com mais entradas vêm marcadas, e as que aparecem nos números entram na lista", () => {
  assert.deepEqual(compare.topArtistsByJoined(DAYS, RANGE, ["nenho", "juninho", "nettobrito"]), ["nettobrito", "nenho", "juninho"]);
  assert.deepEqual(compare.topArtistsByJoined(DAYS, RANGE, ["nenho", "juninho", "nettobrito"], 2), ["nettobrito", "nenho"]);
  assert.deepEqual(compare.artistsInDays(DAYS).sort(), ["juninho", "nenho", "nettobrito"]);
});

test("série de um grupo: soma no fluxo, último retrato no estoque, nunca negativa", () => {
  const byDay = new Map(DAYS.map((item) => [item.day, item]));
  const [week40, week41] = compare.groupsOf({ from: "2026-09-28", to: "2026-10-07" }, "week");
  assert.equal(compare.groupValue(byDay, week40, "nettobrito", "joined"), 8);
  assert.equal(compare.groupValue(byDay, week40, "nettobrito", "members"), 40);
  assert.equal(compare.groupValue(byDay, week41, "nettobrito", "members"), 47);
  assert.equal(compare.groupValue(byDay, week41, "nenho", "members"), 29);
  assert.equal(compare.groupValue(byDay, week41, "juninho", "members"), null);
  assert.equal(compare.groupValue(byDay, week41, "nenho", "left"), 2);
});

test("campanhas e tipos de link do período, com o que cada um conta", () => {
  assert.deepEqual(compare.campaignKeys(DAYS, RANGE, "campaign"), ["lancamento-clipe", "sao-joao"]);
  assert.deepEqual(compare.campaignKeys(DAYS, RANGE, "kind"), ["post", "artist"]);
  assert.equal(compare.campaignValue(DAYS[0], "campaign", "sao-joao", "signups"), 2);
  assert.equal(compare.campaignValue(DAYS[0], "campaign", "sao-joao", "visits"), 0);
  assert.equal(compare.campaignValue(DAYS[1], "kind", "artist", "links"), 4);
  const byDay = new Map(DAYS.map((item) => [item.day, item]));
  const [all] = compare.groupsOf(RANGE, "week");
  assert.equal(compare.campaignGroupValue(byDay, all, "kind", "post", "visits"), 5);
});

test("dois períodos: totais, a média dos ativos e as séries alinhadas pelo dia", () => {
  const days = [
    day("2026-09-24", { signups: { total: 2 }, actives: { day: 10 } }),
    day("2026-09-25", { signups: { total: 4 }, actives: { day: 20 } }),
    day("2026-10-01", { signups: { total: 5 }, actives: { day: 30 } }),
  ];
  const a = { from: "2026-10-01", to: "2026-10-02" };
  const b = { from: "2026-09-24", to: "2026-09-25" };
  assert.equal(compare.periodTotal(days, a, "signups"), 5);
  assert.equal(compare.periodTotal(days, b, "signups"), 6);
  assert.equal(compare.periodTotal(days, b, "actives"), 15);
  assert.deepEqual(compare.alignedSeries(days, a, b, "signups"), [
    { index: 0, dayA: "2026-10-01", dayB: "2026-09-24", a: 5, b: 2 },
    { index: 1, dayA: "2026-10-02", dayB: "2026-09-25", a: 0, b: 4 },
  ]);
});
