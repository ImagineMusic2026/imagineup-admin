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
  parseAuthTime,
  parseStaffMember,
  sameStaffMember,
  sectionsSummary,
  sessionAllowed,
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
  assert.equal(accessStateOf(null, NOW), "none");
  assert.equal(accessStateOf({ status: "pending", authValidAfter: null }, NOW), "none");
  assert.equal(accessStateOf({ status: "disabled", authValidAfter: null }, NOW), "disabled");
  assert.equal(accessStateOf({ status: "active", authValidAfter: null }, NOW), "active");
});

// auth_time (em segundos) do login desta sessão e o do login que ligou a conta.
const NOW = 1_800_000_000;
const LINKED_AT = NOW - 60;

test("a sessão usa o acesso a partir do authValidAfter, como as regras", () => {
  // Sem o campo, qualquer sessão vale, até um token sem auth_time.
  assert.equal(sessionAllowed(null, NOW), true);
  assert.equal(sessionAllowed(null, null), true);
  // O próprio login que ligou vale (igual), e os de depois também.
  assert.equal(sessionAllowed(LINKED_AT, LINKED_AT), true);
  assert.equal(sessionAllowed(LINKED_AT, NOW), true);
  // Um login de antes do vínculo, ou um token sem auth_time (conta como 0), não.
  assert.equal(sessionAllowed(LINKED_AT, LINKED_AT - 1), false);
  assert.equal(sessionAllowed(LINKED_AT, null), false);
});

test("sessão de antes do vínculo, ou de um corte, sai do painel com motivo próprio", () => {
  const linked = { status: "active", authValidAfter: LINKED_AT };
  assert.equal(accessStateOf(linked, LINKED_AT), "active");
  assert.equal(accessStateOf(linked, NOW), "active");
  assert.equal(accessStateOf(linked, LINKED_AT - 1), "old-session");
  assert.equal(accessStateOf(linked, null), "old-session");
  // Um corte depois do login desta sessão: o mesmo login passa a ser antigo.
  assert.equal(accessStateOf({ ...linked, authValidAfter: NOW + 1 }, NOW), "old-session");
  // Desativada ou pendente vale mais que a sessão: o motivo é o do documento.
  assert.equal(accessStateOf({ status: "disabled", authValidAfter: LINKED_AT }, LINKED_AT - 1), "disabled");
  assert.equal(accessStateOf({ status: "pending", authValidAfter: LINKED_AT }, LINKED_AT - 1), "none");
});

test("authValidAfter do documento: sem o campo, qualquer sessão; torto, nenhuma", () => {
  const raw = { email: "a@b.com", displayName: "Ana", role: "editor", status: "active", sections: ["fans"] };
  assert.equal(parseStaffMember("u1", raw).authValidAfter, null);
  assert.equal(parseStaffMember("u1", { ...raw, authValidAfter: LINKED_AT }).authValidAfter, LINKED_AT);
  // As regras comparam com o número; outro tipo (até null gravado) faz a comparação falhar.
  for (const value of [null, "1800000000", { seconds: LINKED_AT }, Number.NaN]) {
    const member = parseStaffMember("u1", { ...raw, authValidAfter: value });
    assert.equal(accessStateOf(member, NOW), "old-session", String(value));
  }
});

test("auth_time do token: número no JWT, texto no tipo do SDK", () => {
  assert.equal(parseAuthTime(NOW), NOW);
  assert.equal(parseAuthTime(String(NOW)), NOW);
  assert.equal(parseAuthTime(undefined), null);
  assert.equal(parseAuthTime(""), null);
  assert.equal(parseAuthTime("ontem"), null);
  assert.equal(parseAuthTime(Number.POSITIVE_INFINITY), null);
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
    // Com as duas datas preenchidas, os retratos têm objetos Date diferentes com o mesmo instante.
    updatedAt: { toDate: () => new Date("2026-10-01T12:00:00Z") },
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
  // Um corte (authValidAfter novo) troca o retrato: o guard confere a sessão de novo.
  assert.equal(sameStaffMember(base, parseStaffMember("u1", { ...raw, authValidAfter: 1_800_000_000 })), false);
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
