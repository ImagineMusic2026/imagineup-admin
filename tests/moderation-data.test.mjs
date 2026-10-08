import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const data = await import("@/lib/moderation-data");

const sp = (local) => Date.parse(`${local}-03:00`);
const ts = (local) => Timestamp.fromMillis(sp(local));

function item(id, fields) {
  firestore.set(`moderationQueue/${id}`, { commentId: id, postId: "p1", authorUid: "u1", status: "open", ...fields });
}

test("a fila por denúncia mais nova, os resolvidos por decisão e a contagem", async () => {
  firestore.reset();
  item("a", { lastReportedAt: ts("2026-10-08T01:00:00") });
  item("b", { lastReportedAt: ts("2026-10-08T03:00:00") });
  item("c", { status: "resolved", resolution: "kept", lastReportedAt: ts("2026-10-07T01:00:00"), resolvedAt: ts("2026-10-08T02:00:00") });

  const open = await data.getQueuePage("open", null);
  assert.deepEqual(
    open.items.map((entry) => entry.commentId),
    ["b", "a"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "status", op: "==", value: "open" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "lastReportedAt", direction: "desc" }]);
  assert.equal(firestore.queries.at(-1).limit, 26);

  const resolved = await data.getQueuePage("resolved", null);
  assert.deepEqual(
    resolved.items.map((entry) => entry.commentId),
    ["c"],
  );
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "resolvedAt", direction: "desc" }]);
  assert.equal(await data.countOpenQueue(), 2);

  const fan = await data.getFanQueuePage("u1", null);
  assert.equal(fan.items.length, 3);
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "authorUid", op: "==", value: "u1" }]);
});

test("os ocultos pelo grupo de comentários e os suspensos pelos perfis", async () => {
  firestore.reset();
  firestore.set("posts/p1/postComments/c1", { postId: "p1", authorUid: "u1", text: "A", status: "hidden", hiddenAt: ts("2026-10-08T01:00:00") });
  firestore.set("posts/p2/postComments/c2", { postId: "p2", authorUid: "u1", text: "B", status: "hidden", hiddenAt: ts("2026-10-08T02:00:00") });
  firestore.set("posts/p2/postComments/c3", { postId: "p2", authorUid: "u1", text: "C", status: "visible" });
  const hidden = await data.getHiddenCommentsPage(null);
  assert.deepEqual(
    hidden.items.map((comment) => [comment.postId, comment.commentId]),
    [
      ["p2", "c2"],
      ["p1", "c1"],
    ],
  );
  assert.deepEqual(firestore.queries.at(-1).source, { group: "postComments" });
  assert.equal(await data.countVisibleComments("u1"), 1);

  firestore.set("users/u1", { displayName: "Renata", suspendedAt: ts("2026-10-07T22:46:00"), suspensionReason: "other" });
  firestore.set("users/u2", { displayName: "Camila" });
  const suspended = await data.getSuspendedPage(null);
  assert.deepEqual(
    suspended.items.map((fan) => [fan.uid, fan.suspensionReason]),
    [["u1", "other"]],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "suspendedAt", op: "!=", value: null }]);
});

test("o leitor guarda o comentário e o post enquanto a tela está aberta", async () => {
  firestore.reset();
  firestore.set("posts/p1", { artistId: "nenho", text: "Sábado tem show em Aracaju! Quem vem?" });
  firestore.set("posts/p1/postComments/c1", { authorName: "Enzo", text: "Promoção", status: "visible" });
  const reader = data.createContentReader();
  const first = await reader.comment("p1", "c1");
  await reader.comment("p1", "c1");
  assert.equal(first.authorName, "Enzo");
  assert.equal(firestore.reads.filter((path) => path === "posts/p1/postComments/c1").length, 1);
  reader.forget("p1", "c1");
  await reader.comment("p1", "c1");
  assert.equal(firestore.reads.filter((path) => path === "posts/p1/postComments/c1").length, 2);
  assert.deepEqual(await reader.post("p1"), { postId: "p1", artistId: "nenho", snippet: "Sábado tem show em Aracaju! Quem vem?" });
  assert.equal(await reader.post("sumiu"), null);
  assert.equal(await reader.comment("p1", "sumiu"), null);
});
