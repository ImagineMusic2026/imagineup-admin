/**
 * Imagem preparada no navegador antes de subir para o Storage: a parte
 * genérica da foto das centrais (`artist-photo.ts`), para os posts do mural,
 * os shows e as recompensas.
 *
 * A imagem é aberta com `createImageBitmap` (que já gira pela orientação
 * EXIF), recortada no centro (numa proporção fixa, ou na faixa de proporções
 * dada, sem mexer na que já está dentro dela) e desenhada em até duas
 * versões, em WebP; se o navegador não codificar WebP (o Safari devolve PNG),
 * sai JPEG. Refazer a imagem também tira os metadados da câmera, como o GPS.
 *
 * As contas (recorte, tamanhos, tipos aceitos) são puras para os testes
 * rodarem no Node; só `processImage` usa o navegador.
 */

export const IMAGE_QUALITY = 0.82;

/** Arquivo de origem: acima disso o navegador pode ficar sem memória ao abrir. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Limite do `storage.rules` para cada imagem enviada. */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Valor do `accept` do campo de arquivo. */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/** Nome novo a cada envio: o cache dos aparelhos pode guardar o arquivo para sempre. */
export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Fundo das áreas transparentes (PNG): o mesmo fundo escuro do app. */
const BACKGROUND = "#0b0b10";

export interface Size {
  width: number;
  height: number;
}

export interface CropRect extends Size {
  x: number;
  y: number;
}

/** Faixa de proporções (largura sobre altura): 4:5 a 16:9 é `{ min: 0.8, max: 1.777... }`. */
export interface AspectRange {
  min: number;
  max: number;
}

export interface ImageSpec {
  /** Proporção fixa (largura sobre altura). Sem ela, vale a `aspectRange`. */
  aspect?: number;
  /** Faixa aceita quando a proporção não é fixa: fora dela, recorta até a borda mais perto. */
  aspectRange?: AspectRange;
  /**
   * Largura da versão grande. Com `aspect`, é a largura exata (a foto pequena
   * é esticada, com o aviso `small`); com `aspectRange`, é o máximo (a foto
   * menor fica do tamanho dela).
   */
  large: number;
  /** Largura da miniatura, com a mesma regra; sem ela, só a versão grande. */
  thumb?: number;
  /** Abaixo desta largura recortada, o aviso de foto pequena. Padrão: metade de `large`. */
  minWidth?: number;
}

/** Maior retângulo na proporção `aspect` (largura sobre altura) no centro da imagem. */
export function centeredCrop(sourceWidth: number, sourceHeight: number, aspect: number): CropRect {
  const width = Math.max(1, Math.floor(sourceWidth));
  const height = Math.max(1, Math.floor(sourceHeight));
  if (width / height > aspect) {
    const cropWidth = Math.min(width, Math.max(1, Math.round(height * aspect)));
    return { x: Math.floor((width - cropWidth) / 2), y: 0, width: cropWidth, height };
  }
  const cropHeight = Math.min(height, Math.max(1, Math.round(width / aspect)));
  return { x: 0, y: Math.floor((height - cropHeight) / 2), width, height: cropHeight };
}

/** O recorte de uma imagem pela especificação: a proporção fixa, ou a da imagem trazida para dentro da faixa. */
export function cropForSpec(sourceWidth: number, sourceHeight: number, spec: Pick<ImageSpec, "aspect" | "aspectRange">): CropRect {
  if (spec.aspect) return centeredCrop(sourceWidth, sourceHeight, spec.aspect);
  const ratio = Math.max(1, sourceWidth) / Math.max(1, sourceHeight);
  const range = spec.aspectRange;
  if (!range || (ratio >= range.min && ratio <= range.max)) {
    return { x: 0, y: 0, width: Math.max(1, Math.floor(sourceWidth)), height: Math.max(1, Math.floor(sourceHeight)) };
  }
  return centeredCrop(sourceWidth, sourceHeight, ratio < range.min ? range.min : range.max);
}

/** Tamanho de saída de um recorte para a largura pedida (exata ou no máximo). */
export function outputSize(crop: Size, width: number, exact: boolean): Size {
  const target = exact ? width : Math.min(width, crop.width);
  return { width: Math.max(1, Math.round(target)), height: Math.max(1, Math.round((target * crop.height) / crop.width)) };
}

/** Recorte mais estreito que o mínimo: a imagem vai ficar borrada. */
export function isSmallImage(crop: Size, spec: Pick<ImageSpec, "large" | "minWidth">): boolean {
  return crop.width < (spec.minWidth ?? spec.large / 2);
}

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Problema do arquivo antes de abrir, ou `null`. HEIC (fotos do iPhone) tem
 * mensagem própria: o Chrome não abre esse formato. Sem tipo informado (o
 * Windows às vezes não sabe), vale a extensão.
 */
export function imageFileProblem(file: { type: string; name: string; size: number }): string | null {
  const type = file.type.toLowerCase();
  const extension = extensionOf(file.name);
  if (type === "image/heic" || type === "image/heif" || extension === "heic" || extension === "heif") {
    return "Imagem em HEIC não funciona aqui. Salve como JPG, PNG ou WebP e escolha de novo.";
  }
  const accepted = type
    ? (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)
    : ["jpg", "jpeg", "png", "webp"].includes(extension);
  if (!accepted) return "Use uma imagem em JPG, PNG ou WebP.";
  if (file.size <= 0) return "Este arquivo está vazio. Escolha outra imagem.";
  if (file.size > MAX_SOURCE_BYTES) return "Imagem grande demais. Use uma de até 25 MB.";
  return null;
}

export type ImageContentType = "image/webp" | "image/jpeg";

export interface EncodedImage extends Size {
  blob: Blob;
  contentType: ImageContentType;
  extension: "webp" | "jpg";
}

export interface ProcessedImage {
  large: EncodedImage;
  thumb: EncodedImage | null;
  source: Size;
  crop: CropRect;
  /** Recorte mais estreito que o mínimo da especificação. */
  small: boolean;
}

/** Erro com mensagem pronta para a tela. */
export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
  }
}

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

const BROWSER_FAILED = "Este navegador não conseguiu preparar a imagem. Tente no Chrome, no Edge ou no Firefox.";

function drawToCanvas(source: CanvasImageSource, crop: CropRect, size: Size): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageError(BROWSER_FAILED);
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  return canvas;
}

/** Reduz pela metade até chegar perto do tamanho final: fica mais nítido que um salto só. */
function resize(source: CanvasImageSource, crop: CropRect, size: Size): HTMLCanvasElement {
  let current = source;
  let rect = crop;
  while (rect.width >= size.width * 2 && rect.height >= size.height * 2) {
    const half = { width: Math.round(rect.width / 2), height: Math.round(rect.height / 2) };
    current = drawToCanvas(current, rect, half);
    rect = { x: 0, y: 0, ...half };
  }
  return drawToCanvas(current, rect, size);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, IMAGE_QUALITY));
}

/** WebP quando o navegador sabe codificar; senão JPEG (conferido pelo `blob.type`). */
export async function encodeCanvas(canvas: HTMLCanvasElement, preferred: ImageContentType | null = null): Promise<EncodedImage> {
  const size = { width: canvas.width, height: canvas.height };
  if (preferred !== "image/jpeg") {
    const webp = await canvasToBlob(canvas, "image/webp");
    if (webp && webp.type === "image/webp") return { blob: webp, contentType: "image/webp", extension: "webp", ...size };
  }
  const jpeg = await canvasToBlob(canvas, "image/jpeg");
  if (jpeg && jpeg.type === "image/jpeg") return { blob: jpeg, contentType: "image/jpeg", extension: "jpg", ...size };
  throw new ImageError(BROWSER_FAILED);
}

/**
 * Recorta e gera as versões de uma imagem já aberta (um arquivo, ou o quadro
 * de um vídeo desenhado num canvas).
 */
export async function processSource(source: CanvasImageSource, sourceSize: Size, spec: ImageSpec): Promise<ProcessedImage> {
  const crop = cropForSpec(sourceSize.width, sourceSize.height, spec);
  const exact = Boolean(spec.aspect);
  const largeCanvas = resize(source, crop, outputSize(crop, spec.large, exact));
  const large = await encodeCanvas(largeCanvas);
  let thumb: EncodedImage | null = null;
  if (spec.thumb) {
    const full = { x: 0, y: 0, width: largeCanvas.width, height: largeCanvas.height };
    // As duas versões saem no mesmo formato.
    thumb = await encodeCanvas(resize(largeCanvas, full, outputSize(full, spec.thumb, exact)), large.contentType);
  }
  if (large.blob.size > MAX_IMAGE_UPLOAD_BYTES || (thumb && thumb.blob.size > MAX_IMAGE_UPLOAD_BYTES)) {
    throw new ImageError("A imagem ficou maior que 5 MB depois de preparada. Tente outra.");
  }
  return { large, thumb, source: sourceSize, crop, small: isSmallImage(crop, spec) };
}

/** Abre, recorta e gera as versões de um arquivo. Lança `ImageError` com a mensagem da tela. */
export async function processImage(file: File, spec: ImageSpec): Promise<ProcessedImage> {
  const problem = imageFileProblem(file);
  if (problem) throw new ImageError(problem);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError("Não foi possível abrir esta imagem. Tente outro arquivo em JPG, PNG ou WebP.");
  }
  try {
    return await processSource(bitmap, { width: bitmap.width, height: bitmap.height }, spec);
  } finally {
    bitmap.close();
  }
}
