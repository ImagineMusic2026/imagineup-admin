/**
 * Formatos de número, data e hora das telas, em pt-BR e no fuso de São Paulo.
 * Puro (sem Firebase, sem React), para os testes rodarem no Node. Um `Intl`
 * por formato, criado uma vez no módulo.
 *
 * Os dias de pontos (`YYYY-MM-DD`, de `day.ts`) são dias de calendário e são
 * formatados sem fuso; os instantes (`Date`) são formatados em São Paulo.
 */

export const TIME_ZONE = "America/Sao_Paulo";

const NUMBER = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** "12.480". Arredonda para inteiro. */
export function formatNumber(value: number): string {
  return NUMBER.format(Math.round(value) || 0);
}

/** "12,5" (até uma casa), para médias. */
export function formatDecimal(value: number): string {
  return DECIMAL.format(value || 0);
}

/** "1.234 pts", "1 pt". */
export function formatPoints(value: number): string {
  const rounded = Math.round(value) || 0;
  return `${NUMBER.format(rounded)} ${Math.abs(rounded) === 1 ? "pt" : "pts"}`;
}

/** "+100", "-50", "0": a variação de um contador, com o sinal sempre escrito. */
export function formatSigned(value: number): string {
  const rounded = Math.round(value) || 0;
  return rounded > 0 ? `+${NUMBER.format(rounded)}` : NUMBER.format(rounded);
}

/** Razão como porcentagem: 0,125 vira "12,5%". Até uma casa, sem ",0". */
export function formatPercent(ratio: number): string {
  return `${DECIMAL.format((ratio || 0) * 100)}%`;
}

export type DeltaDirection = "up" | "down" | "flat" | "new";

export interface Delta {
  direction: DeltaDirection;
  /** Curto, ao lado do número: "+12%", "-3,5%", "igual", "novo". */
  short: string;
  /** Por extenso, para a dica e o leitor de tela: "12% a mais que os 30 dias anteriores". */
  text: string;
}

/**
 * Variação de um número contra o período anterior. `comparison` completa a
 * frase: "os 30 dias anteriores". Sem nada antes, a variação não é uma
 * porcentagem: "novo" com "Nada em {comparison}.".
 */
export function formatDelta(current: number, previous: number, comparison: string): Delta {
  if (previous === 0) {
    if (current === 0) return { direction: "flat", short: "igual", text: `Igual a ${comparison}.` };
    return { direction: "new", short: "novo", text: `Nada em ${comparison}.` };
  }
  const change = (current - previous) / Math.abs(previous);
  const percent = formatPercent(Math.abs(change));
  if (percent === "0%") return { direction: "flat", short: "igual", text: `Igual a ${comparison}.` };
  if (change > 0) return { direction: "up", short: `+${percent}`, text: `${percent} a mais que ${comparison}.` };
  return { direction: "down", short: `-${percent}`, text: `${percent} a menos que ${comparison}.` };
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const SP_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  /** 0 é domingo. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia de calendário (`YYYY-MM-DD`) ou o dia de São Paulo de um instante. */
function calendarOf(value: Date | string): CalendarParts {
  if (typeof value === "string") {
    const [year, month, day] = value.split("-").map(Number);
    return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
  }
  const parts = Object.fromEntries(SP_PARTS.formatToParts(value).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/** "2 ago", ou "2 ago 2025" quando o ano é outro que o de `now`. */
export function formatDay(value: Date | string, now: Date = new Date()): string {
  const date = calendarOf(value);
  const base = `${date.day} ${MONTHS[date.month - 1]}`;
  return date.year === calendarOf(now).year ? base : `${base} ${date.year}`;
}

/** "sáb, 4 out": o rótulo de um dia nos gráficos. */
export function formatWeekdayDay(value: Date | string, now: Date = new Date()): string {
  return `${WEEKDAYS[calendarOf(value).weekday]}, ${formatDay(value, now)}`;
}

/** "de 8 set a 7 out"; no mesmo mês, "de 1 a 7 out". */
export function formatDayRange(from: Date | string, to: Date | string, now: Date = new Date()): string {
  const start = calendarOf(from);
  const end = calendarOf(to);
  if (start.year === end.year && start.month === end.month) return `de ${start.day} a ${formatDay(to, now)}`;
  return `de ${formatDay(from, now)} a ${formatDay(to, now)}`;
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

/** "6 de outubro, 14:30", no fuso de São Paulo (o mesmo do e-mail do convite). */
export function formatDateTime(date: Date): string {
  const parts = Object.fromEntries(DATE_TIME_FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day} de ${parts.month}, ${parts.hour}:${parts.minute}`;
}

const TIME_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

/** "14:32", em São Paulo. */
export function formatTime(date: Date): string {
  return TIME_FORMAT.format(date);
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "agora", "há 5 min", "há 3 h", "há 2 dias"; de 30 dias para trás, a data. */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return "agora";
  if (diff < HOUR) return `há ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  if (days < 30) return `há ${days} ${days === 1 ? "dia" : "dias"}`;
  return formatDay(date, now);
}

/** Junta itens em português: "a", "a e b", "a, b e c". */
export function joinPt(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** "1 fã", "3 fãs": número com a palavra no singular ou no plural. */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${Math.abs(count) === 1 ? singular : plural}`;
}
