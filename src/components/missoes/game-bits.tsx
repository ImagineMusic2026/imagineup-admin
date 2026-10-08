"use client";

import {
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
