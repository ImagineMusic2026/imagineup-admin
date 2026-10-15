import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const {
  SECTION_IDS,
  SECTIONS,
  accessStateOf,
  accessSummary,
  allowedSections,
  canEditSection,
  canManageTeam,
  canSeeSection,
  firstAllowedRoute,
  initialsOf,
  keepSameStaffResult,
  navGroupsFor,
  pageForPathname,
  parseStaffMember,
  sameStaffMember,
  sectionsSummary,
  sortMembers,
} = await import("@/lib/staff");

const admin = { role: "admin", sections: [], status: "active" };
const editor = { role: "editor", sections: ["missions", "fans"], status: "active" };
const viewer = { role: "viewer", sections: ["audit", "growth"], status: "active" };

test("as seções seguem a ordem e as rotas do contrato", () => {
  assert.deepEqual(SECTION_IDS, ["overview", "growth", "ranking", "fans", "artists", "missions", "rewards", "moderation", "audit"]);
  assert.deepEqual(
    SECTIONS.map((section) => section.route),
    ["/", "/crescimento", "/ranking", "/fas", "/artistas", "/missoes", "/recompensas", "/moderacao", "/logs"],
  );
});

test("admin vê todas as seções, mesmo com a lista vazia no documento", () => {
  assert.deepEqual(allowedSections(admin), [...SECTION_IDS]);
  assert.equal(canSeeSection(admin, "audit"), true);
  assert.equal(canEditSection(admin, "moderation"), true);
  assert.equal(canManageTeam(admin), true);
});

test("editor e leitor veem só as seções liberadas, na ordem da lateral", () => {
  assert.deepEqual(allowedSections(editor), ["fans", "missions"]);
  assert.deepEqual(allowedSections(viewer), ["growth", "audit"]);
  assert.equal(canSeeSection(editor, "overview"), false);
  assert.equal(canManageTeam(editor), false);
});

test("só admin e editor alteram, e o editor só nas seções dele", () => {
  assert.equal(canEditSection(editor, "missions"), true);
  assert.equal(canEditSection(editor, "rewards"), false);
  assert.equal(canEditSection(viewer, "growth"), false);
});

test("sem documento ativo não há acesso nenhum", () => {
  for (const status of ["pending", "disabled"]) {
    const member = { ...admin, status };
    assert.deepEqual(allowedSections(member), []);
    assert.equal(canSeeSection(member, "overview"), false);
    assert.equal(canEditSection(member, "overview"), false);
    assert.equal(canManageTeam(member), false);
    assert.equal(firstAllowedRoute(member), null);
  }
  assert.deepEqual(allowedSections(null), []);
  assert.equal(accessStateOf(null), "none");
  assert.equal(accessStateOf({ status: "pending" }), "none");
  assert.equal(accessStateOf({ status: "disabled" }), "disabled");
  assert.equal(accessStateOf({ status: "active" }), "active");
});

test("a primeira rota liberada segue a ordem da lateral", () => {
  assert.equal(firstAllowedRoute(admin), "/");
  assert.equal(firstAllowedRoute(editor), "/fas");
  assert.equal(firstAllowedRoute(viewer), "/crescimento");
  assert.equal(firstAllowedRoute({ role: "viewer", sections: [], status: "active" }), null);
});

test("a lateral mostra só o que a pessoa vê, e Equipe só para admin", () => {
  const adminGroups = navGroupsFor(admin);
  assert.deepEqual(adminGroups.map((group) => group.label), ["Monitorar", "Comunidade", "Operação", "Sistema"]);
  assert.deepEqual(adminGroups.at(-1).items.map((item) => item.label), ["Logs e auditoria", "Equipe"]);

  const editorGroups = navGroupsFor(editor);
  assert.deepEqual(editorGroups.map((group) => group.label), ["Comunidade", "Operação"]);
  assert.ok(editorGroups.every((group) => group.items.every((item) => item.key !== "team")));

  assert.deepEqual(navGroupsFor({ ...admin, status: "disabled" }), []);
});

test("o endereço aponta para a página certa", () => {
  assert.equal(pageForPathname("/"), "overview");
  assert.equal(pageForPathname("/missoes"), "missions");
  assert.equal(pageForPathname("/missoes/"), "missions");
  assert.equal(pageForPathname("/fas/123"), "fans");
  assert.equal(pageForPathname("/equipe"), "team");
  assert.equal(pageForPathname("/entrar"), null);
  assert.equal(pageForPathname("/fasx"), null);
});

test("documento torto nunca abre mais do que devia", () => {
  const member = parseStaffMember("u1", { role: "superuser", status: "ativo", sections: ["fans", "fans", "x", 3] });
  assert.equal(member.role, "viewer");
  assert.equal(member.status, "disabled");
  assert.deepEqual(member.sections, ["fans"]);
  assert.equal(member.createdAt, null);

  const withDates = parseStaffMember("u2", {
    email: "a@b.com",
    displayName: "Ana",
    role: "admin",
    status: "active",
    sections: SECTION_IDS,
    createdAt: { toDate: () => new Date("2026-09-29T12:00:00Z") },
  });
  assert.equal(withDates.createdAt.toISOString(), "2026-09-29T12:00:00.000Z");
});

test("resumos de seções e do acesso", () => {
  assert.equal(sectionsSummary("admin", []), "Todas as seções");
  assert.equal(sectionsSummary("editor", ["fans"]), "Fãs");
  assert.equal(sectionsSummary("editor", ["missions", "fans"]), "Fãs e Missões");
  assert.equal(sectionsSummary("viewer", ["audit", "fans", "overview", "growth"]), "Visão geral, Crescimento e mais 2");
  assert.equal(sectionsSummary("viewer", [...SECTION_IDS]), "Todas as seções");
  assert.equal(sectionsSummary("viewer", []), "Nenhuma seção");
  assert.equal(accessSummary(admin), "Admin · acesso total");
  assert.equal(accessSummary(editor), "Editor · 2 seções");
  assert.equal(accessSummary({ role: "viewer", sections: ["fans"], status: "active" }), "Leitor · 1 seção");
});

test("iniciais do avatar", () => {
  assert.equal(initialsOf("Rafa Menezes"), "RM");
  assert.equal(initialsOf("  iara  "), "I");
  assert.equal(initialsOf("", "joana@imagine.com"), "J");
  assert.equal(initialsOf("Ágata de Sá"), "ÁS");
  assert.equal(initialsOf(""), "?");
});

test("lista da equipe: ativos antes, admin antes, depois por nome", () => {
  const sorted = sortMembers([
    { status: "disabled", role: "admin", displayName: "Zeca", email: "z@x.com" },
    { status: "active", role: "viewer", displayName: "Ana", email: "a@x.com" },
    { status: "active", role: "admin", displayName: "Bruno", email: "b@x.com" },
    { status: "active", role: "admin", displayName: "Álvaro", email: "c@x.com" },
  ]);
  assert.deepEqual(sorted.map((member) => member.displayName), ["Álvaro", "Bruno", "Ana", "Zeca"]);
});

test("o mesmo retrato da equipe, campo a campo", () => {
  const raw = {
    email: "a@b.com",
    displayName: "Ana",
    role: "editor",
    status: "active",
    sections: ["fans", "missions"],
    createdAt: { toDate: () => new Date("2026-09-29T12:00:00Z") },
  };
  const base = parseStaffMember("u1", raw);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", raw)), true);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, campoQueOPainelNaoLe: 1 })), true);

  assert.equal(sameStaffMember(base, parseStaffMember("u2", raw)), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, role: "viewer" })), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, status: "disabled" })), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, displayName: "Ana Paula" })), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, sections: ["fans"] })), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, sections: ["fans", "rewards"] })), false);
  // A seção acrescentada no fim: as de antes continuam iguais, só o tamanho muda.
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, sections: ["fans", "missions", "rewards"] })), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, email: "outra@b.com" })), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, accountCreatedByInvite: true })), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, inviteId: "convite-1" })), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, invitedBy: "admin-1" })), false);
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, createdAt: null })), false);
  assert.equal(
    sameStaffMember(base, parseStaffMember("u1", { ...raw, createdAt: { toDate: () => new Date("2026-09-30T12:00:00Z") } })),
    false,
  );
  assert.equal(
    sameStaffMember(base, parseStaffMember("u1", { ...raw, updatedAt: { toDate: () => new Date("2026-09-30T12:00:00Z") } })),
    false,
  );
});

test("a escuta da equipe: servidor, cache e servidor de novo mantêm o mesmo resultado", () => {
  const raw = { email: "a@b.com", displayName: "Ana", role: "editor", status: "active", sections: ["fans"] };
  const event = (data, attempt = 0) => ({ uid: "u1", attempt, kind: "member", member: parseStaffMember("u1", data) });

  const fromServer = keepSameStaffResult(null, event(raw));
  // O retrato do cache (uma queda de rede) e o do servidor de novo: os mesmos campos, objetos novos.
  const fromCache = keepSameStaffResult(fromServer, event(raw));
  const backOnline = keepSameStaffResult(fromCache, event(raw));
  assert.equal(fromCache, fromServer);
  assert.equal(backOnline, fromServer);
  assert.equal(backOnline.member, fromServer.member);

  // Uma mudança de verdade troca o resultado, e o seguinte igual a ela fica.
  const withSection = keepSameStaffResult(backOnline, event({ ...raw, sections: ["fans", "rewards"] }));
  assert.notEqual(withSection, fromServer);
  assert.deepEqual(withSection.member.sections, ["fans", "rewards"]);
  assert.equal(keepSameStaffResult(withSection, event({ ...raw, sections: ["fans", "rewards"] })), withSection);

  // Outra tentativa, outra pessoa ou um erro nunca reaproveitam o anterior.
  assert.notEqual(keepSameStaffResult(fromServer, event(raw, 1)), fromServer);
  assert.notEqual(keepSameStaffResult(fromServer, { ...event(raw), uid: "u2" }), fromServer);
  const failed = { uid: "u1", attempt: 0, kind: "error", error: new Error("x") };
  assert.equal(keepSameStaffResult(fromServer, failed), failed);
  assert.notEqual(keepSameStaffResult(failed, { ...failed }), failed);

  // Sem documento duas vezes seguidas: o mesmo resultado.
  const missing = { uid: "u1", attempt: 0, kind: "missing" };
  assert.equal(keepSameStaffResult(missing, { ...missing }), missing);
});
