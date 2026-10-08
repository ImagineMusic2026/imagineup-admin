import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const { EMPTY_FILTERS, AUTOMATIC_ACTOR } = await import("@/lib/audit");
const { countAudit, findFanUidByHandle, getAuditPage, getAuditPeople } = await import("@/lib/audit-data");

/** Um instante pela hora de São Paulo (UTC-3, sem horário de verão). */
const sp = (local) => Date.parse(`${local}-03:00`);
const NOW = sp("2026-10-08T10:00:00");

function entry(id, at, data) {
  firestore.set(`staffAudit/${id}`, { createdAt: Timestamp.fromMillis(sp(at)), ...data });
}

function seed() {
  firestore.reset();
  entry("a", "2026-10-08T09:00:00", { action: "reward.stock.updated", actorUid: "ed", section: "rewards", targets: ["reward:meet"] });
  entry("b", "2026-10-07T09:00:00", { action: "season.closed", actorUid: null, actorName: "Virada automática", section: "ranking", targets: ["season:sj"] });
  entry("c", "2026-10-01T09:00:00", { action: "fan.suspended", actorUid: "ad", section: "moderation", targets: ["fan:rank48"] });
  entry("d", "2026-08-01T09:00:00", { action: "invite.created", actorUid: "ad", section: "team", targets: ["invite:x"] });
}

test("sem filtro: o período como faixa, do mais novo, 50 por vez", async () => {
  seed();
  const page = await getAuditPage(EMPTY_FILTERS, NOW, null);
  assert.deepEqual(
    page.items.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.equal(page.hasMore, false);
  const sent = firestore.queries.at(-1);
  assert.deepEqual(sent.where, [{ field: "createdAt", op: ">=", value: Timestamp.fromMillis(sp("2026-09-09T00:00:00")) }]);
  assert.deepEqual(sent.orderBy, [{ field: "createdAt", direction: "desc" }]);
  assert.equal(sent.limit, 51);
  const all = await getAuditPage({ ...EMPTY_FILTERS, period: "all" }, NOW, null);
  assert.equal(all.items.length, 4);
  assert.deepEqual(firestore.queries.at(-1).where, []);
});

test("as formas de consulta dos índices: pessoa, automático, pessoa com seção, ação e alvo", async () => {
  seed();
  const byPerson = await getAuditPage({ ...EMPTY_FILTERS, person: "ad", period: "all" }, NOW, null);
  assert.deepEqual(byPerson.items.map((item) => item.id), ["c", "d"]);
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "actorUid", op: "==", value: "ad" }]);

  const automatic = await getAuditPage({ ...EMPTY_FILTERS, person: AUTOMATIC_ACTOR }, NOW, null);
  assert.deepEqual(automatic.items.map((item) => item.id), ["b"]);

  await getAuditPage({ ...EMPTY_FILTERS, person: "ad", section: "team", period: "all" }, NOW, null);
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "actorUid", op: "==", value: "ad" },
    { field: "section", op: "==", value: "team" },
  ]);

  const byAction = await getAuditPage({ ...EMPTY_FILTERS, section: "rewards", action: "reward.stock.updated" }, NOW, null);
  assert.deepEqual(byAction.items.map((item) => item.id), ["a"]);
  assert.equal(firestore.queries.at(-1).where[0].field, "action");
  assert.equal(firestore.queries.at(-1).where.length, 2);

  const byTarget = await getAuditPage({ ...EMPTY_FILTERS, section: "team", person: "ed", target: "fan:rank48" }, NOW, null);
  assert.deepEqual(byTarget.items.map((item) => item.id), ["c"]);
  assert.deepEqual(firestore.queries.at(-1).where[0], { field: "targets", op: "array-contains", value: "fan:rank48" });
});

test("a contagem, a equipe do filtro e o @ do fã", async () => {
  seed();
  assert.equal(await countAudit(EMPTY_FILTERS, NOW), 3);
  firestore.set("staff/ad", { displayName: "Equipe de Teste", role: "admin", status: "active" });
  firestore.set("staff/ed", { displayName: "Editora de Teste", role: "editor", status: "active" });
  assert.deepEqual(await getAuditPeople(), [
    { uid: "ad", name: "Equipe de Teste" },
    { uid: "ed", name: "Editora de Teste" },
  ]);
  firestore.set("users/rank48", { username: "rank_48" });
  assert.equal(await findFanUidByHandle("@Rank_48"), "rank48");
  assert.equal(await findFanUidByHandle("ninguem"), null);
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "username", op: "==", value: "ninguem" }]);
});
