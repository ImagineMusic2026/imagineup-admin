"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { actionErrorMessage, errorDetails, isConfigChanged, mayHaveRunOnServer, reasonOf } from "@/lib/errors";
import {
  EMPTY_SEASON_FORM,
  SEASON_NAME_MAX,
  TOP_TARGET_MAX,
  fieldOfDetail,
  seasonFormOf,
  suggestSeasonId,
  validateSeason,
  type SeasonConfig,
  type SeasonDef,
  type SeasonErrors,
  type SeasonForm,
  type SeasonInput,
} from "@/lib/season";
import { scheduleNextSeason, updateSeason } from "@/lib/season-api";
import { getSeasonState } from "@/lib/season-data";

/** Qual temporada o diálogo mexe: a atual (`updateSeason`) ou a próxima (`scheduleNextSeason`). */
export type SeasonTarget = "current" | "next";

export interface SeasonDialogRequest {
  target: SeasonTarget;
  /** A temporada de agora, ou `null` para cadastrar. */
  season: SeasonDef | null;
  version: number;
  /** A atual já começou: o id fica travado. */
  idLocked: boolean;
}

/** O formulário de cada pedido; abrir de novo começa dele. */
function initialForm(request: SeasonDialogRequest | null): SeasonForm {
  return request?.season ? seasonFormOf(request.season) : EMPTY_SEASON_FORM;
}

export function SeasonDialog({
  request,
  onClose,
  onSaved,
}: {
  request: SeasonDialogRequest | null;
  onClose: () => void;
  /** Gravou: a tela lê o `config/season` de novo. */
  onSaved: (message: string) => void;
}) {
  return request ? <SeasonDialogBody key={`${request.target}:${request.season?.id ?? "nova"}:${request.version}`} request={request} onClose={onClose} onSaved={onSaved} /> : null;
}

function SeasonDialogBody({ request, onClose, onSaved }: { request: SeasonDialogRequest; onClose: () => void; onSaved: (message: string) => void }) {
  const mounted = useMountedRef();
  const [form, setForm] = useState<SeasonForm>(() => initialForm(request));
  const [version, setVersion] = useState(request.version);
  const [idLocked, setIdLocked] = useState(request.idLocked);
  const [errors, setErrors] = useState<SeasonErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const isNext = request.target === "next";
  const creating = !request.season;
  const title = isNext ? (creating ? "Agendar próxima temporada" : "Editar próxima temporada") : creating ? "Cadastrar temporada" : "Editar temporada";

  function set<K extends keyof SeasonForm>(field: K, value: SeasonForm[K]) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "name" && !current.idEdited && !idLocked) next.id = suggestSeasonId(String(value));
      if (field === "id") next.idEdited = true;
      return next;
    });
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  /** A configuração mudou por fora: lê de novo e refaz o formulário com ela. */
  async function reloadFromServer() {
    const { config } = await getSeasonState();
    if (!mounted.current) return;
    applyConfig(config);
  }

  function applyConfig(config: SeasonConfig) {
    const fresh = isNext ? config.next : config.season;
    setVersion(config.version);
    setForm(fresh ? seasonFormOf(fresh) : EMPTY_SEASON_FORM);
    setIdLocked(!isNext && Boolean(fresh && fresh.startsAt.getTime() <= Date.now()));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const checked = validateSeason(form);
    setErrors(checked.errors);
    if (!checked.input) return;
    const input: SeasonInput = checked.input;
    setBusy(true);
    setMessage(null);
    try {
      if (isNext) await scheduleNextSeason({ expectedVersion: version, next: input });
      else await updateSeason({ expectedVersion: version, season: input });
      if (!mounted.current) return;
      onSaved(isNext ? "Próxima temporada salva." : creating ? "Temporada cadastrada." : "Temporada salva.");
    } catch (failure) {
      if (!mounted.current) return;
      if (isConfigChanged(failure)) {
        await reloadFromServer().catch(() => undefined);
        setMessage({ tone: "info", text: "A temporada mudou enquanto você editava. Os dados novos já estão no formulário; confira e salve de novo." });
      } else if (reasonOf(failure) === "invalid-request" && fieldOfDetail(errorDetails(failure).field)) {
        const field = fieldOfDetail(errorDetails(failure).field);
        if (field) setErrors((current) => ({ ...current, [field]: actionErrorMessage(failure) }));
      } else {
        setMessage({ tone: "error", text: actionErrorMessage(failure) });
        if (mayHaveRunOnServer(failure)) await reloadFromServer().catch(() => undefined);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} busy={busy} size="md" title={title} description="Datas e horas de São Paulo.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" error={errors.name} hint={`Até ${SEASON_NAME_MAX} caracteres.`}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.name} maxLength={SEASON_NAME_MAX} disabled={busy} onChange={(event) => set("name", event.target.value)} />
            )}
          </Field>
          <Field label="Identificador" error={errors.id} hint={idLocked ? "Não muda depois que a temporada começa." : "Sugerido pelo nome. Não muda depois que a temporada começa."}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={form.id}
                readOnly={idLocked}
                disabled={busy}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => set("id", event.target.value.toLowerCase())}
              />
            )}
          </Field>
          <Field label="Início" error={errors.startsAt}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} describedBy={describedBy} invalid={invalid} type="datetime-local" value={form.startsAt} disabled={busy} onChange={(event) => set("startsAt", event.target.value)} />
            )}
          </Field>
          <Field label="Fim" error={errors.endsAt}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} describedBy={describedBy} invalid={invalid} type="datetime-local" value={form.endsAt} disabled={busy} onChange={(event) => set("endsAt", event.target.value)} />
            )}
          </Field>
          <Field label="Título do 1º lugar" optional error={errors.leaderTitle}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.leaderTitle} maxLength={SEASON_NAME_MAX} disabled={busy} onChange={(event) => set("leaderTitle", event.target.value)} />
            )}
          </Field>
          <Field label="Tamanho do top" error={errors.topTarget} hint={`De 1 a ${TOP_TARGET_MAX}. O app mostra ao fã quanto falta para o top.`}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} describedBy={describedBy} invalid={invalid} type="number" min={1} max={TOP_TARGET_MAX} value={form.topTarget} disabled={busy} onChange={(event) => set("topTarget", event.target.value)} />
            )}
          </Field>
        </div>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <p className="m-0 text-[12.5px] text-fg/60">A alteração fica registrada em Logs e auditoria com o seu nome.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {busy ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
