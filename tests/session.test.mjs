import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// O Firebase de verdade fica de fora: os módulos são trocados por dublês que
// só anotam as chamadas, para conferir a persistência escolhida em cada login.
const calls = [];
const fakeAuth = { name: "auth-de-teste", languageCode: null };
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
  },
});

mock.module("@/lib/firebase", {
  namedExports: { auth: () => fakeAuth },
});

const { signInForInvite, signInWithPassword } = await import("@/lib/session");

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
