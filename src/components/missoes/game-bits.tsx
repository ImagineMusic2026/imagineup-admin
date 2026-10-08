"use client";

import {
  ArrowDown,
  ArrowUp,
  Award,
  CalendarCheck,
  Flame,
  Heart,
  MessageCircle,
  RefreshCw,
  Share2,
  Star,
  Ticket,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/notice";
import type { AchievementTone } from "@/lib/achievements";
import { REASON_MESSAGES } from "@/lib/errors";

/** A configuração mudou por fora: a frase combinada e o "Recarregar dados", que refaz o formulário. */
export function ConfigChangedNotice({ onReload, busy }: { onReload: () => void; busy: boolean }) {
  return (
    <Notice tone="info">
      <span className="flex flex-col items-start gap-2.5">
        <span>{REASON_MESSAGES["config-changed"]}</span>
        <Button size="sm" variant="secondary" busy={busy} onClick={onReload}>
          <RefreshCw aria-hidden="true" className="size-3.5" />
          {busy ? "Recarregando..." : "Recarregar dados"}
        </Button>
      </span>
    </Notice>
  );
}

const ICONS: Record<string, LucideIcon> = {
  star: Star,
  trophy: Trophy,
  flame: Flame,
  share: Share2,
  comment: MessageCircle,
  heart: Heart,
  ticket: Ticket,
  calendar: CalendarCheck,
  users: Users,
};

/** As cores do app (rosa ação, lima pontos, ciano shows), só no ícone da conquista. */
const TONE_CLASSES: Record<AchievementTone, string> = {
  action: "border-pink/40 bg-pink/10 text-pink",
  points: "border-lime/40 bg-lime/10 text-lime",
  events: "border-cyan/40 bg-cyan/10 text-cyan",
};

/** O ícone da conquista na cor dela, como o app desenha (chave desconhecida vira o genérico). */
export function AchievementBadgeIcon({ icon, tone, className }: { icon: string; tone: AchievementTone; className?: string }) {
  const Icon = ICONS[icon] ?? Award;
  return (
    <span aria-hidden="true" className={cx("grid size-9 shrink-0 place-items-center rounded-full border", TONE_CLASSES[tone], className)}>
      <Icon className="size-[18px]" />
    </span>
  );
}

export function iconOf(icon: string): LucideIcon {
  return ICONS[icon] ?? Award;
}

const ORDER_BUTTON =
  "grid size-8 place-items-center rounded-lg border border-line text-fg/75 transition-colors hover:border-fg/30 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 aria-disabled:cursor-wait aria-disabled:opacity-60";

export type MoveDirection = "up" | "down";

/**
 * Subir e Descer de uma linha. Ocupados (a mudança anterior ainda salvando),
 * ficam com `aria-disabled` e continuam focáveis: o foco não cai no começo da
 * página entre um toque e outro. Nas pontas, `disabled` de verdade.
 */
export function OrderButtons({
  id,
  name,
  first,
  last,
  busy,
  onMove,
}: {
  id: string;
  name: string;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (direction: MoveDirection) => void;
}) {
  return (
    <>
      <button
        type="button"
        data-order-button={`${id}:up`}
        disabled={first}
        aria-disabled={busy || undefined}
        onClick={() => !busy && onMove("up")}
        aria-label={`Subir ${name}`}
        title="Subir"
        className={ORDER_BUTTON}
      >
        <ArrowUp aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        data-order-button={`${id}:down`}
        disabled={last}
        aria-disabled={busy || undefined}
        onClick={() => !busy && onMove("down")}
        aria-label={`Descer ${name}`}
        title="Descer"
        className={ORDER_BUTTON}
      >
        <ArrowDown aria-hidden="true" className="size-4" />
      </button>
    </>
  );
}

/**
 * Depois de mover, a linha muda de lugar e o botão pode perder o foco: ele
 * volta para o mesmo botão (ou para o outro, se este ficou desligado na ponta).
 * Peça junto com a troca da ordem na tela, para o efeito rodar depois dela.
 */
export function useOrderFocus(): (target: { id: string; direction: MoveDirection }) => void {
  const [target, setTarget] = useState<{ id: string; direction: MoveDirection; key: number } | null>(null);
  useEffect(() => {
    if (!target) return;
    const find = (direction: MoveDirection) =>
      document.querySelector<HTMLButtonElement>(`[data-order-button="${CSS.escape(`${target.id}:${direction}`)}"]`);
    const same = find(target.direction);
    const button = same && !same.disabled ? same : find(target.direction === "up" ? "down" : "up");
    if (button && document.activeElement !== button) button.focus();
  }, [target]);
  return (next) => setTarget((current) => ({ ...next, key: (current?.key ?? 0) + 1 }));
}
