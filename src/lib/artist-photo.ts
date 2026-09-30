/**
 * Foto da central, preparada no navegador antes de subir para o Storage.
 *
 * A foto escolhida é aberta com `createImageBitmap` (que já gira a foto pela
 * orientação EXIF), recortada no centro para 3:4 sem distorcer e desenhada em
 * duas versões: 1200x1600 (capa e página) e 480x640 (cartões e listas), em
 * WebP. Se o navegador não codificar WebP (o Safari devolve PNG), sai JPEG.
 * Refazer a imagem também tira os metadados da câmera, como o GPS.
 *
 * As contas (recorte, nomes dos arquivos, tipos aceitos) são puras para os
 * testes rodarem no Node; só `processArtistPhoto` usa o navegador.
 */

export const PHOTO_SIZE = { width: 1200, height: 1600 } as const;
export const THUMB_SIZE = { width: 480, height: 640 } as const;

/** Abaixo disso (na área recortada) a foto é esticada demais: aviso, mas segue. */
export const SMALL_PHOTO = { width: 600, height: 800 } as const;

export const PHOTO_QUALITY = 0.82;

/** Arquivo de origem: acima disso o navegador pode ficar sem memória ao abrir. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Limite do `storage.rules` para cada arquivo enviado. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Valor do `accept` do campo de arquivo. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

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

/**
 * Maior retângulo 3:4 (ou outra proporção) no centro da foto, em pixels da
 * foto já girada. Foto larga perde as laterais; foto alta perde em cima e embaixo.
 */
export function centeredCrop(sourceWidth: number, sourceHeight: number, ratioWidth = 3, ratioHeight = 4): CropRect {
  const width = Math.max(1, Math.floor(sourceWidth));
  const height = Math.max(1, Math.floor(sourceHeight));
  if (width * ratioHeight > height * ratioWidth) {
    const cropWidth = Math.min(width, Math.max(1, Math.round((height * ratioWidth) / ratioHeight)));
    return { x: Math.floor((width - cropWidth) / 2), y: 0, width: cropWidth, height };
  }
  const cropHeight = Math.min(height, Math.max(1, Math.round((width * ratioHeight) / ratioWidth)));
  return { x: 0, y: Math.floor((height - cropHeight) / 2), width, height: cropHeight };
}

/** Área recortada menor que 600x800: a foto vai ficar borrada na capa. */
export function isSmallPhoto(crop: Size): boolean {
  return crop.width < SMALL_PHOTO.width || crop.height < SMALL_PHOTO.height;
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
export function photoFileProblem(file: { type: string; name: string; size: number }): string | null {
  const type = file.type.toLowerCase();
  const extension = extensionOf(file.name);
  if (type === "image/heic" || type === "image/heif" || extension === "heic" || extension === "heif") {
    return "Foto em HEIC não funciona aqui. Salve como JPG, PNG ou WebP e escolha de novo.";
  }
  const accepted = type
    ? (ACCEPTED_PHOTO_TYPES as readonly string[]).includes(type)
    : ["jpg", "jpeg", "png", "webp"].includes(extension);
  if (!accepted) return "Use uma foto em JPG, PNG ou WebP.";
  if (file.size <= 0) return "Este arquivo está vazio. Escolha outra foto.";
  if (file.size > MAX_SOURCE_BYTES) return "Foto grande demais. Use uma de até 25 MB.";
  return null;
}

export type ImageContentType = "image/webp" | "image/jpeg";

export interface EncodedImage extends Size {
  blob: Blob;
  contentType: ImageContentType;
  extension: "webp" | "jpg";
}

export interface ProcessedPhoto {
  photo: EncodedImage;
  thumb: EncodedImage;
  source: Size;
  crop: CropRect;
  /** Área recortada menor que 600x800. */
  small: boolean;
}

export interface ArtistPhotoPaths {
  photoPath: string;
  thumbPath: string;
}

/** `artists/{id}/photo-{ts}-1200.webp` e `artists/{id}/thumb-{ts}-480.webp`. */
export function artistImagePaths(artistId: string, timestamp: number, extension: EncodedImage["extension"] = "webp"): ArtistPhotoPaths {
  const folder = `artists/${artistId}`;
  return {
    photoPath: `${folder}/photo-${timestamp}-${PHOTO_SIZE.width}.${extension}`,
    thumbPath: `${folder}/thumb-${timestamp}-${THUMB_SIZE.width}.${extension}`,
  };
}

/** Erro com mensagem pronta para a tela. */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

function drawToCanvas(source: CanvasImageSource, crop: CropRect, size: Size): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new PhotoError("Este navegador não conseguiu preparar a foto. Tente no Chrome, no Edge ou no Firefox.");
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
  return new Promise((resolve) => canvas.toBlob(resolve, type, PHOTO_QUALITY));
}

/**
 * WebP quando o navegador sabe codificar; senão JPEG. O navegador que não
 * conhece o tipo pedido devolve outro (PNG) em silêncio, por isso a conferência
 * é pelo `blob.type`.
 */
async function encode(canvas: HTMLCanvasElement, preferred: ImageContentType | null): Promise<EncodedImage> {
  const size = { width: canvas.width, height: canvas.height };
  if (preferred !== "image/jpeg") {
    const webp = await canvasToBlob(canvas, "image/webp");
    if (webp && webp.type === "image/webp") return { blob: webp, contentType: "image/webp", extension: "webp", ...size };
  }
  const jpeg = await canvasToBlob(canvas, "image/jpeg");
  if (jpeg && jpeg.type === "image/jpeg") return { blob: jpeg, contentType: "image/jpeg", extension: "jpg", ...size };
  throw new PhotoError("Este navegador não conseguiu preparar a foto. Tente no Chrome, no Edge ou no Firefox.");
}

/** Abre, recorta e gera as duas versões da foto. Lança `PhotoError` com a mensagem da tela. */
export async function processArtistPhoto(file: File): Promise<ProcessedPhoto> {
  const problem = photoFileProblem(file);
  if (problem) throw new PhotoError(problem);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError("Não foi possível abrir esta foto. Tente outro arquivo em JPG, PNG ou WebP.");
  }

  try {
    const source = { width: bitmap.width, height: bitmap.height };
    const crop = centeredCrop(source.width, source.height);
    const large = resize(bitmap, crop, PHOTO_SIZE);
    const small = resize(large, { x: 0, y: 0, ...PHOTO_SIZE }, THUMB_SIZE);
    const photo = await encode(large, null);
    // As duas versões saem no mesmo formato, com o mesmo nome base no Storage.
    const thumb = await encode(small, photo.contentType);
    if (photo.blob.size > MAX_UPLOAD_BYTES || thumb.blob.size > MAX_UPLOAD_BYTES) {
      throw new PhotoError("A foto ficou maior que 5 MB depois de preparada. Tente outra foto.");
    }
    return { photo, thumb, source, crop, small: isSmallPhoto(crop) };
  } finally {
    bitmap.close();
  }
}
