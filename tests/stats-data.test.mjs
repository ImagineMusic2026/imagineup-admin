import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const { chunkRange, getStatsDays, getTodayStats } = await import("@/lib/stats-data");

/** Um instante pela hora de São Paulo (UTC-3, sem horário de verão). */
const sp = (local) => Date.parse(`${local}-03:00`);

function closedDay(day, data = {}) {
  firestore.set(`statsDaily/${day}`, { day, closed: true, ...data });
}

test("faixa maior que 90 dias vira mais de uma consulta", () => {
  assert.deepEqual(chunkRange({ from: "2026-07-10", to: "2026-10-07" }), [{ from: "2026-07-10", to: "2026-10-07" }]);
  assert.deepEqual(chunkRange({ from: "2026-04-11", to: "2026-10-07" }), [
    { from: "2026-04-11", to: "2026-07-09" },
    { from: "2026-07-10", to: "2026-10-07" },
  ]);
});

test("lê os dias fechados pela faixa de ids e o statsMeta/close; ontem fechado não soma nada", async () => {
  firestore.reset();
  firestore.set("statsMeta/close", { lastClosedDay: "2026-10-07" });
  closedDay("2026-10-05", { signups: { total: 3 } });
  closedDay("2026-10-07", { signups: { total: 4 } });
  closedDay("2026-09-01", { signups: { total: 99 } });
  firestore.set("statsDaily/2026-10-07/statsShards/1", { signups: { total: 50 } });

  const read = await getStatsDays({ from: "2026-10-01", to: "2026-10-07" }, sp("2026-10-08T09:00:00"));
  assert.equal(read.state.kind, "ok");
  assert.deepEqual(
    read.days.map((day) => [day.day, day.signups.total]),
    [
      ["2026-10-05", 3],
      ["2026-10-07", 4],
    ],
  );
  assert.deepEqual(read.missing, ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-06"]);
  assert.deepEqual(firestore.reads, ["statsMeta/close"]);
  assert.deepEqual(firestore.queries, [
    {
      source: { collection: "statsDaily" },
      where: [
        { field: "__id__", op: ">=", value: "2026-10-01" },
        { field: "__id__", op: "<=", value: "2026-10-07" },
      ],
      orderBy: [],
      startAfter: null,
      startAt: null,
      endAt: null,
      limit: null,
    },
  ]);
});

test("entre a meia-noite e o fechamento, só ontem é somado dos shards", async () => {
  firestore.reset();
  firestore.set("statsMeta/close", { lastClosedDay: "2026-10-06" });
  closedDay("2026-10-06", { totals: { likes: 1 } });
  firestore.set("statsDaily/2026-10-07/statsShards/3", { day: "2026-10-07", totals: { likes: 2 } });
  firestore.set("statsDaily/2026-10-07/statsShards/9", { day: "2026-10-07", totals: { likes: 5 } });
  firestore.set("statsDaily/2026-10-07/statsShards/backfill", { backfill: true, signups: { total: 1 } });

  const read = await getStatsDays({ from: "2026-10-06", to: "2026-10-07" }, sp("2026-10-08T00:10:00"));
  assert.equal(read.state.kind, "yesterday-open");
  const yesterday = read.days.find((day) => day.day === "2026-10-07");
  assert.equal(yesterday.closed, false);
  assert.equal(yesterday.totals.likes, 7);
  assert.equal(yesterday.signups.total, 1);
  assert.equal(yesterday.shardCount, 3);
  assert.deepEqual(read.missing, []);
  assert.deepEqual(firestore.queries.at(-1).source, { collection: "statsDaily/2026-10-07/statsShards" });
});

test("fechamento atrasado ou que nunca começou não soma nada no navegador", async () => {
  firestore.reset();
  firestore.set("statsMeta/close", { lastClosedDay: "2026-10-01" });
  firestore.set("statsDaily/2026-10-07/statsShards/3", { totals: { likes: 2 } });
  const late = await getStatsDays({ from: "2026-10-01", to: "2026-10-07" }, sp("2026-10-08T09:00:00"));
  assert.deepEqual(late.state, { kind: "late", lastClosedDay: "2026-10-01", firstOpenDay: "2026-10-02" });
  assert.equal(late.days.length, 0);
  assert.equal(firestore.queries.length, 1);

  firestore.reset();
  const none = await getStatsDays({ from: "2026-10-01", to: "2026-10-07" }, sp("2026-10-08T09:00:00"));
  assert.deepEqual(none.state, { kind: "not-started" });
  assert.equal(none.days.length, 0);
});

test("90 dias e o anterior: duas consultas, uma por pedaço", async () => {
  firestore.reset();
  firestore.set("statsMeta/close", { lastClosedDay: "2026-10-07" });
  await getStatsDays({ from: "2026-04-11", to: "2026-10-07" }, sp("2026-10-08T09:00:00"));
  assert.equal(firestore.queries.length, 2);
});

test("hoje até agora soma os shards de hoje", async () => {
  firestore.reset();
  firestore.set("statsDaily/2026-10-08/statsShards/1", { totals: { comments: 4 } });
  firestore.set("statsDaily/2026-10-08/statsShards/2", { totals: { comments: 1 } });
  const today = await getTodayStats(sp("2026-10-08T14:00:00"));
  assert.equal(today.day, "2026-10-08");
  assert.equal(today.closed, false);
  assert.equal(today.totals.comments, 5);
});
