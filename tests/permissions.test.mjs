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
  navGroupsFor,
  pageForPathname,
  parseStaffMember,
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
