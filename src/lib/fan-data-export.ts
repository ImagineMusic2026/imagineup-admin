import { callableErrorMessage, readError, serverMessageOf } from "@/lib/errors";

/**
 * Pedidos de dados de um fã pela LGPD (seção 32 da nota do app), puro: a
 * exportação em partes (32.2 e 32.3), o arquivo montado no navegador e os
 * textos dos dois diálogos. A busca das páginas vem injetada, para o teste
 * rodar no Node sem o Firebase.
 *
 * Nada daqui guarda o arquivo, o e-mail digitado ou o uid: eles vivem só no
 * estado do diálogo e somem quando ele fecha.
 */

/** O começo do arquivo, como a primeira chamada devolve (32.3), mais a lista das partes. */
export type FanDataStart = Record<string, unknown> & {
  uid: string;
  geradoEm: string;
  partes: string[];
};

/** O pedido de uma página: sem a chave `after` na primeira (o SDK manda `undefined` como `null`, 32.17). */
export interface FanDataPageRequest {
  uid: string;
  part: string;
  after?: string;
}

export interface FanDataPage {
  part: string;
  items: unknown[];
  /** O id do último documento (o caminho, nos comentários), devolvido como veio; `null` fecha a parte. */
  after: string | null;
}

/** O nome de cada parte no progresso; a parte que o painel não conhece aparece pelo nome cru. */
export const FAN_DATA_PART_LABELS: Record<string, string> = {
  extrato: "extrato",
  pontosPorCentral: "pontos por central",
  centrais: "centrais",
  curtidas: "curtidas",
  presencas: "presenças",
  comentarios: "comentários",
  linksDeConvite: "links de convite",
  pedidosDaLoja: "pedidos da loja",
};

export function partLabel(part: string): string {
  return Object.prototype.hasOwnProperty.call(FAN_DATA_PART_LABELS, part) ? FAN_DATA_PART_LABELS[part] : part;
}

/** O progresso no texto do `role="status"`. */
export function exportProgressText(part: string): string {
  return `Juntando os dados: ${partLabel(part)}`;
}

/** A resposta da primeira chamada conferida: o `uid` pedido, a data e a lista das partes em texto. */
export function parseFanDataStart(value: unknown, uid: string): FanDataStart {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A resposta da exportação veio num formato inesperado.");
  const start = value as Record<string, unknown>;
  const parts = start.partes;
  if (start.uid !== uid || typeof start.geradoEm !== "string" || !Array.isArray(parts) || !parts.every((part) => typeof part === "string")) {
    throw new Error("A resposta da exportação veio num formato inesperado.");
  }
  return start as FanDataStart;
}

export function pageRequest(uid: string, part: string, after: string | null): FanDataPageRequest {
  return after === null ? { uid, part } : { uid, part, after };
}

/** Onde a exportação está: a parte da vez, o `after` dentro dela e o que já chegou. */
export interface ExportProgress {
  index: number;
  after: string | null;
  items: Record<string, unknown[]>;
}

export function newExportProgress(): ExportProgress {
  return { index: 0, after: null, items: {} };
}

export type FetchPage = (request: FanDataPageRequest) => Promise<FanDataPage>;

/**
 * Percorre as partes do `start`, na ordem, e cada parte até o `after` `null`.
 * O progresso só anda depois de uma página que chegou inteira: se uma página
 * falha, a mesma chamada com o mesmo `progress` continua dali, sem outra
 * primeira chamada (que contaria no teto e entraria nos Logs). `stopped` é
 * conferido antes de cada página e de novo no fim: o "Parar" durante a última
 * página também descarta o arquivo.
 */
export async function collectFanData(
  start: FanDataStart,
  progress: ExportProgress,
  fetchPage: FetchPage,
  hooks: { onPart?: (part: string) => void; stopped?: () => boolean } = {},
): Promise<"done" | "stopped"> {
  while (progress.index < start.partes.length) {
    const part = start.partes[progress.index];
    hooks.onPart?.(part);
    if (hooks.stopped?.()) return "stopped";
    const page = await fetchPage(pageRequest(start.uid, part, progress.after));
    if (!page || page.part !== part || !Array.isArray(page.items) || (page.after !== null && typeof page.after !== "string")) {
      throw new Error("Uma página da exportação veio num formato inesperado.");
    }
    // O mesmo cursor de volta repetiria a página para sempre.
    if (page.after !== null && page.after === progress.after) throw new Error("A exportação não avançou numa parte.");
    progress.items[part] = [...(progress.items[part] ?? []), ...page.items];
    if (page.after === null) {
      progress.index += 1;
      progress.after = null;
    } else {
      progress.after = page.after;
    }
  }
  return hooks.stopped?.() ? "stopped" : "done";
}

/** O arquivo: o começo na ordem em que veio, sem o `partes`, e cada parte como lista (a vazia vira `[]`). */
export function buildFanDataFile(start: FanDataStart, items: Record<string, unknown[]>): Record<string, unknown> {
  const file: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(start)) {
    if (key !== "partes") file[key] = value;
  }
  for (const part of start.partes) file[part] = items[part] ?? [];
  return file;
}

/** `imagineup-dados-<uid>-<AAAA-MM-DD>.json`, com a data do `geradoEm` (UTC, como as datas do arquivo). */
export function fanDataFileName(uid: string, generatedAt: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : "sem-data";
  return `imagineup-dados-${uid}-${day}.json`;
}

export function fanDataFileText(file: Record<string, unknown>): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** O único dado do arquivo que a tela lê: sem o e-mail confirmado no cadastro, o arquivo espera a resposta da caixa (7.4, passo 6). */
export function emailUnconfirmed(start: FanDataStart): boolean {
  const account = start.conta;
  return !(account && typeof account === "object" && (account as { emailConfirmado?: unknown }).emailConfirmado === true);
}

// Textos (32.6, itens 4 a 6).

export const DATA_REQUEST_TEXT =
  "Use só depois de confirmar o pedido pelo e-mail da conta. A cópia dos dados sai em até 15 dias. A exclusão sai na hora, ou a pessoa recebe o motivo.";
export const DATA_REQUEST_SELF_TEXT = "Esta ficha é da sua conta. Você não exporta nem exclui a própria conta pelo painel.";

export const EXPORT_DESCRIPTION =
  "O arquivo sai em JSON, com os dados da conta no app. Ele é montado no seu navegador e não fica guardado no servidor nem no painel.";
export const EXPORT_PAGE_ERROR_TEXT = "Não deu para buscar os dados. Tente de novo.";
export const EXPORT_UNCERTAIN_TEXT = "O servidor não respondeu. Se tentar de novo, a exportação pode contar duas vezes no limite do dia.";
export const EXPORT_DONE_TEXT = "Mande o arquivo numa mensagem nova ao e-mail da conta e apague a cópia baixada.";
export const EXPORT_UNCONFIRMED_TEXT =
  "O e-mail desta conta não foi confirmado no cadastro. Mande o arquivo só depois que a pessoa responder da caixa desse e-mail.";

export const DELETE_DESCRIPTION = "A conta sai na hora, e os dados são apagados em seguida. Não tem volta.";
/** O que se perde, as quatro linhas do `deleteAccount.losses` do app, ditas sobre o fã. */
export const DELETE_LOSSES = [
  "O perfil: nome, foto, @, bio, cidade e redes. O @ fica livre para outra pessoa.",
  "Os pontos: o saldo, o nível e as conquistas.",
  "A posição no ranking e as centrais que o fã segue.",
  "Os resgates: os que ainda não foram entregues são cancelados, e os pontos não voltam.",
] as const;
export const DELETE_LOSSES_TITLE = "O que a pessoa perde";
export const DELETE_LOSSES_NOTE = "Mande esta lista ao e-mail da conta antes, e só exclua com a resposta dessa caixa.";
export const DELETE_UNCERTAIN_TEXT = "Não deu para confirmar se a conta saiu. Tente de novo.";
export const DELETED_TEXT = "A conta saiu. Os dados são apagados em seguida.";
export const DELETE_PENDING_TEXT = "A conta já saiu. Os dados estão sendo apagados.";
export const DELETE_GONE_TEXT = "A conta já saiu.";

/** A frase dos pedidos de dados quando o servidor não manda a dele: o `email-mismatch` daqui não é o do convite. */
const DATA_REQUEST_REASON_MESSAGES: Record<string, string> = {
  "email-mismatch": "Este e-mail não é o da conta deste fã. Confira o e-mail do pedido.",
};

/** A recusa de um pedido de dados: a frase do servidor, senão a deste mapa, senão a de sempre. */
export function dataRequestErrorMessage(error: unknown): string {
  const info = readError(error);
  if (info.code.startsWith("functions/")) {
    const fromServer = serverMessageOf(info);
    if (fromServer) return fromServer;
  }
  if (info.reason && DATA_REQUEST_REASON_MESSAGES[info.reason]) return DATA_REQUEST_REASON_MESSAGES[info.reason];
  return callableErrorMessage(error);
}
