import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const data = await import("@/lib/support-data");

const sp = (local) => Date.parse(`${local}-03:00`);
const ts = (local) => Timestamp.fromMillis(sp(local));

function message(id, fields) {
  firestore.set(`supportMessages/${id}`, { uid: "u1", kind: "feedback", text: `Mensagem ${id}`, device: null, status: "open", resolvedAt: null, resolvedBy: null, schemaVersion: 1, ...fields });
}

test("as abertas da mais nova, as resolvidas pela resolução, e o filtro de tipo como mais um ==", async () => {
  firestore.reset();
  message("a", { createdAt: ts("2026-11-03T09:00:00") });
  message("b", { kind: "problem", createdAt: ts("2026-11-03T11:00:00"), device: { platform: "ios", osVersion: "18.1", appVersion: "0.1.0", updateId: null } });
  message("c", { kind: "idea", createdAt: ts("2026-11-03T10:00:00") });
  message("d", { status: "resolved", createdAt: ts("2026-11-02T08:00:00"), resolvedAt: ts("2026-11-03T12:00:00"), resolvedBy: { uid: "staff1", name: "Camila" } });
  message("e", { kind: "problem", status: "resolved", createdAt: ts("2026-11-03T07:00:00"), resolvedAt: ts("2026-11-03T08:00:00"), resolvedBy: { uid: "staff1", name: "Camila" } });

  const open = await data.getSupportPage("open", "all", null);
  assert.deepEqual(
    open.items.map((item) => item.id),
    ["b", "c", "a"],
  );
  assert.equal(open.hasMore, false);
  assert.deepEqual(firestore.queries.at(-1).source, { collection: "supportMessages" });
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "status", op: "==", value: "open" }]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "createdAt", direction: "desc" }]);
  // Páginas de 20: a consulta pede um a mais, para saber se há outra.
  assert.equal(firestore.queries.at(-1).limit, 21);
  assert.deepEqual(open.items[0].device, { platform: "ios", osVersion: "18.1", appVersion: "0.1.0", updateId: null });

  const problems = await data.getSupportPage("open", "problem", null);
  assert.deepEqual(
    problems.items.map((item) => item.id),
    ["b"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "status", op: "==", value: "open" },
    { field: "kind", op: "==", value: "problem" },
  ]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "createdAt", direction: "desc" }]);

  const resolved = await data.getSupportPage("resolved", "all", null);
  assert.deepEqual(
    resolved.items.map((item) => item.id),
    ["d", "e"],
  );
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "resolvedAt", direction: "desc" }]);
  assert.deepEqual(resolved.items[0].resolvedBy, { uid: "staff1", name: "Camila" });

  const resolvedProblems = await data.getSupportPage("resolved", "problem", null);
  assert.deepEqual(
    resolvedProblems.items.map((item) => item.id),
    ["e"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "status", op: "==", value: "resolved" },
    { field: "kind", op: "==", value: "problem" },
  ]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "resolvedAt", direction: "desc" }]);

  // A contagem do cabeçalho: só as abertas, de todos os tipos.
  assert.equal(await data.countOpenSupport(), 3);
  assert.deepEqual(firestore.counts.at(-1).where, [{ field: "status", op: "==", value: "open" }]);
});

test("o Carregar mais segue do cursor, 20 por vez", async () => {
  firestore.reset();
  for (let index = 0; index < 25; index += 1) {
    message(`m${String(index).padStart(2, "0")}`, { createdAt: Timestamp.fromMillis(sp("2026-11-01T00:00:00") + index * 60_000) });
  }
  const first = await data.getSupportPage("open", "all", null);
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].id, "m24");
  const second = await data.getSupportPage("open", "all", first.cursor);
  assert.deepEqual(
    second.items.map((item) => item.id),
    ["m04", "m03", "m02", "m01", "m00"],
  );
  assert.equal(second.hasMore, false);
  assert.equal(firestore.queries.at(-1).startAfter, "m05");
});

test("o perfil de quem mandou vem do servidor, um get por fã, e a conta que saiu é null", async () => {
  firestore.reset();
  firestore.set("users/u1", { displayName: "Renata Lima", username: "renata", photoURL: null });
  const reader = data.createSupportFanReader();
  const [renata, again, gone] = await Promise.all([reader.get("u1"), reader.get("u1"), reader.get("u9")]);
  assert.equal(renata.uid, "u1");
  assert.equal(renata.username, "renata");
  assert.equal(again, renata);
  assert.equal(gone, null);
  // Um get por fã (a regra do Suporte não libera a lista de `users`), nunca uma consulta.
  assert.deepEqual(firestore.reads, ["users/u1", "users/u9"]);
  assert.equal(firestore.queries.length, 0);

  // O "Atualizar" esquece o que foi lido.
  reader.clear();
  await reader.get("u1");
  assert.equal(firestore.reads.filter((path) => path === "users/u1").length, 2);

  // Sem rede, a leitura falha em vez de voltar do cache.
  firestore.setOffline(true);
  await assert.rejects(data.getSupportFan("u1"), { code: "unavailable" });
  firestore.setOffline(false);
});
