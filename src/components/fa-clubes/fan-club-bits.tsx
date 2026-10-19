import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { FanAvatar } from "@/components/painel/fan-avatar";
import type { StatusStyle } from "@/components/ui/status-chip";
import {
  APPLICATION_STATUS_LABELS,
  FAN_CLUB_STATUS_LABELS,
  type ApplicationStatus,
  type FanClubStatus,
} from "@/lib/fan-clubs";
import { formatDay, formatTime } from "@/lib/format";

/** A candidatura: ciano só na aprovada; a recusada em `danger`. */
export const APPLICATION_STYLES: Record<ApplicationStatus, StatusStyle> = {
  pending: { label: APPLICATION_STATUS_LABELS.pending, tone: "muted", dot: true },
  approved: { label: APPLICATION_STATUS_LABELS.approved, tone: "cyan", dot: true },
  rejected: { label: APPLICATION_STATUS_LABELS.rejected, tone: "danger", dot: true },
  withdrawn: { label: APPLICATION_STATUS_LABELS.withdrawn, tone: "muted", dot: true },
};

/** O fã-clube (34.10, item 4): ciano para ativo, muted para pausado, danger para encerrado. */
export const FAN_CLUB_STYLES: Record<FanClubStatus, StatusStyle> = {
  active: { label: FAN_CLUB_STATUS_LABELS.active, tone: "cyan", dot: true },
  paused: { label: FAN_CLUB_STATUS_LABELS.paused, tone: "muted", dot: true },
  closed: { label: FAN_CLUB_STATUS_LABELS.closed, tone: "danger", dot: true },
};

/** O fã das listas: a foto (ou as iniciais), o nome e o @, das cópias do documento. */
export function PersonCell({ name, username, photoURL }: { name: string; username: string | null; photoURL: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <FanAvatar name={name} photoURL={photoURL} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-fg">{name}</span>
        {username ? <span className="block truncate text-[12.5px] text-fg/60">@{username}</span> : null}
      </span>
    </span>
  );
}

/** "7 out, 21:00" (o ano só quando é outro); sem data, "Sem data". */
export function shortWhen(date: Date | null, now: Date): string {
  return date ? `${formatDay(date, now)}, ${formatTime(date)}` : "Sem data";
}

export function FanClubsBackLink() {
  return (
    <Link href="/fa-clubes" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-fg/70 hover:text-fg">
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      Fã-clubes
    </Link>
  );
}
