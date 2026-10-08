import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const calls = [];
mock.module("@/lib/callable", {
  namedExports: {
    LONG_CALL_TIMEOUT_MS: 130_000,
    call: async (name, data) => {
      calls.push([name, data]);
      return { uid: data.email === "bia@teste.imagineup" ? "bia" : null };
    },
  },
});

const { createFanProfileReader } = await import("@/lib/fan-profile-data");
const { getFanListPage, getFanCard, getAdjustmentEntry } = await import("@/lib/fan-data");
const { searchFans } = await import("@/lib/fan-search");
const { classifyFanSearch } = await import("@/lib/fans");

const at = (iso) => Timestamp.fromMillis(Date.parse(iso));

function seed() {
  firestore.reset();
  firestore.set("users/camila", { displayName: "Camila Ribeiro", username: "camilarib", createdAt: at("2026-09-29T12:00:00Z"), searchKeys: ["ca", "cam", "cami", "camila", "ri", "rib"] });
  firestore.set("users/bia", { displayName: "Bia Santos", username: "biasan", createdAt: at("2026-10-07T12:00:00Z"), searchKeys: ["bi", "bia"] });
  firestore.set("users/r48", { displayName: "Renata", username: "renatatei", createdAt: at("2026-10-01T12:00:00Z"), suspendedAt: at("2026-10-07T12:00:00Z") });
  firestore.set("wallets/camila", { balance: 12480, xp: 12480 });
  firestore.set("wallets/bia", { balance: 0, xp: 50, goalReached: { seasonId: "sj" } });
  firestore.set("users/bia/centrals/nettobrito", { uid: "bia", artistId: "nettobrito", joinedAt: at("2026-10-07T13:00:00Z") });
  firestore.set("fanInvites/camila", { uid: "camila", code: "CAMILA12" });
}

test("a lista de fãs nas formas de consulta de 26.11", async () => {
  seed();
  const reader = createFanProfileReader();
  const newest = await getFanListPage({ kind: "newest" }, null, reader);
  assert.deepEqual(newest.items.map((row) => row.uid), ["bia", "r48", "camila"]);
  assert.equal(newest.items[2].wallet.balance, 12480);
  assert.deepEqual(firestore.queries.find((item) => item.source.collection === "users").orderBy, [{ field: "createdAt", direction: "desc" }]);

  const xp = await getFanListPage({ kind: "xp" }, null, reader);
  assert.deepEqual(xp.items.map((row) => row.uid), ["camila", "bia"]);
  assert.equal(xp.items[0].profile.name, "Camila Ribeiro");

  const suspended = await getFanListPage({ kind: "suspended" }, null, reader);
  assert.deepEqual(suspended.items.map((row) => row.uid), ["r48"]);
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "suspendedAt", op: "!=", value: null }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "suspendedAt", direction: "desc" }]);

  const goal = await getFanListPage({ kind: "goal", seasonId: "sj" }, null, reader);
  assert.deepEqual(goal.items.map((row) => row.uid), ["bia"]);

  const central = await getFanListPage({ kind: "central", artistId: "nettobrito" }, null, reader);
  assert.deepEqual(central.items.map((row) => [row.uid, row.profile.name]), [["bia", "Bia Santos"]]);
  const sent = firestore.queries.find((item) => item.source.group === "centrals");
  assert.deepEqual(sent.where, [{ field: "artistId", op: "==", value: "nettobrito" }]);
  assert.deepEqual(sent.orderBy, [{ field: "joinedAt", direction: "desc" }]);
});

test("a busca: nome pelo searchKeys e o @ por começo, código e e-mail", async () => {
  seed();
  const byName = await searchFans(classifyFanSearch("cami"), { canEdit: false });
  assert.deepEqual(byName.profiles.map((profile) => profile.uid), ["camila"]);
  const keys = firestore.queries.find((item) => item.where[0]?.op === "array-contains");
  assert.deepEqual(keys.where, [{ field: "searchKeys", op: "array-contains", value: "cami" }]);
  assert.equal(keys.limit, 20);
  const handle = firestore.queries.find((item) => item.startAt);
  assert.deepEqual(handle.orderBy, [{ field: "username", direction: "asc" }]);
  assert.deepEqual(handle.startAt, ["cami"]);
  assert.deepEqual(handle.endAt, ["cami"]);

  const byCode = await searchFans(classifyFanSearch("camila12"), { canEdit: false });
  assert.equal(byCode.profiles[0].uid, "camila");

  const forbidden = await searchFans(classifyFanSearch("bia@teste.imagineup"), { canEdit: false });
  assert.deepEqual(forbidden, { kind: "none", message: "A busca por e-mail é só para quem edita a seção Fãs." });
  assert.equal(calls.length, 0);
  assert.deepEqual(await searchFans(classifyFanSearch("bia@teste.imagineup"), { canEdit: true }), { kind: "open", uid: "bia" });
  assert.deepEqual(await searchFans(classifyFanSearch("x@y.com"), { canEdit: true }), { kind: "none", message: "Nenhum fã com esse e-mail." });

  const none = await searchFans(classifyFanSearch("zzz"), { canEdit: true });
  assert.deepEqual(none, { kind: "none", message: "Nenhum fã encontrado." });
});

test("a ficha: a origem com os pontos do extrato de quem convidou, e o lançamento do ajuste", async () => {
  seed();
  const claimedAt = at("2026-10-08T01:46:00Z");
  firestore.set("referrals/bia", {
    inviterUid: "camila",
    code: "CAMILA12",
    via: "link",
    link: { kind: "post", targetId: "p-clipe" },
    utm: { campaign: "sao-joao" },
    claimedAt,
    award: { visit: "applied", signup: "applied" },
  });
  firestore.set("posts/p-clipe", { text: "Saiu o clipe" });
  firestore.set("wallets/camila/ledger/invite_visit:x", { source: "invite_visit", points: 2, subject: { type: "invite", id: "CAMILA12" }, createdAt: claimedAt });
  firestore.set("wallets/camila/ledger/invite_signup:x", { source: "invite_signup", points: 10, subject: { type: "invite", id: "CAMILA12" }, createdAt: claimedAt });
  firestore.set("wallets/camila/ledger/like:y", { source: "like", points: 1, createdAt: at("2026-10-01T00:00:00Z") });

  const card = await getFanCard("bia");
  assert.equal(card.profile.name, "Bia Santos");
  assert.equal(card.origin.inviter.name, "Camila Ribeiro");
  assert.equal(card.origin.postText, "Saiu o clipe");
  assert.deepEqual(card.origin.points, { visit: 2, signup: 10 });
  assert.equal((await getFanCard("camila")).origin, null);

  firestore.set("wallets/bia/ledger/adjustment:tentativa-1", { source: "adjustment", points: 100 });
  assert.equal((await getAdjustmentEntry("bia", "tentativa-1")).points, 100);
  assert.equal(await getAdjustmentEntry("bia", "outra"), null);
});
