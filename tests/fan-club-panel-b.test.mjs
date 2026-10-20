import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// O fã-clube gerido pelo fã (seção 34 da nota do app), o Painel B: o
// fã-clube com os números da cópia, o Destaque, as publicações, as denúncias,
// o registro dos reconhecimentos, o formulário e o checklist do Recompensar,
// a qualidade dos seguidores e os retratos do mês, e o pedido de cada decisão
// nova da `decideFanClub`, com o dublê no lugar do Firebase.

const calls = [];
let answer = null;
mock.module("@/lib/callable", {
  namedExports: {
    LONG_CALL_TIMEOUT_MS: 130_000,
    call: async (name, data) => {
      calls.push([name, data]);
      return answer ?? { ok: true, subject: data.subject, id: data.id, status: "ok" };
    },
  },
});

const model = await import("@/lib/fan-clubs");
const api = await import("@/lib/fan-club-api");

const DASHES = /[–—]/;
const sp = (local) => new Date(`${local}-03:00`);
const ts = (date) => ({ toDate: () => date, toMillis: () => date.getTime() });
const NOW = sp("2026-10-20T15:00:00").getTime();

test("o fã-clube lido traz a cópia da noite, os retratos do mês, o Destaque e o último reconhecimento", () => {
  const club = model.parseFanClub("c1", {
    artistId: "netto",
    artistName: "Netto Brito",
    ownerUid: "uidCamila",
    name: "Netto de Coração",
    status: "active",
    postCount: 2,
    pendingPosts: 1,
    lastPostAt: ts(sp("2026-10-19T10:00:00")),
    counts: { followers: 10, followers30d: 4, newAccounts: 6, automaticUsername: 2, byOwnerCode: 1, joins: 3, retained: 2, signups: 5, visits: 9, links: 1, at: ts(sp("2026-10-20T00:21:00")) },
    monthStart: { month: "2026-10", followers: 7, joins: 1, signups: 2, visits: 3, links: 1 },
    lastMonth: { month: "2026-09", followers: -2, joins: 1, signups: 0, visits: 4, links: "x" },
    featured: true,
    featuredUntil: "2026-11-02",
    featuredBy: { uid: "staff1", name: "Equipe" },
    lastReward: { at: ts(sp("2026-10-18T12:00:00")), points: 200, prize: true },
  });
  assert.equal(club.postCount, 2);
  assert.equal(club.pendingPosts, 1);
  assert.deepEqual({ ...club.counts, at: club.counts.at.toISOString() }, {
    followers: 10,
    followers30d: 4,
    newAccounts: 6,
    automaticUsername: 2,
    byOwnerCode: 1,
    joins: 3,
    retained: 2,
    signups: 5,
    visits: 9,
    links: 1,
    at: sp("2026-10-20T00:21:00").toISOString(),
  });
  // Os seguidores do mês passado são o saldo: podem sair negativos.
  assert.deepEqual(club.lastMonth, { month: "2026-09", numbers: { followers: -2, joins: 1, signups: 0, visits: 4, links: 0 } });
  assert.equal(club.featuredUntil, "2026-11-02");
  assert.deepEqual(club.lastReward.points, 200);

  // Sem os campos (o documento antigo ou mexido à mão): nada de número inventado.
  const bare = model.parseFanClub("c2", { status: "paused", counts: "lixo", monthStart: { month: "outubro" }, featuredUntil: "amanhã", lastReward: null });
  assert.equal(bare.counts, null);
  assert.equal(bare.monthStart, null);
  assert.equal(bare.featuredUntil, null);
  assert.equal(bare.lastReward, null);
  assert.equal(bare.postCount, 0);
});

test("os números da ficha: a data da cópia, os trazidos que ficaram, o mês e a qualidade dos seguidores", () => {
  const now = new Date(NOW);
  const club = model.parseFanClub("c1", {
    counts: { followers: 10, followers30d: 4, newAccounts: 6, automaticUsername: 2, byOwnerCode: 5, joins: 3, retained: 2, signups: 5, visits: 9, links: 1, at: ts(sp("2026-10-20T00:21:00")) },
    monthStart: { month: "2026-10", followers: 7, joins: 1, signups: 2, visits: 3, links: 1 },
  });
  assert.equal(model.countsAtText(club.counts, now), "atualizado em 20 out");
  assert.equal(model.countsAtText({ at: null }, now), "sem cópia ainda");
  assert.equal(model.retainedText(club.counts), "2 de 3");
  assert.deepEqual(model.thisMonthNumbers(club), { month: "2026-10", numbers: { followers: 3, joins: 2, signups: 3, visits: 6, links: 0 } });
  // A cópia de outro mês do que o retrato (a primeira de novembro ainda não rodou): sem "neste mês".
  assert.equal(model.thisMonthNumbers({ ...club, monthStart: { month: "2026-09", numbers: club.monthStart.numbers } }), null);
  assert.equal(model.monthLabel("2026-10"), "outubro de 2026");

  // A qualidade, como o `followerQuality` do servidor: só acima da metade avisa.
  const quality = model.followerQuality(club.counts);
  assert.deepEqual(quality.shares, { newAccounts: 0.6, automaticUsername: 0.2, byOwnerCode: 0.5 });
  assert.deepEqual(quality.warnings, ["newAccounts"]);
  assert.deepEqual(model.followerQuality({ followers: 0, newAccounts: 3, automaticUsername: 0, byOwnerCode: 0 }).warnings, []);
  assert.deepEqual(model.followerSignals({ newAccount: true, chosenUsername: false, byOwnerCode: true }), ["Conta nova", "@ automático", "Trazido pelo gestor"]);
  assert.deepEqual(model.followerSignals({ newAccount: false, chosenUsername: true, byOwnerCode: false }), []);
  assert.deepEqual(model.parseFollower({ uid: "u1", followedAt: ts(sp("2026-10-19T10:00:00")), newAccount: true, chosenUsername: "sim" }).chosenUsername, false);

  assert.equal(model.lastRewardText({ at: sp("2026-10-18T12:00:00"), points: 200, prize: true }, now), "+200 pts e prêmio, 18 out");
  assert.equal(model.lastRewardText({ at: sp("2026-10-18T12:00:00"), points: null, prize: true }, now), "Prêmio, 18 out");
  assert.equal(model.lastRewardText(null, now), null);
});

test("o Destaque: vale até o fim de hoje em diante, o prazo de amanhã a 31 dias e o fim sugerido", () => {
  const featured = { featured: true, featuredUntil: "2026-10-20" };
  assert.equal(model.isFeaturedNow(featured, NOW), true);
  assert.equal(model.isFeaturedNow({ featured: true, featuredUntil: "2026-10-19" }, NOW), false);
  assert.equal(model.isFeaturedNow({ featured: false, featuredUntil: "2026-11-01" }, NOW), false);
  assert.equal(model.featuredText({ featured: true, featuredUntil: "2026-11-02" }, NOW), "Destaque até 2 nov");
  assert.equal(model.featuredText({ featured: true, featuredUntil: "2026-10-19" }, NOW), "Destaque vencido em 19 out");
  assert.equal(model.featuredText({ featured: false, featuredUntil: null }, NOW), null);

  assert.deepEqual(model.featureRange(NOW), { min: "2026-10-21", max: "2026-11-20" });
  assert.deepEqual(model.checkFeaturedUntil("2026-10-21", NOW), { ok: true, day: "2026-10-21" });
  assert.deepEqual(model.checkFeaturedUntil("2026-11-20", NOW), { ok: true, day: "2026-11-20" });
  for (const bad of ["2026-10-20", "2026-11-21", "2026-02-30", "21/10/2026", ""]) {
    assert.equal(model.checkFeaturedUntil(bad, NOW).ok, false, bad);
  }
  // Perto da meia-noite de São Paulo (02:30 UTC do dia 21 ainda é dia 20 lá).
  assert.equal(model.featureRange(Date.parse("2026-10-21T02:30:00Z")).min, "2026-10-21");
  assert.equal(model.defaultFeaturedUntil({ featured: false, featuredUntil: null }, NOW), "2026-11-19");
  assert.equal(model.defaultFeaturedUntil({ featured: true, featuredUntil: "2026-11-02" }, NOW), "2026-11-02");
  assert.equal(model.defaultFeaturedUntil({ featured: true, featuredUntil: "2026-10-20" }, NOW), "2026-11-19");
});

test("a publicação lida, as decisões que cabem e de onde vêm as fotos", () => {
  const media = {
    photo: { url: "https://x/foto?token=1", path: "fanClubMedia/u1/club-photo-abc12345.jpg", width: 1080, height: 1350 },
    thumb: { url: "https://x/mini?token=1", path: "fanClubMedia/u1/club-thumb-abc12345.jpg", width: 480, height: 600 },
  };
  const post = model.parsePost("p1", { clubId: "c1", artistId: "netto", authorUid: "u1", authorName: "Camila", text: "Oi", media, status: "published", submittedAt: ts(sp("2026-10-19T10:00:00")) });
  assert.equal(post.kind, "photo");
  assert.equal(post.media.thumb.width, 480);
  assert.equal(model.parsePost("p2", { status: "estranho", media: { photo: media.photo } }).status, "removed");
  assert.equal(model.parsePost("p2", { media: { photo: media.photo } }).kind, "text");
  assert.equal(model.authorLabel({ authorName: null, authorUsername: "cami" }), "@cami");

  const editor = { uid: "staff1", canEdit: true };
  assert.deepEqual(model.postDecisions({ status: "pending", authorUid: "u1" }, editor), ["approve", "reject"]);
  assert.deepEqual(model.postDecisions({ status: "published", authorUid: "u1" }, editor), ["hide"]);
  assert.deepEqual(model.postDecisions({ status: "hidden", authorUid: "u1" }, editor), ["restore"]);
  assert.deepEqual(model.postDecisions({ status: "removed", authorUid: "u1" }, editor), []);
  assert.deepEqual(model.postDecisions({ status: "published", authorUid: "staff1" }, editor), []);
  assert.deepEqual(model.postDecisions({ status: "published", authorUid: "u1" }, { uid: "staff1", canEdit: false }), []);

  assert.equal(model.postMediaSource({ status: "pending", media }), "stored");
  assert.equal(model.postMediaSource({ status: "published", media }), "stored");
  assert.equal(model.postMediaSource({ status: "hidden", media }), "path");
  assert.equal(model.postMediaSource({ status: "removed", media }), "path");
  assert.equal(model.postMediaSource({ status: "rejected", media }), "gone");
  assert.equal(model.postMediaSource({ status: "withdrawn", media }), "gone");
  assert.equal(model.postMediaSource({ status: "published", media: null }), "none");
});

test("a denúncia lida, a contagem por motivo e as decisões que cabem", () => {
  const item = model.parseReport("p1", {
    clubId: "c1",
    artistId: "netto",
    authorUid: "u1",
    reportCount: 3,
    reasons: { spam: 1, image_misuse: 2, inventado: 9 },
    status: "open",
    resolution: null,
    round: 2,
    lastReportedAt: ts(sp("2026-10-20T09:00:00")),
  });
  assert.equal(item.postId, "p1");
  assert.equal(item.round, 2);
  assert.deepEqual(item.reasons, { spam: 1, offensive: 0, harassment: 0, image_misuse: 2, other: 0, none: 0 });
  assert.equal(model.reportReasonsText(item.reasons), "2 Uso indevido de imagem, 1 Spam");
  assert.equal(model.parseReport("p2", { status: "estranho", resolution: "kept" }).status, "resolved");

  const editor = { uid: "staff1", canEdit: true };
  assert.deepEqual(model.reportDecisions(item, editor), ["keep", "action"]);
  assert.deepEqual(model.reportDecisions({ ...item, status: "resolved" }, editor), []);
  assert.deepEqual(model.reportDecisions({ ...item, authorUid: "staff1" }, editor), []);
  assert.deepEqual(model.reportDecisions(item, { uid: "staff1", canEdit: false }), []);
});

test("o registro do reconhecimento, sem o código nem o cupom", () => {
  const prize = model.parsePrize("g-12345678", {
    points: 200,
    prize: { rewardId: "cortesia", rewardTitle: "Ingresso de cortesia", rewardKind: "ticket", delivered: false },
    note: "Muita divulgação",
    by: { uid: "staff1", name: "Equipe" },
    at: ts(sp("2026-10-18T12:00:00")),
  });
  assert.equal(prize.grantId, "g-12345678");
  assert.equal(prize.prize.rewardTitle, "Ingresso de cortesia");
  assert.equal(model.parsePrize("g2", { points: 0, prize: null, note: "Só destaque" }).points, null);
});

test("o formulário do Recompensar confere como o servidor: as partes, o teto do papel, o cupom, a mensagem e a nota", () => {
  const empty = { feature: false, featuredUntil: "2026-11-19", points: "", rewardId: "", coupon: "", message: "", delivered: false, note: "" };
  const all = { now: NOW, role: "editor", canFeature: true, canPoints: true, canPrize: true };

  assert.deepEqual(model.checkRewardForm(empty, all).errors, { form: "Escolha o Destaque, os pontos ou o prêmio." });
  // Só o Destaque: sem nota.
  assert.deepEqual(model.checkRewardForm({ ...empty, feature: true }, all).plan, { featuredUntil: "2026-11-19", grant: null });
  assert.ok(model.checkRewardForm({ ...empty, feature: true, featuredUntil: "2026-12-30" }, all).errors.featuredUntil);

  // Os pontos pedem a nota; o teto do editor é o do Ajuste (50.000), o do admin, 1.000.000.
  assert.ok(model.checkRewardForm({ ...empty, points: "200" }, all).errors.note);
  assert.deepEqual(model.checkRewardForm({ ...empty, points: "200", note: "  Muita divulgação " }, all).plan, {
    featuredUntil: null,
    grant: { points: 200, prize: null, note: "Muita divulgação" },
  });
  assert.ok(model.checkRewardForm({ ...empty, points: "50001", note: "x" }, all).errors.points);
  assert.equal(model.checkRewardForm({ ...empty, points: "50001", note: "x" }, { ...all, role: "admin" }).plan.grant.points, 50001);
  for (const bad of ["0", "-3", "2.5", "abc"]) assert.ok(model.checkRewardForm({ ...empty, points: bad, note: "x" }, all).errors.points, bad);
  assert.ok(model.checkRewardForm({ ...empty, points: "10", note: "x".repeat(201) }, all).errors.note);

  // O prêmio: o cupom numa linha até 60, a mensagem até 140, e o "O cupom já é o prêmio" pede o cupom.
  const prize = { ...empty, rewardId: "cortesia", note: "Ganhou" };
  assert.deepEqual(model.checkRewardForm({ ...prize, coupon: " CORTESIA-IRARA ", message: "Parabéns!\n\nAté o show." }, all).plan.grant.prize, {
    rewardId: "cortesia",
    delivered: false,
    coupon: "CORTESIA-IRARA",
    message: "Parabéns!\n\nAté o show.",
  });
  assert.deepEqual(model.checkRewardForm(prize, all).plan.grant.prize, { rewardId: "cortesia", delivered: false, coupon: null, message: null });
  assert.ok(model.checkRewardForm({ ...prize, coupon: "x".repeat(61) }, all).errors.coupon);
  assert.ok(model.checkRewardForm({ ...prize, message: "x".repeat(141) }, all).errors.message);
  assert.ok(model.checkRewardForm({ ...prize, delivered: true }, all).errors.coupon);
  assert.equal(model.checkRewardForm({ ...prize, delivered: true, coupon: "DESC10" }, all).plan.grant.prize.delivered, true);

  // A parte sem a seção de quem confirma fica de fora, mesmo preenchida.
  const noSections = { ...all, canPoints: false, canPrize: false };
  assert.deepEqual(model.checkRewardForm({ ...empty, points: "200", rewardId: "cortesia" }, noSections).errors, { form: "Escolha o Destaque, os pontos ou o prêmio." });
  assert.equal(model.rewardPointsMax("admin"), 1_000_000);
  assert.equal(model.rewardPointsMax("editor"), 50_000);
  assert.match(model.newGrantId(() => "123e4567-e89b-12d3-a456-426614174000"), /^[A-Za-z0-9_-]{8,64}$/);
});

test("o checklist só avisa: o que falhou, o que não deu para conferir e o porquê", () => {
  const club = { status: "active", approvedAt: sp("2026-09-01T10:00:00"), postCount: 1, lastPostAt: sp("2026-10-01T10:00:00"), ownerUid: "u1" };
  const all = model.rewardChecklist({ club, now: NOW, ownerSuspended: false, ownerMember: true, rulesVersion: model.FAN_CLUB_RULES_VERSION, actionedReports: 0, readsFans: true });
  assert.deepEqual(all.map((item) => item.state), ["ok", "ok", "ok", "ok", "ok", "ok"]);

  const fresh = model.rewardChecklist({
    club: { ...club, approvedAt: sp("2026-10-10T10:00:00"), postCount: 0, lastPostAt: null },
    now: NOW,
    ownerSuspended: null,
    ownerMember: null,
    rulesVersion: "termos-velhos",
    actionedReports: 2,
    readsFans: false,
  });
  assert.deepEqual(fresh.map((item) => [item.key, item.state]), [
    ["active", "no"],
    ["suspension", "unknown"],
    ["member", "unknown"],
    ["rules", "no"],
    ["reports", "no"],
    ["posts", "no"],
  ]);
  assert.equal(fresh[1].detail, "Só com a seção Fãs ou a Moderação.");
  assert.equal(fresh[2].detail, "Só com a seção Fãs.");
  assert.equal(fresh[4].detail, "2 denúncias aceitas");
  for (const item of fresh) assert.doesNotMatch(item.label, DASHES);

  // A trava do servidor que falhou vira a frase dela; o resto fica com a frase do servidor.
  const refusal = (problem) => ({ code: "functions/failed-precondition", message: "x", details: { reason: "prize-not-allowed", problem } });
  assert.equal(model.rewardRefusalText(refusal("not_adult")), "O gestor não declarou ter 18 anos ou mais na candidatura.");
  assert.equal(model.rewardRefusalText(refusal("outra")), null);
  assert.equal(model.rewardRefusalText({ code: "functions/failed-precondition", details: { reason: "sold-out" } }), null);
});

test("os textos novos não têm travessão nem meia-risca", () => {
  const texts = [
    ...Object.values(model.POST_STATUS_LABELS),
    ...Object.values(model.POST_REJECT_REASON_LABELS),
    ...Object.values(model.REPORT_REASON_LABELS),
    ...Object.values(model.REPORT_RESOLUTION_LABELS),
    ...Object.values(model.FAN_CLUB_ORDER_LABELS),
    ...Object.values(model.QUALITY_LABELS),
    ...Object.values(model.MONTH_FIELD_LABELS),
    model.APPROVE_POST_TEXT,
    model.HIDE_POST_TEXT,
    model.RESTORE_POST_TEXT,
    model.KEEP_REPORT_TEXT,
    model.ACTION_REPORT_TEXT,
    model.UNFEATURE_TEXT,
    model.rewardPointsHint("editor"),
    model.rewardPointsHint("admin"),
  ];
  for (const text of texts) assert.doesNotMatch(text, DASHES, text);
});

test("cada decisão nova da decideFanClub manda o assunto, a decisão e o estado que a tela mostrou", async () => {
  calls.length = 0;
  answer = null;
  await api.featureFanClub("c1", "active", "2026-11-19");
  await api.unfeatureFanClub("c1", "active");
  await api.decidePost("p1", "pending", "approve");
  await api.decidePost("p1", "published", "hide");
  await api.decidePost("p1", "hidden", "restore");
  await api.rejectPost("p1", "pending", "off_topic");
  await api.decideReport("p1", 2, "action");
  await api.decideReport("p1", 2, "keep");
  assert.deepEqual(calls, [
    ["decideFanClub", { subject: "club", id: "c1", decision: "feature", expected: "active", featuredUntil: "2026-11-19" }],
    ["decideFanClub", { subject: "club", id: "c1", decision: "unfeature", expected: "active" }],
    ["decideFanClub", { subject: "post", id: "p1", decision: "approve", expected: "pending" }],
    ["decideFanClub", { subject: "post", id: "p1", decision: "hide", expected: "published" }],
    ["decideFanClub", { subject: "post", id: "p1", decision: "restore", expected: "hidden" }],
    ["decideFanClub", { subject: "post", id: "p1", decision: "reject", expected: "pending", reason: "off_topic" }],
    ["decideFanClub", { subject: "report", id: "p1", decision: "action", expected: 2 }],
    ["decideFanClub", { subject: "report", id: "p1", decision: "keep", expected: 2 }],
  ]);

  // O Recompensar: os campos do `reward` no topo do pedido, como o `parseRewardGrant` do servidor lê.
  calls.length = 0;
  answer = { ok: true, subject: "club", id: "c1", status: "active", grantId: "g-12345678", code: "UP-ABC123", points: 200 };
  const result = await api.rewardFanClub("c1", "active", {
    grantId: "g-12345678",
    points: 200,
    prize: { rewardId: "cortesia", delivered: false, coupon: "CORTESIA-IRARA", message: null },
    note: "Ganhou",
  });
  assert.deepEqual(calls, [
    [
      "decideFanClub",
      {
        subject: "club",
        id: "c1",
        decision: "reward",
        expected: "active",
        grantId: "g-12345678",
        points: 200,
        prize: { rewardId: "cortesia", delivered: false, coupon: "CORTESIA-IRARA", message: null },
        note: "Ganhou",
      },
    ],
  ]);
  assert.equal(result.code, "UP-ABC123");
  answer = null;
});
