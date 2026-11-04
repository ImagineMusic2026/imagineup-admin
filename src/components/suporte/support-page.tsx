"use client";

import { CheckCheck, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { FanAvatar } from "@/components/painel/fan-avatar";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { LoadMore } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChips } from "@/components/ui/filter-bar";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Tabs } from "@/components/ui/tabs";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList } from "@/components/ui/use-paged-list";
import { UNCERTAIN_RETRY_TEXT, reasonOf } from "@/lib/errors";
import { fanDisplayName } from "@/lib/fan-profile";
import type { FanProfileReader } from "@/lib/fan-profile-data";
import type { PageCursor } from "@/lib/firestore-page";
import { canEditSection, canSeeSection, sectionInfo, type StaffMember } from "@/lib/staff";
import {
  FAN_NOT_FOUND_TEXT,
  KIND_FILTERS,
  KIND_FILTER_LABELS,
  SUPPORT_LIST_META,
  SUPPORT_STATUS_LABELS,
  actionConfirm,
  actionDoneText,
  actionOf,
  deviceText,
  emptyText,
  isKindFilter,
  isMessageGone,
  openCountText,
  resolvedText,
  supportKindLabel,
  supportWhen,
  type KindFilter,
  type SupportMessage,
  type SupportStatus,
} from "@/lib/support";
import { resolveSupportMessage } from "@/lib/support-api";
import { countOpenSupport, createSupportFanReader, getSupportPage } from "@/lib/support-data";

const INFO = sectionInfo("support");

/** O título da lista, que recebe o foco quando o card some depois de uma ação. */
const LIST_HEADING_ID = "titulo-mensagens";

/**
 * Suporte (`/suporte`, seção 38): o que os fãs mandam pelos Ajustes do app
 * (Reportar problema, Sugerir funcionalidade e Feedback geral), nas abas
 * Abertas e Resolvidas, com o filtro de tipo, em leitura única (20 por vez,
 * "Carregar mais" e o "Atualizar"). O nome e o @ de quem mandou são lidos ao
 * vivo de `users/{uid}`. Admin e editor com a seção marcam como resolvida e
 * reabrem (a `resolveSupportMessage`); o Leitor só lê. Depois da ação, a
 * mensagem sai da aba na hora, como na fila da Moderação, e a contagem do
 * cabeçalho é lida de novo.
 */
export function SupportPage() {
  return <SectionGate section="support">{(member) => <SupportContent member={member} />}</SectionGate>;
}

function SupportContent({ member }: { member: StaffMember }) {
  const canEdit = canEditSection(member, "support");
  const seesFans = canSeeSection(member, "fans");
  const [tab, setTab] = useState<SupportStatus>("open");
  const [kind, setKind] = useState<KindFilter>("all");
  const [round, setRound] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const [countVersion, setCountVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [reader] = useState<FanProfileReader>(createSupportFanReader);
  // O aviso de sucesso; a recusa aparece dentro do diálogo, com a frase do servidor.
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  // A confirmação aberta e a mensagem dela, que sai da aba quando a ação dá certo.
  const [asking, setAsking] = useState<{ id: string; request: ConfirmRequest } | null>(null);
  const [confirmKey, setConfirmKey] = useState(0);
  // Uma falha incerta (ou a resposta que chegou com o diálogo fora da tela): a lista é lida de novo quando o diálogo fecha.
  const [stale, setStale] = useState(false);
  if (stale && (asking === null || !canEdit)) {
    setStale(false);
    setListVersion((value) => value + 1);
    setCountVersion((value) => value + 1);
  }

  const count = useLoad(
    useCallback(() => countOpenSupport(), []),
    `${round}-${countVersion}`,
  );
  const load = useCallback((after: PageCursor | null) => getSupportPage(tab, kind, after), [tab, kind]);
  const list = usePagedList(load, (message: SupportMessage) => message.id, { one: "mensagem carregada", many: "mensagens carregadas" }, `${round}-${listVersion}`);

  // As mensagens que saíram da aba (resolvidas, reabertas ou apagadas no servidor), presas à leitura que está na tela:
  // a próxima leitura (o "Atualizar", outra aba, outro filtro) já vem sem elas.
  const [removed, setRemoved] = useState<{ at: Date | null; ids: string[] }>({ at: null, ids: [] });
  const loadedAt = useRef(list.loadedAt);
  useEffect(() => {
    loadedAt.current = list.loadedAt;
  }, [list.loadedAt]);
  const gone = removed.at !== null && removed.at === list.loadedAt ? removed.ids : [];
  const messages = list.state.status === "ready" ? list.state.data.filter((message) => !gone.includes(message.id)) : [];
  const date = new Date(now);

  const [focusTarget, setFocusTarget] = useState<{ id: string; key: number } | null>(null);
  // Num efeito: roda depois de o diálogo que fechou devolver o foco, e o título da lista fica com ele.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  function hide(id: string) {
    const at = loadedAt.current;
    setRemoved((current) => (current.at === at ? { at, ids: [...current.ids, id] } : { at, ids: [id] }));
  }

  function show(text: string) {
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, text }));
    setFocusTarget((current) => ({ id: LIST_HEADING_ID, key: (current?.key ?? 0) + 1 }));
  }

  function refresh() {
    setNow(Date.now());
    reader.clear();
    setNotice(null);
    setRound((value) => value + 1);
  }

  function changeTab(next: SupportStatus) {
    setNotice(null);
    setTab(next);
  }

  function ask(message: SupportMessage, name: string | null) {
    const action = actionOf(message.status);
    const request: ConfirmRequest = {
      ...actionConfirm(action, message.kind),
      cancelLabel: "Voltar",
      tone: "default",
      action: () => resolveSupportMessage({ id: message.id, action }),
      successMessage: actionDoneText(action, name),
      // A mesma ação de novo responde `ok` sem gravar: depois da falha incerta, o diálogo oferece "Tentar de novo".
      uncertainText: UNCERTAIN_RETRY_TEXT,
      onUncertain: () => setStale(true),
      onError: (failure) => {
        if (!isMessageGone(reasonOf(failure))) return;
        hide(message.id);
        setCountVersion((value) => value + 1);
      },
      blocksRetry: (failure) => isMessageGone(reasonOf(failure)),
      onOrphan: () => setStale(true),
    };
    setAsking({ id: message.id, request });
    setConfirmKey((value) => value + 1);
  }

  const subtitle = count.state.status === "ready" ? openCountText(count.state.data) : INFO.description;
  const title = tab === "open" ? "Mensagens abertas" : "Mensagens resolvidas";

  const listView = (
    <SectionCard id={LIST_HEADING_ID} title={title} meta={SUPPORT_LIST_META[tab]}>
      <div className="border-b border-line px-5 py-4">
        <FilterChips
          label="Tipo da mensagem"
          value={kind}
          onChange={(value) => {
            if (!isKindFilter(value)) return;
            setNotice(null);
            setKind(value);
          }}
          options={KIND_FILTERS.map((item) => ({ value: item, label: KIND_FILTER_LABELS[item] }))}
        />
      </div>
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId={LIST_HEADING_ID} onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando as mensagens..." />
      ) : messages.length === 0 ? (
        <EmptyState>{emptyText(tab, kind)}</EmptyState>
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          <ul className="m-0 list-none divide-y divide-line p-0">
            {messages.map((message) => (
              <li key={message.id}>
                <SupportCard message={message} reader={reader} round={round} now={date} seesFans={seesFans} canEdit={canEdit} onAct={ask} />
              </li>
            ))}
          </ul>
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
    </SectionCard>
  );

  return (
    <>
      <PageHeader title={INFO.label} subtitle={subtitle} actions={<RefreshButton onClick={refresh} busy={list.reloading} loadedAt={list.loadedAt} />} />
      {count.refreshError ? <p className="m-0 text-[13px] text-danger">A contagem não atualizou: {count.refreshError}</p> : null}

      <div aria-live="polite" className="sr-only">
        {notice ? <p key={notice.key}>{notice.text}</p> : null}
      </div>
      {notice ? (
        <Notice tone="success" announce={false}>
          {notice.text}
        </Notice>
      ) : null}

      <Tabs
        label="Mensagens do Suporte"
        value={tab}
        onChange={changeTab}
        tabs={[
          { id: "open", label: SUPPORT_STATUS_LABELS.open, render: () => listView },
          { id: "resolved", label: SUPPORT_STATUS_LABELS.resolved, render: () => listView },
        ]}
      />

      <ConfirmDialog
        key={`confirmar-${confirmKey}`}
        request={canEdit ? (asking?.request ?? null) : null}
        onClose={() => setAsking(null)}
        onDone={(message) => {
          if (asking) hide(asking.id);
          setAsking(null);
          setCountVersion((value) => value + 1);
          show(message);
        }}
      />
    </>
  );
}

/**
 * Uma mensagem: o fã (nome, @ e foto lidos de `users/{uid}`, ou "Conta não
 * encontrada"), o tipo, a data e a hora, o texto inteiro com as quebras de
 * linha, a linha do aparelho no problema e, nas resolvidas, quem resolveu e
 * quando. O texto vai como texto, nunca como HTML.
 */
function SupportCard({
  message,
  reader,
  round,
  now,
  seesFans,
  canEdit,
  onAct,
}: {
  message: SupportMessage;
  reader: FanProfileReader;
  /** Muda com o "Atualizar": o perfil é lido de novo, com o nome de antes na tela. */
  round: number;
  now: Date;
  seesFans: boolean;
  canEdit: boolean;
  onAct: (message: SupportMessage, name: string | null) => void;
}) {
  const uid = message.uid;
  const read = useLoad(
    useCallback(() => (uid ? reader.get(uid) : Promise.resolve(null)), [reader, uid]),
    round,
  );
  const fan = read.state.status === "ready" ? read.state.data : null;
  const missing = read.state.status === "ready" && !fan;
  const name = fan ? fanDisplayName(fan) : missing ? FAN_NOT_FOUND_TEXT : read.state.status === "error" ? "Fã" : "Carregando...";
  const kindLabel = supportKindLabel(message.kind);
  const device = deviceText(message);
  const actionName = fan ? fanDisplayName(fan) : null;

  return (
    <article className="flex flex-col gap-3 px-5 py-4">
      <h3 className="sr-only">
        {kindLabel} de {name}
      </h3>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <FanAvatar name={missing ? "?" : name} photoURL={fan?.photoURL ?? null} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className={missing ? "truncate text-sm font-semibold text-fg/65" : "truncate text-sm font-semibold text-fg"}>{name}</span>
            {fan?.username ? <span className="truncate text-[12.5px] text-fg/65">@{fan.username}</span> : null}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{kindLabel}</Badge>
          <span className="text-[12.5px] text-fg/60">
            {message.createdAt ? <time dateTime={message.createdAt.toISOString()}>{supportWhen(message.createdAt, now)}</time> : "sem data"}
          </span>
        </span>
      </div>
      <blockquote className="m-0 rounded-lg border border-line bg-sunken px-4 py-3 text-[14px] leading-relaxed break-words whitespace-pre-wrap text-fg/90">
        {message.text || <span className="text-fg/60">Sem texto.</span>}
      </blockquote>
      {device || message.status === "resolved" ? (
        <dl className="m-0 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {device ? (
            <div className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-fg/55">Aparelho:</dt>
              <dd className="m-0 min-w-0 break-words text-fg/85">{device}</dd>
            </div>
          ) : null}
          {message.status === "resolved" ? (
            <div className="flex min-w-0 gap-1.5">
              <dt className="sr-only">Situação:</dt>
              <dd className="m-0 min-w-0 text-fg/85">{resolvedText(message, now)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {read.state.status === "error" ? (
        <p className="m-0 text-[13px] text-danger">
          O perfil do fã não carregou: {read.state.message}{" "}
          <Button size="sm" variant="ghost" onClick={read.reload}>
            Tentar de novo
          </Button>
        </p>
      ) : null}
      {(seesFans && uid && !missing) || canEdit ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {canEdit ? (
            <Button size="sm" variant="secondary" onClick={() => onAct(message, actionName)} aria-haspopup="dialog">
              {message.status === "open" ? <CheckCheck aria-hidden="true" className="size-4" /> : <RotateCcw aria-hidden="true" className="size-4" />}
              {message.status === "open" ? (
                <>
                  Marcar como resolvida<span className="sr-only">: mensagem de {name}</span>
                </>
              ) : (
                <>
                  Reabrir<span className="sr-only"> a mensagem de {name}</span>
                </>
              )}
            </Button>
          ) : null}
          {seesFans && uid && !missing ? (
            <Link href={`/fas/${uid}`} className="text-[13px] text-fg/75 underline underline-offset-2 hover:text-fg">
              Abrir a ficha<span className="sr-only"> de {name}</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
