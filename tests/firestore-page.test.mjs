import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const { collection, orderBy, query, where } = firestore.api;
const { countOf, getPage } = await import("@/lib/firestore-page");

test("páginas por cursor: um documento a mais diz se há outra página", async () => {
  firestore.reset();
  for (let index = 1; index <= 5; index += 1) {
    firestore.set(`redemptions/UP-${index}`, { status: index === 3 ? "refused" : "requested", requestedAt: index });
  }
  const base = query(collection(firestore.db, "redemptions"), where("status", "==", "requested"), orderBy("requestedAt", "desc"));

  const first = await getPage(base, { size: 2 });
  assert.deepEqual(
    first.docs.map((doc) => doc.id),
    ["UP-5", "UP-4"],
  );
  assert.equal(first.hasMore, true);
  assert.equal(firestore.queries.at(-1).limit, 3);

  const second = await getPage(base, { size: 2, after: first.cursor });
  assert.deepEqual(
    second.docs.map((doc) => doc.id),
    ["UP-2", "UP-1"],
  );
  assert.equal(second.hasMore, false);
  assert.equal(firestore.queries.at(-1).startAfter, "UP-4");

  const empty = await getPage(base, { size: 2, after: second.cursor });
  assert.equal(empty.docs.length, 0);
  assert.equal(empty.cursor, second.cursor);
  assert.equal(empty.hasMore, false);
});

test("count() pela consulta inteira, sem limite nem cursor", async () => {
  firestore.reset();
  firestore.set("users/a", { suspendedAt: 1 });
  firestore.set("users/b", {});
  firestore.set("users/c", { suspendedAt: 2 });
  assert.equal(await countOf(collection(firestore.db, "users")), 3);
  assert.equal(await countOf(query(collection(firestore.db, "users"), where("suspendedAt", "!=", null))), 2);
  assert.equal(firestore.counts.length, 2);
});
