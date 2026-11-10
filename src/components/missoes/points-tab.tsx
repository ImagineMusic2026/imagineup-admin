"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";

import { ConfigChangedNotice } from "@/components/missoes/game-bits";
import { SectionCard } from "@/components/painel/section-card";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, INPUT_CLASS, Switch } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import type { Achievement } from "@/lib/achievements";
import { actionErrorMessage, errorDetails, isConfigChanged, mayHaveRunOnServer, reasonOf } from "@/lib/errors";
import { updatePointsConfig, type PointsConfigChanges } from "@/lib/game-api";
import { LEVEL_NAME_MAX, LEVELS_MAX, LEVELS_MIN, type Level } from "@/lib/levels";
import {
  ACTION_CAP_KEYS,
  ACTION_CAP_LABELS,
  CAP_MAX,
  CHECKIN_CONFIRM,
  CHECKIN_CYCLE_TEXT,
  CHECKIN_MILESTONES_TEXT,
  CHECKIN_OFF_TEXT,
  CHECKIN_ON_TEXT,
  CHECKIN_SAVED_TEXT,
  CHECKIN_UNCERTAIN_TEXT,
  CHECKIN_UNCHANGED_TEXT,
  CHECKIN_UNKNOWN_TEXT,
  CHECKIN_VALUE_MAX,
  CHECKIN_VALUE_MIN,
  LEVELS_CONFIRM_TEXT,
  LIMIT_MAX,
  NO_POINTS_CONFIG_TEXT,
  POINTS_RULE_TEXT,
  VALUE_HINTS,
  VALUE_MAX,
  VALUE_SOURCES,
  VALUE_LABELS,
  addLevelRow,
  capsFormOf,
  checkinDayLabel,
  checkinFailureOf,
  checkinFormOf,
  checkinRequestOf,
  checkinSaveStep,
  checkinSaved,
  cycleSummary,
  levelInUseList,
  levelsFormOf,
  sameLevels,
  validateCaps,
  validateCheckin,
  validateLevelsForm,
  validateValues,
  valuesFormOf,
  versionText,
  type ActionCapKey,
  type CapsForm,
  type CheckinErrors,
  type CheckinForm,
  type CheckinPending,
  type LevelErrors,
  type LevelRow,
  type PointsConfig,
  type RowErrors,
  type ValueSource,
  type ValuesForm,
} from "@/lib/points-config";

interface BlockProps {
  config: PointsConfig;
  canEdit: boolean;
  /** A página está lendo os documentos de novo (o "Recarregar dados" espera por ela). */
  reloading: boolean;
  onChanged: (message: string) => void;
  onReload: () => void;
}

/**
 * O formulário de um bloco, preso à versão de que saiu (`base`, o
 * `expectedVersion`). Quando a página lê uma versão nova, o bloco sem edição
 * acompanha; o que tem edição fica na versão dele, e o servidor responde
 * `config-changed` ao salvar. Depois de salvar ou de "Recarregar dados", o
 * bloco segue a próxima versão lida (`following`, até ela chegar). O `adopt`
 * troca a base na hora, pela régua que o servidor disse que já está gravada.
 */
function useBlockForm<F>(config: PointsConfig, formOf: (config: PointsConfig) => F) {
  const [base, setBase] = useState(config);
  const [form, setForm] = useState<F>(() => formOf(config));
  const [follow, setFollow] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(base));
  if (config.version !== base.version && (!dirty || follow)) {
    setBase(config);
    setForm(formOf(config));
    setFollow(false);
  }
  const adopt = (next: PointsConfig) => {
    setBase(next);
    setForm(formOf(next));
    setFollow(false);
  };
  return { base, form, setForm, dirty, following: follow, followNext: () => setFollow(true), adopt, discard: () => setForm(formOf(base)) };
}

/** O erro de um "Salvar": a configuração mudada vira o aviso com "Recarregar dados"; o resto, a frase do servidor. */
type SaveError = { kind: "changed" } | { kind: "message"; text: string };

function SaveFooter({
  canEdit,
  busy,
  dirty,
  error,
  info,
  reloading,
  waiting = false,
  onReload,
  onDiscard,
  label,
}: {
  canEdit: boolean;
  busy: boolean;
  dirty: boolean;
  error: SaveError | null;
  info: string | null;
  reloading: boolean;
  /** O bloco espera a releitura que ele pediu: o salvar fica ocupado, dizendo isso, e o descartar, desligado. */
  waiting?: boolean;
  onReload: () => void;
  /** Volta o bloco aos valores gravados. */
  onDiscard: () => void;
  label: string;
}) {
  if (!canEdit) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
      {error?.kind === "changed" ? <ConfigChangedNotice onReload={onReload} busy={reloading} /> : null}
      {error?.kind === "message" ? <Notice tone="error">{error.text}</Notice> : null}
      {info ? <Notice tone="info">{info}</Notice> : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {dirty ? (
          <>
            {/* Esperando a releitura, a mudança já foi salva: o aviso só volta se ela falhar. */}
            {waiting ? null : <span className="text-[13px] text-fg/65">Mudanças sem salvar.</span>}
            <Button variant="ghost" size="sm" disabled={busy || waiting} onClick={onDiscard}>
              Descartar
            </Button>
          </>
        ) : null}
        <Button type="submit" variant="primary" size="sm" busy={busy || waiting} disabled={error?.kind === "changed"}>
          {busy ? "Salvando..." : waiting ? "Recarregando..." : label}
        </Button>
      </div>
    </div>
  );
}

function NumberCell({
  value,
  onChange,
  label,
  error,
  min,
  max,
  disabled,
  readOnly,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: string;
  min: number;
  max: number;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}) {
  const id = `campo-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-erro` : undefined}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        className={cx(INPUT_CLASS, "h-10 w-full tabular-nums")}
      />
      {error ? (
        <p id={`${id}-erro`} className="m-0 text-[12.5px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Valores por ação: pontos e limite por dia, de cada origem; a missão sempre sem limite. */
function ValuesBlock({ config, canEdit, reloading, onChanged, onReload }: BlockProps) {
  const mounted = useMountedRef();
  const { base, form, setForm, dirty, followNext, discard } = useBlockForm<ValuesForm>(config, valuesFormOf);
  const [errors, setErrors] = useState<Partial<Record<ValueSource, RowErrors>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function set(source: ValueSource, patch: Partial<ValuesForm[ValueSource]>) {
    setForm((current) => ({ ...current, [source]: { ...current[source], ...patch } }));
    setErrors((current) => ({ ...current, [source]: undefined }));
    setInfo(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const checked = validateValues(form, base);
    setErrors(checked.errors);
    if (!checked.changes) return;
    if (!checked.changes.values && !checked.changes.dailyLimits) {
      setInfo("Nada mudou para salvar.");
      return;
    }
    await save(checked.changes);
  }

  async function save(changes: PointsConfigChanges) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await updatePointsConfig({ expectedVersion: base.version, ...changes });
      if (!mounted.current) return;
      followNext();
      onChanged("Valores por ação salvos.");
    } catch (failure) {
      if (mounted.current) setError(isConfigChanged(failure) ? { kind: "changed" } : { kind: "message", text: actionErrorMessage(failure) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <SectionCard id="titulo-valores" title="Valores por ação" meta="Pontos de 0 a 10.000; limite por dia de 1 a 1.000, ou sem limite.">
      <form onSubmit={submit} noValidate>
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_150px_260px] gap-4 px-5 pt-3 pb-2 group-label text-fg/50 md:grid">
          <span>Ação</span>
          <span>Pontos</span>
          <span>Limite por dia</span>
        </div>
        <ul className="m-0 list-none p-0">
          {VALUE_SOURCES.map((source) => {
            const row = form[source];
            const rowErrors = errors[source] ?? {};
            return (
              <li key={source} className="grid gap-3 border-t border-line px-5 py-3.5 first:border-t-0 md:grid-cols-[minmax(0,1fr)_150px_260px] md:items-start md:gap-4 md:first:border-t">
                <span className="flex flex-col gap-0.5 pt-2">
                  <span className="text-sm font-semibold text-fg">{VALUE_LABELS[source]}</span>
                  {VALUE_HINTS[source] ? <span className="text-[12.5px] leading-snug text-fg/60">{VALUE_HINTS[source]}</span> : null}
                </span>
                <NumberCell
                  label={`Pontos por ${VALUE_LABELS[source].toLowerCase()}`}
                  value={row.points}
                  min={0}
                  max={VALUE_MAX}
                  error={rowErrors.points}
                  readOnly={!canEdit}
                  disabled={busy}
                  onChange={(value) => set(source, { points: value })}
                />
                <div className="flex items-start gap-3">
                  <NumberCell
                    label={`Limite por dia de ${VALUE_LABELS[source].toLowerCase()}`}
                    value={row.limited ? row.limit : ""}
                    min={1}
                    max={LIMIT_MAX}
                    error={rowErrors.limit}
                    readOnly={!canEdit}
                    disabled={busy || !row.limited}
                    onChange={(value) => set(source, { limit: value })}
                    className="w-28"
                  />
                  <Checkbox
                    label="Sem limite"
                    checked={!row.limited}
                    disabled={busy || !canEdit}
                    onChange={(event) => set(source, { limited: !event.target.checked, limit: row.limit || "" })}
                    className="pt-2.5"
                  />
                </div>
              </li>
            );
          })}
          <li className="grid gap-3 border-t border-line px-5 py-3.5 md:grid-cols-[minmax(0,1fr)_150px_260px] md:items-center md:gap-4">
            <span className="text-sm font-semibold text-fg">Missão</span>
            <span className="text-[13px] text-fg/70">Os pontos de cada missão</span>
            <span className="text-[13px] text-fg/70">Sem limite, sempre</span>
          </li>
        </ul>
        <SaveFooter
          canEdit={canEdit}
          busy={busy}
          dirty={dirty}
          error={error}
          info={info}
          reloading={reloading}
          label="Salvar valores"
          onDiscard={() => {
            discard();
            setErrors({});
            setInfo(null);
          }}
          onReload={() => {
            followNext();
            setError(null);
            onReload();
          }}
        />
      </form>
    </SectionCard>
  );
}

/**
 * O check-in diário: a chave e os pontos de cada dia do ciclo. O bloco vai
 * inteiro ao servidor quando algo nele mudou; ligar e desligar pedem a
 * confirmação antes, e mudar só os pontos salva direto. O pedido leva a versão
 * da régua de que o bloco saiu, também o da confirmação.
 */
function CheckinBlock({ config, canEdit, reloading, onChanged, onReload }: BlockProps) {
  const mounted = useMountedRef();
  const { base, form, setForm, dirty, following, followNext, adopt, discard } = useBlockForm<CheckinForm>(config, checkinFormOf);
  const [errors, setErrors] = useState<CheckinErrors>({});
  const [error, setError] = useState<SaveError | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<CheckinPending | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // O bloco salvou ou pediu "Recarregar dados" e a releitura ainda não chegou: até lá, nada nele muda nem é
  // salvo. Sem isso, o que a pessoa mexesse nesse meio sumiria quando a régua nova chegasse.
  const waiting = following && reloading;
  // A régua do bloco mudou por baixo da confirmação aberta: ela era de outra versão, e fecha sem pedido.
  if (pending && !busy && pending.version !== base.version) {
    setPending(null);
    setInfo("Dados recarregados. Confira e salve de novo.");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || waiting) return;
    const checked = validateCheckin(form, base);
    setErrors(checked.errors);
    if (!checked.changes) return;
    const checkin = checked.changes.checkin;
    if (!checkin) {
      setInfo("Nada mudou para salvar.");
      return;
    }
    setError(null);
    setInfo(null);
    setConfirmError(null);
    // A chave que muda espera a confirmação, e nada vai ao servidor antes dela; só os pontos salvam direto. Nos
    // dois casos o pedido fica com a versão da régua de agora.
    const step = checkinSaveStep(checkin, base);
    if (step.confirm) setPending(step.pending);
    else void save(step.pending, false);
  }

  async function save(sent: CheckinPending, confirmed: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setConfirmError(null);
    try {
      const result = await updatePointsConfig(checkinRequestOf(sent));
      if (!mounted.current) return;
      setPending(null);
      if (!checkinSaved(result, sent.version)) {
        // A versão não andou: o bloco gravado já era igual ao mandado. O bloco assume esse estado, sem dizer
        // "salvo", e a página lê de novo para a linha do estado acompanhar.
        adopt({ ...base, checkin: sent.checkin });
        setInfo(CHECKIN_UNCHANGED_TEXT);
        onReload();
        return;
      }
      followNext();
      onChanged(CHECKIN_SAVED_TEXT);
    } catch (failure) {
      if (!mounted.current) return;
      const refused = checkinFailureOf(failure);
      if (refused.kind === "changed") {
        setPending(null);
        setError({ kind: "changed" });
      } else if (refused.kind === "unknown") {
        // O servidor de antes do check-in: a frase própria, e o formulário fica como está.
        setPending(null);
        setError({ kind: "message", text: CHECKIN_UNKNOWN_TEXT });
      } else if (refused.kind === "day") {
        setPending(null);
        setErrors((current) => ({ ...current, [refused.day]: actionErrorMessage(failure) }));
      } else {
        // Na confirmação, a falha incerta manda conferir a linha do estado do bloco: a régua não tem lista.
        if (confirmed) setConfirmError(refused.uncertain ? CHECKIN_UNCERTAIN_TEXT : actionErrorMessage(failure));
        else setError({ kind: "message", text: actionErrorMessage(failure) });
        if (refused.uncertain) onReload();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const confirm = CHECKIN_CONFIRM[pending?.checkin.enabled ? "on" : "off"];
  const turningOff = pending?.checkin.enabled === false;

  return (
    <SectionCard id="titulo-checkin" title="Check-in diário" meta="Os pontos de cada dia do ciclo, de 1 a 999.">
      <form onSubmit={submit} noValidate>
        <div className="flex flex-col gap-3 px-5 pt-4">
          {/* O estado é o da última leitura do servidor, e não o do formulário: a chave mexida só vale depois de salvar. */}
          <p className="m-0 text-sm font-semibold text-fg">{config.checkin.enabled ? CHECKIN_ON_TEXT : CHECKIN_OFF_TEXT}</p>
          <Switch
            label="Check-in ligado"
            description={canEdit ? "Só muda depois de salvar, com a confirmação." : undefined}
            checked={form.enabled}
            disabled={!canEdit || busy || waiting}
            onChange={(checked) => {
              setForm((current) => ({ ...current, enabled: checked }));
              setInfo(null);
            }}
            className="self-start"
          />
          <p className="m-0 text-[13px] leading-relaxed text-fg/70">{CHECKIN_CYCLE_TEXT}</p>
          <p className="m-0 text-[13px] leading-relaxed text-fg/70">{CHECKIN_MILESTONES_TEXT}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-4 xl:grid-cols-7">
          {form.days.map((value, index) => {
            const day = index + 1;
            return (
              <div key={day} className="flex flex-col gap-1.5">
                <span aria-hidden="true" className="text-[13px] font-semibold text-fg/80">
                  Dia {day}
                </span>
                <NumberCell
                  label={checkinDayLabel(day)}
                  value={value}
                  min={CHECKIN_VALUE_MIN}
                  max={CHECKIN_VALUE_MAX}
                  error={errors[day]}
                  readOnly={!canEdit}
                  disabled={busy || waiting}
                  onChange={(next) => {
                    setForm((current) => ({ ...current, days: current.days.map((text, position) => (position === index ? next : text)) }));
                    setErrors((current) => ({ ...current, [day]: undefined }));
                    setInfo(null);
                  }}
                />
              </div>
            );
          })}
        </div>
        <SaveFooter
          canEdit={canEdit}
          busy={busy}
          dirty={dirty}
          error={error}
          info={info}
          reloading={reloading}
          waiting={waiting}
          label="Salvar check-in"
          onDiscard={() => {
            discard();
            setErrors({});
            setInfo(null);
          }}
          onReload={() => {
            followNext();
            setError(null);
            onReload();
          }}
        />
      </form>
      <Dialog
        open={canEdit && Boolean(pending)}
        onClose={() => !busy && setPending(null)}
        busy={busy}
        size="sm"
        tone={turningOff ? "danger" : "default"}
        title={confirm.title}
        description={confirm.text}
      >
        <div className="flex flex-col gap-4">
          {pending?.checkin.enabled ? <p className="m-0 text-sm text-fg/85">{cycleSummary(pending.checkin.cycle)}</p> : null}
          {confirmError ? <Notice tone="error">{confirmError}</Notice> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy} data-autofocus>
              Voltar
            </Button>
            <Button
              variant={turningOff ? "danger" : "primary"}
              busy={busy}
              onClick={() => {
                if (pending) void save(pending, true);
              }}
            >
              {busy ? "Salvando..." : confirm.action}
            </Button>
          </div>
        </div>
      </Dialog>
    </SectionCard>
  );
}

/** Tetos do dia (antiabuso): quantas vezes cada ação vale por dia, de 1 a 10.000. */
function CapsBlock({ config, canEdit, reloading, onChanged, onReload }: BlockProps) {
  const mounted = useMountedRef();
  const { base, form, setForm, dirty, followNext, discard } = useBlockForm<CapsForm>(config, capsFormOf);
  const [errors, setErrors] = useState<Partial<Record<ActionCapKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const checked = validateCaps(form, base);
    setErrors(checked.errors);
    if (!checked.changes) return;
    if (Object.keys(checked.changes).length === 0) {
      setInfo("Nada mudou para salvar.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await updatePointsConfig({ expectedVersion: base.version, actionCaps: checked.changes });
      if (!mounted.current) return;
      followNext();
      onChanged("Tetos do dia salvos.");
    } catch (failure) {
      if (mounted.current) setError(isConfigChanged(failure) ? { kind: "changed" } : { kind: "message", text: actionErrorMessage(failure) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <SectionCard id="titulo-tetos" title="Tetos do dia" meta="Antiabuso: depois do teto, a ação não vale mais naquele dia. De 1 a 10.000.">
      <form onSubmit={submit} noValidate>
        <div className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-5">
          {ACTION_CAP_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <span aria-hidden="true" className="text-[13px] font-semibold text-fg/80">
                {ACTION_CAP_LABELS[key]}
              </span>
              <NumberCell
                label={`Teto do dia de ${ACTION_CAP_LABELS[key].toLowerCase()}`}
                value={form[key]}
                min={1}
                max={CAP_MAX}
                error={errors[key]}
                readOnly={!canEdit}
                disabled={busy}
                onChange={(value) => {
                  setForm((current) => ({ ...current, [key]: value }));
                  setErrors((current) => ({ ...current, [key]: undefined }));
                  setInfo(null);
                }}
              />
            </div>
          ))}
        </div>
        <SaveFooter
          canEdit={canEdit}
          busy={busy}
          dirty={dirty}
          error={error}
          info={info}
          reloading={reloading}
          label="Salvar tetos"
          onDiscard={() => {
            discard();
            setErrors({});
            setInfo(null);
          }}
          onReload={() => {
            followNext();
            setError(null);
            onReload();
          }}
        />
      </form>
    </SectionCard>
  );
}

function levelRowsOf(config: PointsConfig): LevelRow[] {
  return levelsFormOf(config.levels);
}

/** Os níveis: nome e XP mínimo de cada degrau, de 2 a 50, com a confirmação antes de salvar. */
function LevelsBlock({ config, canEdit, reloading, onChanged, onReload, achievements }: BlockProps & { achievements: readonly Achievement[] }) {
  const mounted = useMountedRef();
  const { base, form, setForm, dirty, followNext, discard } = useBlockForm<LevelRow[]>(config, levelRowsOf);
  const [errors, setErrors] = useState<LevelErrors>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [error, setError] = useState<SaveError | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<Level[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(1);

  function setRow(key: string, patch: Partial<LevelRow>) {
    setForm((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setErrors((current) => ({ ...current, [key]: {} }));
    setInfo(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = validateLevelsForm(form);
    setErrors(checked.errors);
    setFormMessage(checked.message);
    if (!checked.levels) return;
    if (sameLevels(checked.levels, base.levels)) {
      setInfo("Nada mudou para salvar.");
      return;
    }
    setError(null);
    setInfo(null);
    setConfirmError(null);
    setPending(checked.levels);
  }

  async function save() {
    if (!pending || busy) return;
    setBusy(true);
    setConfirmError(null);
    try {
      await updatePointsConfig({ expectedVersion: base.version, levels: pending });
      if (!mounted.current) return;
      followNext();
      setPending(null);
      onChanged("Níveis salvos.");
    } catch (failure) {
      if (!mounted.current) return;
      if (isConfigChanged(failure)) {
        setPending(null);
        setError({ kind: "changed" });
      } else if (reasonOf(failure) === "level-in-use") {
        const ids = errorDetails(failure).achievementIds;
        const list = Array.isArray(ids) ? levelInUseList(ids.filter((id): id is string => typeof id === "string"), achievements) : "";
        setConfirmError(`${actionErrorMessage(failure)} ${list}`.trim());
      } else {
        setConfirmError(actionErrorMessage(failure));
        if (mayHaveRunOnServer(failure)) onReload();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <SectionCard id="titulo-niveis" title="Níveis" meta={`De ${LEVELS_MIN} a ${LEVELS_MAX} degraus. O nível 1 começa em 0 XP.`}>
      <form onSubmit={submit} noValidate>
        <div aria-hidden="true" className="hidden grid-cols-[90px_minmax(0,1fr)_200px] gap-4 px-5 pt-3 pb-2 group-label text-fg/50 md:grid">
          <span>Nível</span>
          <span>Nome</span>
          <span>XP mínimo</span>
        </div>
        <ol className="m-0 list-none p-0">
          {form.map((row, index) => {
            const rowErrors = errors[row.key] ?? {};
            const nameId = `nivel-${row.key}-nome`;
            return (
              <li key={row.key} className="grid gap-3 border-t border-line px-5 py-3 first:border-t-0 md:grid-cols-[90px_minmax(0,1fr)_200px] md:items-start md:gap-4 md:first:border-t">
                <span className="pt-2 font-display text-sm font-semibold tabular-nums text-fg/85">Nível {index + 1}</span>
                <div className="flex flex-col gap-1">
                  <input
                    id={nameId}
                    value={row.name}
                    maxLength={LEVEL_NAME_MAX}
                    aria-label={`Nome do nível ${index + 1}`}
                    aria-invalid={rowErrors.name ? true : undefined}
                    aria-describedby={rowErrors.name ? `${nameId}-erro` : undefined}
                    readOnly={!canEdit}
                    onChange={(event) => setRow(row.key, { name: event.target.value })}
                    className={cx(INPUT_CLASS, "h-10")}
                  />
                  {rowErrors.name ? (
                    <p id={`${nameId}-erro`} className="m-0 text-[12.5px] font-medium text-danger">
                      {rowErrors.name}
                    </p>
                  ) : null}
                </div>
                <NumberCell
                  label={`XP mínimo do nível ${index + 1}`}
                  value={row.minXp}
                  min={0}
                  max={Number.MAX_SAFE_INTEGER}
                  error={rowErrors.minXp}
                  readOnly={!canEdit || index === 0}
                  onChange={(value) => setRow(row.key, { minXp: value })}
                />
              </li>
            );
          })}
        </ol>
        {canEdit ? (
          <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={form.length >= LEVELS_MAX}
              onClick={() => {
                setForm((current) => addLevelRow(current, `novo-${nextKey}`));
                setNextKey((value) => value + 1);
                setInfo(null);
              }}
            >
              <Plus aria-hidden="true" className="size-4" />
              Acrescentar nível
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={form.length <= LEVELS_MIN}
              onClick={() => {
                setForm((current) => current.slice(0, -1));
                setInfo(null);
              }}
            >
              <Minus aria-hidden="true" className="size-4" />
              Tirar o último
            </Button>
          </div>
        ) : null}
        {formMessage ? (
          <div className="px-5 pb-3">
            <Notice tone="error">{formMessage}</Notice>
          </div>
        ) : null}
        <SaveFooter
          canEdit={canEdit}
          busy={busy}
          dirty={dirty}
          error={error}
          info={info}
          reloading={reloading}
          label="Salvar níveis"
          onDiscard={() => {
            discard();
            setErrors({});
            setFormMessage(null);
            setInfo(null);
          }}
          onReload={() => {
            followNext();
            setError(null);
            onReload();
          }}
        />
      </form>
      <Dialog
        open={canEdit && Boolean(pending)}
        onClose={() => !busy && setPending(null)}
        busy={busy}
        size="sm"
        title="Salvar os níveis?"
        description={LEVELS_CONFIRM_TEXT}
      >
        <div className="flex flex-col gap-4">
          {confirmError ? <Notice tone="error">{confirmError}</Notice> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy} data-autofocus>
              Voltar
            </Button>
            <Button variant="primary" busy={busy} onClick={() => void save()}>
              {busy ? "Salvando..." : "Salvar níveis"}
            </Button>
          </div>
        </div>
      </Dialog>
    </SectionCard>
  );
}

export function PointsTab({
  canEdit,
  points,
  achievements,
  reloading,
  onChanged,
  onReload,
}: {
  canEdit: boolean;
  points: PointsConfig | null;
  achievements: readonly Achievement[];
  reloading: boolean;
  onChanged: (message: string) => void;
  onReload: () => void;
}) {
  if (!points) {
    return (
      <SectionCard id="titulo-regua" title="Régua de pontos">
        <p className="m-0 px-5 py-6 text-sm text-fg/70">{NO_POINTS_CONFIG_TEXT}</p>
      </SectionCard>
    );
  }
  const props = { config: points, canEdit, reloading, onChanged, onReload };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-[13.5px]">
        <p className="m-0 text-fg/80">{versionText(points)}</p>
        <p className="m-0 text-fg/65">{POINTS_RULE_TEXT}</p>
        {!canEdit ? <p className="m-0 text-fg/65">Você vê a régua sem poder mudar.</p> : null}
      </div>
      <ValuesBlock {...props} />
      <CheckinBlock {...props} />
      <CapsBlock {...props} />
      <LevelsBlock {...props} achievements={achievements} />
    </div>
  );
}
