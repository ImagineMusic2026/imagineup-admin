import type { ArtistStatus, CreateArtistInput, HandleCheckResult, UpdateArtistInput } from "@/lib/artists";
import { call } from "@/lib/callable";

/**
 * Chamadas às Cloud Functions dos artistas (callables em southamerica-east1),
 * com os formatos do contrato. Toda gravação em `artists`, `artistPrivate` e
 * na reserva do @ (`usernames/`) é do servidor, que confere o acesso lendo
 * `staff/{uid}` a cada chamada e grava a auditoria.
 *
 * Erros chegam como `FunctionsError` com `details.reason`; a tela traduz com
 * `callableErrorMessage` (errors.ts).
 */

/** Quem vê a seção: o @ está livre? */
export function checkArtistHandle(handle: string): Promise<HandleCheckResult> {
  return call<{ handle: string }, HandleCheckResult>("checkArtistHandle", { handle });
}

/** Cria o rascunho (sem fotos) e o privado dele na mesma transação e reserva o @. */
export function createArtist(input: CreateArtistInput): Promise<{ artistId: string }> {
  return call<CreateArtistInput, { artistId: string }>("createArtist", input);
}

/** Campos ausentes não mudam; `null` limpa os opcionais. O servidor grava cada campo no documento certo. */
export function updateArtist(input: UpdateArtistInput): Promise<{ ok: true }> {
  return call<UpdateArtistInput, { ok: true }>("updateArtist", input);
}

export function setArtistStatus(artistId: string, status: Exclude<ArtistStatus, "draft">): Promise<{ ok: true }> {
  return call<{ artistId: string; status: Exclude<ArtistStatus, "draft"> }, { ok: true }>("setArtistStatus", { artistId, status });
}

/** A lista completa, na ordem nova (o servidor grava `order` = posição). */
export function reorderArtists(artistIds: string[]): Promise<{ ok: true }> {
  return call<{ artistIds: string[] }, { ok: true }>("reorderArtists", { artistIds });
}

/**
 * Só admin, em qualquer status, e nunca central com fãs (reason `has-fans`).
 * O servidor apaga os dois documentos, a reserva do @ e as fotos.
 */
export function deleteArtist(artistId: string): Promise<{ ok: true }> {
  return call<{ artistId: string }, { ok: true }>("deleteArtist", { artistId });
}
