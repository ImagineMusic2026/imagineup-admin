"use client";

import { useState } from "react";

import { ConfigChangedNotice } from "@/components/missoes/game-bits";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { actionErrorMessage, isConfigChanged } from "@/lib/errors";
import { updateSeasonGoal } from "@/lib/game-api";
import { getMissionsCatalog } from "@/lib/game-data";
import {
  GOAL_MISSIONS_MAX,
  GOAL_POINTS_MAX,
  GOAL_TEXT_MAX,
  GOAL_TITLE_MAX,
  goalFormOf,
  validateGoal,
  type GoalForm,
  type SeasonGoal,
} from "@/lib/missions";

export interface GoalDialogRequest {
  goal: SeasonGoal | null;
  version: number;
  seasonName: string;
}

export function GoalDialog({ request, onClose, onSaved }: { request: GoalDialogRequest | null; onClose: () => void; onSaved: (message: string) => void }) {
  return request ? <GoalDialogBody key={request.version} request={request} onClose={onClose} onSaved={onSaved} /> : null;
}

function GoalDialogBody({ request, onClose, onSaved }: { request: GoalDialogRequest; onClose: () => void; onSaved: (message: string) => void }) {
  const mounted = useMountedRef();
  const [form, setForm] = useState<GoalForm>(() => goalFormOf(request.goal));
  const [version, setVersion] = useState(request.version);
  const [errors, setErrors] = useState<Partial<Record<keyof GoalForm, string>>>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloadingData, setReloadingData] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  function set<K extends keyof GoalForm>(field: K, value: GoalForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function reloadData() {
    setReloadingData(true);
    try {
      const catalog = await getMissionsCatalog();
      if (!mounted.current) return;
      setVersion(catalog.version);
      setForm(goalFormOf(catalog.seasonGoal));
      setChanged(false);
      setMessage({ tone: "info", text: "Dados recarregados. Confira e salve de novo." });
    } catch (failure) {
      if (mounted.current) setMessage({ tone: "error", text: actionErrorMessage(failure) });
    } finally {
      if (mounted.current) setReloadingData(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const checked = validateGoal(form);
    setErrors(checked.errors);
    if (!checked.input) return;
    const before = request.goal;
    const input = checked.input;
    if (
      before &&
      before.title === input.title &&
      before.description === input.description &&
      before.reachedDescription === input.reachedDescription &&
      before.metric === input.metric &&
      before.target === input.target
    ) {
      setMessage({ tone: "info", text: "Nada mudou para salvar." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await updateSeasonGoal({ expectedVersion: version, goal: input });
      if (mounted.current) onSaved(`Meta de ${request.seasonName} salva.`);
    } catch (failure) {
      if (!mounted.current) return;
      if (isConfigChanged(failure)) setChanged(true);
      else setMessage({ tone: "error", text: actionErrorMessage(failure) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const max = form.metric === "points" ? GOAL_POINTS_MAX : GOAL_MISSIONS_MAX;
  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      busy={busy}
      size="md"
      title={request.goal ? "Editar meta da temporada" : "Criar meta da temporada"}
      description={`Vale para ${request.seasonName}. O app mostra a meta no topo das missões.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Título" error={errors.title} hint={`Até ${GOAL_TITLE_MAX} caracteres.`}>
          {({ id, describedBy, invalid }) => (
            <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.title} maxLength={GOAL_TITLE_MAX} disabled={busy} onChange={(event) => set("title", event.target.value)} />
          )}
        </Field>
        <Field label="Texto" error={errors.description} hint={`Até ${GOAL_TEXT_MAX} caracteres, numa linha.`}>
          {({ id, describedBy, invalid }) => (
            <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.description} maxLength={GOAL_TEXT_MAX} disabled={busy} onChange={(event) => set("description", event.target.value)} />
          )}
        </Field>
        <Field label="Texto da meta cumprida" optional error={errors.reachedDescription} hint="O que o fã lê depois de chegar lá.">
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={form.reachedDescription}
              maxLength={GOAL_TEXT_MAX}
              disabled={busy}
              onChange={(event) => set("reachedDescription", event.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Conta" error={errors.metric}>
            {({ id, describedBy, invalid }) => (
              <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.metric} disabled={busy} onChange={(event) => set("metric", event.target.value as GoalForm["metric"])}>
                <option value="missions">Missões concluídas</option>
                <option value="points">Pontos da temporada</option>
              </SelectInput>
            )}
          </Field>
          <Field label="Alvo" error={errors.target} hint={`De 1 a ${max.toLocaleString("pt-BR")}.`}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} describedBy={describedBy} invalid={invalid} type="number" min={1} max={max} value={form.target} disabled={busy} onChange={(event) => set("target", event.target.value)} />
            )}
          </Field>
        </div>
        {changed ? <ConfigChangedNotice onReload={() => void reloadData()} busy={reloadingData} /> : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <p className="m-0 text-[12.5px] text-fg/60">A alteração fica registrada em Logs e auditoria com o seu nome.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={changed}>
            {busy ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
