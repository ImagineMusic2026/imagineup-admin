import { dayKey, dayStartMs, localToMs } from "@/lib/day";
import { formatWeekdayDay } from "@/lib/format";
import { toDate } from "@/lib/staff";
import { isVisibleLine } from "@/lib/visible-line";

/**
 * A agenda das centrais (21 e 26.16), pura: o show lido, os fusos e as UFs
 * (cópia do `DEFAULT_TIME_ZONE_BY_STATE` do servidor), a data no fuso do show
 * e o formulário com a validação do servidor.
 */

export const BRAZIL_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
export type BrazilState = (typeof BRAZIL_STATES)[number];

export const BRAZIL_TIME_ZONES = [
  "America/Noronha",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Araguaina",
  "America/Maceio",
  "America/Bahia",
  "America/Sao_Paulo",
  "America/Campo_Grande",
  "America/Cuiaba",
  "America/Santarem",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Manaus",
  "America/Eirunepe",
  "America/Rio_Branco",
] as const;
export type BrazilTimeZone = (typeof BRAZIL_TIME_ZONES)[number];

/** Cópia do servidor (`agenda/model.ts`): o fuso sugerido pela UF. Mudou lá, mude aqui. */
export const DEFAULT_TIME_ZONE_BY_STATE: Record<BrazilState, BrazilTimeZone> = {
  AC: "America/Rio_Branco",
  AL: "America/Maceio",
  AP: "America/Belem",
  AM: "America/Manaus",
  BA: "America/Bahia",
  CE: "America/Fortaleza",
  DF: "America/Sao_Paulo",
  ES: "America/Sao_Paulo",
  GO: "America/Sao_Paulo",
  MA: "America/Fortaleza",
  MT: "America/Cuiaba",
  MS: "America/Campo_Grande",
  MG: "America/Sao_Paulo",
  PA: "America/Belem",
  PB: "America/Fortaleza",
  PR: "America/Sao_Paulo",
  PE: "America/Recife",
  PI: "America/Fortaleza",
  RJ: "America/Sao_Paulo",
  RN: "America/Fortaleza",
  RS: "America/Sao_Paulo",
  RO: "America/Porto_Velho",
  RR: "America/Boa_Vista",
  SC: "America/Sao_Paulo",
  SP: "America/Sao_Paulo",
  SE: "America/Maceio",
  TO: "America/Araguaina",
};

/** Como a tela chama cada fuso: "horário de Brasília", "horário da Bahia". */
export const TIME_ZONE_LABELS: Record<BrazilTimeZone, string> = {
  "America/Noronha": "horário de Noronha",
  "America/Belem": "horário de Belém",
  "America/Fortaleza": "horário de Fortaleza",
  "America/Recife": "horário de Recife",
  "America/Araguaina": "horário de Araguaína",
  "America/Maceio": "horário de Maceió",
  "America/Bahia": "horário da Bahia",
  "America/Sao_Paulo": "horário de Brasília",
  "America/Campo_Grande": "horário de Campo Grande",
  "America/Cuiaba": "horário de Cuiabá",
  "America/Santarem": "horário de Santarém",
  "America/Porto_Velho": "horário de Porto Velho",
  "America/Boa_Vista": "horário de Boa Vista",
  "America/Manaus": "horário de Manaus",
  "America/Eirunepe": "horário de Eirunepé",
  "America/Rio_Branco": "horário do Acre",
};

export function isTimeZone(value: unknown): value is BrazilTimeZone {
  return typeof value === "string" && (BRAZIL_TIME_ZONES as readonly string[]).includes(value);
}

export function isState(value: unknown): value is BrazilState {
  return typeof value === "string" && (BRAZIL_STATES as readonly string[]).includes(value);
}

export type EventStatus = "draft" | "published" | "unpublished";
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = { draft: "Rascunho", published: "No ar", unpublished: "Fora do ar" };

export const EVENT_TITLE_MAX = 80;
export const EVENT_CITY_MAX = 60;
export const EVENT_VENUE_MAX = 80;
export const EVENT_ARTISTS_MAX = 6;
export const EVENTS_PAGE_SIZE = 25;
/** A foto do show, paisagem 16:9. */
export const EVENT_PHOTO = { width: 1200, height: 675 } as const;

export const RSVPS_HIDDEN_TEXT = "Os confirmados aparecem para quem vê a seção Fãs.";
export const WAS_PUBLISHED_EVENT_TEXT = "Este show já esteve no ar. Tire do ar em vez de apagar.";

export interface AgendaEvent {
  id: string;
  title: string;
  artistIds: string[];
  city: string;
  state: string;
  venue: string | null;
  startsAt: Date | null;
  startsAtLocal: string;
  timeZone: BrazilTimeZone;
  photo: { url: string; path: string } | null;
  featured: boolean;
  status: EventStatus;
  publishedAt: Date | null;
}

export function parseEvent(id: string, data: Record<string, unknown>): AgendaEvent {
  const photo = data.photo && typeof data.photo === "object" ? (data.photo as Record<string, unknown>) : null;
  return {
    id,
    title: typeof data.title === "string" ? data.title : id,
    artistIds: Array.isArray(data.artistIds) ? data.artistIds.filter((item): item is string => typeof item === "string") : [],
    city: typeof data.city === "string" ? data.city : "",
    state: typeof data.state === "string" ? data.state : "",
    venue: typeof data.venue === "string" && data.venue ? data.venue : null,
    startsAt: toDate(data.startsAt),
    startsAtLocal: typeof data.startsAtLocal === "string" ? data.startsAtLocal : "",
    timeZone: isTimeZone(data.timeZone) ? data.timeZone : "America/Sao_Paulo",
    photo: photo && typeof photo.url === "string" && typeof photo.path === "string" ? { url: photo.url, path: photo.path } : null,
    featured: data.featured === true,
    status: data.status === "published" || data.status === "unpublished" ? data.status : "draft",
    publishedAt: toDate(data.publishedAt),
  };
}

/** "sáb, 21 nov, 22:00, horário da Bahia": a hora como a equipe digitou, no fuso do show. */
export function eventWhenText(event: Pick<AgendaEvent, "startsAtLocal" | "timeZone">, now: Date): string {
  const [day, time] = event.startsAtLocal.split("T");
  if (!day || !time) return "Sem data";
  return `${formatWeekdayDay(day, now)}, ${time}, ${TIME_ZONE_LABELS[event.timeZone]}`;
}

/** Ainda por vir: começa de hoje (São Paulo) em diante. */
export function isUpcoming(event: Pick<AgendaEvent, "startsAt">, now: number): boolean {
  return Boolean(event.startsAt && event.startsAt.getTime() >= dayStartMs(dayKey(now)));
}

export function eventDeleteBlocked(event: Pick<AgendaEvent, "publishedAt">): string | null {
  return event.publishedAt ? WAS_PUBLISHED_EVENT_TEXT : null;
}

/** "N posts de show perdem a linha do show." antes de tirar do ar. */
export function unpublishWarning(posts: number): string {
  if (posts === 0) return "Nenhum post aponta para este show.";
  return posts === 1 ? "1 post de show perde a linha do show." : `${posts} posts de show perdem a linha do show.`;
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export interface EventForm {
  title: string;
  artistIds: string[];
  city: string;
  state: BrazilState | "";
  timeZone: BrazilTimeZone | "";
  startsAtLocal: string;
  venue: string;
  featured: boolean;
}

export const EMPTY_EVENT_FORM: EventForm = { title: "", artistIds: [], city: "", state: "", timeZone: "", startsAtLocal: "", venue: "", featured: false };

export function eventFormOf(event: AgendaEvent): EventForm {
  return {
    title: event.title,
    artistIds: [...event.artistIds],
    city: event.city,
    state: isState(event.state) ? event.state : "",
    timeZone: event.timeZone,
    startsAtLocal: event.startsAtLocal,
    venue: event.venue ?? "",
    featured: event.featured,
  };
}

export interface EventInput {
  title: string;
  artistIds: string[];
  city: string;
  state: BrazilState;
  venue: string | null;
  startsAtLocal: string;
  timeZone: BrazilTimeZone;
  featured: boolean;
}

export type EventErrors = Partial<Record<keyof EventForm, string>>;

const DAY_MS = 24 * 60 * 60 * 1000;

function line(value: string, max: number): string | null {
  const text = value.normalize("NFC").trim();
  return text && text.length <= max && isVisibleLine(text) ? text : null;
}

/** Confere como o servidor: título, de 1 a 6 centrais, cidade, UF, fuso, data que existe e não mais de 24 h no passado. */
export function validateEvent(form: EventForm, now: number, creatingOrMoving: boolean): { errors: EventErrors; input: EventInput | null } {
  const errors: EventErrors = {};
  const title = line(form.title, EVENT_TITLE_MAX);
  if (!title) errors.title = `Escreva o título, até ${EVENT_TITLE_MAX} caracteres.`;
  if (form.artistIds.length < 1 || form.artistIds.length > EVENT_ARTISTS_MAX) errors.artistIds = `De 1 a ${EVENT_ARTISTS_MAX} centrais.`;
  const city = line(form.city, EVENT_CITY_MAX);
  if (!city) errors.city = `Escreva a cidade, até ${EVENT_CITY_MAX} caracteres.`;
  if (!form.state) errors.state = "Escolha a UF.";
  if (!form.timeZone) errors.timeZone = "Escolha o fuso.";
  let venue: string | null = null;
  if (form.venue.trim()) {
    venue = line(form.venue, EVENT_VENUE_MAX);
    if (!venue) errors.venue = `Até ${EVENT_VENUE_MAX} caracteres, numa linha.`;
  }
  const at = form.timeZone ? localToMs(form.startsAtLocal, form.timeZone) : null;
  if (!form.startsAtLocal || (form.timeZone && at === null)) errors.startsAtLocal = "Escolha o dia e a hora.";
  else if (creatingOrMoving && at !== null && at < now - DAY_MS) errors.startsAtLocal = "A data já passou.";
  else if (at !== null && at > now + 2 * 366 * DAY_MS) errors.startsAtLocal = "No máximo 2 anos à frente.";
  if (Object.keys(errors).length > 0 || !title || !city || !form.state || !form.timeZone) return { errors, input: null };
  return {
    errors,
    input: { title, artistIds: [...form.artistIds], city, state: form.state, venue, startsAtLocal: form.startsAtLocal, timeZone: form.timeZone, featured: form.featured },
  };
}

/** Só o que mudou, para o `updateEvent`. */
export function eventChanges(event: AgendaEvent, input: EventInput): Partial<EventInput> {
  const changes: Partial<EventInput> = {};
  if (input.title !== event.title) changes.title = input.title;
  if (input.artistIds.join("|") !== event.artistIds.join("|")) changes.artistIds = input.artistIds;
  if (input.city !== event.city) changes.city = input.city;
  if (input.state !== event.state) changes.state = input.state;
  if (input.venue !== event.venue) changes.venue = input.venue;
  if (input.startsAtLocal !== event.startsAtLocal) changes.startsAtLocal = input.startsAtLocal;
  if (input.timeZone !== event.timeZone) changes.timeZone = input.timeZone;
  if (input.featured !== event.featured) changes.featured = input.featured;
  return changes;
}

/** Subir ou descer uma central na lista do show (a primeira é a principal). */
export function moveArtist(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const at = ids.indexOf(id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}
