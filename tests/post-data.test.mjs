import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const posts = await import("@/lib/post-data");
const agenda = await import("@/lib/event-data");

const sp = (local) => Date.parse(`${local}-03:00`);
const ts = (local) => Timestamp.fromMillis(sp(local));
const NOW = sp("2026-10-08T15:00:00");

test("o mural: do mais novo, com a central e a situação pelos índices, e a contagem dos no ar", async () => {
  firestore.reset();
  firestore.set("posts/a", { artistId: "nenho", kind: "text", status: "published", createdAt: ts("2026-10-01T10:00:00") });
  firestore.set("posts/b", { artistId: "nenho", kind: "photo", status: "draft", createdAt: ts("2026-10-05T10:00:00") });
  firestore.set("posts/c", { artistId: "nettobrito", kind: "text", status: "published", createdAt: ts("2026-10-03T10:00:00") });

  const all = await posts.getPostsPage({ artistId: null, status: null }, null);
  assert.deepEqual(
    all.items.map((post) => post.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "createdAt", direction: "desc" }]);
  assert.equal(firestore.queries.at(-1).limit, 26);

  const filtered = await posts.getPostsPage({ artistId: "nenho", status: "published" }, null);
  assert.deepEqual(
    filtered.items.map((post) => post.id),
    ["a"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "artistId", op: "==", value: "nenho" },
    { field: "status", op: "==", value: "published" },
  ]);
  assert.equal(await posts.countPublishedPosts(null), 2);
  assert.equal(await posts.countPublishedPosts("nenho"), 1);
});

test("os comentários do post e os shows da central para o post de show", async () => {
  firestore.reset();
  firestore.set("posts/p1/postComments/c1", { postId: "p1", authorName: "Bia", text: "Lindo", status: "visible", createdAt: ts("2026-10-07T21:00:00") });
  firestore.set("posts/p1/postComments/c2", { postId: "p1", authorName: "Duda", text: "Demais", status: "hidden", createdAt: ts("2026-10-07T22:00:00") });
  const comments = await posts.getPostCommentsPage("p1", null);
  assert.deepEqual(
    comments.items.map((comment) => [comment.commentId, comment.status]),
    [
      ["c2", "hidden"],
      ["c1", "visible"],
    ],
  );
  assert.equal(firestore.queries.at(-1).limit, 21);

  firestore.set("events/ontem", { title: "Ontem", artistIds: ["nenho"], startsAt: ts("2026-10-07T22:00:00") });
  firestore.set("events/hoje", { title: "Hoje", artistIds: ["nenho"], startsAt: ts("2026-10-08T01:00:00"), status: "draft" });
  firestore.set("events/outro", { title: "Outro", artistIds: ["juninho"], startsAt: ts("2026-12-01T01:00:00") });
  const choices = await posts.getArtistEventChoices("nenho", NOW);
  assert.deepEqual(
    choices.map((event) => event.id),
    ["hoje"],
  );
  const cited = await posts.getEventsById(["hoje", "sumiu", "hoje"]);
  assert.equal(cited.get("hoje").title, "Hoje");
  assert.equal(cited.get("sumiu"), null);
});

test("a agenda: próximos do mais perto, passados do mais novo só com a central, e o detalhe", async () => {
  firestore.reset();
  firestore.set("events/passado", { title: "Passado", artistIds: ["nenho"], status: "published", startsAt: ts("2026-09-01T22:00:00") });
  firestore.set("events/perto", { title: "Perto", artistIds: ["nenho", "nettobrito"], status: "published", startsAt: ts("2026-10-10T22:00:00") });
  firestore.set("events/longe", { title: "Longe", artistIds: ["nettobrito"], status: "draft", startsAt: ts("2026-12-10T22:00:00") });

  const upcoming = await agenda.getEventsPage({ when: "upcoming", artistId: null, status: null }, NOW, null);
  assert.deepEqual(
    upcoming.items.map((event) => event.id),
    ["perto", "longe"],
  );
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "startsAt", direction: "asc" }]);

  const drafts = await agenda.getEventsPage({ when: "upcoming", artistId: "nettobrito", status: "draft" }, NOW, null);
  assert.deepEqual(
    drafts.items.map((event) => event.id),
    ["longe"],
  );
  assert.deepEqual(
    firestore.queries.at(-1).where.map((filter) => [filter.field, filter.op]),
    [
      ["artistIds", "array-contains"],
      ["status", "=="],
      ["startsAt", ">="],
    ],
  );

  const past = await agenda.getEventsPage({ when: "past", artistId: "nenho", status: "draft" }, NOW, null);
  assert.deepEqual(
    past.items.map((event) => event.id),
    ["passado"],
  );
  assert.deepEqual(
    firestore.queries.at(-1).where.map((filter) => filter.field),
    ["artistIds", "startsAt"],
  );
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "startsAt", direction: "desc" }]);
  assert.equal(await agenda.countUpcomingEvents(NOW, null), 2);
  assert.equal(await agenda.countUpcomingEvents(NOW, "nenho"), 1);

  firestore.set("posts/ps", { eventId: "perto", artistId: "nenho" });
  firestore.set("users/u1/eventRsvps/perto", { eventId: "perto", going: true });
  firestore.set("users/u2/eventRsvps/perto", { eventId: "perto", going: false });
  firestore.set("rewards/meet", { eventId: "perto", title: "Meet" });
  assert.deepEqual(await agenda.getEventDetail("perto", { fans: true, rewards: true }), { posts: 1, going: 1, rewards: [{ id: "meet", title: "Meet" }] });
  assert.deepEqual(await agenda.getEventDetail("perto", { fans: false, rewards: false }), { posts: 1, going: null, rewards: null });
});
