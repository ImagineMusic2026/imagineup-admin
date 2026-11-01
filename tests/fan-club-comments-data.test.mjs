import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

// As leituras da Fase 2 do fã-clube (37.4): a fila dos comentários, os
// comentários pelo id em lotes de 30, os de uma publicação, o registro do
// ocultar do gestor, as contagens do "Aguardando a equipe" e da Moderação, e
// o mapa `days` dos shards. Cada consulta na forma de um índice de 37.4 (o
// emulador não cobra índice), e nunca as coleções fechadas de quem reagiu e
// de quem denunciou.

const firestore = installFirestoreFake();
const data = await import("@/lib/fan-club-data");
const moderation = await import("@/lib/moderation-data");

const ts = (local) => Timestamp.fromMillis(Date.parse(`${local}-03:00`));

function queueItem(id, fields) {
  firestore.set(`fanClubCommentQueue/${id}`, { commentId: id, postId: "p1", clubId: "club1", artistId: "netto", authorUid: "u1", kind: "report", reportCount: 1, status: "open", round: 1, ...fields });
}

function fanComment(id, fields) {
  firestore.set(`fanClubComments/${id}`, { clubId: "club1", postId: "p1", artistId: "netto", authorUid: "u1", text: "oi", replyToId: null, status: "visible", ...fields });
}

test("a fila: os abertos da última atividade e os resolvidos da decisão mais nova, com as contagens por tipo", async () => {
  firestore.reset();
  queueItem("a", { lastActivityAt: ts("2026-10-27T09:00:00") });
  queueItem("b", { kind: "review", reportCount: 0, lastActivityAt: ts("2026-10-27T10:00:00") });
  queueItem("c", { reviewRequested: true, lastActivityAt: ts("2026-10-26T10:00:00") });
  queueItem("d", { status: "resolved", resolution: "kept", resolvedAt: ts("2026-10-25T10:00:00"), lastActivityAt: ts("2026-10-25T09:00:00") });

  const open = await data.getCommentQueuePage("open", null);
  assert.deepEqual(
    open.items.map((item) => item.commentId),
    ["b", "a", "c"],
  );
  assert.deepEqual(firestore.queries.at(-1), {
    source: { collection: "fanClubCommentQueue" },
    where: [{ field: "status", op: "==", value: "open" }],
    orderBy: [{ field: "lastActivityAt", direction: "desc" }],
    startAfter: null,
    startAt: null,
    endAt: null,
    limit: 26,
  });

  const resolved = await data.getCommentQueuePage("resolved", null);
  assert.deepEqual(
    resolved.items.map((item) => [item.commentId, item.resolution]),
    [["d", "kept"]],
  );
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "resolvedAt", direction: "desc" }]);

  // O aberto por denúncia que recebeu o pedido continua denúncia.
  assert.equal(await data.countOpenCommentItems("report"), 2);
  assert.equal(await data.countOpenCommentItems("review"), 1);
  assert.deepEqual(firestore.counts.at(-1).where, [
    { field: "status", op: "==", value: "open" },
    { field: "kind", op: "==", value: "review" },
  ]);
  assert.deepEqual(await data.countWaiting(), { applications: 0, posts: 0, reports: 0, commentReports: 2, commentReviews: 1 });
});

test("os comentários pelo id, um in pelo documentId a cada 30, com o apagado como null", async () => {
  firestore.reset();
  const ids = Array.from({ length: 31 }, (_, index) => `c${String(index).padStart(2, "0")}`);
  for (const id of ids.slice(0, 30)) fanComment(id, {});
  fanComment("outro", {});
  const found = await data.getCommentsByIds([...ids, "c00", ""]);
  assert.equal(found.size, 31);
  assert.equal(found.get("c00").id, "c00");
  assert.equal(found.get("c30"), null);
  assert.equal(found.has("outro"), false);
  const shapes = firestore.queries.slice(-2);
  assert.deepEqual(
    shapes.map((shape) => [shape.source.collection, shape.where[0].field, shape.where[0].op, shape.where[0].value.length]),
    [
      ["fanClubComments", "__id__", "in", 30],
      ["fanClubComments", "__id__", "in", 1],
    ],
  );
  const before = firestore.queries.length;
  assert.equal((await data.getCommentsByIds([])).size, 0);
  assert.equal(firestore.queries.length, before);
});

test("os comentários de uma publicação em todos os status, do mais novo, com o Carregar mais", async () => {
  firestore.reset();
  for (let index = 0; index < 26; index += 1) fanComment(`x${String(index).padStart(2, "0")}`, { createdAt: Timestamp.fromMillis(1_000_000 + index), status: index % 3 === 0 ? "manager_hidden" : "visible" });
  fanComment("outra", { postId: "p2", createdAt: ts("2026-10-27T10:00:00") });
  const first = await data.getPostCommentsPage("p1", null);
  assert.equal(first.items.length, 25);
  assert.equal(first.items[0].id, "x25");
  assert.equal(first.hasMore, true);
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "postId", op: "==", value: "p1" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "createdAt", direction: "desc" }]);
  const second = await data.getPostCommentsPage("p1", first.cursor);
  assert.deepEqual(
    second.items.map((item) => item.id),
    ["x00"],
  );
});

test("o registro do ocultar do gestor, da linha mais nova, e quantas vezes ele ocultou", async () => {
  firestore.reset();
  firestore.set("fanClubHideLog/h1", { clubId: "club1", postId: "p2", commentId: "cm1", authorUid: "u1", managerUid: "uidCamila", action: "hidden", at: ts("2026-10-26T10:00:00") });
  firestore.set("fanClubHideLog/h2", { clubId: "club1", postId: "p2", commentId: "cm1", authorUid: "u1", managerUid: "uidCamila", action: "restored", at: ts("2026-10-27T10:00:00") });
  firestore.set("fanClubHideLog/h3", { clubId: "club2", postId: "p9", commentId: "cm9", authorUid: null, managerUid: "uidOutro", action: "hidden", at: ts("2026-10-27T11:00:00") });
  const page = await data.getHideLogPage("club1", null);
  assert.deepEqual(
    page.items.map((entry) => [entry.id, entry.action]),
    [
      ["h2", "restored"],
      ["h1", "hidden"],
    ],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "clubId", op: "==", value: "club1" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "at", direction: "desc" }]);
  assert.equal(await data.countManagerHides("club1"), 1);
  assert.deepEqual(firestore.counts.at(-1).where, [
    { field: "clubId", op: "==", value: "club1" },
    { field: "action", op: "==", value: "hidden" },
  ]);
});

test("os shards trazem o mapa days somado entre eles, sem derrubar com o dia estranho", async () => {
  firestore.reset();
  firestore.set("fanClubStats/c1/fanClubShards/0", { links: 1, days: { "2026-10-27": { reactions: 2, comments: 1 }, "2026-10-26": "lixo" } });
  firestore.set("fanClubStats/c1/fanClubShards/9", { days: { "2026-10-27": { reactions: 1, comments: 5.7 }, "2026-10-20": { comments: 2 } } });
  firestore.set("fanClubStats/c1/fanClubShards/15", { days: "lixo" });
  const numbers = await data.getShardNumbers("c1");
  assert.deepEqual(numbers.days, {
    "2026-10-27": { reactions: 3, comments: 6 },
    "2026-10-20": { reactions: 0, comments: 2 },
  });
  assert.equal(numbers.links, 1);
});

test("a Moderação conta também os comentários do fã nos fã-clubes, os visíveis e os ocultos pelo gestor", async () => {
  firestore.reset();
  firestore.set("posts/p1/postComments/m1", { authorUid: "u1", status: "visible" });
  firestore.set("posts/p1/postComments/m2", { authorUid: "u1", status: "hidden" });
  fanComment("f1", { authorUid: "u1", status: "visible" });
  fanComment("f2", { authorUid: "u1", status: "manager_hidden" });
  fanComment("f3", { authorUid: "u1", status: "staff_hidden" });
  fanComment("f4", { authorUid: "u2", status: "visible" });
  assert.equal(await moderation.countVisibleComments("u1"), 3);
  const shapes = firestore.counts.slice(-2);
  assert.deepEqual(shapes[0].source, { group: "postComments" });
  assert.deepEqual(shapes[1], {
    source: { collection: "fanClubComments" },
    where: [
      { field: "authorUid", op: "==", value: "u1" },
      { field: "status", op: "in", value: ["visible", "manager_hidden"] },
    ],
    orderBy: [],
    startAfter: null,
    startAt: null,
    endAt: null,
    limit: null,
  });
});

test("nenhuma leitura toca quem reagiu nem quem denunciou", async () => {
  const touched = [...firestore.queries, ...firestore.counts].map((shape) => shape.source.collection ?? shape.source.group);
  assert.equal(touched.includes("fanClubReactions"), false);
  assert.equal(touched.includes("fanClubCommentReports"), false);
});
