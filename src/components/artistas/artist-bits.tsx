import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { cx } from "@/components/ui/cx";
import { ARTIST_STATUS_LABELS, type Artist, type ArtistStatus } from "@/lib/artists";
import { initialsOf } from "@/lib/staff";

/**
 * Foto pequena (3:4) da central, ou as iniciais sem foto. Decorativa: o nome
 * está sempre ao lado. As imagens já vêm no tamanho certo do Storage, então
 * vão sem a otimização da Vercel (`unoptimized`).
 */
export function ArtistThumb({ artist, className }: { artist: Pick<Artist, "name" | "thumb" | "photo">; className?: string }) {
  const image = artist.thumb ?? artist.photo;
  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative grid h-12 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#2a2a38] font-display text-[11.5px] font-semibold text-fg",
        className,
      )}
    >
      {image ? <Image src={image.url} alt="" fill sizes="36px" unoptimized className="object-cover" /> : initialsOf(artist.name)}
    </span>
  );
}

const STATUS_TONES: Record<ArtistStatus, "cyan" | "muted" | "neutral"> = {
  published: "cyan",
  draft: "muted",
  unpublished: "neutral",
};

// Lima é só para pontos: "No ar" usa o ciano, o acento de sucesso do painel.
const STATUS_DOTS: Record<ArtistStatus, string> = {
  published: "bg-cyan",
  draft: "bg-fg/45",
  unpublished: "bg-danger",
};

export function ArtistStatusBadge({ status }: { status: ArtistStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]}>
      <span aria-hidden="true" className={cx("size-1.5 rounded-full", STATUS_DOTS[status])} />
      {ARTIST_STATUS_LABELS[status]}
    </Badge>
  );
}
