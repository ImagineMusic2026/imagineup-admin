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

/** Os gêneros do perfil novo (28.3), na ordem do app. O ausente (ou null) é "Não informado". */
export const GENDERS = ["woman", "man", "nonbinary", "undisclosed"] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  woman: "Mulher",
  man: "Homem",
  nonbinary: "Não binário",
  undisclosed: "Prefiro não dizer",
};

/** As redes do perfil novo, na ordem do app e do mapa gravado. */
export const SOCIAL_NETWORKS = ["instagram", "tiktok", "linkedin", "x"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
};

/**
 * O usuário guardado de cada rede (28.3), cópia do `SOCIAL_PATTERNS` do
 * servidor. O LinkedIn aceita só as letras latinas acentuadas, em faixas
 * explícitas: o `\p{L}` deixaria passar letras invisíveis.
 */
const SOCIAL_PATTERNS: Record<SocialNetwork, RegExp> = {
  instagram: /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/,
  tiktok: /^(?!.*\.$)[a-z0-9._]{2,24}$/,
  linkedin: /^[a-z0-9ß-öø-ÿĀ-ſ-]{3,100}$/u,
  x: /^[a-z0-9_]{1,15}$/,
};

/** As páginas da própria rede que cabem no padrão (o `RESERVED_PATHS` do servidor): o link abriria a página da rede, não um perfil. */
const RESERVED_PATHS: Record<SocialNetwork, ReadonlySet<string>> = {
  instagram: new Set(["about", "accounts", "direct", "explore", "legal", "p", "reel", "reels", "stories", "tv", "web"]),
  tiktok: new Set(),
  linkedin: new Set(),
  x: new Set(["compose", "explore", "home", "i", "login", "logout", "messages", "notifications", "privacy", "search", "settings", "signup", "tos"]),
};

/** O usuário guardado cabe no padrão da rede e não é uma página dela (o `isSocialHandle` do servidor). */
export function isSocialHandle(network: SocialNetwork, handle: unknown): handle is string {
  return typeof handle === "string" && SOCIAL_PATTERNS[network].test(handle) && !RESERVED_PATHS[network].has(handle);
}

/** O link do perfil na rede, com domínio fixo, ou `null` com o usuário fora do padrão. */
export function socialHref(network: SocialNetwork, handle: unknown): string | null {
  if (!isSocialHandle(network, handle)) return null;
  switch (network) {
    case "instagram":
      return `https://www.instagram.com/${handle}/`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "linkedin":
      return `https://www.linkedin.com/in/${encodeURIComponent(handle)}/`;
    case "x":
      return `https://x.com/${handle}`;
  }
}

/** Uma rede que passou no padrão, pronta para virar link. */
export interface FanSocial {
  network: SocialNetwork;
  handle: string;
  href: string;
}

export interface FanProfile {
  uid: string;
  name: string;
  username: string;
  city: string | null;
  photoURL: string | null;
  createdAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: SuspensionReason | null;
  /** Já limpa pelo servidor, com as quebras de linha (até 6). */
  bio: string | null;
  /** Só a ficha da seção Fãs mostra (decisão do dono de 08/10/2026). */
  gender: Gender | null;
  /** Fecha a bio e as redes para os outros fãs no app; a equipe vê tudo. */
  privateAccount: boolean;
  /** As redes que passam no padrão, na ordem fixa. */
  socials: FanSocial[];
  /** Alguma das quatro chaves tem texto, mesmo fora do padrão: a `clearFanProfileText` apaga. */
  socialsStored: boolean;
  /** Até quando o fã não troca o próprio @ (24.1 e 32.3); `null` sem prazo gravado. */
  usernameChangeableAt: Date | null;
  /** `moderation` quando o prazo veio da troca pela equipe; ausente vale `null`. */
  usernameLockReason: "moderation" | null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSuspensionReason(value: unknown): value is SuspensionReason {
  return typeof value === "string" && (SUSPENSION_REASONS as readonly string[]).includes(value);
}

function isGender(value: unknown): value is Gender {
  return typeof value === "string" && (GENDERS as readonly string[]).includes(value);
}

function socialsMap(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** As redes lidas do mapa pela lista fixa: chave estranha é ignorada, e a rede fora do padrão não aparece. */
function readSocials(value: unknown): { socials: FanSocial[]; stored: boolean } {
  const map = socialsMap(value);
  const socials: FanSocial[] = [];
  let stored = false;
  for (const network of SOCIAL_NETWORKS) {
    const handle = Object.prototype.hasOwnProperty.call(map, network) ? map[network] : null;
    if (typeof handle === "string" && handle !== "") stored = true;
    const href = socialHref(network, handle);
    if (href) socials.push({ network, handle: handle as string, href });
  }
  return { socials, stored };
}

export function parseFanProfile(uid: string, data: Record<string, unknown>): FanProfile {
  const photo = textOf(data.photoURL);
  const { socials, stored } = readSocials(data.socials);
  return {
    uid,
    name: textOf(data.displayName),
    username: textOf(data.username),
    city: textOf(data.city) || null,
    photoURL: /^https?:\/\//.test(photo) ? photo : null,
    createdAt: toDate(data.createdAt),
    suspendedAt: toDate(data.suspendedAt),
    suspensionReason: isSuspensionReason(data.suspensionReason) ? data.suspensionReason : null,
    bio: textOf(data.bio) || null,
    gender: isGender(data.gender) ? data.gender : null,
    privateAccount: data.privateAccount === true,
    socials,
    socialsStored: stored,
    usernameChangeableAt: toDate(data.usernameChangeableAt),
    usernameLockReason: data.usernameLockReason === "moderation" ? "moderation" : null,
  };
}

/** O nome que a tela mostra: o nome do perfil, senão o @, senão "Fã sem nome". */
export function fanDisplayName(profile: Pick<FanProfile, "name" | "username">): string {
  return profile.name || (profile.username ? `@${profile.username}` : "Fã sem nome");
}

export function suspensionReasonLabel(reason: SuspensionReason | null): string {
  return reason ? SUSPENSION_REASON_LABELS[reason] : "Sem motivo";
}

export function genderLabel(gender: Gender | null): string {
  return gender ? GENDER_LABELS[gender] : "Não informado";
}

/** O usuário como a rede mostra: com @, menos no LinkedIn, que usa o endereço depois de /in/. */
export function socialHandleText(social: Pick<FanSocial, "network" | "handle">): string {
  return social.network === "linkedin" ? social.handle : `@${social.handle}`;
}

/** Formato do uid de uma conta do Auth (28 letras e números). */
export const FAN_UID_PATTERN = /^[A-Za-z0-9]{28}$/;
