import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const fans = await import("@/lib/fans");

const at = (iso) => Timestamp.fromMillis(Date.parse(iso));

test("a carteira lida, com os pontos da temporada e a posição só da temporada de agora", () => {
  const wallet = fans.parseWallet({
    balance: 12480,
    xp: 12480,
    seasonId: "sao-joao",
    seasonPoints: 4120,
    days: { "2026-10-07": { earned: 40 }, "2026-10-01": { earned: 600 }, "2026-09-30": { earned: 999 }, lixo: { earned: 5 } },
    rankWeek: { seasonId: "sao-joao", week: "2026-W41", position: 14 },
    goalReached: { seasonId: "sao-joao", at: at("2026-10-05T12:00:00Z") },
    missions: { daily: { key: "2026-10-07", items: { "curtir-5": { current: 2 } } } },
    achievements: { "nivel-7": at("2026-09-29T12:00:00Z"), boca: at("2026-10-07T12:00:00Z") },
    stats: { pastSeasons: 2, closedSeasonId: "carnaval" },
  });
  assert.equal(fans.seasonPointsNow(wallet, "sao-joao"), 4120);
  assert.equal(fans.seasonPointsNow(wallet, "outra"), 0);
  assert.equal(fans.seasonPointsNow(wallet, null), 0);
  assert.equal(fans.rankPositionNow(wallet, "sao-joao"), 14);
  assert.equal(fans.rankPositionNow(wallet, "outra"), null);
  assert.equal(fans.earnedLast7Days(wallet, "2026-10-07"), 640);
  assert.equal(fans.seasonsPlayed(wallet), 3);
  assert.deepEqual(wallet.missions.daily.items, [{ id: "curtir-5", current: 2, completedAt: null }]);
  assert.equal(wallet.missions.weekly, null);
  assert.deepEqual(
    wallet.achievements.map((item) => item.id),
    ["boca", "nivel-7"],
  );
  assert.equal(fans.parseWallet(undefined).exists, false);
  assert.equal(fans.parseWallet(undefined).balance, 0);
});

test("o extrato: a entrada lida e o contexto", () => {
  const entry = fans.parseLedgerEntry("adjustment:abc", {
    kind: "adjust",
    source: "adjustment",
    points: 100,
    balanceAfter: 3240,
    actor: { type: "staff", uid: "ed", name: "Editora de Teste" },
    note: "Sorteio",
    createdAt: at("2026-10-08T06:22:00Z"),
  });
  assert.equal(entry.points, 100);
  assert.deepEqual(entry.actor, { type: "staff", uid: "ed", name: "Editora de Teste" });
  assert.equal(fans.ledgerContext(entry), "");
  assert.equal(fans.ledgerContext({ subject: { type: "mission", id: "m1" }, subjectTitle: "Curta 5 posts", artistId: null }), "Curta 5 posts");
  assert.equal(fans.ledgerContext({ subject: { type: "post", id: "p-clipe" }, subjectTitle: null, artistId: "netto" }), "Post p-clipe");
  assert.equal(fans.ledgerContext({ subject: { type: "artist", id: "nenho" }, subjectTitle: null, artistId: null }), "Central @nenho");
});

test("a origem do cadastro: o caminho, a campanha e o que quem convidou ganhou", () => {
  const referral = fans.parseReferral({
    inviterUid: "camila",
    code: "CAMILA12",
    via: "link",
    link: { kind: "post", targetId: "p-clipe" },
    utm: { source: "instagram", medium: "story", campaign: "sao-joao" },
    claimedAt: at("2026-10-08T01:46:00Z"),
    award: { visit: "applied", signup: "applied" },
  });
  assert.equal(fans.referralPath(referral, { post: "Saiu o clipe" }), "pelo link do post Saiu o clipe");
  assert.equal(fans.referralPath({ via: "code", link: null }, {}), "pelo código digitado");
  assert.equal(fans.referralPath({ via: "link", link: { kind: "artist", targetId: "nettobrito" } }, { artist: "Netto Brito" }), "pelo link da central Netto Brito");
  assert.equal(fans.utmText(referral.utm), "campanha sao-joao, origem instagram e meio story");
  assert.equal(fans.utmText({ source: null, medium: null, campaign: null }), null);
  assert.equal(fans.referralAwardText(referral, { visit: 2, signup: 10 }), "Rendeu: 2 pontos pela visita e 10 pontos pelo cadastro.");
  assert.equal(
    fans.referralAwardText({ ...referral, award: { visit: "zero", signup: "capped" } }, { visit: null, signup: null }),
    "Não rendeu: nada pela visita (a régua dava 0 ponto) e nada pelo cadastro (limite do dia).",
  );
  assert.equal(fans.referralAwardText({ ...referral, award: { visit: "self", signup: "self" } }, { visit: null, signup: null }), "Não rendeu: a mesma pessoa em outra conta.");
  assert.equal(
    fans.referralAwardText({ ...referral, inviterUid: null, inviterRemovedAt: new Date() }, { visit: null, signup: null }),
    "Quem convidou excluiu a conta.",
  );
});

test("as centrais do fã: o vínculo de agora e os pontos, também das que ele saiu", () => {
  const rows = fans.joinFanCentrals(
    [{ id: "nenho", data: { via: "page", joinedAt: at("2026-09-29T12:00:00Z") } }],
    [
      { id: "nenho", data: { seasonId: "sj", seasonPoints: 30, totalPoints: 90 } },
      { id: "antiga", data: { seasonId: "carnaval", seasonPoints: 5, totalPoints: 500 } },
    ],
  );
  assert.deepEqual(
    rows.map((row) => [row.artistId, row.member, row.via, row.totalPoints]),
    [
      ["nenho", true, "page", 90],
      ["antiga", false, "", 500],
    ],
  );
});

test("a busca: e-mail, uid, código e o nome com o @", () => {
  assert.deepEqual(fans.classifyFanSearch("Bia@Teste.ImagineUP"), { kind: "email", email: "bia@teste.imagineup" });
  assert.equal(fans.classifyFanSearch("E0glBWvpmC4s1KStvpUk564E9y8f").kind, "uid");
  assert.deepEqual(fans.classifyFanSearch("camila12"), { kind: "text", words: ["camila12"], longest: "camila12", handle: "camila12", code: "CAMILA12" });
  assert.deepEqual(fans.classifyFanSearch("@camilarib"), { kind: "text", words: ["camilarib"], longest: "camilarib", handle: "camilarib", code: null });
  const name = fans.classifyFanSearch("Camila Ribeirão");
  assert.equal(name.longest, "ribeirao");
  assert.deepEqual(name.words, ["camila", "ribeirao"]);
  assert.equal(name.handle, null);
  assert.equal(fans.classifyFanSearch("  "), null);
  assert.equal(fans.classifyFanSearch("a"), null);
  assert.equal(fans.normalizeSearch("São João!"), "sao joao");
  assert.equal(fans.matchesAllWords({ name: "Camila Ribeiro", username: "camila_rib" }, ["cami", "rib"]), true);
  assert.equal(fans.matchesAllWords({ name: "Camila Ribeiro", username: "camila_rib" }, ["cami", "santos"]), false);
});

test("o ajuste: validação espelhada do servidor, o corpo e o antes e depois", () => {
  const form = { ...fans.EMPTY_ADJUST_FORM, balance: "+100", note: "Sorteio" };
  const ok = fans.validateAdjust(form, { role: "editor", hasSeason: true });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(fans.adjustInputOf("u1", "id-12345678", form, ok.deltas), { uid: "u1", adjustmentId: "id-12345678", note: "Sorteio", balance: 100 });

  assert.equal(fans.validateAdjust({ ...form, balance: "60.000" }, { role: "editor", hasSeason: true }).errors.balance, "No máximo 50.000 por contador.");
  assert.deepEqual(fans.validateAdjust({ ...form, balance: "60.000" }, { role: "admin", hasSeason: true }).errors, {});
  assert.equal(fans.validateAdjust({ ...form, balance: "1,5" }, { role: "admin", hasSeason: true }).errors.balance, "Use um número inteiro, com + ou - na frente.");
  assert.equal(fans.validateAdjust({ ...form, balance: "", season: "10" }, { role: "admin", hasSeason: false }).errors.season, "Não há temporada em andamento.");
  assert.equal(fans.validateAdjust({ ...form, balance: "" }, { role: "admin", hasSeason: true }).errors.form, "Escreva pelo menos um valor diferente de zero.");
  assert.equal(fans.validateAdjust({ ...form, note: " " }, { role: "admin", hasSeason: true }).errors.note, "Escreva o motivo.");
  assert.equal(fans.validateAdjust({ ...form, centralTotal: "5" }, { role: "admin", hasSeason: true }).errors.artistId, "Escolha a central.");
  const central = fans.validateAdjust({ ...form, balance: "", artistId: "nenho", centralSeason: "-5" }, { role: "admin", hasSeason: true });
  assert.deepEqual(fans.adjustInputOf("u1", "id-12345678", { ...form, balance: "", artistId: "nenho", centralSeason: "-5" }, central.deltas).central, {
    artistId: "nenho",
    season: -5,
  });

  assert.equal(fans.beforeAfter("Saldo", 12480, 100), "Saldo: 12.480 para 12.580");
  assert.equal(fans.adjustLimitText("editor"), "Até 50.000 por contador em cada ajuste e 100.000 por dia.");
  assert.equal(fans.adjustLimitText("admin"), "Até 1.000.000 por contador.");
  assert.equal(
    fans.enteredText({ balance: 100, createdAt: at("2026-10-07T17:32:00Z") }, new Date("2026-10-08T12:00:00Z")),
    "Já entrou: saldo +100, em 7 out às 14:32.",
  );
  assert.match(fans.newAdjustmentId(() => "8c1f-22aa-bb44"), /^[A-Za-z0-9_-]{8,64}$/);
});
