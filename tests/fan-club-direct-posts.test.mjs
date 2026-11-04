import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// A publicação sem revisão do fã-clube oficial (34.25 da nota do app): a
// chave do admin na ficha, a publicação que vai ao ar na hora (`direct`), o
// Conferida da aba "Publicadas sem revisão", as permissões por papel, o erro
// `not-official`, os rótulos dos Logs e o pedido da `decideFanClub`, com o
// dublê no lugar do Firebase.

const calls = [];
mock.module("@/lib/callable", {
  namedExports: {
    LONG_CALL_TIMEOUT_MS: 130_000,
    call: async (name, data) => {
      calls.push([name, data]);
      return { ok: true, subject: data.subject, id: data.id, status: data.subject === "post" ? "published" : "active" };
    },
  },
});

const model = await import("@/lib/fan-clubs");
const api = await import("@/lib/fan-club-api");
const errors = await import("@/lib/errors");
const audit = await import("@/lib/audit");
const { canEditSection, canSeeSection, isAdmin } = await import("@/lib/staff");

const DASHES = /[\u2013\u2014]/;
const sp = (local) => new Date(`${local}-03:00`);
const ts = (date) => ({ toDate: () => date, toMillis: () => date.getTime() });
const failure = (reason, message = reason) => ({ code: "functions/failed-precondition", message, details: { reason } });

test("a chave lida: só vale com o selo, como o servidor lê, e mostra desde quando e quem ligou", () => {
  const now = sp("2026-11-04T15:00:00");
  const before = model.parseFanClub("club1", { name: "Turma do Nenho", status: "active", official: true });
  assert.equal(before.directPosts, false);
  assert.equal(before.directPostsAt, null);
  assert.equal(before.directPostsBy, null);
  assert.equal(model.directPostsText(before, now), null);

  const on = model.parseFanClub("club2", {
    name: "Netto de Coração",
    status: "active",
    official: true,
    directPosts: true,
    directPostsAt: ts(sp("2026-11-04T10:00:00")),
    directPostsBy: { uid: "staff1", name: "Iara" },
  });
  assert.equal(on.directPosts, true);
  assert.deepEqual(on.directPostsBy, { uid: "staff1", name: "Iara" });
  assert.equal(model.directPostsText(on, now), "Publica sem revisão desde 4 nov, por Iara");
  assert.equal(model.directPostsText({ directPosts: true, directPostsAt: null, directPostsBy: null }, now), "Publica sem revisão");

  // A chave sem o selo (gravada à mão) não vale; só o `true` liga.
  assert.equal(model.parseFanClub("club3", { status: "active", official: false, directPosts: true }).directPosts, false);
  assert.equal(model.parseFanClub("club4", { status: "active", official: true, directPosts: "sim" }).directPosts, false);
  // Desligada pelo `DIRECT_POSTS_OFF` do servidor: o falso e os dois nulos.
  const off = model.parseFanClub("club5", { status: "paused", official: true, directPosts: false, directPostsAt: null, directPostsBy: null });
  assert.equal(off.directPosts, false);
  assert.equal(model.directPostsText(off, now), null);
});

test("as confirmações da chave: vai ao ar na hora e a equipe confere depois; tirar mantém o que já foi ao ar; o selo leva a chave junto", () => {
  assert.match(model.ALLOW_DIRECT_POSTS_TEXT, /vão ao ar na hora/);
  assert.match(model.ALLOW_DIRECT_POSTS_TEXT, /A equipe confere depois, na aba Publicadas sem revisão/);
  assert.match(model.REVOKE_DIRECT_POSTS_TEXT, /O que já foi ao ar fica/);
  assert.equal(model.unofficializeText("active"), "O selo sai do app na hora. O fã-clube continua no ar.");
  assert.equal(
    model.unofficializeText("active", true),
    "O selo sai do app na hora. O fã-clube continua no ar. A publicação sem revisão sai junto, e as próximas publicações do gestor voltam a passar pela revisão.",
  );
  assert.match(model.unofficializeText("paused", true), /^O fã-clube fica sem o selo e, quando for reativado, volta ao app sem ele\. A publicação sem revisão sai junto/);
});

test("a publicação que foi ao ar sem revisão: a marca até a equipe conferir, e depois quem conferiu", () => {
  const published = model.parsePost("p1", {
    clubId: "c1",
    artistId: "netto",
    authorUid: "u1",
    authorName: "Camila",
    text: "Oi",
    status: "published",
    direct: true,
    submittedAt: ts(sp("2026-11-04T10:00:00")),
    publishedAt: ts(sp("2026-11-04T10:00:00")),
    reviewedAt: null,
    reviewedBy: null,
  });
  assert.equal(published.direct, true);
  assert.equal(published.reviewedAt, null);
  assert.equal(model.awaitsCheck(published), true);
  assert.equal(model.reviewedText(published), null);

  const checked = { ...published, reviewedAt: sp("2026-11-04T12:00:00"), reviewedBy: { uid: "staff1", name: "Iara" } };
  assert.equal(model.awaitsCheck(checked), false);
  assert.equal(model.reviewedText(checked), "Conferida por Iara");
  // Oculta pela equipe depois: quem decidiu, como nas outras.
  assert.equal(model.reviewedText({ ...checked, status: "hidden" }), "Decidida por Iara");
  // Tirada do ar pelo gestor sem a conferência: a marca fica, porque ninguém olhou.
  assert.equal(model.awaitsCheck({ ...published, status: "removed" }), true);

  // A de antes (sem o campo) e a que passou pela revisão: sem a marca, com o "Decidida por".
  const old = model.parsePost("p2", { status: "published", reviewedAt: ts(sp("2026-11-01T10:00:00")), reviewedBy: { uid: "staff1", name: "Iara" } });
  assert.equal(old.direct, false);
  assert.equal(model.awaitsCheck(old), false);
  assert.equal(model.reviewedText(old), "Decidida por Iara");
  assert.equal(model.awaitsCheck(model.parsePost("p3", { status: "published", direct: false, reviewedAt: null })), false);
  assert.equal(model.reviewedText({ status: "pending", direct: false, reviewedBy: { uid: "staff1", name: "Iara" } }), null);
});

test("as permissões por papel: o admin liga e tira a chave; o admin e o editor da seção conferem e ocultam; o Leitor só vê", () => {
  const admin = { uid: "a1", role: "admin", sections: [], status: "active" };
  const editor = { uid: "e1", role: "editor", sections: ["fanClubs"], status: "active" };
  const otherEditor = { uid: "e2", role: "editor", sections: ["fans"], status: "active" };
  const reader = { uid: "v1", role: "viewer", sections: ["fanClubs"], status: "active" };
  const club = { status: "active", ownerUid: "f1", official: true, directPosts: false };
  const post = { status: "published", authorUid: "u1", direct: true, reviewedAt: null };
  const viewerOf = (member) => ({ uid: member.uid, canEdit: canEditSection(member, "fanClubs"), admin: isAdmin(member) });

  assert.ok(model.clubDecisions(club, viewerOf(admin)).includes("allowDirectPosts"));
  assert.ok(model.clubDecisions({ ...club, directPosts: true }, viewerOf(admin)).includes("revokeDirectPosts"));
  for (const member of [editor, reader]) {
    const decisions = model.clubDecisions({ ...club, directPosts: true }, viewerOf(member));
    assert.ok(!decisions.includes("allowDirectPosts") && !decisions.includes("revokeDirectPosts"), member.uid);
    assert.ok(!model.clubDecisions(club, viewerOf(member)).includes("allowDirectPosts"), member.uid);
  }
  // Sem o selo, sem o ativo: nada de ligar (o servidor responderia `not-official` e `invalid-request`).
  assert.ok(!model.clubDecisions({ ...club, official: false }, viewerOf(admin)).includes("allowDirectPosts"));
  assert.ok(!model.clubDecisions({ ...club, status: "paused" }, viewerOf(admin)).includes("allowDirectPosts"));

  assert.deepEqual(model.postDecisions(post, viewerOf(admin)), ["check", "hide"]);
  assert.deepEqual(model.postDecisions(post, viewerOf(editor)), ["check", "hide"]);
  assert.deepEqual(model.postDecisions(post, viewerOf(reader)), []);
  // O editor de outra seção nem vê a seção.
  assert.equal(canSeeSection(otherEditor, "fanClubs"), false);
  assert.deepEqual(model.postDecisions(post, viewerOf(otherEditor)), []);
  // O autor não decide a própria (`self`).
  assert.deepEqual(model.postDecisions({ ...post, authorUid: "e1" }, viewerOf(editor)), []);
  // A conferida e a que passou pela revisão: só o Ocultar; a em análise segue na fila.
  assert.deepEqual(model.postDecisions({ ...post, reviewedAt: sp("2026-11-04T12:00:00") }, viewerOf(editor)), ["hide"]);
  assert.deepEqual(model.postDecisions({ ...post, direct: false }, viewerOf(editor)), ["hide"]);
  assert.deepEqual(model.postDecisions({ ...post, status: "pending", direct: false }, viewerOf(editor)), ["approve", "reject"]);
});

test("a decideFanClub recebe a chave no assunto club e o Conferida no assunto post, com o estado que a tela mostrou", async () => {
  calls.length = 0;
  await api.allowFanClubDirectPosts("club1", "active");
  await api.revokeFanClubDirectPosts("club1", "paused");
  const result = await api.decidePost("p1", "published", "check");
  await api.decidePost("p1", "published", "hide");
  assert.deepEqual(calls, [
    ["decideFanClub", { subject: "club", id: "club1", decision: "allowDirectPosts", expected: "active" }],
    ["decideFanClub", { subject: "club", id: "club1", decision: "revokeDirectPosts", expected: "paused" }],
    ["decideFanClub", { subject: "post", id: "p1", decision: "check", expected: "published" }],
    ["decideFanClub", { subject: "post", id: "p1", decision: "hide", expected: "published" }],
  ]);
  assert.deepEqual(result, { ok: true, subject: "post", id: "p1", status: "published" });
});

test("os erros: o not-official com a frase do servidor, e as recusas que tiram o confirmar e o card da aba", () => {
  assert.equal(errors.REASON_MESSAGES["not-official"], "Só um fã-clube oficial publica sem revisão.");
  // A frase do servidor ganha; sem ela, a de reserva.
  assert.equal(errors.callableErrorMessage(failure("not-official", "Só um fã-clube oficial publica sem revisão. [400]")), "Só um fã-clube oficial publica sem revisão.");
  assert.equal(errors.callableErrorMessage(failure("not-official", "failed-precondition")), "Só um fã-clube oficial publica sem revisão.");
  assert.equal(errors.mayHaveRunOnServer(failure("not-official")), false);

  // Na ficha: o `not-official` (o selo saiu com a confirmação aberta) e o `stale-decision` tiram o confirmar.
  assert.equal(model.blocksDecisionRetry(failure("not-official")), true);
  assert.equal(model.blocksDecisionRetry(failure("stale-decision")), true);
  assert.equal(model.blocksDecisionRetry({ code: "functions/invalid-argument", details: { reason: "invalid-request", field: "decision" } }), false);

  // Na aba: a publicação que mudou ou saiu sai da lista, e o confirmar também.
  assert.equal(model.isPostGone(failure("stale-decision")), true);
  assert.equal(model.isPostGone({ code: "functions/not-found", details: { reason: "fan-club-post-not-found" } }), true);
  assert.equal(errors.REASON_MESSAGES["fan-club-post-not-found"], "Essa publicação não existe mais.");
  assert.equal(model.isPostGone({ code: "functions/permission-denied", details: { reason: "self" } }), false);
  assert.equal(model.isPostGone({ code: "functions/internal" }), false);
});

test("os Logs: as três ações novas com o rótulo, o alvo principal e os details de sempre, sem linha", () => {
  assert.equal(audit.AUDIT_ACTIONS["fanClub.directPosts.allowed"].label, "Publicação sem revisão ligada");
  assert.equal(audit.AUDIT_ACTIONS["fanClub.directPosts.revoked"].label, "Publicação sem revisão tirada");
  assert.equal(audit.AUDIT_ACTIONS["fanClub.post.checked"].label, "Publicação de fã-clube conferida");
  for (const action of ["fanClub.directPosts.allowed", "fanClub.directPosts.revoked", "fanClub.post.checked"]) {
    assert.equal(audit.AUDIT_ACTIONS[action].section, "fanClubs", action);
    assert.doesNotMatch(audit.AUDIT_ACTIONS[action].label, DASHES, action);
  }

  // A chave: os `details` do Oficializar viram alvos, e o fã-clube é o principal.
  for (const action of ["fanClub.directPosts.allowed", "fanClub.directPosts.revoked"]) {
    assert.deepEqual(audit.detailLines({ action, details: { clubId: "club1", artistId: "netto", fanUid: "uidCamila" } }), [], action);
    const entry = { action, targetEmail: "", targetUid: null, targets: ["fanClub:club1", "artist:netto", "fan:uidCamila"] };
    assert.deepEqual(audit.primaryTarget(entry), { target: { type: "fanClub", id: "club1" }, email: null, more: 2 }, action);
  }
  // O Conferida: os `details` do Aprovar, com o `reason` nulo; a publicação é o principal.
  assert.deepEqual(audit.detailLines({ action: "fanClub.post.checked", details: { fanClubPostId: "p1", clubId: "club1", artistId: "netto", authorUid: "u1", reason: null } }), []);
  const checked = { action: "fanClub.post.checked", targetEmail: "", targetUid: null, targets: ["fanClub:club1", "artist:netto", "fan:u1", "fanClubPost:p1"] };
  assert.deepEqual(audit.primaryTarget(checked), { target: { type: "fanClubPost", id: "p1" }, email: null, more: 3 });
});

test("a contagem e os textos novos, sem travessão nem meia-risca", () => {
  assert.equal(model.directPostsCountText(1), "1 publicação sem revisão");
  assert.equal(model.directPostsCountText(3), "3 publicações sem revisão");
  assert.equal(model.NO_WAITING.directPosts, 0);
  const texts = [
    model.ALLOW_DIRECT_POSTS_TEXT,
    model.REVOKE_DIRECT_POSTS_TEXT,
    model.CHECK_POST_TEXT,
    model.HIDE_DIRECT_POST_TEXT,
    ...model.FAN_CLUB_STATUSES.map((status) => model.unofficializeText(status, true)),
    model.directPostsText({ directPosts: true, directPostsAt: sp("2026-11-04T10:00:00"), directPostsBy: { uid: "s", name: "Iara" } }, sp("2026-11-04T15:00:00")),
    errors.REASON_MESSAGES["not-official"],
  ];
  for (const text of texts) assert.doesNotMatch(text, DASHES, text);
});
