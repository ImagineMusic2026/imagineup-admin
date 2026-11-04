import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// O Suporte (seção 38 da nota do app): os rótulos, a mensagem lida, a linha
// do aparelho, a consulta de cada aba, os textos da tela e o pedido da
// `resolveSupportMessage`, com o dublê no lugar do Firebase.

const calls = [];
let answer = null;
mock.module("@/lib/callable", {
  namedExports: {
    LONG_CALL_TIMEOUT_MS: 130_000,
    call: async (name, data) => {
      calls.push([name, data]);
      return answer ?? { ok: true, status: data.action === "resolve" ? "resolved" : "open" };
    },
  },
});

const support = await import("@/lib/support");
const api = await import("@/lib/support-api");
const errors = await import("@/lib/errors");
const exportLabels = await import("@/lib/fan-data-export");
const points = await import("@/lib/points-config");

const DASHES = /[\u2013\u2014]/;
const sp = (local) => new Date(`${local}-03:00`);
const ts = (date) => ({ toDate: () => date, toMillis: () => date.getTime() });
const NOW = sp("2026-11-03T18:00:00");

test("os tipos, as abas e o filtro, com os rótulos do contrato", () => {
  assert.deepEqual(support.SUPPORT_KINDS, ["problem", "idea", "feedback"]);
  assert.deepEqual(support.SUPPORT_KIND_LABELS, { problem: "Problema", idea: "Sugestão", feedback: "Feedback" });
  assert.deepEqual(support.SUPPORT_STATUS_LABELS, { open: "Abertas", resolved: "Resolvidas" });
  assert.deepEqual(support.KIND_FILTERS, ["all", "problem", "idea", "feedback"]);
  assert.deepEqual(
    support.KIND_FILTERS.map((kind) => support.KIND_FILTER_LABELS[kind]),
    ["Todos", "Problema", "Sugestão", "Feedback"],
  );
  assert.equal(support.supportKindLabel(null), "Mensagem");
  assert.ok(support.isKindFilter("all"));
  assert.ok(support.isKindFilter("idea"));
  assert.equal(support.isKindFilter("bug"), false);
  assert.equal(support.SUPPORT_PAGE_SIZE, 20);
});

test("a mensagem lida, e o documento torto não quebra a tela", () => {
  const message = support.parseSupportMessage("m1", {
    uid: "uidRenata",
    kind: "problem",
    text: "O app fecha quando\nabro o ranking.\n\nNo Android.",
    device: { platform: "android", osVersion: "14", appVersion: "0.1.0", updateId: "01a1a459" },
    status: "resolved",
    createdAt: ts(sp("2026-11-03T10:15:00")),
    resolvedAt: ts(sp("2026-11-03T16:40:00")),
    resolvedBy: { uid: "staff1", name: "Camila" },
    schemaVersion: 1,
  });
  assert.equal(message.id, "m1");
  assert.equal(message.uid, "uidRenata");
  assert.equal(message.kind, "problem");
  // O texto chega inteiro, com as quebras de linha.
  assert.equal(message.text, "O app fecha quando\nabro o ranking.\n\nNo Android.");
  assert.deepEqual(message.device, { platform: "android", osVersion: "14", appVersion: "0.1.0", updateId: "01a1a459" });
  assert.equal(message.status, "resolved");
  assert.equal(message.createdAt.toISOString(), sp("2026-11-03T10:15:00").toISOString());
  assert.deepEqual(message.resolvedBy, { uid: "staff1", name: "Camila" });

  const torto = support.parseSupportMessage("m2", { uid: 3, kind: "bug", text: 5, device: "android", status: "fechada", resolvedBy: "Camila" });
  assert.deepEqual(torto, {
    id: "m2",
    uid: null,
    kind: null,
    text: "",
    device: null,
    status: "open",
    createdAt: null,
    resolvedAt: null,
    resolvedBy: null,
  });
  // O texto com HTML continua texto: a tela nunca o interpreta.
  assert.equal(support.parseSupportMessage("m3", { text: "<b>oi</b>" }).text, "<b>oi</b>");
});

test("a linha do aparelho, com os campos null fora", () => {
  const full = { platform: "android", osVersion: "14", appVersion: "0.1.0", updateId: "01a1a459" };
  assert.equal(support.deviceLine(full), "Android 14 · app 0.1.0 · update 01a1a459");
  assert.equal(support.deviceLine({ ...full, platform: "ios", osVersion: "18.1" }), "iOS 18.1 · app 0.1.0 · update 01a1a459");
  assert.equal(support.deviceLine({ ...full, osVersion: null }), "Android · app 0.1.0 · update 01a1a459");
  assert.equal(support.deviceLine({ ...full, appVersion: null }), "Android 14 · update 01a1a459");
  assert.equal(support.deviceLine({ ...full, updateId: null }), "Android 14 · app 0.1.0");
  assert.equal(support.deviceLine({ platform: "ios", osVersion: null, appVersion: null, updateId: null }), "iOS");
  assert.equal(support.deviceLine({ platform: null, osVersion: "14", appVersion: null, updateId: null }), "14");
  assert.equal(support.deviceLine({ platform: null, osVersion: null, appVersion: null, updateId: null }), null);
  assert.equal(support.deviceLine(null), null);

  // O que vem torto do documento sai da linha: o sistema desconhecido e o texto vazio.
  const lido = support.parseSupportMessage("m1", { kind: "problem", device: { platform: "windows", osVersion: "", appVersion: "0.1.0", updateId: null } });
  assert.equal(support.deviceLine(lido.device), "app 0.1.0");

  // Só o problema mostra o aparelho; sem nada gravado, o card diz que não veio.
  assert.equal(support.deviceText({ kind: "problem", device: full }), "Android 14 · app 0.1.0 · update 01a1a459");
  assert.equal(support.deviceText({ kind: "problem", device: null }), "Aparelho não informado");
  assert.equal(support.deviceText({ kind: "idea", device: full }), null);
  assert.equal(support.deviceText({ kind: "feedback", device: null }), null);
});

test("a consulta de cada aba tem a forma dos quatro índices de supportMessages", () => {
  assert.deepEqual(support.supportQueryPlan("open", "all"), { where: [["status", "==", "open"]], orderBy: "createdAt" });
  assert.deepEqual(support.supportQueryPlan("resolved", "all"), { where: [["status", "==", "resolved"]], orderBy: "resolvedAt" });
  assert.deepEqual(support.supportQueryPlan("open", "problem"), {
    where: [
      ["status", "==", "open"],
      ["kind", "==", "problem"],
    ],
    orderBy: "createdAt",
  });
  assert.deepEqual(support.supportQueryPlan("resolved", "feedback"), {
    where: [
      ["status", "==", "resolved"],
      ["kind", "==", "feedback"],
    ],
    orderBy: "resolvedAt",
  });
  assert.equal(support.actionOf("open"), "resolve");
  assert.equal(support.actionOf("resolved"), "reopen");
});

test("os textos da tela, em São Paulo e sem travessão", () => {
  // 16:40 em São Paulo é 19:40 em UTC: a hora sai no fuso de São Paulo.
  assert.equal(support.supportWhen(sp("2026-11-03T16:40:00"), NOW), "3 nov, 16:40");
  assert.equal(support.supportWhen(sp("2025-12-31T23:10:00"), NOW), "31 dez 2025, 23:10");
  assert.equal(support.supportWhen(null, NOW), "sem data");

  assert.equal(support.openCountText(0), "Nenhuma mensagem aberta.");
  assert.equal(support.openCountText(1), "1 mensagem aberta.");
  assert.equal(support.openCountText(1200), "1.200 mensagens abertas.");

  assert.equal(support.emptyText("open", "all"), "Nenhuma mensagem esperando a equipe.");
  assert.equal(support.emptyText("resolved", "all"), "Nenhuma mensagem resolvida ainda.");
  assert.equal(support.emptyText("open", "problem"), "Nenhum problema aberto.");
  assert.equal(support.emptyText("open", "idea"), "Nenhuma sugestão aberta.");
  assert.equal(support.emptyText("resolved", "feedback"), "Nenhum feedback resolvido ainda.");

  const resolved = { resolvedAt: sp("2026-11-03T16:40:00"), resolvedBy: { uid: "staff1", name: "Camila" } };
  assert.equal(support.resolvedText(resolved, NOW), "Resolvida em 3 nov, 16:40, por Camila");
  assert.equal(support.resolvedText({ ...resolved, resolvedBy: { uid: "staff1", name: "" } }, NOW), "Resolvida em 3 nov, 16:40");
  assert.equal(support.resolvedText({ resolvedAt: null, resolvedBy: null }, NOW), "Resolvida");

  const resolve = support.actionConfirm("resolve", "problem");
  assert.equal(resolve.title, "Marcar a mensagem como resolvida?");
  assert.equal(resolve.confirmLabel, "Marcar como resolvida");
  assert.match(resolve.body, /^O problema vai da aba Abertas para Resolvidas/);
  assert.match(resolve.body, /Logs e auditoria/);
  const reopen = support.actionConfirm("reopen", "idea");
  assert.equal(reopen.confirmLabel, "Reabrir");
  assert.match(reopen.body, /^A sugestão volta para a aba Abertas/);
  assert.match(support.actionConfirm("reopen", null).body, /^A mensagem volta/);

  assert.equal(support.actionDoneText("resolve", "Renata"), "Mensagem de Renata resolvida.");
  assert.equal(support.actionDoneText("reopen", "Renata"), "Mensagem de Renata reaberta.");
  assert.equal(support.actionDoneText("resolve", null), "Mensagem resolvida.");
  assert.equal(support.FAN_NOT_FOUND_TEXT, "Conta não encontrada");

  const texts = [
    ...Object.values(support.SUPPORT_KIND_LABELS),
    ...Object.values(support.KIND_FILTER_LABELS),
    ...Object.values(support.SUPPORT_STATUS_LABELS),
    ...Object.values(support.SUPPORT_LIST_META),
    ...["open", "resolved"].flatMap((status) => support.KIND_FILTERS.map((kind) => support.emptyText(status, kind))),
    ...["resolve", "reopen"].flatMap((action) => [null, ...support.SUPPORT_KINDS].flatMap((kind) => Object.values(support.actionConfirm(action, kind)))),
    support.FAN_NOT_FOUND_TEXT,
    support.SUPPORT_AUDIT_TEXT,
    support.deviceText({ kind: "problem", device: null }),
  ];
  for (const text of texts) assert.doesNotMatch(text, DASHES, text);
});

test("a resolveSupportMessage recebe o id e a ação, e a recusa da mensagem que sumiu tira o card", async () => {
  calls.length = 0;
  answer = null;
  assert.deepEqual(await api.resolveSupportMessage({ id: "m1", action: "resolve" }), { ok: true, status: "resolved" });
  assert.deepEqual(await api.resolveSupportMessage({ id: "m1", action: "reopen" }), { ok: true, status: "open" });
  assert.deepEqual(calls, [
    ["resolveSupportMessage", { id: "m1", action: "resolve" }],
    ["resolveSupportMessage", { id: "m1", action: "reopen" }],
  ]);

  // O `message-not-found` tira o card da lista; os outros motivos, não.
  assert.equal(support.isMessageGone("message-not-found"), true);
  assert.equal(support.isMessageGone("no-section"), false);
  assert.equal(support.isMessageGone(null), false);

  // A frase do servidor vai para a tela; sem ela, a de reserva do painel.
  const gone = { code: "functions/not-found", message: "Essa mensagem não existe mais.", details: { reason: "message-not-found" } };
  assert.equal(errors.callableErrorMessage(gone), "Essa mensagem não existe mais.");
  assert.equal(errors.reasonOf(gone), "message-not-found");
  assert.equal(errors.mayHaveRunOnServer(gone), false);
  assert.equal(errors.callableErrorMessage({ code: "functions/not-found", message: "not-found", details: { reason: "message-not-found" } }), "Essa mensagem não existe mais.");
  // O Leitor com a seção recebe o `no-section` da edição.
  assert.equal(
    errors.callableErrorMessage({ code: "functions/permission-denied", message: "permission-denied", details: { reason: "no-section" } }),
    "Seu acesso ao painel não permite fazer isso nesta seção.",
  );
});

test("as mensagens na exportação dos dados do fã e o teto do dia na régua", () => {
  // A parte nova da exportação (38.4), no fim da lista do servidor.
  assert.equal(exportLabels.partLabel("mensagensDeSuporte"), "mensagens de suporte");
  assert.equal(exportLabels.exportProgressText("mensagensDeSuporte"), "Juntando os dados: mensagens de suporte");
  // O teto `support_message` (5 por dia, somando os três tipos) aparece na régua.
  assert.equal(points.ACTION_CAP_LABELS.support_message, "Mensagens de suporte");
  assert.equal(points.DEFAULT_ACTION_CAPS.support_message, 5);
});
