import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const audit = await import("@/lib/audit");

const DASHES = /[–—]/;

test("todas as ações têm rótulo sem travessão e uma seção do painel", () => {
  const sections = new Set(audit.AUDIT_SECTIONS);
  for (const [action, info] of Object.entries(audit.AUDIT_ACTIONS)) {
    assert.ok(info.label, action);
    assert.doesNotMatch(info.label, DASHES, action);
    assert.ok(sections.has(info.section), action);
  }
  assert.equal(Object.keys(audit.AUDIT_ACTIONS).length, 80);
  assert.equal(audit.auditSectionLabel("team"), "Equipe");
  assert.equal(audit.auditSectionLabel(null), "Outros");
  assert.equal(audit.auditSectionLabel("audit"), "Logs e auditoria");
  assert.deepEqual(audit.actionsOfSection("fans"), ["wallet.adjusted", "fan.email.lookup", "fan.data.exported", "fan.account.deleted"]);
  assert.equal(audit.AUDIT_ACTIONS["fan.data.exported"].label, "Dados do fã exportados (LGPD)");
  assert.equal(audit.AUDIT_ACTIONS["fan.account.deleted"].label, "Conta do fã excluída (LGPD)");
});

test("o fã-clube nos Logs: as 13 ações, os alvos, os detalhes e o endereço já filtrado", () => {
  // As 13 ações que o servidor grava (34.8 e 34.22), na seção Fã-clubes.
  assert.deepEqual(audit.actionsOfSection("fanClubs"), [
    "fanClub.application.approved",
    "fanClub.application.rejected",
    "fanClub.paused",
    "fanClub.resumed",
    "fanClub.closed",
    "fanClub.featured",
    "fanClub.unfeatured",
    "fanClub.rewarded",
    "fanClub.post.approved",
    "fanClub.post.rejected",
    "fanClub.post.hidden",
    "fanClub.post.restored",
    "fanClub.report.resolved",
  ]);
  assert.equal(audit.auditSectionLabel("fanClubs"), "Fã-clubes");
  assert.equal(audit.TARGET_LABELS.fanClub, "Fã-clube");
  assert.equal(audit.TARGET_LABELS.fanClubPost, "Publicação de fã-clube");
  assert.ok(audit.isTargetType("fanClubPost"));

  // Na ação do fã-clube, o alvo principal é o fã-clube; na suspensão que pausou, continua o fã.
  const approved = { action: "fanClub.application.approved", targetEmail: "", targetUid: null, targets: ["fanClub:club1", "artist:netto", "fan:uidCamila"] };
  assert.deepEqual(audit.primaryTarget(approved), { target: { type: "fanClub", id: "club1" }, email: null, more: 2 });
  const suspended = { action: "fan.suspended", targetEmail: "", targetUid: "uidCamila", targets: ["fan:uidCamila", "fanClub:club1"] };
  assert.deepEqual(audit.primaryTarget(suspended), { target: { type: "fan", id: "uidCamila" }, email: null, more: 1 });

  assert.deepEqual(audit.detailLines({ action: "fanClub.application.approved", details: { clubId: "club1", artistId: "netto", fanUid: "u1", round: 2, nameChanged: true } }), [
    "Rodada: 2",
    "Nome ajustado pela equipe",
  ]);
  assert.deepEqual(audit.detailLines({ action: "fanClub.application.rejected", details: { artistId: "netto", fanUid: "u1", round: 1, reason: "image_rights" } }), [
    "Rodada: 1",
    "Motivo: Uso de imagem",
  ]);
  assert.deepEqual(audit.detailLines({ action: "fanClub.closed", details: { clubId: "club1", artistId: "netto", fanUid: "u1", reason: "owner_request" } }), ["Motivo: A pedido do gestor"]);
  assert.deepEqual(audit.detailLines({ action: "fanClub.paused", details: { clubId: "club1", artistId: "netto", fanUid: null } }), []);
  assert.deepEqual(audit.detailLines({ action: "fanClub.featured", details: { clubId: "club1", featuredUntil: "2026-11-02" } }), ["Destaque até 2 nov"]);
  // A suspensão leva o `clubId` do fã-clube que pausou: vira alvo, e não linha.
  assert.deepEqual(audit.detailLines({ action: "fan.suspended", details: { reason: "spam", clubId: "club1" } }), ["Motivo: Spam"]);

  // O Recompensar: os pontos e a nota; a recompensa, o pedido e a concessão viram alvo (o cupom e a mensagem nunca vêm).
  assert.deepEqual(
    audit.detailLines({ action: "fanClub.rewarded", details: { clubId: "club1", artistId: "netto", fanUid: "u1", grantId: "g-12345678", points: 200, rewardId: "cortesia", code: "UP-ABC123", note: "Muita divulgação" } }),
    ["Pontos ao saldo do gestor: +200", "Nota: Muita divulgação"],
  );
  assert.deepEqual(audit.detailLines({ action: "fanClub.rewarded", details: { clubId: "club1", grantId: "g-12345678", points: 50, rewardId: null, code: null, note: "Só pontos" } }), [
    "Pontos ao saldo do gestor: +50",
    "Sem prêmio",
    "Nota: Só pontos",
  ]);
  // A publicação: o motivo da recusa pela lista dela; o id vai em `fanClubPostId`, que vira o alvo.
  assert.deepEqual(audit.detailLines({ action: "fanClub.post.rejected", details: { fanClubPostId: "p1", clubId: "club1", artistId: "netto", authorUid: "u1", reason: "off_topic" } }), [
    "Motivo: Fora do assunto do artista",
  ]);
  assert.deepEqual(audit.detailLines({ action: "fanClub.post.hidden", details: { fanClubPostId: "p1", clubId: "club1", artistId: "netto", authorUid: "u1", reason: null } }), []);
  // A denúncia: a resolução, a contagem, a rodada e se esta decisão ocultou a publicação.
  assert.deepEqual(audit.detailLines({ action: "fanClub.report.resolved", details: { fanClubPostId: "p1", clubId: "club1", resolution: "actioned", reportCount: 2, round: 1, postHidden: true } }), [
    "Rodada: 1",
    "Resolução: Ocultada",
    "Denúncias na rodada: 2",
    "A publicação saiu do ar com esta decisão",
  ]);
  assert.deepEqual(audit.detailLines({ action: "fanClub.report.resolved", details: { fanClubPostId: "p1", clubId: "club1", resolution: "kept", reportCount: 1, round: 2, postHidden: false } }), [
    "Rodada: 2",
    "Resolução: Mantida",
    "Denúncias na rodada: 1",
  ]);
  // Na publicação e na denúncia, o alvo principal é a publicação, e o fã-clube vem logo depois.
  const hidden = { action: "fanClub.post.hidden", targetEmail: "", targetUid: null, targets: ["fanClub:club1", "artist:netto", "fan:u1", "fanClubPost:p1"] };
  assert.deepEqual(audit.primaryTarget(hidden), { target: { type: "fanClubPost", id: "p1" }, email: null, more: 3 });
  const rewarded = { action: "fanClub.rewarded", targetEmail: "", targetUid: null, targets: ["fanClub:club1", "artist:netto", "fan:u1", "reward:cortesia", "redemption:UP-ABC123"] };
  assert.deepEqual(audit.primaryTarget(rewarded), { target: { type: "fanClub", id: "club1" }, email: null, more: 4 });

  // As caixas do fã-clube no diálogo da central, como o `editArtist` grava no `changed`.
  assert.deepEqual(
    audit.detailLines({ action: "artist.updated", details: { artistId: "nenho", name: "Nenho", changed: ["imageRightsConfirmed", "fanClubs.enabled", "fanClubs.photosAllowed"] } }),
    ["Nome: Nenho", "Campos mudados: autorização de imagem, aceita fã-clubes e fotos dos fãs no fã-clube"],
  );

  assert.equal(audit.logsHref("fanClub:club1"), "/logs?alvo=fanClub%3Aclub1");
  assert.deepEqual(audit.filtersFromLink("fanClub:club1"), { ...audit.EMPTY_FILTERS, period: "all", target: "fanClub:club1" });
  assert.deepEqual(audit.filtersFromLink("artist:@Netto"), { ...audit.EMPTY_FILTERS, period: "all", target: "artist:netto" });
  for (const bad of [null, "", "sem-tipo", "planeta:x", "fanClub:", "fanClub:a/b"]) {
    assert.deepEqual(audit.filtersFromLink(bad), audit.EMPTY_FILTERS, String(bad));
  }
});

test("rótulos com as variantes e a ação desconhecida crua", () => {
  assert.equal(audit.actionLabel({ action: "mission.published", details: { restored: true } }), "Missão trazida de volta");
  assert.equal(audit.actionLabel({ action: "mission.published", details: {} }), "Missão publicada");
  assert.equal(audit.actionLabel({ action: "reward.published", details: { reopened: true } }), "Recompensa reaberta");
  assert.equal(audit.actionLabel({ action: "fan.email.lookup", details: { found: false } }), "Busca por e-mail sem resultado");
  assert.equal(audit.actionLabel({ action: "algo.novo", details: {} }), "algo.novo");
  assert.equal(audit.actorLabel({ actorUid: null, actorName: "Virada automática" }), "Virada automática");
  assert.equal(audit.actorLabel({ actorUid: null, actorName: "" }), "Automático");
});

test("a entrada lida, com a seção e os alvos", () => {
  const entry = audit.parseAuditEntry("a1", {
    action: "redemption.refused",
    actorUid: "u1",
    actorName: "Editora de Teste",
    targetEmail: "",
    targetUid: null,
    section: "rewards",
    targets: ["redemption:UP-9FJT6V", "reward:videochamada", 3],
    details: { code: "UP-9FJT6V" },
  });
  assert.equal(entry.section, "rewards");
  assert.deepEqual(entry.targets, ["redemption:UP-9FJT6V", "reward:videochamada"]);
  assert.equal(audit.parseAuditEntry("a2", { section: "estranha" }).section, null);
  assert.deepEqual(audit.primaryTarget(entry), { target: { type: "redemption", id: "UP-9FJT6V" }, email: null, more: 1 });
  assert.deepEqual(audit.primaryTarget({ targets: ["staff:u9"], targetEmail: "x@y.com", targetUid: "u9" }), {
    target: { type: "staff", id: "u9" },
    email: "x@y.com",
    more: 0,
  });
  assert.deepEqual(audit.parseTarget("fan:abc"), { type: "fan", id: "abc" });
  assert.deepEqual(audit.parseTarget("novo:1"), { type: null, id: "1" });
});

test("os ids do alvo como a consulta pede", () => {
  assert.equal(audit.normalizeRedemptionCode("up4kd9tm"), "UP-4KD9TM");
  assert.equal(audit.normalizeRedemptionCode("UP-4KD9TM"), "UP-4KD9TM");
  assert.equal(audit.normalizeRedemptionCode(" 4kd9tm "), "UP-4KD9TM");
  assert.equal(audit.normalizeTargetId("artist", "@Nenho"), "nenho");
  assert.equal(audit.normalizeTargetId("mission", " m-curtir "), "m-curtir");
});

test("o plano da consulta segue os cinco índices", () => {
  const base = audit.EMPTY_FILTERS;
  assert.deepEqual(audit.auditPlan(base), { kind: "all" });
  assert.deepEqual(audit.auditPlan({ ...base, person: "u1" }), { kind: "person", actorUid: "u1" });
  assert.deepEqual(audit.auditPlan({ ...base, person: audit.AUTOMATIC_ACTOR }), { kind: "person", actorUid: null });
  assert.deepEqual(audit.auditPlan({ ...base, section: "rewards" }), { kind: "section", section: "rewards" });
  assert.deepEqual(audit.auditPlan({ ...base, section: audit.OTHER_SECTION }), { kind: "section", section: null });
  assert.deepEqual(audit.auditPlan({ ...base, person: "u1", section: "team" }), { kind: "person-section", actorUid: "u1", section: "team" });
  // A ação vai sozinha: a seção ela já diz.
  assert.deepEqual(audit.auditPlan({ ...base, section: "rewards", action: "reward.stock.updated" }), { kind: "action", action: "reward.stock.updated" });
  // O alvo vale sozinho, com o período.
  assert.deepEqual(audit.auditPlan({ ...base, section: "rewards", person: "u1", target: "fan:x" }), { kind: "target", target: "fan:x" });
});

test("o filtro que não combina fica desligado, com o motivo", () => {
  const base = audit.EMPTY_FILTERS;
  assert.equal(audit.filterBlocked("action", base), "Escolha uma seção para ver as ações dela.");
  assert.equal(audit.filterBlocked("action", { ...base, section: "rewards" }), null);
  assert.equal(audit.filterBlocked("person", { ...base, section: "rewards", action: "reward.closed" }), "A busca por ação não combina com a pessoa.");
  assert.equal(audit.filterBlocked("section", { ...base, target: "fan:x" }), "Com o alvo, só o período vale.");
  assert.equal(audit.filterBlocked("target", { ...base, target: "fan:x" }), null);
  // Trocar a seção tira a ação; escolher a ação tira a pessoa.
  const withAction = audit.changeFilters({ ...base, person: "u1", section: "rewards" }, { action: "reward.closed" });
  assert.equal(withAction.person, "");
  assert.equal(audit.changeFilters(withAction, { section: "fans" }).action, "");
  assert.equal(audit.periodStartDay("30", "2026-10-08", (day, delta) => `${day}${delta}`), "2026-10-08-29");
  assert.equal(audit.periodStartDay("all", "2026-10-08", () => "x"), null);
});

test("o details por extenso", () => {
  assert.deepEqual(audit.detailLines({ action: "artist.updated", details: { artistId: "nenho", name: "Nenho", changed: ["bio", "genre"] } }), [
    "Nome: Nenho",
    "Campos mudados: bio e gênero",
  ]);
  assert.deepEqual(
    audit.detailLines({
      action: "member.updated",
      details: { from: { role: "viewer", sections: ["overview", "growth"] }, to: { role: "editor", sections: ["fans"] } },
    }),
    ["Acesso: de Leitor, Visão geral e Crescimento para Editor, Fãs"],
  );
  assert.deepEqual(audit.detailLines({ action: "reward.stock.updated", details: { rewardId: "meet", before: 15, after: 20, redeemed: 0 } }), [
    "De 15 para 20",
    "Já resgatados: 0",
  ]);
  assert.deepEqual(
    audit.detailLines({
      action: "redemption.refused",
      details: { code: "UP-9FJT6V", rewardId: "v", from: "requested", to: "refused", refundedPoints: 8500, restocked: true, hasReason: true },
    }),
    ["Situação: de solicitado para recusado", "Pontos devolvidos: 8.500", "A vaga voltou ao estoque", "Com motivo para o fã"],
  );
  assert.deepEqual(
    audit.detailLines({
      action: "wallet.adjusted",
      details: { entryId: "e", balance: 100, xp: -20, central: { artistId: "nenho", total: 50 }, seasonId: "sj", note: "Pontos do show" },
    }),
    ["Saldo: +100", "XP: -20", "Na central @nenho: de sempre +50", "Nota: Pontos do show"],
  );
  assert.deepEqual(audit.detailLines({ action: "fan.username.reset", details: { uid: "x", previous: "ruim", username: "fa_123" } }), [
    "@ antigo: @ruim. @ novo: @fa_123",
  ]);
  assert.deepEqual(audit.detailLines({ action: "fan.username.reset", details: { uid: "x", previous: "ruim", username: "fa_123", reason: "moderation" } }), [
    "Motivo: ofensivo ou impróprio",
    "@ antigo: @ruim. @ novo: @fa_123",
  ]);
  assert.deepEqual(audit.detailLines({ action: "fan.username.reset", details: { uid: "x", previous: "nenho", username: "fa_9", reason: "central" } }), [
    "Motivo: @ de artista",
    "@ antigo: @nenho. @ novo: @fa_9",
  ]);
  // Os pedidos de dados só guardam o uid, que não vira linha (e nunca o e-mail).
  assert.deepEqual(audit.detailLines({ action: "fan.data.exported", details: { uid: "x" } }), []);
  assert.deepEqual(audit.detailLines({ action: "fan.account.deleted", details: { uid: "x" } }), []);
  assert.deepEqual(audit.detailLines({ action: "artist.reordered", details: { artistIds: ["a", "b", "c"] } }), ["centrais: 3 itens"]);
  assert.deepEqual(audit.detailLines({ action: "fan.suspended", details: { uid: "x", reason: "spam", note: "Script" } }), ["Motivo: Spam", "Nota: Script"]);
  assert.deepEqual(audit.detailLines({ action: "x", details: {} }), []);
  assert.equal(audit.AUDIT_ACTIONS["fan.profile.cleared"].label, "Bio e redes do fã apagadas");
  assert.equal(audit.AUDIT_ACTIONS["fan.profile.cleared"].section, "moderation");
  assert.deepEqual(audit.detailLines({ action: "fan.profile.cleared", details: { uid: "x", fields: ["bio", "socials"] } }), ["Campos apagados: bio e redes sociais"]);
  assert.deepEqual(audit.detailLines({ action: "fan.profile.cleared", details: { uid: "x", fields: ["socials"] } }), ["Campos apagados: redes sociais"]);
  assert.equal(audit.AUDIT_ACTIONS["fan.profile.report.resolved"].label, "Denúncia de perfil resolvida");
  assert.equal(audit.AUDIT_ACTIONS["fan.profile.report.resolved"].section, "moderation");
  assert.deepEqual(audit.detailLines({ action: "fan.profile.report.resolved", details: { uid: "x", resolution: "actioned", reportCount: 3, round: 2 } }), [
    "Resolução: Resolvido com ação",
    "Denúncias na rodada: 3",
    "Rodada: 2",
  ]);
  assert.deepEqual(audit.detailLines({ action: "fan.profile.report.resolved", details: { uid: "x", resolution: "kept", reportCount: 1, round: 1 } }), [
    "Resolução: Mantido",
    "Denúncias na rodada: 1",
    "Rodada: 1",
  ]);
});
