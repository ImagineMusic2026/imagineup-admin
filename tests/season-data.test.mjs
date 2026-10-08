import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const { getPastSeasons, getPodium, getSeasonState } = await import("@/lib/season-data");

const ts = (iso) => Timestamp.fromMillis(Date.parse(iso));

test("o config/season e o arquivo da temporada atual", async () => {
  firestore.reset();
  firestore.set("config/season", { version: 3, season: { id: "sj", name: "São João", startsAt: ts("2026-09-20T00:00:00Z"), endsAt: ts("2026-10-20T00:00:00Z") } });
  assert.deepEqual((await getSeasonState()).archiveStatus, null);
  firestore.set("seasons/sj", { status: "closing", startsAt: ts("2026-09-20T00:00:00Z"), endsAt: ts("2026-10-20T00:00:00Z") });
  const state = await getSeasonState();
  assert.equal(state.config.season.id, "sj");
  assert.equal(state.archiveStatus, "closing");
});

test("as temporadas passadas por startsAt e o pódio pela posição, no geral e numa central", async () => {
  firestore.reset();
  firestore.set("seasons/verao", { name: "Verão", startsAt: ts("2026-06-19T15:00:00Z"), endsAt: ts("2026-07-19T15:00:00Z"), rankedFans: 49 });
  firestore.set("seasons/carnaval", { name: "Carnaval", startsAt: ts("2026-07-29T15:00:00Z"), endsAt: ts("2026-08-28T15:00:00Z"), rankedFans: 49 });
  const past = await getPastSeasons();
  assert.deepEqual(past.map((item) => item.id), ["carnaval", "verao"]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "startsAt", direction: "desc" }]);
  assert.equal(firestore.queries.at(-1).limit, 20);

  firestore.set("seasons/verao/standings/a", { displayName: "A", position: 2, points: 90, centrals: { nenho: { position: 1, points: 40 } } });
  firestore.set("seasons/verao/standings/b", { displayName: "B", position: 1, points: 99 });
  const general = await getPodium("verao", null);
  assert.deepEqual(general.map((row) => [row.uid, row.position]), [["b", 1], ["a", 2]]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "position", direction: "asc" }]);
  const central = await getPodium("verao", "nenho");
  assert.deepEqual(central.map((row) => [row.uid, row.position, row.points]), [["a", 1, 40]]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "centrals.nenho.position", direction: "asc" }]);
});
