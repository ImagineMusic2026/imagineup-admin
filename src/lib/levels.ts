/**
 * A régua de níveis (`config/points.levels`), puro. É o espelho do
 * `validLevels` e do `levelForXp` do servidor (`points/config.ts` e
 * `points/model.ts`): o degrau mais alto com `minXp <= xp`.
 *
 * Sem o documento (versão 0, o padrão do código no servidor), o painel não
 * copia a régua padrão: `parseLevels` devolve `null` e a tela diz
 * `NO_LEVELS_TEXT`. Assim a única fonte da régua é o servidor.
 */

export interface Level {
  number: number;
  name: string;
  minXp: number;
}

export interface LevelInfo extends Level {
  /** O degrau seguinte, ou `null` no último. */
  next: Level | null;
  /** XP que falta para o seguinte, ou `null` no último. */
  toNext: number | null;
}

export const NO_LEVELS_TEXT = "Nível sai quando a régua for gravada.";

export const LEVELS_MIN = 2;
export const LEVELS_MAX = 50;
export const LEVEL_NAME_MAX = 40;

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** A régua válida: de 2 a 50 degraus, numerados de 1 em diante, o primeiro em 0 XP e o mínimo sempre subindo. */
export function validLevels(value: unknown): value is Level[] {
  if (!Array.isArray(value) || value.length < LEVELS_MIN || value.length > LEVELS_MAX) return false;
  return value.every((level: unknown, index) => {
    if (!level || typeof level !== "object") return false;
    const item = level as Record<string, unknown>;
    const previous = index === 0 ? null : (value[index - 1] as { minXp?: unknown });
    const name = typeof item.name === "string" ? item.name.trim() : "";
    return (
      item.number === index + 1 &&
      name.length > 0 &&
      name.length <= LEVEL_NAME_MAX &&
      isInt(item.minXp) &&
      (index === 0 ? item.minXp === 0 : isInt(previous?.minXp) && item.minXp > previous.minXp)
    );
  });
}

/** A régua de `config/points` (os dados do documento), ou `null` sem documento, na versão 0 ou fora do formato. */
export function parseLevels(data: Record<string, unknown> | null | undefined): Level[] | null {
  if (!data) return null;
  if (!isInt(data.version) || data.version < 1) return null;
  if (!validLevels(data.levels)) return null;
  return data.levels.map(({ number, name, minXp }) => ({ number, name: name.trim(), minXp }));
}

/** O nível de quem tem `xp` pontos de experiência. */
export function levelOf(xp: number, levels: readonly Level[]): LevelInfo {
  if (levels.length === 0) throw new RangeError("Régua de níveis vazia.");
  const index = levels.reduce((found, level, at) => (xp >= level.minXp ? at : found), 0);
  const level = levels[index];
  const next = levels[index + 1] ?? null;
  return { ...level, next: next ? { ...next } : null, toNext: next ? Math.max(0, next.minXp - xp) : null };
}

/** "Nível 7 · Purainha". */
export function levelLabel(level: Pick<Level, "number" | "name">): string {
  return `Nível ${level.number} · ${level.name}`;
}
