"use client";

import { Check, CircleHelp, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Footer, useDecision, type DecisionProps } from "@/components/fa-clubes/fan-club-dialogs";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, SelectInput, TextArea, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useLoad } from "@/components/ui/use-load";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { UNCERTAIN_RETRY_TEXT, callableErrorMessage, mayHaveRunOnServer, reasonOf } from "@/lib/errors";
import { featureFanClub, rewardFanClub, type RewardResult } from "@/lib/fan-club-api";
import { countActionedReports, getOwnerChecks } from "@/lib/fan-club-data";
import {
  FAN_CLUB_AUDIT_TEXT,
  FEATURED_PER_ARTIST_MAX,
  PRIZE_COUPON_MAX,
  PRIZE_MESSAGE_MAX,
  REWARD_ACTIVE_DAYS,
  REWARD_NOTE_MAX,
  checkFeaturedUntil,
  checkRewardForm,
  defaultFeaturedUntil,
  fanClubLabel,
  featureRange,
  featuredText,
  isFeaturedNow,
  isStaleDecision,
  newGrantId,
  ownerLabel,
  rewardChecklist,
  rewardPointsHint,
  rewardPointsMax,
  rewardRefusalText,
  type ChecklistItem,
  type FanClub,
  type RewardForm,
  type RewardFormErrors,
} from "@/lib/fan-clubs";
import { formatDay, formatNumber, joinPt } from "@/lib/format";
import { getPrizeRewards } from "@/lib/reward-data";
import { KIND_LABELS, remainingOf, stockText, type Reward } from "@/lib/rewards";
import type { Role } from "@/lib/staff";

const FEATURE_TEXT = `O selo Destaque aparece na página do fã-clube, e ele vem primeiro na lista do artista, até o fim escolhido. Cada artista tem até ${FEATURED_PER_ARTIST_MAX} fã-clubes em destaque ao mesmo tempo.`;

/**
 * Destacar (decisão 35, 34.5): o fim, de amanhã a 31 dias. O mesmo fim de
 * novo não muda nada; outro fim troca o prazo. O fã-clube precisa estar
 * ativo, e o quarto destaque do artista recusa `feature-limit`.
 */
export function FeatureDialog({ club, now, ...props }: DecisionProps & { club: FanClub; now: number }) {
  const { busy, error, uncertain, blocked, footer, run } = useDecision(props);
  const [day, setDay] = useState(() => defaultFeaturedUntil(club, now));
  const [dayError, setDayError] = useState<string | null>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const range = featureRange(now);
  const name = fanClubLabel(club);
  const current = isFeaturedNow(club, now);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = checkFeaturedUntil(day, now);
    if (!checked.ok) {
      setDayError(checked.message);
      requestAnimationFrame(() => dayRef.current?.focus());
      return;
    }
    await run(() => featureFanClub(club.id, club.status, checked.day), `Fã-clube ${name} em destaque até ${formatDay(checked.day, new Date(now))}.`);
  }

  return (
    <Dialog
      open
      size="sm"
      busy={busy}
      onClose={() => !busy && props.onClose()}
      title={current ? `Mudar o fim do Destaque de ${name}?` : `Destacar o fã-clube ${name}?`}
      description={`${FEATURE_TEXT} ${FAN_CLUB_AUDIT_TEXT}`}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Destaque até" error={dayError} hint={`De ${formatDay(range.min, new Date(now))} a ${formatDay(range.max, new Date(now))}, no dia de São Paulo.`}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              ref={dayRef}
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              type="date"
              min={range.min}
              max={range.max}
              value={day}
              disabled={busy || uncertain || blocked}
              onChange={(event) => {
                setDay(event.target.value);
                setDayError(null);
              }}
            />
          )}
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Footer footer={footer} busy={busy} uncertain={uncertain} blocked={blocked} onClose={props.onClose} confirmLabel={current ? "Mudar o fim" : "Destacar"} busyLabel="Destacando..." tone="primary" />
      </form>
    </Dialog>
  );
}

/**
 * O que o checklist lê, cada parte sem derrubar a outra: o gestor (a suspensão
 * com a seção Fãs ou a Moderação, o vínculo só com Fãs) e as denúncias aceitas.
 */
async function readChecklist(club: FanClub, reads: { fans: boolean; moderation: boolean }, now: number) {
  const since = now - REWARD_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const readsOwner = club.ownerUid !== null && (reads.fans || reads.moderation);
  const [owner, reports] = await Promise.all([
    readsOwner ? getOwnerChecks(club.ownerUid!, club.artistId, { profile: true, central: reads.fans }).catch(() => null) : Promise.resolve(null),
    countActionedReports(club.id, since).catch(() => null),
  ]);
  return { owner, reports };
}

function ChecklistIcon({ state }: { state: ChecklistItem["state"] }) {
  if (state === "ok") return <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-cyan" />;
  if (state === "no") return <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />;
  return <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg/50" />;
}

const STATE_WORDS: Record<ChecklistItem["state"], string> = { ok: "Sim", no: "Não", unknown: "Não conferido" };

/** O checklist (decisão 38): só avisa, sem impedir. */
function Checklist({ items, loading }: { items: ChecklistItem[]; loading: boolean }) {
  return (
    <section aria-labelledby="titulo-checklist" className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
      <h3 id="titulo-checklist" className="m-0 text-[13px] font-semibold text-fg/85">
        Antes de recompensar (só um aviso, não impede)
      </h3>
      {loading ? (
        <p role="status" className="m-0 text-[13px] text-fg/60">
          Conferindo...
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-[13px] text-fg/85">
              <ChecklistIcon state={item.state} />
              <span>
                <span className="sr-only">{STATE_WORDS[item.state]}: </span>
                {item.label}
                {item.detail ? <span className="text-fg/55"> ({item.detail})</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Ingresso de cortesia (Ingresso), 1 de 2 restantes". */
function rewardOption(reward: Reward): string {
  return `${reward.title} (${KIND_LABELS[reward.kind]}), ${stockText(reward).toLowerCase()}`;
}

type Step = "feature" | "grant";

/**
 * O Recompensar (decisões 38 e 44 a 46, 34.10, item 6): o checklist como
 * aviso e três partes, cada uma só com a seção dela (decisão 7): o Destaque
 * (Fã-clubes), os pontos (Fãs) e o prêmio (Recompensas), com a nota interna
 * quando vão pontos ou prêmio. Confirmar manda o `feature` e o `reward` em
 * chamadas separadas, nesta ordem, e diz o resultado de cada um. O `grantId`
 * é sorteado ao abrir: repetir com os mesmos campos é seguro, e a falha
 * incerta trava os campos até a nova tentativa.
 */
export function RewardDialog({
  club,
  now,
  role,
  canPoints,
  canPrize,
  readsFans,
  readsModeration,
  rulesVersion,
  onClose,
  onDone,
  onSend,
  onOrphan,
}: DecisionProps & {
  club: FanClub;
  now: number;
  role: Role;
  canPoints: boolean;
  canPrize: boolean;
  readsFans: boolean;
  readsModeration: boolean;
  /** A versão do regulamento que o gestor aceitou; `null` sem a candidatura. */
  rulesVersion: string | null;
}) {
  const mounted = useMountedRef();
  const [grantId] = useState(() => newGrantId());
  const [form, setForm] = useState<RewardForm>(() => ({
    feature: false,
    featuredUntil: defaultFeaturedUntil(club, now),
    points: "",
    rewardId: "",
    coupon: "",
    message: "",
    delivered: false,
    note: "",
  }));
  const [errors, setErrors] = useState<RewardFormErrors>({});
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [blocked, setBlocked] = useState(false);
  /** O que já deu certo nesta abertura: o fim do Destaque e o reconhecimento. */
  const [featureDone, setFeatureDone] = useState<string | null>(null);
  const [grantDone, setGrantDone] = useState<RewardResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const busy = step !== null;
  const locked = busy || uncertain || blocked;
  const name = fanClubLabel(club);
  const owner = ownerLabel(club);
  const date = new Date(now);

  const checks = useLoad(useCallback(() => readChecklist(club, { fans: readsFans, moderation: readsModeration }, now), [club, readsFans, readsModeration, now]));
  const prizes = useLoad(useCallback(() => (canPrize ? getPrizeRewards() : Promise.resolve([] as Reward[])), [canPrize]));
  const prizeList = prizes.state.status === "ready" ? prizes.state.data : [];
  const chosen = prizeList.find((reward) => reward.id === form.rewardId) ?? null;

  const checklist = rewardChecklist({
    club,
    now,
    ownerSuspended: checks.state.status === "ready" ? (checks.state.data.owner?.suspended ?? null) : null,
    ownerMember: checks.state.status === "ready" ? (checks.state.data.owner?.member ?? null) : null,
    rulesVersion,
    actionedReports: checks.state.status === "ready" ? checks.state.data.reports : null,
    readsFans,
    readsModeration,
  });

  // O botão de confirmar saiu com o foco nele: o foco vai para o de voltar.
  useEffect(() => {
    if (blocked) footer.current?.querySelector<HTMLElement>("button")?.focus();
  }, [blocked]);

  function set<K extends keyof RewardForm>(field: K, value: RewardForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function failed(part: string, failure: unknown) {
    if (!mounted.current) return onOrphan();
    if (mayHaveRunOnServer(failure)) {
      setUncertain(true);
      setError(`${part}: ${UNCERTAIN_RETRY_TEXT}`);
    } else {
      setUncertain(false);
      setError(`${part}: ${rewardRefusalText(failure) ?? callableErrorMessage(failure)}`);
      if (isStaleDecision(failure) || reasonOf(failure) === "grant-id-reused") setBlocked(true);
    }
    setStep(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || blocked) return;
    const checked = checkRewardForm(form, { now, role, canFeature: true, canPoints, canPrize });
    setErrors(checked.errors);
    if (!checked.plan) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const plan = checked.plan;
    setError(null);
    onSend();

    let feature = featureDone;
    if (plan.featuredUntil && featureDone !== plan.featuredUntil) {
      setStep("feature");
      try {
        await featureFanClub(club.id, club.status, plan.featuredUntil);
      } catch (failure) {
        return failed("Destaque", failure);
      }
      if (!mounted.current) return onOrphan();
      feature = plan.featuredUntil;
      setFeatureDone(feature);
    }

    let grant = grantDone;
    if (plan.grant && !grantDone) {
      setStep("grant");
      try {
        grant = await rewardFanClub(club.id, club.status, { grantId, ...plan.grant });
      } catch (failure) {
        return failed(plan.grant.prize ? (plan.grant.points !== null ? "Pontos e prêmio" : "Prêmio") : "Pontos", failure);
      }
      if (!mounted.current) return onOrphan();
      setGrantDone(grant);
    }

    setStep(null);
    setUncertain(false);
    const parts = [
      feature && plan.featuredUntil ? `Destaque até ${formatDay(feature, date)}` : null,
      grant?.points ? `${formatNumber(grant.points)} pontos ao saldo de ${owner}` : null,
      grant && plan.grant?.prize ? `o prêmio ${chosen?.title ?? "escolhido"}${grant.code ? ` (pedido ${grant.code}${plan.grant.prize.delivered ? ", já entregue" : ""})` : ""}` : null,
    ].filter((part): part is string => part !== null);
    onDone(`Fã-clube ${name}: ${joinPt(parts)}.`);
  }

  const hidden = [!canPoints ? "os pontos pedem a seção Fãs com edição" : null, !canPrize ? "o prêmio pede a seção Recompensas com edição" : null].filter((item): item is string => item !== null);
  const range = featureRange(now);
  const featuring = featuredText(club, now);

  return (
    <Dialog
      open
      size="lg"
      busy={busy}
      onClose={() => !busy && onClose()}
      title={`Recompensar o fã-clube ${name}?`}
      description={`A equipe reconhece quando quiser, sem ciclo nem prazo. ${FAN_CLUB_AUDIT_TEXT}`}
    >
      <form ref={formRef} onSubmit={submit} noValidate aria-busy={busy} className="flex flex-col gap-5">
        <Checklist items={checklist} loading={checks.state.status === "loading"} />

        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-2 p-0 text-[14px] font-semibold text-fg">Destaque</legend>
          {featuring ? <p className="m-0 text-[13px] text-fg/70">Agora: {featuring}.</p> : null}
          {featureDone ? (
            <Notice tone="success">Feito: Destaque até {formatDay(featureDone, date)}.</Notice>
          ) : (
            <>
              <Checkbox
                label={isFeaturedNow(club, now) ? "Mudar o fim do Destaque" : "Destacar o fã-clube"}
                checked={form.feature}
                disabled={locked}
                onChange={(event) => set("feature", event.target.checked)}
              />
              {form.feature ? (
                <Field label="Destaque até" error={errors.featuredUntil} hint={`De ${formatDay(range.min, date)} a ${formatDay(range.max, date)}, no dia de São Paulo.`}>
                  {({ id, describedBy, invalid }) => (
                    <TextInput
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      type="date"
                      min={range.min}
                      max={range.max}
                      value={form.featuredUntil}
                      disabled={locked}
                      onChange={(event) => set("featuredUntil", event.target.value)}
                      className="max-w-[220px]"
                    />
                  )}
                </Field>
              ) : null}
            </>
          )}
        </fieldset>

        {canPoints ? (
          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="mb-2 p-0 text-[14px] font-semibold text-fg">Pontos</legend>
            {grantDone ? (
              <Notice tone="success">Feito: {grantDone.points ? `${formatNumber(grantDone.points)} pontos ao saldo de ${owner}.` : "sem pontos."}</Notice>
            ) : (
              <Field label="Pontos ao saldo do gestor" optional error={errors.points} hint={rewardPointsHint(role)}>
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={rewardPointsMax(role)}
                    value={form.points}
                    disabled={locked}
                    onChange={(event) => set("points", event.target.value)}
                    className="max-w-[220px]"
                  />
                )}
              </Field>
            )}
          </fieldset>
        ) : null}

        {canPrize ? (
          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="mb-2 p-0 text-[14px] font-semibold text-fg">Prêmio</legend>
            {grantDone ? (
              <Notice tone="success">Feito: {grantDone.code ? `o pedido ${grantDone.code}, na aba Pedidos de Recompensas.` : "sem prêmio."}</Notice>
            ) : prizes.state.status === "error" ? (
              <Notice tone="error">As recompensas não carregaram: {prizes.state.message}</Notice>
            ) : prizes.state.status === "ready" && prizeList.length === 0 ? (
              <p className="m-0 text-[13px] text-fg/70">
                Nenhuma recompensa só para prêmios de fã-clube.{" "}
                <Link href="/recompensas" className="font-semibold text-cyan underline-offset-2 hover:underline">
                  Crie uma em Recompensas
                </Link>
                , no Catálogo.
              </p>
            ) : (
              <>
                <Field label="Recompensa" optional error={errors.rewardId} hint="Só as recompensas para prêmios de fã-clube. O estoque é a cota de cortesias.">
                  {({ id, describedBy, invalid }) => (
                    <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.rewardId} disabled={locked || prizes.state.status === "loading"} onChange={(event) => set("rewardId", event.target.value)}>
                      <option value="">{prizes.state.status === "loading" ? "Carregando..." : "Sem prêmio"}</option>
                      {prizeList.map((reward) => (
                        <option key={reward.id} value={reward.id} disabled={remainingOf(reward) === 0}>
                          {rewardOption(reward)}
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </Field>
                {form.rewardId ? (
                  <>
                    <Field label="Cupom do parceiro" optional error={errors.coupon} hint={`Até ${PRIZE_COUPON_MAX} caracteres, numa linha. O gestor vê no pedido, no app.`}>
                      {({ id, describedBy, invalid }) => (
                        <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.coupon} maxLength={PRIZE_COUPON_MAX + 10} disabled={locked} autoComplete="off" spellCheck={false} onChange={(event) => set("coupon", event.target.value)} />
                      )}
                    </Field>
                    <Field label="Mensagem ao gestor" optional error={errors.message} hint={`Até ${PRIZE_MESSAGE_MAX} caracteres. O gestor vê no pedido, no app.`}>
                      {({ id, describedBy, invalid }) => (
                        <TextArea id={id} describedBy={describedBy} invalid={invalid} rows={2} value={form.message} maxLength={PRIZE_MESSAGE_MAX + 20} disabled={locked} onChange={(event) => set("message", event.target.value)} />
                      )}
                    </Field>
                    <div className="flex flex-col gap-1">
                      <Checkbox label="O cupom já é o prêmio" checked={form.delivered} disabled={locked} onChange={(event) => set("delivered", event.target.checked)} />
                      <p className="m-0 pl-7 text-[12.5px] leading-snug text-fg/60">O pedido nasce Entregue e não se cancela depois. Sem a caixa, ele nasce Aprovado, e a equipe entrega pela aba Pedidos.</p>
                    </div>
                    {chosen ? <p className="m-0 text-[12.5px] text-fg/60">{chosen.title}: {stockText(chosen)}.</p> : null}
                  </>
                ) : null}
              </>
            )}
          </fieldset>
        ) : null}

        {hidden.length > 0 ? <p className="m-0 text-[12.5px] text-fg/60">Fora deste diálogo: {joinPt(hidden)}.</p> : null}

        {(canPoints || canPrize) && !grantDone ? (
          <Field label="Nota interna" optional={!form.points.trim() && !form.rewardId} error={errors.note} hint={`De 1 a ${REWARD_NOTE_MAX} caracteres, sem dado pessoal. Obrigatória com pontos ou prêmio: fica no registro do fã-clube, no extrato do painel e nos Logs, e o gestor não vê.`}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.note} maxLength={REWARD_NOTE_MAX + 10} disabled={locked} onChange={(event) => set("note", event.target.value)} />
            )}
          </Field>
        ) : null}

        {errors.form ? <p className="m-0 text-[13px] font-medium text-danger">{errors.form}</p> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <p role="status" className="m-0 text-[13px] text-fg/70 empty:hidden">
          {step === "feature" ? "Destacando..." : step === "grant" ? "Recompensando..." : ""}
        </p>
        <div ref={footer} className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus>
            {blocked || featureDone || grantDone ? "Fechar" : "Voltar"}
          </Button>
          {blocked ? null : (
            <Button type="submit" variant="primary" busy={busy}>
              {busy ? "Confirmando..." : uncertain ? "Tentar de novo" : "Confirmar"}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
