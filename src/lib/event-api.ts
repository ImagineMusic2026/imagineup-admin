import { call } from "@/lib/callable";
import type { EventInput } from "@/lib/events";

/**
 * Callables da Agenda (21.9 e 26.5), para admin e editor com `artists`. O
 * `eventId` vem do painel: a nova tentativa do mesmo rascunho responde sem
 * criar outro. Toda mudança fica na auditoria do servidor.
 */

export function createEvent(input: { eventId: string } & EventInput): Promise<{ eventId: string }> {
  return call("createEvent", input);
}

/** Ausente não muda; `photo: null` tira a foto. */
export function updateEvent(input: { eventId: string; photo?: { photoPath: string } | null } & Partial<EventInput>): Promise<{ ok: true }> {
  return call("updateEvent", input);
}

export function setEventStatus(eventId: string, status: "published" | "unpublished"): Promise<{ ok: true }> {
  return call("setEventStatus", { eventId, status });
}

/** Só o rascunho que nunca foi ao ar e sem post nem recompensa ligados. */
export function deleteEvent(eventId: string): Promise<{ ok: true }> {
  return call("deleteEvent", { eventId });
}
