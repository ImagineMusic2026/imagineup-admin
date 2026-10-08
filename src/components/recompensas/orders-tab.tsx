"use client";

import { Ban, CheckCheck, PackageCheck, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { ContactsDialog, RefuseDialog, type ContactsState } from "@/components/recompensas/order-dialogs";
import { CopyCode, Points, REDEMPTION_STYLES, When } from "@/components/recompensas/reward-bits";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { ActionsMenu, type MenuAction } from "@/components/ui/actions-menu";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { DataTable, LoadMore, type Column } from "@/components/ui/data-table";
import { Missing } from "@/components/ui/detail-list";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterChips, FilterSelect } from "@/components/ui/filter-bar";
import { Notice } from "@/components/ui/notice";
import { SearchField } from "@/components/ui/search-field";
import { StatusChip } from "@/components/ui/status-chip";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList } from "@/components/ui/use-paged-list";
import { errorMessage } from "@/lib/errors";
import type { PageCursor } from "@/lib/firestore-page";
import { countLabel, formatNumber } from "@/lib/format";
import { getRedemptionContacts, setRedemptionStatus } from "@/lib/reward-api";
import { getRedemption, getRedemptionCounts, getRedemptionsPage } from "@/lib/reward-data";
import {
  CODE_PATTERN,
  CONTACTS_MAX,
  REDEMPTION_STATUSES,
  REDEMPTION_STATUS_LABELS,
  STATUS_FILTER_LABELS,
  fanLine,
  isOpenRedemption,
  normalizeCode,
  redemptionActions,
  type Redemption,
  type Reward,
  type StatusFilter,
} from "@/lib/rewards";
import { canSeeSection, type StaffMember } from "@/lib/staff";

const GRID = "xl:grid xl:grid-cols-[36px_150px_minmax(0,1.2fr)_minmax(0,1.3fr)_100px_120px_110px_minmax(0,0.9fr)_44px] xl:items-center xl:gap-4";
const GRID_READONLY = "xl:grid xl:grid-cols-[150px_minmax(0,1.2fr)_minmax(0,1.3fr)_100px_120px_110px_minmax(0,0.9fr)] xl:items-center xl:gap-4";

const FILTERS: StatusFilter[] = [...REDEMPTION_STATUSES, "all"];

type Notify = (tone: "success" | "error" | "info", text: string) => void;

/** Quem mudou por último: a pessoa da equipe, o automático (exclusão de conta) ou ninguém ainda. */
function LastChange({ redemption }: { redemption: Redemption }) {
  if (redemption.updatedBy) return <span className="text-fg/85">{redemption.updatedBy}</span>;
  if (redemption.status === "canceled") return <span className="text-fg/70">Automático</span>;
  if (redemption.status === "requested") return <Missing>Ninguém ainda</Missing>;
  return <Missing>Sem registro</Missing>;
}

function FanCell({ redemption, linked }: { redemption: Redemption; linked: boolean }) {
  const line = fanLine(redemption);
  if (redemption.accountDeleted || !redemption.uid) return <span className="text-fg/65">{line}</span>;
  return linked ? (
    <Link href={`/fas/${redemption.uid}`} className="relative z-10 text-fg underline-offset-2 hover:underline">
      {line}
    </Link>
  ) : (
    <span className="text-fg/90">{line}</span>
  );
}

/**
 * Pedidos: as situações com a contagem, a fila (abertos do mais antigo,
 * fechados do mais novo), a busca pelo código, as ações de cada pedido e os
 * contatos dos abertos escolhidos.
 */
export function OrdersTab({
  member,
  canEdit,
  rewards,
  now,
  refreshKey,
  onNotice,
}: {
  member: StaffMember;
  canEdit: boolean;
  rewards: Reward[] | null;
  now: number;
  /** O "Atualizar" da página: lê de novo, sem perder os filtros. */
  refreshKey: number;
  onNotice: Notify;
}) {
  const [status, setStatus] = useState<StatusFilter>("requested");
  const [rewardId, setRewardId] = useState("");
  const [round, setRound] = useState(0);
  const [search, setSearch] = useState<{ code: string; state: "loading" | "found" | "missing" | "invalid" | "error"; item: Redemption | null; message?: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [refusing, setRefusing] = useState<Redemption | null>(null);
  const [contacts, setContacts] = useState<{ codes: string[]; state: ContactsState } | null>(null);
  const linked = canSeeSection(member, "fans");
  const date = new Date(now);

  const counts = useLoad(
    useCallback(() => {
      void round;
      void refreshKey;
      return getRedemptionCounts(rewardId || null);
    }, [rewardId, round, refreshKey]),
  );
  const loadPage = useCallback(
    (after: PageCursor | null) => {
      void round;
      void refreshKey;
      return getRedemptionsPage(status, rewardId || null, after);
    },
    [status, rewardId, round, refreshKey],
  );
  const list = usePagedList(loadPage, (item: Redemption) => item.code, { one: "pedido carregado", many: "pedidos carregados" });

  const countOf = (filter: StatusFilter) => {
    if (counts.state.status !== "ready") return null;
    const data = counts.state.data;
    return filter === "all" ? REDEMPTION_STATUSES.reduce((total, item) => total + data[item], 0) : data[filter];
  };

  /** Uma mudança deu certo: o aviso, as contagens e a lista de novo (e o resultado da busca). */
  function changed(message: string) {
    onNotice("success", message);
    setRound((value) => value + 1);
    if (search?.item) void runSearch(search.item.code);
  }

  async function runSearch(text: string) {
    const code = normalizeCode(text);
    if (!CODE_PATTERN.test(code)) {
      setSearch({ code: code || text, state: "invalid", item: null });
      return;
    }
    setSearch({ code, state: "loading", item: null });
    try {
      const item = await getRedemption(code);
      setSearch({ code, state: item ? "found" : "missing", item });
    } catch (failure) {
      setSearch({ code, state: "error", item: null, message: errorMessage(failure) });
    }
  }

  function askApprove(item: Redemption) {
    setConfirm({
      title: `Aprovar ${item.code}?`,
      body: "O fã vê Aprovado no app.",
      confirmLabel: "Aprovar",
      busyLabel: "Aprovando...",
      cancelLabel: "Voltar",
      tone: "default",
      action: () => setRedemptionStatus({ redemptionId: item.code, status: "approved" }),
      successMessage: `Pedido ${item.code} aprovado.`,
      onUncertain: () => setRound((value) => value + 1),
    });
  }

  function askDeliver(item: Redemption) {
    setConfirm({
      title: `Marcar ${item.code} como entregue?`,
      body: "Isso não se desfaz.",
      confirmLabel: "Marcar entregue",
      busyLabel: "Marcando...",
      cancelLabel: "Voltar",
      tone: "default",
      action: () => setRedemptionStatus({ redemptionId: item.code, status: "delivered" }),
      successMessage: `Pedido ${item.code} entregue.`,
      onUncertain: () => setRound((value) => value + 1),
    });
  }

  function actionsOf(item: Redemption): MenuAction[] {
    return redemptionActions(item.status).map((action) =>
      action === "approve"
        ? { label: "Aprovar", icon: CheckCheck, onSelect: () => askApprove(item) }
        : action === "deliver"
          ? { label: "Marcar entregue", icon: PackageCheck, onSelect: () => askDeliver(item) }
          : { label: "Recusar", icon: Ban, onSelect: () => setRefusing(item), tone: "danger" as const },
    );
  }

  function toggle(code: string, on: boolean) {
    setSelected((current) => (on ? (current.includes(code) || current.length >= CONTACTS_MAX ? current : [...current, code]) : current.filter((item) => item !== code)));
  }

  function openContacts() {
    const codes = [...selected];
    setContacts({ codes, state: { status: "loading" } });
    getRedemptionContacts(codes).then(
      (result) => setContacts((current) => (current && current.codes === codes ? { codes, state: { status: "ready", contacts: result.contacts } } : current)),
      (failure: unknown) => setContacts((current) => (current && current.codes === codes ? { codes, state: { status: "error", message: errorMessage(failure) } } : current)),
    );
  }

  const columns: Column<Redemption>[] = [
    ...(canEdit
      ? [
          {
            key: "select",
            header: "",
            label: "",
            cell: (item: Redemption) =>
              isOpenRedemption(item.status) ? (
                <input
                  type="checkbox"
                  aria-label={`Escolher ${item.code} para ver o contato`}
                  checked={selected.includes(item.code)}
                  disabled={!selected.includes(item.code) && selected.length >= CONTACTS_MAX}
                  onChange={(event) => toggle(item.code, event.target.checked)}
                  className="relative z-10 size-[18px] cursor-pointer accent-pink-strong"
                />
              ) : null,
          },
        ]
      : []),
    { key: "code", header: "Código", cell: (item) => <CopyCode code={item.code} /> },
    { key: "reward", header: "Recompensa", cell: (item) => <span className="text-fg/90">{item.rewardTitle || item.rewardId}</span> },
    { key: "fan", header: "Fã", cell: (item) => <FanCell redemption={item} linked={linked} /> },
    { key: "points", header: "Pontos", align: "end", cell: (item) => <Points value={item.points} /> },
    { key: "when", header: "Pedido em", cell: (item) => <When date={item.requestedAt} now={date} /> },
    {
      key: "status",
      header: "Situação",
      cell: (item) => (
        <span className="flex flex-col items-start gap-1">
          <StatusChip status={item.status} map={REDEMPTION_STYLES} />
          {item.status === "refused" && item.refusalReason ? <span className="text-[12px] text-fg/60">{item.refusalReason}</span> : null}
        </span>
      ),
    },
    { key: "by", header: "Quem mudou", label: "Mudou por último", cell: (item) => <LastChange redemption={item} /> },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            label: "",
            align: "end" as const,
            cell: (item: Redemption) => (redemptionActions(item.status).length > 0 ? <ActionsMenu label={`Ações de ${item.code}`} actions={actionsOf(item)} /> : null),
          },
        ]
      : []),
  ];

  const rewardOptions = [{ value: "", label: "Todas" }, ...(rewards ?? []).map((reward) => ({ value: reward.id, label: reward.title }))];
  const searchResult =
    search?.state === "found"
      ? `Pedido ${search.code} encontrado.`
      : search?.state === "missing"
        ? `Nenhum pedido com o código ${search.code}.`
        : search?.state === "invalid"
          ? "O código tem o formato UP-7QXH2R."
          : search?.state === "error"
            ? (search.message ?? "")
            : "";

  return (
    <div className="flex flex-col gap-6">
      <SectionCard id="titulo-pedidos" title="Pedidos" meta={rewardId ? `Só de ${rewards?.find((reward) => reward.id === rewardId)?.title ?? rewardId}` : undefined}>
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4">
          <SearchField
            label="Buscar pelo código"
            placeholder="UP-7QXH2R"
            hint="Com ou sem o UP- e o traço."
            busy={search?.state === "loading"}
            result={searchResult}
            active={Boolean(search)}
            onSearch={(text) => void runSearch(text)}
            onClear={() => setSearch(null)}
          />
          {!search ? (
            <>
              <FilterChips
                label="Situação dos pedidos"
                value={status}
                onChange={(value) => {
                  setStatus(value as StatusFilter);
                  setSelected([]);
                }}
                options={FILTERS.map((filter) => {
                  const total = countOf(filter);
                  return { value: filter, label: `${STATUS_FILTER_LABELS[filter]}${total === null ? "" : ` ${formatNumber(total)}`}` };
                })}
              />
              <FilterBar label="Filtro dos pedidos" active={Boolean(rewardId)} onClear={() => setRewardId("")}>
                <FilterSelect
                  label="Recompensa"
                  value={rewardId}
                  onChange={(value) => {
                    setRewardId(value);
                    setSelected([]);
                  }}
                  options={rewardOptions}
                />
              </FilterBar>
              {counts.state.status === "error" ? <p className="m-0 text-[13px] text-danger">As contagens não carregaram: {counts.state.message}</p> : null}
            </>
          ) : null}
          {canEdit && selected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary" onClick={openContacts}>
                <Users aria-hidden="true" className="size-4" />
                Ver contatos ({selected.length})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Limpar seleção
              </Button>
              {selected.length >= CONTACTS_MAX ? <span className="text-[13px] text-fg/65">Até {CONTACTS_MAX} pedidos por vez.</span> : null}
            </div>
          ) : null}
        </div>

        {search ? (
          search.state === "found" && search.item ? (
            <DataTable caption="Pedido encontrado" columns={columns} rows={[search.item]} rowKey={(item) => item.code} grid={canEdit ? GRID : GRID_READONLY} empty="" />
          ) : search.state === "loading" ? (
            <LoadingRow label="Buscando o pedido..." />
          ) : (
            <p className="m-0 px-5 py-6 text-sm text-fg/70">{searchResult}</p>
          )
        ) : list.state.status === "error" ? (
          <LoadError message={list.state.message} headingId="titulo-pedidos" onRetry={list.reload} />
        ) : list.state.status === "loading" ? (
          <LoadingRow label="Carregando os pedidos..." />
        ) : (
          <>
            <DataTable
              caption={`Pedidos ${STATUS_FILTER_LABELS[status].toLowerCase()}`}
              columns={columns}
              rows={list.state.data}
              rowKey={(item) => item.code}
              grid={canEdit ? GRID : GRID_READONLY}
              focusRequest={list.focusRequest}
              empty={
                <EmptyState className="p-0">
                  {status === "all" ? "Nenhum pedido ainda." : `Nenhum pedido ${REDEMPTION_STATUS_LABELS[status].toLowerCase()} agora.`}
                </EmptyState>
              }
            />
            <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
          </>
        )}
        {list.refreshError ? (
          <div className="px-5 pb-4">
            <Notice tone="error">Não deu para atualizar: {list.refreshError}</Notice>
          </div>
        ) : null}
      </SectionCard>

      <ConfirmDialog
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          changed(message);
        }}
      />
      <RefuseDialog
        redemption={canEdit ? refusing : null}
        onClose={() => setRefusing(null)}
        onDone={(message) => {
          setRefusing(null);
          changed(message);
        }}
        onUncertain={() => setRound((value) => value + 1)}
      />
      <ContactsDialog request={canEdit ? contacts : null} onClose={() => setContacts(null)} />
      <p className="sr-only" aria-live="polite">
        {selected.length > 0 ? countLabel(selected.length, "pedido escolhido", "pedidos escolhidos") : ""}
      </p>
    </div>
  );
}
