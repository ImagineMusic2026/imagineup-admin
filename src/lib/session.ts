import {
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";

import { readError } from "@/lib/errors";
import { auth } from "@/lib/firebase";

/**
 * Ações de sessão usadas pelas telas de login e de convite. Entrar nunca quer
 * dizer ser da equipe: quem decide é o guard do painel, lendo `staff/{uid}`.
 */

/** Login do painel. "Lembrar de mim" guarda a sessão no navegador; sem ele, só nesta aba. */
export async function signInWithPassword(email: string, password: string, remember: boolean): Promise<User> {
  const instance = auth();
  await setPersistence(instance, remember ? browserLocalPersistence : browserSessionPersistence);
  const credential = await signInWithEmailAndPassword(instance, email.trim(), password);
  return credential.user;
}

/**
 * Login dentro do fluxo do convite, com o e-mail fixo do convite. Segue o
 * padrão do login sem "Lembrar de mim": a sessão fica só nesta aba, para quem
 * aceita o convite num computador emprestado não deixar o painel aberto.
 */
export async function signInForInvite(email: string, password: string): Promise<User> {
  return signInWithPassword(email, password, false);
}

/**
 * Pede o e-mail de nova senha (modelo do próprio Firebase, em português).
 * Conta inexistente conta como sucesso: a tela mostra sempre a mesma mensagem
 * para não revelar quem tem conta.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const instance = auth();
  instance.languageCode = "pt-BR";
  try {
    await sendPasswordResetEmail(instance, email.trim());
  } catch (error) {
    if (readError(error).code === "auth/user-not-found") return;
    throw error;
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth());
}
