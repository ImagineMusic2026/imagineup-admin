"use client";

import { Check, ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApproveDialog, RejectDialog } from "@/components/fa-clubes/fan-club-dialogs";
import { APPLICATION_STYLES, FanClubsBackLink, shortWhen } from "@/components/fa-clubes/fan-club-bits";
import { FanAvatar } from "@/components/painel/fan-avatar";
import { FanSocialLinks } from "@/components/painel/fan-socials";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Detail, DetailList, Missing } from "@/components/ui/detail-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { StatusChip } from "@/components/ui/status-chip";
import { useLoad } from "@/components/ui/use-load";
import { errorMessage } from "@/lib/errors";
import { getApplication, getApplicationPrivate, getContactWhatsapp } from "@/lib/fan-club-data";
import {
  REJECT_REASON_LABELS,
  applicantLabel,
  historyItemText,
  privateGoneText,
  reapplyText,
  roundText,
  type ApplicationPrivate,
  type FanClubApplication,
} from "@/lib/fan-clubs";
import { canEditSection, canSeeSection, type StaffMember } from "@/lib/staff";
import { fanClubWhatsappMessage, formatWhatsapp, whatsappChatLink } from "@/lib/whatsapp";

/** O que só quem edita lê (34.6): o privado e o contato do fã. A falha de um não derruba a ficha. */
type Part<T> = { status: "ready"; value: T } | { status: "error"; message: string } | { status: "hidden" };

interface ApplicationRead {
  application: FanClubApplication | null;
  private: Part<ApplicationPrivate | null>;
  whatsapp: Part<string | null>;
}

async function part<T>(read: () => Promise<T>): Promise<Part<T>> {
  try {
    return { status: "ready", value: await read() };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

/**
 * A candidatura, e, para quem edita, o privado e o contato. O contato só é lido
 * com a candidatura: a regra dele pede que ela exista (34.22).
 */
async function readApplication(uid: string, canEdit: boolean): Promise<ApplicationRead> {
  const application = await getApplication(uid);
  if (!application || !canEdit) return { application, private: { status: "hidden" }, whatsapp: { status: "hidden" } };
  const [privateDoc, whatsapp] = await Promise.all([part(() => getApplicationPrivate(uid)), part(() => getContactWhatsapp(uid))]);
  return { application, private: privateDoc, whatsapp };
}

/**
 * A ficha da candidatura (`/fa-clubes/candidaturas/[uid]`, 34.10, item 3): o
 * artista e o nome proposto; para quem edita, as redes, o WhatsApp e o texto
 * de divulgação; o aceite e a declaração; as rodadas; e Aprovar e Recusar.
 */
export function ApplicationPage({ uid }: { uid: string }) {
  return <SectionGate section="fanClubs">{(member) => <ApplicationContent uid={uid} member={member} />}</SectionGate>;
}

function ApplicationContent({ uid, member }: { uid: string; member: StaffMember }) {
  const canEdit = canEditSection(member, "fanClubs");
  const self = member.uid === uid;
  const [round, setRound] = useState(0);
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  // O pedido que foi ao servidor pede a releitura, que só sai com o diálogo
  // fechado (no molde da página do fã na Moderação).
  const [pendingRefresh, setPendingRefresh] = useState(false);
  // A permissão de editar caiu com o diálogo aberto (o acesso chega em tempo
  // real): ele fecha, e a resposta que chegar depois só marca a releitura.
  const [editSeen, setEditSeen] = useState(canEdit);
  if (editSeen !== canEdit) {
    setEditSeen(canEdit);
    if (!canEdit) setDialog(null);
  }
  if (pendingRefresh && dialog === null) {
    setPendingRefresh(false);
    setRound((value) => value + 1);
  }

  // O aviso da decisão recebe o foco: o diálogo devolve o foco ao botão que o
  // abriu, e a releitura tira esse botão da tela (no molde da ficha do fã).
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const read = useLoad(
    useCallback(() => readApplication(uid, canEdit), [uid, canEdit]),
    round,
  );
  // As datas contam da última leitura (a do "Atualizado às").
  const date = read.loadedAt ?? new Date(now);

  function markStale() {
    setPendingRefresh(true);
  }

  /** A decisão deu certo: o diálogo fecha, o aviso aparece e a ficha lê de novo uma vez. */
  function done(message: string) {
    setDialog(null);
    setPendingRefresh(false);
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, text: message }));
    setRound((value) => value + 1);
  }

  if (read.state.status === "error") {
    return (
      <>
        <FanClubsBackLink />
        <SectionCard id="titulo-candidatura" title="Candidatura">
          <LoadError message={read.state.message} headingId="titulo-candidatura" onRetry={read.reload} />
        </SectionCard>
      </>
    );
  }
  if (read.state.status === "loading") {
    return (
      <>
        <FanClubsBackLink />
        <SectionCard id="titulo-candidatura" title="Candidatura">
          <LoadingRow label="Carregando a candidatura..." />
        </SectionCard>
      </>
    );
  }

  const { application } = read.state.data;
  if (!application) {
    return (
      <>
        <FanClubsBackLink />
        <SectionCard id="titulo-candidatura" title="Candidatura">
          <EmptyState action={<ButtonLink href="/fa-clubes" size="sm" variant="secondary">Voltar para Fã-clubes</ButtonLink>}>
            Essa candidatura não existe mais. O fã pode ter excluído a conta.
          </EmptyState>
        </SectionCard>
      </>
    );
  }

  const name = applicantLabel(application);
  const pending = application.status === "pending";
  const decides = canEdit && !self && pending;
  const seesFans = canSeeSection(member, "fans");
  const seesModeration = canSeeSection(member, "moderation");
  const reapply = reapplyText(application, date);

  return (
    <>
      <FanClubsBackLink />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <FanAvatar name={name} photoURL={application.fanPhotoURL} size="lg" />
          <div className="min-w-0">
            <h1 id="titulo-da-pagina" tabIndex={-1} className="m-0 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] outline-none">
              {name}
            </h1>
            <p className="mt-1 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg/65">
              {application.fanUsername ? <span>@{application.fanUsername}</span> : null}
              <span>Candidatura a fã-clube de {application.artistName || `@${application.artistId}`}</span>
              <StatusChip status={application.status} map={APPLICATION_STYLES} />
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton onClick={read.reload} busy={read.reloading} loadedAt={read.loadedAt} />
          {decides ? (
            <>
              <Button size="sm" variant="danger" onClick={() => setDialog("reject")} aria-haspopup="dialog">
                <X aria-hidden="true" className="size-3.5" />
                Recusar
              </Button>
              <Button size="sm" variant="primary" onClick={() => setDialog("approve")} aria-haspopup="dialog">
                <Check aria-hidden="true" className="size-3.5" />
                Aprovar
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {notice ? (
        <Notice key={`aviso-${notice.key}`} tone="success" focusable ref={noticeRef}>
          {notice.text}
        </Notice>
      ) : null}
      {read.refreshError ? <Notice tone="error">Não deu para atualizar: {read.refreshError}</Notice> : null}
      {canEdit && self && pending ? <Notice tone="info">Esta candidatura é sua. Outra pessoa da equipe aprova ou recusa.</Notice> : null}

      <SectionCard id="titulo-candidatura" title="Candidatura">
        <div className="flex flex-col gap-4 px-5 py-4">
          <DetailList>
            <Detail term="Central">{application.artistName || `@${application.artistId}`}</Detail>
            <Detail term="Nome proposto">{application.proposedName || <Missing>Sem nome</Missing>}</Detail>
            <Detail term="Situação">
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusChip status={application.status} map={APPLICATION_STYLES} />
                {application.status === "rejected" && application.rejectReason ? <span>{REJECT_REASON_LABELS[application.rejectReason]}</span> : null}
              </span>
            </Detail>
            <Detail term="Rodada">{roundText(application.round) ?? <Missing>A próxima candidatura começa na rodada 1</Missing>}</Detail>
            <Detail term="Enviada">{shortWhen(application.submittedAt, date)}</Detail>
            <Detail term="Decisão">
              {application.decidedAt ? (
                <>
                  {shortWhen(application.decidedAt, date)}
                  {application.decidedBy?.name ? `, por ${application.decidedBy.name}` : application.status === "withdrawn" ? ", pelo fã" : ""}
                </>
              ) : (
                <Missing>{pending ? "Esperando a equipe" : "Sem data"}</Missing>
              )}
            </Detail>
            <Detail term="Aceite das regras">
              {application.rulesVersion ? `Versão ${application.rulesVersion}, ${shortWhen(application.rulesAcceptedAt, date)}` : <Missing>Sem aceite</Missing>}
            </Detail>
            <Detail term="Idade">{application.adultDeclared ? `Declarou ter 18 anos ou mais, ${shortWhen(application.submittedAt, date)}` : <Missing>Sem a declaração</Missing>}</Detail>
            {reapply ? (
              <Detail term="Nova candidatura" wide>
                {reapply}
              </Detail>
            ) : null}
          </DetailList>
          <div className="flex flex-wrap gap-2">
            {application.status === "approved" && application.clubId ? (
              <ButtonLink href={`/fa-clubes/${application.clubId}`} size="sm" variant="secondary">
                Abrir o fã-clube
              </ButtonLink>
            ) : null}
            {seesFans ? (
              <ButtonLink href={`/fas/${uid}`} size="sm" variant="ghost">
                Ficha do fã
              </ButtonLink>
            ) : null}
            {seesModeration ? (
              <ButtonLink href={`/moderacao/fas/${uid}`} size="sm" variant="ghost">
                Moderação deste fã
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard id="titulo-contato" title="Contato e divulgação">
        <div className="px-5 py-4">
          {canEdit ? (
            <DetailList>
              <Detail term="Redes da candidatura" wide>
                <PartValue
                  part={read.state.data.private}
                  render={(value) => (value ? <FanSocialLinks socials={value.socials} /> : <Missing>{privateGoneText(application)}</Missing>)}
                />
              </Detail>
              <Detail term="WhatsApp" wide>
                <PartValue part={read.state.data.whatsapp} render={(value) => <WhatsappLink value={value} artist={application.artistName || `@${application.artistId}`} />} />
              </Detail>
              <Detail term="Como e onde vai divulgar" wide>
                <PartValue
                  part={read.state.data.private}
                  render={(value) =>
                    value?.pitch ? (
                      <span className="whitespace-pre-line break-words">{value.pitch}</span>
                    ) : (
                      <Missing>{value && application.status === "approved" ? "Saiu na aprovação: o texto de divulgação não fica guardado." : value ? "Sem texto." : privateGoneText(application)}</Missing>
                    )
                  }
                />
              </Detail>
            </DetailList>
          ) : (
            <p className="m-0 text-sm text-fg/65">Visível só para quem edita a seção Fã-clubes.</p>
          )}
        </div>
      </SectionCard>

      <SectionCard id="titulo-rodadas" title="Rodadas">
        {application.history.length === 0 ? (
          <EmptyState>Nenhuma decisão da equipe ainda.</EmptyState>
        ) : (
          <ol className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {application.history.map((item, index) => (
              <li key={index} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-[13.5px]">
                <span className="text-fg/90">{historyItemText(item)}</span>
                <span className="text-[12.5px] text-fg/55">{shortWhen(item.at, date)}</span>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      {decides && dialog === "approve" ? (
        <ApproveDialog application={application} onClose={() => setDialog(null)} onDone={done} onSend={markStale} onOrphan={markStale} />
      ) : null}
      {decides && dialog === "reject" ? (
        <RejectDialog application={application} onClose={() => setDialog(null)} onDone={done} onSend={markStale} onOrphan={markStale} />
      ) : null}
    </>
  );
}

function PartValue<T>({ part, render }: { part: Part<T>; render: (value: T) => React.ReactNode }) {
  if (part.status === "error") return <span className="text-danger">Não carregou: {part.message}</span>;
  if (part.status === "hidden") return <Missing>Visível só para quem edita</Missing>;
  return <>{render(part.value)}</>;
}

/** O WhatsApp do contato do fã, com o link da conversa (`wa.me`) em outra aba e a mensagem da candidatura. */
function WhatsappLink({ value, artist }: { value: string | null; artist: string }) {
  const number = formatWhatsapp(value);
  const href = whatsappChatLink(value, fanClubWhatsappMessage(artist));
  if (!number || !href) return <Missing>Sem WhatsApp</Missing>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 whitespace-nowrap text-cyan underline-offset-2 hover:underline">
      {number}
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only"> (abre a conversa em outra aba)</span>
    </a>
  );
}
