"use client";

import { RefreshCw } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ArtistStatusBadge } from "@/components/artistas/artist-bits";
import { PhotoField, type PhotoValue } from "@/components/artistas/photo-field";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, SelectInput, Switch, TextArea, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { checkArtistHandle, createArtist, setArtistStatus, updateArtist } from "@/lib/artist-api";
import { getArtist, getArtistPrivate } from "@/lib/artist-data";
import { PhotoError, processArtistPhoto, type ArtistPhotoPaths, type ProcessedPhoto } from "@/lib/artist-photo";
import { uploadArtistPhoto } from "@/lib/artist-storage";
import {
  ARTIST_FORM_FIELD_ORDER,
  ARTIST_LIMITS,
  GENRES,
  HANDLE_FORMAT_HINT,
  HANDLE_MAX_LENGTH,
  PRIVATE_FAILED_TEXT,
  PRIVATE_LOADING_TEXT,
  artistChanges,
  artistFormFromArtist,
  cleanHandleInput,
  createArtistInput,
  emptyArtistForm,
  formatFans,
  handleStatusFromCheck,
  handleStatusText,
  hasChanges,
  isAdoptableDraft,
  isAnnouncedHandleStatus,
  isGenre,
  liveHandleStatus,
  managerEmptyOptionText,
  missingForPublish,
  normalizeArtistForm,
  pickPrivateFields,
  publishBlockedText,
  shouldCheckHandle,
  suggestHandle,
  validateArtistForm,
  type ArtistEntry,
  type ArtistFormErrors,
  type ArtistFormField,
  type ArtistFormValues,
  type ArtistPrivate,
  type HandleStatus,
  type PrivateLoadState,
  type NormalizedArtistForm,
  type UpdateArtistInput,
} from "@/lib/artists";
import { callableErrorMessage, mayHaveRunOnServer, readError, storageErrorMessage } from "@/lib/errors";
import { isAdmin, type StaffMember } from "@/lib/staff";
import { getActiveTeam } from "@/lib/staff-data";

/**
 * Criar e editar são de quem edita a seção; ver (só leitura) é de quem só vê.
 * A central vem da lista em tempo real, com o privado junto quando já chegou.
 */
export type ArtistDialogRequest = { mode: "create" } | { mode: "edit"; artist: ArtistEntry } | { mode: "view"; artist: ArtistEntry };

export interface ArtistSaved {
  message: string;
  /** Este envio publicou a central (na edição, um rascunho saiu da lista de rascunhos). */
  published: boolean;
}

/** O rascunho existe no servidor, mesmo que um passo seguinte falhe. */
export interface DraftCreated {
  name: string;
  handle: string;
  /**
   * Falso quando a resposta do `createArtist` se perdeu (conexão, servidor
   * demorando): a central pode ter sido criada ou não.
   */
  certain: boolean;
}

/** Atraso da conferência do @ enquanto a pessoa digita. */
const HANDLE_CHECK_DELAY = 400;

/** Criar, editar ou ver uma central. Sem conta de artista: selo é marca, contato é só da equipe. */
export function ArtistDialog({
  request,
  member,
  onClose,
  onSaved,
  onDraftCreated,
}: {
  request: ArtistDialogRequest | null;
  member: StaffMember;
  onClose: () => void;
  onSaved: (saved: ArtistSaved) => void;
  onDraftCreated: (draft: DraftCreated) => void;
}) {
  const [busy, setBusy] = useState(false);
  const artist = request && request.mode !== "create" ? request.artist : null;
  const viewing = request?.mode === "view";

  function close() {
    setBusy(false);
    onClose();
  }

  return (
    <Dialog
      open={Boolean(request)}
      onClose={close}
      busy={busy}
      size="xl"
      title={viewing ? "Detalhes da central" : artist ? "Editar central" : "Criar central"}
      description={artist ? `${artist.name} · @${artist.handle}` : "A central só aparece no app depois que você publicar."}
    >
      {request && viewing && artist ? (
        <ArtistDetails artist={artist} onClose={close} />
      ) : request ? (
        <ArtistForm
          artist={artist}
          member={member}
          onBusyChange={setBusy}
          onCancel={close}
          onSaved={onSaved}
          onDraftCreated={onDraftCreated}
        />
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Privado da central (gestor, autorização e contato)
// ---------------------------------------------------------------------------

type PrivateState = PrivateLoadState;

/**
 * Privado da central (`artistPrivate/{id}`). Se a lista em tempo real já o
 * trouxe (`initial`), fica pronto sem ler; senão é lido uma vez, com
 * "Carregar de novo" na falha. Sem id (criar), não há o que ler. Documento
 * que não existe chega como `null`: nada marcado, nada preenchido.
 *
 * Se a leitura de novo der certo com o foco no "Carregar de novo", o botão
 * some: o foco vai para `focusAfterRetry` em vez de cair no body.
 */
function useArtistPrivate(
  artistId: string | null,
  initial: ArtistPrivate | null,
  onLoaded: (data: ArtistPrivate | null) => void,
  focusAfterRetry: () => void,
) {
  // Decidido ao abrir: a lista pode mudar depois, e o formulário não troca o que a pessoa já vê.
  const [needsRead] = useState(() => Boolean(artistId) && !initial);
  const [state, setState] = useState<PrivateState>(needsRead ? "loading" : "ready");
  const [attempt, setAttempt] = useState(0);
  const [refocus, setRefocus] = useState(0);
  const retryRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onLoaded, focusAfterRetry });
  useEffect(() => {
    callbacks.current = { onLoaded, focusAfterRetry };
  });

  useEffect(() => {
    if (!artistId || !needsRead) return;
    let active = true;
    getArtistPrivate(artistId).then(
      (data) => {
        if (!active) return;
        if (retryRef.current && document.activeElement === retryRef.current) setRefocus((value) => value + 1);
        callbacks.current.onLoaded(data);
        setState("ready");
      },
      () => {
        if (active) setState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [artistId, needsRead, attempt]);

  useEffect(() => {
    if (refocus) callbacks.current.focusAfterRetry();
  }, [refocus]);

  function retry() {
    setState("loading");
    setAttempt((value) => value + 1);
  }

  return { state, retried: attempt > 0, retry, retryRef };
}

/**
 * Linha de ajuda dos dados internos. Na falha, o aviso é `role="alert"` e o
 * botão "Carregar de novo" continua no mesmo lugar enquanto carrega (ocupado
 * com `aria-disabled`, sem trocar de elemento), para o foco não cair no body.
 * O `id` fica no texto, que os campos e o botão usam como descrição.
 */
function PrivateLoadStatus({
  id,
  state,
  retried,
  blocked,
  onRetry,
  retryRef,
  failureNote,
  hint,
}: {
  id: string;
  state: PrivateState;
  retried: boolean;
  blocked: boolean;
  onRetry: () => void;
  retryRef: React.RefObject<HTMLButtonElement | null>;
  failureNote?: string;
  hint: string;
}) {
  const showRetry = state === "error" || (state === "loading" && retried);
  const inactive = state !== "error" || blocked;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] leading-snug">
      {showRetry ? (
        <>
          {state === "error" ? (
            <span key="erro" id={id} role="alert" className="font-medium text-danger">
              {PRIVATE_FAILED}
              {failureNote ? ` ${failureNote}` : ""}
            </span>
          ) : (
            <span key="carregando" id={id} className="text-fg/60">
              {PRIVATE_LOADING}
            </span>
          )}
          <button
            key="tentar"
            ref={retryRef}
            type="button"
            aria-disabled={inactive || undefined}
            aria-describedby={id}
            onClick={() => {
              if (!inactive) onRetry();
            }}
            className="inline-flex items-center gap-1 rounded font-semibold text-pink underline-offset-4 hover:underline aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:no-underline"
          >
            <RefreshCw aria-hidden="true" className={cx("size-3", state === "loading" && "animate-spin")} />
            {state === "loading" ? PRIVATE_LOADING_TEXT : "Carregar de novo"}
          </button>
        </>
      ) : (
        <span id={id} className="text-fg/60">
          {state === "loading" ? `${PRIVATE_LOADING} ` : ""}
          {hint}
        </span>
      )}
    </div>
  );
}

const PRIVATE_LOADING = "Carregando o gestor, a autorização e o contato...";
const PRIVATE_FAILED = "Não foi possível carregar o gestor, a autorização e o contato.";
const CONTACT_HINT = "Só a equipe vê. Não cria conta para o artista.";
const INTERNAL_HINT = "Só a equipe vê. Nada disto aparece no app.";

// ---------------------------------------------------------------------------
// Ver (quem só vê a seção)
// ---------------------------------------------------------------------------

function Detail({ term, wide = false, children }: { term: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-[12.5px] font-semibold text-fg/60">{term}</dt>
      <dd className="m-0 mt-1 text-sm leading-relaxed break-words text-fg">{children}</dd>
    </div>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-fg/55">{children}</span>;
}

/** Tudo da central só para leitura, os dois documentos, e só o botão de fechar. */
function ArtistDetails({ artist, onClose }: { artist: ArtistEntry; onClose: () => void }) {
  const ids = useId();
  const internalRef = useRef<HTMLElement>(null);
  const [internal, setInternal] = useState<ArtistPrivate | null>(artist.internal);
  const loader = useArtistPrivate(artist.id, artist.internal, setInternal, () => internalRef.current?.focus());
  const image = artist.photo ?? artist.thumb;

  function internalValue(value: string | null | undefined, empty: string) {
    if (loader.state === "loading") return <Missing>{PRIVATE_LOADING_TEXT}</Missing>;
    if (loader.state === "error") return <Missing>{PRIVATE_FAILED_TEXT}</Missing>;
    return value ? value : <Missing>{empty}</Missing>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-6 md:grid-cols-[210px_minmax(0,1fr)]">
        <div className="relative aspect-[3/4] w-full max-w-[210px] overflow-hidden rounded-xl border border-line-strong bg-sunken">
          {image ? (
            <Image src={image.url} alt={`Foto de ${artist.name}`} fill sizes="220px" unoptimized className="object-cover" />
          ) : (
            <p className="absolute inset-0 m-0 grid place-items-center p-4 text-center text-[13px] text-fg/60">Sem foto</p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <dl className="m-0 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Detail term="Nome artístico">{artist.name}</Detail>
            <Detail term="@ da central">@{artist.handle}</Detail>
            <Detail term="Nome curto">{artist.shortName ?? <Missing>Sem nome curto</Missing>}</Detail>
            <Detail term="Status">
              <ArtistStatusBadge status={artist.status} />
            </Detail>
            <Detail term="Gênero">{artist.genre ?? <Missing>Sem gênero</Missing>}</Detail>
            <Detail term="Cidade base">{artist.city ?? <Missing>Sem cidade</Missing>}</Detail>
            <Detail term="Fãs">{formatFans(artist.fanCount)}</Detail>
            <Detail term="Selo verificado">{artist.verified ? "Sim" : "Não"}</Detail>
            <Detail term="Bio da central" wide>
              {artist.bio ? <span className="whitespace-pre-line">{artist.bio}</span> : <Missing>Sem bio</Missing>}
            </Detail>
          </dl>

          <section ref={internalRef} tabIndex={-1} aria-labelledby={`${ids}-internos`} className="flex flex-col gap-3 outline-none">
            <h3 id={`${ids}-internos`} className="m-0 text-[13px] font-semibold text-fg/85">
              Dados internos
            </h3>
            <dl className="m-0 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Detail term="Gestor responsável">{internalValue(internal?.managerName, "Sem gestor")}</Detail>
              <Detail term="Autorização de uso de imagem">
                {internalValue(internal?.imageRightsConfirmed ? "Recebida" : "Ainda não recebida", "")}
              </Detail>
              <Detail term="E-mail de contato">{internalValue(internal?.email, "Sem e-mail")}</Detail>
              <Detail term="Celular de contato">{internalValue(internal?.phone, "Sem celular")}</Detail>
            </dl>
            <PrivateLoadStatus
              id={`${ids}-internos-status`}
              state={loader.state}
              retried={loader.retried}
              blocked={false}
              onRetry={loader.retry}
              retryRef={loader.retryRef}
              hint={INTERNAL_HINT}
            />
          </section>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 text-[12.5px] leading-snug text-fg/60">Só leitura. Quem edita a seção Artistas pode mudar esta central.</p>
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Criar e editar
// ---------------------------------------------------------------------------

type Intent = "save" | "publish";
type Step = "create" | "upload" | "update" | "publish";

const STEP_LABELS: Record<Step, string> = {
  create: "Criando a central...",
  upload: "Enviando a foto...",
  update: "Salvando...",
  publish: "Publicando...",
};

/** O que o servidor já tem, atualizado a cada passo que deu certo. Só os envios leem. */
interface ServerState {
  form: NormalizedArtistForm;
  /** O privado (gestor, autorização e contato) foi carregado: só então esses campos vão no envio. */
  privateLoaded: boolean;
  hasPhoto: boolean;
  /** Foto nova que já subiu (para não subir de novo numa nova tentativa). */
  uploaded: { source: ProcessedPhoto; paths: ArtistPhotoPaths } | null;
  /** Foto nova que já foi gravada na central. */
  savedPhoto: ProcessedPhoto | null;
}

type CreateResult =
  | { ok: true; id: string; serverForm: NormalizedArtistForm }
  | { ok: false; message: string; handleReason: string | null; uncertain: boolean };

const HANDLE_REASONS = new Set(["invalid-handle", "handle-taken", "handle-reserved"]);

const UNCERTAIN_CREATE = "Não deu para confirmar se a central foi criada.";

function initialPhoto(artist: ArtistEntry | null): PhotoValue {
  const image = artist?.thumb ?? artist?.photo;
  return image ? { kind: "current", url: image.url } : { kind: "none" };
}

function ArtistForm({
  artist,
  member,
  onBusyChange,
  onCancel,
  onSaved,
  onDraftCreated,
}: {
  artist: ArtistEntry | null;
  member: StaffMember;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: (saved: ArtistSaved) => void;
  onDraftCreated: (draft: DraftCreated) => void;
}) {
  const mounted = useMountedRef();
  const ids = useId();
  const fieldRefs = useRef<Partial<Record<ArtistFormField, HTMLElement | null>>>({});
  const photoButtonRef = useRef<HTMLButtonElement>(null);
  const rightsRef = useRef<HTMLInputElement>(null);
  const photoToken = useRef(0);

  // O privado que a lista em tempo real já trouxe entra direto; senão, é lido ao abrir.
  const [values, setValues] = useState<ArtistFormValues>(() =>
    artist ? artistFormFromArtist(artist, artist.internal) : emptyArtistForm(member.uid),
  );
  /** Privado como estava ao abrir (ou ao carregar): gestor atual da lista de gestores. */
  const [loadedPrivate, setLoadedPrivate] = useState<ArtistPrivate | null>(artist?.internal ?? null);
  const [handleEdited, setHandleEdited] = useState(false);
  const [artistId, setArtistId] = useState<string | null>(artist?.id ?? null);
  /**
   * @ de um `createArtist` cuja resposta se perdeu: pode já ser da central. Fica
   * travado até a próxima tentativa confirmar (e, se for, retomar) a central.
   */
  const [uncertainHandle, setUncertainHandle] = useState<string | null>(null);
  const [errors, setErrors] = useState<ArtistFormErrors>({});
  /** O @ a que o erro do @ se refere: se o @ sugerido muda com o nome, o erro antigo sai. */
  const [handleErrorFor, setHandleErrorFor] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ intent: Intent; step: Step } | null>(null);
  const [photo, setPhoto] = useState<PhotoValue>(() => initialPhoto(artist));
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [team, setTeam] = useState<StaffMember[] | null>(null);
  const [teamFailed, setTeamFailed] = useState(false);
  const [check, setCheck] = useState<{ handle: string; status: HandleStatus } | null>(null);

  const server = useRef<ServerState>({
    form: normalizeArtistForm(artist ? artistFormFromArtist(artist, artist.internal) : emptyArtistForm(member.uid)),
    privateLoaded: !artist || Boolean(artist.internal),
    hasPhoto: Boolean(artist?.photo && artist?.thumb),
    uploaded: null,
    savedPhoto: null,
  });

  const admin = isAdmin(member);
  const editId = artist?.id ?? null;
  const status = artist?.status ?? "draft";
  const disabled = Boolean(busy);

  // @: sugerido pelo nome até ser editado à mão; travado depois que a central
  // existe (ou pode existir, se a resposta da criação se perdeu).
  const handleLocked = Boolean(artistId) || uncertainHandle !== null;
  const handle = handleLocked || handleEdited ? values.handle : suggestHandle(values.name);
  const checkHandle = !handleLocked;
  // Sugerido ou digitado, o @ passa pelas mesmas regras do servidor antes de perguntar a ele.
  const askServer = checkHandle && shouldCheckHandle(handle);

  useEffect(() => {
    if (!askServer) return;
    let active = true;
    const timer = window.setTimeout(() => {
      checkArtistHandle(handle).then(
        (result) => {
          if (active) setCheck({ handle, status: handleStatusFromCheck(result) });
        },
        () => {
          if (active) setCheck({ handle, status: "error" });
        },
      );
    }, HANDLE_CHECK_DELAY);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [askServer, handle]);

  const handleStatus: HandleStatus = liveHandleStatus(handle, check, { suggested: !handleEdited });

  // Privado (gestor, autorização e contato): da lista em tempo real ou lido uma
  // vez ao abrir a edição. Enquanto não chega, esses campos ficam travados e o
  // salvar não mexe neles.
  const privateLoader = useArtistPrivate(
    editId,
    artist?.internal ?? null,
    (loaded) => {
      if (!artist) return;
      const loadedValues = artistFormFromArtist(artist, loaded);
      server.current.form = { ...server.current.form, ...pickPrivateFields(normalizeArtistForm(loadedValues)) };
      server.current.privateLoaded = true;
      setLoadedPrivate(loaded);
      setValues((current) => ({ ...current, ...pickPrivateFields(loadedValues) }));
    },
    () => fieldRefs.current.contactEmail?.focus(),
  );
  const privateState = privateLoader.state;

  // Gestores: só admin lista a equipe. Se a leitura falhar, fica você e o gestor atual.
  useEffect(() => {
    if (!admin) return;
    let active = true;
    getActiveTeam().then(
      (members) => {
        if (active) setTeam(members);
      },
      () => {
        if (active) setTeamFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [admin]);

  const managerOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const person of team ?? []) options.set(person.uid, person.displayName || person.email);
    if (!options.has(member.uid)) options.set(member.uid, member.displayName || member.email);
    if (loadedPrivate?.managerUid && !options.has(loadedPrivate.managerUid)) {
      options.set(loadedPrivate.managerUid, loadedPrivate.managerName ?? "Gestor atual");
    }
    return [...options]
      .map(([uid, name]) => ({ uid, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  }, [team, member, loadedPrivate]);

  const managerHint =
    privateState === "loading"
      ? "Carregando o gestor atual..."
      : privateState === "error"
        ? "Não carregou. Salvar não muda o gestor."
        : !admin
          ? "Aparecem você e o gestor atual. Para escolher outra pessoa, peça a um admin."
          : teamFailed
            ? "Não deu para carregar a equipe. Aparecem você e o gestor atual."
            : team
              ? undefined
              : "Carregando a equipe...";

  // A prévia é um endereço `blob:` do navegador: some junto com a foto.
  const previewUrl = photo.kind === "new" ? photo.previewUrl : null;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Foto solta fora da área abriria a imagem na aba e perderia o formulário.
  useEffect(() => {
    function block(event: DragEvent) {
      if (event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
    }
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const hasPhoto = photo.kind === "new" || (photo.kind === "current" && Boolean(artist?.photo && artist?.thumb));
  const canRemovePhoto = status !== "published";

  function update<K extends keyof ArtistFormValues>(field: K, value: ArtistFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field in errors && errors[field as ArtistFormField]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  async function choosePhoto(file: File) {
    photoToken.current += 1;
    const token = photoToken.current;
    setPhotoError(null);
    setPhotoProcessing(true);
    try {
      const processed = await processArtistPhoto(file);
      if (!mounted.current || token !== photoToken.current) return;
      setPhoto({ kind: "new", processed, previewUrl: URL.createObjectURL(processed.thumb.blob) });
    } catch (failure) {
      if (!mounted.current || token !== photoToken.current) return;
      setPhotoError(failure instanceof PhotoError ? failure.message : "Não foi possível preparar esta foto. Tente outra.");
    } finally {
      if (mounted.current && token === photoToken.current) setPhotoProcessing(false);
    }
  }

  function removePhoto() {
    photoToken.current += 1;
    setPhotoProcessing(false);
    setPhotoError(null);
    setPhoto({ kind: "none" });
  }

  function focusField(field: ArtistFormField) {
    fieldRefs.current[field]?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const intent: Intent = submitter instanceof HTMLButtonElement && submitter.value === "publish" ? "publish" : "save";
    setFormError(null);

    const current: ArtistFormValues = { ...values, handle };
    const found = validateArtistForm(current, { checkHandle: !handleLocked });
    if (!handleLocked && !found.handle && (handleStatus === "taken" || handleStatus === "reserved")) {
      found.handle = handleStatusText(handleStatus, handle);
    }
    setErrors(found);
    setHandleErrorFor(handle);
    const firstError = ARTIST_FORM_FIELD_ORDER.find((field) => found[field]);
    if (firstError) {
      focusField(firstError);
      return;
    }
    if (photoProcessing) {
      setFormError("Espere a foto ficar pronta e tente de novo.");
      return;
    }
    if (intent === "publish" && privateState !== "ready") {
      // Sem o privado, a autorização não é conhecida: nunca publica com dado faltando.
      if (privateState === "error") {
        setFormError("Para publicar, a autorização de uso de imagem precisa carregar. Use Carregar de novo.");
        privateLoader.retryRef.current?.focus();
      } else {
        setFormError("Espere a autorização de uso de imagem carregar e tente publicar de novo.");
      }
      return;
    }
    if (intent === "publish") {
      const missing = missingForPublish({ hasPhoto, imageRightsConfirmed: values.imageRightsConfirmed });
      if (missing.length > 0) {
        setFormError(publishBlockedText(missing));
        if (missing[0] === "photo") photoButtonRef.current?.focus();
        else rightsRef.current?.focus();
        return;
      }
    }
    await save(intent, normalizeArtistForm(current), photo);
  }

  /**
   * `createArtist`, com o caso da resposta perdida: se a tentativa anterior
   * deste @ ficou sem resposta e agora o @ volta "em uso", o dono pode ser a
   * própria central. Rascunho criado por esta pessoa é retomado (com o que o
   * servidor gravou, para o passo seguinte mandar só a diferença) em vez de
   * mandar escolher outro @ e deixar a primeira central perdida.
   */
  async function createDraft(form: NormalizedArtistForm): Promise<CreateResult> {
    const retrying = uncertainHandle === form.handle;
    let failure: unknown;
    try {
      const { artistId: id } = await createArtist(createArtistInput(form));
      return { ok: true, id, serverForm: form };
    } catch (error) {
      failure = error;
    }
    const { reason } = readError(failure);
    if (retrying && reason === "handle-taken") {
      try {
        const [existing, existingPrivate] = await Promise.all([getArtist(form.handle), getArtistPrivate(form.handle)]);
        if (existing && isAdoptableDraft(existing, existingPrivate, member.uid)) {
          return { ok: true, id: existing.id, serverForm: normalizeArtistForm(artistFormFromArtist(existing, existingPrivate)) };
        }
      } catch {
        return { ok: false, message: `${UNCERTAIN_CREATE} Tente de novo em instantes.`, handleReason: null, uncertain: true };
      }
    }
    if (reason && HANDLE_REASONS.has(reason)) {
      return { ok: false, message: callableErrorMessage(failure), handleReason: reason, uncertain: false };
    }
    if (mayHaveRunOnServer(failure)) {
      return {
        ok: false,
        message: `${UNCERTAIN_CREATE} ${callableErrorMessage(failure)} Se ela já existir, a nova tentativa continua dela.`,
        handleReason: null,
        uncertain: true,
      };
    }
    return { ok: false, message: callableErrorMessage(failure), handleReason: null, uncertain: false };
  }

  /**
   * Criar (se ainda não existe), subir a foto, gravar o que mudou e publicar.
   * Cada passo que dá certo fica anotado: se um passo falha, a central fica
   * como está no servidor (rascunho, no mínimo) e a nova tentativa continua dali.
   */
  async function save(intent: Intent, form: NormalizedArtistForm, photoNow: PhotoValue) {
    const createdInDialog = !artist;
    // Decidido no clique: se o privado terminar de carregar durante o envio, os
    // campos vazios do envio não podem apagar o gestor, a autorização ou o
    // contato que o servidor tem.
    const includePrivate = server.current.privateLoaded;
    let id = artistId;
    let savedSomething = false;

    const start = (step: Step) => setBusy({ intent, step });
    const fail = (message: string) => {
      if (!mounted.current) return;
      setFormError(message);
      setBusy(null);
      onBusyChange(false);
    };
    onBusyChange(true);

    // 1. Criar o rascunho (reserva o @ e grava o privado).
    if (!id) {
      start("create");
      const created = await createDraft(form);
      if (!mounted.current) return;
      if (!created.ok) {
        if (created.uncertain) {
          // O @ fica como foi enviado: a próxima tentativa confere se a central já é dele.
          setUncertainHandle(form.handle);
          setHandleEdited(true);
          setValues((currentValues) => ({ ...currentValues, handle: form.handle }));
          onDraftCreated({ name: form.name, handle: form.handle, certain: false });
        } else {
          setUncertainHandle(null);
        }
        if (created.handleReason) {
          const handleStatusNow: HandleStatus =
            created.handleReason === "handle-reserved" ? "reserved" : created.handleReason === "handle-taken" ? "taken" : "invalid";
          setCheck({ handle: form.handle, status: handleStatusNow });
          setErrors((currentErrors) => ({ ...currentErrors, handle: created.message }));
          setHandleErrorFor(form.handle);
          fail(created.message);
          focusField("handle");
          return;
        }
        fail(created.message);
        return;
      }
      id = created.id;
      server.current = { ...server.current, form: created.serverForm, privateLoaded: true };
      setUncertainHandle(null);
      setArtistId(id);
      setHandleEdited(true);
      setValues((currentValues) => ({ ...currentValues, handle: created.id }));
      onDraftCreated({ name: form.name, handle: created.id, certain: true });
    }

    const prefix = createdInDialog ? "A central foi criada como rascunho, mas" : null;

    // 2. Subir a foto nova (uma vez só, mesmo com novas tentativas).
    let photoChange: { photo: ArtistPhotoPaths | null; source: ProcessedPhoto | null } | null = null;
    if (photoNow.kind === "new" && server.current.savedPhoto !== photoNow.processed) {
      let paths = server.current.uploaded?.source === photoNow.processed ? server.current.uploaded.paths : null;
      if (!paths) {
        start("upload");
        try {
          paths = await uploadArtistPhoto(id, photoNow.processed);
        } catch (failure) {
          const message = storageErrorMessage(failure);
          fail(prefix ? `${prefix} a foto não subiu. ${message}` : `A foto não subiu e nada foi salvo. ${message}`);
          return;
        }
        server.current.uploaded = { source: photoNow.processed, paths };
      }
      photoChange = { photo: paths, source: photoNow.processed };
    } else if (photoNow.kind === "none" && server.current.hasPhoto) {
      photoChange = { photo: null, source: null };
    }

    // 3. Gravar só o que mudou (e a foto).
    const changes = artistChanges(server.current.form, form, { includePrivate });
    if (hasChanges(changes) || photoChange) {
      const input: UpdateArtistInput = { artistId: id, ...changes };
      if (photoChange) input.photo = photoChange.photo;
      start("update");
      try {
        await updateArtist(input);
      } catch (failure) {
        const message = callableErrorMessage(failure);
        const what = photoChange && !hasChanges(changes) ? "a foto não foi salva" : "as mudanças não foram salvas";
        fail(prefix ? `${prefix} ${what}. ${message}` : `Não foi possível salvar. ${message}`);
        return;
      }
      savedSomething = true;
      const before = server.current.form;
      server.current.form = includePrivate ? form : { ...form, ...pickPrivateFields(before) };
      if (photoChange) {
        server.current.hasPhoto = Boolean(photoChange.photo);
        server.current.savedPhoto = photoChange.source;
      }
    }

    // 4. Publicar.
    if (intent === "publish") {
      start("publish");
      try {
        await setArtistStatus(id, "published");
      } catch (failure) {
        const message = callableErrorMessage(failure);
        if (prefix) fail(`A central foi criada e está salva como rascunho, mas não foi publicada. ${message}`);
        else fail(savedSomething ? `As mudanças foram salvas, mas a central não foi publicada. ${message}` : `A central não foi publicada. ${message}`);
        return;
      }
    }

    if (!mounted.current) return;
    setBusy(null);
    onBusyChange(false);

    const name = form.name;
    const published = intent === "publish";
    if (createdInDialog) {
      onSaved({ message: published ? `Central ${name} criada e publicada.` : `Central ${name} criada como rascunho.`, published });
    } else if (published) {
      onSaved({ message: `Central ${name} publicada.`, published });
    } else if (savedSomething) {
      onSaved({ message: `Alterações em ${name} salvas.`, published });
    } else {
      onCancel();
    }
  }

  const editing = Boolean(artist);
  const showPublish = !editing || status === "draft";
  const saveLabel = editing ? "Salvar" : "Salvar rascunho";
  const publishLabel = editing ? "Salvar e publicar" : "Criar e publicar central";
  const privateReady = privateState === "ready";
  // Publicar sem o privado não sai (o envio recusa): o botão diz por quê, sem sair do Tab.
  const publishWaiting = !privateReady;
  const contactHintId = `${ids}-contato`;
  const handleStatusId = `${ids}-arroba-status`;
  const handleError = errors.handle && handleErrorFor === handle ? errors.handle : undefined;
  const handleStatusShown = checkHandle && !handleError ? handleStatusText(handleStatus, handle) : "";
  // Só o resultado final é anunciado, e só quando a pessoa mexe no @ (a
  // sugestão que muda com o nome não interrompe quem digita o nome).
  const handleAnnouncement = handleEdited && isAnnouncedHandleStatus(handleStatus) ? handleStatusShown : "";
  const handleHint = artistId ? "O @ não muda depois de criado." : uncertainHandle ? "O @ fica guardado até confirmar se a central foi criada." : HANDLE_FORMAT_HINT;

  return (
    <form onSubmit={submit} noValidate aria-busy={Boolean(busy)} className="flex flex-col gap-5">
      <div className="grid gap-6 md:grid-cols-[210px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <PhotoField
            value={photo}
            processing={photoProcessing}
            error={photoError}
            artistName={values.name.trim()}
            canRemove={canRemovePhoto}
            disabled={disabled}
            onFile={(file) => void choosePhoto(file)}
            onRemove={removePhoto}
            buttonRef={photoButtonRef}
          />
          <div className="rounded-xl border border-line-strong bg-raised p-3.5">
            <Switch
              label="Selo verificado"
              description="Marca de artista verificado na central e nos cartões do app."
              checked={values.verified}
              onChange={(checked) => update("verified", checked)}
              disabled={disabled}
            />
          </div>
        </div>

        {/* Durante o envio os textos ficam só leitura (sem perder o foco): o envio usa o que estava na tela no clique. */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome artístico" error={errors.name}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  ref={(element) => {
                    fieldRefs.current.name = element;
                  }}
                  id={id}
                  name="name"
                  autoComplete="off"
                  maxLength={80}
                  data-autofocus
                  value={values.name}
                  onChange={(event) => update("name", event.target.value)}
                  readOnly={disabled}
                  invalid={invalid}
                  describedBy={describedBy}
                />
              )}
            </Field>
            <Field label="@ da central" hint={handleHint} error={handleError}>
              {({ id, describedBy, invalid }) => (
                <>
                  <div className="relative">
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[15px] text-fg/55">
                      @
                    </span>
                    <TextInput
                      ref={(element) => {
                        fieldRefs.current.handle = element;
                      }}
                      id={id}
                      name="handle"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={HANDLE_MAX_LENGTH}
                      value={handle}
                      readOnly={handleLocked || disabled}
                      onChange={(event) => {
                        setHandleEdited(true);
                        update("handle", cleanHandleInput(event.target.value));
                      }}
                      invalid={invalid}
                      describedBy={[describedBy, checkHandle ? handleStatusId : null].filter(Boolean).join(" ") || undefined}
                      className="pl-8"
                    />
                  </div>
                  {checkHandle ? (
                    <>
                      <p
                        id={handleStatusId}
                        className={cx(
                          "m-0 text-[12.5px] font-medium leading-snug empty:-mt-1.5",
                          handleStatus === "available"
                            ? "text-cyan"
                            : handleStatus === "taken" || handleStatus === "reserved" || handleStatus === "invalid"
                              ? "text-danger"
                              : "text-fg/60",
                        )}
                      >
                        {handleStatusShown}
                      </p>
                      <p aria-live="polite" className="sr-only">
                        {handleAnnouncement}
                      </p>
                    </>
                  ) : null}
                </>
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome curto" optional hint="Aparece nos cartões pequenos. Ex.: Juninho M." error={errors.shortName}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  ref={(element) => {
                    fieldRefs.current.shortName = element;
                  }}
                  id={id}
                  name="shortName"
                  autoComplete="off"
                  maxLength={40}
                  value={values.shortName}
                  onChange={(event) => update("shortName", event.target.value)}
                  readOnly={disabled}
                  invalid={invalid}
                  describedBy={describedBy}
                />
              )}
            </Field>
            <Field label="Gênero" optional error={errors.genre}>
              {({ id, describedBy, invalid }) => (
                <SelectInput
                  ref={(element) => {
                    fieldRefs.current.genre = element;
                  }}
                  id={id}
                  name="genre"
                  value={values.genre}
                  onChange={(event) => update("genre", event.target.value)}
                  disabled={disabled}
                  invalid={invalid}
                  describedBy={describedBy}
                >
                  <option value="">Sem gênero</option>
                  {GENRES.map((genre) => (
                    <option key={genre} value={genre}>
                      {genre}
                    </option>
                  ))}
                  {values.genre && !isGenre(values.genre) ? <option value={values.genre}>{values.genre}</option> : null}
                </SelectInput>
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cidade base" optional hint="Ex.: Salvador, BA" error={errors.city}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  ref={(element) => {
                    fieldRefs.current.city = element;
                  }}
                  id={id}
                  name="city"
                  autoComplete="off"
                  maxLength={80}
                  value={values.city}
                  onChange={(event) => update("city", event.target.value)}
                  readOnly={disabled}
                  invalid={invalid}
                  describedBy={describedBy}
                />
              )}
            </Field>
            <Field label="Gestor responsável" optional hint={managerHint}>
              {({ id, describedBy }) => (
                <SelectInput
                  id={id}
                  name="managerUid"
                  value={values.managerUid}
                  onChange={(event) => update("managerUid", event.target.value)}
                  disabled={disabled || !privateReady}
                  describedBy={describedBy}
                >
                  <option value="">{managerEmptyOptionText(privateState)}</option>
                  {managerOptions.map((option) => (
                    <option key={option.uid} value={option.uid}>
                      {option.uid === member.uid ? `${option.name} (você)` : option.name}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="E-mail de contato" optional error={errors.contactEmail}>
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    ref={(element) => {
                      fieldRefs.current.contactEmail = element;
                    }}
                    id={id}
                    type="email"
                    name="contactEmail"
                    inputMode="email"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={254}
                    value={values.contactEmail}
                    onChange={(event) => update("contactEmail", event.target.value)}
                    disabled={!privateReady}
                    readOnly={disabled}
                    invalid={invalid}
                    describedBy={[describedBy, contactHintId].filter(Boolean).join(" ")}
                  />
                )}
              </Field>
              <Field label="Celular de contato" optional error={errors.contactPhone}>
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    ref={(element) => {
                      fieldRefs.current.contactPhone = element;
                    }}
                    id={id}
                    type="tel"
                    name="contactPhone"
                    inputMode="tel"
                    autoComplete="off"
                    maxLength={30}
                    placeholder="+55 71 99999-0000"
                    value={values.contactPhone}
                    onChange={(event) => update("contactPhone", event.target.value)}
                    disabled={!privateReady}
                    readOnly={disabled}
                    invalid={invalid}
                    describedBy={[describedBy, contactHintId].filter(Boolean).join(" ")}
                  />
                )}
              </Field>
            </div>
            <PrivateLoadStatus
              id={contactHintId}
              state={privateState}
              retried={privateLoader.retried}
              blocked={disabled}
              onRetry={privateLoader.retry}
              retryRef={privateLoader.retryRef}
              failureNote="Salvar não muda esses campos."
              hint={CONTACT_HINT}
            />
          </div>

          <Field label="Bio da central" optional hint={`${values.bio.length} de ${ARTIST_LIMITS.bio} caracteres.`} error={errors.bio}>
            {({ id, describedBy, invalid }) => (
              <TextArea
                ref={(element) => {
                  fieldRefs.current.bio = element;
                }}
                id={id}
                name="bio"
                rows={4}
                maxLength={ARTIST_LIMITS.bio}
                value={values.bio}
                onChange={(event) => update("bio", event.target.value)}
                readOnly={disabled}
                invalid={invalid}
                describedBy={describedBy}
              />
            )}
          </Field>

          <div className="flex flex-col gap-1">
            <Checkbox
              ref={rightsRef}
              label="Recebemos a autorização de uso de imagem do artista"
              checked={values.imageRightsConfirmed}
              onChange={(event) => update("imageRightsConfirmed", event.target.checked)}
              disabled={disabled || !privateReady}
              aria-describedby={`${ids}-direitos`}
            />
            <p id={`${ids}-direitos`} className="m-0 pl-[28px] text-[12.5px] leading-snug text-fg/60">
              Obrigatória para publicar a central.
              {privateState === "loading" ? " Carregando..." : privateState === "error" ? " Não carregou. Salvar não muda a autorização." : ""}
            </p>
          </div>
        </div>
      </div>

      {formError ? <Notice tone="error">{formError}</Notice> : null}

      <p aria-live="polite" className="sr-only">
        {busy ? STEP_LABELS[busy.step] : ""}
      </p>

      <div className="flex flex-col gap-3 border-t border-line pt-4 lg:flex-row lg:items-center lg:justify-between">
        <p className="m-0 text-[12.5px] leading-snug text-fg/60">
          {editing ? "A alteração fica registrada em Logs e auditoria com o seu nome." : "A criação fica registrada em Logs e auditoria com o seu nome."}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={disabled}>
            Cancelar
          </Button>
          <Button
            type="submit"
            name="intent"
            value="save"
            variant={showPublish ? "secondary" : "primary"}
            busy={busy?.intent === "save"}
            disabled={Boolean(busy) && busy?.intent !== "save"}
          >
            {busy?.intent === "save" ? STEP_LABELS[busy.step] : saveLabel}
          </Button>
          {showPublish ? (
            <Button
              type="submit"
              name="intent"
              value="publish"
              variant="primary"
              busy={busy?.intent === "publish"}
              disabled={Boolean(busy) && busy?.intent !== "publish"}
              aria-disabled={publishWaiting || undefined}
              aria-describedby={publishWaiting ? contactHintId : undefined}
              data-blocked={publishWaiting || undefined}
              className="data-[blocked]:cursor-not-allowed data-[blocked]:opacity-55 data-[blocked]:hover:bg-pink-strong"
            >
              {busy?.intent === "publish" ? STEP_LABELS[busy.step] : publishLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
