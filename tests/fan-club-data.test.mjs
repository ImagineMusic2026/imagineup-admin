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

  const active = await data.getFanClubsPage({ featured: false, status: "active", artistId: "", order: "approved" }, null);
  assert.deepEqual(
    active.items.map((item) => item.id),
    ["c2", "c3", "c1"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "status", op: "==", value: "active" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "approvedAt", direction: "desc" }]);

  const netto = await data.getFanClubsPage({ featured: false, status: "active", artistId: "netto", order: "approved" }, null);
  assert.deepEqual(
    netto.items.map((item) => item.id),
    ["c2", "c1"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "artistId", op: "==", value: "netto" },
    { field: "status", op: "==", value: "active" },
  ]);
  assert.equal(await data.countFanClubs({ featured: false, status: "paused", artistId: "", order: "approved" }), 1);

  const found = await data.getFanClub("c4");
  assert.equal(found.statusReason, "staff");
  assert.equal(await data.getFanClub("nenhum"), null);
  assert.equal(firestore.reads.at(-1), "fanClubs/nenhum");
});

// ---------------------------------------------------------------------------
// O Painel B: a lista pelos números, os shards, os seguidores, as publicações,
// as denúncias, o registro dos reconhecimentos e os pedidos de prêmio.
// ---------------------------------------------------------------------------

test("a lista pelos seguidores ou pelos novos em 30 dias, e os destacados pelo fim do Destaque", async () => {
  firestore.reset();
  club("c1", { counts: { followers: 5, followers30d: 1, at: null }, featured: true, featuredUntil: "2026-11-10" });
  club("c2", { counts: { followers: 9, followers30d: 0, at: null } });
  club("c3", { counts: { followers: 2, followers30d: 7, at: null }, featured: true, featuredUntil: "2026-10-25" });

  const byFollowers = await data.getFanClubsPage({ featured: false, status: "active", artistId: "", order: "followers" }, null);
  assert.deepEqual(byFollowers.items.map((item) => item.id), ["c2", "c1", "c3"]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "counts.followers", direction: "desc" }]);
  assert.equal(byFollowers.items[0].counts.followers, 9);

  const byNew = await data.getFanClubsPage({ featured: false, status: "active", artistId: "netto", order: "followers30d" }, null);
  assert.deepEqual(byNew.items.map((item) => item.id), ["c3", "c1", "c2"]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "counts.followers30d", direction: "desc" }]);

  // Os destacados: o índice `featured, featuredUntil`, sem o status nem a central.
  const featured = await data.getFanClubsPage({ featured: true }, null);
  assert.deepEqual(featured.items.map((item) => item.id), ["c3", "c1"]);
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "featured", op: "==", value: true }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "featuredUntil", direction: "asc" }]);
  assert.equal(await data.countFanClubs({ featured: true }), 2);
});

test("os números de agora somam os 16 shards, campo a campo e nunca negativos", async () => {
  firestore.reset();
  firestore.set("fanClubStats/c1/fanClubShards/0", { links: 1, visits: 2, signups: 1, joins: 1 });
  firestore.set("fanClubStats/c1/fanClubShards/7", { links: 2, visits: "x", signups: 1.9, joins: 0 });
  firestore.set("fanClubStats/c1/fanClubShards/15", { visits: 3, joins: -5 });
  firestore.set("fanClubStats/c2/fanClubShards/0", { links: 99 });
  assert.deepEqual(await data.getShardNumbers("c1"), { links: 3, visits: 5, signups: 2, joins: 0 });
  assert.deepEqual(firestore.queries.at(-1).source, { collection: "fanClubStats/c1/fanClubShards" });
  assert.deepEqual(await data.getShardNumbers("vazio"), { links: 0, visits: 0, signups: 0, joins: 0 });
});

test("os seguidores recentes, pela consulta de grupo, do mais novo", async () => {
  firestore.reset();
  firestore.set("users/u1/fanClubFollows/c1", { uid: "u1", clubId: "c1", followedAt: ts("2026-10-18T10:00:00"), newAccount: true, chosenUsername: false, byOwnerCode: false });
  firestore.set("users/u2/fanClubFollows/c1", { uid: "u2", clubId: "c1", followedAt: ts("2026-10-19T10:00:00"), newAccount: false, chosenUsername: true, byOwnerCode: true });
  firestore.set("users/u2/fanClubFollows/c2", { uid: "u2", clubId: "c2", followedAt: ts("2026-10-20T10:00:00") });
  const page = await data.getRecentFollowersPage("c1", null);
  assert.deepEqual(
    page.items.map((item) => [item.uid, item.byOwnerCode]),
    [
      ["u2", true],
      ["u1", false],
    ],
  );
  assert.deepEqual(firestore.queries.at(-1), {
    source: { group: "fanClubFollows" },
    where: [{ field: "clubId", op: "==", value: "c1" }],
    orderBy: [{ field: "followedAt", direction: "desc" }],
    startAfter: null,
    startAt: null,
    endAt: null,
    limit: 26,
  });
});

test("as publicações: as do fã-clube em todos os status, a fila de revisão da mais antiga, e as citadas pelo id", async () => {
  firestore.reset();
  const post = (id, fields) => firestore.set(`fanClubPosts/${id}`, { clubId: "c1", artistId: "netto", authorUid: "u1", text: id, status: "pending", ...fields });
  post("p1", { submittedAt: ts("2026-10-17T10:00:00"), status: "published" });
  post("p2", { submittedAt: ts("2026-10-19T10:00:00") });
  post("p3", { submittedAt: ts("2026-10-18T10:00:00"), clubId: "c2" });
  post("p4", { submittedAt: ts("2026-10-16T10:00:00"), status: "hidden" });

  const ofClub = await data.getClubPostsPage("c1", null);
  assert.deepEqual(ofClub.items.map((item) => item.id), ["p2", "p1", "p4"]);
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "clubId", op: "==", value: "c1" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "submittedAt", direction: "desc" }]);

  const pending = await data.getPendingPostsPage(null);
  assert.deepEqual(pending.items.map((item) => item.id), ["p3", "p2"]);
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "status", op: "==", value: "pending" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "submittedAt", direction: "asc" }]);
  assert.equal(await data.countPendingPosts(), 2);

  const byId = await data.getPostsByIds(["p4", "p4", "sumiu"]);
  assert.equal(byId.get("p4").status, "hidden");
  assert.equal(byId.get("sumiu"), null);
  assert.equal(byId.size, 2);
  const clubs = await data.getFanClubsByIds(["c1", "c1", ""]);
  assert.deepEqual([...clubs.keys()], ["c1"]);
});

test("a caixa das fotos dos fãs de cada central, pelo privado, com a autorização de imagem na falta", async () => {
  firestore.reset();
  firestore.set("artistPrivate/aberta", { imageRightsConfirmed: true, fanClubs: { photosAllowed: true } });
  firestore.set("artistPrivate/nunca-mexida", { imageRightsConfirmed: true });
  firestore.set("artistPrivate/desligada", { imageRightsConfirmed: true, fanClubs: { photosAllowed: false } });
  firestore.set("artistPrivate/sem-autorizacao", { imageRightsConfirmed: false, fanClubs: { photosAllowed: true } });

  const boxes = await data.getPhotoBoxes(["aberta", "nunca-mexida", "desligada", "sem-autorizacao", "sumiu", "aberta", ""]);
  assert.deepEqual(Object.fromEntries(boxes), { aberta: true, "nunca-mexida": true, desligada: false, "sem-autorizacao": false, sumiu: false });
});

test("as denúncias abertas da mais nova, as resolvidas da decisão mais nova, e as aceitas de um fã-clube", async () => {
  firestore.reset();
  const item = (id, fields) => firestore.set(`fanClubReportQueue/${id}`, { clubId: "c1", artistId: "netto", authorUid: "u1", reportCount: 1, round: 1, status: "open", ...fields });
  item("p1", { lastReportedAt: ts("2026-10-18T10:00:00") });
  item("p2", { lastReportedAt: ts("2026-10-19T10:00:00") });
  item("p3", { status: "resolved", resolution: "actioned", resolvedAt: ts("2026-10-15T10:00:00") });
  item("p4", { status: "resolved", resolution: "actioned", resolvedAt: ts("2026-08-01T10:00:00") });
  item("p5", { status: "resolved", resolution: "kept", resolvedAt: ts("2026-10-16T10:00:00"), clubId: "c2" });

  const open = await data.getReportsPage("open", null);
  assert.deepEqual(open.items.map((report) => report.postId), ["p2", "p1"]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "lastReportedAt", direction: "desc" }]);
  const resolved = await data.getReportsPage("resolved", null);
  assert.deepEqual(resolved.items.map((report) => report.postId), ["p5", "p3", "p4"]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "resolvedAt", direction: "desc" }]);
  assert.equal(await data.countOpenReports(), 2);

  // As aceitas (Ocultar) dos últimos 30 dias, só por igualdades: a data é conferida aqui.
  const since = Date.parse("2026-09-20T15:00:00-03:00");
  assert.equal(await data.countActionedReports("c1", since), 1);
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "clubId", op: "==", value: "c1" },
    { field: "resolution", op: "==", value: "actioned" },
  ]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, []);

  application("a1", { submittedAt: ts("2026-10-19T10:00:00") });
  firestore.set("fanClubPosts/x1", { status: "pending" });
  assert.deepEqual(await data.countWaiting(), { applications: 1, posts: 1, reports: 2 });
});

test("o registro dos reconhecimentos pela data e os pedidos de prêmio pelo grantId, 30 por consulta", async () => {
  firestore.reset();
  firestore.set("fanClubs/c1/prizes/g1", { points: 200, prize: null, note: "a", at: ts("2026-10-17T10:00:00") });
  firestore.set("fanClubs/c1/prizes/g2", { points: null, prize: { rewardId: "r1", rewardTitle: "Ingresso", rewardKind: "ticket", delivered: true }, note: "b", at: ts("2026-10-19T10:00:00") });
  const page = await data.getPrizesPage("c1", null);
  assert.deepEqual(page.items.map((item) => item.grantId), ["g2", "g1"]);
  assert.deepEqual(firestore.queries.at(-1).source, { collection: "fanClubs/c1/prizes" });
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "at", direction: "desc" }]);

  const grants = Array.from({ length: 35 }, (_, index) => `g${index}`);
  firestore.set("redemptions/UP-AAAAAA", { grantId: "g2", status: "delivered", rewardId: "r1", origin: "prize" });
  firestore.set("redemptions/UP-BBBBBB", { grantId: "g33", status: "approved", rewardId: "r1", origin: "prize" });
  firestore.set("redemptions/UP-CCCCCC", { status: "requested", rewardId: "r2" });
  const before = firestore.queries.length;
  const orders = await data.getPrizeOrders([...grants, "g2"]);
  assert.equal(firestore.queries.length - before, 2);
  assert.equal(firestore.queries.at(-2).where[0].value.length, 30);
  assert.equal(firestore.queries.at(-1).where[0].value.length, 5);
  assert.deepEqual(
    [...orders.entries()].map(([grantId, order]) => [grantId, order.code, order.status]).sort(),
    [
      ["g2", "UP-AAAAAA", "delivered"],
      ["g33", "UP-BBBBBB", "approved"],
    ],
  );
  assert.equal((await data.getPrizeOrders([])).size, 0);
});

test("o checklist lê o perfil e o vínculo do gestor pelo caminho, cada um com a seção que a regra pede", async () => {
  firestore.reset();
  firestore.set("users/u1", { suspendedAt: ts("2026-10-01T10:00:00") });
  firestore.set("users/u2/centrals/netto", { artistId: "netto" });
  firestore.set("users/u2", { suspendedAt: null });
  assert.deepEqual(await data.getOwnerChecks("u1", "netto", { profile: true, central: true }), { suspended: true, member: false });
  assert.deepEqual(await data.getOwnerChecks("u2", "netto", { profile: true, central: true }), { suspended: false, member: true });
  assert.deepEqual(firestore.reads.slice(-2), ["users/u2", "users/u2/centrals/netto"]);
  // Só com a Moderação: a suspensão sim, o vínculo com a central não (a regra dele pede a seção Fãs).
  const before = firestore.reads.length;
  assert.deepEqual(await data.getOwnerChecks("u1", "netto", { profile: true, central: false }), { suspended: true, member: null });
  assert.deepEqual(firestore.reads.slice(before), ["users/u1"]);
});
