/**
 * O vídeo dos posts, conferido no navegador antes do envio (pergunta 15 da
 * seção 33 da nota do app), puro: lê as caixas do MP4 sem carregar o arquivo
 * inteiro e confere o que o app precisa para tocar em todo aparelho.
 *
 * - Só H.264 (`avc1`); HEVC (`hvc1` ou `hev1`) não toca em alguns Android.
 * - O índice (`moov`) antes dos dados (`mdat`), o "faststart": sem ele, o
 *   vídeo só começa depois de baixar quase tudo.
 * - Até 720p (o lado menor até 720 e o maior até 1280) e 20 MB.
 *
 * A duração e a medida na tela (já virada, quando o vídeo foi gravado de pé)
 * vão no metadado do arquivo, ao lado do `width` e do `height` das imagens: o
 * `updatePost` de hoje grava do vídeo só `{ url, path, size }`.
 */

export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MAX_SHORT_SIDE = 720;
export const VIDEO_MAX_LONG_SIDE = 1280;
/** Teto da leitura do índice: um `moov` de vídeo curto tem poucos KB. */
const MOOV_READ_MAX = 16 * 1024 * 1024;

export const VIDEO_RULES_TEXT = "MP4 em H.264, até 720p e 20 MB, com o início rápido (faststart). MOV não vale: exporte em MP4.";

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
  durationMs: number | null;
}

export interface Mp4Info {
  /** O `moov` vem antes do `mdat`. */
  faststart: boolean;
  /** A primeira faixa de vídeo, ou `null` sem nenhuma. */
  video: VideoTrackInfo | null;
  /** A duração do filme (`mvhd`), ou a da faixa quando o filme não traz. */
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

/** `{ timescale, duration }` de um `mvhd` ou `mdhd` (versão 0 ou 1). */
function timing(bytes: Uint8Array, box: Box): number | null {
  const version = bytes[box.start];
  const base = box.start + 4;
  const timescale = version === 1 ? u32(bytes, base + 16) : u32(bytes, base + 8);
  const duration = version === 1 ? u64(bytes, base + 20) : u32(bytes, base + 12);
  // Duração "desconhecida" (todos os bits ligados) ou zero: sem duração.
  if (!timescale || !duration || duration === 0xffffffff || duration >= 2 ** 53 - 1) return null;
  return Math.round((duration / timescale) * 1000);
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
  if (stsd && stsd.end - stsd.start >= 16) {
    const entry = stsd.start + 8;
    codec = typeAt(bytes, entry + 4);
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
  return { codec, width, height, rotated, durationMs: mdhd ? timing(bytes, mdhd) : null };
}

/** O conteúdo de um `moov` (sem o cabeçalho dele): a duração e a primeira faixa de vídeo. */
export function parseMoov(bytes: Uint8Array): { video: VideoTrackInfo | null; durationMs: number | null } {
  const root: Box = { type: "moov", start: 0, end: bytes.length };
  const mvhd = child(bytes, root, "mvhd");
  let video: VideoTrackInfo | null = null;
  for (const trak of children(bytes, 0, bytes.length).filter((box) => box.type === "trak")) {
    video = trackInfo(bytes, trak);
    if (video) break;
  }
  const movie = mvhd ? timing(bytes, mvhd) : null;
  return { video, durationMs: movie ?? video?.durationMs ?? null };
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

/** A medida como aparece na tela: o vídeo gravado de pé gira 90 graus. */
export function displaySize(video: Pick<VideoTrackInfo, "width" | "height" | "rotated">): { width: number; height: number } {
  return video.rotated ? { width: video.height, height: video.width } : { width: video.width, height: video.height };
}

/** O primeiro problema do vídeo, na ordem em que a pessoa resolve ao exportar de novo; `null` quando passa. */
export function videoInfoProblem(info: Mp4Info): string | null {
  const video = info.video;
  if (!video) return "O arquivo não tem imagem de vídeo. Escolha outro MP4.";
  if (video.codec === "hvc1" || video.codec === "hev1") {
    return "Vídeo em HEVC (H.265) não vale: alguns Android não tocam. Exporte em H.264 e tente de novo.";
  }
  if (video.codec !== "avc1") return "O vídeo precisa estar em H.264. Exporte de novo nesse formato.";
  const short = Math.min(video.width, video.height);
  const long = Math.max(video.width, video.height);
  if (!short || !long) return "Não deu para ler a resolução do vídeo. Exporte de novo em MP4 (H.264).";
  if (short > VIDEO_MAX_SHORT_SIDE || long > VIDEO_MAX_LONG_SIDE) {
    return `O vídeo tem ${video.width}x${video.height}. O limite é 720p (até 1280x720, ou 720x1280 de pé). Exporte numa resolução menor.`;
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
  const seconds = Math.round(meta.durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · ${meta.width}x${meta.height}`;
}
