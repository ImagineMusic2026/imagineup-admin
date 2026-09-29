import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const { authErrorMessage, callableErrorMessage, errorMessage, firestoreErrorMessage, readError, serverMessageOf } = await import(
  "@/lib/errors"
);

test("códigos do Auth viram português", () => {
  assert.equal(authErrorMessage("auth/invalid-credential"), "E-mail ou senha incorretos.");
  assert.equal(authErrorMessage("auth/too-many-requests"), "Muitas tentativas. Espere alguns minutos e tente de novo.");
  assert.equal(authErrorMessage("auth/network-request-failed"), "Sem conexão. Verifique a internet e tente de novo.");
  assert.match(authErrorMessage("auth/user-disabled"), /desativada/);
  assert.equal(authErrorMessage("auth/qualquer-coisa"), "Não foi possível concluir. Tente de novo.");
});

test("lê code, reason e message de qualquer erro", () => {
  assert.deepEqual(readError({ code: "functions/not-found", message: "x", details: { reason: "invalid" } }), {
    code: "functions/not-found",
    reason: "invalid",
    message: "x",
  });
  assert.deepEqual(readError(null), { code: "", reason: null, message: "" });
  assert.deepEqual(readError({ code: 3, details: "texto" }), { code: "", reason: null, message: "" });
});

test("prefere a frase do servidor quando ela existe", () => {
  const error = {
    code: "functions/failed-precondition",
    message: "Essa pessoa está desativada. Reative o acesso em Equipe.",
    details: { reason: "member-disabled" },
  };
  assert.equal(callableErrorMessage(error), "Essa pessoa está desativada. Reative o acesso em Equipe.");
  assert.equal(callableErrorMessage({ ...error, message: "Texto próprio do servidor." }), "Texto próprio do servidor.");
  // O SDK 12 acrescenta o status HTTP no fim da mensagem.
  assert.equal(callableErrorMessage({ ...error, message: "Texto próprio do servidor. [400]" }), "Texto próprio do servidor.");
});

test("mensagens que o próprio SDK monta não vão para a tela", () => {
  assert.equal(
    callableErrorMessage({ code: "functions/internal", message: "internal [0]" }),
    "Não foi possível falar com o servidor. Tente de novo em instantes.",
  );
  assert.equal(
    callableErrorMessage({ code: "functions/internal", message: "INTERNAL [500]" }),
    "Não foi possível falar com o servidor. Tente de novo em instantes.",
  );
  assert.equal(
    callableErrorMessage({ code: "functions/not-found", message: "Backend error status: NOT_FOUND [404]", details: { reason: "invalid" } }),
    "Convite inválido.",
  );
  assert.equal(
    callableErrorMessage({ code: "functions/internal", message: "Unknown backend error status: WEIRD [500]" }),
    "Não foi possível falar com o servidor. Tente de novo em instantes.",
  );
});

test("sem frase do servidor, usa o motivo e depois o código", () => {
  assert.equal(
    callableErrorMessage({ code: "functions/failed-precondition", message: "FAILED_PRECONDITION", details: { reason: "last-admin" } }),
    "O painel precisa de pelo menos um admin ativo.",
  );
  assert.equal(
    callableErrorMessage({ code: "functions/already-exists", message: "", details: { reason: "already-staff" } }),
    "Essa pessoa já faz parte da equipe.",
  );
  assert.equal(
    callableErrorMessage({ code: "functions/permission-denied", message: "permission-denied", details: { reason: "not-admin" } }),
    "Só um admin ativo pode fazer isso.",
  );
  assert.equal(
    callableErrorMessage({ code: "functions/failed-precondition", message: "failed-precondition", details: { reason: "self" } }),
    "Você não pode fazer isso na sua própria conta.",
  );
  assert.equal(
    callableErrorMessage({ code: "functions/failed-precondition", message: "", details: { reason: "not-pending" } }),
    "Este convite não está mais pendente.",
  );
  assert.equal(
    callableErrorMessage({ code: "functions/internal", message: "internal" }),
    "Não foi possível falar com o servidor. Tente de novo em instantes.",
  );
  assert.equal(callableErrorMessage({ code: "functions/not-found", message: "NOT_FOUND" }), "Não encontramos o que você pediu.");
  assert.equal(serverMessageOf({ code: "functions/not-found", reason: null, message: "NOT FOUND" }), null);
});

test("erro do Auth dentro de um fluxo de convite continua com a mensagem de Auth", () => {
  assert.equal(
    callableErrorMessage({ code: "auth/invalid-credential", message: "Firebase: Error (auth/invalid-credential)." }),
    "E-mail ou senha incorretos.",
  );
});

test("Firestore e o mapa geral", () => {
  assert.equal(firestoreErrorMessage({ code: "permission-denied" }), "Você não tem permissão para ver isto.");
  assert.equal(errorMessage({ code: "auth/invalid-email" }), "E-mail inválido.");
  assert.equal(errorMessage({ code: "unavailable" }), "Sem conexão. Verifique a internet e tente de novo.");
  assert.equal(errorMessage(new Error("boom")), "Não foi possível concluir. Tente de novo.");
});

test("motivo de volta ao login vai no endereço", async () => {
  const { EXIT_REASON_MESSAGES, loginUrl, parseExitReason } = await import("@/lib/login-reasons");
  assert.equal(loginUrl(null), "/entrar");
  assert.equal(loginUrl("desativado"), "/entrar?motivo=desativado");
  assert.equal(parseExitReason("sem-acesso"), "sem-acesso");
  assert.equal(parseExitReason("<script>"), null);
  assert.equal(parseExitReason(null), null);
  assert.equal(EXIT_REASON_MESSAGES["sem-acesso"], "Esta conta não tem acesso ao painel.");
  assert.equal(EXIT_REASON_MESSAGES.desativado, "Seu acesso ao painel foi desativado. Fale com um admin.");
});
