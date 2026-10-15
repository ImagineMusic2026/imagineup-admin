import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const { getArtistNames } = await import("@/lib/artist-names-data");
const { errorMessage } = await import("@/lib/errors");

test.beforeEach(() => {
  firestore.reset();
  firestore.set("artists/netto", { name: "Netto Brito", status: "published", order: 1 });
  firestore.set("artists/trio", { name: "Trio Bem Bahia", status: "draft", order: 0 });
});

test("os nomes das centrais: com a seção Artistas, todas; sem ela, só as publicadas", async () => {
  const all = await getArtistNames(true);
  assert.deepEqual([...all.keys()], ["trio", "netto"]);
  assert.deepEqual(firestore.queries.at(-1).where, []);

  const published = await getArtistNames(false);
  assert.deepEqual([...published.keys()], ["netto"]);
  // Sem a seção, a consulta precisa do filtro, senão as regras recusam.
  assert.deepEqual(firestore.queries.at(-1).where, [{ field: "status", op: "==", value: "published" }]);
});

test("sem rede, a leitura falha com \"Sem conexão\" em vez de voltar vazia do cache", async () => {
  firestore.setOffline(true);
  await assert.rejects(getArtistNames(true), (error) => {
    assert.equal(error.code, "unavailable");
    assert.equal(errorMessage(error), "Sem conexão. Verifique a internet e tente de novo.");
    return true;
  });
  // A conexão voltou: a mesma leitura traz os nomes.
  firestore.setOffline(false);
  assert.equal((await getArtistNames(true)).size, 2);
});
