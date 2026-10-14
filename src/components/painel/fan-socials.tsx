import { ExternalLink } from "lucide-react";

import { Missing } from "@/components/ui/detail-list";
import { SOCIAL_NETWORK_LABELS, socialHandleText, type FanSocial } from "@/lib/fan-profile";

/** A bio do fã com as quebras de linha dela, ou "Sem bio". */
export function FanBio({ bio }: { bio: string | null }) {
  return bio ? <span className="whitespace-pre-line break-words">{bio}</span> : <Missing>Sem bio</Missing>;
}

/**
 * As redes do fã, uma por linha, com o nome da rede no texto do link. Só
 * chegam aqui as que passaram no padrão (`parseFanProfile`), com o link de
 * domínio fixo, que abre fora do painel.
 */
export function FanSocialLinks({ socials }: { socials: readonly FanSocial[] }) {
  if (socials.length === 0) return <Missing>Sem redes</Missing>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {socials.map((social) => (
        <li key={social.network} className="min-w-0">
          <a
            href={social.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex max-w-full items-center gap-1.5 text-cyan underline-offset-2 hover:underline"
          >
            <span className="font-semibold">{SOCIAL_NETWORK_LABELS[social.network]}:</span>{" "}
            <span className="min-w-0 truncate">{socialHandleText(social)}</span>
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only"> (abre em outra aba)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
