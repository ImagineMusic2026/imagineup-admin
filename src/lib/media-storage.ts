import { ref, uploadBytes, uploadBytesResumable, type FirebaseStorage } from "firebase/storage";

import { storage } from "@/lib/firebase";
import { IMAGE_CACHE_CONTROL, type EncodedImage, type ProcessedImage } from "@/lib/image-prep";

/**
 * Envio de mídia para o Storage, direto do navegador, sob o `storage.rules`
 * do app (quem edita a seção dona da pasta, para um documento que já existe).
 *
 * Cada envio usa um nome novo com cache de um ano: o app guarda a imagem pelo
 * endereço, então trocar a mídia é trocar o arquivo, nunca sobrescrever.
 * Largura e altura vão no metadado customizado, que a callable lê para gravar
 * no documento. O painel não apaga nada: ao gravar a mídia nova, o servidor
 * apaga os outros arquivos da pasta.
 */

export interface ImagePaths {
  /** A versão grande. */
  path: string;
  /** A miniatura, quando a imagem tem uma. */
  thumbPath: string | null;
}

/** `{pasta}/photo-{ts}-{largura}.webp` e `{pasta}/thumb-{ts}-{largura}.webp`. */
export function imagePaths(folder: string, processed: Pick<ProcessedImage, "large" | "thumb">, timestamp: number): ImagePaths {
  return {
    path: `${folder}/photo-${timestamp}-${processed.large.width}.${processed.large.extension}`,
    thumbPath: processed.thumb ? `${folder}/thumb-${timestamp}-${processed.thumb.width}.${processed.thumb.extension}` : null,
  };
}

function upload(instance: FirebaseStorage, path: string, image: EncodedImage) {
  return uploadBytes(ref(instance, path), image.blob, {
    contentType: image.contentType,
    cacheControl: IMAGE_CACHE_CONTROL,
    customMetadata: { width: String(image.width), height: String(image.height) },
  });
}

/** Sobe a versão grande e a miniatura juntas (`folder` como `posts/{id}`); devolve os caminhos para a callable. */
export async function uploadImage(folder: string, processed: ProcessedImage, timestamp = Date.now()): Promise<ImagePaths> {
  const paths = imagePaths(folder, processed, timestamp);
  const instance = storage();
  await Promise.all([
    upload(instance, paths.path, processed.large),
    processed.thumb && paths.thumbPath ? upload(instance, paths.thumbPath, processed.thumb) : Promise.resolve(),
  ]);
  return paths;
}

/**
 * Sobe um arquivo grande (o mp4 do post) em partes, com o progresso de 0 a 1.
 * A falha de rede no meio retoma sozinha algumas vezes antes de desistir.
 */
export function uploadFileResumable(
  path: string,
  file: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage(), path), file, { contentType, cacheControl: IMAGE_CACHE_CONTROL });
    task.on(
      "state_changed",
      (snapshot) => {
        if (snapshot.totalBytes > 0) onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes);
      },
      reject,
      () => resolve(),
    );
  });
}
