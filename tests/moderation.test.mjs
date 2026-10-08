import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const moderation = await import("@/lib/moderation");

const sp = (local) => Date.parse(`${local}-03:00`);
const ts = (local) => Timestamp.fromMillis(sp(local));

test("o item da fila lido: motivos, decisão e quem resolveu", () => {
  const item = moderation.parseQueueItem("c1", {
    commentId: "c1",
    postId: "p-clipe",
    artistId: "nettobrito",
    authorUid: "u1",
    commentText: "Promoção!",
    reportCount: 3,
    reasons: { spam: 2, offensive: 0, harassment: 0, other: 0, none: 1 },
    status: "resolved",
    resolution: "hidden",
    firstReportedAt: ts("2026-10-07T22:46:00"),
    lastReportedAt: ts("2026-10-08T01:00:00"),
    resolvedAt: ts("2026-10-08T02:00:00"),
    resolvedBy: { uid: "s1", name: "Equipe de Teste" },
  });
  assert.equal(item.resolution, "hidden");
  assert.equal(item.resolvedBy, "Equipe de Teste");
  assert.equal(moderation.reasonsText(item.reasons), "Spam 2 · Sem motivo 1");
  assert.equal(moderation.reasonsSpoken(item.reasons), "Denúncias: 2 spam e 1 sem motivo");
  const deleted = moderation.parseQueueItem("c2", { status: "resolved", resolution: "author_deleted", commentText: null, resolvedBy: null });
  assert.equal(deleted.commentText, null);
  assert.equal(deleted.resolvedBy, null);
  assert.equal(moderation.RESOLUTION_LABELS[deleted.resolution], "Autor excluiu a conta");
  assert.equal(moderation.parseQueueItem("c3", { resolution: "estranho" }).resolution, null);
});

test("o cabeçalho: a contagem e o mais antigo", () => {
  assert.equal(moderation.queueCountText(1), "1 comentário na fila");
  assert.equal(moderation.queueCountText(3), "3 comentários na fila");
  const now = new Date(sp("2026-10-08T10:00:00"));
  const items = [{ firstReportedAt: new Date(sp("2026-10-08T07:00:00")) }, { firstReportedAt: new Date(sp("2026-10-08T09:30:00")) }, { firstReportedAt: null }];
  assert.equal(moderation.oldestText(items, now), "o mais antigo há 3 h");
  assert.equal(moderation.oldestText([], now), null);
});

test("o comentário lido e o trecho do post", () => {
  const comment = moderation.parseComment("p1", "c1", {
    authorUid: "u1",
    authorName: "  Alan  ",
    authorPhotoURL: "javascript:alert(1)",
    text: "Que música!",
    status: "hidden",
    hiddenAt: ts("2026-10-08T04:00:00"),
    hiddenBy: "s1",
  });
  assert.equal(comment.authorName, "Alan");
  assert.equal(comment.authorPhotoURL, null);
  assert.equal(comment.status, "hidden");
  assert.equal(comment.hiddenBy, "s1");
  assert.equal(moderation.parseComment("p1", "c2", {}).authorName, "Fã sem nome");
  assert.equal(moderation.postSnippet("  Saiu   o clipe\nnovo  "), "Saiu o clipe novo");
  assert.equal(moderation.postSnippet("x".repeat(90)).length, 80);
  assert.equal(moderation.postSnippet(""), null);
});

test("a suspensão: a nota opcional e as frases", () => {
  assert.deepEqual(moderation.validateSuspensionNote("  "), { error: null, value: null });
  assert.deepEqual(moderation.validateSuspensionNote(" Conta de propaganda "), { error: null, value: "Conta de propaganda" });
  assert.equal(moderation.validateSuspensionNote("x".repeat(281)).error, "Até 280 caracteres, numa linha.");
  assert.equal(moderation.hideAlsoLabel(1), "Ocultar também o comentário visível");
  assert.equal(moderation.hideAlsoLabel(3), "Ocultar também os 3 comentários visíveis");
  assert.equal(moderation.hiddenSummary(0), "Nenhum comentário visível para ocultar.");
  assert.equal(moderation.hiddenSummary(25), "25 comentários ocultados.");
  assert.match(moderation.resetUsernameText("promoseg"), /O @promoseg fica livre para qualquer pessoa\.$/);
});
