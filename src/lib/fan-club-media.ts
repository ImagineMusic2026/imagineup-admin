import { getDownloadURL, ref } from "firebase/storage";

import type { FanClubPost } from "@/lib/fan-clubs";
import { storage } from "@/lib/firebase";

/**
 * As fotos da publicação oculta e da tirada do ar (34.10, item 5): o servidor
 * trocou o token de download (a URL guardada na `media` não abre mais, 34.19),
 * e a equipe com a seção Fã-clubes lê os arquivos pelo caminho, com o SDK do
 * Storage, porque a regra de `fanClubMedia/{uid}/` dá a leitura à seção
 * (34.22, etapa 2). As URLs vivem só na tela.
 */
export async function getPostMediaUrls(post: Pick<FanClubPost, "media">): Promise<{ photo: string; thumb: string } | null> {
  if (!post.media) return null;
  const [photo, thumb] = await Promise.all([getDownloadURL(ref(storage(), post.media.photo.path)), getDownloadURL(ref(storage(), post.media.thumb.path))]);
  return { photo, thumb };
}
