import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from "lucide-react";

import { cx } from "@/components/ui/cx";
import type { Delta } from "@/lib/format";

/**
 * Cartões de número: rótulo pequeno em caixa alta, valor grande em Sora com
 * `tabular-nums` e uma linha de apoio. A fileira é uma lista de definições
 * (`<dl>`): o leitor de tela ouve o rótulo e depois o valor.
 */
export function MetricGrid({ columns = 4, className, children }: { columns?: 2 | 3 | 4; className?: string; children: React.ReactNode }) {
  return (
    <dl
      className={cx(
        "m-0 grid gap-3 sm:grid-cols-2",
        columns === 3 && "xl:grid-cols-3",
        columns === 4 && "xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </dl>
  );
}

/** `points` é o único tom com lima (pontos); `accent` usa o ciano. */
export type MetricTone = "default" | "points" | "accent";

const VALUE_TONES: Record<MetricTone, string> = {
  default: "text-fg",
  points: "text-lime",
  accent: "text-cyan",
};

const DELTA_STYLES: Record<Delta["direction"], { className: string; Icon: typeof Minus }> = {
  up: { className: "text-cyan", Icon: ArrowUpRight },
  down: { className: "text-danger", Icon: ArrowDownRight },
  flat: { className: "text-fg/60", Icon: Minus },
  new: { className: "text-fg/60", Icon: Sparkles },
};

/** A variação ao lado do número: seta e texto curto à vista, a frase inteira para o leitor de tela. */
export function DeltaBadge({ delta }: { delta: Delta }) {
  const { className, Icon } = DELTA_STYLES[delta.direction];
  return (
    <span className={cx("inline-flex items-center gap-0.5 text-[12.5px] font-semibold tabular-nums", className)}>
      <Icon aria-hidden="true" className="size-3.5" />
      <span aria-hidden="true">{delta.short}</span>
      <span className="sr-only">{delta.text}</span>
    </span>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  tone = "default",
  delta,
  hint,
  loading = false,
}: {
  label: string;
  value: React.ReactNode;
  /** Unidade pequena ao lado do valor ("pts", "por dia"). */
  unit?: string;
  tone?: MetricTone;
  delta?: Delta | null;
  /** Linha de apoio embaixo. */
  hint?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4">
      <dt className="group-label text-fg/55">{label}</dt>
      <dd className="m-0 mt-2.5 flex min-w-0 flex-col gap-2">
        {loading ? (
          <>
            <span className="sr-only">Carregando</span>
            <span aria-hidden="true" className="block h-7 w-24 animate-pulse rounded-md bg-fg/[0.07]" />
            <span aria-hidden="true" className="block h-3.5 w-36 animate-pulse rounded bg-fg/[0.05]" />
          </>
        ) : (
          <>
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={cx("font-display text-[28px] leading-none font-semibold tabular-nums", VALUE_TONES[tone])}>
                {value}
              </span>
              {unit ? <span className="text-[13px] font-medium text-fg/55">{unit}</span> : null}
              {delta ? <DeltaBadge delta={delta} /> : null}
            </span>
            {hint ? <span className="text-[12.5px] leading-snug text-fg/60">{hint}</span> : null}
          </>
        )}
      </dd>
    </div>
  );
}
