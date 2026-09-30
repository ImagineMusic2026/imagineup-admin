/**
 * Artistas e centrais (etapa 1), espelho do contrato combinado com o backend
 * (`imagineup-app/functions`). Tudo aqui é puro: sem Firebase, sem React, para
 * os testes em `tests/` importarem direto pelo Node.
 *
 * Artista e central são a mesma coisa: o @ é o id do documento `artists/{id}`
 * e vira o link da central no app. Não há conta de artista: o selo é só uma
 * marca.
 *
 * Cada central tem dois documentos com o mesmo id. `artists/{id}` é o que o
 * app mostra, e os fãs logados leem o documento inteiro: nada interno fica
 * nele. `artistPrivate/{id}` guarda o que só a equipe vê (gestor, autorização
 * de uso de imagem, contato e quem criou e editou). O painel escuta os dois e
 * junta pelo id (`ArtistEntry`).
 *
 * Quem valida de verdade são as Cloud Functions; aqui é o conforto da tela.
 */

import { PHOTO_SIZE, THUMB_SIZE, type ArtistPhotoPaths, type Size } from "@/lib/artist-photo";
import { toDate } from "@/lib/staff";
import { isValidEmail, normalizeEmail } from "@/lib/validation";
import { cleanLine, isVisibleLine } from "@/lib/visible-line";

export const GENRES = [
  "Arrocha",
  "Piseiro",
  "Forró",
  "Forró pé de serra",
  "Axé",
  "Pagode",
  "Sertanejo",
  "Brega",
  "Funk",
  "Samba",
  "Reggae",
  "Rap",
  "Pop",
  "Gospel",
  "MPB",
  "Outro",
] as const;

export type Genre = (typeof GENRES)[number];

export function isGenre(value: unknown): value is Genre {
  return typeof value === "string" && (GENRES as readonly string[]).includes(value);
}

export type ArtistStatus = "draft" | "published" | "unpublished";

export const ARTIST_STATUS_LABELS: Record<ArtistStatus, string> = {
  published: "No ar",
  draft: "Rascunho",
  unpublished: "Fora do ar",
};

/** Os primeiros publicados, na ordem, são os destaques da escolha de artistas no app. */
export const FEATURED_COUNT = 4;

export const ARTIST_LIMITS = { name: 60, shortName: 20, city: 60, bio: 500 } as const;

export interface ArtistImage {
  url: string;
  path: string;
  width: number;
  height: number;
}

/** `artists/{id}`: só o que o app pode mostrar. */
export interface Artist {
  id: string;
  handle: string;
  name: string;
  shortName: string | null;
  genre: string | null;
  city: string | null;
  bio: string | null;
  verified: boolean;
  photo: ArtistImage | null;
  thumb: ArtistImage | null;
  order: number;
  status: ArtistStatus;
  fanCount: number;
  publishedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** `artistPrivate/{id}`: o que só a equipe vê. */
export interface ArtistPrivate {
  email: string | null;
  phone: string | null;
  managerUid: string | null;
  managerName: string | null;
  imageRightsConfirmed: boolean;
  createdBy: string;
  updatedBy: string;
  updatedAt: Date | null;
}

/**
 * Central como as listas usam: o documento público com o privado do mesmo id.
 * `internal` é `null` enquanto o privado não chegou: o gestor aparece como
 * "Carregando..." e a autorização conta como não recebida (nunca libera
 * publicar com dado faltando).
 */
export interface ArtistEntry extends Artist {
  internal: ArtistPrivate | null;
}

// ---------------------------------------------------------------------------
// Leitura defensiva dos documentos
// ---------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function isArtistStatus(value: unknown): value is ArtistStatus {
  return value === "draft" || value === "published" || value === "unpublished";
}

/** `{ url, path, width, height }`; sem `url` não há imagem. */
export function parseArtistImage(value: unknown, fallback: Size): ArtistImage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const url = text(record.url);
  if (!url) return null;
  return {
    url,
    path: text(record.path),
    width: positiveInteger(record.width, fallback.width),
    height: positiveInteger(record.height, fallback.height),
  };
}

/**
 * Documento `artists/{id}` como a tela usa. Status desconhecido vira rascunho
 * (nunca "no ar" por engano) e ordem desconhecida vai para o fim da lista.
 * Campos internos que sobrarem no documento público são ignorados: gestor,
 * autorização e autoria só valem vindos do `artistPrivate`.
 */
export function parseArtist(id: string, data: Record<string, unknown>): Artist {
  const order = data.order;
  const fanCount = data.fanCount;
  return {
    id,
    handle: text(data.handle) || id,
    name: text(data.name) || id,
    shortName: textOrNull(data.shortName),
    genre: textOrNull(data.genre),
    city: textOrNull(data.city),
    bio: textOrNull(data.bio),
    verified: data.verified === true,
    photo: parseArtistImage(data.photo, PHOTO_SIZE),
    thumb: parseArtistImage(data.thumb, THUMB_SIZE),
    order: typeof order === "number" && Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER,
    status: isArtistStatus(data.status) ? data.status : "draft",
    fanCount: typeof fanCount === "number" && Number.isFinite(fanCount) && fanCount > 0 ? Math.floor(fanCount) : 0,
    publishedAt: toDate(data.publishedAt),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

/** Documento `artistPrivate/{id}`. A autorização só vale com `true` de verdade. */
export function parseArtistPrivate(data: Record<string, unknown>): ArtistPrivate {
  return {
    email: textOrNull(data.email),
    phone: textOrNull(data.phone),
    managerUid: textOrNull(data.managerUid),
    managerName: textOrNull(data.managerName),
    imageRightsConfirmed: data.imageRightsConfirmed === true,
    createdBy: text(data.createdBy),
    updatedBy: text(data.updatedBy),
    updatedAt: toDate(data.updatedAt),
  };
}

/**
 * Junta as centrais (já na ordem) com os privados pelo id. Sem o privado
 * (`privates` ainda `null`, ou sem o documento dele), `internal` fica `null`.
 */
export function joinArtists(artists: readonly Artist[], privates: ReadonlyMap<string, ArtistPrivate> | null): ArtistEntry[] {
  return artists.map((artist) => ({ ...artist, internal: privates?.get(artist.id) ?? null }));
}

/**
 * Junta duas escutas em tempo real (`artists` e `artistPrivate`). A lista sai
 * assim que as centrais chegam, sem esperar os privados, e de novo a cada
 * mudança em qualquer uma das duas.
 */
export function createArtistsJoin(onChange: (entries: ArtistEntry[]) => void) {
  let artists: Artist[] | null = null;
  let privates: Map<string, ArtistPrivate> | null = null;
  const emit = () => {
    if (artists) onChange(joinArtists(artists, privates));
  };
  return {
    setArtists(next: Artist[]) {
      artists = sortArtists(next);
      emit();
    },
    setPrivates(next: Iterable<readonly [string, ArtistPrivate]>) {
      privates = new Map(next);
      emit();
    },
  };
}

/** Texto enquanto o privado da central não chegou. */
export const PRIVATE_LOADING_TEXT = "Carregando...";

/** Coluna "Gestor": o nome, "Sem gestor" ou "Carregando..." enquanto o privado não chegou. */
export function managerLabel(entry: Pick<ArtistEntry, "internal">): string {
  if (!entry.internal) return PRIVATE_LOADING_TEXT;
  return entry.internal.managerName ?? "Sem gestor";
}

/** Leitura do privado ao abrir o formulário ou o "Ver". */
export type PrivateLoadState = "loading" | "ready" | "error";

/** Texto no lugar de um dado do privado que não carregou. */
export const PRIVATE_FAILED_TEXT = "Não carregou";

/**
 * Opção vazia do "Gestor responsável" no formulário: só diz "Sem gestor" depois
 * que o privado chegou. Antes disso (ou se a leitura falhou) o campo, travado,
 * não afirma um gestor que ainda não conhece.
 */
export function managerEmptyOptionText(state: PrivateLoadState): string {
  if (state === "loading") return PRIVATE_LOADING_TEXT;
  if (state === "error") return PRIVATE_FAILED_TEXT;
  return "Sem gestor";
}

/** Ordem de destaque (menor primeiro); empate pelo nome e pelo @. */
export function sortArtists<T extends Pick<Artist, "order" | "name" | "id">>(artists: readonly T[]): T[] {
  return [...artists].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) || a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// @ da central
// ---------------------------------------------------------------------------

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;
/**
 * Ids que o Firestore reserva (`__.*__`, como `____` ou `__trio__`): cabem no
 * `HANDLE_PATTERN`, mas nunca viram documento. O servidor recusa igual.
 */
export const RESERVED_DOC_ID_PATTERN = /^__.*__$/;

/** Formato do @ igual ao do servidor: `HANDLE_PATTERN` e fora do `__.*__`. */
export function isHandleFormat(handle: string): boolean {
  return HANDLE_PATTERN.test(handle) && !RESERVED_DOC_ID_PATTERN.test(handle);
}

/** Nunca disponíveis, nem para fã nem para central. */
export const RESERVED_HANDLES: readonly string[] = [
  "admin",
  "imagine",
  "imagineup",
  "imaginemusic",
  "equipe",
  "suporte",
  "staff",
  "oficial",
  "ajuda",
  "contato",
];

/**
 * Sugestão a partir do nome: sem acento, minúsculo, só a-z e 0-9, até 30
 * ("Trio Bem Bahia" vira "triobembahia"). Sem `_`, nunca cai no `__.*__`; a
 * tela confere a sugestão com a mesma regra do @ digitado (`liveHandleStatus`).
 */
export function suggestHandle(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, HANDLE_MAX_LENGTH);
}

/** O que a pessoa digitou no campo do @: sem o "@" da frente, sem espaços, minúsculo. */
export function cleanHandleInput(value: string): string {
  return value.replace(/\s+/g, "").replace(/^@+/, "").toLowerCase();
}

export type HandleProblem = "invalid" | "reserved";

/** Mesmas regras do servidor, sem a consulta de "já usado". */
export function handleProblem(handle: string): HandleProblem | null {
  if (!isHandleFormat(handle)) return "invalid";
  if (RESERVED_HANDLES.includes(handle)) return "reserved";
  return null;
}

/** Só vale perguntar ao servidor (`checkArtistHandle`) por um @ que passa nas regras locais. */
export function shouldCheckHandle(handle: string): boolean {
  return handle.length > 0 && handleProblem(handle) === null;
}

export interface HandleCheckResult {
  available: boolean;
  reason: "invalid" | "taken" | "reserved" | null;
}

export type HandleStatus = "empty" | "checking" | "available" | "taken" | "reserved" | "invalid" | "error";

/** Resposta do `checkArtistHandle` como status da tela. Indisponível sem motivo conta como ocupado. */
export function handleStatusFromCheck(result: HandleCheckResult): HandleStatus {
  if (result.available) return "available";
  if (result.reason === "invalid" || result.reason === "reserved") return result.reason;
  return "taken";
}

export const HANDLE_FORMAT_HINT = "De 3 a 30 letras minúsculas, números ou _. Vira o link da central e não muda depois.";

/**
 * Texto do status do @. Com o @ em mãos, o "inválido" diz o motivo certo: um
 * `__trio__` tem o formato, só começa e termina com `__`.
 */
export function handleStatusText(status: HandleStatus, handle = ""): string {
  switch (status) {
    case "checking":
      return "Conferindo se está livre...";
    case "available":
      return "Disponível.";
    case "taken":
      return "Já está em uso. Escolha outro.";
    case "reserved":
      return "Este @ é reservado. Escolha outro.";
    case "invalid":
      return HANDLE_PATTERN.test(handle) && RESERVED_DOC_ID_PATTERN.test(handle)
        ? "O @ não pode começar e terminar com __."
        : "Use de 3 a 30 letras minúsculas, números ou _.";
    case "error":
      return "Não deu para conferir agora. O servidor confere de novo ao salvar.";
    default:
      return "";
  }
}

/**
 * Status que a tela mostra. Enquanto o @ vem do nome (não foi editado à mão),
 * um @ curto é só o começo do nome sendo digitado: não aparece como erro.
 */
export function shownHandleStatus(status: HandleStatus, handle: string, { suggested }: { suggested: boolean }): HandleStatus {
  if (suggested && handle.length < HANDLE_MIN_LENGTH) return "empty";
  return status;
}

/**
 * Status do @ na conferência ao vivo: primeiro as regras locais (as mesmas do
 * servidor, para o @ sugerido e para o digitado); depois a resposta do
 * `checkArtistHandle` para este mesmo @, ou "conferindo" enquanto ela não chega.
 */
export function liveHandleStatus(
  handle: string,
  check: { handle: string; status: HandleStatus } | null,
  { suggested }: { suggested: boolean },
): HandleStatus {
  const status: HandleStatus = !handle ? "empty" : (handleProblem(handle) ?? (check?.handle === handle ? check.status : "checking"));
  return shownHandleStatus(status, handle, { suggested });
}

/** Resultados que valem anúncio para leitor de tela (o "Conferindo..." e o formato não). */
export function isAnnouncedHandleStatus(status: HandleStatus): boolean {
  return status === "available" || status === "taken" || status === "reserved" || status === "error";
}

/**
 * Central que um `createArtist` sem resposta pode ter criado: rascunho nunca
 * publicado, criado por quem está no formulário (`createdBy` do privado). Só
 * ela pode ser retomada quando a nova tentativa volta com "@ em uso"; sem o
 * privado, não dá para saber quem criou e nada é retomado.
 */
export function isAdoptableDraft(
  artist: Pick<Artist, "status" | "publishedAt">,
  internal: Pick<ArtistPrivate, "createdBy"> | null,
  uid: string,
): boolean {
  return artist.status === "draft" && artist.publishedAt === null && Boolean(uid) && internal?.createdBy === uid;
}

/** Status que impedem criar a central. */
export function isBlockingHandleStatus(status: HandleStatus): boolean {
  return status === "empty" || status === "taken" || status === "reserved" || status === "invalid";
}

// ---------------------------------------------------------------------------
// Contato (no privado, só a equipe vê)
// ---------------------------------------------------------------------------

export const PHONE_PATTERN = /^\+?\d{10,15}$/;

/** Tira espaços, parênteses e traços, como o servidor guarda ("+55 (71) 9 9184-2260" vira "+5571991842260"). */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s()\-‐-―−]/g, "");
}

export function contactPhoneError(phone: string): string | null {
  const value = normalizePhone(phone);
  if (!value) return null;
  if (!PHONE_PATTERN.test(value)) return "Use o número com DDD, só dígitos (10 a 15). Pode começar com +.";
  return null;
}

export function contactEmailError(email: string): string | null {
  if (!email.trim()) return null;
  if (!isValidEmail(email)) return "Confira o e-mail. Ele precisa ter o formato nome@dominio.com.";
  return null;
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export interface ArtistFormValues {
  name: string;
  handle: string;
  shortName: string;
  genre: string;
  city: string;
  bio: string;
  verified: boolean;
  managerUid: string;
  imageRightsConfirmed: boolean;
  contactEmail: string;
  contactPhone: string;
}

export type ArtistFormField = "name" | "handle" | "shortName" | "genre" | "city" | "bio" | "contactEmail" | "contactPhone";

export type ArtistFormErrors = Partial<Record<ArtistFormField, string>>;

export function emptyArtistForm(managerUid: string): ArtistFormValues {
  return {
    name: "",
    handle: "",
    shortName: "",
    genre: "",
    city: "",
    bio: "",
    verified: false,
    managerUid,
    imageRightsConfirmed: false,
    contactEmail: "",
    contactPhone: "",
  };
}

/**
 * Formulário a partir dos dois documentos. Sem o privado (ainda carregando ou
 * inexistente), gestor, autorização e contato ficam vazios: o formulário só
 * os manda depois de carregar (`artistChanges` com `includePrivate`).
 */
export function artistFormFromArtist(artist: Artist, internal: ArtistPrivate | null): ArtistFormValues {
  return {
    name: artist.name,
    handle: artist.handle,
    shortName: artist.shortName ?? "",
    genre: artist.genre ?? "",
    city: artist.city ?? "",
    bio: artist.bio ?? "",
    verified: artist.verified,
    managerUid: internal?.managerUid ?? "",
    imageRightsConfirmed: internal?.imageRightsConfirmed === true,
    contactEmail: internal?.email ?? "",
    contactPhone: internal?.phone ?? "",
  };
}

const VISIBLE_LINE_MESSAGE = "Use só letras, números e símbolos visíveis, numa linha.";

function lineError(value: string, max: number, emptyMessage: string | null): string | null {
  const clean = cleanLine(value);
  if (!clean) return emptyMessage;
  if (clean.length > max) return `Use até ${max} caracteres.`;
  if (!isVisibleLine(clean)) return VISIBLE_LINE_MESSAGE;
  return null;
}

/**
 * Bio como vai para o servidor: cada linha limpa (sem isolantes bidi, em NFC,
 * sem espaço nas pontas), no máximo uma linha em branco seguida e nada em
 * branco no começo ou no fim.
 */
export function cleanBio(bio: string): string {
  const lines: string[] = [];
  let blankRun = 0;
  for (const raw of bio.replace(/\r\n?/g, "\n").split("\n")) {
    const line = cleanLine(raw);
    blankRun = line ? 0 : blankRun + 1;
    if (blankRun > 1) continue;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

export function bioError(bio: string): string | null {
  const clean = cleanBio(bio);
  if (!clean) return null;
  if (clean.length > ARTIST_LIMITS.bio) return `Use até ${ARTIST_LIMITS.bio} caracteres.`;
  if (clean.split("\n").some((line) => line.length > 0 && !isVisibleLine(line))) {
    return "Use só letras, números e símbolos visíveis.";
  }
  return null;
}

/** Erros por campo. O @ só é conferido na criação (depois ele não muda). */
export function validateArtistForm(values: ArtistFormValues, { checkHandle }: { checkHandle: boolean }): ArtistFormErrors {
  const errors: ArtistFormErrors = {};
  const found: Array<[ArtistFormField, string | null]> = [
    ["name", lineError(values.name, ARTIST_LIMITS.name, "Digite o nome artístico.")],
    ["handle", checkHandle ? handleFieldError(values.handle) : null],
    ["shortName", lineError(values.shortName, ARTIST_LIMITS.shortName, null)],
    ["genre", values.genre && !isGenre(values.genre) ? "Escolha um gênero da lista." : null],
    ["city", lineError(values.city, ARTIST_LIMITS.city, null)],
    ["contactEmail", contactEmailError(values.contactEmail)],
    ["contactPhone", contactPhoneError(values.contactPhone)],
    ["bio", bioError(values.bio)],
  ];
  for (const [field, message] of found) {
    if (message) errors[field] = message;
  }
  return errors;
}

function handleFieldError(handle: string): string | null {
  if (!handle) return "Escolha o @ da central.";
  const problem = handleProblem(handle);
  return problem ? handleStatusText(problem, handle) : null;
}

/** Ordem dos campos na tela, para o foco ir ao primeiro erro. */
export const ARTIST_FORM_FIELD_ORDER: readonly ArtistFormField[] = [
  "name",
  "handle",
  "shortName",
  "genre",
  "city",
  "contactEmail",
  "contactPhone",
  "bio",
];

export interface NormalizedArtistForm {
  handle: string;
  name: string;
  shortName: string | null;
  genre: Genre | null;
  city: string | null;
  bio: string | null;
  verified: boolean;
  managerUid: string | null;
  imageRightsConfirmed: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
}

/** Valores como vão para o servidor: texto limpo e `null` no que ficou vazio. */
export function normalizeArtistForm(values: ArtistFormValues): NormalizedArtistForm {
  const optional = (value: string) => cleanLine(value) || null;
  const email = normalizeEmail(values.contactEmail);
  const phone = normalizePhone(values.contactPhone);
  return {
    handle: cleanHandleInput(values.handle),
    name: cleanLine(values.name),
    shortName: optional(values.shortName),
    genre: isGenre(values.genre) ? values.genre : null,
    city: optional(values.city),
    bio: cleanBio(values.bio) || null,
    verified: values.verified,
    managerUid: values.managerUid.trim() || null,
    imageRightsConfirmed: values.imageRightsConfirmed,
    contactEmail: email || null,
    contactPhone: phone || null,
  };
}

export interface CreateArtistInput {
  handle: string;
  name: string;
  shortName?: string;
  genre?: Genre;
  city?: string;
  bio?: string;
  verified: boolean;
  managerUid?: string;
  imageRightsConfirmed: boolean;
  contactEmail?: string;
  contactPhone?: string;
}

export interface UpdateArtistInput {
  artistId: string;
  name?: string;
  shortName?: string | null;
  genre?: Genre | null;
  city?: string | null;
  bio?: string | null;
  verified?: boolean;
  managerUid?: string | null;
  imageRightsConfirmed?: boolean;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Os dois caminhos no Storage, ou `null` para tirar a foto. */
  photo?: ArtistPhotoPaths | null;
}

export type ArtistChanges = Omit<UpdateArtistInput, "artistId" | "photo">;

/** Pedido do `createArtist`: opcionais vazios ficam de fora. */
export function createArtistInput(form: NormalizedArtistForm): CreateArtistInput {
  const input: CreateArtistInput = {
    handle: form.handle,
    name: form.name,
    verified: form.verified,
    imageRightsConfirmed: form.imageRightsConfirmed,
  };
  if (form.shortName) input.shortName = form.shortName;
  if (form.genre) input.genre = form.genre;
  if (form.city) input.city = form.city;
  if (form.bio) input.bio = form.bio;
  if (form.managerUid) input.managerUid = form.managerUid;
  if (form.contactEmail) input.contactEmail = form.contactEmail;
  if (form.contactPhone) input.contactPhone = form.contactPhone;
  return input;
}

/** Campos que o servidor grava no documento público. */
const PUBLIC_FIELDS = ["name", "shortName", "genre", "city", "bio", "verified"] as const;
/** Campos que o servidor grava no `artistPrivate`. */
export const PRIVATE_FIELDS = ["managerUid", "imageRightsConfirmed", "contactEmail", "contactPhone"] as const;

export type PrivateField = (typeof PRIVATE_FIELDS)[number];

/**
 * Só gestor, autorização e contato de um formulário (cru ou normalizado), para
 * trocar esses campos sem mexer no resto: quando o privado chega, e quando um
 * envio sem o privado carregado deixa o servidor com os valores de antes.
 */
export function pickPrivateFields<T extends Record<PrivateField, unknown>>(form: T): Pick<T, PrivateField> {
  return {
    managerUid: form.managerUid,
    imageRightsConfirmed: form.imageRightsConfirmed,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone,
  };
}

/**
 * Só o que mudou vai no `updateArtist` (campo ausente não muda; `null` limpa).
 * Gestor, autorização e contato só entram quando o privado foi carregado: sem
 * ele, o formulário não sabe o valor de antes e não pode apagar nada sem querer.
 */
export function artistChanges(
  before: NormalizedArtistForm,
  after: NormalizedArtistForm,
  { includePrivate }: { includePrivate: boolean },
): ArtistChanges {
  const changes: Record<string, unknown> = {};
  const fields: readonly (keyof NormalizedArtistForm)[] = includePrivate ? [...PUBLIC_FIELDS, ...PRIVATE_FIELDS] : PUBLIC_FIELDS;
  for (const field of fields) {
    if (before[field] !== after[field]) changes[field] = after[field];
  }
  return changes as ArtistChanges;
}

export function hasChanges(changes: object): boolean {
  return Object.keys(changes).length > 0;
}

// ---------------------------------------------------------------------------
// Publicação
// ---------------------------------------------------------------------------

export type PublishRequirement = "photo" | "image-rights";

export const PUBLISH_REQUIREMENT_LABELS: Record<PublishRequirement, string> = {
  photo: "Foto",
  "image-rights": "Autorização de imagem",
};

/** O que falta para publicar: foto (as duas versões) e a autorização de uso de imagem. */
export function missingForPublish({ hasPhoto, imageRightsConfirmed }: { hasPhoto: boolean; imageRightsConfirmed: boolean }): PublishRequirement[] {
  const missing: PublishRequirement[] = [];
  if (!hasPhoto) missing.push("photo");
  if (!imageRightsConfirmed) missing.push("image-rights");
  return missing;
}

/** O que falta na central da lista. Sem o privado, a autorização conta como não recebida. */
export function artistMissingForPublish(entry: Pick<ArtistEntry, "photo" | "thumb" | "internal">): PublishRequirement[] {
  return missingForPublish({
    hasPhoto: Boolean(entry.photo && entry.thumb),
    imageRightsConfirmed: entry.internal?.imageRightsConfirmed === true,
  });
}

/** Motivo do botão de publicar desabilitado, em frase. */
export function publishBlockedText(missing: readonly PublishRequirement[]): string {
  const photo = missing.includes("photo");
  const rights = missing.includes("image-rights");
  if (photo && rights) return "Para publicar, faltam a foto e a autorização de uso de imagem.";
  if (photo) return "Para publicar, falta a foto.";
  if (rights) return "Para publicar, falta marcar a autorização de uso de imagem.";
  return "";
}

// ---------------------------------------------------------------------------
// Contagens, ordem e textos
// ---------------------------------------------------------------------------

export interface ArtistCounts {
  total: number;
  published: number;
  drafts: number;
  unpublished: number;
}

export function countArtists(artists: readonly Pick<Artist, "status">[]): ArtistCounts {
  const counts: ArtistCounts = { total: artists.length, published: 0, drafts: 0, unpublished: 0 };
  for (const artist of artists) {
    if (artist.status === "published") counts.published += 1;
    else if (artist.status === "unpublished") counts.unpublished += 1;
    else counts.drafts += 1;
  }
  return counts;
}

/** "19 centrais no ar · 3 aguardando publicação". */
export function artistsSummary(counts: Pick<ArtistCounts, "published" | "drafts">): string {
  const live = `${counts.published} ${counts.published === 1 ? "central" : "centrais"} no ar`;
  return `${live} · ${counts.drafts} aguardando publicação`;
}

/** Os primeiros publicados na ordem atual (destaques da escolha de artistas). */
export function featuredArtistIds(artists: readonly Pick<Artist, "id" | "status">[], count = FEATURED_COUNT): Set<string> {
  return new Set(
    artists
      .filter((artist) => artist.status === "published")
      .slice(0, count)
      .map((artist) => artist.id),
  );
}

/** Lista nova com o id uma posição acima (-1) ou abaixo (+1); `null` se não dá para mover. */
export function moveId(ids: readonly string[], id: string, delta: number): string[] | null {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || delta === 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Aplica uma ordem local (ainda salvando) à lista do servidor; quem não está nela vai para o fim. */
export function applyOrder<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placed = ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const listed = new Set(ids);
  return [...placed, ...items.filter((item) => !listed.has(item.id))];
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function positionAnnouncement(name: string, position: number, total: number): string {
  return `${name} agora está na posição ${position} de ${total}.`;
}

/** "Arrocha · Feira de Santana, BA", só o que existir. */
export function genreCityLine(artist: Pick<Artist, "genre" | "city">): string {
  return [artist.genre, artist.city].filter(Boolean).join(" · ");
}

const NUMBER_FORMAT = new Intl.NumberFormat("pt-BR");

export function formatFans(count: number): string {
  return NUMBER_FORMAT.format(count);
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const DAY_PARTS = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

function dayParts(date: Date): { day: number; month: number; year: number } {
  const parts = Object.fromEntries(DAY_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return { day: Number(parts.day), month: Number(parts.month), year: Number(parts.year) };
}

/** "2 ago" no ano corrente, "2 ago 2025" nos outros, no fuso de São Paulo. */
export function formatDay(date: Date, now: Date): string {
  const parts = dayParts(date);
  const label = `${parts.day} ${MONTHS[parts.month - 1]}`;
  return parts.year === dayParts(now).year ? label : `${label} ${parts.year}`;
}
