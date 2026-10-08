"use client";

import { useState } from "react";

import { AchievementBadgeIcon, ConfigChangedNotice } from "@/components/missoes/game-bits";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import {
  ACHIEVEMENT_ICONS,
  ACHIEVEMENT_RANK_MAX,
  ACHIEVEMENT_TITLE_MAX,
  ACHIEVEMENT_TONES,
  EMPTY_ACHIEVEMENT_FORM,
  FIRST_ACTIONS,
  FIRST_ACTION_LABELS,
  ICON_LABELS,
  RULE_TYPE_LABELS,
  TONE_LABELS,
  achievementChanges,
  achievementFieldOf,
  achievementFormOf,
  isKnownIcon,
  validateAchievement,
  type Achievement,
  type AchievementErrors,
  type AchievementForm,
  type AchievementTone,
  type FirstAction,
  type RuleType,
} from "@/lib/achievements";
import { REASON_MESSAGES, actionErrorMessage, errorDetails, isConfigChanged, reasonOf } from "@/lib/errors";
import { createAchievement, updateAchievement } from "@/lib/game-api";
import { getAchievementsCatalog } from "@/lib/game-data";
import { NO_LEVELS_TEXT, type Level } from "@/lib/levels";

export interface AchievementDialogRequest {
  achievement: Achievement | null;
  version: number;
}

export function AchievementDialog({
  request,
  levels,
  onClose,
  onSaved,
}: {
  request: AchievementDialogRequest | null;
  /** A régua de agora: os degraus que a regra de nível pode pedir. */
  levels: Level[] | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return request ? (
    <AchievementDialogBody key={`${request.achievement?.id ?? "nova"}:${request.version}`} request={request} levels={levels} onClose={onClose} onSaved={onSaved} />
  ) : null;
}

function AchievementDialogBody({
  request,
  levels,
  onClose,
  onSaved,
}: {
  request: AchievementDialogRequest;
  levels: Level[] | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const mounted = useMountedRef();
  const [achievement, setAchievement] = useState<Achievement | null>(request.achievement);
  const [version, setVersion] = useState(request.version);
  const [form, setForm] = useState<AchievementForm>(() => (request.achievement ? achievementFormOf(request.achievement) : EMPTY_ACHIEVEMENT_FORM));
  const [errors, setErrors] = useState<AchievementErrors>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloadingData, setReloadingData] = useState(false);
  const [gone, setGone] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const creating = !request.achievement;
  const locked = Boolean(achievement?.activatedAt);
  const blocked = busy || gone;
  const levelOptions = (levels ?? []).filter((level) => level.number >= 2);

  function set<K extends keyof AchievementForm>(field: K, value: AchievementForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function reloadData() {
    setReloadingData(true);
    try {
      const catalog = await getAchievementsCatalog();
      if (!mounted.current) return;
      setVersion(catalog.version);
      setChanged(false);
      setErrors({});
      if (request.achievement) {
        const fresh = catalog.achievements.find((item) => item.id === request.achievement?.id) ?? null;
        if (!fresh) {
          setGone(true);
          setMessage({ tone: "error", text: "Esta conquista saiu do catálogo enquanto você editava. Feche e confira a lista." });
          return;
        }
        setAchievement(fresh);
        setForm(achievementFormOf(fresh));
      }
      setMessage({ tone: "info", text: "Dados recarregados. Confira e salve de novo." });
    } catch (failure) {
      if (mounted.current) setMessage({ tone: "error", text: actionErrorMessage(failure) });
    } finally {
      if (mounted.current) setReloadingData(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked) return;
    const checked = validateAchievement(form, levels ? levels.length : null);
    setErrors(checked.errors);
    if (!checked.input) return;
    const input = checked.input;
    setMessage(null);
    setChanged(false);
    if (achievement) {
      const changes = achievementChanges(achievement, input);
      if (Object.keys(changes).length === 0) {
        setMessage({ tone: "info", text: "Nada mudou para salvar." });
        return;
      }
      setBusy(true);
      try {
        await updateAchievement({ expectedVersion: version, achievementId: achievement.id, changes });
        if (mounted.current) onSaved(`Conquista ${input.title} salva.`);
      } catch (failure) {
        if (mounted.current) fail(failure);
      } finally {
        if (mounted.current) setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      await createAchievement({ expectedVersion: version, achievement: input });
      if (mounted.current) onSaved(`Conquista ${input.title} criada como rascunho. Publique quando estiver pronta.`);
    } catch (failure) {
      if (mounted.current) fail(failure);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function fail(failure: unknown) {
    if (isConfigChanged(failure)) {
      setChanged(true);
      return;
    }
    const field = reasonOf(failure) === "invalid-request" ? achievementFieldOf(errorDetails(failure).field) : null;
    if (field) {
      setErrors((current) => ({ ...current, [field]: actionErrorMessage(failure) }));
      return;
    }
    setMessage({ tone: "error", text: actionErrorMessage(failure) });
  }

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      busy={busy}
      size="md"
      title={creating ? "Nova conquista" : `Editar ${achievement?.title ?? "conquista"}`}
      description={creating ? "Nasce como rascunho: o app só mostra depois de publicar." : undefined}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex items-center gap-3">
          <AchievementBadgeIcon icon={form.icon} tone={form.tone} className="size-11" />
          <p className="m-0 text-[13px] text-fg/65">Como o app desenha a conquista.</p>
        </div>
        <Field label="Nome" error={errors.title} hint={`Até ${ACHIEVEMENT_TITLE_MAX} caracteres.`}>
          {({ id, describedBy, invalid }) => (
            <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.title} maxLength={ACHIEVEMENT_TITLE_MAX} disabled={blocked} onChange={(event) => set("title", event.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ícone" error={errors.icon}>
            {({ id, describedBy, invalid }) => (
              <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.icon} disabled={blocked} onChange={(event) => set("icon", event.target.value)}>
                {!isKnownIcon(form.icon) ? <option value={form.icon}>{form.icon}</option> : null}
                {ACHIEVEMENT_ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {ICON_LABELS[icon]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="Cor" error={errors.tone}>
            {({ id, describedBy, invalid }) => (
              <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.tone} disabled={blocked} onChange={(event) => set("tone", event.target.value as AchievementTone)}>
                {ACHIEVEMENT_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {TONE_LABELS[tone]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </div>

        {locked ? <Notice tone="info">{REASON_MESSAGES["achievement-locked"]}</Notice> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Regra" error={errors.ruleType}>
            {({ id, describedBy, invalid }) => (
              <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.ruleType} disabled={blocked || locked} onChange={(event) => set("ruleType", event.target.value as RuleType)}>
                {(Object.keys(RULE_TYPE_LABELS) as RuleType[]).map((type) => (
                  <option key={type} value={type}>
                    {RULE_TYPE_LABELS[type]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          {form.ruleType === "level" ? (
            <Field label="Nível" error={errors.level} hint={levels ? "Os níveis da régua de agora." : NO_LEVELS_TEXT}>
              {({ id, describedBy, invalid }) => (
                <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.level} disabled={blocked || locked || !levels} onChange={(event) => set("level", event.target.value)}>
                  <option value="">Escolha o nível</option>
                  {form.level && !levelOptions.some((level) => String(level.number) === form.level) ? <option value={form.level}>Nível {form.level} (fora da régua)</option> : null}
                  {levelOptions.map((level) => (
                    <option key={level.number} value={String(level.number)}>
                      Nível {level.number} · {level.name}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          ) : null}
          {form.ruleType === "first" ? (
            <Field label="Ação" error={errors.action}>
              {({ id, describedBy, invalid }) => (
                <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.action} disabled={blocked || locked} onChange={(event) => set("action", event.target.value as FirstAction)}>
                  {FIRST_ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {FIRST_ACTION_LABELS[action]}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          ) : null}
          {form.ruleType === "rank" ? (
            <Field label="Top do ranking" error={errors.top} hint={`De 1 a ${ACHIEVEMENT_RANK_MAX}. Sai no retrato semanal e na virada.`}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  type="number"
                  min={1}
                  max={ACHIEVEMENT_RANK_MAX}
                  value={form.top}
                  disabled={blocked || locked}
                  onChange={(event) => set("top", event.target.value)}
                />
              )}
            </Field>
          ) : null}
        </div>

        {changed ? <ConfigChangedNotice onReload={() => void reloadData()} busy={reloadingData} /> : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <p className="m-0 text-[12.5px] text-fg/60">A alteração fica registrada em Logs e auditoria com o seu nome.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={gone || changed}>
            {busy ? "Salvando..." : creating ? "Criar rascunho" : "Salvar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
