"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { artistNameOf, type ArtistName } from "@/lib/artist-names-data";
import { errorDetails, mayHaveRunOnServer, reasonOf, callableErrorMessage, UNCERTAIN_CHANGE_TEXT } from "@/lib/errors";
import { adjustFanPoints } from "@/lib/fan-api";
import { getAdjustmentEntry } from "@/lib/fan-data";
import {
  ADJUST_NOTE_MAX,
  ADJUST_SETTLE_MS,
  EMPTY_ADJUST_FORM,
  adjustInputOf,
  adjustLimitText,
  beforeAfter,
  enteredText,
  newAdjustmentId,
  parseDelta,
  validateAdjust,
  type AdjustErrors,
  type AdjustForm,
  type AdjustInput,
  type FanCentral,
} from "@/lib/fans";
import type { Role } from "@/lib/staff";

/**
 * A tentativa de ajuste, guardada fora do diálogo, por fã: depois de uma falha
 * incerta, os campos ficam travados com o corpo que foi, e "Tentar de novo"
 * manda o mesmo id e o mesmo corpo. Uma recusa definitiva fecha a tentativa.
 */
export interface AdjustAttempt {
  form: AdjustForm;
  input: AdjustInput;
  sentAt: number;
}

export function AdjustDialog({
  open,
  onClose,
  uid,
  role,
  balance,
  xp,
  seasonPoints,
  seasonName,
  centrals,
  currentSeasonId,
  artists,
  attempt,
  onAttempt,
  onAdjusted,
}: {
  open: boolean;
  onClose: () => void;
  uid: string;
  role: Role;
  balance: number;
  xp: number;
  seasonPoints: number;
  /** A temporada em andamento, ou `null` (os pontos da temporada ficam desligados). */
  seasonName: string | null;
  centrals: FanCentral[];
  currentSeasonId: string | null;
  artists: ReadonlyMap<string, ArtistName> | null;
  attempt: AdjustAttempt | null;
  onAttempt: (attempt: AdjustAttempt | null) => void;
  /** O ajuste entrou (ou já tinha entrado): a ficha lê a carteira e o extrato de novo. */
  onAdjusted: (message: string) => void;
}) {
  const mounted = useMountedRef();
  const [form, setForm] = useState<AdjustForm>(EMPTY_ADJUST_FORM);
  const [errors, setErrors] = useState<AdjustErrors>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);
  const locked = Boolean(attempt);
  const shown = attempt?.form ?? form;
  const hasSeason = Boolean(seasonName);

  function close() {
    if (busy) return;
    setErrors({});
    setMessage(null);
    onClose();
  }

  function set(field: keyof AdjustForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  async function send(input: AdjustInput, attemptForm: AdjustForm) {
    const sentAt = Date.now();
    setBusy(true);
    setMessage(null);
    try {
      const result = await adjustFanPoints(input);
      if (!mounted.current) return;
      onAttempt(null);
      setForm(EMPTY_ADJUST_FORM);
      onAdjusted(result.status === "duplicate" ? "O ajuste já tinha entrado." : "Pontos ajustados.");
    } catch (failure) {
      if (!mounted.current) return;
      if (mayHaveRunOnServer(failure)) {
        onAttempt({ form: attemptForm, input, sentAt });
        setMessage({ tone: "error", text: UNCERTAIN_CHANGE_TEXT });
      } else if (reasonOf(failure) === "adjustment-id-reused") {
        const entry = errorDetails(failure).entry;
        onAttempt(null);
        setMessage({
          tone: "info",
          text: entry && typeof entry === "object" ? enteredText(entry as Record<string, unknown>, new Date()) : callableErrorMessage(failure),
        });
      } else {
        onAttempt(null);
        setForm(attemptForm);
        setMessage({ tone: "error", text: callableErrorMessage(failure) });
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (attempt) {
      void send(attempt.input, attempt.form);
      return;
    }
    const checked = validateAdjust(form, { role, hasSeason });
    setErrors(checked.errors);
    if (!checked.deltas) return;
    void send(adjustInputOf(uid, newAdjustmentId(), form, checked.deltas), form);
  }

  async function checkLedger() {
    if (!attempt || checking) return;
    setChecking(true);
    try {
      const entry = await getAdjustmentEntry(uid, attempt.input.adjustmentId);
      if (!mounted.current) return;
      if (entry) {
        onAttempt(null);
        setForm(EMPTY_ADJUST_FORM);
        onAdjusted("O ajuste foi gravado.");
      } else if (Date.now() - attempt.sentAt >= ADJUST_SETTLE_MS) {
        onAttempt(null);
        setForm(attempt.form);
        setMessage({ tone: "info", text: "O ajuste não entrou. Confira os valores e ajuste de novo." });
      } else {
        setMessage({ tone: "info", text: "Confira de novo em alguns segundos." });
      }
    } catch (failure) {
      if (mounted.current) setMessage({ tone: "error", text: callableErrorMessage(failure) });
    } finally {
      if (mounted.current) setChecking(false);
    }
  }

  const delta = (text: string) => parseDelta(text) ?? 0;
  const central = centrals.find((item) => item.artistId === shown.artistId) ?? null;
  const centralSeasonNow = central && currentSeasonId && central.seasonId === currentSeasonId ? central.seasonPoints : 0;
  const centralOptions = [
    ...centrals.map((item) => item.artistId),
    ...[...(artists?.keys() ?? [])].filter((id) => !centrals.some((item) => item.artistId === id)),
  ];
  const preview = [
    beforeAfter("Saldo", balance, delta(shown.balance)),
    beforeAfter("XP", xp, delta(shown.xp)),
    hasSeason ? beforeAfter("Pontos da temporada", seasonPoints, delta(shown.season)) : null,
    shown.artistId ? beforeAfter("Na central, temporada", centralSeasonNow, delta(shown.centralSeason)) : null,
    shown.artistId ? beforeAfter("Na central, de sempre", central?.totalPoints ?? 0, delta(shown.centralTotal)) : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={busy}
      size="md"
      title="Ajustar pontos"
      description={adjustLimitText(role)}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {locked ? (
          <Notice tone="info" announce={false}>
            Os valores ficam travados até a gente saber se o ajuste entrou: tente de novo (o mesmo ajuste não entra duas vezes) ou confira o extrato.
          </Notice>
        ) : null}
        {errors.form ? <Notice tone="error">{errors.form}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <DeltaField label="Saldo" value={shown.balance} error={errors.balance} disabled={locked || busy} onChange={(value) => set("balance", value)} />
          <DeltaField label="XP" value={shown.xp} error={errors.xp} disabled={locked || busy} onChange={(value) => set("xp", value)} />
          <DeltaField
            label="Pontos da temporada"
            value={shown.season}
            error={errors.season}
            hint={hasSeason ? seasonName ?? undefined : "Não há temporada em andamento."}
            disabled={locked || busy || !hasSeason}
            onChange={(value) => set("season", value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Central" optional error={errors.artistId}>
            {({ id, describedBy, invalid }) => (
              <SelectInput
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={shown.artistId}
                disabled={locked || busy}
                onChange={(event) => set("artistId", event.target.value)}
              >
                <option value="">Sem central</option>
                {centralOptions.map((artistId) => (
                  <option key={artistId} value={artistId}>
                    {artistNameOf(artists, artistId)}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <DeltaField
            label="Temporada na central"
            value={shown.centralSeason}
            error={errors.centralSeason}
            disabled={locked || busy || !shown.artistId}
            onChange={(value) => set("centralSeason", value)}
          />
          <DeltaField
            label="De sempre na central"
            value={shown.centralTotal}
            error={errors.centralTotal}
            disabled={locked || busy || !shown.artistId}
            onChange={(value) => set("centralTotal", value)}
          />
        </div>
        <Field label="Motivo" error={errors.note} hint={`O fã não vê o motivo. Até ${ADJUST_NOTE_MAX} caracteres.`}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={shown.note}
              maxLength={ADJUST_NOTE_MAX}
              disabled={locked || busy}
              onChange={(event) => set("note", event.target.value)}
            />
          )}
        </Field>
        <div className="rounded-[10px] border border-line bg-raised px-4 py-3">
          <p className="m-0 text-[12.5px] font-semibold text-fg/60">Antes e depois</p>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-0.5 p-0 text-[13.5px] text-fg tabular-nums">
            {preview.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <p className="m-0 text-[12.5px] text-fg/60">A alteração fica registrada em Logs e auditoria com o seu nome.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close} disabled={busy}>
            {locked ? "Fechar" : "Cancelar"}
          </Button>
          {locked ? (
            <Button variant="secondary" busy={checking} onClick={() => void checkLedger()}>
              {checking ? "Conferindo..." : "Conferir o extrato"}
            </Button>
          ) : null}
          <Button type="submit" variant="primary" busy={busy}>
            {busy ? "Ajustando..." : locked ? "Tentar de novo" : "Ajustar pontos"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeltaField({
  label,
  value,
  error,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  hint?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} error={error} hint={hint ?? "Ex.: +100 ou -50"}>
      {({ id, describedBy, invalid }) => (
        <TextInput
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          value={value}
          autoComplete="off"
          placeholder="0"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="tabular-nums"
        />
      )}
    </Field>
  );
}
