"use client";

import { CheckCheck, ShieldCheck } from "lucide-react";
import { useCallback } from "react";

import { shortWhen } from "@/components/moderacao/queue-card";
import { FanAvatar } from "@/components/painel/fan-avatar";
import { FanBio, FanSocialLinks } from "@/components/painel/fan-socials";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import type { ConfirmRequest } from "@/components/ui/confirm-dialog";
import { useLoad } from "@/components/ui/use-load";
import { reasonOf } from "@/lib/errors";
import { fanDisplayName, type FanProfile } from "@/lib/fan-profile";
import { getFanProfile } from "@/lib/fan-profile-data";
import { formatNumber, formatRelative } from "@/lib/format";
import {
  ACCOUNT_DELETED_TEXT,
  ACTION_PROFILE_TEXT,
  KEEP_PROFILE_TEXT,
  PROFILE_RESOLUTION_LABELS,
  profileDecisions,
  reasonsSpoken,
  reasonsText,
  type ProfileQueueItem,
} from "@/lib/moderation";
import { resolveProfileReport } from "@/lib/moderation-api";

export type ProfileDecision = "kept" | "actioned";

/** A recusa de um item que mudou por fora: outra tentativa com o mesmo `round` daria a mesma. */
function changedOutside(failure: unknown): boolean {
  const reason = reasonOf(failure);
  return reason === "stale-report" || reason === "profile-not-reported";
}

/**
 * A confirmação de "Manter" ou "Resolver", com o `round` que o card leu. Se o
 * item mudou por fora (`stale-report`: reabriu depois que o card abriu; ou
 * `profile-not-reported`: saiu da fila), o diálogo mostra a frase do servidor,
 * desliga o botão de confirmar e `reread` pede a leitura do item, porque o
 * painel não escuta em tempo real (a página do fã lê quando o diálogo fecha).
 */
export function profileDecisionRequest(item: ProfileQueueItem, decision: ProfileDecision, name: string, reread: () => void): ConfirmRequest {
  const keep = decision === "kept";
  return {
    title: keep ? `Manter o perfil de ${name}?` : `Resolver a denúncia do perfil de ${name}?`,
    body: keep ? KEEP_PROFILE_TEXT : ACTION_PROFILE_TEXT,
    confirmLabel: keep ? "Manter" : "Resolver",
    busyLabel: keep ? "Mantendo..." : "Resolvendo...",
    cancelLabel: "Voltar",
    tone: "default",
    action: () => resolveProfileReport({ uid: item.uid, resolution: decision, round: item.round }),
    successMessage: keep ? `Perfil de ${name} mantido.` : `Denúncia do perfil de ${name} resolvida.`,
    onError: (failure) => {
      if (changedOutside(failure)) reread();
    },
    blocksRetry: changedOutside,
  };
}

/**
 * Um item da `profileReportQueue` (29.7): o perfil vivo do fã (o item não
 * guarda texto), os motivos e a contagem da rodada, e, para quem edita a
 * seção, "Manter" e "Resolver". Sem o perfil, "Conta excluída", sem ações e
 * sem link. Sem o gênero e sem a conta privada, como a página do fã.
 */
export function ProfileReportCard({
  item,
  now,
  canEdit,
  headingLevel = 3,
  linkToFan = true,
  profile,
  refreshKey = 0,
  onDecide,
}: {
  item: ProfileQueueItem;
  now: Date;
  canEdit: boolean;
  headingLevel?: 3 | 4;
  linkToFan?: boolean;
  /** O perfil já lido pela tela (a página do fã); sem ele, o card lê `users/{uid}`. */
  profile?: FanProfile | null;
  /** Muda depois de uma ação: o perfil é lido de novo. */
  refreshKey?: number;
  onDecide?: (item: ProfileQueueItem, decision: ProfileDecision, name: string) => void;
}) {
  const given = profile !== undefined;
  // Com o perfil vindo da tela, o card não lê: o `profile` é outro objeto a cada
  // leitura da página, e tê-lo na função de leitura punha o card em
  // "Carregando..." a cada releitura. A chave vai no `useLoad`, que lê de novo
  // com o dado na tela.
  const read = useLoad(
    useCallback(() => (given ? Promise.resolve(null) : getFanProfile(item.uid)), [given, item.uid]),
    refreshKey,
  );
  const ready = given || read.state.status === "ready";
  const fan = given ? (profile ?? null) : read.state.status === "ready" ? read.state.data : null;
  const deleted = ready && !fan;
  const name = fan ? fanDisplayName(fan) : deleted ? ACCOUNT_DELETED_TEXT : "Carregando...";
  const decisions = fan && canEdit && onDecide ? profileDecisions(item) : [];
  const Heading = headingLevel === 3 ? "h3" : "h4";

  return (
    <article className="flex flex-col gap-3 px-5 py-4">
      <Heading className="sr-only">Perfil de {name}</Heading>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <FanAvatar name={name} photoURL={fan?.photoURL ?? null} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-fg">{name}</span>
            {fan?.username ? <span className="truncate text-[12.5px] text-fg/65">@{fan.username}</span> : null}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {fan?.suspendedAt ? <Badge tone="danger">Suspenso</Badge> : null}
          {item.status === "resolved" && item.resolution ? <Badge tone="neutral">{PROFILE_RESOLUTION_LABELS[item.resolution]}</Badge> : null}
        </span>
      </div>

      {fan ? (
        <dl className="m-0 grid gap-x-6 gap-y-3 rounded-lg border border-line bg-sunken px-4 py-3 text-[14px] leading-relaxed text-fg/90 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[12.5px] font-semibold text-fg/60">Bio</dt>
            <dd className="m-0 mt-1">
              <FanBio bio={fan.bio} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12.5px] font-semibold text-fg/60">Redes</dt>
            <dd className="m-0 mt-1">
              <FanSocialLinks socials={fan.socials} />
            </dd>
          </div>
        </dl>
      ) : deleted ? (
        <p className="m-0 rounded-lg border border-line bg-sunken px-4 py-3 text-[14px] text-fg/60">O fã excluiu a conta. O perfil denunciado não existe mais.</p>
      ) : null}

      <dl className="m-0 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-fg/55">Denúncias:</dt>
          <dd className="m-0 text-fg/85">
            <span aria-hidden="true">{reasonsText(item.reasons)}</span>
            <span className="sr-only">{reasonsSpoken(item.reasons)}</span>
          </dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-fg/55">Desde:</dt>
          <dd className="m-0 text-fg/85">{shortWhen(item.openedAt, now)}</dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-fg/55">Última:</dt>
          <dd className="m-0 text-fg/85">{item.lastReportedAt ? formatRelative(item.lastReportedAt, now) : "sem data"}</dd>
        </div>
        {item.round > 1 ? (
          <div className="flex min-w-0 gap-1.5">
            <dt className="shrink-0 text-fg/55">Rodada:</dt>
            <dd className="m-0 text-fg/85">{formatNumber(item.round)}, reaberta por uma denúncia nova</dd>
          </div>
        ) : null}
        {item.status === "resolved" ? (
          <div className="flex min-w-0 gap-1.5 sm:col-span-2">
            <dt className="shrink-0 text-fg/55">Decisão:</dt>
            <dd className="m-0 text-fg/85">
              {item.resolution ? PROFILE_RESOLUTION_LABELS[item.resolution] : "Resolvido"}, {item.resolvedBy ? `por ${item.resolvedBy.name}` : "automático"}, {shortWhen(item.resolvedAt, now)}
            </dd>
          </div>
        ) : null}
      </dl>

      {read.state.status === "error" ? (
        <p className="m-0 text-[13px] text-danger">
          O perfil não carregou: {read.state.message}{" "}
          <Button size="sm" variant="ghost" onClick={read.reload}>
            Tentar de novo
          </Button>
        </p>
      ) : null}

      {fan && (decisions.length > 0 || linkToFan) ? (
        <div className="flex flex-wrap gap-2">
          {decisions.includes("kept") ? (
            <Button size="sm" variant="secondary" onClick={() => onDecide?.(item, "kept", name)}>
              <ShieldCheck aria-hidden="true" className="size-4" />
              Manter<span className="sr-only"> o perfil de {name}</span>
            </Button>
          ) : null}
          {decisions.includes("actioned") ? (
            <Button size="sm" variant="primary" onClick={() => onDecide?.(item, "actioned", name)}>
              <CheckCheck aria-hidden="true" className="size-4" />
              Resolver<span className="sr-only"> a denúncia do perfil de {name}</span>
            </Button>
          ) : null}
          {linkToFan ? (
            <ButtonLink href={`/moderacao/fas/${item.uid}`} size="sm" variant="ghost">
              Abrir página do fã<span className="sr-only">: {name}</span>
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
