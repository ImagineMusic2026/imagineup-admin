import { Badge } from "@/components/ui/badge";
import { cx } from "@/components/ui/cx";

/**
 * Selo de situação. Nunca lima (lima é só pontos): ciano para no ar, ativo e
 * entregue; `muted` para rascunho e agendado; `danger` para recusado,
 * oculto, suspenso e encerrado. O texto diz a situação; a cor só acompanha.
 */
export type StatusTone = "cyan" | "muted" | "danger" | "neutral";

export interface StatusStyle {
  label: string;
  tone: StatusTone;
  /** Ponto colorido antes do texto. */
  dot?: boolean;
}

const DOTS: Record<StatusTone, string> = {
  cyan: "bg-cyan",
  muted: "bg-fg/45",
  danger: "bg-danger",
  neutral: "bg-fg/70",
};

export function StatusChip<S extends string>({ status, map }: { status: S; map: Record<S, StatusStyle> }) {
  const style = map[status];
  if (!style) return <Badge tone="muted">{status}</Badge>;
  return (
    <Badge tone={style.tone}>
      {style.dot ? <span aria-hidden="true" className={cx("size-1.5 rounded-full", DOTS[style.tone])} /> : null}
      {style.label}
    </Badge>
  );
}
