import { countLabel, formatDay, formatTime } from "@/lib/format";
import { toDate } from "@/lib/staff";

/**
 * Suporte (seção 38 da nota do app), puro: a mensagem que o fã manda pelos
 * Ajustes do app (`supportMessages/{id}`), os rótulos dos tipos, a linha do
 * aparelho, a consulta de cada aba e os textos da tela. O nome e o @ do fã não
 * ficam na mensagem: a tela lê `users/{uid}` ao vivo (`support-data.ts`).
 * Resolver e reabrir passam pela `resolveSupportMessage` (`support-api.ts`).
 */

/** Páginas de até 20 (o contrato da seção 38), com "Carregar mais". */
export const SUPPORT_PAGE_SIZE = 20;

/** Os três tipos, na ordem dos Ajustes do app: Reportar problema, Sugerir funcionalidade e Feedback geral. */
export const SUPPORT_KINDS = ["problem", "idea", "feedback"] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

export const SUPPORT_KIND_LABELS: Record<SupportKind, string> = {
  problem: "Problema",
  idea: "Sugestão",
  feedback: "Feedback",
};

export function isSupportKind(value: unknown): value is SupportKind {
  return typeof value === "string" && (SUPPORT_KINDS as readonly string[]).includes(value);
}

/** O rótulo do tipo; o tipo que o painel não conhece vira "Mensagem". */
export function supportKindLabel(kind: SupportKind | null): string {
  return kind ? SUPPORT_KIND_LABELS[kind] : "Mensagem";
}

/** As abas: as abertas (a padrão) e as resolvidas. */
export const SUPPORT_STATUSES = ["open", "resolved"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Abertas",
  resolved: "Resolvidas",
};

/** O filtro de tipo: todos, ou um tipo. */
export const KIND_FILTERS = ["all", ...SUPPORT_KINDS] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];

export const KIND_FILTER_LABELS: Record<KindFilter, string> = {
  all: "Todos",
  ...SUPPORT_KIND_LABELS,
};

export function isKindFilter(value: unknown): value is KindFilter {
  return value === "all" || isSupportKind(value);
}

export type SupportPlatform = "android" | "ios";

export const PLATFORM_LABELS: Record<SupportPlatform, string> = { android: "Android", ios: "iOS" };

/** O aparelho do problema, sem nada que identifique a pessoa. */
export interface SupportDevice {
  /** `null` quando o valor gravado não é um sistema conhecido. */
  platform: SupportPlatform | null;
  osVersion: string | null;
  appVersion: string | null;
  updateId: string | null;
}

export interface SupportMessage {
  id: string;
  /** O fã que mandou; `null` quando o documento não traz um uid. */
  uid: string | null;
  /** `null` quando o tipo gravado não é um dos três. */
  kind: SupportKind | null;
  text: string;
  /** Só no problema; nos outros, `null`. */
  device: SupportDevice | null;
  status: SupportStatus;
  createdAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: { uid: string | null; name: string } | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDevice(value: unknown): SupportDevice | null {
  if (!isRecord(value)) return null;
  const platform = value.platform === "android" || value.platform === "ios" ? value.platform : null;
  return {
    platform,
    osVersion: textOrNull(value.osVersion),
    appVersion: textOrNull(value.appVersion),
    updateId: textOrNull(value.updateId),
  };
}

function parseResolvedBy(value: unknown): SupportMessage["resolvedBy"] {
  if (!isRecord(value)) return null;
  return { uid: textOrNull(value.uid), name: typeof value.name === "string" ? value.name.trim() : "" };
}

/**
 * Um documento de `supportMessages` como a tela usa. Campo torto não quebra:
 * o status desconhecido conta como aberto (a mensagem nunca some da lista
 * por um campo estranho), e o texto que não é texto fica vazio.
 */
export function parseSupportMessage(id: string, data: Record<string, unknown>): SupportMessage {
  return {
    id,
    uid: textOrNull(data.uid),
    kind: isSupportKind(data.kind) ? data.kind : null,
    text: typeof data.text === "string" ? data.text : "",
    device: parseDevice(data.device),
    status: data.status === "resolved" ? "resolved" : "open",
    createdAt: toDate(data.createdAt),
    resolvedAt: toDate(data.resolvedAt),
    resolvedBy: parseResolvedBy(data.resolvedBy),
  };
}

/**
 * A linha do aparelho do problema: "Android 14 · app 0.1.0 · update 01a1a459".
 * Os campos `null` saem da linha; sem nada, `null`.
 */
export function deviceLine(device: SupportDevice | null): string | null {
  if (!device) return null;
  const system = [device.platform ? PLATFORM_LABELS[device.platform] : null, device.osVersion].filter(Boolean).join(" ");
  const parts = [system || null, device.appVersion ? `app ${device.appVersion}` : null, device.updateId ? `update ${device.updateId}` : null].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** O aparelho como o card mostra: só no problema, e sem nada gravado, "Aparelho não informado". */
export function deviceText(message: Pick<SupportMessage, "kind" | "device">): string | null {
  if (message.kind !== "problem") return null;
  return deviceLine(message.device) ?? "Aparelho não informado";
}

// ---------------------------------------------------------------------------
// As consultas
// ---------------------------------------------------------------------------

export type SupportFilter = readonly [field: "status" | "kind", op: "==", value: string];

export interface SupportQueryPlan {
  where: SupportFilter[];
  /** Sempre do mais novo. */
  orderBy: "createdAt" | "resolvedAt";
}

/**
 * A consulta de uma aba, na forma dos quatro índices de `supportMessages`:
 * as abertas por `createdAt`, as resolvidas por `resolvedAt`, os dois do mais
 * novo, e o tipo como mais um `==` depois do status.
 */
export function supportQueryPlan(status: SupportStatus, kind: KindFilter): SupportQueryPlan {
  const where: SupportFilter[] = [["status", "==", status]];
  if (kind !== "all") where.push(["kind", "==", kind]);
  return { where, orderBy: status === "open" ? "createdAt" : "resolvedAt" };
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** O botão de cada aba e o que ele pede à callable. */
export type SupportAction = "resolve" | "reopen";

export function actionOf(status: SupportStatus): SupportAction {
  return status === "open" ? "resolve" : "reopen";
}

/** "3 nov, 14:30" (no fuso de São Paulo, como os cards da Moderação), ou "sem data". */
export function supportWhen(date: Date | null, now: Date): string {
  return date ? `${formatDay(date, now)}, ${formatTime(date)}` : "sem data";
}

/** O cabeçalho da página: "Nenhuma mensagem aberta.", "1 mensagem aberta.", "3 mensagens abertas.". */
export function openCountText(total: number): string {
  return total === 0 ? "Nenhuma mensagem aberta." : `${countLabel(total, "mensagem aberta", "mensagens abertas")}.`;
}

/** A legenda de cada aba. */
export const SUPPORT_LIST_META: Record<SupportStatus, string> = {
  open: "Da mais nova para a mais antiga.",
  resolved: "Da resolução mais nova.",
};

const EMPTY_BY_KIND: Record<SupportKind, Record<SupportStatus, string>> = {
  problem: { open: "Nenhum problema aberto.", resolved: "Nenhum problema resolvido ainda." },
  idea: { open: "Nenhuma sugestão aberta.", resolved: "Nenhuma sugestão resolvida ainda." },
  feedback: { open: "Nenhum feedback aberto.", resolved: "Nenhum feedback resolvido ainda." },
};

/** O estado vazio de uma aba, pelo filtro. */
export function emptyText(status: SupportStatus, kind: KindFilter): string {
  if (kind !== "all") return EMPTY_BY_KIND[kind][status];
  return status === "open" ? "Nenhuma mensagem esperando a equipe." : "Nenhuma mensagem resolvida ainda.";
}

/** "Resolvida em 3 nov, 14:30, por Camila"; sem o nome, sem o "por". */
export function resolvedText(message: Pick<SupportMessage, "resolvedAt" | "resolvedBy">, now: Date): string {
  const when = message.resolvedAt ? `Resolvida em ${supportWhen(message.resolvedAt, now)}` : "Resolvida";
  const name = message.resolvedBy?.name;
  return name ? `${when}, por ${name}` : when;
}

/** O nome do fã quando o perfil não existe mais (ou o uid não veio). */
export const FAN_NOT_FOUND_TEXT = "Conta não encontrada";

export const SUPPORT_AUDIT_TEXT = "A alteração fica registrada em Logs e auditoria com o seu nome.";

const SUBJECTS: Record<SupportKind, string> = { problem: "O problema", idea: "A sugestão", feedback: "O feedback" };

/** A confirmação de cada ação. */
export function actionConfirm(action: SupportAction, kind: SupportKind | null): { title: string; body: string; confirmLabel: string; busyLabel: string } {
  const subject = kind ? SUBJECTS[kind] : "A mensagem";
  if (action === "resolve") {
    return {
      title: "Marcar a mensagem como resolvida?",
      body: `${subject} vai da aba Abertas para Resolvidas, com o seu nome e a hora. Dá para reabrir depois. ${SUPPORT_AUDIT_TEXT}`,
      confirmLabel: "Marcar como resolvida",
      busyLabel: "Marcando...",
    };
  }
  return {
    title: "Reabrir a mensagem?",
    body: `${subject} volta para a aba Abertas, sem quem resolveu. ${SUPPORT_AUDIT_TEXT}`,
    confirmLabel: "Reabrir",
    busyLabel: "Reabrindo...",
  };
}

/** O aviso depois da ação: "Mensagem de Renata resolvida."; sem o nome, "Mensagem resolvida.". */
export function actionDoneText(action: SupportAction, name: string | null): string {
  const what = name ? `Mensagem de ${name}` : "Mensagem";
  return action === "resolve" ? `${what} resolvida.` : `${what} reaberta.`;
}

/** A mensagem saiu do servidor (a conta foi excluída, por exemplo): o card sai da lista. */
export function isMessageGone(reason: string | null): boolean {
  return reason === "message-not-found";
}
