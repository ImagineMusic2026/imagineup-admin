"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DataTable, LoadMore, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectInput, TextInput } from "@/components/ui/field";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { RefreshButton } from "@/components/ui/refresh-button";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList } from "@/components/ui/use-paged-list";
import {
  AUDIT_ACTIONS,
  AUDIT_PERIODS,
  AUDIT_SECTIONS,
  AUTOMATIC_ACTOR,
  EMPTY_FILTERS,
  TARGET_LABELS,
  TARGET_TYPES,
  actionLabel,
  actionsOfSection,
  actorLabel,
  auditSectionLabel,
  changeFilters,
  detailLines,
  filterBlocked,
  normalizeTargetId,
  parseTarget,
  primaryTarget,
  type AuditEntry,
  type AuditFilters,
  type AuditPeriod,
  type AuditSection,
  type TargetType,
} from "@/lib/audit";
import { countAudit, findFanUidByHandle, getAuditPage, getAuditPeople } from "@/lib/audit-data";
import { errorMessage, readError } from "@/lib/errors";
import { FAN_UID_PATTERN } from "@/lib/fan-profile";
import { countLabel, formatDateTime, formatRelative } from "@/lib/format";
import { canSeeSection, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("audit");
const GRID = "xl:grid xl:grid-cols-[150px_minmax(0,0.9fr)_110px_minmax(0,1.1fr)_minmax(0,1fr)_110px] xl:items-center xl:gap-4";

/** Logs e auditoria (`/logs`): quem fez o quê no painel, e quando. Leitura única; ninguém muda nada aqui. */
export function LogsPage() {
  return <SectionGate section="audit">{(member) => <LogsContent member={member} />}</SectionGate>;
}

function LogsContent({ member }: { member: StaffMember }) {
  const [now] = useState(() => Date.now());
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadPage = useCallback(
    (after: Parameters<typeof getAuditPage>[2]) => getAuditPage(filters, now, after),
    [filters, now],
  );
  const list = usePagedList(loadPage, (entry) => entry.id, { one: "registro carregado", many: "registros carregados" });
  const loadCount = useCallback(() => countAudit(filters, now), [filters, now]);
  const count = useLoad(loadCount);
  const people = useLoad(getAuditPeople);

  const peopleNames = new Map((people.state.status === "ready" ? people.state.data : []).map((person) => [person.uid, person.name]));
  const filtered = filters.section || filters.person || filters.action || filters.target;

  function update(change: Partial<AuditFilters>) {
    setExpanded(null);
    setFilters((current) => changeFilters(current, change));
  }

  function refresh() {
    list.reload();
    count.reload();
  }

  const columns: Column<AuditEntry>[] = [
    {
      key: "when",
      header: "Quando",
      cell: (entry) =>
        entry.createdAt ? (
          <span className="flex flex-col">
            <time dateTime={entry.createdAt.toISOString()} className="font-semibold text-fg">
              {formatDateTime(entry.createdAt)}
            </time>
            <span className="text-[12px] text-fg/55">{formatRelative(entry.createdAt, new Date(now))}</span>
          </span>
        ) : (
          "Sem data"
        ),
    },
    { key: "who", header: "Quem", cell: (entry) => <span className="text-fg">{actorLabel(entry)}</span> },
    { key: "section", header: "Seção", cell: (entry) => auditSectionLabel(entry.section) },
    { key: "what", header: "O que", cell: (entry) => <span className="font-semibold text-fg">{actionLabel(entry)}</span> },
    { key: "target", header: "Alvo", cell: (entry) => <TargetCell entry={entry} member={member} names={peopleNames} /> },
    {
      key: "details",
      header: "",
      label: "",
      align: "end",
      cell: (entry) => {
        const open = expanded === entry.id;
        return (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            aria-controls={`detalhes-${entry.id}`}
            onClick={() => setExpanded(open ? null : entry.id)}
            aria-label={`Detalhes: ${actionLabel(entry)}${entry.createdAt ? `, ${formatDateTime(entry.createdAt)}` : ""}`}
          >
            Detalhes
            <ChevronDown aria-hidden="true" className={cx("size-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={INFO.label}
        subtitle={INFO.description}
        actions={<RefreshButton onClick={refresh} busy={list.reloading} loadedAt={list.loadedAt} />}
      />

      <SectionCard
        id="titulo-registros"
        title="Registros"
        meta={count.state.status === "ready" ? countLabel(count.state.data, "registro", "registros") : undefined}
      >
        <div className="border-b border-line px-5 py-4">
          <Filters filters={filters} member={member} people={people.state.status === "ready" ? people.state.data : null} onChange={update} />
        </div>
        {list.state.status === "error" ? (
          <LoadError message={list.state.message} headingId="titulo-registros" onRetry={refresh} />
        ) : list.state.status === "loading" ? (
          <LoadingRow label="Carregando os registros..." />
        ) : (
          <>
            {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
            <DataTable
              caption="Registros de Logs e auditoria, do mais novo"
              columns={columns}
              rows={list.state.data}
              rowKey={(entry) => entry.id}
              grid={GRID}
              focusRequest={list.focusRequest}
              empty={
                <EmptyState className="px-0 py-0">
                  {filtered ? "Nenhuma alteração com esses filtros." : "Nenhuma alteração neste período."}
                </EmptyState>
              }
              rowNotice={(entry) => (expanded === entry.id ? <Details entry={entry} /> : null)}
            />
            <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
          </>
        )}
      </SectionCard>
    </>
  );
}

function Details({ entry }: { entry: AuditEntry }) {
  const lines = detailLines(entry);
  return (
    <div id={`detalhes-${entry.id}`} className="rounded-[10px] border border-line bg-raised px-4 py-3 text-[13px]">
      {lines.length === 0 ? (
        <p className="m-0 text-fg/60">Sem detalhes.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-fg/85">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {entry.targets.length > 1 ? (
        <p className="mt-2 mb-0 text-[12.5px] text-fg/55">
          {countLabel(entry.targets.length, "alvo", "alvos")}: {entry.targets.map((target) => describeTarget(parseTarget(target).type, parseTarget(target).id)).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function describeTarget(type: TargetType | null, id: string): string {
  if (!type) return id;
  if (type === "artist") return `${TARGET_LABELS.artist} @${id}`;
  return `${TARGET_LABELS[type]} ${id}`;
}

function TargetCell({ entry, member, names }: { entry: AuditEntry; member: StaffMember; names: Map<string, string> }) {
  const { target, email, more } = primaryTarget(entry);
  const extra = more > 0 ? <span className="text-fg/55"> e mais {more}</span> : null;
  if (email) {
    return (
      <span className="break-words">
        Membro {target ? (names.get(target.id) ?? email) : email}
        {extra}
      </span>
    );
  }
  if (!target) return <span className="text-fg/55">Sem alvo</span>;
  if (target.type === "fan") {
    const seesFans = canSeeSection(member, "fans");
    const seesModeration = canSeeSection(member, "moderation");
    return (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate">
          Fã <span className="font-mono text-[12px] text-fg/75">{target.id}</span>
          {extra}
        </span>
        {seesFans || seesModeration ? (
          <span className="relative z-10 flex flex-wrap gap-x-3 text-[12.5px]">
            {seesFans ? (
              <Link href={`/fas/${target.id}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
                Ficha
              </Link>
            ) : null}
            {seesModeration ? (
              <Link href={`/moderacao/fas/${target.id}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
                Moderação
              </Link>
            ) : null}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="break-words">
      {describeTarget(target.type, target.id)}
      {extra}
    </span>
  );
}

function Filters({
  filters,
  member,
  people,
  onChange,
}: {
  filters: AuditFilters;
  member: StaffMember;
  people: { uid: string; name: string }[] | null;
  onChange: (change: Partial<AuditFilters>) => void;
}) {
  const sectionBlocked = filterBlocked("section", filters);
  const personBlocked = filterBlocked("person", filters);
  const actionBlocked = filterBlocked("action", filters);
  const actions = filters.section && !actionBlocked ? actionsOfSection(filters.section as AuditSection) : [];

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        label="Filtros dos registros"
        active={Boolean(filters.section || filters.person || filters.action || filters.target || filters.period !== EMPTY_FILTERS.period)}
        onClear={() => onChange(EMPTY_FILTERS)}
      >
        <FilterSelect
          label="Período"
          value={filters.period}
          onChange={(value) => onChange({ period: value as AuditPeriod })}
          options={AUDIT_PERIODS}
        />
        <FilterSelect
          label="Seção"
          value={filters.section}
          disabled={Boolean(sectionBlocked)}
          hint={sectionBlocked}
          onChange={(value) => onChange({ section: value })}
          options={[{ value: "", label: "Todas" }, ...AUDIT_SECTIONS.map((section) => ({ value: section, label: auditSectionLabel(section) }))]}
        />
        <FilterSelect
          label="Pessoa"
          value={filters.person}
          disabled={Boolean(personBlocked)}
          hint={personBlocked ?? (people ? null : "Carregando a equipe...")}
          onChange={(value) => onChange({ person: value })}
          options={[
            { value: "", label: "Todas" },
            { value: AUTOMATIC_ACTOR, label: "Automático" },
            ...(people ?? []).map((person) => ({ value: person.uid, label: person.name })),
          ]}
        />
        <FilterSelect
          label="Ação"
          value={filters.action}
          disabled={Boolean(actionBlocked)}
          hint={actionBlocked}
          onChange={(value) => onChange({ action: value })}
          options={[{ value: "", label: "Todas" }, ...actions.map((action) => ({ value: action, label: AUDIT_ACTIONS[action].label }))]}
          className="min-w-[220px]"
        />
      </FilterBar>
      <TargetFilter value={filters.target} member={member} onChange={(target) => onChange({ target })} />
    </div>
  );
}

/** O filtro por alvo: o tipo e o id (o @ da central, o código do pedido; o fã pelo uid, ou pelo @ com a seção Fãs). */
function TargetFilter({ value, member, onChange }: { value: string; member: StaffMember; onChange: (target: string) => void }) {
  const [type, setType] = useState<TargetType>("fan");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const applied = value ? parseTarget(value) : null;

  async function apply(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    const raw = text.trim();
    if (!raw) {
      setProblem("Escreva o identificador do alvo.");
      return;
    }
    if (type !== "fan") {
      const id = normalizeTargetId(type, raw);
      if (!id) {
        setProblem("Confira o identificador.");
        return;
      }
      onChange(`${type}:${id}`);
      return;
    }
    if (FAN_UID_PATTERN.test(raw)) {
      onChange(`fan:${raw}`);
      return;
    }
    if (!canSeeSection(member, "fans") && !canSeeSection(member, "moderation")) {
      setProblem("Cole o identificador do fã (o @ precisa da seção Fãs ou Moderação).");
      return;
    }
    setBusy(true);
    try {
      const uid = await findFanUidByHandle(raw);
      if (uid) onChange(`fan:${uid}`);
      else setProblem("Nenhum fã com esse @.");
    } catch (error) {
      setProblem(
        readError(error).code === "permission-denied"
          ? "Cole o identificador do fã: o @ só vira identificador para quem vê a seção Fãs."
          : errorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={apply} aria-label="Filtro por alvo" className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-[150px] flex-col gap-1">
        <label htmlFor="alvo-tipo" className="text-[12px] font-semibold text-fg/65">
          Alvo
        </label>
        <SelectInput id="alvo-tipo" value={type} onChange={(event) => setType(event.target.value as TargetType)} className="h-9 rounded-lg pl-3 text-[13.5px]">
          {TARGET_TYPES.map((item) => (
            <option key={item} value={item}>
              {TARGET_LABELS[item]}
            </option>
          ))}
        </SelectInput>
      </div>
      <div className="flex min-w-[240px] flex-1 flex-col gap-1">
        <label htmlFor="alvo-id" className="text-[12px] font-semibold text-fg/65">
          Identificador
        </label>
        <TextInput
          id="alvo-id"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={type === "fan" ? "uid do fã ou @" : type === "artist" ? "@ da central" : type === "redemption" ? "código do pedido" : "id"}
          describedBy={problem ? "alvo-problema" : undefined}
          invalid={Boolean(problem)}
          spellCheck={false}
          autoComplete="off"
          className="h-9 rounded-lg text-[13.5px]"
        />
      </div>
      <Button type="submit" size="sm" variant="secondary" busy={busy} className="h-9">
        {busy ? "Procurando..." : "Filtrar pelo alvo"}
      </Button>
      {applied ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-9"
          onClick={() => {
            setText("");
            onChange("");
          }}
        >
          Tirar o alvo ({describeTarget(applied.type, applied.id)})
        </Button>
      ) : null}
      <p id="alvo-problema" role={problem ? "alert" : undefined} className="m-0 w-full text-[12.5px] text-danger empty:hidden">
        {problem ?? ""}
      </p>
    </form>
  );
}
