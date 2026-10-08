"use client";

import { Ban, Boxes, Eye, ImageOff, Pencil, Plus, RotateCcw, Send, Square, Trash2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useMemo, useRef, useState } from "react";

import { OrderButtons, useOrderFocus, type MoveDirection } from "@/components/missoes/game-bits";
import { Points, REWARD_STYLES } from "@/components/recompensas/reward-bits";
import { RewardDialog, type RewardDialogRequest } from "@/components/recompensas/reward-dialog";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { ActionsMenu, type MenuAction } from "@/components/ui/actions-menu";
import { Badge } from "@/components/ui/badge";
import { BatchProgress } from "@/components/ui/batch-progress";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Detail, DetailList, Missing } from "@/components/ui/detail-list";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { StatusChip } from "@/components/ui/status-chip";
import { useLoad, type Loadable } from "@/components/ui/use-load";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { positionAnnouncement, moveId } from "@/lib/artists";
import { runSequential, type BatchProgress as Progress, type BatchSummary } from "@/lib/batch";
import { actionErrorMessage, callableErrorMessage, mayHaveRunOnServer } from "@/lib/errors";
import { countLabel, formatDay, formatNumber } from "@/lib/format";
import { deleteReward, reorderRewards, setRedemptionStatus, setRewardStatus, setRewardStock } from "@/lib/reward-api";
import { getEvents, getOpenRedemptionsOf } from "@/lib/reward-data";
import {
  CLOSE_FIRST_TEXT,
  KIND_LABELS,
  REFUSAL_REASON_MAX,
  RESTOCK_HINT,
  STOCK_MAX,
  applyRewardOrder,
  deleteBlocked,
  hasClosedEvent,
  isSoldOut,
  reorderableIds,
  stockText,
  validateRefusal,
  validateStock,
  type EventInfo,
  type Redemption,
  type Reward,
} from "@/lib/rewards";

const GRID =
  "xl:grid xl:grid-cols-[84px_minmax(0,2.4fr)_88px_92px_minmax(0,1fr)_76px_minmax(0,1.1fr)_104px_96px_44px] xl:items-center xl:gap-4";

type Notify = (tone: "success" | "error" | "info", text: string) => void;

function Thumb({ reward }: { reward: Reward }) {
  return (
    <span className="relative block aspect-[1200/643] w-16 shrink-0 overflow-hidden rounded-md border border-line bg-sunken">
      {reward.photo?.url ? (
        <Image src={reward.photo.url} alt="" fill sizes="64px" unoptimized className="object-cover" />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-fg/40">
          <ImageOff aria-hidden="true" className="size-4" />
        </span>
      )}
    </span>
  );
}

function EventCell({ reward, event, now }: { reward: Reward; event: EventInfo | null | undefined; now: number }) {
  if (!reward.eventId) return <Missing>Sem show</Missing>;
  if (event === undefined) return <span className="text-fg/60">Carregando...</span>;
  if (event === null) return <Missing>Show apagado</Missing>;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="text-fg/90">{event.title}</span>
      {event.startsAt ? <span className="text-[12px] text-fg/60">{formatDay(event.startsAt, new Date(now))}</span> : null}
      {hasClosedEvent(reward, event, now) ? (
        <Badge tone="danger" className="self-start">
          Show fechado
        </Badge>
      ) : null}
    </span>
  );
}

/**
 * Catálogo: as recompensas na ordem do app, com o estoque, o show e a
 * situação; criar, editar, publicar, encerrar, reabrir, estoque, ordem,
 * apagar o rascunho e recusar os pedidos abertos de um show cancelado.
 */
export function CatalogTab({
  canEdit,
  rewards,
  now,
  onChanged,
  onNotice,
  onReload,
}: {
  canEdit: boolean;
  rewards: Loadable<Reward[]>;
  now: number;
  /** Uma mudança deu certo: a página avisa e lê o catálogo de novo. */
  onChanged: (message: string) => void;
  onNotice: Notify;
  onReload: () => void;
}) {
  const list = rewards.status === "ready" ? rewards.data : null;
  const [dialog, setDialog] = useState<RewardDialogRequest | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [stock, setStock] = useState<Reward | null>(null);
  const [refuseAll, setRefuseAll] = useState<Reward | null>(null);
  const [viewing, setViewing] = useState<Reward | null>(null);
  const [rowNotice, setRowNotice] = useState<{ id: string; text: string; key: number } | null>(null);
  /** A ordem nova na tela, só enquanto a lista lida antes dela é a que está aqui (a próxima leitura já vem com ela). */
  const [order, setOrder] = useState<{ ids: string[]; base: Reward[] } | null>(null);
  const [moving, setMoving] = useState(false);
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const focusOrder = useOrderFocus();

  const shown = useMemo(() => (list && order && order.base === list ? applyRewardOrder(list, order.ids) : list), [list, order]);
  const eventKey = list ? [...new Set(list.map((reward) => reward.eventId).filter((id): id is string => Boolean(id)))].sort().join("|") : "";
  const events = useLoad(useCallback(() => getEvents(eventKey ? eventKey.split("|") : []), [eventKey]));
  const eventMap = events.state.status === "ready" ? events.state.data : null;
  const movable = shown ? reorderableIds(shown) : [];

  function ask(request: ConfirmRequest) {
    setConfirm({ ...request, onUncertain: onReload });
  }

  function askStatus(reward: Reward, status: "published" | "closed") {
    const reopening = reward.status === "closed";
    ask({
      title: status === "closed" ? `Encerrar ${reward.title}?` : reopening ? `Reabrir ${reward.title}?` : `Publicar ${reward.title}?`,
      body:
        status === "closed"
          ? "A recompensa sai da loja. Os pedidos abertos continuam para a equipe entregar ou recusar."
          : reopening
            ? "A recompensa volta para a loja, no fim da ordem."
            : "A recompensa entra na loja do app.",
      confirmLabel: status === "closed" ? "Encerrar" : reopening ? "Reabrir" : "Publicar",
      busyLabel: status === "closed" ? "Encerrando..." : reopening ? "Reabrindo..." : "Publicando...",
      cancelLabel: "Voltar",
      tone: status === "closed" ? "danger" : "default",
      action: () => setRewardStatus(reward.id, status),
      successMessage: status === "closed" ? `Recompensa ${reward.title} encerrada.` : reopening ? `Recompensa ${reward.title} reaberta.` : `Recompensa ${reward.title} no ar.`,
    });
  }

  function askDelete(reward: Reward) {
    const blocked = deleteBlocked(reward);
    if (blocked) {
      setRowNotice((current) => ({ id: reward.id, text: blocked, key: (current?.key ?? 0) + 1 }));
      return;
    }
    ask({
      title: `Apagar ${reward.title}?`,
      body: "O rascunho e a foto saem de vez. Isso não se desfaz.",
      confirmLabel: "Apagar",
      busyLabel: "Apagando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => deleteReward(reward.id),
      successMessage: `Recompensa ${reward.title} apagada.`,
    });
  }

  async function move(reward: Reward, direction: MoveDirection) {
    if (moving || !shown || !list) return;
    const next = moveId(movable, reward.id, direction === "up" ? -1 : 1);
    if (!next) return;
    setOrder({ ids: next, base: list });
    setMoving(true);
    focusOrder({ id: reward.id, direction });
    setAnnouncement((current) => ({ key: (current?.key ?? 0) + 1, text: positionAnnouncement(reward.title, next.indexOf(reward.id) + 1, next.length) }));
    try {
      await reorderRewards(next);
      onReload();
    } catch (failure) {
      setOrder(null);
      focusOrder({ id: reward.id, direction });
      onNotice("error", `A nova ordem não foi salva e voltou ao que era. ${callableErrorMessage(failure)}`);
      if (mayHaveRunOnServer(failure)) onReload();
    } finally {
      setMoving(false);
    }
  }

  function actionsOf(reward: Reward): MenuAction[] {
    const items: MenuAction[] = [{ label: "Editar", icon: Pencil, onSelect: () => setDialog({ reward }) }];
    if (reward.status === "draft") items.push({ label: "Publicar", icon: Send, onSelect: () => askStatus(reward, "published") });
    if (reward.status === "closed") items.push({ label: "Reabrir", icon: RotateCcw, onSelect: () => askStatus(reward, "published") });
    if (reward.status === "published") items.push({ label: "Encerrar", icon: Square, onSelect: () => askStatus(reward, "closed"), tone: "danger" });
    items.push({ label: "Estoque", icon: Boxes, onSelect: () => setStock(reward) });
    if (reward.publishedAt) items.push({ label: "Recusar pedidos abertos", icon: Ban, onSelect: () => setRefuseAll(reward), tone: "danger" });
    items.push({ label: "Apagar", icon: Trash2, onSelect: () => askDelete(reward), tone: "danger" });
    return items;
  }

  const columns: Column<Reward>[] = [
    {
      key: "order",
      header: "Ordem",
      cell: (reward) => {
        const index = movable.indexOf(reward.id);
        return (
          <span className="flex items-center gap-1.5">
            <span className="w-6 text-right font-display text-sm font-semibold tabular-nums text-fg/80">
              {index >= 0 ? (
                <>
                  <span className="sr-only">Posição </span>
                  {index + 1}
                </>
              ) : (
                <span className="text-fg/40">
                  <span className="sr-only">Fora da ordem</span>
                </span>
              )}
            </span>
            {canEdit && index >= 0 ? (
              <OrderButtons id={reward.id} name={reward.title} first={index === 0} last={index === movable.length - 1} busy={moving} onMove={(direction) => void move(reward, direction)} />
            ) : null}
          </span>
        );
      },
    },
    {
      key: "title",
      header: "Recompensa",
      cell: (reward) => (
        <span className="flex min-w-0 items-center gap-3">
          <Thumb reward={reward} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-fg">{reward.title}</span>
            <span className="block truncate text-[12.5px] text-fg/60">{reward.subtitle}</span>
          </span>
        </span>
      ),
    },
    { key: "kind", header: "Tipo", cell: (reward) => KIND_LABELS[reward.kind] },
    { key: "cost", header: "Custo", align: "end", cell: (reward) => <Points value={reward.cost} /> },
    { key: "stock", header: "Estoque", cell: (reward) => <span className="tabular-nums">{stockText(reward)}</span> },
    { key: "perFan", header: "Por fã", cell: (reward) => (reward.perFanLimit === null ? "Sem limite" : <span className="tabular-nums">{reward.perFanLimit}</span>) },
    { key: "event", header: "Show", cell: (reward) => <EventCell reward={reward} event={reward.eventId ? (eventMap ? (eventMap.get(reward.eventId) ?? null) : undefined) : null} now={now} /> },
    {
      key: "status",
      header: "Situação",
      cell: (reward) => {
        const event = reward.eventId ? eventMap?.get(reward.eventId) : null;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusChip status={reward.status} map={REWARD_STYLES} />
            {reward.status === "published" && (eventMap || !reward.eventId) && isSoldOut(reward, event, now) ? <Badge tone="danger">Esgotada</Badge> : null}
          </span>
        );
      },
    },
    { key: "redeemed", header: "Resgatados", align: "end", cell: (reward) => <span className="tabular-nums">{formatNumber(reward.redeemedCount)}</span> },
    {
      key: "actions",
      header: "",
      label: "",
      align: "end",
      cell: (reward) =>
        canEdit ? (
          <ActionsMenu label={`Ações de ${reward.title}`} actions={actionsOf(reward)} />
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setViewing(reward)} aria-label={`Ver ${reward.title}`}>
            <Eye aria-hidden="true" className="size-4" />
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionCard id="titulo-catalogo" title="Catálogo" meta={list ? countLabel(list.length, "recompensa", "recompensas") : undefined}>
        {canEdit ? (
          <div className="flex flex-wrap gap-2 border-b border-line px-5 py-4">
            <Button size="sm" variant="primary" onClick={() => setDialog({ reward: null })}>
              <Plus aria-hidden="true" className="size-4" />
              Nova recompensa
            </Button>
          </div>
        ) : null}
        <div aria-live="polite" className="sr-only">
          {announcement ? <p key={announcement.key}>{announcement.text}</p> : null}
        </div>
        {rewards.status === "error" ? (
          <LoadError message={rewards.message} headingId="titulo-catalogo" onRetry={onReload} />
        ) : !shown ? (
          <LoadingRow label="Carregando o catálogo..." />
        ) : (
          <DataTable
            caption="Recompensas, na ordem do app"
            columns={columns}
            rows={shown}
            rowKey={(reward) => reward.id}
            grid={GRID}
            rowNotice={(reward) =>
              rowNotice?.id === reward.id ? (
                <Notice key={rowNotice.key} tone="info">
                  {rowNotice.text}
                </Notice>
              ) : null
            }
            empty={
              <EmptyState
                className="p-0"
                action={
                  canEdit ? (
                    <Button size="sm" variant="primary" onClick={() => setDialog({ reward: null })}>
                      Nova recompensa
                    </Button>
                  ) : null
                }
              >
                Nenhuma recompensa cadastrada.
              </EmptyState>
            }
          />
        )}
      </SectionCard>

      <RewardDialog
        request={canEdit ? dialog : null}
        events={eventMap}
        now={now}
        onClose={() => setDialog(null)}
        onSaved={(message) => {
          setDialog(null);
          onChanged(message);
        }}
      />
      <ConfirmDialog
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          onChanged(message);
        }}
      />
      <StockDialog
        reward={canEdit ? stock : null}
        onClose={() => setStock(null)}
        onDone={(message) => {
          setStock(null);
          onChanged(message);
        }}
        onUncertain={onReload}
      />
      <RefuseAllDialog
        reward={canEdit ? refuseAll : null}
        onClose={(summary) => {
          setRefuseAll(null);
          if (summary) onChanged(summary);
        }}
      />
      <RewardView reward={viewing} event={viewing?.eventId ? (eventMap?.get(viewing.eventId) ?? null) : null} now={now} onClose={() => setViewing(null)} />
    </div>
  );
}

/** O total de vagas, nunca abaixo do já resgatado, ou sem limite. */
function StockDialog({ reward, onClose, onDone, onUncertain }: { reward: Reward | null; onClose: () => void; onDone: (message: string) => void; onUncertain: () => void }) {
  return reward ? <StockBody key={reward.id} reward={reward} onClose={onClose} onDone={onDone} onUncertain={onUncertain} /> : null;
}

function StockBody({ reward, onClose, onDone, onUncertain }: { reward: Reward; onClose: () => void; onDone: (message: string) => void; onUncertain: () => void }) {
  const mounted = useMountedRef();
  const [limited, setLimited] = useState(reward.stockTotal !== null);
  const [value, setValue] = useState(reward.stockTotal === null ? "" : String(reward.stockTotal));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const checked = validateStock(limited, value, reward.redeemedCount);
    setFieldError(checked.error);
    if (checked.error) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setRewardStock(reward.id, checked.stockTotal);
      if (!mounted.current) return;
      onDone(result.remaining === null ? `Estoque de ${reward.title}: sem limite.` : `Estoque de ${reward.title} salvo: ${countLabel(result.remaining, "vaga restante", "vagas restantes")}.`);
    } catch (failure) {
      if (!mounted.current) return;
      setError(actionErrorMessage(failure));
      if (mayHaveRunOnServer(failure)) onUncertain();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Dialog open size="sm" busy={busy} onClose={() => !busy && onClose()} title={`Estoque de ${reward.title}`} description={`Já resgatados: ${formatNumber(reward.redeemedCount)}. Hoje: ${stockText(reward)}.`}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Total de vagas" error={fieldError ?? undefined} hint={limited ? `De ${formatNumber(reward.redeemedCount)} a ${formatNumber(STOCK_MAX)}. Igual ao resgatado esgota para todos.` : "Sem limite de vagas."}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              type="number"
              min={reward.redeemedCount}
              max={STOCK_MAX}
              value={limited ? value : ""}
              disabled={busy || !limited}
              onChange={(event) => {
                setValue(event.target.value);
                setFieldError(null);
              }}
            />
          )}
        </Field>
        <Checkbox label="Sem limite" checked={!limited} disabled={busy} onChange={(event) => setLimited(!event.target.checked)} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {busy ? "Salvando..." : "Salvar estoque"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * "Recusar pedidos abertos" (show cancelado): o motivo, a vaga que não volta
 * (desmarcada por padrão) e a recusa de cada pedido aberto, um por vez, com o
 * progresso e o resumo. Só com a recompensa encerrada.
 */
function RefuseAllDialog({ reward, onClose }: { reward: Reward | null; onClose: (summary: string | null) => void }) {
  return reward ? <RefuseAllBody key={reward.id} reward={reward} onClose={onClose} /> : null;
}

function RefuseAllBody({ reward, onClose }: { reward: Reward; onClose: (summary: string | null) => void }) {
  const mounted = useMountedRef();
  const open = useLoad(useCallback(() => getOpenRedemptionsOf(reward.id), [reward.id]));
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<BatchSummary<Redemption> | null>(null);
  const stop = useRef(false);
  const items = open.state.status === "ready" ? open.state.data : [];
  const mustClose = reward.status === "published";

  async function run() {
    const checked = validateRefusal(reason);
    setReasonError(checked.error);
    if (checked.error || items.length === 0) return;
    stop.current = false;
    setRunning(true);
    setSummary(null);
    setProgress({ attempted: 0, total: items.length, done: 0, unchanged: 0, failed: 0 });
    const result = await runSequential(
      items,
      async (item) => {
        const response = await setRedemptionStatus({ redemptionId: item.code, status: "refused", reason: checked.value, restock });
        return response.status === "refused" ? "done" : "unchanged";
      },
      { onProgress: setProgress, stopOn: (error) => mayHaveRunOnServer(error), shouldStop: () => stop.current },
    );
    if (!mounted.current) return;
    setSummary(result);
    setRunning(false);
    setStopping(false);
  }

  function close() {
    if (running) return;
    onClose(summary ? `Pedidos de ${reward.title}: ${countLabel(summary.done, "recusado", "recusados")}${summary.failed > 0 ? `, ${summary.failed} com erro` : ""}.` : null);
  }

  const failure = summary?.failures[0]?.error;
  return (
    <Dialog open size="md" tone="danger" busy={running} onClose={close} title={`Recusar os pedidos abertos de ${reward.title}?`} description="Para o show cancelado: cada pedido solicitado ou aprovado é recusado, um por vez, e os pontos voltam para o saldo de cada fã.">
      <div className="flex flex-col gap-4">
        {open.state.status === "loading" ? (
          <p role="status" className="m-0 text-sm text-fg/70">
            Contando os pedidos abertos...
          </p>
        ) : open.state.status === "error" ? (
          <Notice tone="error">{open.state.message}</Notice>
        ) : (
          <p className="m-0 text-sm text-fg/85">{items.length === 0 ? "Nenhum pedido aberto nesta recompensa." : `${countLabel(items.length, "pedido aberto", "pedidos abertos")}.`}</p>
        )}
        {mustClose ? <Notice tone="info">{CLOSE_FIRST_TEXT} Enquanto ela está no ar, chegam pedidos novos.</Notice> : null}
        <Field label="Motivo" optional error={reasonError ?? undefined} hint="Cada fã vê este texto.">
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={reason}
              maxLength={REFUSAL_REASON_MAX}
              disabled={running || Boolean(summary)}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(null);
              }}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <Checkbox label="Devolver as vagas ao estoque" checked={restock} disabled={running || Boolean(summary)} onChange={(event) => setRestock(event.target.checked)} />
          <p className="m-0 pl-7 text-[12.5px] leading-snug text-fg/60">{RESTOCK_HINT}</p>
        </div>
        <BatchProgress
          progress={progress}
          summary={summary}
          doneLabel="recusados"
          doneOne="recusado"
          running={running}
          stopping={stopping}
          onStop={() => {
            stop.current = true;
            setStopping(true);
          }}
        />
        {failure ? <p className="m-0 text-[13px] text-danger">{actionErrorMessage(failure)}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close} disabled={running} data-autofocus>
            {summary ? "Fechar" : "Voltar"}
          </Button>
          {!summary ? (
            <Button variant="danger" busy={running} disabled={mustClose || items.length === 0} onClick={() => void run()}>
              {running ? "Recusando..." : `Recusar ${countLabel(items.length, "pedido", "pedidos")}`}
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

/** "Ver" de quem só lê. */
function RewardView({ reward, event, now, onClose }: { reward: Reward | null; event: EventInfo | null; now: number; onClose: () => void }) {
  return (
    <Dialog open={Boolean(reward)} size="md" onClose={onClose} title={reward?.title ?? ""} description={reward?.subtitle}>
      {reward ? (
        <div className="flex flex-col gap-5">
          <DetailList>
            <Detail term="Tipo">{KIND_LABELS[reward.kind]}</Detail>
            <Detail term="Custo">
              <Points value={reward.cost} />
            </Detail>
            <Detail term="Estoque">{stockText(reward)}</Detail>
            <Detail term="Limite por fã">{reward.perFanLimit === null ? "Sem limite" : reward.perFanLimit}</Detail>
            <Detail term="Show">{reward.eventId ? (event ? `${event.title}${event.startsAt ? `, ${formatDay(event.startsAt, new Date(now))}` : ""}` : "Show apagado") : <Missing>Sem show</Missing>}</Detail>
            <Detail term="Resgatados">{formatNumber(reward.redeemedCount)}</Detail>
            <Detail term="Descrição" wide>
              {reward.description ? <span className="whitespace-pre-line">{reward.description}</span> : <Missing>Sem descrição</Missing>}
            </Detail>
            <Detail term="Como retirar" wide>
              <span className="whitespace-pre-line">{reward.instructions}</span>
            </Detail>
          </DetailList>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose} data-autofocus>
              Fechar
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

