/**
 * O vídeo dos posts, conferido no navegador antes do envio (pergunta 15 da
 * seção 33 da nota do app), puro: lê as caixas do MP4 sem carregar o arquivo
 * inteiro e confere o que o app precisa para tocar em todo aparelho.
 *
 * - Só H.264 (`avc1`); HEVC (`hvc1` ou `hev1`) não toca em alguns Android, e
 *   as variantes `avc2`, `avc3` e `avc4` também não tocam em todo aparelho.
 *   Do H.264, só os perfis Baseline, Main e High (o `profile_idc` 66, 77 e
 *   100 do `avcC`): o High 10 e o 4:2:2 não tocam em muitos aparelhos.
 * - O índice (`moov`) antes dos dados (`mdat`), o "faststart": sem ele, o
 *   vídeo só começa depois de baixar quase tudo.
 * - Nada fragmentado (o `mvex` no `moov`): o `mvhd` cobre só o primeiro
 *   fragmento, e a duração inteira só vem no `mehd`, que muito export não
 *   traz. Sem a duração, o limite de 1 minuto não dá para conferir, toque o
 *   app o fragmentado ou não (decisão do dono de 15/10/2026).
 * - Até 720p (o lado menor até 720 e o maior até 1280) e 20 MB.
 * - Até 1 minuto (decisão do dono de 15/10/2026).
 *
 * A duração e a medida na tela (já virada, quando o vídeo foi gravado de pé)
 * vão no metadado do arquivo, ao lado do `width` e do `height` das imagens: o
 * `updatePost` de hoje grava do vídeo só `{ url, path, size }`.
 */

export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MAX_SHORT_SIDE = 720;
export const VIDEO_MAX_LONG_SIDE = 1280;
/**
 * O limite de duração, em segundos arredondados: até 60,499 s passa. Muito
 * export de "1:00" sai com uns centésimos a mais (o enchimento do AAC, o corte
 * sem recodificar, 1800 quadros a 29,97 fps), e o limite exato recusava todos.
 *
 * A duração lida já vem arredondada ao milissegundo, então de 60,4995 s a
 * 60,5 s arredonda duas vezes e fica de fora. Acontece com timescale de 2000
 * ou mais, e também com ímpar de 1001 a 1999 (60560/1001 é recusado); a
 * diferença é de meio milésimo.
 */
export const VIDEO_MAX_SECONDS = 60;
/** Teto da leitura do índice: um `moov` de vídeo curto tem poucos KB. */
const MOOV_READ_MAX = 16 * 1024 * 1024;

export const VIDEO_RULES_TEXT = "MP4 em H.264, de até 1 minuto, 720p e 20 MB, com o início rápido (faststart) e sem fragmentar. MOV não vale: exporte em MP4.";

export class VideoCheckError extends Error {}

/** Lê os bytes de `start` até `end` (sem incluir), como o `Blob.slice`. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

export interface VideoTrackInfo {
  /** O tipo da entrada de amostra (`avc1`, `hvc1`...), ou `null` sem ela. */
  codec: string | null;
  /** A medida codificada do quadro. */
  width: number;
  height: number;
  /** O vídeo gira 90 ou 270 graus na tela (a matriz do `tkhd`). */
  rotated: boolean;
  /** A largura do pixel sobre a altura (a caixa `pasp`), entre 1/4 e 4; 1 sem ela, ou fora disso. */
  pixelRatio: number;
  /** O `profile_idc` do H.264 (a caixa `avcC`), ou `null` sem ela. */
  profile: number | null;
  durationMs: number | null;
}

export interface Mp4Info {
  /** O `moov` vem antes do `mdat`. */
  faststart: boolean;
  /** A primeira faixa de vídeo, ou `null` sem nenhuma. */
  video: VideoTrackInfo | null;
  /** O arquivo é fragmentado (tem `mvex` no `moov`): recusado, qualquer que seja o resto. */
  fragmented: boolean;
  /** A duração do filme (`mvhd`), ou a da faixa quando o filme não traz; `null` no fragmentado. */
  durationMs: number | null;
}

/** O que vai no metadado do mp4: a duração e a medida como aparece na tela. */
export interface VideoMeta {
  durationMs: number;
  width: number;
  height: number;
}

function typeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function u64(bytes: Uint8Array, offset: number): number {
  return u32(bytes, offset) * 2 ** 32 + u32(bytes, offset + 4);
}

function i32(bytes: Uint8Array, offset: number): number {
  return u32(bytes, offset) | 0;
}

interface Box {
  type: string;
  /** Onde começa o conteúdo, depois do cabeçalho. */
  start: number;
  end: number;
}

/** As caixas filhas de `bytes[from, to)`. Caixa torta para a leitura ali. */
function children(bytes: Uint8Array, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let offset = from;
  while (offset + 8 <= to) {
    let size = u32(bytes, offset);
    const type = typeAt(bytes, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > to) break;
      size = u64(bytes, offset + 8);
      header = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < header || offset + size > to) break;
    boxes.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

function child(bytes: Uint8Array, box: Box, type: string): Box | null {
  return children(bytes, box.start, box.end).find((item) => item.type === type) ?? null;
}

function path(bytes: Uint8Array, box: Box, types: string[]): Box | null {
  let current: Box | null = box;
  for (const type of types) {
    if (!current) return null;
    current = child(bytes, current, type);
  }
  return current;
}

/** O timescale de um `mvhd` ou `mdhd` (versão 0 ou 1). */
function timescaleOf(bytes: Uint8Array, box: Box): number {
  return bytes[box.start] === 1 ? u32(bytes, box.start + 20) : u32(bytes, box.start + 12);
}

/** A duração em milissegundos de um `mvhd` ou `mdhd` (versão 0 ou 1). */
function timing(bytes: Uint8Array, box: Box): number | null {
  const version = bytes[box.start];
  const base = box.start + 4;
  const duration = version === 1 ? u64(bytes, base + 20) : u32(bytes, base + 12);
  return durationMsOf(timescaleOf(bytes, box), duration);
}

function durationMsOf(timescale: number, duration: number): number | null {
  // Duração "desconhecida" (todos os bits ligados) ou zero: sem duração.
  if (!timescale || !duration || duration === 0xffffffff || duration >= 2 ** 53 - 1) return null;
  return Math.round((duration / timescale) * 1000);
}

/** O tamanho da entrada visual até as caixas filhas: o cabeçalho e os campos fixos (ISO 14496-12, VisualSampleEntry). */
const VISUAL_ENTRY_FIXED = 86;

/** A proporção do pixel que o leitor aceita; fora disso, o `pasp` é tratado como quadrado. */
const PIXEL_RATIO_MIN = 1 / 4;
const PIXEL_RATIO_MAX = 4;

/** `hSpacing / vSpacing` da caixa `pasp`, ou 1 sem ela (ou com valores que não valem). */
function pixelRatioOf(boxes: Box[], bytes: Uint8Array): number {
  const pasp = boxes.find((box) => box.type === "pasp");
  if (!pasp || pasp.end - pasp.start < 8) return 1;
  const h = u32(bytes, pasp.start);
  const v = u32(bytes, pasp.start + 4);
  const ratio = h && v ? h / v : 1;
  return ratio >= PIXEL_RATIO_MIN && ratio <= PIXEL_RATIO_MAX ? ratio : 1;
}

/** O `profile_idc` da caixa `avcC` (o segundo byte), ou `null` sem ela. */
function profileOf(boxes: Box[], bytes: Uint8Array): number | null {
  const avcC = boxes.find((box) => box.type === "avcC");
  return avcC && avcC.end - avcC.start >= 2 ? bytes[avcC.start + 1] : null;
}

function trackInfo(bytes: Uint8Array, trak: Box): VideoTrackInfo | null {
  const handler = path(bytes, trak, ["mdia", "hdlr"]);
  if (!handler || typeAt(bytes, handler.start + 8) !== "vide") return null;
  const tkhd = child(bytes, trak, "tkhd");
  let rotated = false;
  let width = 0;
  let height = 0;
  if (tkhd) {
    const matrix = tkhd.start + 4 + (bytes[tkhd.start] === 1 ? 32 : 20) + 16;
    // A matriz é a b u / c d v / x y w; com b e c diferentes de 0, o quadro gira 90 ou 270 graus.
    rotated = i32(bytes, matrix + 4) !== 0 && i32(bytes, matrix + 12) !== 0;
    width = Math.round(u32(bytes, matrix + 36) / 65536);
    height = Math.round(u32(bytes, matrix + 40) / 65536);
  }
  const mdhd = path(bytes, trak, ["mdia", "mdhd"]);
  const stsd = path(bytes, trak, ["mdia", "minf", "stbl", "stsd"]);
  let codec: string | null = null;
  let pixelRatio = 1;
  let profile: number | null = null;
  if (stsd && stsd.end - stsd.start >= 16) {
    const entry = stsd.start + 8;
    codec = typeAt(bytes, entry + 4);
    const entryEnd = Math.min(entry + u32(bytes, entry), stsd.end);
    const inner = children(bytes, entry + VISUAL_ENTRY_FIXED, entryEnd);
    pixelRatio = pixelRatioOf(inner, bytes);
    profile = profileOf(inner, bytes);
    // A entrada visual traz a medida codificada (ISO 14496-12, VisualSampleEntry).
    if (entry + 36 <= stsd.end) {
      const codedWidth = u16(bytes, entry + 32);
      const codedHeight = u16(bytes, entry + 34);
      if (codedWidth && codedHeight) {
        width = codedWidth;
        height = codedHeight;
      }
    }
  }
  return { codec, width, height, rotated, pixelRatio, profile, durationMs: mdhd ? timing(bytes, mdhd) : null };
}

/** O conteúdo de um `moov` (sem o cabeçalho dele): a duração e a primeira faixa de vídeo. */
export function parseMoov(bytes: Uint8Array): { video: VideoTrackInfo | null; fragmented: boolean; durationMs: number | null } {
  const root: Box = { type: "moov", start: 0, end: bytes.length };
  const mvhd = child(bytes, root, "mvhd");
  let video: VideoTrackInfo | null = null;
  for (const trak of children(bytes, 0, bytes.length).filter((box) => box.type === "trak")) {
    video = trackInfo(bytes, trak);
    if (video) break;
  }
  // Fragmentado (com `mvex`): o `mvhd` e as faixas cobrem só o que está no
  // próprio `moov`, que pode ser o primeiro fragmento (um vídeo de 100 s
  // exportado assim entrava como 0:02), e a duração inteira só vem no `mehd`,
  // que muito export não traz. Ele é recusado, então a duração não é lida.
  if (child(bytes, root, "mvex")) return { video, fragmented: true, durationMs: null };
  const movie = mvhd ? timing(bytes, mvhd) : null;
  return { video, fragmented: false, durationMs: movie ?? video?.durationMs ?? null };
}

/**
 * Percorre as caixas do nível de cima pelo cabeçalho de cada uma (sem ler os
 * dados) até achar o `moov` e o `mdat`, e lê só o `moov`.
 */
export async function readMp4Info(read: ReadRange, size: number): Promise<Mp4Info> {
  const unreadable = new VideoCheckError("Não deu para ler este MP4. Exporte de novo em MP4 (H.264) e tente outra vez.");
  let offset = 0;
  let first = true;
  let moov: { start: number; end: number } | null = null;
  let mdatAt: number | null = null;
  while (offset + 8 <= size && (!moov || mdatAt === null)) {
    const head = await read(offset, Math.min(offset + 16, size));
    let boxSize = u32(head, 0);
    const type = typeAt(head, 4);
    let header = 8;
    if (first && type !== "ftyp") throw unreadable;
    first = false;
    if (boxSize === 1) {
      if (head.length < 16) throw unreadable;
      boxSize = u64(head, 8);
      header = 16;
    } else if (boxSize === 0) {
      boxSize = size - offset;
    }
    if (boxSize < header || offset + boxSize > size) throw unreadable;
    if (type === "moov" && !moov) moov = { start: offset + header, end: offset + boxSize };
    if (type === "mdat" && mdatAt === null) mdatAt = offset;
    offset += boxSize;
  }
  if (!moov || moov.end - moov.start > MOOV_READ_MAX) throw unreadable;
  const parsed = parseMoov(await read(moov.start, moov.end));
  return { faststart: mdatAt === null || moov.start < mdatAt, ...parsed };
}

/**
 * A medida como aparece na tela: a largura pela proporção do pixel (`pasp`) e,
 * no vídeo gravado de pé, girada 90 graus. O limite de 720p continua pela
 * medida codificada.
 */
export function displaySize(video: Pick<VideoTrackInfo, "width" | "height" | "rotated" | "pixelRatio">): { width: number; height: number } {
  // Lados inteiros, de 1 em diante: é o que vai no metadado.
  const width = Math.max(1, Math.round(video.width * (video.pixelRatio || 1)));
  const height = Math.max(1, Math.round(video.height));
  return video.rotated ? { width: height, height: width } : { width, height };
}

/** A medida em que o limite de 720p é aplicado: a codificada, só girada no vídeo de pé (sem o `pasp`). */
function limitSize(video: Pick<VideoTrackInfo, "width" | "height" | "rotated">): { width: number; height: number } {
  return video.rotated ? { width: video.height, height: video.width } : { width: video.width, height: video.height };
}

/** Os perfis do H.264 que tocam em todo aparelho: Baseline (66), Main (77) e High (100). */
const H264_PROFILES = new Set([66, 77, 100]);

/** As variantes do H.264 que não tocam em todo aparelho (os parâmetros dentro do fluxo, ou perfis raros). */
const H264_VARIANTS = new Set(["avc2", "avc3", "avc4"]);

/** Os segundos arredondados, os mesmos do limite e da linha "0:59". */
function roundedSeconds(durationMs: number): number {
  return Math.round(durationMs / 1000);
}

/**
 * "1 min 40 s": a duração na frase da recusa, com o mesmo arredondamento do
 * limite. Um vídeo recusado nunca aparece como "1 min".
 */
export function durationText(durationMs: number): string {
  const total = roundedSeconds(durationMs);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/**
 * O primeiro problema do vídeo, na ordem em que a pessoa resolve ao exportar de
 * novo; `null` quando passa. A duração vem logo depois da imagem: cortar é o
 * primeiro passo, e um 1080p de 100 s não passa por três recusas seguidas.
 */
export function videoInfoProblem(info: Mp4Info): string | null {
  const video = info.video;
  if (!video) return "O arquivo não tem imagem de vídeo. Escolha outro MP4.";
  // Antes da duração: no fragmentado ela não é lida, e a frase de não ter dado
  // para ler mandaria exportar de novo em MP4 sem dizer o que mudar.
  if (info.fragmented) return "Este MP4 está fragmentado. Exporte de novo em MP4 comum, sem fragmentar.";
  if (info.durationMs && roundedSeconds(info.durationMs) > VIDEO_MAX_SECONDS) {
    return `O vídeo tem ${durationText(info.durationMs)}. O limite é de 1 minuto: corte e exporte de novo.`;
  }
  if (video.codec === "hvc1" || video.codec === "hev1") {
    return "Vídeo em HEVC (H.265) não vale: alguns Android não tocam. Exporte em H.264 e tente de novo.";
  }
  if (video.codec && H264_VARIANTS.has(video.codec)) {
    return "Este H.264 é de uma variante que nem todo aparelho toca. Exporte de novo em MP4 H.264 padrão.";
  }
  if (video.codec !== "avc1") return "O vídeo precisa estar em H.264. Exporte de novo nesse formato.";
  if (video.profile === null || !H264_PROFILES.has(video.profile)) {
    return "O vídeo usa um perfil do H.264 que muitos aparelhos não tocam (como o High 10 ou o 4:2:2). Exporte em H.264 de 8 bits, 4:2:0, perfil High, Main ou Baseline.";
  }
  const short = Math.min(video.width, video.height);
  const long = Math.max(video.width, video.height);
  if (!short || !long) return "Não deu para ler a resolução do vídeo. Exporte de novo em MP4 (H.264).";
  if (short > VIDEO_MAX_SHORT_SIDE || long > VIDEO_MAX_LONG_SIDE) {
    // A frase diz a medida em que o limite vale: a codificada, de pé quando o vídeo foi gravado assim.
    const shown = limitSize(video);
    return `O vídeo tem ${shown.width}x${shown.height}. O limite é 720p (até 1280x720, ou 720x1280 de pé). Exporte numa resolução menor.`;
  }
  if (!info.faststart) {
    return 'O vídeo precisa do início rápido: exporte de novo com a opção "Web Optimized" ou "Fast Start" ligada.';
  }
  if (!info.durationMs) return "Não deu para ler a duração do vídeo. Exporte de novo em MP4 (H.264).";
  return null;
}

/** O metadado do vídeo que passou. */
export function videoMetaOf(info: Mp4Info): VideoMeta | null {
  if (!info.video || !info.durationMs) return null;
  return { durationMs: info.durationMs, ...displaySize(info.video) };
}

/** O metadado customizado do arquivo no Storage (texto, como o `width` e o `height` das imagens). */
export function videoCustomMetadata(meta: VideoMeta): Record<string, string> {
  return { durationMs: String(meta.durationMs), width: String(meta.width), height: String(meta.height) };
}

/** "0:06 · 640x360": a duração e a medida na tela, para a linha do vídeo escolhido. */
export function videoMetaText(meta: VideoMeta): string {
  const seconds = roundedSeconds(meta.durationMs);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · ${meta.width}x${meta.height}`;
}
