"use client";

import { ArrowDown, ArrowUp, Eye, Pencil, Trash2 } from "lucide-react";

import { ArtistStatusBadge, ArtistThumb } from "@/components/artistas/artist-bits";
import { SectionCard } from "@/components/painel/section-card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/notice";
import {
  FEATURED_COUNT,
  PUBLISH_REQUIREMENT_LABELS,
  artistMissingForPublish,
  deleteArtistLabel,
  deleteBlockedText,
  featuredArtistIds,
  formatDay,
  formatFans,
  genreCityLine,
  managerLabel,
  publishBlockedText,
  type ArtistEntry,
} from "@/lib/artists";

export const DRAFTS_HEADING_ID = "titulo-rascunhos";
export const ALL_HEADING_ID = "titulo-todas-centrais";

/**
 * Aviso de uma ação feita nesta lista, mostrado onde a ação aconteceu: na
 * linha da central (`artistId`) ou no topo da lista (`null`, quando a linha
 * saiu dela). Quem anuncia para leitor de tela é a página, numa região viva
 * que já existe; aqui o aviso é só visual (`announce={false}`).
 */
export interface ListNotice {
  key: number;
  tone: "success" | "error" | "info";
  text: string;
  artistId: string | null;
}

function InlineNotice({ notice, className }: { notice: ListNotice; className?: string }) {
  return (
    <Notice tone={notice.tone} announce={false} className={className}>
      {notice.text}
    </Notice>
  );
}

function SectionNotice({ notice }: { notice: ListNotice | null }) {
  if (!notice || notice.artistId !== null) return null;
  return (
    <div className="px-5 pt-4">
      <InlineNotice notice={notice} />
    </div>
  );
}

/** "Ver" de quem só vê a seção: abre os detalhes só para leitura. */
function ViewButton({ artist, onView }: { artist: ArtistEntry; onView: (artist: ArtistEntry) => void }) {
  return (
    <Button size="sm" variant="secondary" onClick={() => onView(artist)} aria-label={`Ver ${artist.name}`}>
      <Eye aria-hidden="true" className="size-3.5" />
      Ver
    </Button>
  );
}

/** Rótulo visível no celular (linhas empilhadas) e só para leitor de tela na tabela larga. */
function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-fg/50 xl:sr-only">{children}</span>;
}

/**
 * Publicar, ou "Tirar do ar" quando a central está no ar (com `onUnpublish`).
 * É sempre o mesmo botão, só muda o texto: o foco continua nele quando o
 * status troca. Com algo faltando, ele continua focável (`aria-disabled`) e
 * diz o motivo, em vez de sumir do Tab como um `disabled`; o clique mostra o
 * motivo na tela (`onBlocked`), que o `title` sozinho não mostra no toque nem
 * no teclado.
 */
function PublishButton({
  artist,
  label,
  busyId,
  onPublish,
  onUnpublish,
  onBlocked,
  reasonPrefix,
}: {
  artist: ArtistEntry;
  label: string;
  busyId: string | null;
  onPublish: (artist: ArtistEntry) => void;
  onUnpublish?: (artist: ArtistEntry) => void;
  onBlocked: (artist: ArtistEntry, reason: string) => void;
  /** Os ids precisam ser únicos: a mesma central aparece nas duas listas. */
  reasonPrefix: string;
}) {
  const unpublish = artist.status === "published" && onUnpublish ? onUnpublish : null;
  const missing = unpublish ? [] : artistMissingForPublish(artist);
  const blocked = missing.length > 0;
  const busy = busyId === artist.id;
  const reasonId = `${reasonPrefix}-${artist.id}`;
  const text = unpublish ? "Tirar do ar" : label;
  return (
    <>
      <Button
        size="sm"
        variant={unpublish ? "secondary" : "primary"}
        busy={busy}
        disabled={Boolean(busyId) && !busy}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : undefined}
        aria-label={`${text} ${artist.name}`}
        title={blocked ? publishBlockedText(missing) : undefined}
        data-blocked={blocked || undefined}
        onClick={() => {
          if (unpublish) unpublish(artist);
          else if (blocked) onBlocked(artist, publishBlockedText(missing));
          else onPublish(artist);
        }}
        className="min-w-[104px] data-[blocked]:cursor-not-allowed data-[blocked]:opacity-55 data-[blocked]:hover:bg-pink-strong"
      >
        {busy ? "Publicando..." : text}
      </Button>
      <span id={reasonId} hidden>
        {blocked ? publishBlockedText(missing) : ""}
      </span>
    </>
  );
}

// Alvo de 44 px no celular e em tela de toque; 36 px no computador com mouse.
// No celular a lixeira vai para a ponta da linha, longe dos outros botões.
const DELETE_BUTTON =
  "ml-auto grid size-11 shrink-0 place-items-center rounded-lg border border-line-strong text-fg/70 transition-colors hover:border-danger/50 hover:bg-danger/10 hover:text-danger xl:ml-0 xl:pointer-fine:size-9 data-[blocked]:cursor-not-allowed data-[blocked]:opacity-55 data-[blocked]:hover:border-line-strong data-[blocked]:hover:bg-transparent data-[blocked]:hover:text-fg/70";

/**
 * Lixeira, só de admin: apaga a central em qualquer status, depois da
 * confirmação. Com fãs, ela continua focável (`aria-disabled`) e diz o motivo;
 * o clique mostra o motivo na linha (`onBlocked`), a mesma regra do servidor.
 */
function DeleteButton({
  artist,
  onDelete,
  onBlocked,
  reasonPrefix,
}: {
  artist: ArtistEntry;
  onDelete: (artist: ArtistEntry) => void;
  onBlocked: (artist: ArtistEntry, reason: string) => void;
  /** Os ids precisam ser únicos: a mesma central aparece nas duas listas. */
  reasonPrefix: string;
}) {
  const reason = deleteBlockedText(artist);
  const label = deleteArtistLabel(artist.name);
  const reasonId = `${reasonPrefix}-${artist.id}`;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-disabled={reason !== null || undefined}
        aria-describedby={reason !== null ? reasonId : undefined}
        data-blocked={reason !== null || undefined}
        onClick={() => {
          if (reason !== null) onBlocked(artist, reason);
          else onDelete(artist);
        }}
        className={DELETE_BUTTON}
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
      <span id={reasonId} hidden>
        {reason ?? ""}
      </span>
    </>
  );
}

// A coluna das ações tem largura fixa: com `auto`, o cabeçalho (vazio) e as
// linhas (com botões) dividiriam as outras colunas de jeitos diferentes.
const DRAFT_GRID_ADMIN =
  "xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,1.3fr)_268px] xl:items-center xl:gap-4";
const DRAFT_GRID =
  "xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,1.3fr)_220px] xl:items-center xl:gap-4";
const DRAFT_GRID_READONLY =
  "xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,1.3fr)_96px] xl:items-center xl:gap-4";

export function DraftsSection({
  drafts,
  now,
  canEdit,
  canDelete,
  publishingId,
  notice,
  onEdit,
  onView,
  onPublish,
  onBlocked,
  onDelete,
  onDeleteBlocked,
}: {
  drafts: ArtistEntry[];
  now: Date;
  canEdit: boolean;
  canDelete: boolean;
  publishingId: string | null;
  notice: ListNotice | null;
  onEdit: (artist: ArtistEntry) => void;
  onView: (artist: ArtistEntry) => void;
  onPublish: (artist: ArtistEntry) => void;
  onBlocked: (artist: ArtistEntry, reason: string) => void;
  onDelete: (artist: ArtistEntry) => void;
  onDeleteBlocked: (artist: ArtistEntry, reason: string) => void;
}) {
  const grid = !canEdit ? DRAFT_GRID_READONLY : canDelete ? DRAFT_GRID_ADMIN : DRAFT_GRID;
  return (
    <SectionCard id={DRAFTS_HEADING_ID} title="Rascunhos" meta="Publicar libera a central no app.">
      <SectionNotice notice={notice} />
      {drafts.length === 0 ? (
        <p className="m-0 px-5 py-6 text-sm text-fg/65">Nenhum rascunho agora.</p>
      ) : (
        <>
          <div aria-hidden="true" className={cx("hidden px-5 pt-3 pb-2 group-label text-fg/50", grid)}>
            <span>Artista</span>
            <span>Gestor</span>
            <span>Criada em</span>
            <span>Falta para publicar</span>
            <span />
          </div>
          <ul className="m-0 list-none p-0">
            {drafts.map((artist) => {
              const missing = artistMissingForPublish(artist);
              return (
                <li key={artist.id} className={cx("border-t border-line px-5 py-4 first:border-t-0 xl:first:border-t xl:py-3.5", grid)}>
                  <div className="flex min-w-0 items-center gap-3">
                    <ArtistThumb artist={artist} />
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-semibold text-fg">{artist.name}</p>
                      <p className="m-0 truncate text-[13px] text-fg/60">@{artist.handle}</p>
                    </div>
                  </div>
                  <p className={cx("m-0 mt-3 truncate text-[13px] xl:mt-0", artist.internal ? "text-fg/80" : "text-fg/55")}>
                    <CellLabel>Gestor: </CellLabel>
                    {managerLabel(artist)}
                  </p>
                  <p className="m-0 mt-1 text-[13px] text-fg/80 xl:mt-0">
                    <CellLabel>Criada em </CellLabel>
                    {artist.createdAt ? <time dateTime={artist.createdAt.toISOString()}>{formatDay(artist.createdAt, now)}</time> : "agora"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] xl:mt-0">
                    <CellLabel>Falta para publicar: </CellLabel>
                    {missing.length === 0 ? (
                      <span className="font-medium text-cyan">Pronta para publicar</span>
                    ) : (
                      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                        {missing.map((item) => (
                          <li key={item}>
                            <Badge tone="muted">{PUBLISH_REQUIREMENT_LABELS[item]}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {canEdit ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 xl:mt-0 xl:justify-end">
                      <Button size="sm" variant="secondary" onClick={() => onEdit(artist)} aria-label={`Editar ${artist.name}`}>
                        <Pencil aria-hidden="true" className="size-3.5" />
                        Editar
                      </Button>
                      <PublishButton
                        artist={artist}
                        label="Publicar central"
                        busyId={publishingId}
                        onPublish={onPublish}
                        onBlocked={onBlocked}
                        reasonPrefix="motivo-rascunho"
                      />
                      {canDelete ? (
                        <DeleteButton artist={artist} onDelete={onDelete} onBlocked={onDeleteBlocked} reasonPrefix="lixeira-rascunho" />
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-3 flex xl:mt-0 xl:justify-end">
                      <ViewButton artist={artist} onView={onView} />
                    </div>
                  )}
                  {notice?.artistId === artist.id ? <InlineNotice notice={notice} className="mt-3 xl:col-span-full xl:mt-0" /> : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

const ALL_GRID_ADMIN =
  "xl:grid xl:grid-cols-[96px_minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_252px] xl:items-center xl:gap-4";
const ALL_GRID =
  "xl:grid xl:grid-cols-[96px_minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_204px] xl:items-center xl:gap-4";
const ALL_GRID_READONLY =
  "xl:grid xl:grid-cols-[48px_minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_96px] xl:items-center xl:gap-4";

const ORDER_BUTTON =
  "grid size-8 place-items-center rounded-lg border border-line-strong text-fg/75 transition-colors hover:border-fg/30 hover:bg-fg/[0.07] hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:bg-transparent";

export type MoveDirection = "up" | "down";

export function AllArtistsSection({
  artists,
  canEdit,
  canCreate,
  canDelete,
  publishingId,
  announcement,
  notice,
  onMove,
  onEdit,
  onView,
  onPublish,
  onBlocked,
  onUnpublish,
  onDelete,
  onDeleteBlocked,
}: {
  artists: ArtistEntry[];
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  publishingId: string | null;
  announcement: { key: number; text: string } | null;
  notice: ListNotice | null;
  onMove: (artist: ArtistEntry, direction: MoveDirection) => void;
  onEdit: (artist: ArtistEntry) => void;
  onView: (artist: ArtistEntry) => void;
  onPublish: (artist: ArtistEntry) => void;
  onBlocked: (artist: ArtistEntry, reason: string) => void;
  onUnpublish: (artist: ArtistEntry) => void;
  onDelete: (artist: ArtistEntry) => void;
  onDeleteBlocked: (artist: ArtistEntry, reason: string) => void;
}) {
  const grid = !canEdit ? ALL_GRID_READONLY : canDelete ? ALL_GRID_ADMIN : ALL_GRID;
  const featured = featuredArtistIds(artists);
  const last = artists.length - 1;
  return (
    <SectionCard
      id={ALL_HEADING_ID}
      title="Todas as centrais"
      meta={`Os ${FEATURED_COUNT} primeiros no ar são os destaques da escolha de artistas.`}
    >
      {/* Nova posição depois de Subir ou Descer. Cada anúncio entra como um nó novo, para ser lido mesmo repetido. */}
      <div aria-live="polite" className="sr-only">
        {announcement ? <p key={announcement.key}>{announcement.text}</p> : null}
      </div>
      <SectionNotice notice={notice} />
      {artists.length === 0 ? (
        <p className="m-0 px-5 py-6 text-sm text-fg/65">
          {canCreate ? "Nenhuma central ainda. Crie a primeira." : "Nenhuma central ainda."}
        </p>
      ) : (
        <>
          <div aria-hidden="true" className={cx("hidden px-5 pt-3 pb-2 group-label text-fg/50", grid)}>
            <span>Ordem</span>
            <span>Central</span>
            <span>@</span>
            <span>Fãs</span>
            <span>Status</span>
            <span />
          </div>
          <ol className="m-0 list-none p-0">
            {artists.map((artist, index) => {
              const line = genreCityLine(artist);
              return (
                <li
                  key={artist.id}
                  className={cx(
                    "flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-line px-5 py-4 first:border-t-0 xl:first:border-t xl:py-3.5",
                    grid,
                  )}
                >
                  <div className="flex w-full items-center gap-3 xl:contents">
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="w-6 text-right font-display text-sm font-semibold tabular-nums text-fg/80">
                        <span className="sr-only">Posição </span>
                        {index + 1}
                      </span>
                      {canEdit ? (
                        <>
                          <button
                            type="button"
                            data-order-button={`${artist.id}:up`}
                            disabled={index === 0}
                            onClick={() => onMove(artist, "up")}
                            aria-label={`Subir ${artist.name}`}
                            title="Subir"
                            className={ORDER_BUTTON}
                          >
                            <ArrowUp aria-hidden="true" className="size-4" />
                          </button>
                          <button
                            type="button"
                            data-order-button={`${artist.id}:down`}
                            disabled={index === last}
                            onClick={() => onMove(artist, "down")}
                            aria-label={`Descer ${artist.name}`}
                            title="Descer"
                            className={ORDER_BUTTON}
                          >
                            <ArrowDown aria-hidden="true" className="size-4" />
                          </button>
                        </>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 items-center gap-3">
                      <ArtistThumb artist={artist} />
                      <div className="min-w-0">
                        <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                          <span className="min-w-0 truncate">{artist.name}</span>
                          {featured.has(artist.id) ? <Badge tone="pink">Destaque</Badge> : null}
                        </p>
                        {line ? <p className="m-0 truncate text-[13px] text-fg/60">{line}</p> : null}
                      </div>
                    </div>
                  </div>
                  <p className="m-0 min-w-0 truncate text-[13px] text-fg/80">
                    <span className="sr-only">Endereço: </span>@{artist.handle}
                  </p>
                  <p className="m-0 text-[13px] text-fg/80">
                    <span className="font-display font-semibold text-fg tabular-nums">{formatFans(artist.fanCount)}</span>{" "}
                    <span className="xl:sr-only">{artist.fanCount === 1 ? "fã" : "fãs"}</span>
                  </p>
                  <div>
                    <span className="sr-only">Status: </span>
                    <ArtistStatusBadge status={artist.status} />
                  </div>
                  {canEdit ? (
                    <div className="flex w-full flex-wrap items-center gap-2 pt-0.5 xl:w-auto xl:justify-end xl:pt-0">
                      <Button size="sm" variant="secondary" onClick={() => onEdit(artist)} aria-label={`Editar ${artist.name}`}>
                        <Pencil aria-hidden="true" className="size-3.5" />
                        Editar
                      </Button>
                      <PublishButton
                        artist={artist}
                        label="Publicar"
                        busyId={publishingId}
                        onPublish={onPublish}
                        onUnpublish={onUnpublish}
                        onBlocked={onBlocked}
                        reasonPrefix="motivo-central"
                      />
                      {canDelete ? (
                        <DeleteButton artist={artist} onDelete={onDelete} onBlocked={onDeleteBlocked} reasonPrefix="lixeira-central" />
                      ) : null}
                      <ContentLinks artist={artist} />
                    </div>
                  ) : (
                    <div className="flex w-full flex-wrap items-center gap-2 pt-0.5 xl:w-auto xl:justify-end xl:pt-0">
                      <ViewButton artist={artist} onView={onView} />
                      <ContentLinks artist={artist} />
                    </div>
                  )}
                  {notice?.artistId === artist.id ? <InlineNotice notice={notice} className="w-full xl:col-span-full" /> : null}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </SectionCard>
  );
}

/** "Ver mural" e "Ver agenda" da central, com o filtro no endereço. */
function ContentLinks({ artist }: { artist: ArtistEntry }) {
  return (
    <>
      <ButtonLink href={`/artistas/mural?central=${encodeURIComponent(artist.id)}`} size="sm" variant="ghost" aria-label={`Ver mural de ${artist.name}`}>
        Mural
      </ButtonLink>
      <ButtonLink href={`/artistas/agenda?central=${encodeURIComponent(artist.id)}`} size="sm" variant="ghost" aria-label={`Ver agenda de ${artist.name}`}>
        Agenda
      </ButtonLink>
    </>
  );
}
