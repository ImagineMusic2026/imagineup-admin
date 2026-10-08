"use client";

import { useId, useRef, useState } from "react";

import { cx } from "@/components/ui/cx";

/**
 * Gráficos de barras em SVG inline, sem biblioteca e sem animação de entrada.
 *
 * Cores: barras em branco a 20%, a parte (os cadastros por convite dentro dos
 * cadastros) e o destaque em ciano; lima só quando a série é de pontos. O dia
 * parcial (hoje até agora) tem contorno, sem preenchimento.
 *
 * Acessibilidade: o conjunto é um `role="group"` com o título e o resumo no
 * nome; cada barra é um alvo de foco com `role="img"` e o próprio nome
 * ("sáb, 4 out: 34 cadastros, 12 por convite"), num ponto só da ordem do Tab
 * (tabindex móvel), com as setas, Home e End entre as barras. O valor da barra
 * sob o ponteiro ou o foco aparece na legenda embaixo, sem dica flutuante.
 */

export interface BarPoint {
  key: string;
  /** Rótulo curto no eixo ("4 out"). */
  label: string;
  /** Por extenso, no foco e na legenda ("sáb, 4 out"); sem ele, o `label`. */
  longLabel?: string;
  value: number;
  /** Parte da barra pintada em ciano (os cadastros por convite dentro dos cadastros). */
  part?: number;
  /** Somado no navegador (hoje até agora, ou ontem antes do fechamento): contorno, sem preenchimento. */
  partial?: boolean;
  /** Sem número (dia não fechado): sem barra. */
  missing?: boolean;
}

export type ChartTone = "default" | "points";

const SLOT = 10;
const TOP = 100;
const MAX_AXIS_LABELS = 7;

/** Até 7 rótulos no eixo, espalhados, sempre com o primeiro e o último. */
export function axisIndexes(count: number, max: number = MAX_AXIS_LABELS): Set<number> {
  if (count <= max) return new Set(Array.from({ length: count }, (_, index) => index));
  const step = Math.ceil((count - 1) / (max - 1));
  const indexes = new Set<number>();
  for (let index = 0; index < count - 1; index += step) indexes.add(index);
  // O último entra sempre; o penúltimo escolhido sai se ficaria colado nele.
  const last = count - 1;
  for (const index of indexes) if (index !== 0 && last - index < step / 2) indexes.delete(index);
  indexes.add(last);
  return indexes;
}

function barHeight(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1.5, (value / max) * (TOP - 4));
}

/** Tabindex móvel: setas, Home e End levam o foco a outra barra. */
function useRovingBars(count: number) {
  const [active, setActive] = useState(count - 1);
  const [focused, setFocused] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // A legenda segue a última interação: o foco do teclado ou o ponteiro.
  const [last, setLast] = useState<"focus" | "hover">("focus");
  const refs = useRef<(SVGGElement | null)[]>([]);
  const tabStop = Math.max(0, Math.min(active, count - 1));

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(count - 1, index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }

  return {
    tabStop,
    focused,
    hovered,
    shown: last === "focus" ? (focused ?? hovered) : (hovered ?? focused),
    bind(index: number) {
      return {
        ref: (element: SVGGElement | null) => {
          refs.current[index] = element;
        },
        tabIndex: index === tabStop ? 0 : -1,
        onKeyDown: (event: React.KeyboardEvent) => onKeyDown(event, index),
        onFocus: () => {
          setActive(index);
          setFocused(index);
          setLast("focus");
        },
        onBlur: () => setFocused((current) => (current === index ? null : current)),
        onPointerEnter: () => {
          setHovered(index);
          setLast("hover");
        },
        onPointerLeave: () => setHovered((current) => (current === index ? null : current)),
      };
    },
  };
}

function AxisLabels({ labels }: { labels: string[] }) {
  const shown = axisIndexes(labels.length);
  return (
    <div aria-hidden="true" className="flex text-[11.5px] text-fg/50 tabular-nums">
      {labels.map((label, index) => (
        <span
          key={index}
          className={cx(
            "min-w-0 flex-1 whitespace-nowrap",
            index === 0 ? "text-left" : index === labels.length - 1 ? "text-right" : "text-center",
          )}
        >
          {shown.has(index) ? label : ""}
        </span>
      ))}
    </div>
  );
}

export function BarChart({
  title,
  summary,
  series,
  tone = "default",
  describe,
  highlight = null,
  className,
}: {
  /** Nome do gráfico para o leitor de tela (o título visível fica no cartão). */
  title: string;
  /** Resumo dito junto do nome ("30 dias, 1.204 cadastros no total"). */
  summary?: string;
  series: BarPoint[];
  tone?: ChartTone;
  /** O valor de uma barra por extenso: "34 cadastros, 12 por convite". */
  describe: (point: BarPoint) => string;
  /** A barra em destaque (ciano, ou lima nos pontos). */
  highlight?: string | null;
  className?: string;
}) {
  const roving = useRovingBars(series.length);
  const max = Math.max(0, ...series.map((point) => point.value));
  const width = Math.max(1, series.length) * SLOT;
  const legendPoint = series[roving.shown ?? series.length - 1];
  const base = tone === "points" ? "fill-lime/70" : "fill-fg/20";
  const strong = tone === "points" ? "fill-lime" : "fill-cyan";
  const outline = tone === "points" ? "stroke-lime" : "stroke-fg/60";

  function nameOf(point: BarPoint): string {
    const when = point.longLabel ?? point.label;
    if (point.missing) return `${when}: dia ainda não fechado`;
    return `${when}: ${describe(point)}${point.partial ? " (parcial)" : ""}`;
  }

  return (
    <div role="group" aria-label={summary ? `${title}. ${summary}` : title} className={cx("flex flex-col gap-2", className)}>
      <svg
        role="presentation"
        viewBox={`0 0 ${width} ${TOP}`}
        preserveAspectRatio="none"
        className="block h-44 w-full overflow-visible"
      >
        <line x1={0} x2={width} y1={TOP} y2={TOP} className="stroke-fg/15" vectorEffect="non-scaling-stroke" />
        {series.map((point, index) => {
          const x = index * SLOT;
          const height = point.missing ? 0 : barHeight(point.value, max);
          const partHeight = point.part ? Math.min(height, barHeight(point.part, max)) : 0;
          const isHighlight = highlight === point.key;
          const isShown = roving.shown === index;
          return (
            <g key={point.key} role="img" aria-label={nameOf(point)} className="cursor-default outline-none" {...roving.bind(index)}>
              <rect x={x} y={0} width={SLOT} height={TOP} className={isShown ? "fill-fg/[0.05]" : "fill-transparent"} />
              {point.partial ? (
                <rect
                  x={x + 1.5}
                  y={TOP - height}
                  width={SLOT - 3}
                  height={height}
                  className={cx("fill-none", outline)}
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <rect x={x + 1.5} y={TOP - height} width={SLOT - 3} height={height} className={isHighlight ? strong : base} />
              )}
              {partHeight > 0 && !point.partial ? (
                <rect x={x + 1.5} y={TOP - partHeight} width={SLOT - 3} height={partHeight} className="fill-cyan" />
              ) : null}
              {roving.focused === index ? (
                <rect
                  x={x + 0.5}
                  y={0.5}
                  width={SLOT - 1}
                  height={TOP - 1}
                  className="fill-none stroke-pink"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <AxisLabels labels={series.map((point) => point.label)} />
      {legendPoint ? (
        <p aria-hidden="true" className="m-0 min-h-5 text-[12.5px] text-fg/75 tabular-nums">
          {nameOf(legendPoint)}
        </p>
      ) : null}
    </div>
  );
}

export interface CompareGroup {
  key: string;
  label: string;
  longLabel?: string;
}

export interface CompareSeries {
  key: string;
  label: string;
  /** Um valor por grupo, na mesma ordem; `null` é sem número (o estoque sem retrato), sem barra. */
  values: (number | null)[];
}

/** Estilos das 2 ou 3 séries: sólido, claro e listrado (nunca só a cor: a legenda diz qual é qual). */
const SERIES_STYLES: Record<ChartTone, [string, string, string]> = {
  default: ["fill-cyan", "fill-fg/70", ""],
  points: ["fill-lime", "fill-lime/50", ""],
};

/**
 * 2 ou 3 séries lado a lado em cada grupo (dia ou semana): o mesmo foco por
 * grupo do `BarChart`, com todas as séries no nome do grupo.
 */
export function CompareBars({
  title,
  summary,
  groups,
  series,
  tone = "default",
  formatValue,
  className,
}: {
  title: string;
  summary?: string;
  groups: CompareGroup[];
  series: CompareSeries[];
  tone?: ChartTone;
  /** Um valor por extenso: "120 entradas"; `null` é sem número. */
  formatValue: (value: number | null, series: CompareSeries) => string;
  className?: string;
}) {
  const id = useId();
  const patternId = `${id}-listras`;
  const roving = useRovingBars(groups.length);
  const shown = series.slice(0, 3);
  const max = Math.max(0, ...shown.flatMap((item) => item.values.map((value) => value ?? 0)));
  const width = Math.max(1, groups.length) * SLOT;
  const barWidth = (SLOT - 2) / Math.max(1, shown.length);
  const legendGroup = roving.shown ?? groups.length - 1;
  const styles = SERIES_STYLES[tone];
  const stripe = tone === "points" ? "fill-lime" : "fill-cyan";

  function nameOf(index: number): string {
    const group = groups[index];
    if (!group) return "";
    const values = shown.map((item) => `${item.label} ${formatValue(item.values[index] ?? null, item)}`);
    return `${group.longLabel ?? group.label}: ${values.join(", ")}`;
  }

  return (
    <div role="group" aria-label={summary ? `${title}. ${summary}` : title} className={cx("flex flex-col gap-2", className)}>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12.5px] text-fg/75">
        {shown.map((item, index) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <svg aria-hidden="true" viewBox="0 0 10 10" className="size-3 rounded-[2px]">
              {index === 2 ? (
                <>
                  <rect width={10} height={10} className="fill-none stroke-current" />
                  <rect width={10} height={10} fill={`url(#${patternId})`} />
                </>
              ) : (
                <rect width={10} height={10} className={styles[index]} />
              )}
            </svg>
            {item.label}
          </li>
        ))}
      </ul>
      <svg role="presentation" viewBox={`0 0 ${width} ${TOP}`} preserveAspectRatio="none" className="block h-44 w-full overflow-visible">
        <defs>
          <pattern id={patternId} width={2} height={2} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={1} height={2} className={stripe} />
          </pattern>
        </defs>
        <line x1={0} x2={width} y1={TOP} y2={TOP} className="stroke-fg/15" vectorEffect="non-scaling-stroke" />
        {groups.map((group, index) => {
          const x = index * SLOT;
          return (
            <g key={group.key} role="img" aria-label={nameOf(index)} className="cursor-default outline-none" {...roving.bind(index)}>
              <rect x={x} y={0} width={SLOT} height={TOP} className={roving.shown === index ? "fill-fg/[0.05]" : "fill-transparent"} />
              {shown.map((item, at) => {
                const height = barHeight(item.values[index] ?? 0, max);
                if (height === 0) return null;
                return (
                  <rect
                    key={item.key}
                    x={x + 1 + at * barWidth}
                    y={TOP - height}
                    width={Math.max(0.5, barWidth - 0.4)}
                    height={height}
                    className={at === 2 ? undefined : styles[at]}
                    fill={at === 2 ? `url(#${patternId})` : undefined}
                  />
                );
              })}
              {roving.focused === index ? (
                <rect
                  x={x + 0.5}
                  y={0.5}
                  width={SLOT - 1}
                  height={TOP - 1}
                  className="fill-none stroke-pink"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <AxisLabels labels={groups.map((group) => group.label)} />
      <p aria-hidden="true" className="m-0 min-h-5 text-[12.5px] text-fg/75 tabular-nums">
        {nameOf(legendGroup)}
      </p>
    </div>
  );
}
