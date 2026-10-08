import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const events = await import("@/lib/events");

const sp = (local) => Date.parse(`${local}-03:00`);
const NOW = sp("2026-10-08T10:00:00");

test("o fuso sugerido pela UF é a cópia do servidor", () => {
  assert.equal(events.DEFAULT_TIME_ZONE_BY_STATE.BA, "America/Bahia");
  assert.equal(events.DEFAULT_TIME_ZONE_BY_STATE.SE, "America/Maceio");
  assert.equal(events.DEFAULT_TIME_ZONE_BY_STATE.AC, "America/Rio_Branco");
  assert.equal(events.BRAZIL_STATES.length, 27);
  assert.equal(events.BRAZIL_TIME_ZONES.length, 16);
  for (const zone of Object.values(events.DEFAULT_TIME_ZONE_BY_STATE)) assert.ok(events.isTimeZone(zone));
});

test("o show lido e a data no fuso dele", () => {
  const show = events.parseEvent("sj", {
    title: "São João de Irará",
    artistIds: ["nettobrito", "nenho"],
    city: "Irará",
    state: "BA",
    startsAt: Timestamp.fromMillis(Date.parse("2026-11-22T01:00:00Z")),
    startsAtLocal: "2026-11-21T22:00",
    timeZone: "America/Bahia",
    featured: true,
    status: "published",
    publishedAt: Timestamp.fromMillis(1),
  });
  const now = new Date(NOW);
  assert.equal(events.eventWhenText(show, now), "sáb, 21 nov, 22:00, horário da Bahia");
  assert.equal(events.eventWhenText({ startsAtLocal: "2026-12-20T21:00", timeZone: "America/Sao_Paulo" }, now), "dom, 20 dez, 21:00, horário de Brasília");
  assert.equal(events.isUpcoming(show, NOW), true);
  assert.equal(events.isUpcoming({ startsAt: new Date(sp("2026-10-07T23:00:00")) }, NOW), false);
  assert.equal(events.eventDeleteBlocked(show), events.WAS_PUBLISHED_EVENT_TEXT);
  assert.equal(events.unpublishWarning(1), "1 post de show perde a linha do show.");
  assert.equal(events.unpublishWarning(3), "3 posts de show perdem a linha do show.");
  assert.equal(events.parseEvent("x", { timeZone: "Europe/Lisbon" }).timeZone, "America/Sao_Paulo");
});

test("o formulário confere como o servidor e manda só o que mudou", () => {
  const form = { ...events.EMPTY_EVENT_FORM, title: "Show teste", artistIds: ["nettobrito", "nenho"], city: "Salvador", state: "BA", timeZone: "America/Bahia", startsAtLocal: "2026-12-20T21:00" };
  const { input } = events.validateEvent(form, NOW, true);
  assert.deepEqual(input, {
    title: "Show teste",
    artistIds: ["nettobrito", "nenho"],
    city: "Salvador",
    state: "BA",
    venue: null,
    startsAtLocal: "2026-12-20T21:00",
    timeZone: "America/Bahia",
    featured: false,
  });
  assert.equal(events.validateEvent({ ...form, artistIds: [] }, NOW, true).errors.artistIds, "De 1 a 6 centrais.");
  assert.equal(events.validateEvent({ ...form, startsAtLocal: "2026-10-01T21:00" }, NOW, true).errors.startsAtLocal, "A data já passou.");
  assert.equal(events.validateEvent({ ...form, startsAtLocal: "2026-10-01T21:00" }, NOW, false).errors.startsAtLocal, undefined);
  assert.equal(events.validateEvent({ ...form, startsAtLocal: "2029-01-01T21:00" }, NOW, true).errors.startsAtLocal, "No máximo 2 anos à frente.");
  assert.equal(events.validateEvent({ ...form, state: "" }, NOW, true).errors.state, "Escolha a UF.");
  assert.equal(events.validateEvent({ ...form, venue: "x".repeat(81) }, NOW, true).errors.venue, "Até 80 caracteres, numa linha.");

  const current = events.parseEvent("e1", { ...input, startsAt: Timestamp.fromMillis(1), status: "draft" });
  assert.deepEqual(events.eventChanges(current, { ...input, artistIds: ["nenho", "nettobrito"], featured: true }), { artistIds: ["nenho", "nettobrito"], featured: true });
  assert.deepEqual(events.moveArtist(["a", "b", "c"], "c", -1), ["a", "c", "b"]);
  assert.deepEqual(events.moveArtist(["a", "b"], "a", -1), ["a", "b"]);
});
