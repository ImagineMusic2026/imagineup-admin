import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const data = await import("@/lib/reward-data");

const sp = (local) => Date.parse(`${local}-03:00`);
const ts = (local) => Timestamp.fromMillis(sp(local));

function order(code, fields) {
  firestore.set(`redemptions/${code}`, { rewardId: "ingressos", rewardTitle: "Par de ingressos", points: 6000, status: "requested", ...fields });
}

test("o catálogo pela ordem do app", async () => {
  firestore.reset();
  firestore.set("rewards/b", { title: "B", status: "published", order: 2 });
  firestore.set("rewards/a", { title: "A", status: "draft", order: 1 });
  const list = await data.getRewards();
  assert.deepEqual(
    list.map((item) => item.id),
    ["a", "b"],
  );
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "order", direction: "asc" }]);
});

test("os pedidos: abertos do mais antigo, fechados do mais novo, e com a recompensa junto", async () => {
  firestore.reset();
  order("UP-AAAAAA", { requestedAt: ts("2026-10-01T10:00:00") });
  order("UP-BBBBBB", { requestedAt: ts("2026-10-02T10:00:00") });
  order("UP-CCCCCC", { requestedAt: ts("2026-10-03T10:00:00"), status: "refused" });
  order("UP-DDDDDD", { requestedAt: ts("2026-10-04T10:00:00"), rewardId: "camisa" });

  const open = await data.getRedemptionsPage("requested", null, null);
  assert.deepEqual(
    open.items.map((item) => item.code),
    ["UP-AAAAAA", "UP-BBBBBB", "UP-DDDDDD"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "status", op: "==", value: "requested" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "requestedAt", direction: "asc" }]);
  assert.equal(firestore.queries.at(-1).limit, 26);

  const all = await data.getRedemptionsPage("all", "ingressos", null);
  assert.deepEqual(
    all.items.map((item) => item.code),
    ["UP-CCCCCC", "UP-BBBBBB", "UP-AAAAAA"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "rewardId", op: "==", value: "ingressos" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "requestedAt", direction: "desc" }]);

  await data.getRedemptionsPage("refused", "ingressos", null);
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "rewardId", op: "==", value: "ingressos" },
    { field: "status", op: "==", value: "refused" },
  ]);

  assert.deepEqual(await data.getRedemptionCounts(null), { requested: 3, approved: 0, delivered: 0, refused: 1, canceled: 0 });
  assert.deepEqual(await data.getRedemptionCounts("camisa"), { requested: 1, approved: 0, delivered: 0, refused: 0, canceled: 0 });
  assert.equal(firestore.counts.length, 10);
});

test("o pedido pelo código e os abertos de uma recompensa", async () => {
  firestore.reset();
  order("UP-AAAAAA", { requestedAt: ts("2026-10-02T10:00:00"), status: "approved" });
  order("UP-BBBBBB", { requestedAt: ts("2026-10-01T10:00:00") });
  order("UP-CCCCCC", { requestedAt: ts("2026-10-03T10:00:00"), status: "delivered" });
  assert.equal((await data.getRedemption("UP-AAAAAA")).status, "approved");
  assert.equal(await data.getRedemption("UP-ZZZZZZ"), null);
  assert.deepEqual(
    (await data.getOpenRedemptionsOf("ingressos")).map((item) => item.code),
    ["UP-BBBBBB", "UP-AAAAAA"],
  );
});

test("os shows: os citados por getDoc e os de hoje em diante para escolher", async () => {
  firestore.reset();
  firestore.set("events/sj", { title: "São João", status: "published", startsAt: ts("2026-11-21T22:00:00") });
  firestore.set("events/ontem", { title: "Ontem", status: "published", startsAt: ts("2026-10-07T22:00:00") });
  const cited = await data.getEvents(["sj", "sumiu", "sj"]);
  assert.equal(cited.get("sj").title, "São João");
  assert.equal(cited.get("sumiu"), null);
  assert.equal(cited.size, 2);

  const choices = await data.getEventChoices(sp("2026-10-08T15:00:00"));
  assert.deepEqual(
    choices.map((item) => item.id),
    ["sj"],
  );
  const sent = firestore.queries.at(-1);
  assert.equal(sent.where[0].value.toMillis(), sp("2026-10-08T00:00:00"));
  assert.equal(sent.limit, 50);
});
