import { ref, uploadBytes, type FirebaseStorage } from "firebase/storage";

import { IMAGE_CACHE_CONTROL, artistImagePaths, type ArtistPhotoPaths, type EncodedImage, type ProcessedPhoto } from "@/lib/artist-photo";
import { storage } from "@/lib/firebase";

/**
 * Envio das duas versões da foto da central para `artists/{artistId}/`.
 *
 * Cada envio usa um nome novo (`photo-{ts}-1200.webp`, `thumb-{ts}-480.webp`)
 * com cache de um ano: o app guarda a imagem pelo endereço, então trocar a
 * foto é trocar o arquivo, nunca sobrescrever. Largura e altura vão no
 * metadado customizado, que o `updateArtist` lê para gravar no documento.
 *
 * Quem pode enviar é decidido pelo `storage.rules` do app (quem edita artistas,
 * imagem de até 5 MB). Os arquivos antigos ficam: quem apaga é o servidor.
 */

function upload(instance: FirebaseStorage, path: string, image: EncodedImage) {
  return uploadBytes(ref(instance, path), image.blob, {
    contentType: image.contentType,
    cacheControl: IMAGE_CACHE_CONTROL,
    customMetadata: { width: String(image.width), height: String(image.height) },
  });
}

/** Sobe a foto e a miniatura juntas; devolve os caminhos para o `updateArtist`. */
export async function uploadArtistPhoto(artistId: string, photo: ProcessedPhoto, timestamp = Date.now()): Promise<ArtistPhotoPaths> {
  const paths = artistImagePaths(artistId, timestamp, photo.photo.extension);
  const instance = storage();
  await Promise.all([upload(instance, paths.photoPath, photo.photo), upload(instance, paths.thumbPath, photo.thumb)]);
  return paths;
}
