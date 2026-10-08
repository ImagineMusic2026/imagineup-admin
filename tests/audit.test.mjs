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
  assert.equal(Object.keys(audit.AUDIT_ACTIONS).length, 63);
  assert.equal(audit.auditSectionLabel("team"), "Equipe");
  assert.equal(audit.auditSectionLabel(null), "Outros");
  assert.equal(audit.auditSectionLabel("audit"), "Logs e auditoria");
  assert.deepEqual(audit.actionsOfSection("fans"), ["wallet.adjusted", "fan.email.lookup"]);
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
  assert.deepEqual(audit.detailLines({ action: "artist.reordered", details: { artistIds: ["a", "b", "c"] } }), ["centrais: 3 itens"]);
  assert.deepEqual(audit.detailLines({ action: "fan.suspended", details: { uid: "x", reason: "spam", note: "Script" } }), ["Motivo: Spam", "Nota: Script"]);
  assert.deepEqual(audit.detailLines({ action: "x", details: {} }), []);
});
