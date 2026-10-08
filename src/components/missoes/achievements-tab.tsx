"use client";

import { Archive, Eye, Pencil, Plus, Send } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { AchievementDialog, type AchievementDialogRequest } from "@/components/missoes/achievement-dialog";
import { AchievementBadgeIcon, OrderButtons, useOrderFocus, type MoveDirection } from "@/components/missoes/game-bits";
import { DataFreshness } from "@/components/painel/data-freshness";
import { SectionCard } from "@/components/painel/section-card";
import { ActionsMenu, type MenuAction } from "@/components/ui/actions-menu";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Detail, DetailList } from "@/components/ui/detail-list";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PeriodPicker, DEFAULT_PERIOD, type PeriodDays } from "@/components/ui/period-picker";
import { StatusChip, type StatusStyle } from "@/components/ui/status-chip";
import { useLoad } from "@/components/ui/use-load";
import {
  ACHIEVEMENT_STATUS_LABELS,
  ICON_LABELS,
  TONE_LABELS,
  achievementsUsage,
  isKnownIcon,
  ruleText,
  type Achievement,
  type AchievementStatus,
} from "@/lib/achievements";
import { applyOrder, moveId, positionAnnouncement } from "@/lib/artists";
import { rangeEndingYesterday } from "@/lib/day";
import { callableErrorMessage, isConfigChanged, mayHaveRunOnServer } from "@/lib/errors";
import { formatDayRange, formatNumber } from "@/lib/format";
import { reorderAchievements, setAchievementStatus } from "@/lib/game-api";
import { getAchievementUnlocks, type GameConfigs } from "@/lib/game-data";

const STATUS_STYLES: Record<AchievementStatus, StatusStyle> = {
  draft: { label: ACHIEVEMENT_STATUS_LABELS.draft, tone: "muted", dot: true },
  active: { label: ACHIEVEMENT_STATUS_LABELS.active, tone: "cyan", dot: true },
  archived: { label: ACHIEVEMENT_STATUS_LABELS.archived, tone: "neutral", dot: true },
};

const GRID = "xl:grid xl:grid-cols-[84px_minmax(0,1.3fr)_96px_minmax(0,1.5fr)_112px_110px_44px] xl:items-center xl:gap-4";

export const NO_ACHIEVEMENTS_TEXT = "As conquistas ainda não foram gravadas no servidor.";

export function AchievementsTab({
  canEdit,
  configs,
  now,
  onChanged,
  onNotice,
  onReload,
}: {
  canEdit: boolean;
  configs: GameConfigs;
  now: number;
  onChanged: (message: string) => void;
  onNotice: (tone: "success" | "error" | "info", text: string) => void;
  onReload: () => void;
}) {
  const catalog = configs.achievements;
  const levels = configs.points.config?.levels ?? null;
  const stored = catalog.version > 0;
  const editable = canEdit && stored;
  const [days, setDays] = useState<PeriodDays>(DEFAULT_PERIOD);
  const [dialog, setDialog] = useState<AchievementDialogRequest | null>(null);
  const [viewing, setViewing] = useState<Achievement | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [order, setOrder] = useState<{ ids: string[]; version: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [hint, setHint] = useState(0);
  const focusOrder = useOrderFocus();

  const version = Math.max(catalog.version, hint, order?.version ?? 0);
  const achievements = useMemo(
    () => (order && order.version > catalog.version ? applyOrder(catalog.achievements, order.ids) : catalog.achievements),
    [catalog, order],
  );
  const range = useMemo(() => rangeEndingYesterday(days, now), [days, now]);
  const unlocks = useLoad(useCallback(() => getAchievementUnlocks(range, now), [range, now]));
  const counts = unlocks.state.status === "ready" ? unlocks.state.data : null;
  const date = new Date(now);

  function remember(result: { version: number }) {
    setHint((current) => Math.max(current, result.version));
  }

  function track(promise: Promise<{ version: number }>): Promise<void> {
    return promise.then(remember, (failure: unknown) => {
      if (isConfigChanged(failure)) onReload();
      throw failure;
    });
  }

  function askStatus(achievement: Achievement, status: "active" | "archived") {
    const publishing = status === "active";
    setConfirm({
      title: publishing ? `Publicar ${achievement.title}?` : `Arquivar ${achievement.title}?`,
      body: publishing
        ? achievement.activatedAt
          ? "A conquista volta para o app com a mesma regra."
          : "A conquista entra no app. Depois de publicada, a regra não muda; nome, ícone e cor continuam editáveis."
        : "A conquista sai do app e do total de conquistas. Quem já ganhou continua com ela.",
      confirmLabel: publishing ? "Publicar" : "Arquivar",
      busyLabel: publishing ? "Publicando..." : "Arquivando...",
      cancelLabel: "Voltar",
      tone: publishing ? "default" : "danger",
      action: () => track(setAchievementStatus({ expectedVersion: version, achievementId: achievement.id, status })),
      successMessage: publishing ? `Conquista ${achievement.title} no ar.` : `Conquista ${achievement.title} arquivada.`,
      onUncertain: onReload,
    });
  }

  async function move(achievement: Achievement, direction: MoveDirection) {
    if (moving) return;
    const next = moveId(
      achievements.map((item) => item.id),
      achievement.id,
      direction === "up" ? -1 : 1,
    );
    if (!next) return;
    const expected = version;
    setOrder({ ids: next, version: expected + 1 });
    setMoving(true);
    focusOrder({ id: achievement.id, direction });
    setAnnouncement((current) => ({ key: (current?.key ?? 0) + 1, text: positionAnnouncement(achievement.title, next.indexOf(achievement.id) + 1, next.length) }));
    try {
      const result = await reorderAchievements({ expectedVersion: expected, achievementIds: next });
      setOrder({ ids: next, version: result.version });
      remember(result);
      onReload();
    } catch (failure) {
      setOrder(null);
      focusOrder({ id: achievement.id, direction });
      onNotice("error", `A nova ordem não foi salva e voltou ao que era. ${callableErrorMessage(failure)}`);
      if (isConfigChanged(failure) || mayHaveRunOnServer(failure)) onReload();
    } finally {
      setMoving(false);
    }
  }

  function actionsOf(achievement: Achievement): MenuAction[] {
    const items: MenuAction[] = [{ label: "Editar", icon: Pencil, onSelect: () => setDialog({ achievement, version }) }];
    if (achievement.status !== "active") items.push({ label: "Publicar", icon: Send, onSelect: () => askStatus(achievement, "active") });
    if (achievement.status !== "archived") items.push({ label: "Arquivar", icon: Archive, onSelect: () => askStatus(achievement, "archived"), tone: "danger" });
    return items;
  }

  const columns: Column<Achievement>[] = [
    {
      key: "order",
      header: "Ordem",
      cell: (achievement) => {
        const index = achievements.indexOf(achievement);
        return (
          <span className="flex items-center gap-1.5">
            <span className="w-6 text-right font-display text-sm font-semibold tabular-nums text-fg/80">
              <span className="sr-only">Posição </span>
              {index + 1}
            </span>
            {editable ? (
              <OrderButtons
                id={achievement.id}
                name={achievement.title}
                first={index === 0}
                last={index === achievements.length - 1}
                busy={moving}
                onMove={(direction) => void move(achievement, direction)}
              />
            ) : null}
          </span>
        );
      },
    },
    {
      key: "title",
      header: "Conquista",
      cell: (achievement) => (
        <span className="flex min-w-0 items-center gap-3">
          <AchievementBadgeIcon icon={achievement.icon} tone={achievement.tone} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-fg">{achievement.title}</span>
            <span className="block text-[12px] text-fg/55">{isKnownIcon(achievement.icon) ? ICON_LABELS[achievement.icon] : `Ícone ${achievement.icon}`}</span>
          </span>
        </span>
      ),
    },
    { key: "tone", header: "Cor", cell: (achievement) => TONE_LABELS[achievement.tone] },
    { key: "rule", header: "Regra", cell: (achievement) => ruleText(achievement.rule, levels) },
    { key: "status", header: "Situação", cell: (achievement) => <StatusChip status={achievement.status} map={STATUS_STYLES} /> },
    {
      key: "unlocks",
      header: "Desbloqueios",
      align: "end",
      cell: (achievement) => <span className="tabular-nums">{counts ? formatNumber(counts.byId[achievement.id] ?? 0) : unlocks.state.status === "error" ? "?" : "..."}</span>,
    },
    {
      key: "actions",
      header: "",
      label: "",
      align: "end",
      cell: (achievement) =>
        editable ? (
          <ActionsMenu label={`Ações de ${achievement.title}`} actions={actionsOf(achievement)} />
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setViewing(achievement)} aria-label={`Ver ${achievement.title}`}>
            <Eye aria-hidden="true" className="size-4" />
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionCard id="titulo-conquistas" title="Conquistas" meta={stored ? achievementsUsage(catalog.achievements) : undefined}>
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4">
          {!stored ? <p className="m-0 text-sm text-fg/70">{NO_ACHIEVEMENTS_TEXT}</p> : null}
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => setDialog({ achievement: null, version })}>
                <Plus aria-hidden="true" className="size-4" />
                Nova conquista
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12px] font-semibold text-fg/65">Desbloqueios no período</span>
            <PeriodPicker value={days} onChange={setDays} now={now} label="Período dos desbloqueios" />
          </div>
          <p className="m-0 text-[13px] text-fg/70">Desbloqueios {formatDayRange(range.from, range.to, date)}.</p>
          {counts ? <DataFreshness state={counts.state} closedAt={counts.closedAt} now={date} /> : null}
          {unlocks.state.status === "error" ? <p className="m-0 text-[13px] text-danger">Os desbloqueios não carregaram: {unlocks.state.message}</p> : null}
        </div>
        <div aria-live="polite" className="sr-only">
          {announcement ? <p key={announcement.key}>{announcement.text}</p> : null}
        </div>
        <DataTable
          caption="Conquistas, na ordem do app"
          columns={columns}
          rows={achievements}
          rowKey={(achievement) => achievement.id}
          grid={GRID}
          empty={
            <EmptyState
              className="p-0"
              action={
                editable ? (
                  <Button size="sm" variant="primary" onClick={() => setDialog({ achievement: null, version })}>
                    Nova conquista
                  </Button>
                ) : null
              }
            >
              Nenhuma conquista ainda.
            </EmptyState>
          }
        />
      </SectionCard>

      <AchievementDialog
        request={editable ? dialog : null}
        levels={levels}
        onClose={() => setDialog(null)}
        onSaved={(message) => {
          setDialog(null);
          onChanged(message);
        }}
      />
      <ConfirmDialog
        request={editable ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          onChanged(message);
        }}
      />
      <Dialog open={Boolean(viewing)} onClose={() => setViewing(null)} size="sm" title={viewing?.title ?? ""} description={viewing ? ACHIEVEMENT_STATUS_LABELS[viewing.status] : undefined}>
        {viewing ? (
          <div className="flex flex-col gap-5">
            <AchievementBadgeIcon icon={viewing.icon} tone={viewing.tone} className="size-11" />
            <DetailList>
              <Detail term="Regra" wide>
                {ruleText(viewing.rule, levels)}
              </Detail>
              <Detail term="Cor">{TONE_LABELS[viewing.tone]}</Detail>
              <Detail term="Ícone">{isKnownIcon(viewing.icon) ? ICON_LABELS[viewing.icon] : viewing.icon}</Detail>
              <Detail term="Desbloqueios no período">{counts ? formatNumber(counts.byId[viewing.id] ?? 0) : "..."}</Detail>
              <Detail term="Identificador">
                <span className="font-mono text-[13px]">{viewing.id}</span>
              </Detail>
            </DetailList>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setViewing(null)} data-autofocus>
                Fechar
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
