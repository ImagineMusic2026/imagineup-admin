import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// O Firestore de verdade fica de fora: as escutas e leituras viram dublês que
// anotam o caminho e deixam o teste mandar as respostas.
const fakeDb = { name: "firestore-de-teste" };
const listeners = [];
const stored = new Map();

function snapshotOf(docs) {
  return { docs: Object.entries(docs).map(([id, data]) => ({ id, data: () => data })) };
}

mock.module("firebase/firestore", {
  namedExports: {
    collection: (instance, path) => ({ instance, path }),
    doc: (instance, collectionPath, id) => ({ instance, path: `${collectionPath}/${id}` }),
    onSnapshot: (ref, next, error) => {
      const listener = { path: ref.path, next, error, active: true };
      listeners.push(listener);
      return () => {
        listener.active = false;
      };
    },
    getDoc: async (ref) => {
      const data = stored.get(ref.path);
      return { id: ref.path.split("/").pop(), exists: () => data !== undefined, data: () => data };
    },
  },
});

mock.module("@/lib/firebase", {
  namedExports: { db: () => fakeDb },
});

const { getArtistPrivate, subscribeToArtists } = await import("@/lib/artist-data");

const PUBLIC = {
  netto: { handle: "netto", name: "Netto Brito", status: "published", order: 1, managerName: "vazou" },
  trio: { handle: "trio", name: "Trio Bem Bahia", status: "draft", order: 0 },
};
const PRIVATE = {
  netto: { managerUid: "uid-1", managerName: "Iara Costa", imageRightsConfirmed: true, createdBy: "uid-1", updatedBy: "uid-1" },
};

function listenerFor(path) {
  const found = listeners.filter((listener) => listener.path === path);
  assert.equal(found.length, 1, path);
  return found[0];
}

test("escuta artists e artistPrivate e junta pelo id; a lista sai antes do privado chegar", () => {
  listeners.length = 0;
  const lists = [];
  const errors = [];
  const stop = subscribeToArtists(
    (entries) => lists.push(entries),
    (error) => errors.push(error),
  );
  assert.deepEqual(listeners.map((listener) => listener.path).sort(), ["artistPrivate", "artists"]);

  listenerFor("artists").next(snapshotOf(PUBLIC));
  assert.equal(lists.length, 1);
  // Na ordem de destaque, e sem privado ainda.
  assert.deepEqual(lists[0].map((entry) => [entry.id, entry.internal]), [
    ["trio", null],
    ["netto", null],
  ]);
  // O gestor esquecido no público não vale.
  assert.equal("managerName" in lists[0][1], false);

  listenerFor("artistPrivate").next(snapshotOf(PRIVATE));
  assert.equal(lists.length, 2);
  assert.equal(lists[1][1].internal.managerName, "Iara Costa");
  assert.equal(lists[1][1].internal.imageRightsConfirmed, true);
  assert.equal(lists[1][0].internal, null);

  stop();
  assert.ok(listeners.every((listener) => !listener.active));
  assert.equal(errors.length, 0);
});

test("se uma das escutas falha, as duas param e o erro sobe uma vez", () => {
  listeners.length = 0;
  const lists = [];
  const errors = [];
  const stop = subscribeToArtists(
    (entries) => lists.push(entries),
    (error) => errors.push(error),
  );
  listenerFor("artists").next(snapshotOf(PUBLIC));

  const denied = { code: "permission-denied" };
  listenerFor("artistPrivate").error(denied);
  assert.deepEqual(errors, [denied]);
  assert.ok(listeners.every((listener) => !listener.active));

  // Nada mais chega à tela depois do erro, nem um segundo erro.
  listenerFor("artists").next(snapshotOf(PUBLIC));
  listenerFor("artists").error(denied);
  assert.equal(lists.length, 1);
  assert.equal(errors.length, 1);
  stop();
});

test("privado lido uma vez em artistPrivate/{id}; sem documento, null", async () => {
  stored.clear();
  stored.set("artistPrivate/netto", PRIVATE.netto);
  stored.set("artistContacts/trio", { email: "velho@trio.com" });
  const found = await getArtistPrivate("netto");
  assert.equal(found.managerName, "Iara Costa");
  assert.equal(found.createdBy, "uid-1");
  assert.equal(await getArtistPrivate("trio"), null);
});
