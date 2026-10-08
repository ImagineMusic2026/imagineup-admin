import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const missions = await import("@/lib/missions");

/** Um instante pela hora de São Paulo (UTC-3, sem horário de verão). */
const sp = (local) => Date.parse(`${local}-03:00`);
const ts = (local) => Timestamp.fromMillis(sp(local));

const NOW = sp("2026-10-08T10:00:00");

function mission(fields = {}) {
  return missions.parseMission({
    id: "m-1",
    title: "Curta 5 posts",
    action: "like",
    target: { postId: null, artistId: "nenho", eventId: null },
    goal: 5,
    period: "daily",
    rewardPoints: 10,
    featured: false,
    startsAt: ts("2026-10-01T00:00:00"),
    endsAt: null,
    status: "active",
    activatedAt: ts("2026-10-01T00:00:00"),
    ...fields,
  });
}

test("o catálogo lido, com a meta e quem gravou", () => {
  const catalog = missions.parseMissionsCatalog({
    version: 4,
    missions: [
      { id: "m-1", title: "A", action: "like", startsAt: ts("2026-10-01T00:00:00"), status: "active", target: null },
      { id: "quebrada", title: "B" },
    ],
    seasonGoal: { seasonId: "sao-joao", title: "Semana", description: "Faça 20", reachedDescription: null, metric: "missions", target: 20 },
    updatedAt: ts("2026-10-07T12:00:00"),
    updatedBy: { uid: "u1", name: "Ana" },
  });
  assert.equal(catalog.version, 4);
  assert.deepEqual(
    catalog.missions.map((item) => item.id),
    ["m-1"],
  );
  assert.equal(catalog.missions[0].goal, 1);
  assert.equal(catalog.seasonGoal.target, 20);
  assert.equal(catalog.updatedBy, "Ana");
  assert.deepEqual(missions.parseMissionsCatalog(undefined), { version: 0, missions: [], seasonGoal: null, updatedAt: null, updatedBy: null });
});

test("a situação como o app: rascunho, no ar, agendada, encerrada e arquivada", () => {
  assert.equal(missions.missionState(mission({ status: "draft" }), NOW), "draft");
  assert.equal(missions.missionState(mission(), NOW), "active");
  assert.equal(missions.missionState(mission({ startsAt: ts("2026-10-09T00:00:00") }), NOW), "scheduled");
  assert.equal(missions.missionState(mission({ endsAt: ts("2026-10-08T09:59:00") }), NOW), "ended");
  assert.equal(missions.missionState(mission({ status: "archived" }), NOW), "archived");
});

test("a trava depois do começo vale também dentro do cache de 60 s", () => {
  assert.equal(missions.isMissionLocked(mission(), NOW), true);
  assert.equal(missions.isMissionLocked(mission({ activatedAt: null, status: "draft" }), NOW), false);
  assert.equal(missions.isMissionLocked(mission({ startsAt: ts("2026-10-08T10:00:30") }), NOW), true);
  assert.equal(missions.isMissionLocked(mission({ startsAt: ts("2026-10-08T10:05:00") }), NOW), false);
});

test("o uso do catálogo conta as no ar pelo status", () => {
  const list = [mission(), mission({ id: "m-2", status: "draft" }), mission({ id: "m-3", endsAt: ts("2026-10-02T00:00:00") })];
  assert.equal(missions.catalogUsage(list), "2 de 30 no ar. 3 de 60 no catálogo.");
});

test("o formulário: o alvo pelo tipo, a meta 1 no alvo único e a janela", () => {
  const base = { ...missions.emptyMissionForm(NOW), title: "Curta o clipe", rewardPoints: "15", startsAt: "2026-10-08T00:00" };
  assert.equal(base.startsAt, "2026-10-08T00:00");

  const post = missions.validateMission({ ...base, targetKind: "post", artistId: "nettobrito", postId: "p-clipe", goal: "7" });
  assert.deepEqual(post.errors, {});
  assert.deepEqual(post.input, {
    title: "Curta o clipe",
    action: "like",
    target: { postId: "p-clipe", artistId: "nettobrito", eventId: null },
    goal: 1,
    period: "daily",
    rewardPoints: 15,
    featured: false,
    startsAt: sp("2026-10-08T00:00:00"),
    endsAt: null,
  });

  assert.equal(missions.validateMission({ ...base, action: "invite", targetKind: "artist", artistId: "nenho" }).errors.targetKind, "Esse alvo não vale para esse tipo de missão.");
  assert.equal(missions.validateMission({ ...base, targetKind: "post", artistId: "nenho" }).errors.postId, "Escolha o post.");
  assert.equal(missions.validateMission({ ...base, goal: "51" }).errors.goal, "De 1 a 50.");
  assert.equal(missions.validateMission({ ...base, rewardPoints: "0" }).errors.rewardPoints, "De 1 a 10.000 pontos.");
  assert.equal(missions.validateMission({ ...base, title: " " }).errors.title, "Escreva o título, até 80 caracteres.");
  assert.equal(missions.validateMission({ ...base, endsAt: "2026-10-07T00:00" }).errors.endsAt, "O fim precisa vir depois do início.");
  assert.equal(missions.validateMission({ ...base, endsAt: "2027-10-10T00:00" }).errors.endsAt, "No máximo 366 dias.");
  assert.equal(missions.isSingleTarget("rsvp", "event"), true);
  assert.equal(missions.isSingleTarget("join", "artist"), true);
  assert.equal(missions.isSingleTarget("share", "post"), false);
  assert.deepEqual(missions.targetOf({ targetKind: "event", artistId: "nenho", postId: "", eventId: "e1" }), { postId: null, artistId: null, eventId: "e1" });
  assert.equal(missions.targetOf({ targetKind: "none", artistId: "nenho", postId: "", eventId: "" }), null);
});

test("só o que mudou vai para o updateMission; travada, os campos do começo ficam de fora", () => {
  const current = mission();
  const form = { ...missions.missionFormOf(current), title: "Curta 6 posts", goal: "6", rewardPoints: "12" };
  const { input } = missions.validateMission(form);
  assert.deepEqual(missions.missionChanges(current, input, false), { title: "Curta 6 posts", rewardPoints: 12, goal: 6 });
  assert.deepEqual(missions.missionChanges(current, input, true), { title: "Curta 6 posts", rewardPoints: 12 });
  assert.deepEqual(missions.missionChanges(current, missions.validateMission(missions.missionFormOf(current)).input, false), {});
  assert.equal(missions.missionFieldOf("mission.goal"), "goal");
  assert.equal(missions.missionFieldOf("mission.target.postId"), "postId");
  assert.equal(missions.missionFieldOf("mission"), null);
});

test("os filtros: situação, central (com sem central), período e temporada pela janela", () => {
  const list = [
    mission({ id: "a" }),
    mission({ id: "b", status: "draft", target: null, period: "weekly" }),
    mission({ id: "c", target: { postId: null, artistId: null, eventId: "e1" }, startsAt: ts("2026-12-01T00:00:00") }),
  ];
  const windows = missions.seasonWindows({
    season: { id: "sj", name: "São João", startsAt: new Date(sp("2026-09-19T00:00:00")), endsAt: new Date(sp("2026-10-19T00:00:00")) },
    next: { id: "natal", name: "Natal", startsAt: new Date(sp("2026-11-20T00:00:00")), endsAt: new Date(sp("2026-12-20T00:00:00")) },
    lastClosed: null,
  });
  assert.deepEqual(
    windows.map((item) => item.slot),
    ["current", "next"],
  );
  const ids = (filters) => missions.filterMissions(list, { ...missions.EMPTY_MISSION_FILTERS, ...filters }, windows, NOW).map((item) => item.id);
  assert.deepEqual(ids({}), ["a", "b", "c"]);
  assert.deepEqual(ids({ state: "scheduled" }), ["c"]);
  assert.deepEqual(ids({ artist: missions.NO_ARTIST }), ["b", "c"]);
  assert.deepEqual(ids({ artist: "nenho" }), ["a"]);
  assert.deepEqual(ids({ period: "weekly" }), ["b"]);
  assert.deepEqual(ids({ season: "next" }), ["a", "b", "c"]);
  assert.deepEqual(ids({ season: "current" }), ["a", "b"]);
  assert.equal(missions.hasMissionFilter(missions.EMPTY_MISSION_FILTERS), false);
  assert.equal(missions.hasMissionFilter({ ...missions.EMPTY_MISSION_FILTERS, period: "daily" }), true);
});

test("os dias das conclusões de uma temporada vão até ontem; a que não começou não tem dias", () => {
  const current = { startsAt: new Date(sp("2026-09-19T22:45:00")), endsAt: new Date(sp("2026-10-19T22:45:00")) };
  assert.deepEqual(missions.seasonDaysRange(current, NOW), { from: "2026-09-19", to: "2026-10-07" });
  const closed = { startsAt: new Date(sp("2026-07-29T12:00:00")), endsAt: new Date(sp("2026-08-28T12:00:00")) };
  assert.deepEqual(missions.seasonDaysRange(closed, NOW), { from: "2026-07-29", to: "2026-08-28" });
  assert.equal(missions.seasonDaysRange({ startsAt: new Date(sp("2026-11-20T00:00:00")), endsAt: new Date(sp("2026-12-20T00:00:00")) }, NOW), null);
});

test("encerradas, a janela por extenso e a resposta perdida do createMission", () => {
  const list = [mission({ id: "a" }), mission({ id: "b", endsAt: ts("2026-10-05T00:00:00") })];
  assert.deepEqual(
    missions.endedMissions(list, NOW).map((item) => item.id),
    ["b"],
  );
  const now = new Date(NOW);
  assert.equal(missions.missionWindowText(list[0], now), "Desde 1 out, 00:00, sem fim");
  assert.equal(missions.missionWindowText(list[1], now), "1 out, 00:00 até 5 out, 00:00");

  const version = { updatedByUid: "eu", missions: [{ id: "a", title: "Curta" }, { id: "nova-x1", title: "Curta" }] };
  assert.equal(missions.createdMissionIn(version, "eu", "Curta", ["a"]), "nova-x1");
  assert.equal(missions.createdMissionIn(version, "outra", "Curta", ["a"]), null);
  assert.equal(missions.createdMissionIn(version, "eu", "Outra", ["a"]), null);
  assert.equal(missions.createdMissionIn(null, "eu", "Curta", []), null);
});

test("a meta da temporada: limites pela métrica e o texto da meta cumprida opcional", () => {
  const form = { title: "Semana do arrocha", description: "Faça 20 missões", reachedDescription: "", metric: "missions", target: "20" };
  assert.deepEqual(missions.validateGoal(form).input, { title: "Semana do arrocha", description: "Faça 20 missões", reachedDescription: null, metric: "missions", target: 20 });
  assert.equal(missions.validateGoal({ ...form, target: "1001" }).errors.target, "De 1 a 1.000.");
  assert.equal(missions.validateGoal({ ...form, metric: "points", target: "5000" }).errors.target, undefined);
  assert.equal(missions.validateGoal({ ...form, title: "x".repeat(41) }).errors.title, "Escreva o título, até 40 caracteres.");
  assert.deepEqual(missions.goalFormOf(null), { title: "", description: "", reachedDescription: "", metric: "missions", target: "" });
});
