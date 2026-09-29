/**
 * Regras puras da página do convite (`/convite/[inviteId]#token`).
 */

import { readError } from "@/lib/errors";

export type InviteProblem = "invalid" | "expired" | "accepted" | "canceled" | "already-staff";

const PROBLEMS: readonly InviteProblem[] = ["invalid", "expired", "accepted", "canceled", "already-staff"];

export const INVITE_PROBLEM_COPY: Record<InviteProblem, { title: string; text: string; loginLink: boolean }> = {
  invalid: {
    title: "Convite inválido",
    text: "Confira se você abriu o link completo, do jeito que chegou no e-mail. Se continuar assim, peça um novo convite ao admin.",
    loginLink: false,
  },
  expired: {
    title: "Convite vencido",
    text: "Este convite venceu. Peça um novo ao admin que te convidou.",
    loginLink: false,
  },
  accepted: {
    title: "Convite já usado",
    text: "Este convite já foi usado. Entre com seu e-mail e senha.",
    loginLink: true,
  },
  canceled: {
    title: "Convite cancelado",
    text: "Este convite foi cancelado. Peça um novo ao admin que te convidou.",
    loginLink: false,
  },
  "already-staff": {
    title: "Você já faz parte da equipe",
    text: "Este e-mail já tem acesso ao painel. Entre com seu e-mail e senha.",
    loginLink: true,
  },
};

/**
 * Subtítulo da página do convite. Sem o nome de quem convidou, a frase não
 * pode ter gênero ("Você foi convidado" não serve para todo mundo).
 */
export function inviteSubtitle(invitedByName: string | null | undefined): string {
  const name = invitedByName?.trim();
  const lead = name ? `${name} convidou você` : "Você recebeu um convite";
  return `${lead} para a equipe do painel ImagineUP.`;
}

/**
 * O token vem no fragmento do endereço (depois do `#`), que o navegador nunca
 * manda para servidor nenhum. Vazio quando não há token.
 */
export function readInviteToken(hash: string): string {
  return hash.replace(/^#/, "").trim();
}

/**
 * Qual tela de problema um erro de `getStaffInvite`/aceite pede, se algum.
 * Só o `reason` do contrato decide: um 404 sem motivo (função não publicada)
 * vira erro comum com "Tentar de novo", e não "Convite inválido".
 */
export function inviteProblemOf(error: unknown): InviteProblem | null {
  const { code, reason } = readError(error);
  if (!code.startsWith("functions/")) return null;
  if (reason && (PROBLEMS as readonly string[]).includes(reason)) return reason as InviteProblem;
  return null;
}

/** O aceite de conta nova descobriu que o e-mail já tem conta no app. */
export function isAccountExistsError(error: unknown): boolean {
  return readError(error).reason === "account-exists";
}

const WRONG_PASSWORD_CODES = new Set(["auth/invalid-credential", "auth/wrong-password", "auth/invalid-login-credentials"]);

/** No fluxo de conta existente o e-mail é fixo: o erro de credencial é sempre a senha. */
export function isWrongPasswordError(error: unknown): boolean {
  return WRONG_PASSWORD_CODES.has(readError(error).code);
}
