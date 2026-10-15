import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const { retriesWhenOnline } = await import("@/components/ui/use-load");

const load = async () => "lido";
const other = async () => "outro";
const failed = { load, value: { status: "error", message: "Sem conexão." }, loadedAt: null, refreshError: null };
const ready = { load, value: { status: "ready", data: "lido" }, loadedAt: new Date(), refreshError: null };

test("a volta da conexão lê de novo só a leitura que falhou", () => {
  assert.equal(retriesWhenOnline(failed, load, null), true);
  // O "Atualizar" que falhou, com o dado antigo na tela.
  assert.equal(retriesWhenOnline({ ...ready, refreshError: "Sem conexão." }, load, null), true);
  assert.equal(retriesWhenOnline(ready, load, null), false);
  assert.equal(retriesWhenOnline(null, load, null), false);
});

test("sem nova tentativa com a releitura a caminho ou com outra função", () => {
  // Uma releitura já em voo: o evento online não faz uma leitura a mais.
  assert.equal(retriesWhenOnline(failed, load, load), false);
  // A falha é de uma função anterior (outro filtro): quem lê agora é a nova.
  assert.equal(retriesWhenOnline(failed, other, null), false);
});
