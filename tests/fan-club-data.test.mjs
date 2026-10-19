import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

// As leituras da seção Fã-clubes (34.6 e 34.10): cada consulta na forma de um
// índice de 34.6 (o emulador não cobra índice), as páginas de 25 com o
// "Carregar mais", o privado e o contato pelo caminho, e a leitura do servidor.

const firestore = installFirestoreFake();
const data = await import("@/lib/fan-club-data");

const ts = (local) => Timestamp.fromMillis(Date.parse(`${local}-03:00`));

function application(uid, fields) {
  firestore.set(`fanClubApplications/${uid}`, { uid, artistId: "netto", artistName: "Netto Brito", status: "pending", round: 1, proposedName: "Fã-clube", ...fields });
}

function club(id, fields) {
  firestore.set(`fanClubs/${id}`, { artistId: "netto", artistName: "Netto Brito", ownerUid: `dono-${id}`, name: `Clube ${id}`, status: "active", ...fields });
}

test("as pendentes, da mais antiga, na forma dos índices de status e de central", async () => {
  firestore.reset();
  application("a", { submittedAt: ts("2026-10-19T10:00:00") });
  application("b", { submittedAt: ts("2026-10-18T10:00:00") });
  application("c", { artistId: "nenho", submittedAt: ts("2026-10-17T10:00:00") });
  application("d", { status: "rejected", submittedAt: ts("2026-10-16T10:00:00"), decidedAt: ts("2026-10-19T09:00:00") });

  const all = await data.getPendingApplicationsPage(null, null);
  assert.deepEqual(
    all.items.map((item) => item.uid),
    ["c", "b", "a"],
  );
  assert.deepEqual(firestore.queries.at(-1), {
    source: { collection: "fanClubApplications" },
    where: [{ field: "status", op: "==", value: "pending" }],
    orderBy: [{ field: "submittedAt", direction: "asc" }],
    startAfter: null,
    startAt: null,
    endAt: null,
    limit: 26,
  });
  assert.equal(await data.countPendingApplications(), 3);

  const one = await data.getPendingApplicationsPage(["netto"], null);
  assert.deepEqual(
    one.items.map((item) => item.uid),
    ["b", "a"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "artistId", op: "==", value: "netto" },
    { field: "status", op: "==", value: "pending" },
  ]);

  // "Centrais que eu cuido": o `in`, até 30.
  const mine = await data.getPendingApplicationsPage(["nenho", "netto"], null);
  assert.equal(mine.items.length, 3);
  assert.deepEqual(firestore.queries.at(-1).where[0], { field: "artistId", op: "in", value: ["nenho", "netto"] });
  const many = Array.from({ length: 35 }, (_, index) => `central${index}`);
  await data.getPendingApplicationsPage(many, null);
  assert.equal(firestore.queries.at(-1).where[0].value.length, data.ARTIST_FILTER_MAX);
  assert.equal(await data.countPendingApplications(["nenho"]), 1);

  // Nenhuma central cuidada: nada é consultado.
  const before = firestore.queries.length;
  assert.deepEqual(await data.getPendingApplicationsPage([], null), { items: [], cursor: null, hasMore: false });
  assert.equal(await data.countPendingApplications([]), 0);
  assert.equal(firestore.queries.length, before);
});

test("as resolvidas de um status, da decisão mais nova, com o Carregar mais", async () => {
  firestore.reset();
  for (let index = 0; index < 27; index += 1) {
    application(`r${String(index).padStart(2, "0")}`, { status: "rejected", decidedAt: Timestamp.fromMillis(1_000_000 + index), rejectReason: "rules" });
  }
  application("ok", { status: "approved", decidedAt: ts("2026-10-19T10:00:00"), clubId: "club1" });

  const first = await data.getResolvedApplicationsPage("rejected", null);
  assert.equal(first.items.length, 25);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].uid, "r26");
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "status", op: "==", value: "rejected" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "decidedAt", direction: "desc" }]);
  const second = await data.getResolvedApplicationsPage("rejected", first.cursor);
  assert.deepEqual(
    second.items.map((item) => item.uid),
    ["r01", "r00"],
  );
  assert.equal(second.hasMore, false);

  const approved = await data.getResolvedApplicationsPage("approved", null);
  assert.deepEqual(
    approved.items.map((item) => [item.uid, item.clubId]),
    [["ok", "club1"]],
  );
});

test("a candidatura, o privado e o contato do fã, lidos do servidor pelo caminho", async () => {
  firestore.reset();
  application("uidCamila", { submittedAt: ts("2026-10-19T10:00:00") });
  firestore.set("fanClubApplicationPrivate/uidCamila", { instagram: "camila", tiktok: null, pitch: "Divulgo no Instagram e no grupo do bairro." });
  firestore.set("users/uidCamila/contact/main", { whatsapp: "+5575991234567", source: "fanclub" });

  const found = await data.getApplication("uidCamila");
  assert.equal(found.proposedName, "Fã-clube");
  assert.equal(await data.getApplication("ninguem"), null);
  const privateDoc = await data.getApplicationPrivate("uidCamila");
  assert.deepEqual(
    privateDoc.socials.map((social) => social.href),
    ["https://www.instagram.com/camila/"],
  );
  assert.equal(await data.getApplicationPrivate("ninguem"), null);
  assert.equal(await data.getContactWhatsapp("uidCamila"), "+5575991234567");
  assert.equal(await data.getContactWhatsapp("ninguem"), null);
  assert.deepEqual(firestore.reads.slice(-6), [
    "fanClubApplications/uidCamila",
    "fanClubApplications/ninguem",
    "fanClubApplicationPrivate/uidCamila",
    "fanClubApplicationPrivate/ninguem",
    "users/uidCamila/contact/main",
    "users/ninguem/contact/main",
  ]);

  // Sem rede, a ficha falha com "Sem conexão" em vez de mostrar o cache.
  firestore.setOffline(true);
  await assert.rejects(data.getApplication("uidCamila"), (error) => error.code === "unavailable");
  firestore.setOffline(false);
});

test("as centrais que a pessoa cuida, pelo gestor do privado", async () => {
  firestore.reset();
  firestore.set("artistPrivate/netto", { managerUid: "staff1" });
  firestore.set("artistPrivate/nenho", { managerUid: "staff1" });
  firestore.set("artistPrivate/trio", { managerUid: "staff2" });
  assert.deepEqual(await data.getManagedArtistIds("staff1"), ["nenho", "netto"]);
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "managerUid", op: "==", value: "staff1" }]);
});

test("os fã-clubes de um status, da aprovação mais nova, com a central opcional", async () => {
  firestore.reset();
  club("c1", { approvedAt: ts("2026-10-17T10:00:00") });
  club("c2", { approvedAt: ts("2026-10-19T10:00:00") });
  club("c3", { approvedAt: ts("2026-10-18T10:00:00"), artistId: "nenho" });
  club("c4", { approvedAt: ts("2026-10-16T10:00:00"), status: "paused", statusReason: "staff" });

  const active = await data.getFanClubsPage({ status: "active", artistId: "" }, null);
  assert.deepEqual(
    active.items.map((item) => item.id),
    ["c2", "c3", "c1"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "status", op: "==", value: "active" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "approvedAt", direction: "desc" }]);

  const netto = await data.getFanClubsPage({ status: "active", artistId: "netto" }, null);
  assert.deepEqual(
    netto.items.map((item) => item.id),
    ["c2", "c1"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "artistId", op: "==", value: "netto" },
    { field: "status", op: "==", value: "active" },
  ]);
  assert.equal(await data.countFanClubs({ status: "paused", artistId: "" }), 1);

  const found = await data.getFanClub("c4");
  assert.equal(found.statusReason, "staff");
  assert.equal(await data.getFanClub("nenhum"), null);
  assert.equal(firestore.reads.at(-1), "fanClubs/nenhum");
});
