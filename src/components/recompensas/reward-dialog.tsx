"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, SelectInput, Switch, TextArea, TextInput } from "@/components/ui/field";
import { ImageField, type ImageValue } from "@/components/ui/image-field";
import { Notice } from "@/components/ui/notice";
import { useLoad } from "@/components/ui/use-load";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { callableErrorMessage, errorDetails, mayHaveRunOnServer, reasonOf, storageErrorMessage } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { ImageError, processImage, type ProcessedImage } from "@/lib/image-prep";
import { uploadImage } from "@/lib/media-storage";
import { createReward, setRewardStatus, updateReward } from "@/lib/reward-api";
import { getEventChoices, newRewardId } from "@/lib/reward-data";
import {
  CLOSED_EVENT_WARNING,
  COST_MAX,
  DESCRIPTION_MAX,
  EMPTY_REWARD_FORM,
  INSTRUCTIONS_MAX,
  KIND_LABELS,
  PER_FAN_LIMIT_MAX,
  REWARD_KINDS,
  REWARD_PHOTO,
  STOCK_MAX,
  SUBTITLE_MAX,
  TITLE_MAX,
  isEventOpen,
  rewardChanges,
  rewardFieldOf,
  rewardFormOf,
  stockText,
  validateReward,
  type EventInfo,
  type Reward,
  type RewardErrors,
  type RewardForm,
  type RewardInput,
  type RewardKind,
} from "@/lib/rewards";

const PHOTO_SPEC = { aspect: REWARD_PHOTO.width / REWARD_PHOTO.height, large: REWARD_PHOTO.width };

type Intent = "save" | "publish";
type Step = "create" | "upload" | "update" | "publish";

const STEP_LABELS: Record<Step, string> = {
  create: "Criando o rascunho...",
  upload: "Enviando a foto...",
  update: "Salvando...",
  publish: "Publicando...",
};

export interface RewardDialogRequest {
  /** A recompensa do catálogo, ou `null` para criar. */
  reward: Reward | null;
}

export function RewardDialog({
  request,
  events,
  now,
  onClose,
  onSaved,
}: {
  request: RewardDialogRequest | null;
  /** Os shows já lidos pelo catálogo (o show de agora entra mesmo fora da lista de escolha). */
  events: ReadonlyMap<string, EventInfo | null> | null;
  now: number;
  onClose: () => void;
  /** Algo foi gravado (mesmo com um passo falhando depois): a lista lê de novo. */
  onSaved: (message: string) => void;
}) {
  return request ? <RewardDialogBody key={request.reward?.id ?? "nova"} request={request} events={events} now={now} onClose={onClose} onSaved={onSaved} /> : null;
}

/** A recompensa como o servidor gravou no `createReward` (para comparar as mudanças seguintes). */
function draftOf(id: string, input: RewardInput): Reward {
  return { id, ...input, photo: null, redeemedCount: 0, status: "draft", order: 0, publishedAt: null };
}

function RewardDialogBody({
  request,
  events,
  now,
  onClose,
  onSaved,
}: {
  request: RewardDialogRequest;
  events: ReadonlyMap<string, EventInfo | null> | null;
  now: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const mounted = useMountedRef();
  const editing = Boolean(request.reward);
  const [rewardId] = useState(() => request.reward?.id ?? newRewardId());
  const [form, setForm] = useState<RewardForm>(() => (request.reward ? rewardFormOf(request.reward) : EMPTY_REWARD_FORM));
  const [errors, setErrors] = useState<RewardErrors>({});
  const [photo, setPhoto] = useState<ImageValue>(() => (request.reward?.photo ? { kind: "current", url: request.reward.photo.url } : { kind: "none" }));
  const [processing, setProcessing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [wroteSomething, setWroteSomething] = useState(false);
  const photoButton = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const previewUrl = useRef<string | null>(null);
  /** O que o servidor tem agora (a base das mudanças), a foto enviada e a última foto gravada. */
  const server = useRef<{ reward: Reward | null; uploaded: { source: ProcessedImage; path: string } | null; savedSource: ProcessedImage | null }>({
    reward: request.reward,
    uploaded: null,
    savedSource: null,
  });

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  const choices = useLoad(useCallback(() => getEventChoices(now), [now]));
  const eventChoices = choices.state.status === "ready" ? choices.state.data : [];
  const currentEvent = request.reward?.eventId ? (events?.get(request.reward.eventId) ?? null) : null;
  const eventOptions = currentEvent && !eventChoices.some((event) => event.id === currentEvent.id) ? [currentEvent, ...eventChoices] : eventChoices;
  const chosenEvent = form.eventId ? (eventOptions.find((event) => event.id === form.eventId) ?? null) : null;
  const status = request.reward?.status ?? "draft";
  const busy = step !== null;
  const date = new Date(now);

  function set<K extends keyof RewardForm>(field: K, value: RewardForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function choosePhoto(file: File) {
    setPhotoError(null);
    setProcessing(true);
    try {
      const processed = await processImage(file, PHOTO_SPEC);
      if (!mounted.current) return;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(processed.large.blob);
      setPhoto({ kind: "new", processed, previewUrl: previewUrl.current });
    } catch (failure) {
      if (mounted.current) setPhotoError(failure instanceof ImageError ? failure.message : "Não foi possível abrir a imagem. Tente outra.");
    } finally {
      if (mounted.current) setProcessing(false);
    }
  }

  function close() {
    if (busy) return;
    if (wroteSomething) onSaved(editing ? "Parte das mudanças foi salva. Confira a recompensa." : "A recompensa ficou salva como rascunho. Confira na lista.");
    else onClose();
  }

  async function submit(intent: Intent) {
    if (busy || processing) return;
    const checked = validateReward(form);
    setErrors(checked.errors);
    if (!checked.input) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const input = checked.input;
    setMessage(null);
    let wrote = false;
    const createdHere = !editing;
    const prefix = createdHere ? "A recompensa foi criada como rascunho, mas" : null;
    const fail = (text: string) => {
      if (!mounted.current) return;
      setMessage(text);
      setStep(null);
      if (wrote) setWroteSomething(true);
    };

    // 1. O rascunho, com o id do painel (a nova tentativa com o mesmo id não cria outro).
    if (!server.current.reward) {
      setStep("create");
      try {
        await createReward({ rewardId, ...input });
      } catch (failure) {
        const field = reasonOf(failure) === "invalid-request" ? rewardFieldOf(errorDetails(failure).field) : null;
        if (field) setErrors((current) => ({ ...current, [field]: callableErrorMessage(failure) }));
        fail(mayHaveRunOnServer(failure) ? "Não deu para confirmar se a recompensa foi criada. Salve de novo: a nova tentativa não cria outra." : `A recompensa não foi criada. ${callableErrorMessage(failure)}`);
        return;
      }
      server.current.reward = draftOf(rewardId, input);
      wrote = true;
    }

    // 2. A foto nova, uma vez só (mesmo com novas tentativas).
    let photoChange: { photoPath: string } | null | undefined;
    if (photo.kind === "new" && server.current.savedSource !== photo.processed) {
      let path = server.current.uploaded?.source === photo.processed ? server.current.uploaded.path : null;
      if (!path) {
        setStep("upload");
        try {
          path = (await uploadImage(`rewards/${rewardId}`, photo.processed)).path;
        } catch (failure) {
          const text = storageErrorMessage(failure);
          fail(prefix ? `${prefix} a foto não subiu. ${text}` : `A foto não subiu e nada foi salvo. ${text}`);
          return;
        }
        server.current.uploaded = { source: photo.processed, path };
      }
      photoChange = { photoPath: path };
    } else if (photo.kind === "none" && server.current.reward?.photo) {
      photoChange = null;
    }

    // 3. Só o que mudou, e a foto.
    const base = server.current.reward!;
    const changes = rewardChanges(base, input);
    if (Object.keys(changes).length > 0 || photoChange !== undefined) {
      setStep("update");
      try {
        await updateReward({ rewardId, ...changes, ...(photoChange !== undefined ? { photo: photoChange } : {}) });
      } catch (failure) {
        const field = reasonOf(failure) === "invalid-request" ? rewardFieldOf(errorDetails(failure).field) : null;
        if (field) setErrors((current) => ({ ...current, [field]: callableErrorMessage(failure) }));
        const what = photoChange !== undefined && Object.keys(changes).length === 0 ? "a foto não foi salva" : "as mudanças não foram salvas";
        fail(prefix ? `${prefix} ${what}. ${callableErrorMessage(failure)}` : `Não foi possível salvar. ${callableErrorMessage(failure)}`);
        return;
      }
      wrote = true;
      server.current.reward = { ...base, ...changes, photo: photoChange === undefined ? base.photo : photoChange ? { url: "", path: photoChange.photoPath, width: REWARD_PHOTO.width, height: REWARD_PHOTO.height } : null };
      if (photo.kind === "new") server.current.savedSource = photo.processed;
    }

    // 4. Publicar (ou reabrir).
    if (intent === "publish") {
      setStep("publish");
      try {
        await setRewardStatus(rewardId, "published");
      } catch (failure) {
        const text = callableErrorMessage(failure);
        fail(
          createdHere
            ? `A recompensa foi criada e está salva como rascunho, mas não foi publicada. ${text}`
            : wrote
              ? `As mudanças foram salvas, mas a recompensa não foi publicada. ${text}`
              : `A recompensa não foi publicada. ${text}`,
        );
        return;
      }
      wrote = true;
    }

    if (!mounted.current) return;
    setStep(null);
    const title = input.title;
    if (createdHere) onSaved(intent === "publish" ? `Recompensa ${title} criada e publicada.` : `Recompensa ${title} criada como rascunho.`);
    else if (intent === "publish") onSaved(`Recompensa ${title} publicada.`);
    else if (wrote) onSaved(`Alterações em ${title} salvas.`);
    else onClose();
  }

  const showPublish = !editing || status === "draft";
  // Trocar o show de uma recompensa no ar por um fechado: o servidor aceita, e ela fica esgotada para todos.
  const closedWarning = status === "published" && Boolean(form.eventId) && !isEventOpen(chosenEvent, now);

  return (
    <Dialog
      open
      size="xl"
      busy={busy}
      onClose={close}
      title={editing ? `Editar ${request.reward?.title}` : "Nova recompensa"}
      description={editing ? undefined : "Nasce como rascunho: o app só mostra depois de publicar."}
    >
      <form
        ref={formRef}
        noValidate
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void submit("save");
        }}
        className="flex flex-col gap-5"
      >
        <div className="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)]">
          <ImageField
            label="Foto"
            aspect={`${REWARD_PHOTO.width} / ${REWARD_PHOTO.height}`}
            hint="Paisagem, recortada no centro em 1200 por 643. JPG, PNG ou WebP."
            value={photo}
            processing={processing}
            error={photoError}
            alt={form.title ? `Foto de ${form.title}` : "Foto da recompensa"}
            canRemove
            disabled={busy}
            onFile={(file) => void choosePhoto(file)}
            onRemove={() => setPhoto({ kind: "none" })}
            buttonRef={photoButton}
            previewWidth={300}
          />
          <div className="grid content-start gap-4 sm:grid-cols-2">
            <Field label="Tipo" error={errors.kind}>
              {({ id, describedBy, invalid }) => (
                <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.kind} disabled={busy} onChange={(event) => set("kind", event.target.value as RewardKind)}>
                  {REWARD_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="Custo" error={errors.cost} hint={`De 1 a ${COST_MAX.toLocaleString("pt-BR")} pontos do saldo.`}>
              {({ id, describedBy, invalid }) => (
                <TextInput id={id} describedBy={describedBy} invalid={invalid} type="number" min={1} max={COST_MAX} value={form.cost} disabled={busy} onChange={(event) => set("cost", event.target.value)} />
              )}
            </Field>
            <Field label="Título" error={errors.title} hint={`Até ${TITLE_MAX} caracteres.`}>
              {({ id, describedBy, invalid }) => (
                <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.title} maxLength={TITLE_MAX} disabled={busy} onChange={(event) => set("title", event.target.value)} />
              )}
            </Field>
            <Field label="Subtítulo" error={errors.subtitle} hint={`Até ${SUBTITLE_MAX} caracteres.`}>
              {({ id, describedBy, invalid }) => (
                <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.subtitle} maxLength={SUBTITLE_MAX} disabled={busy} onChange={(event) => set("subtitle", event.target.value)} />
              )}
            </Field>
          </div>
        </div>

        <Field label="Descrição" optional error={errors.description} hint={`Até ${DESCRIPTION_MAX.toLocaleString("pt-BR")} caracteres.`}>
          {({ id, describedBy, invalid }) => (
            <TextArea id={id} describedBy={describedBy} invalid={invalid} rows={3} value={form.description} maxLength={DESCRIPTION_MAX} disabled={busy} onChange={(event) => set("description", event.target.value)} />
          )}
        </Field>
        <Field label="Como retirar" error={errors.instructions} hint="O fã lê depois de resgatar: onde, quando e como a entrega acontece.">
          {({ id, describedBy, invalid }) => (
            <TextArea id={id} describedBy={describedBy} invalid={invalid} rows={3} value={form.instructions} maxLength={INSTRUCTIONS_MAX} disabled={busy} onChange={(event) => set("instructions", event.target.value)} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {editing && request.reward ? (
            <div className="flex flex-col gap-1">
              <p className="m-0 text-[13px] font-semibold text-fg/85">Estoque</p>
              <p className="m-0 text-sm text-fg/80">{stockText(request.reward)}</p>
              <p className="m-0 text-[12.5px] text-fg/60">Muda pelo Estoque, no menu da recompensa.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Field label="Estoque" error={errors.stockTotal} hint={form.stockLimited ? `De 0 a ${STOCK_MAX.toLocaleString("pt-BR")} vagas.` : "Sem limite de vagas."}>
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    type="number"
                    min={0}
                    max={STOCK_MAX}
                    value={form.stockLimited ? form.stockTotal : ""}
                    disabled={busy || !form.stockLimited}
                    onChange={(event) => set("stockTotal", event.target.value)}
                  />
                )}
              </Field>
              <Checkbox label="Sem limite" checked={!form.stockLimited} disabled={busy} onChange={(event) => set("stockLimited", !event.target.checked)} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Field label="Limite por fã" error={errors.perFanLimit} hint={form.perFanLimited ? `De 1 a ${PER_FAN_LIMIT_MAX} pedidos por fã.` : "Cada fã pede quantas vezes quiser."}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  type="number"
                  min={1}
                  max={PER_FAN_LIMIT_MAX}
                  value={form.perFanLimited ? form.perFanLimit : ""}
                  disabled={busy || !form.perFanLimited}
                  onChange={(event) => set("perFanLimit", event.target.value)}
                />
              )}
            </Field>
            <Checkbox label="Sem limite" checked={!form.perFanLimited} disabled={busy} onChange={(event) => set("perFanLimited", !event.target.checked)} />
          </div>
          <Field label="Show" optional error={errors.eventId} hint={choices.state.status === "error" ? choices.state.message : "Com show, a recompensa só vale enquanto ele não passou e está no ar."}>
            {({ id, describedBy, invalid }) => (
              <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.eventId} disabled={busy} onChange={(event) => set("eventId", event.target.value)}>
                <option value="">Sem show</option>
                {eventOptions.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                    {event.startsAt ? ` · ${formatDay(event.startsAt, date)}` : ""}
                    {event.status !== "published" ? " · fora do ar" : isEventOpen(event, now) ? "" : " · já passou"}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <div className="flex flex-col gap-4 pt-1">
            <Switch label="Destaque" description="Aparece em destaque na loja." checked={form.featured} disabled={busy} onChange={(checked) => set("featured", checked)} />
            <Switch label="Mostrar as vagas" description={`O selo "Só N vagas" no app, quando há estoque.`} checked={form.scarcity} disabled={busy} onChange={(checked) => set("scarcity", checked)} />
          </div>
        </div>

        {closedWarning ? <Notice tone="info">{CLOSED_EVENT_WARNING}</Notice> : null}
        {message ? <Notice tone="error">{message}</Notice> : null}
        <p role="status" className="m-0 text-[13px] text-fg/70 empty:hidden">
          {step ? STEP_LABELS[step] : ""}
        </p>
        <p className="m-0 text-[12.5px] text-fg/60">A alteração fica registrada em Logs e auditoria com o seu nome.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close} disabled={busy}>
            {wroteSomething ? "Fechar" : "Cancelar"}
          </Button>
          <Button type="submit" variant={showPublish ? "secondary" : "primary"} busy={busy && step !== "publish"} disabled={processing}>
            {editing ? "Salvar" : "Salvar rascunho"}
          </Button>
          {showPublish ? (
            <Button variant="primary" busy={step === "publish"} disabled={processing || busy} onClick={() => void submit("publish")}>
              {editing ? "Salvar e publicar" : "Criar e publicar"}
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
