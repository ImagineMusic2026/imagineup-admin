/**
 * Dias, semanas e meses de São Paulo, puro. É o espelho de
 * `imagineup-app/functions/src/day.ts`: os agregados (`statsDaily`), o extrato
 * e os períodos das missões contam pelo mesmo relógio. Mudou lá, mude aqui e
 * nos testes (`tests/day.test.mjs`).
 *
 * Os períodos das telas de números terminam ontem (o último dia que o
 * fechamento das 00:20 já somou) e têm 7, 30 ou 90 dias.
 */

export const TIME_ZONE = "America/Sao_Paulo";

/** O primeiro dia com perfil de fã (o mesmo `STATS_FIRST_DAY` do fechamento, 26.3). */
export const STATS_FIRST_DAY = "2026-09-29";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** O dia de São Paulo de um instante, `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  return dayFormatter.format(new Date(ms));
}

function dayParts(day: string): [number, number, number] {
  const [year, month, date] = day.split("-").map(Number);
  return [year, month, date];
}

/** `day` andando `delta` dias no calendário (conta de calendário, sem fuso). */
export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** Dias de `from` até `to`, contando os dois (0 quando `to` vem antes). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = dayParts(from);
  const [y2, m2, d2] = dayParts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS) + 1;
}

/**
 * O instante em que começa o dia de São Paulo `day`. Procura a hora cheia, a
 * partir da meia-noite UTC do dia, em que o `dayKey` vira (os fusos do Brasil
 * são de horas cheias), sem supor o deslocamento.
 */
export function dayStartMs(day: string): number {
  const [year, month, date] = dayParts(day);
  const utcMidnight = Date.UTC(year, month - 1, date);
  for (let hour = -14; hour <= 14; hour += 1) {
    const at = utcMidnight + hour * HOUR_MS;
    if (dayKey(at) === day && dayKey(at - HOUR_MS) !== day) return at;
  }
  throw new RangeError(`Não achei o começo do dia ${day}.`);
}

/** Dia da semana ISO do dia de calendário: 1 é segunda, 7 é domingo. */
export function isoWeekday(day: string): number {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay() || 7;
}

/** Semana ISO do dia de calendário, `2026-W41`. */
export function weekKey(day: string): string {
  const [year, month, date] = dayParts(day);
  const thursday = new Date(Date.UTC(year, month - 1, date));
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const isoYear = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Mês do dia de calendário, `2026-10`. */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}

/** Os 7 dias (segunda a domingo) da semana ISO `2026-W41`. */
export function isoWeekDays(week: string): string[] {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) throw new RangeError(`Semana fora do formato: ${week}`);
  const year = Number(match[1]);
  const number = Number(match[2]);
  // O 4 de janeiro está sempre na semana 1.
  const january4 = `${year}-01-04`;
  const monday = shiftDay(january4, 1 - isoWeekday(january4) + (number - 1) * 7);
  return Array.from({ length: 7 }, (_, index) => shiftDay(monday, index));
}

/** A semana ISO `delta` semanas depois de `week`. */
export function shiftWeek(week: string, delta: number): string {
  return weekKey(shiftDay(isoWeekDays(week)[0], delta * 7));
}

/** Os dias do mês `2026-10`. */
export function monthDays(month: string): string[] {
  const [year, number] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({ length }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

/** Faixa de dias de calendário, os dois extremos incluídos. */
export interface DayRange {
  from: string;
  to: string;
}

/** Os `days` dias que terminam ontem (o último dia que o fechamento já pode ter somado). */
export function rangeEndingYesterday(days: number, now: number): DayRange {
  const to = shiftDay(dayKey(now), -1);
  return { from: shiftDay(to, -(days - 1)), to };
}

/** O período de mesmo tamanho logo antes de `range`. */
export function previousRange(range: DayRange): DayRange {
  const length = daysBetween(range.from, range.to);
  const to = shiftDay(range.from, -1);
  return { from: shiftDay(to, -(length - 1)), to };
}

/** O período de mesmo tamanho que começa em `from`. */
export function rangeStartingAt(from: string, length: number): DayRange {
  return { from, to: shiftDay(from, length - 1) };
}

/** Os dias da faixa, em ordem. */
export function daysOf(range: DayRange): string[] {
  const length = daysBetween(range.from, range.to);
  return Array.from({ length: Math.max(0, length) }, (_, index) => shiftDay(range.from, index));
}

/** A menor faixa que cobre as duas. */
export function spanOf(a: DayRange, b: DayRange): DayRange {
  return { from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
}

const localFormatters = new Map<string, Intl.DateTimeFormat>();

function localFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = localFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    localFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Data e hora local de um instante no fuso dado, no formato do `datetime-local`: `2026-11-21T22:00`. */
export function msToLocal(ms: number, timeZone: string = TIME_ZONE): string {
  const parts = Object.fromEntries(localFormatter(timeZone).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * O instante da data e hora local `2026-11-21T22:00` no fuso dado (o do show,
 * ou São Paulo). Hora que não existe no fuso (o pulo do horário de verão) cai
 * na seguinte; `null` fora do formato.
 */
export function localToMs(local: string, timeZone: string = TIME_ZONE): number | null {
  const match = LOCAL_PATTERN.exec(local);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(asUtc)) return null;
  // Duas passadas pelo deslocamento do fuso: a segunda acerta quando ele muda perto da hora.
  let guess = asUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = Date.parse(`${msToLocal(guess, timeZone)}:00Z`);
    guess += asUtc - shown;
  }
  return guess;
}
