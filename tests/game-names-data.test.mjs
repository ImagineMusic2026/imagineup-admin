import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const { createGameNamesReader, titlesOf } = await import("@/lib/game-names-data");

test("os títulos do catálogo, sem item torto e sem id repetido", () => {
  const titles = titlesOf(
    {
      missions: [
        { id: "curtir-3", title: " Curta 3 posts " },
        { id: "curtir-3", title: "Repetida" },
        { id: "sem-titulo" },
        "lixo",
      ],
    },
    "missions",
  );
  assert.deepEqual([...titles], [["curtir-3", "Curta 3 posts"]]);
  assert.equal(titlesOf(undefined, "achievements").size, 0);
});

test("missões do catálogo e arquivadas, com cache por abertura de tela", async () => {
  firestore.reset();
  firestore.set("config/missions", { version: 3, missions: [{ id: "curtir-3", title: "Curta 3 posts" }] });
  firestore.set("missionArchive/antiga", { id: "antiga", title: "Missão de setembro", status: "archived" });
  const reader = createGameNamesReader();

  const first = await reader.missionTitles(["curtir-3", "antiga", "sumiu"]);
  assert.deepEqual(Object.fromEntries(first), { "curtir-3": "Curta 3 posts", antiga: "Missão de setembro" });
  assert.deepEqual(firestore.reads, ["config/missions", "missionArchive/antiga", "missionArchive/sumiu"]);

  await reader.missionTitles(["curtir-3", "antiga"]);
  assert.equal(firestore.reads.length, 3);
});

test("nomes das conquistas numa leitura só", async () => {
  firestore.reset();
  firestore.set("config/achievements", { version: 1, achievements: [{ id: "nivel-7", title: "Purainha" }] });
  const reader = createGameNamesReader();
  assert.deepEqual(Object.fromEntries(await reader.achievementNames()), { "nivel-7": "Purainha" });
  await reader.achievementNames();
  assert.deepEqual(firestore.reads, ["config/achievements"]);
});

test("uma falha não fica no cache", async () => {
  firestore.reset();
  firestore.set("config/achievements", { version: 1, achievements: [{ id: "a", title: "A" }] });
  const reader = createGameNamesReader();
  firestore.failNext(Object.assign(new Error("sem rede"), { code: "unavailable" }));
  await assert.rejects(reader.achievementNames());
  assert.deepEqual(Object.fromEntries(await reader.achievementNames()), { a: "A" });
});
