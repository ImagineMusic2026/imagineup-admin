import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// O Firebase de verdade fica de fora: os módulos são trocados por dublês que
// só anotam as chamadas, para conferir a persistência escolhida em cada login.
const calls = [];
const fakeAuth = { name: "auth-de-teste", languageCode: null, currentUser: null };
const LOCAL = { type: "LOCAL" };
const SESSION = { type: "SESSION" };

mock.module("firebase/auth", {
  namedExports: {
    browserLocalPersistence: LOCAL,
    browserSessionPersistence: SESSION,
    setPersistence: async (instance, persistence) => {
      calls.push(["setPersistence", instance, persistence]);
    },
    signInWithEmailAndPassword: async (instance, email, password) => {
      calls.push(["signIn", instance, email, password]);
      return { user: { uid: "uid-1", email } };
    },
    sendPasswordResetEmail: async () => undefined,
    signOut: async () => undefined,
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    reauthenticateWithCredential: async (user, credential) => {
      calls.push(["reauth", user.uid, credential.email, credential.password]);
    },
  },
});

mock.module("@/lib/firebase", {
  namedExports: { auth: () => fakeAuth },
});

const { reauthenticate, sessionAuthTime, signInForInvite, signInWithPassword } = await import("@/lib/session");

test("login do convite guarda a sessão só na aba, antes de entrar", async () => {
  calls.length = 0;
  const user = await signInForInvite("pessoa@imagine.com", "senha-forte");
  assert.equal(user.uid, "uid-1");
  assert.deepEqual(calls, [
    ["setPersistence", fakeAuth, SESSION],
    ["signIn", fakeAuth, "pessoa@imagine.com", "senha-forte"],
  ]);
});

test("login do painel só guarda no navegador com Lembrar de mim", async () => {
  calls.length = 0;
  await signInWithPassword("  pessoa@imagine.com ", "senha", false);
  await signInWithPassword("pessoa@imagine.com", "senha", true);
  assert.deepEqual(
    calls.filter(([name]) => name === "setPersistence").map(([, , persistence]) => persistence),
    [SESSION, LOCAL],
  );
  assert.equal(calls[1][2], "pessoa@imagine.com");
});

test("a senha de novo vai com o e-mail da própria conta da equipe", async () => {
  calls.length = 0;
  fakeAuth.currentUser = { uid: "equipe-1", email: "equipe@imagine.com" };
  await reauthenticate("senha-da-equipe");
  assert.deepEqual(calls, [["reauth", "equipe-1", "equipe@imagine.com", "senha-da-equipe"]]);
  fakeAuth.currentUser = null;
  await assert.rejects(reauthenticate("x"), { code: "functions/unauthenticated" });
});

test("o auth_time da sessão sai do token, sem forçar a troca", async () => {
  const requests = [];
  const userWith = (claims) => ({
    getIdTokenResult: async (forceRefresh) => {
      requests.push(forceRefresh);
      return { claims };
    },
  });
  assert.equal(await sessionAuthTime(userWith({ auth_time: 1_800_000_000 })), 1_800_000_000);
  assert.equal(await sessionAuthTime(userWith({ auth_time: "1800000000" })), 1_800_000_000);
  assert.equal(await sessionAuthTime(userWith({})), null);
  // Renovar o token não muda o auth_time: o que está guardado basta.
  assert.deepEqual(requests, [undefined, undefined, undefined]);
  const offline = { getIdTokenResult: async () => Promise.reject(Object.assign(new Error("x"), { code: "auth/network-request-failed" })) };
  await assert.rejects(sessionAuthTime(offline), { code: "auth/network-request-failed" });
});
