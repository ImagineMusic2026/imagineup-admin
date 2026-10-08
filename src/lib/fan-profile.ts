import { toDate } from "@/lib/staff";

/**
 * O perfil do fã (`users/{uid}`) como as telas usam, puro. Só as seções Fãs e
 * Moderação leem perfis (26.10): Ranking e Recompensas recebem o nome pronto
 * (a `getPanelRanking` e as cópias do pedido).
 *
 * O servidor grava tudo; aqui a leitura é defensiva, como a de `staff.ts`:
 * campo estranho vira vazio.
 */

export const SUSPENSION_REASONS = ["spam", "offensive", "harassment", "other"] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

/** Os motivos da suspensão, os mesmos das denúncias. */
export const SUSPENSION_REASON_LABELS: Record<SuspensionReason, string> = {
  spam: "Spam",
  offensive: "Ofensivo",
  harassment: "Assédio",
  other: "Outro",
};

export interface FanProfile {
  uid: string;
  name: string;
  username: string;
  city: string | null;
  photoURL: string | null;
  createdAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: SuspensionReason | null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSuspensionReason(value: unknown): value is SuspensionReason {
  return typeof value === "string" && (SUSPENSION_REASONS as readonly string[]).includes(value);
}

export function parseFanProfile(uid: string, data: Record<string, unknown>): FanProfile {
  const photo = textOf(data.photoURL);
  return {
    uid,
    name: textOf(data.displayName),
    username: textOf(data.username),
    city: textOf(data.city) || null,
    photoURL: /^https?:\/\//.test(photo) ? photo : null,
    createdAt: toDate(data.createdAt),
    suspendedAt: toDate(data.suspendedAt),
    suspensionReason: isSuspensionReason(data.suspensionReason) ? data.suspensionReason : null,
  };
}

/** O nome que a tela mostra: o nome do perfil, senão o @, senão "Fã sem nome". */
export function fanDisplayName(profile: Pick<FanProfile, "name" | "username">): string {
  return profile.name || (profile.username ? `@${profile.username}` : "Fã sem nome");
}

export function suspensionReasonLabel(reason: SuspensionReason | null): string {
  return reason ? SUSPENSION_REASON_LABELS[reason] : "Sem motivo";
}

/** Formato do uid de uma conta do Auth (28 letras e números). */
export const FAN_UID_PATTERN = /^[A-Za-z0-9]{28}$/;
