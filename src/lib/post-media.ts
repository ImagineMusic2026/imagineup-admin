import { ImageError, processImage, processSource, type ProcessedImage } from "@/lib/image-prep";
import { uploadFileResumable, uploadImage } from "@/lib/media-storage";
import { POST_IMAGE_SPEC, videoFileProblem } from "@/lib/posts";
import { VideoCheckError, readMp4Info, videoCustomMetadata, videoInfoProblem, videoMetaOf, type VideoMeta } from "@/lib/video-check";

/**
 * A mídia do post no navegador: a foto (ou a capa do vídeo) recortada na
 * proporção dela entre 4:5 e 16:9, com a miniatura; a capa tirada de um
 * quadro do vídeo; o mp4 conferido pelas caixas dele (`video-check.ts`); e o
 * envio para `posts/{postId}/` (o mp4 em partes, com o progresso). O servidor
 * confere os arquivos no `updatePost`.
 */

export function preparePostImage(file: File): Promise<ProcessedImage> {
  return processImage(file, POST_IMAGE_SPEC);
}

function waitFor(video: HTMLVideoElement, event: "loadeddata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
      resolve();
    };
    const failed = () => {
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
      reject(new ImageError("Este navegador não conseguiu abrir o vídeo para tirar a capa. Envie uma imagem de capa."));
    };
    video.addEventListener(event, done);
    video.addEventListener("error", failed);
  });
}

/** A capa tirada de um quadro do vídeo (perto de 1 s, ou do meio nos vídeos curtos). */
export async function captureVideoFrame(file: File): Promise<ProcessedImage> {
  const problem = videoFileProblem(file);
  if (problem) throw new ImageError(problem);
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await waitFor(video, "loadeddata");
    const target = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(1, video.duration / 2) : 0;
    if (target > 0) {
      video.currentTime = target;
      await waitFor(video, "seeked");
    }
    if (!video.videoWidth || !video.videoHeight) throw new ImageError("O vídeo não tem imagem para a capa. Envie uma imagem de capa.");
    return await processSource(video, { width: video.videoWidth, height: video.videoHeight }, POST_IMAGE_SPEC);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Sobe a foto e a miniatura juntas; devolve os caminhos para o `updatePost`. */
export async function uploadPostImage(postId: string, processed: ProcessedImage): Promise<{ photoPath: string; thumbPath: string }> {
  const paths = await uploadImage(`posts/${postId}`, processed);
  if (!paths.thumbPath) throw new ImageError("A miniatura não foi gerada. Escolha a imagem de novo.");
  return { photoPath: paths.path, thumbPath: paths.thumbPath };
}

/**
 * Confere o mp4 escolhido: o arquivo (tipo e tamanho) e as caixas dele (codec,
 * faststart, resolução e duração), lendo só os cabeçalhos e o índice. Devolve
 * a duração e a medida na tela, ou lança `VideoCheckError` com a frase.
 */
export async function inspectPostVideo(file: File): Promise<VideoMeta> {
  const problem = videoFileProblem(file);
  if (problem) throw new VideoCheckError(problem);
  const info = await readMp4Info(async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()), file.size);
  const refused = videoInfoProblem(info);
  if (refused) throw new VideoCheckError(refused);
  const meta = videoMetaOf(info);
  if (!meta) throw new VideoCheckError("Não deu para ler a duração do vídeo. Exporte de novo em MP4 (H.264).");
  return meta;
}

/** Sobe o mp4 em partes, com o progresso de 0 a 1, e a duração e a medida no metadado do arquivo. */
export async function uploadPostVideo(
  postId: string,
  file: File,
  meta: VideoMeta,
  onProgress: (fraction: number) => void,
  timestamp = Date.now(),
): Promise<string> {
  const path = `posts/${postId}/video-${timestamp}.mp4`;
  await uploadFileResumable(path, file, "video/mp4", onProgress, videoCustomMetadata(meta));
  return path;
}
