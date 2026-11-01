import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// A Fase 2 do fã-clube no painel (seção 37 da nota do app, 37.10): o
// comentário e o item da fila lidos, as decisões que cada card oferece, a
// confirmação, o corpo da callable com a rodada, a publicação com as reações
// e os marcados, o registro do ocultar do gestor, a taxa de 30 dias e os
// rótulos dos Logs, do extrato e do pedido de dados.

const calls = [];
mock.module("@/lib/callable", {
  namedExports: {
    LONG_CALL_TIMEOUT_MS: 130_000,
    call: async (name, data) => {
      calls.push([name, data]);
      return { ok: true, subject: data.subject, id: data.id, status: "visible" };
    },
  },
});

const model = await import("@/lib/fan-clubs");
const api = await import("@/lib/fan-club-api");
const audit = await import("@/lib/audit");
const stats = await import("@/lib/stats");
const exportLabels = await import("@/lib/fan-data-export");
const errors = await import("@/lib/errors");

const DASHES = /[–—]/;
const sp = (local) => new Date(`${local}-03:00`);
const ts = (date) => ({ toDate: () => date, toMillis: () => date.getTime() });
const NOW = sp("2026-10-27T15:00:00");

const EDITOR = { uid: "staff1", canEdit: true };
const READER = { uid: "staff2", canEdit: false };

function comment(fields = {}) {
  return model.parseComment("cm1", {
    clubId: "club1",
    postId: "p1",
    artistId: "netto",
    authorUid: "uidRank40",
    authorName: "Fã do ranking 40",
    authorUsername: "rank40",
    text: "Que show!",
    replyToId: null,
    replyCount: 0,
    status: "visible",
    hiddenAt: null,
    hiddenBy: null,
    restoredByStaffAt: null,
    reviewRequestedAt: null,
    reviewOutcome: null,
    createdAt: ts(sp("2026-10-26T10:00:00")),
    ...fields,
  });
}

function item(fields = {}) {
  return model.parseCommentItem("cm1", {
    commentId: "cm1",
    postId: "p1",
    clubId: "club1",
    artistId: "netto",
    authorUid: "uidRank40",
    kind: "report",
    reportCount: 1,
    reasons: { spam: 1, offensive: 0, harassment: 0, other: 0, none: 0 },
    reviewRequested: false,
    status: "open",
    resolution: null,
    round: 1,
    lastActivityAt: ts(sp("2026-10-27T09:00:00")),
    ...fields,
  });
}

test("o comentário lido: os status, a resposta, o autor e o status estranho como oculto pela equipe", () => {
  const visible = comment();
  assert.equal(visible.status, "visible");
  assert.equal(visible.replyToId, null);
  assert.equal(model.commentAuthorLabel(visible), "Fã do ranking 40");
  assert.equal(model.commentAuthorLabel({ authorName: null, authorUsername: "biasan" }), "@biasan");
  assert.equal(model.commentAuthorLabel({ authorName: null, authorUsername: null }), "Fã sem nome");

  const reply = comment({ replyToId: "cmTop", status: "manager_hidden", hiddenAt: ts(sp("2026-10-27T10:00:00")), reviewOutcome: "kept" });
  assert.equal(reply.replyToId, "cmTop");
  assert.equal(reply.reviewOutcome, "kept");
  assert.equal(model.parseComment("x", { status: "outra coisa" }).status, "staff_hidden");

  // A marca "Gestor" é o autor igual ao gestor do fã-clube, calculada na leitura.
  assert.equal(model.isManagerComment({ authorUid: "uidCamila" }, "uidCamila"), true);
  assert.equal(model.isManagerComment({ authorUid: "uidCamila" }, null), false);
  assert.equal(model.isManagerComment({ authorUid: "uidBia" }, "uidCamila"), false);
});

test("o status de agora e as marcas: oculto pelo gestor com a data, reexibido pela equipe e mantido oculto", () => {
  assert.equal(model.commentStatusText(comment(), NOW), "Visível");
  const hidden = comment({ status: "manager_hidden", hiddenAt: ts(sp("2026-10-27T10:00:00")) });
  assert.equal(model.commentStatusText(hidden, NOW), "Oculto pelo gestor em 27 out, 10:00");
  assert.equal(model.commentStatusText(comment({ status: "staff_hidden", hiddenAt: ts(sp("2026-10-27T11:30:00")) }), NOW), "Oculto pela equipe em 27 out, 11:30");
  assert.equal(model.commentStatusText(comment({ status: "staff_hidden" }), NOW), "Oculto pela equipe");

  assert.deepEqual(model.commentMarks(comment({ restoredByStaffAt: ts(sp("2026-10-27T12:00:00")) }), NOW), ["Reexibido pela equipe em 27 out, 12:00"]);
  assert.deepEqual(model.commentMarks({ ...hidden, reviewOutcome: "kept" }, NOW), ["A equipe manteve oculto"]);
  // O "manteve oculto" de um ocultar antigo não vale para o comentário que já voltou.
  assert.deepEqual(model.commentMarks(comment({ reviewOutcome: "kept" }), NOW), []);
});

test("o item da fila lido: o tipo, as denúncias, os motivos, a rodada e as resoluções", () => {
  const report = item();
  assert.deepEqual(model.commentItemMarks(report), ["1 denúncia"]);
  assert.equal(model.commentReasonsText(report.reasons), "Spam: 1");
  assert.equal(report.round, 1);

  const review = item({ kind: "review", reportCount: 0, reasons: {}, reviewRequestedAt: ts(sp("2026-10-27T08:00:00")) });
  assert.deepEqual(model.commentItemMarks(review), ["Revisão pedida"]);
  assert.equal(model.commentReasonsText(review.reasons), null);

  // O aberto por denúncia que recebeu depois o pedido continua `report`, com as duas marcas.
  const both = item({ reportCount: 3, reviewRequested: true, reasons: { spam: 2, offensive: 1, none: 0 } });
  assert.deepEqual(model.commentItemMarks(both), ["3 denúncias", "Revisão pedida"]);
  assert.equal(model.commentReasonsText(both.reasons), "Spam: 2 · Ofensivo: 1");
  assert.equal(model.commentReasonsText(item({ reasons: { none: 2 } }).reasons), "Sem motivo: 2");

  assert.equal(item({ status: "estranho" }).status, "resolved");
  assert.equal(item({ kind: "estranho" }).kind, "report");
  for (const resolution of model.COMMENT_RESOLUTIONS) assert.equal(item({ status: "resolved", resolution }).resolution, resolution);
  assert.equal(model.COMMENT_RESOLUTION_LABELS.kept, "Mantido");
  assert.equal(model.COMMENT_RESOLUTION_LABELS.hidden, "Ocultado pela equipe");
  assert.equal(model.COMMENT_RESOLUTION_LABELS.restored, "Reexibido");
  for (const resolution of ["withdrawn", "author_deleted", "removed"]) {
    assert.equal(model.COMMENT_RESOLUTION_LABELS[resolution], "Encerrado sem decisão da equipe");
    assert.equal(model.decidedByTeam({ resolution }), false);
    assert.ok(model.COMMENT_CLOSED_REASONS[resolution]);
  }
  assert.equal(model.decidedByTeam({ resolution: "kept" }), true);
  assert.equal(model.commentReportsCountText(1), "1 comentário denunciado");
  assert.equal(model.reviewRequestsCountText(2), "2 pedidos de revisão");
});

test("as decisões do card: os abertos, os resolvidos pela equipe, os encerrados, o apagado e o self", () => {
  const visible = { status: "visible" };
  const managerHidden = { status: "manager_hidden" };
  const staffHidden = { status: "staff_hidden" };
  const open = item();
  assert.deepEqual(model.commentItemDecisions(open, visible, "uidCamila", EDITOR), ["keep", "hide"]);
  assert.deepEqual(model.commentItemDecisions(open, managerHidden, "uidCamila", EDITOR), ["keep", "restore", "hide"]);
  assert.deepEqual(model.commentItemDecisions(open, staffHidden, "uidCamila", EDITOR), ["restore"]);

  // O resolvido pela equipe: só o que cabe no status de agora, e nunca o Manter.
  for (const resolution of ["kept", "hidden", "restored"]) {
    const resolved = item({ status: "resolved", resolution });
    assert.deepEqual(model.commentItemDecisions(resolved, visible, "uidCamila", EDITOR), ["hide"], resolution);
    assert.deepEqual(model.commentItemDecisions(resolved, managerHidden, "uidCamila", EDITOR), ["restore", "hide"], resolution);
    assert.deepEqual(model.commentItemDecisions(resolved, staffHidden, "uidCamila", EDITOR), ["restore"], resolution);
  }
  for (const resolution of ["withdrawn", "author_deleted", "removed"]) {
    assert.deepEqual(model.commentItemDecisions(item({ status: "resolved", resolution }), visible, "uidCamila", EDITOR), [], resolution);
  }

  // O apagado e o que não carregou: sem o status, nenhum botão.
  assert.deepEqual(model.commentItemDecisions(open, null, "uidCamila", EDITOR), []);
  assert.deepEqual(model.commentItemDecisions(open, "unknown", "uidCamila", EDITOR), []);
  // O Leitor, o autor e o gestor do fã-clube não decidem.
  assert.deepEqual(model.commentItemDecisions(open, visible, "uidCamila", READER), []);
  assert.deepEqual(model.commentItemDecisions(open, visible, "uidCamila", { uid: "uidRank40", canEdit: true }), []);
  assert.deepEqual(model.commentItemDecisions(open, visible, "uidCamila", { uid: "uidCamila", canEdit: true }), []);
  assert.equal(model.isCommentSelf("uidRank40", null, { uid: "uidCamila" }), false);

  // Fora da fila (o diálogo da ficha e o registro do ocultar): Ocultar e Reexibir, sem Manter.
  assert.deepEqual(model.commentDecisions({ status: "visible", authorUid: "uidBia" }, "uidCamila", EDITOR), ["hide"]);
  assert.deepEqual(model.commentDecisions({ status: "manager_hidden", authorUid: "uidBia" }, "uidCamila", EDITOR), ["restore", "hide"]);
  assert.deepEqual(model.commentDecisions({ status: "staff_hidden", authorUid: "uidBia" }, "uidCamila", EDITOR), ["restore"]);
  assert.deepEqual(model.commentDecisions({ status: "visible", authorUid: "uidCamila" }, "uidCamila", { uid: "uidCamila", canEdit: true }), []);
  assert.deepEqual(model.commentDecisions({ status: "visible", authorUid: "uidBia" }, "uidCamila", READER), []);
});

test("a confirmação é de comentário, e os avisos dizem o que foi feito", () => {
  assert.equal(model.commentDecisionLabel("keep", "visible"), "Manter");
  assert.equal(model.commentDecisionLabel("keep", "manager_hidden"), "Manter oculto");
  assert.equal(model.commentDecisionLabel("hide", "visible"), "Ocultar");
  assert.equal(model.commentDecisionLabel("restore", "staff_hidden"), "Reexibir");

  assert.deepEqual(model.commentDecisionText("keep", { status: "visible" }), { title: "Manter o comentário?", body: "A denúncia sai da fila, e o comentário continua visível." });
  assert.deepEqual(model.commentDecisionText("keep", { status: "manager_hidden" }), {
    title: "Manter o comentário oculto?",
    body: "O autor vê que a equipe manteve oculto e não pode pedir revisão de novo deste ocultar.",
  });
  assert.deepEqual(model.commentDecisionText("hide", { status: "visible", replyToId: "cmTop", replyCount: 0 }), {
    title: "Ocultar o comentário?",
    body: "O comentário some para todos, também para o autor. O gestor não pode reexibir.",
  });
  assert.deepEqual(model.commentDecisionText("restore", { status: "manager_hidden" }), {
    title: "Reexibir o comentário?",
    body: "O comentário volta a aparecer para todos, e o gestor não pode ocultá-lo de novo.",
  });
  // O de cima leva as respostas visíveis junto (o `1 + replyCount` do `commentCount`).
  assert.match(model.commentDecisionText("hide", { status: "visible", replyToId: null, replyCount: 1 }).body, /A resposta visível embaixo dele também deixa de aparecer\.$/);
  assert.match(model.commentDecisionText("hide", { status: "visible", replyToId: null, replyCount: 3 }).body, /As 3 respostas visíveis embaixo dele também deixam de aparecer\.$/);
  // No resolvido, a decisão da rodada troca.
  assert.match(model.commentDecisionText("restore", { status: "staff_hidden" }, { status: "resolved", resolution: "hidden", round: 2 }).body, /A decisão da rodada 2 passa de Ocultado pela equipe para Reexibido\.$/);

  assert.equal(model.commentDoneText("keep", "visible"), "Comentário mantido.");
  assert.equal(model.commentDoneText("keep", "manager_hidden"), "Comentário mantido oculto.");
  assert.equal(model.commentDoneText("hide", "visible"), "Comentário ocultado.");
  assert.equal(model.commentDoneText("restore", "staff_hidden"), "Comentário reexibido.");

  // A decisão velha e o comentário que saiu tiram o botão de confirmar.
  const failure = (reason) => Object.assign(new Error("x"), { code: "functions/failed-precondition", details: { reason } });
  assert.equal(model.blocksCommentRetry(failure("stale-decision")), true);
  assert.equal(model.blocksCommentRetry(failure("fan-club-comment-not-found")), true);
  assert.equal(model.blocksCommentRetry(failure("not-staff")), false);
  assert.equal(errors.REASON_MESSAGES["fan-club-comment-not-found"], "Esse comentário não existe mais.");
});

test("o corpo da callable: o assunto comment, o status mostrado e a rodada (null fora da fila)", async () => {
  calls.length = 0;
  await api.decideFanClubComment("cm1", "manager_hidden", "keep", 1);
  await api.decideFanClubComment("cm1", "visible", "hide", 2);
  await api.decideFanClubComment("cm2", "manager_hidden", "restore");
  assert.deepEqual(calls, [
    ["decideFanClub", { subject: "comment", id: "cm1", decision: "keep", expected: "manager_hidden", round: 1 }],
    ["decideFanClub", { subject: "comment", id: "cm1", decision: "hide", expected: "visible", round: 2 }],
    ["decideFanClub", { subject: "comment", id: "cm2", decision: "restore", expected: "manager_hidden", round: null }],
  ]);
});

test("a publicação com as reações, os comentários e os marcados; a de antes da Fase 2 vale 0", () => {
  const post = model.parsePost("p1", {
    clubId: "club1",
    status: "published",
    text: "Obrigada pelo carinho, @biasan! Bora ouvir o @nettobrito no sábado.",
    reactionCount: 3,
    reactionCounts: { heart: 2, clap: 1, fire: "x" },
    commentCount: 4,
    mentions: [
      { handle: "biasan", kind: "fan", id: "uidBia", start: 23, end: 30 },
      { handle: "nettobrito", kind: "artist", id: "nettobrito", start: 46, end: 57 },
      { handle: "biasan", kind: "fan", id: "uidBia", start: 60, end: 67 },
      { handle: "", kind: "fan", id: "x" },
      { handle: "estranho", kind: "outro", id: "y" },
    ],
  });
  assert.equal(post.reactionCount, 3);
  assert.deepEqual(post.reactionCounts, { heart: 2, fire: 0, laugh: 0, wow: 0, clap: 1 });
  assert.equal(post.commentCount, 4);
  assert.deepEqual(post.mentions, [
    { handle: "biasan", kind: "fan", id: "uidBia" },
    { handle: "nettobrito", kind: "artist", id: "nettobrito" },
  ]);
  assert.deepEqual(
    model.reactionBreakdown(post.reactionCounts).map((part) => `${part.count} ${part.emoji} ${part.label}`),
    ["2 ❤️ coração", "1 👏 aplauso"],
  );
  assert.equal(model.reactionCountText(1), "1 reação");
  assert.equal(model.commentCountText(4), "4 comentários");
  assert.equal(model.MENTION_KIND_LABELS.artist, "central");

  const old = model.parsePost("p0", { status: "pending", text: "Antes" });
  assert.equal(old.reactionCount, 0);
  assert.equal(old.commentCount, 0);
  assert.deepEqual(old.mentions, []);
  // Os totais só na que já foi ao ar.
  assert.equal(model.postWasPublished({ status: "pending" }), false);
  assert.equal(model.postWasPublished({ status: "rejected" }), false);
  assert.equal(model.postWasPublished({ status: "withdrawn" }), false);
  for (const status of ["published", "hidden", "removed"]) assert.equal(model.postWasPublished({ status }), true, status);
});

test("o registro do ocultar: a ação, a conta excluída, a contagem e o Reexibir só na linha mais nova do oculto", () => {
  const entry = model.parseHideLogEntry("h1", { clubId: "club1", postId: "p2", commentId: "cmOculto", authorUid: "uidRank40", managerUid: "uidCamila", action: "hidden", at: ts(sp("2026-10-27T10:00:00")) });
  assert.equal(entry.action, "hidden");
  assert.equal(model.HIDE_LOG_ACTION_LABELS[entry.action], "Ocultou");
  assert.equal(model.parseHideLogEntry("h2", { action: "restored", authorUid: null }).authorUid, null);
  assert.equal(model.HIDE_LOG_ACTION_LABELS.restored, "Reexibiu");
  assert.equal(model.managerHidesText(0), "O gestor ainda não ocultou nenhum comentário.");
  assert.equal(model.managerHidesText(1), "O gestor ocultou 1 vez.");
  assert.equal(model.managerHidesText(3), "O gestor ocultou 3 vezes.");

  const rows = [
    { id: "h3", commentId: "a" },
    { id: "h2", commentId: "a" },
    { id: "h1", commentId: "b" },
    { id: "h0", commentId: "c" },
  ];
  const statuses = new Map([
    ["a", "manager_hidden"],
    ["b", "visible"],
  ]);
  assert.deepEqual([...model.hideLogRestorable(rows, statuses)], ["h3"]);
});

test("a taxa de 30 dias: o período, o arredondamento, sem seguidor e a chave fora do formato", () => {
  const now = NOW.getTime();
  const days = {
    "2026-10-27": { reactions: 2, comments: 4 },
    "2026-09-28": { reactions: 1, comments: 2 },
    // O dia 31 antes de hoje (a cópia ainda não cortou) e um dia depois de hoje ficam de fora.
    "2026-09-27": { reactions: 50, comments: 50 },
    "2026-10-28": { reactions: 50, comments: 50 },
    "27/10/2026": { reactions: 50, comments: 50 },
  };
  assert.deepEqual(model.fanClubEngagement(days, 2, now), { reactions: 3, comments: 6, rate: 450 });
  assert.deepEqual(model.fanClubEngagement(days, 3, now), { reactions: 3, comments: 6, rate: 300 });
  assert.equal(model.fanClubEngagement(days, 0, now).rate, null);
  // Uma casa decimal, a meia casa para cima: 1/16 = 6,25% vira 6,3%; 1/3 vira 33,3%.
  assert.equal(model.fanClubEngagement({ "2026-10-27": { reactions: 1, comments: 0 } }, 16, now).rate, 6.3);
  assert.equal(model.fanClubEngagement({ "2026-10-27": { reactions: 1, comments: 0 } }, 3, now).rate, 33.3);
  // As somas nunca saem negativas.
  assert.deepEqual(model.fanClubEngagement({ "2026-10-27": { reactions: -4, comments: 1 } }, 1, now), { reactions: 0, comments: 1, rate: 100 });
  assert.equal(model.formatRate(450), "450,0%");
  assert.equal(model.formatRate(6.3), "6,3%");

  // A ficha divide pelos seguidores da cópia da noite, com a data dela.
  const counts = { followers: 2, at: sp("2026-10-27T00:21:00") };
  assert.deepEqual(model.engagementView(days, counts, NOW), { value: "450,0%", detail: "3 reações e 6 comentários, 2 seguidores na cópia de 27 out." });
  assert.deepEqual(model.engagementView(days, { followers: 0, at: counts.at }, NOW), { value: "Sem seguidores na cópia", detail: "3 reações e 6 comentários em 30 dias." });
  assert.equal(model.engagementView(days, { followers: 2, at: null }, NOW).value, "Sem cópia");
  assert.equal(model.engagementView(days, null, NOW).value, "Sem cópia");
  assert.match(model.ENGAGEMENT_NOTE, /Ela não decide prêmio/);
});

test("os Logs: as três ações, o alvo do comentário, o status de antes, a rodada e o ocultar em lote, sem texto", () => {
  assert.equal(audit.AUDIT_ACTIONS["fanClub.comment.kept"].label, "Comentário de fã-clube mantido");
  assert.equal(audit.AUDIT_ACTIONS["fanClub.comment.hidden"].label, "Comentário de fã-clube ocultado");
  assert.equal(audit.AUDIT_ACTIONS["fanClub.comment.restored"].label, "Comentário de fã-clube reexibido");
  for (const action of ["fanClub.comment.kept", "fanClub.comment.hidden", "fanClub.comment.restored"]) assert.equal(audit.AUDIT_ACTIONS[action].section, "fanClubs");
  assert.equal(audit.TARGET_LABELS.fanClubComment, "Comentário de fã-clube");
  assert.ok(audit.isTargetType("fanClubComment"));

  // O alvo principal é o comentário, e não a publicação, o fã-clube nem o autor.
  const targets = ["fanClubComment:cm1", "fanClubPost:p1", "fanClub:club1", "fan:uidRank40", "fan:uidCamila"];
  assert.deepEqual(audit.primaryTarget({ action: "fanClub.comment.hidden", targetEmail: "", targetUid: null, targets }), { target: { type: "fanClubComment", id: "cm1" }, email: null, more: 4 });

  const details = { fanClubCommentId: "cm1", fanClubPostId: "p1", clubId: "club1", authorUid: "uidRank40", fanUid: "uidCamila", from: "manager_hidden", round: 1 };
  assert.deepEqual(audit.detailLines({ action: "fanClub.comment.kept", details }), ["Antes: oculto pelo gestor", "Rodada: 1"]);
  assert.deepEqual(audit.detailLines({ action: "fanClub.comment.hidden", details: { ...details, from: "visible", round: null } }), ["Antes: visível"]);
  assert.deepEqual(audit.detailLines({ action: "fanClub.comment.restored", details: { ...details, from: "staff_hidden", round: 2 } }), ["Antes: oculto pela equipe", "Rodada: 2"]);

  // O ocultar em lote da Moderação: os do Mural e os dos fã-clubes contados, nunca os ids nem o texto.
  assert.deepEqual(audit.detailLines({ action: "fan.comments.hidden", details: { uid: "u1", count: 3, postIds: ["a", "b"], commentIds: ["x", "y", "z"] } }), ["3 comentários do Mural, em 2 posts", "Quantidade: 3"]);
  assert.deepEqual(audit.detailLines({ action: "fan.comments.hidden", details: { uid: "u1", count: 1, fanClubPostIds: ["p1"], fanClubCommentIds: ["cm1"] } }), [
    "1 comentário de fã-clube, em 1 publicação",
    "Quantidade: 1",
  ]);
  const hidden = { action: "fan.comments.hidden", targetEmail: "", targetUid: "u1", targets: ["fan:u1", "fanClubComment:cm1", "fanClubPost:p1"] };
  assert.deepEqual(audit.primaryTarget(hidden).target, { type: "fan", id: "u1" });
});

test("os rótulos do extrato e do pedido de dados", () => {
  assert.equal(stats.sourceLabel("fanclub_like"), "Reação no fã-clube");
  assert.equal(stats.sourceLabel("fanclub_comment"), "Comentário no fã-clube");
  assert.equal(exportLabels.partLabel("comentariosDeFaClube"), "comentários de fã-clube");
  assert.equal(exportLabels.partLabel("reacoesDeFaClube"), "reações de fã-clube");
});

test("os textos novos não têm travessão nem meia-risca", () => {
  const texts = [
    ...Object.values(model.COMMENT_STATUS_LABELS),
    ...Object.values(model.COMMENT_RESOLUTION_LABELS),
    ...Object.values(model.COMMENT_CLOSED_REASONS),
    ...Object.values(model.HIDE_LOG_ACTION_LABELS),
    ...Object.values(model.REACTION_LABELS),
    model.COMMENT_SELF_TEXT,
    model.ENGAGEMENT_NOTE,
    ...["keep", "hide", "restore"].flatMap((decision) => ["visible", "manager_hidden", "staff_hidden"].flatMap((status) => Object.values(model.commentDecisionText(decision, { status, replyToId: null, replyCount: 2 })))),
  ];
  for (const text of texts) assert.doesNotMatch(text, DASHES, text);
});
