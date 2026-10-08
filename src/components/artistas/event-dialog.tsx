"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, Switch, TextInput } from "@/components/ui/field";
import { ImageField, type ImageValue } from "@/components/ui/image-field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import type { ArtistName } from "@/lib/artist-names-data";
import { callableErrorMessage, mayHaveRunOnServer, storageErrorMessage } from "@/lib/errors";
import { uncertainCreateText } from "@/lib/posts";
import { createEvent, setEventStatus, updateEvent } from "@/lib/event-api";
import { newEventId } from "@/lib/event-data";
import {
  BRAZIL_STATES,
  BRAZIL_TIME_ZONES,
  DEFAULT_TIME_ZONE_BY_STATE,
  EMPTY_EVENT_FORM,
  EVENT_ARTISTS_MAX,
  EVENT_CITY_MAX,
  EVENT_PHOTO,
  EVENT_TITLE_MAX,
  EVENT_VENUE_MAX,
  TIME_ZONE_LABELS,
  eventChanges,
  eventFormOf,
  moveArtist,
  validateEvent,
  type AgendaEvent,
  type BrazilState,
  type BrazilTimeZone,
  type EventErrors,
  type EventForm,
  type EventInput,
} from "@/lib/events";
import { ImageError, processImage, type ProcessedImage } from "@/lib/image-prep";
import { uploadImage } from "@/lib/media-storage";

const PHOTO_SPEC = { aspect: EVENT_PHOTO.width / EVENT_PHOTO.height, large: EVENT_PHOTO.width };

type Step = "create" | "upload" | "update" | "publish";
const STEP_LABELS: Record<Step, string> = { create: "Criando o rascunho...", upload: "Enviando a foto...", update: "Salvando...", publish: "Publicando..." };

export interface EventDialogRequest {
  event: AgendaEvent | null;
  /** A central já escolhida no filtro (só ao criar). */
  artistId: string;
}

export function EventDialog({
  request,
  artists,
  onClose,
  onSaved,
}: {
  request: EventDialogRequest | null;
  artists: ArtistName[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return request ? <EventDialogBody key={request.event?.id ?? "novo"} request={request} artists={artists} onClose={onClose} onSaved={onSaved} /> : null;
}

function draftOf(id: string, input: EventInput): AgendaEvent {
  return { id, ...input, startsAt: null, photo: null, status: "draft", publishedAt: null };
}

function EventDialogBody({
  request,
  artists,
  onClose,
  onSaved,
}: {
  request: EventDialogRequest;
  artists: ArtistName[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const mounted = useMountedRef();
  const editing = Boolean(request.event);
  const [eventId] = useState(() => request.event?.id ?? newEventId());
  const [form, setForm] = useState<EventForm>(() => (request.event ? eventFormOf(request.event) : { ...EMPTY_EVENT_FORM, artistIds: request.artistId ? [request.artistId] : [] }));
  const [zoneTouched, setZoneTouched] = useState(editing);
  const [errors, setErrors] = useState<EventErrors>({});
  const [photo, setPhoto] = useState<ImageValue>(() => (request.event?.photo ? { kind: "current", url: request.event.photo.url } : { kind: "none" }));
  const [processing, setProcessing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [wrote, setWrote] = useState(false);
  const photoButton = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const preview = useRef<string | null>(null);
  const server = useRef<{ event: AgendaEvent | null; uploaded: { source: ProcessedImage; path: string } | null; saved: ProcessedImage | null }>({
    event: request.event,
    uploaded: null,
    saved: null,
  });

  useEffect(
    () => () => {
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    [],
  );

  const busy = step !== null;
  const status = request.event?.status ?? "draft";
  const names = new Map(artists.map((artist) => [artist.id, artist]));
  const remaining = [...artists].filter((artist) => !form.artistIds.includes(artist.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  function set<K extends keyof EventForm>(field: K, value: EventForm[K]) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "state" && !zoneTouched && value) next.timeZone = DEFAULT_TIME_ZONE_BY_STATE[value as BrazilState];
      return next;
    });
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function choosePhoto(file: File) {
    setPhotoError(null);
    setProcessing(true);
    try {
      const processed = await processImage(file, PHOTO_SPEC);
      if (!mounted.current) return;
      if (preview.current) URL.revokeObjectURL(preview.current);
      preview.current = URL.createObjectURL(processed.large.blob);
      setPhoto({ kind: "new", processed, previewUrl: preview.current });
    } catch (failure) {
      if (mounted.current) setPhotoError(failure instanceof ImageError ? failure.message : "Não foi possível abrir a imagem. Tente outra.");
    } finally {
      if (mounted.current) setProcessing(false);
    }
  }

  function close() {
    if (busy) return;
    if (wrote) onSaved(editing ? "Parte das mudanças foi salva. Confira o show." : "O show ficou como rascunho. Confira na lista.");
    else onClose();
  }

  async function submit(intent: "save" | "publish") {
    if (busy || processing) return;
    const moving = !editing || form.startsAtLocal !== request.event?.startsAtLocal || form.timeZone !== request.event?.timeZone;
    const checked = validateEvent(form, Date.now(), moving);
    setErrors(checked.errors);
    if (!checked.input) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const input = checked.input;
    setMessage(null);
    let wroteNow = false;
    const createdHere = !editing;
    const fail = (text: string) => {
      if (!mounted.current) return;
      setMessage(text);
      setStep(null);
      if (wroteNow) setWrote(true);
    };

    if (!server.current.event) {
      setStep("create");
      try {
        await createEvent({ eventId, ...input });
      } catch (failure) {
        fail(mayHaveRunOnServer(failure) ? uncertainCreateText("o show") : `O show não foi criado. ${callableErrorMessage(failure)}`);
        return;
      }
      server.current.event = draftOf(eventId, input);
      wroteNow = true;
    }
    const base = server.current.event!;

    let photoChange: { photoPath: string } | null | undefined;
    if (photo.kind === "new" && server.current.saved !== photo.processed) {
      let path = server.current.uploaded?.source === photo.processed ? server.current.uploaded.path : null;
      if (!path) {
        setStep("upload");
        try {
          path = (await uploadImage(`events/${eventId}`, photo.processed)).path;
        } catch (failure) {
          fail(createdHere ? `O show ficou como rascunho. Falta enviar a foto. ${storageErrorMessage(failure)}` : `A foto não subiu e nada foi salvo. ${storageErrorMessage(failure)}`);
          return;
        }
        server.current.uploaded = { source: photo.processed, path };
      }
      photoChange = { photoPath: path };
    } else if (photo.kind === "none" && base.photo) {
      photoChange = null;
    }

    const changes = eventChanges(base, input);
    if (Object.keys(changes).length > 0 || photoChange !== undefined) {
      setStep("update");
      try {
        await updateEvent({ eventId, ...changes, ...(photoChange !== undefined ? { photo: photoChange } : {}) });
      } catch (failure) {
        fail(createdHere ? `O show ficou como rascunho. Falta gravar a foto. ${callableErrorMessage(failure)}` : `Não foi possível salvar. ${callableErrorMessage(failure)}`);
        return;
      }
      wroteNow = true;
      server.current.event = { ...base, ...changes, photo: photoChange === undefined ? base.photo : photoChange ? { url: "", path: photoChange.photoPath } : null };
      if (photo.kind === "new") server.current.saved = photo.processed;
    }

    if (intent === "publish") {
      setStep("publish");
      try {
        await setEventStatus(eventId, "published");
      } catch (failure) {
        fail(`O show está salvo como rascunho, mas não foi publicado. ${callableErrorMessage(failure)}`);
        return;
      }
      wroteNow = true;
    }

    if (!mounted.current) return;
    setStep(null);
    if (createdHere) onSaved(intent === "publish" ? `Show ${input.title} criado e publicado.` : `Show ${input.title} criado como rascunho.`);
    else if (intent === "publish") onSaved(`Show ${input.title} publicado.`);
    else if (wroteNow) onSaved(`Alterações em ${input.title} salvas.`);
    else onClose();
  }

  return (
    <Dialog open size="xl" busy={busy} onClose={close} title={editing ? `Editar ${request.event?.title}` : "Novo show"} description="A data e a hora valem no fuso do show.">
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
            aspect={`${EVENT_PHOTO.width} / ${EVENT_PHOTO.height}`}
            hint="Paisagem 16:9, recortada no centro em 1200 por 675. Opcional."
            value={photo}
            processing={processing}
            error={photoError}
            alt={form.title ? `Foto de ${form.title}` : "Foto do show"}
            canRemove
            disabled={busy}
            onFile={(file) => void choosePhoto(file)}
            onRemove={() => setPhoto({ kind: "none" })}
            buttonRef={photoButton}
            previewWidth={300}
          />
          <div className="grid content-start gap-4 sm:grid-cols-2">
            <Field label="Título" error={errors.title} hint={`Até ${EVENT_TITLE_MAX} caracteres.`} className="sm:col-span-2">
              {({ id, describedBy, invalid }) => (
                <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.title} maxLength={EVENT_TITLE_MAX} disabled={busy} onChange={(event) => set("title", event.target.value)} />
              )}
            </Field>
            <Field label="Cidade" error={errors.city}>
              {({ id, describedBy, invalid }) => (
                <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.city} maxLength={EVENT_CITY_MAX} disabled={busy} onChange={(event) => set("city", event.target.value)} />
              )}
            </Field>
            <Field label="UF" error={errors.state}>
              {({ id, describedBy, invalid }) => (
                <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.state} disabled={busy} onChange={(event) => set("state", event.target.value as BrazilState)}>
                  <option value="">Escolha</option>
                  {BRAZIL_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="Dia e hora" error={errors.startsAtLocal} hint="Como no ingresso, no fuso do show.">
              {({ id, describedBy, invalid }) => (
                <TextInput id={id} describedBy={describedBy} invalid={invalid} type="datetime-local" value={form.startsAtLocal} disabled={busy} onChange={(event) => set("startsAtLocal", event.target.value)} />
              )}
            </Field>
            <Field label="Fuso" error={errors.timeZone} hint={zoneTouched ? undefined : "Sugerido pela UF."}>
              {({ id, describedBy, invalid }) => (
                <SelectInput
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={form.timeZone}
                  disabled={busy}
                  onChange={(event) => {
                    setZoneTouched(true);
                    set("timeZone", event.target.value as BrazilTimeZone);
                  }}
                >
                  <option value="">Escolha</option>
                  {BRAZIL_TIME_ZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {TIME_ZONE_LABELS[zone]}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="Local" optional error={errors.venue} hint={`Até ${EVENT_VENUE_MAX} caracteres.`} className="sm:col-span-2">
              {({ id, describedBy, invalid }) => (
                <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.venue} maxLength={EVENT_VENUE_MAX} disabled={busy} onChange={(event) => set("venue", event.target.value)} />
              )}
            </Field>
          </div>
        </div>

        <fieldset className="m-0 flex flex-col gap-3 rounded-xl border border-line p-4" aria-describedby={errors.artistIds ? "centrais-erro" : undefined}>
          <legend className="px-1 text-[13px] font-semibold text-fg/85">Centrais do show</legend>
          <p className="m-0 text-[12.5px] text-fg/60">De 1 a {EVENT_ARTISTS_MAX}, em ordem. A primeira é a principal.</p>
          {form.artistIds.length > 0 ? (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {form.artistIds.map((id, index) => {
                const name = names.get(id)?.name ?? id;
                return (
                  <li key={id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm text-fg">
                      {index + 1}. {name}
                      {index === 0 ? <span className="ml-2 text-[12px] text-fg/60">principal</span> : null}
                    </span>
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg text-fg/75 transition-colors hover:bg-fg/[0.06] hover:text-fg disabled:cursor-not-allowed disabled:opacity-35" disabled={busy || index === 0} aria-label={`Subir ${name}`} onClick={() => set("artistIds", moveArtist(form.artistIds, id, -1))}>
                      <ArrowUp aria-hidden="true" className="size-4" />
                    </button>
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg text-fg/75 transition-colors hover:bg-fg/[0.06] hover:text-fg disabled:cursor-not-allowed disabled:opacity-35" disabled={busy || index === form.artistIds.length - 1} aria-label={`Descer ${name}`} onClick={() => set("artistIds", moveArtist(form.artistIds, id, 1))}>
                      <ArrowDown aria-hidden="true" className="size-4" />
                    </button>
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg text-fg/75 transition-colors hover:bg-fg/[0.06] hover:text-fg disabled:cursor-not-allowed disabled:opacity-35" disabled={busy} aria-label={`Tirar ${name} do show`} onClick={() => set("artistIds", form.artistIds.filter((item) => item !== id))}>
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {form.artistIds.length < EVENT_ARTISTS_MAX ? (
            <Field label="Acrescentar central">
              {({ id, describedBy }) => (
                <SelectInput
                  id={id}
                  describedBy={describedBy}
                  value=""
                  disabled={busy || remaining.length === 0}
                  onChange={(event) => {
                    if (event.target.value) set("artistIds", [...form.artistIds, event.target.value]);
                  }}
                >
                  <option value="">Escolha a central</option>
                  {remaining.map((artist) => (
                    <option key={artist.id} value={artist.id}>
                      {artist.name}
                      {artist.status === "published" ? "" : " · fora do ar"}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          ) : null}
          {errors.artistIds ? (
            <p id="centrais-erro" className="m-0 text-[12.5px] font-medium text-danger">
              {errors.artistIds}
            </p>
          ) : null}
        </fieldset>

        <Switch label="Destaque" description="O show aparece em destaque na agenda do app." checked={form.featured} disabled={busy} onChange={(checked) => set("featured", checked)} />

        {message ? <Notice tone="error">{message}</Notice> : null}
        <p role="status" className="m-0 text-[13px] text-fg/70 empty:hidden">
          {step ? STEP_LABELS[step] : ""}
        </p>
        <p className="m-0 text-[12.5px] text-fg/60">A alteração fica registrada em Logs e auditoria com o seu nome.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close} disabled={busy}>
            {wrote ? "Fechar" : "Cancelar"}
          </Button>
          <Button type="submit" variant={status === "published" ? "primary" : "secondary"} busy={busy && step !== "publish"} disabled={processing}>
            {editing ? "Salvar" : "Salvar rascunho"}
          </Button>
          {status !== "published" ? (
            <Button variant="primary" busy={step === "publish"} disabled={processing || busy} onClick={() => void submit("publish")}>
              {editing ? "Salvar e publicar" : "Criar e publicar"}
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
