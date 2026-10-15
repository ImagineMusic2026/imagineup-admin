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
});

test("a troca do @ pelo motivo: o texto, o aviso depois e o prazo que ainda vale", () => {
  assert.deepEqual([...moderation.USERNAME_RESET_REASONS], ["moderation", "central"]);
  assert.equal(
    moderation.resetUsernameText("promoseg", "moderation"),
    "O fã fica com um @ automático novo e só escolhe outro daqui a 30 dias. O @promoseg fica livre para qualquer pessoa.",
  );
  assert.equal(
    moderation.resetUsernameText("promoseg", "central"),
    "O fã fica com um @ automático novo e pode escolher outro na hora. O @promoseg fica livre para qualquer pessoa.",
  );
  const now = new Date("2026-10-15T15:00:00Z");
  assert.equal(
    moderation.resetUsernameDoneText("promoseg", "Promo", "2026-11-14T15:00:00.000Z", now),
    "O @promoseg foi trocado por um automático. Promo escolhe outro a partir de 14 nov.",
  );
  assert.equal(moderation.resetUsernameDoneText("promoseg", "Promo", null, now), "O @promoseg foi trocado por um automático. Promo pode escolher outro na hora.");
  assert.equal(moderation.resetUsernameDoneText("promoseg", "Promo", "quando der", now), "O @promoseg foi trocado por um automático. Promo pode escolher outro na hora.");
  const until = new Date("2026-11-14T15:00:00Z");
  assert.equal(moderation.usernameLockText({ usernameChangeableAt: until, usernameLockReason: "moderation" }, now), "Liberada a partir de 14 nov, @ trocado pela equipe");
  assert.equal(moderation.usernameLockText({ usernameChangeableAt: until, usernameLockReason: null }, now), "Liberada a partir de 14 nov");
  assert.equal(moderation.usernameLockText({ usernameChangeableAt: new Date("2026-10-01T00:00:00Z"), usernameLockReason: "moderation" }, now), null);
  assert.equal(moderation.usernameLockText({ usernameChangeableAt: null, usernameLockReason: null }, now), null);
});

test("apagar bio e redes: os campos com o que apagar e o aviso pelo que saiu", () => {
  assert.deepEqual(moderation.clearableProfileFields({ bio: "Seguidores reais!", socialsStored: true }), ["bio", "socials"]);
  assert.deepEqual(moderation.clearableProfileFields({ bio: null, socialsStored: true }), ["socials"]);
  assert.deepEqual(moderation.clearableProfileFields({ bio: "Oi", socialsStored: false }), ["bio"]);
  assert.deepEqual(moderation.clearableProfileFields({ bio: null, socialsStored: false }), []);
  assert.equal(moderation.clearedProfileText("Promo", ["bio", "socials"]), "A bio e as redes de Promo foram apagadas.");
  assert.equal(moderation.clearedProfileText("Promo", ["bio"]), "A bio de Promo foi apagada.");
  assert.equal(moderation.clearedProfileText("Promo", ["socials"]), "As redes de Promo foram apagadas.");
  assert.equal(moderation.clearedProfileText("Promo", []), "Nada a apagar: a bio e as redes já estavam vazias.");
  assert.equal(moderation.PROFILE_TEXT_FIELD_LABELS.socials, "Redes sociais");
});

test("o item de perfil lido: rodada, motivos, resolução e quem resolveu, defensivo", () => {
  const item = moderation.parseProfileQueueItem("u1", {
    uid: "u1",
    reportCount: 3,
    reasons: { spam: 2, offensive: 1, harassment: -1, other: "x" },
    status: "resolved",
    resolution: "actioned",
    round: 2,
    openedAt: ts("2026-10-12T10:00:00"),
    firstReportedAt: ts("2026-10-01T10:00:00"),
    lastReportedAt: ts("2026-10-12T11:00:00"),
    resolvedAt: ts("2026-10-12T12:00:00"),
    resolvedBy: { uid: "s1", name: "Ana" },
    resolvedDigest: "abc",
    schemaVersion: 1,
  });
  assert.equal(item.uid, "u1");
  assert.equal(item.reportCount, 3);
  assert.deepEqual(item.reasons, { spam: 2, offensive: 1, harassment: 0, other: 0, none: 0 });
  assert.equal(item.status, "resolved");
  assert.equal(item.resolution, "actioned");
  assert.equal(item.round, 2);
  assert.equal(item.openedAt.getTime(), sp("2026-10-12T10:00:00"));
  assert.deepEqual(item.resolvedBy, { uid: "s1", name: "Ana" });
  assert.equal("resolvedDigest" in item, false);

  const cases = [
    [{ status: "outro" }, "status", "open"],
    [{ resolution: "hidden" }, "resolution", null],
    [{ resolution: "withdrawn" }, "resolution", "withdrawn"],
    [{ round: 0 }, "round", 1],
    [{ round: 1.5 }, "round", 1],
    [{ round: "2" }, "round", 1],
    [{ reportCount: -4 }, "reportCount", 0],
    [{ resolvedBy: { name: "Ana" } }, "resolvedBy", null],
    [{ resolvedBy: null }, "resolvedBy", null],
    [{ openedAt: "ontem" }, "openedAt", null],
  ];
  for (const [fields, key, expected] of cases) {
    assert.deepEqual(moderation.parseProfileQueueItem("u2", fields)[key], expected, `${key}: ${JSON.stringify(fields)}`);
  }
});

test("a lista de perfis: a contagem, o mais antigo pela rodada e as decisões possíveis", () => {
  assert.equal(moderation.profileQueueCountText(0), "Nenhum perfil denunciado");
  assert.equal(moderation.profileQueueCountText(1), "1 perfil denunciado");
  assert.equal(moderation.profileQueueCountText(2), "2 perfis denunciados");
  const now = new Date(sp("2026-10-14T12:00:00"));
  // O reaberto conta do começo da rodada, não da primeira denúncia de todas.
  const items = [
    { openedAt: new Date(sp("2026-10-14T09:00:00")), firstReportedAt: new Date(sp("2026-09-01T09:00:00")) },
    { openedAt: new Date(sp("2026-10-14T11:00:00")) },
  ];
  assert.equal(moderation.profileOldestText(items, now), "o mais antigo há 3 h");
  assert.equal(moderation.profileOldestText([], now), null);
  assert.deepEqual(moderation.profileDecisions({ status: "open", resolution: null }), ["kept", "actioned"]);
  assert.deepEqual(moderation.profileDecisions({ status: "resolved", resolution: "kept" }), ["actioned"]);
  assert.deepEqual(moderation.profileDecisions({ status: "resolved", resolution: "actioned" }), ["kept"]);
  assert.deepEqual(moderation.profileDecisions({ status: "resolved", resolution: "withdrawn" }), []);
  assert.deepEqual(moderation.profileDecisions({ status: "resolved", resolution: "author_deleted" }), []);
  assert.equal(moderation.PROFILE_RESOLUTION_LABELS.kept, "Mantido");
  assert.equal(moderation.PROFILE_RESOLUTION_LABELS.actioned, "Resolvido com ação");
  assert.equal(moderation.PROFILE_RESOLUTION_LABELS.withdrawn, "Denúncias retiradas");
  assert.equal(moderation.PROFILE_RESOLUTION_LABELS.author_deleted, "Conta excluída");
});
