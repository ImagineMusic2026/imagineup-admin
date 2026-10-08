"use client";

import { Film } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, TextArea } from "@/components/ui/field";
import { ImageField, type ImageValue } from "@/components/ui/image-field";
import { Notice } from "@/components/ui/notice";
import { useLoad } from "@/components/ui/use-load";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import type { ArtistName } from "@/lib/artist-names-data";
import { callableErrorMessage, mayHaveRunOnServer, storageErrorMessage } from "@/lib/errors";
import { eventWhenText, type AgendaEvent } from "@/lib/events";
import { ImageError, type ProcessedImage } from "@/lib/image-prep";
import { createPost, setPostStatus, updatePost, type PostMediaInput } from "@/lib/post-api";
import { getArtistEventChoices, newPostId } from "@/lib/post-data";
import { captureVideoFrame, preparePostImage, uploadPostImage, uploadPostVideo } from "@/lib/post-media";
import {
  EVENT_DRAFT_WARNING,
  POST_KINDS,
  POST_KIND_LABELS,
  POST_TEXT_MAX,
  needsMedia,
  postFormOf,
  textCounter,
  fileSizeText,
  uncertainCreateText,
  validatePost,
  videoFileProblem,
  type Post,
  type PostErrors,
  type PostForm,
  type PostKind,
} from "@/lib/posts";

export interface PostDialogRequest {
  /** O post, ou `null` para criar. */
  post: Post | null;
  /** A central já escolhida no filtro (só ao criar). */
  artistId: string;
}

type Step = "create" | "upload" | "update" | "publish";
const STEP_LABELS: Record<Step, string> = { create: "Criando o rascunho...", upload: "Enviando a mídia...", update: "Salvando...", publish: "Publicando..." };

type VideoValue = { kind: "none" } | { kind: "current"; size: number } | { kind: "new"; file: File };

export function PostDialog({
  request,
  artists,
  events,
  now,
  onClose,
  onSaved,
}: {
  request: PostDialogRequest | null;
  artists: ArtistName[];
  events: ReadonlyMap<string, AgendaEvent | null> | null;
  now: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return request ? <PostDialogBody key={request.post?.id ?? "novo"} request={request} artists={artists} events={events} now={now} onClose={onClose} onSaved={onSaved} /> : null;
}

/** O post como o servidor gravou no `createPost`. */
function draftOf(id: string, form: PostForm, text: string): Post {
  return {
    id,
    artistId: form.artistId,
    kind: form.kind,
    text,
    media: null,
    eventId: form.kind === "event" ? form.eventId : null,
    status: "draft",
    publishedAt: null,
    createdAt: null,
    likeCount: 0,
    commentCount: 0,
  };
}

function PostDialogBody({
  request,
  artists,
  events,
  now,
  onClose,
  onSaved,
}: {
  request: PostDialogRequest;
  artists: ArtistName[];
  events: ReadonlyMap<string, AgendaEvent | null> | null;
  now: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const mounted = useMountedRef();
  const editing = Boolean(request.post);
  const [postId] = useState(() => request.post?.id ?? newPostId());
  const [form, setForm] = useState<PostForm>(() => (request.post ? postFormOf(request.post) : { artistId: request.artistId, kind: "photo", text: "", eventId: "" }));
  const [errors, setErrors] = useState<PostErrors>({});
  const [image, setImage] = useState<ImageValue>(() => (request.post?.media?.photo ? { kind: "current", url: request.post.media.photo.url } : { kind: "none" }));
  const [video, setVideo] = useState<VideoValue>(() => (request.post?.media?.video ? { kind: "current", size: request.post.media.video.size } : { kind: "none" }));
  const [processing, setProcessing] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [locked, setLocked] = useState(editing);
  const [wrote, setWrote] = useState(false);
  const imageButton = useRef<HTMLButtonElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const preview = useRef<string | null>(null);
  const server = useRef<{
    post: Post | null;
    uploadedImage: { source: ProcessedImage; photoPath: string; thumbPath: string } | null;
    uploadedVideo: { file: File; path: string } | null;
    savedImage: ProcessedImage | null;
    savedVideo: File | null;
  }>({ post: request.post, uploadedImage: null, uploadedVideo: null, savedImage: null, savedVideo: null });

  useEffect(
    () => () => {
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    [],
  );

  const busy = step !== null;
  const status = request.post?.status ?? "draft";

  function set<K extends keyof PostForm>(field: K, value: PostForm[K]) {
    setForm((current) => ({ ...current, [field]: value, ...(field === "artistId" ? { eventId: "" } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function showImage(processed: ProcessedImage) {
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = URL.createObjectURL(processed.large.blob);
    setImage({ kind: "new", processed, previewUrl: preview.current });
    setErrors((current) => ({ ...current, media: undefined }));
  }

  async function chooseImage(file: File) {
    setImageError(null);
    setProcessing(true);
    try {
      const processed = await preparePostImage(file);
      if (mounted.current) showImage(processed);
    } catch (failure) {
      if (mounted.current) setImageError(failure instanceof ImageError ? failure.message : "Não foi possível abrir a imagem. Tente outra.");
    } finally {
      if (mounted.current) setProcessing(false);
    }
  }

  function chooseVideo(file: File) {
    const problem = videoFileProblem(file);
    setVideoError(problem);
    if (problem) return;
    setVideo({ kind: "new", file });
  }

  async function captureCover() {
    if (video.kind !== "new") return;
    setImageError(null);
    setProcessing(true);
    try {
      const processed = await captureVideoFrame(video.file);
      if (mounted.current) showImage(processed);
    } catch (failure) {
      if (mounted.current) setImageError(failure instanceof ImageError ? failure.message : "Não deu para tirar a capa do vídeo. Envie uma imagem.");
    } finally {
      if (mounted.current) setProcessing(false);
    }
  }

  function close() {
    if (busy) return;
    if (wrote) onSaved(editing ? "Parte das mudanças foi salva. Confira o post." : "O post ficou como rascunho. Confira na lista.");
    else onClose();
  }

  async function submit(intent: "save" | "publish") {
    if (busy || processing) return;
    const checked = validatePost(form);
    const nextErrors: PostErrors = { ...checked.errors };
    if (intent === "publish" && needsMedia(form.kind) && image.kind === "none") nextErrors.media = form.kind === "video" ? "Envie a capa do vídeo antes de publicar." : "Envie a foto antes de publicar.";
    setErrors(nextErrors);
    if (checked.text === null || Object.keys(nextErrors).length > 0) return;
    const text = checked.text;
    setMessage(null);
    let wroteNow = false;
    const createdHere = !editing;
    const fail = (value: string) => {
      if (!mounted.current) return;
      setMessage(value);
      setStep(null);
      setProgress(null);
      if (wroteNow) setWrote(true);
    };

    // 1. O rascunho, com o id do painel.
    if (!server.current.post) {
      setStep("create");
      try {
        await createPost({ postId, artistId: form.artistId, kind: form.kind, text, eventId: form.kind === "event" ? form.eventId : null });
      } catch (failure) {
        fail(mayHaveRunOnServer(failure) ? uncertainCreateText("o post") : `O post não foi criado. ${callableErrorMessage(failure)}`);
        return;
      }
      server.current.post = draftOf(postId, form, text);
      wroteNow = true;
      if (mounted.current) setLocked(true);
    }
    const base = server.current.post!;

    // 2. A mídia nova (uma vez só, mesmo com novas tentativas).
    let media: PostMediaInput | null | undefined;
    if (needsMedia(form.kind)) {
      const newImage = image.kind === "new" && server.current.savedImage !== image.processed;
      const newVideo = form.kind === "video" && video.kind === "new" && server.current.savedVideo !== video.file;
      const dropVideo = form.kind === "video" && video.kind === "none" && Boolean(base.media?.video);
      if (newImage || newVideo || dropVideo) {
        setStep("upload");
        let photoPath = base.media?.photo?.path ?? null;
        let thumbPath = base.media?.thumb?.path ?? null;
        try {
          if (image.kind === "new") {
            const uploaded = server.current.uploadedImage?.source === image.processed ? server.current.uploadedImage : null;
            const paths = uploaded ?? { source: image.processed, ...(await uploadPostImage(postId, image.processed)) };
            server.current.uploadedImage = paths;
            photoPath = paths.photoPath;
            thumbPath = paths.thumbPath;
          }
          let videoPath: string | null | undefined;
          if (video.kind === "new") {
            if (server.current.uploadedVideo?.file === video.file) videoPath = server.current.uploadedVideo.path;
            else {
              setProgress(0);
              videoPath = await uploadPostVideo(postId, video.file, (fraction) => mounted.current && setProgress(fraction));
              server.current.uploadedVideo = { file: video.file, path: videoPath };
            }
          } else if (dropVideo) {
            videoPath = null;
          }
          if (!photoPath || !thumbPath) {
            fail(createdHere ? "O post ficou como rascunho. Falta enviar a capa do vídeo." : "Envie a capa do vídeo para salvar o vídeo.");
            return;
          }
          media = { photoPath, thumbPath, ...(videoPath !== undefined ? { videoPath } : {}) };
        } catch (failure) {
          fail(createdHere ? `O post ficou como rascunho. Falta enviar a mídia. ${storageErrorMessage(failure)}` : `A mídia não subiu e nada foi salvo. ${storageErrorMessage(failure)}`);
          return;
        }
      } else if (image.kind === "none" && base.media) {
        media = null;
      }
    }

    // 3. O texto, o show e a mídia numa chamada só.
    const changes: { text?: string; eventId?: string | null } = {};
    if (text !== base.text) changes.text = text;
    if (form.kind === "event" && form.eventId !== (base.eventId ?? "")) changes.eventId = form.eventId;
    if (Object.keys(changes).length > 0 || media !== undefined) {
      setStep("update");
      try {
        await updatePost({ postId, ...changes, ...(media !== undefined ? { media } : {}) });
      } catch (failure) {
        fail(createdHere ? `O post ficou como rascunho. Falta gravar a mídia. ${callableErrorMessage(failure)}` : `Não foi possível salvar. ${callableErrorMessage(failure)}`);
        return;
      }
      wroteNow = true;
      const nextMedia =
        media === undefined
          ? base.media
          : media === null
            ? null
            : {
                photo: { url: "", path: media.photoPath, width: 0, height: 0 },
                thumb: { url: "", path: media.thumbPath, width: 0, height: 0 },
                video: media.videoPath ? { url: "", path: media.videoPath, size: 0 } : media.videoPath === null ? null : (base.media?.video ?? null),
              };
      server.current.post = { ...base, ...changes, text, media: nextMedia };
      if (image.kind === "new") server.current.savedImage = image.processed;
      if (video.kind === "new") server.current.savedVideo = video.file;
    }

    // 4. Publicar.
    if (intent === "publish") {
      setStep("publish");
      try {
        await setPostStatus(postId, "published");
      } catch (failure) {
        fail(`O post está salvo como rascunho, mas não foi publicado. ${callableErrorMessage(failure)}`);
        return;
      }
      wroteNow = true;
    }

    if (!mounted.current) return;
    setStep(null);
    setProgress(null);
    if (createdHere) onSaved(intent === "publish" ? "Post criado e publicado." : "Post criado como rascunho.");
    else if (intent === "publish") onSaved("Post publicado.");
    else if (wroteNow) onSaved("Alterações no post salvas.");
    else onClose();
  }

  const artistOptions = [...artists].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const currentEvent = request.post?.eventId ? (events?.get(request.post.eventId) ?? null) : null;

  return (
    <Dialog open size="xl" busy={busy} onClose={close} title={editing ? "Editar post" : "Novo post"} description={editing ? undefined : "Nasce como rascunho: o app só mostra depois de publicar."}>
      <form
        noValidate
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void submit("save");
        }}
        className="flex flex-col gap-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Central" error={errors.artistId} hint={locked ? "Não muda depois de criado." : undefined}>
            {({ id, describedBy, invalid }) => (
              <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.artistId} disabled={busy || locked} onChange={(event) => set("artistId", event.target.value)}>
                <option value="">Escolha a central</option>
                {artistOptions.map((artist) => (
                  <option key={artist.id} value={artist.id}>
                    {artist.name}
                    {artist.status === "published" ? "" : " · fora do ar"}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="Tipo" hint={locked ? "Não muda depois de criado." : undefined}>
            {({ id, describedBy }) => (
              <SelectInput id={id} describedBy={describedBy} value={form.kind} disabled={busy || locked} onChange={(event) => set("kind", event.target.value as PostKind)}>
                {POST_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {POST_KIND_LABELS[kind]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </div>

        <Field label="Texto" optional={needsMedia(form.kind)} error={errors.text} hint={`${textCounter(form.text)} caracteres. Linhas vazias seguidas viram uma.`}>
          {({ id, describedBy, invalid }) => (
            <TextArea id={id} describedBy={describedBy} invalid={invalid} rows={4} value={form.text} maxLength={POST_TEXT_MAX + 200} disabled={busy} onChange={(event) => set("text", event.target.value)} />
          )}
        </Field>

        {form.kind === "event" && form.artistId ? (
          <EventChoice key={form.artistId} artistId={form.artistId} value={form.eventId} current={currentEvent} error={errors.eventId} disabled={busy} now={now} onChange={(eventId) => set("eventId", eventId)} />
        ) : null}

        {needsMedia(form.kind) ? (
          <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
            <ImageField
              label={form.kind === "video" ? "Capa" : "Foto"}
              aspect="4 / 5"
              hint="Na proporção dela, de 4:5 a 16:9, até 1080 de largura, com a miniatura. JPG, PNG ou WebP. HEIC não vale."
              value={image}
              processing={processing}
              error={imageError ?? errors.media ?? null}
              alt={form.kind === "video" ? "Capa do vídeo" : "Foto do post"}
              canRemove={status !== "published"}
              disabled={busy}
              onFile={(file) => void chooseImage(file)}
              onRemove={() => setImage({ kind: "none" })}
              buttonRef={imageButton}
              previewWidth={260}
            />
            {form.kind === "video" ? (
              <div className="flex flex-col gap-3">
                <p className="m-0 text-[13px] font-semibold text-fg/85">Vídeo</p>
                <p className="m-0 flex items-center gap-2 text-[13.5px] text-fg/80">
                  <Film aria-hidden="true" className="size-4 text-fg/60" />
                  {video.kind === "new"
                    ? `${video.file.name}, ${fileSizeText(video.file.size)}, enviado ao salvar.`
                    : video.kind === "current"
                      ? `Vídeo enviado${video.size ? `, ${fileSizeText(video.size)}` : ""}. Trocar só a capa mantém o vídeo.`
                      : "Sem vídeo. O post de vídeo pode sair só com a capa."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => videoInput.current?.click()}>
                    {video.kind === "none" ? "Escolher vídeo" : "Trocar vídeo"}
                  </Button>
                  {video.kind === "new" ? (
                    <Button size="sm" variant="secondary" disabled={busy || processing} onClick={() => void captureCover()}>
                      Tirar a capa do vídeo
                    </Button>
                  ) : null}
                  {video.kind !== "none" ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setVideo({ kind: "none" })}>
                      Tirar o vídeo
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={videoInput}
                  type="file"
                  accept="video/mp4,.mp4"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) chooseVideo(file);
                  }}
                />
                <p className="m-0 text-[12.5px] text-fg/60">MP4 até 50 MB. MOV não vale: exporte em MP4.</p>
                {videoError ? (
                  <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
                    {videoError}
                  </p>
                ) : null}
                {progress !== null ? (
                  <div className="flex flex-col gap-1.5">
                    <div role="progressbar" aria-label="Envio do vídeo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-2 w-full overflow-hidden rounded-full bg-fg/[0.08]">
                      <div className="h-full rounded-full bg-cyan" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                    <p aria-live="polite" className="m-0 text-[12.5px] text-fg/70 tabular-nums">
                      {Math.round(progress * 100)}% do vídeo enviado
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

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
              Salvar e publicar
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

/** O show do post: só os da central, de hoje em diante (o de agora entra mesmo fora da lista). */
function EventChoice({
  artistId,
  value,
  current,
  error,
  disabled,
  now,
  onChange,
}: {
  artistId: string;
  value: string;
  current: AgendaEvent | null;
  error?: string;
  disabled: boolean;
  now: number;
  onChange: (eventId: string) => void;
}) {
  const choices = useLoad(useCallback(() => getArtistEventChoices(artistId, now), [artistId, now]));
  const list = choices.state.status === "ready" ? choices.state.data : [];
  const options = current && !list.some((event) => event.id === current.id) ? [current, ...list] : list;
  const chosen = options.find((event) => event.id === value) ?? null;
  const date = new Date(now);
  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Show"
        error={error ?? (choices.state.status === "error" ? choices.state.message : undefined)}
        hint={choices.state.status === "loading" ? "Carregando os shows..." : options.length === 0 ? "Nenhum show desta central de hoje em diante." : "Só os shows desta central."}
      >
        {({ id, describedBy, invalid }) => (
          <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={value} disabled={disabled || options.length === 0} onChange={(event) => onChange(event.target.value)}>
            <option value="">Escolha o show</option>
            {options.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} · {eventWhenText(event, date)}
                {event.status === "published" ? "" : " · fora do ar"}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      {chosen && chosen.status !== "published" ? <Notice tone="info">{EVENT_DRAFT_WARNING}</Notice> : null}
    </div>
  );
}
