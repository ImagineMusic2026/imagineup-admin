"use client";

import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback } from "react";

import { FanAvatar } from "@/components/painel/fan-avatar";
import { Badge } from "@/components/ui/badge";
import { cx } from "@/components/ui/cx";
import { Missing } from "@/components/ui/detail-list";
import type { StatusStyle } from "@/components/ui/status-chip";
import { StatusChip } from "@/components/ui/status-chip";
import { useLoad } from "@/components/ui/use-load";
import { getPostMediaUrls } from "@/lib/fan-club-media";
import {
  APPLICATION_STATUS_LABELS,
  FAN_CLUB_STATUS_LABELS,
  POST_REJECT_REASON_LABELS,
  POST_STATUS_LABELS,
  authorLabel,
  fanClubLabel,
  lastCharStart,
  mediaGoneText,
  postMediaSource,
  type ApplicationStatus,
  type FanClub,
  type FanClubPost,
  type FanClubStatus,
  type PostStatus,
} from "@/lib/fan-clubs";
import { formatDay, formatNumber, formatTime } from "@/lib/format";

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

/** A publicação: ciano no ar; a recusada e a oculta pela equipe em `danger`; o resto, muted. */
export const POST_STYLES: Record<PostStatus, StatusStyle> = {
  pending: { label: POST_STATUS_LABELS.pending, tone: "muted", dot: true },
  published: { label: POST_STATUS_LABELS.published, tone: "cyan", dot: true },
  rejected: { label: POST_STATUS_LABELS.rejected, tone: "danger", dot: true },
  withdrawn: { label: POST_STATUS_LABELS.withdrawn, tone: "muted", dot: true },
  hidden: { label: POST_STATUS_LABELS.hidden, tone: "danger", dot: true },
  removed: { label: POST_STATUS_LABELS.removed, tone: "muted", dot: true },
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

/**
 * O nome do fã-clube com o selo de oficial (34.23) logo depois: o escudo com o
 * check, branco e preenchido, como o do app. O nome quebra nos espaços e nos
 * hífens, e o selo fica preso ao último caractere (nunca desce sozinho de
 * linha). O ícone fica fora do leitor, que ouve "Nome, fã-clube oficial"
 * (também dentro do link da linha da lista); o vão é margem, e não espaço de
 * texto, para o leitor não ouvir um espaço antes da vírgula. O `title` explica
 * o escudo a quem passa o mouse, por cima do link.
 */
export function FanClubName({ name, official, size = "sm" }: { name: string; official: boolean; size?: "sm" | "lg" }) {
  if (!official) return name;
  const cut = lastCharStart(name);
  return (
    <>
      {name.slice(0, cut)}
      <span className="whitespace-nowrap">
        {name.slice(cut)}
        <span aria-hidden="true" title="Fã-clube oficial" className={cx("relative z-10 inline-flex align-[-0.125em]", size === "lg" ? "ml-2" : "ml-1.5")}>
          <ShieldCheck className={cx("fill-fg text-ink", size === "lg" ? "size-[22px]" : "size-3.5")} />
        </span>
        <span className="sr-only">, fã-clube oficial</span>
      </span>
    </>
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

/** Uma imagem da publicação, com o tamanho guardado e o link para abrir em outra aba. */
function PostImageFigure({ url, label, width, height, size }: { url: string; label: string; width: number; height: number; size: "photo" | "thumb" }) {
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className={size === "photo" ? "block w-[200px]" : "block w-[104px]"}>
        <span className="relative block aspect-[4/5] overflow-hidden rounded-lg border border-line bg-sunken">
          <Image src={url} alt={`${label} da publicação`} fill sizes={size === "photo" ? "200px" : "104px"} unoptimized className="object-cover" />
        </span>
        <span className="sr-only"> (abre em outra aba)</span>
      </a>
      <figcaption className="flex items-center gap-1 text-[12px] text-fg/60">
        {label}
        {width && height ? `, ${formatNumber(width)} por ${formatNumber(height)}` : ""}
        <ExternalLink aria-hidden="true" className="size-3" />
      </figcaption>
    </figure>
  );
}

function PhotoPair({ post, photo, thumb }: { post: FanClubPost; photo: string; thumb: string }) {
  const media = post.media!;
  return (
    <div className="flex flex-wrap items-start gap-4" role="group" aria-label="A foto e a miniatura, que vão ao ar as duas">
      <PostImageFigure url={photo} label="Foto" width={media.photo.width} height={media.photo.height} size="photo" />
      <PostImageFigure url={thumb} label="Miniatura" width={media.thumb.width} height={media.thumb.height} size="thumb" />
    </div>
  );
}

/** As fotos da oculta e da tirada do ar, lidas pelo caminho (o token mudou, 34.22). */
function PathPhotos({ post }: { post: FanClubPost }) {
  const urls = useLoad(useCallback(() => getPostMediaUrls(post), [post]));
  if (urls.state.status === "loading") return <p className="m-0 text-[13px] text-fg/60">Carregando as fotos...</p>;
  if (urls.state.status === "error") return <p className="m-0 text-[13px] text-danger">As fotos não carregaram: {urls.state.message}</p>;
  if (!urls.state.data) return null;
  return <PhotoPair post={post} photo={urls.state.data.photo} thumb={urls.state.data.thumb} />;
}

/**
 * A foto e a miniatura lado a lado (34.10, itens 5, 7 e 8): as duas vão ao
 * ar (a miniatura nos cartões) e chegam em envios separados, então a equipe
 * confere as duas. A em análise e a no ar usam a URL guardada; a oculta e a
 * tirada do ar, o caminho; a recusada e a retirada perderam os arquivos.
 */
export function PostPhotos({ post }: { post: FanClubPost }) {
  const source = postMediaSource(post);
  if (source === "none") return null;
  if (source === "gone") return <Missing>{mediaGoneText(post)}</Missing>;
  if (source === "path") return <PathPhotos post={post} />;
  return <PhotoPair post={post} photo={post.media!.photo.url} thumb={post.media!.thumb.url} />;
}

/**
 * Uma publicação: o autor, o fã-clube, a central, a situação, o texto, as
 * fotos e as datas, com as ações de quem decide no fim. O texto e as fotos
 * são do fã: nunca vão aos Logs.
 */
export function PostCard({
  post,
  club,
  artist,
  now,
  showClub = true,
  headingLevel = 3,
  photosOff = false,
  actions,
}: {
  post: FanClubPost;
  /** O fã-clube da publicação; `undefined` carregando, `null` sem ele. */
  club?: FanClub | null;
  artist: string;
  now: Date;
  showClub?: boolean;
  headingLevel?: 3 | 4;
  /** A central desligou as fotos dos fãs depois do envio (só com a seção Artistas, na fila de revisão). */
  photosOff?: boolean;
  actions?: React.ReactNode;
}) {
  const author = authorLabel(post);
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <article className="flex flex-col gap-3 px-5 py-4">
      <Heading className="sr-only">Publicação de {author}</Heading>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-3">
          <FanAvatar name={author} photoURL={post.authorPhotoURL} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-fg">{author}</span>
            {post.authorUsername ? <span className="block truncate text-[12.5px] text-fg/60">@{post.authorUsername}</span> : null}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{post.kind === "photo" ? "Com foto" : "Só texto"}</Badge>
          {photosOff ? <Badge tone="danger">Fotos não autorizadas</Badge> : null}
          <StatusChip status={post.status} map={POST_STYLES} />
        </span>
      </div>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg/60">
        {showClub ? (
          <span>
            Fã-clube{" "}
            {club === undefined ? (
              "carregando..."
            ) : club ? (
              <>
                <Link href={`/fa-clubes/${club.id}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
                  {fanClubLabel(club)}
                </Link>
                {club.status !== "active" ? <span className="text-fg/70"> ({FAN_CLUB_STATUS_LABELS[club.status].toLowerCase()}: não aparece para os fãs)</span> : null}
              </>
            ) : (
              <span className="font-mono">{post.clubId}</span>
            )}
          </span>
        ) : null}
        <span>Central {artist}</span>
        <span>Enviada {shortWhen(post.submittedAt, now)}</span>
        {post.publishedAt ? <span>{post.status === "published" ? "No ar desde" : "Publicada em"} {shortWhen(post.publishedAt, now)}</span> : null}
        {post.reviewedBy?.name && post.status !== "pending" ? <span>Decidida por {post.reviewedBy.name}</span> : null}
      </p>
      <p className="m-0 whitespace-pre-line break-words text-[14.5px] leading-relaxed text-fg/90">{post.text || <Missing>Sem texto</Missing>}</p>
      <PostPhotos post={post} />
      {photosOff ? <p className="m-0 text-[13px] text-danger">A central desligou as fotos dos fãs depois do envio. Aprovar põe a foto no ar mesmo assim.</p> : null}
      {post.status === "rejected" && post.rejectReason ? <p className="m-0 text-[13px] text-fg/70">Motivo da recusa: {POST_REJECT_REASON_LABELS[post.rejectReason]}</p> : null}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}
