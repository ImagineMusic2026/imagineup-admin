import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const exp = await import("@/lib/fan-data-export");

const PARTS = ["extrato", "pontosPorCentral", "centrais", "curtidas", "presencas", "comentarios", "linksDeConvite", "pedidosDaLoja"];

function start(extra = {}) {
  return {
    formato: "imagineup-dados-do-fa",
    versao: 1,
    geradoEm: "2026-10-15T23:59:00.000Z",
    uid: "camila",
    avisos: ["Este arquivo traz os dados da sua conta no ImagineUP no momento em que foi gerado."],
    conta: { nome: "Camila", email: "camila@teste.imagineup", emailConfirmado: false },
    perfil: { username: "camilarib" },
    arrobasReservados: ["camilarib"],
    carteira: { balance: 10 },
    convite: null,
    codigosDeConvite: [],
    origem: null,
    pessoasTrazidas: 3,
    bloqueios: null,
    denunciasDeComentario: [],
    denunciasDePerfil: [],
    temporadas: [],
    partes: PARTS,
    ...extra,
  };
}

/** Uma busca de mentira: devolve as páginas de cada parte na ordem e anota os pedidos. */
function fakeFetch(pages, { failAt = null } = {}) {
  const requests = [];
  let calls = 0;
  const fetchPage = async (request) => {
    requests.push(request);
    calls += 1;
    if (failAt !== null && calls === failAt) throw Object.assign(new Error("internal"), { code: "functions/internal" });
    const list = pages[request.part] ?? [{ items: [], after: null }];
    const cursor = "after" in request ? request.after : null;
    const index = cursor === null ? 0 : list.findIndex((_, i) => (list[i - 1]?.after ?? null) === cursor);
    const page = list[index];
    return { part: request.part, items: page.items, after: page.after };
  };
  return { fetchPage, requests };
}

test("o pedido da página: sem a chave after na primeira, com o after como veio nas seguintes", () => {
  const first = exp.pageRequest("u1", "extrato", null);
  assert.deepEqual(first, { uid: "u1", part: "extrato" });
  assert.equal("after" in first, false);
  assert.deepEqual(exp.pageRequest("u1", "comentarios", "posts/p1/postComments/c9"), { uid: "u1", part: "comentarios", after: "posts/p1/postComments/c9" });
});

test("as partes na ordem, cada uma até o after null, devolvendo o after como veio", async () => {
  const pages = {
    extrato: [
      { items: [{ id: "e1" }, { id: "e2" }], after: "e2" },
      { items: [{ id: "e3" }], after: null },
    ],
    comentarios: [
      { items: [{ id: "c1", postId: "p1" }], after: "posts/p1/postComments/c1" },
      { items: [{ id: "c2", postId: "p2" }], after: null },
    ],
  };
  const { fetchPage, requests } = fakeFetch(pages);
  const seen = [];
  const progress = exp.newExportProgress();
  const result = await exp.collectFanData(start(), progress, fetchPage, { onPart: (part) => seen.push(part) });
  assert.equal(result, "done");
  assert.deepEqual(requests.slice(0, 2), [
    { uid: "camila", part: "extrato" },
    { uid: "camila", part: "extrato", after: "e2" },
  ]);
  assert.deepEqual(
    requests.filter((request) => request.part === "comentarios"),
    [
      { uid: "camila", part: "comentarios" },
      { uid: "camila", part: "comentarios", after: "posts/p1/postComments/c1" },
    ],
  );
  assert.deepEqual(progress.items.extrato.map((item) => item.id), ["e1", "e2", "e3"]);
  assert.deepEqual(progress.items.comentarios.map((item) => item.id), ["c1", "c2"]);
  assert.deepEqual([...new Set(seen)], PARTS);
  assert.equal(requests.length, PARTS.length + 2);
});

test("depois de uma página que falhou, continua da parte e do after em que parou", async () => {
  const pages = {
    extrato: [
      { items: [{ id: "e1" }], after: "e1" },
      { items: [{ id: "e2" }], after: null },
    ],
  };
  const { fetchPage, requests } = fakeFetch(pages, { failAt: 2 });
  const progress = exp.newExportProgress();
  await assert.rejects(exp.collectFanData(start(), progress, fetchPage), { code: "functions/internal" });
  assert.deepEqual(progress, { index: 0, after: "e1", items: { extrato: [{ id: "e1" }] } });
  const result = await exp.collectFanData(start(), progress, fetchPage);
  assert.equal(result, "done");
  assert.deepEqual(requests[2], { uid: "camila", part: "extrato", after: "e1" });
  assert.deepEqual(progress.items.extrato, [{ id: "e1" }, { id: "e2" }]);
});

test("parar confere antes de cada página, e a página que repete o cursor ou vem torta não passa", async () => {
  const { fetchPage, requests } = fakeFetch({});
  let stop = false;
  const progress = exp.newExportProgress();
  const result = await exp.collectFanData(start(), progress, fetchPage, {
    onPart: (part) => {
      if (part === "centrais") stop = true;
    },
    stopped: () => stop,
  });
  assert.equal(result, "stopped");
  assert.deepEqual(requests.map((request) => request.part), ["extrato", "pontosPorCentral"]);

  const stuck = async (request) => ({ part: request.part, items: [], after: "mesmo" });
  await assert.rejects(exp.collectFanData(start(), { index: 0, after: "mesmo", items: {} }, stuck), /não avançou/);
  const wrong = async () => ({ part: "outra", items: [], after: null });
  await assert.rejects(exp.collectFanData(start(), exp.newExportProgress(), wrong), /formato inesperado/);
});

test("o arquivo: o começo na ordem, sem o partes, e as 8 partes no fim como listas", () => {
  const file = exp.buildFanDataFile(start(), { extrato: [{ id: "e1" }], comentarios: [{ id: "c1", postId: "p1" }] });
  assert.deepEqual(Object.keys(file), [
    "formato",
    "versao",
    "geradoEm",
    "uid",
    "avisos",
    "conta",
    "perfil",
    "arrobasReservados",
    "carteira",
    "convite",
    "codigosDeConvite",
    "origem",
    "pessoasTrazidas",
    "bloqueios",
    "denunciasDeComentario",
    "denunciasDePerfil",
    "temporadas",
    ...PARTS,
  ]);
  assert.equal("partes" in file, false);
  assert.deepEqual(file.extrato, [{ id: "e1" }]);
  assert.deepEqual(file.curtidas, []);
  const text = exp.fanDataFileText(file);
  assert.ok(text.endsWith("}\n"));
  assert.deepEqual(JSON.parse(text), file);
});

test("o nome do arquivo pela data do geradoEm, e a primeira resposta conferida", () => {
  assert.equal(exp.fanDataFileName("abc", "2026-10-15T23:59:00.000Z"), "imagineup-dados-abc-2026-10-15.json");
  assert.equal(exp.fanDataFileName("abc", "ontem"), "imagineup-dados-abc-sem-data.json");
  assert.equal(exp.parseFanDataStart(start(), "camila").uid, "camila");
  assert.throws(() => exp.parseFanDataStart(start(), "outro"), /formato inesperado/);
  assert.throws(() => exp.parseFanDataStart(start({ partes: "extrato" }), "camila"), /formato inesperado/);
  assert.throws(() => exp.parseFanDataStart(null, "camila"), /formato inesperado/);
});

test("o e-mail não confirmado e os nomes das partes", () => {
  assert.equal(exp.emailUnconfirmed(start()), true);
  assert.equal(exp.emailUnconfirmed(start({ conta: { emailConfirmado: true } })), false);
  assert.equal(exp.emailUnconfirmed(start({ conta: null })), true);
  assert.equal(exp.exportProgressText("pontosPorCentral"), "Juntando os dados: pontos por central");
  assert.equal(exp.exportProgressText("pedidosDaLoja"), "Juntando os dados: pedidos da loja");
  assert.equal(exp.exportProgressText("parteNova"), "Juntando os dados: parteNova");
  assert.equal(exp.partLabel("toString"), "toString");
});

test("a recusa dos pedidos de dados: a frase do servidor, e o email-mismatch próprio sem ela", async () => {
  const { callableErrorMessage } = await import("@/lib/errors");
  const withServer = {
    code: "functions/failed-precondition",
    message: "Este e-mail não é o da conta deste fã. Confira o e-mail do pedido. [400]",
    details: { reason: "email-mismatch" },
  };
  assert.equal(exp.dataRequestErrorMessage(withServer), "Este e-mail não é o da conta deste fã. Confira o e-mail do pedido.");
  const bare = { code: "functions/failed-precondition", message: "failed-precondition", details: { reason: "email-mismatch" } };
  assert.equal(exp.dataRequestErrorMessage(bare), "Este e-mail não é o da conta deste fã. Confira o e-mail do pedido.");
  // Fora dos pedidos de dados, o mapa de sempre continua com a frase do convite.
  assert.equal(callableErrorMessage(bare), "Você entrou com outra conta. Entre com o e-mail que recebeu o convite.");
  assert.equal(
    exp.dataRequestErrorMessage({ code: "functions/resource-exhausted", message: "resource-exhausted", details: { reason: "export-daily-limit" } }),
    "Você chegou ao limite de 20 exportações de dados hoje.",
  );
  assert.equal(exp.dataRequestErrorMessage({ code: "auth/invalid-credential" }), "E-mail ou senha incorretos.");
});

test("textos sem travessão nem meia-risca", () => {
  const DASHES = /[–—]/;
  for (const [key, value] of Object.entries(exp)) {
    if (typeof value === "string") assert.doesNotMatch(value, DASHES, key);
  }
  for (const line of exp.DELETE_LOSSES) assert.doesNotMatch(line, DASHES);
});
