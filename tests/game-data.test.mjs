import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp, installFirestoreFake } from "./fakes/firestore.mjs";

const firestore = installFirestoreFake();
const data = await import("@/lib/game-data");
const { parseMission } = await import("@/lib/missions");

const sp = (local) => Date.parse(`${local}-03:00`);
const ts = (local) => Timestamp.fromMillis(sp(local));

test("os quatro documentos de configuração numa leitura cada", async () => {
  firestore.reset();
  firestore.set("config/missions", { version: 3, missions: [{ id: "m1", title: "A", action: "like", startsAt: ts("2026-10-01T00:00:00"), status: "active" }] });
  firestore.set("config/achievements", { version: 1, achievements: [] });
  firestore.set("config/season", { version: 7, season: { id: "sj", name: "São João", startsAt: ts("2026-09-19T00:00:00"), endsAt: ts("2026-10-19T00:00:00") } });
  const configs = await data.getGameConfigs();
  assert.equal(configs.missions.version, 3);
  assert.equal(configs.achievements.version, 1);
  assert.deepEqual(configs.points, { version: 0, config: null });
  assert.equal(configs.season.season.id, "sj");
  assert.deepEqual([...firestore.reads].sort(), ["config/achievements", "config/missions", "config/points", "config/season"]);
});

test("as arquivadas por archivedAt, até 50, com o id do documento", async () => {
  firestore.reset();
  firestore.set("missionArchive/velha", { title: "Velha", action: "like", startsAt: ts("2026-09-01T00:00:00"), archivedAt: ts("2026-09-10T00:00:00"), status: "archived" });
  firestore.set("missionArchive/nova", { title: "Nova", action: "share", startsAt: ts("2026-09-01T00:00:00"), archivedAt: ts("2026-10-01T00:00:00"), status: "archived" });
  const archived = await data.getArchivedMissions();
  assert.deepEqual(
    archived.map((item) => [item.id, item.status]),
    [
      ["nova", "archived"],
      ["velha", "archived"],
    ],
  );
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "archivedAt", direction: "desc" }]);
  assert.equal(firestore.queries.at(-1).limit, 50);
});

test("os alvos citados, um getDoc de cada; o apagado fica null", async () => {
  firestore.reset();
  firestore.set("posts/p1", { artistId: "nettobrito", text: "Clipe", status: "published", publishedAt: ts("2026-10-07T20:00:00") });
  firestore.set("events/e1", { title: "São João de Irará", city: "Irará", status: "draft", startsAt: ts("2026-11-21T22:00:00") });
  const keys = data.targetKeysOf([
    { target: { postId: "p1", artistId: "nettobrito", eventId: null } },
    { target: { postId: null, artistId: null, eventId: "e1" } },
    { target: { postId: "sumiu", artistId: "nenho", eventId: null } },
    { target: { postId: "p1", artistId: "nettobrito", eventId: null } },
    { target: null },
  ]);
  assert.deepEqual(keys, ["event:e1", "post:p1", "post:sumiu"]);
  const docs = await data.getTargetDocs(keys);
  assert.equal(docs.get("post:p1").text, "Clipe");
  assert.equal(docs.get("event:e1").status, "draft");
  assert.equal(docs.get("post:sumiu"), null);
});

test("a escolha do alvo: posts no ar da central e shows de hoje em diante, 20 por vez", async () => {
  firestore.reset();
  firestore.set("posts/a", { artistId: "nenho", status: "published", text: "A", publishedAt: ts("2026-10-01T10:00:00") });
  firestore.set("posts/b", { artistId: "nenho", status: "published", text: "B", publishedAt: ts("2026-10-05T10:00:00") });
  firestore.set("posts/c", { artistId: "nenho", status: "draft", text: "C" });
  firestore.set("posts/d", { artistId: "outro", status: "published", text: "D", publishedAt: ts("2026-10-06T10:00:00") });
  const posts = await data.getTargetPosts("nenho", null);
  assert.deepEqual(
    posts.items.map((item) => item.id),
    ["b", "a"],
  );
  assert.deepEqual(firestore.queries.at(-1).where, [
    { field: "artistId", op: "==", value: "nenho" },
    { field: "status", op: "==", value: "published" },
  ]);
  assert.deepEqual(firestore.queries.at(-1).orderBy, [{ field: "publishedAt", direction: "desc" }]);
  assert.equal(firestore.queries.at(-1).limit, 21);

  firestore.set("events/ontem", { title: "Ontem", artistIds: ["nenho"], startsAt: ts("2026-10-07T22:00:00") });
  firestore.set("events/hoje", { title: "Hoje", artistIds: ["nenho", "nettobrito"], startsAt: ts("2026-10-08T01:00:00") });
  firestore.set("events/depois", { title: "Depois", artistIds: ["nenho"], startsAt: ts("2026-11-21T22:00:00"), status: "draft" });
  const events = await data.getTargetEvents("nenho", sp("2026-10-08T15:00:00"), null);
  assert.deepEqual(
    events.items.map((item) => item.id),
    ["hoje", "depois"],
  );
  const sent = firestore.queries.at(-1);
  assert.deepEqual(sent.where[0], { field: "artistIds", op: "array-contains", value: "nenho" });
  assert.equal(sent.where[1].field, "startsAt");
  assert.equal(sent.where[1].op, ">=");
  assert.equal(sent.where[1].value.toMillis(), sp("2026-10-08T00:00:00"));
  assert.deepEqual(sent.orderBy, [{ field: "startsAt", direction: "asc" }]);
});

test("a versão gravada do catálogo diz quem gravou", async () => {
  firestore.reset();
  const nova = { id: "nova", title: "Nova", action: "like", startsAt: ts("2026-10-08T00:00:00"), status: "draft" };
  firestore.set("config/missions/versions/5", { updatedBy: { uid: "eu", name: "Eu" }, missions: [nova] });
  assert.deepEqual(await data.getMissionsVersion(5), { updatedByUid: "eu", missions: [parseMission(nova)] });
  assert.equal(await data.getMissionsVersion(6), null);
});

test("conclusões e desbloqueios somados nos dias da faixa", async () => {
  firestore.reset();
  firestore.set("statsMeta/close", { lastClosedDay: "2026-10-07" });
  firestore.set("statsDaily/2026-10-06", { day: "2026-10-06", closed: true, byMission: { m1: { completed: 3 } }, byAchievement: { a1: { unlocked: 1 } } });
  firestore.set("statsDaily/2026-10-07", { day: "2026-10-07", closed: true, byMission: { m1: { completed: 2 }, m2: { completed: 5 } } });
  const now = sp("2026-10-08T09:00:00");
  const range = { from: "2026-10-01", to: "2026-10-07" };
  assert.deepEqual((await data.getMissionConclusions(range, now)).byId, { m1: 5, m2: 5 });
  assert.deepEqual((await data.getAchievementUnlocks(range, now)).byId, { a1: 1 });
});
