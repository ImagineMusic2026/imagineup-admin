import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// O fã-clube gerido pelo fã (seção 34 da nota do app), o Painel A: a leitura
// das candidaturas e dos fã-clubes, os rótulos, as decisões que cabem e o
// pedido da `decideFanClub`, com o dublê no lugar do Firebase.

const calls = [];
mock.module("@/lib/callable", {
  namedExports: {
    LONG_CALL_TIMEOUT_MS: 130_000,
    call: async (name, data) => {
      calls.push([name, data]);
      return { ok: true, subject: data.subject, id: data.id, status: "ok" };
    },
  },
});

const model = await import("@/lib/fan-clubs");
const api = await import("@/lib/fan-club-api");
const { whatsappChatLink, fanClubWhatsappMessage, whatsappLink } = await import("@/lib/whatsapp");

const DASHES = /[–—]/;
const sp = (local) => new Date(`${local}-03:00`);
/**
 * Um `Timestamp` do SDK do navegador: o `toMillis` leva a fração de ms dos
 * nanossegundos (o Firestore guarda em µs), e o `toDate` a trunca, como o
 * `toMillis` do Admin SDK que a `decideFanClub` compara.
 */
const ts = (date, extraNanos = 0) => {
  const seconds = Math.floor(date.getTime() / 1e3);
  const nanoseconds = (date.getTime() - seconds * 1e3) * 1e6 + extraNanos;
  const toMillis = () => seconds * 1e3 + nanoseconds / 1e6;
  return { seconds, nanoseconds, toMillis, toDate: () => new Date(toMillis()) };
};

test("a candidatura lida: os padrões do servidor, as cópias do perfil e o submittedAt em ms inteiros", () => {
  const submitted = sp("2026-10-19T10:00:00.250");
  const application = model.parseApplication("uidCamila", {
    artistId: "netto",
    artistName: "Netto Brito",
    status: "pending",
    round: 2,
    proposedName: "Netto de Coração",
    rulesVersion: "termos-2026-10",
    rulesAcceptedAt: ts(submitted),
    adultDeclared: true,
    submittedAt: ts(submitted, 999_000),
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    canReapplyAt: null,
    clubId: null,
    closedByStaff: false,
    history: [
      { round: 1, decision: "rejected", reason: "incomplete", at: ts(sp("2026-09-01T10:00:00")) },
      { round: 1, decision: "estranha" },
      "lixo",
    ],
    fanName: "Camila",
    fanUsername: "camila",
    fanPhotoURL: "",
  });
  assert.equal(application.status, "pending");
  assert.equal(application.round, 2);
  // O dublê leva os 0,999 ms a mais, e o painel manda os ms inteiros, como o servidor compara.
  assert.equal(Number.isInteger(ts(submitted, 999_000).toMillis()), false);
  assert.equal(application.submittedAtMs, submitted.getTime());
  assert.equal(Number.isSafeInteger(application.submittedAtMs), true);
  assert.equal(application.adultDeclared, true);
  assert.equal(application.fanPhotoURL, null);
  assert.deepEqual(
    application.history.map((item) => [item.round, item.decision, item.reason]),
    [[1, "rejected", "incomplete"]],
  );

  // Campo estranho vira o valor de nada a decidir, como o `applicationRecord` do servidor.
  const odd = model.parseApplication("u2", { status: "quem sabe", round: -1, rejectReason: "outro", adultDeclared: "true", decidedBy: { name: "Sem uid" } });
  assert.equal(odd.status, "withdrawn");
  assert.equal(odd.round, 0);
  assert.equal(odd.rejectReason, null);
  assert.equal(odd.adultDeclared, false);
  assert.equal(odd.decidedBy, null);
  assert.equal(odd.submittedAtMs, null);
});

test("o privado mostra só as redes no padrão, com o link de domínio fixo; o WhatsApp é conferido de novo", () => {
  const privateDoc = model.parseApplicationPrivate({ instagram: "camila.fa", tiktok: "x/../y", pitch: "No Instagram e no grupo do fã-clube." });
  assert.deepEqual(privateDoc.socials, [{ network: "instagram", handle: "camila.fa", href: "https://www.instagram.com/camila.fa/" }]);
  assert.equal(privateDoc.pitch, "No Instagram e no grupo do fã-clube.");
  assert.equal(model.parseApplicationPrivate({ instagram: null, tiktok: null, pitch: null }).pitch, null);

  // O número de teste do seed dos emuladores passa, como no servidor.
  assert.equal(model.parseContactWhatsapp({ whatsapp: "+5575900000010" }), "+5575900000010");
  assert.equal(model.parseContactWhatsapp({ whatsapp: "+5575991234567" }), "+5575991234567");
  assert.equal(model.parseContactWhatsapp({ whatsapp: "75991234567" }), null);
  assert.equal(model.parseContactWhatsapp(undefined), null);

  const link = whatsappChatLink("+5575991234567", fanClubWhatsappMessage("Netto Brito"));
  assert.equal(link, `https://wa.me/5575991234567?text=${encodeURIComponent("Olá! Aqui é a equipe do ImagineUP, sobre a sua candidatura a fã-clube de Netto Brito.")}`);
  assert.equal(whatsappChatLink("+55 75 99123", "x"), null);
  // O link do pedido da loja continua o mesmo.
  assert.equal(whatsappLink("+5575991234567", "UP-4KD9TM"), `https://wa.me/5575991234567?text=${encodeURIComponent("Olá! Aqui é a equipe do ImagineUP, sobre o seu resgate UP-4KD9TM.")}`);
});

test("os textos da candidatura: o nome, a rodada, a espera, o histórico e a próxima candidatura", () => {
  const now = sp("2026-10-19T12:00:00");
  assert.equal(model.applicantLabel({ fanName: "Camila", fanUsername: "camila" }), "Camila");
  assert.equal(model.applicantLabel({ fanName: null, fanUsername: "camila" }), "@camila");
  assert.equal(model.applicantLabel({ fanName: null, fanUsername: null }), "Fã sem nome");
  assert.equal(model.roundText(1), "1 de 3");
  assert.equal(model.roundText(0), null);
  assert.equal(model.waitingText({ submittedAt: sp("2026-10-16T12:00:00") }, now), "espera há 3 dias");
  assert.equal(model.waitingText({ submittedAt: null }, now), null);
  assert.equal(model.waitingText({ submittedAt: sp("2026-10-19T11:59:40") }, now), "chegou agora");
  assert.equal(model.waitingText({ submittedAt: sp("2026-08-02T12:00:00") }, now), "espera desde 2 ago");
  assert.match(model.privateGoneText({ status: "rejected" }), /recusa/);
  assert.match(model.privateGoneText({ status: "approved" }), /encerramento/);
  assert.equal(model.pendingCountText(1), "1 candidatura em análise");
  assert.equal(model.pendingCountText(3), "3 candidaturas em análise");
  assert.equal(model.historyItemText({ round: 2, decision: "rejected", reason: "rules", at: null }), "Rodada 2: recusada (Contra as regras)");
  assert.equal(model.historyItemText({ round: 3, decision: "approved", reason: null, at: null }), "Rodada 3: aprovada");

  const base = { status: "rejected", closedByStaff: false, canReapplyAt: null, round: 1 };
  assert.equal(model.reapplyText({ ...base, canReapplyAt: sp("2026-11-18T12:00:00") }, now), "O fã pode se candidatar de novo a partir de 18 nov.");
  assert.equal(model.reapplyText({ ...base, round: 3 }, now), "As 3 rodadas foram usadas: o fã não se candidata de novo.");
  assert.equal(model.reapplyText({ ...base, status: "approved", closedByStaff: true }, now), "O fã-clube foi encerrado pela equipe: o fã não se candidata de novo.");
  assert.equal(model.reapplyText({ ...base, status: "pending" }, now), null);
  assert.equal(model.reapplyText({ ...base, canReapplyAt: sp("2026-10-18T12:00:00") }, now), null, "o prazo que já passou não diz nada");
});

test("o nome da aprovação: de 3 a 40 numa linha visível; o resto é com o servidor, com o motivo embaixo do campo", () => {
  assert.deepEqual(model.checkApprovalName("  Netto de Coração  "), { ok: true, name: "Netto de Coração" });
  assert.equal(model.checkApprovalName("ab").ok, false);
  assert.equal(model.checkApprovalName("a".repeat(41)).ok, false);
  assert.deepEqual(model.checkApprovalName("a".repeat(40)), { ok: true, name: "a".repeat(40) });
  assert.equal(model.checkApprovalName("").ok, false);
  assert.equal(model.checkApprovalName("Netto\nBrito").ok, false);

  const refusal = (details) => ({ code: "functions/invalid-argument", message: "Pedido inválido.", details: { reason: "invalid-request", ...details } });
  assert.equal(model.approveNameProblem(refusal({ field: "name", problem: "official" })), "O nome não pode ter a palavra oficial. Ajuste o nome.");
  assert.equal(model.approveNameProblem(refusal({ field: "name", problem: "not_allowed" })), "O nome tem um termo que o app não aceita. Ajuste o nome.");
  assert.match(model.approveNameProblem(refusal({ field: "name", problem: null })), /de 3 a 40 caracteres/);
  assert.equal(model.approveNameProblem(refusal({ field: "expected" })), null);
  assert.equal(model.approveNameProblem({ code: "functions/failed-precondition", details: { reason: "stale-decision" } }), null);
  assert.equal(model.isStaleDecision({ code: "functions/failed-precondition", details: { reason: "stale-decision" } }), true);
  assert.equal(model.isStaleDecision({ code: "functions/internal" }), false);
  // O botão de confirmar sai com o `stale-decision` e com o `admin-only` (quem deixou de ser admin com o Encerrar ou o selo aberto).
  assert.equal(model.blocksDecisionRetry({ code: "functions/failed-precondition", details: { reason: "stale-decision" } }), true);
  assert.equal(model.blocksDecisionRetry({ code: "functions/permission-denied", message: "Só um admin do painel pode fazer isso.", details: { reason: "admin-only" } }), true);
  assert.equal(model.blocksDecisionRetry({ code: "functions/permission-denied", details: { reason: "self" } }), false);
  assert.equal(model.blocksDecisionRetry({ code: "functions/internal" }), false);
});

test("o fã-clube lido: o status estranho vale encerrado, e a lápide fica sem nome nem gestor", () => {
  const club = model.parseFanClub("club1", {
    artistId: "netto",
    artistName: "Netto Brito",
    ownerUid: "uidCamila",
    ownerName: "Camila",
    ownerUsername: "camila",
    ownerPhotoURL: null,
    name: "Netto de Coração",
    status: "paused",
    statusReason: "suspended",
    accountDeleted: false,
    applicationRound: 1,
    approvedAt: ts(sp("2026-10-19T10:00:00")),
    approvedBy: { uid: "staff1", name: "Iara" },
    pausedAt: ts(sp("2026-10-19T11:00:00")),
  });
  assert.equal(club.status, "paused");
  assert.equal(model.fanClubStatusText(club), "Pausado porque o gestor foi suspenso");
  assert.equal(model.fanClubLabel(club), "Netto de Coração");
  assert.equal(model.ownerLabel(club), "Camila");
  assert.deepEqual(club.approvedBy, { uid: "staff1", name: "Iara" });

  const odd = model.parseFanClub("club2", { status: "talvez", statusReason: "outro" });
  assert.equal(odd.status, "closed");
  assert.equal(odd.statusReason, null);
  assert.equal(model.fanClubStatusText(odd), "Encerrado");

  const tomb = model.parseFanClub("club3", { status: "closed", statusReason: "account_deleted", accountDeleted: true, ownerUid: null, name: null });
  assert.equal(model.fanClubLabel(tomb), "Fã-clube de conta excluída");
  assert.equal(model.ownerLabel(tomb), "Conta excluída");
  assert.equal(model.fanClubStatusText(tomb), "Encerrado porque o gestor excluiu a conta");
  assert.equal(model.fanClubStatusText({ status: "active", statusReason: null }), "Ativo");
  assert.equal(model.fanClubCountText(1, "active"), "1 fã-clube ativo");
  assert.equal(model.fanClubCountText(2, "closed"), "2 fã-clubes encerrados");
});

test("o selo de oficial lido: o documento de antes vale sem selo, e o oficial traz quando e quem deu", () => {
  const now = sp("2026-10-26T15:00:00");
  const before = model.parseFanClub("club1", { name: "Turma do Nenho", status: "active" });
  assert.equal(before.official, false);
  assert.equal(before.officialAt, null);
  assert.equal(before.officialBy, null);
  assert.equal(model.officialText(before, now), null);

  const official = model.parseFanClub("club2", {
    name: "Netto de Coração",
    status: "active",
    official: true,
    officialAt: ts(sp("2026-10-26T10:00:00")),
    officialBy: { uid: "staff1", name: "Iara" },
  });
  assert.equal(official.official, true);
  assert.deepEqual(official.officialAt, sp("2026-10-26T10:00:00"));
  assert.deepEqual(official.officialBy, { uid: "staff1", name: "Iara" });
  assert.equal(model.officialText(official, now), "Oficial desde 26 out, por Iara");
  assert.equal(model.officialText({ official: true, officialAt: null, officialBy: null }, now), "Oficial");

  // Só o `true` vale selo; o tirado grava `false` e os dois nulos (o `OFFICIAL_OFF` do servidor).
  assert.equal(model.parseFanClub("club3", { official: "sim" }).official, false);
  const off = model.parseFanClub("club4", { official: false, officialAt: null, officialBy: null });
  assert.equal(off.official, false);
  assert.equal(off.officialBy, null);
  assert.equal(model.parseFanClub("club5", { official: true, officialBy: { name: "Sem uid" } }).officialBy, null);
});

test("o selo fica preso ao último caractere do nome, com o emoji inteiro, e o resto do nome quebra", () => {
  const split = (name) => {
    const cut = model.lastCharStart(name);
    return [name.slice(0, cut), name.slice(cut)];
  };
  assert.deepEqual(split("Nettomaníacos-da-Bahia-e-Sergipe"), ["Nettomaníacos-da-Bahia-e-Sergip", "e"]);
  assert.deepEqual(split("Netto de Coração"), ["Netto de Coraçã", "o"]);
  // A letra com o acento combinante, a cantora (ZWJ), a bandeira e o coração com o VS16 vão inteiros.
  assert.deepEqual(split("Fãs do José"), ["Fãs do Jos", "é"]);
  assert.deepEqual(split("Netto 👩‍🎤"), ["Netto ", "👩‍🎤"]);
  assert.deepEqual(split("🇧🇷"), ["", "🇧🇷"]);
  assert.deepEqual(split("Netto ❤️"), ["Netto ", "❤️"]);
  assert.deepEqual(split(""), ["", ""]);
});

test("as decisões que cabem: o editor pausa e reativa, só o admin encerra e mexe no selo, e ninguém decide o próprio fã-clube", () => {
  const editor = { uid: "e1", canEdit: true, admin: false };
  const admin = { uid: "a1", canEdit: true, admin: true };
  const viewer = { uid: "v1", canEdit: false, admin: false };
  const rows = [
    // [status, oficial, quem, decisões]
    ["active", false, editor, ["pause"]],
    ["active", true, editor, ["pause"]],
    ["paused", false, editor, ["resume"]],
    ["paused", true, editor, ["resume"]],
    ["closed", false, editor, []],
    ["active", false, admin, ["pause", "close", "officialize"]],
    ["active", true, admin, ["pause", "close", "unofficialize"]],
    ["paused", false, admin, ["resume", "close"]],
    ["paused", true, admin, ["resume", "close", "unofficialize"]],
    ["closed", false, admin, []],
    ["closed", true, admin, ["unofficialize"]],
    ["active", false, viewer, []],
    ["active", true, viewer, []],
    ["paused", true, viewer, []],
  ];
  for (const [status, official, who, expected] of rows) {
    assert.deepEqual(model.clubDecisions({ status, ownerUid: "f1", official }, who), expected, `${status}, ${official ? "oficial" : "sem selo"}, ${who.uid}`);
  }
  // O gestor da equipe: `self`, também no selo.
  assert.deepEqual(model.clubDecisions({ status: "active", ownerUid: "a1", official: false }, admin), []);
  assert.deepEqual(model.clubDecisions({ status: "active", ownerUid: "a1", official: true }, admin), []);
  // A lápide pausada (sem gestor) não reativa: o servidor não acha o perfil.
  assert.deepEqual(model.clubDecisions({ status: "paused", ownerUid: null, official: false }, admin), ["close"]);
});

test("as confirmações do selo: oficializar pede combinar com o artista, e tirar fala do status", () => {
  assert.match(model.OFFICIALIZE_TEXT, /^O fã-clube ganha o selo de oficial ao lado do nome/);
  assert.match(model.OFFICIALIZE_TEXT, /Combine com o artista antes/);
  assert.equal(model.unofficializeText("active"), "O selo sai do app na hora. O fã-clube continua no ar.");
  assert.equal(model.unofficializeText("paused"), "O fã-clube fica sem o selo e, quando for reativado, volta ao app sem ele.");
  assert.equal(model.unofficializeText("closed"), "O fã-clube fica sem o selo.");
});

test("os textos não têm travessão nem meia-risca", () => {
  const texts = [
    model.FAN_CLUB_AUDIT_TEXT,
    model.PAUSE_TEXT,
    model.RESUME_TEXT,
    model.OFFICIALIZE_TEXT,
    ...model.FAN_CLUB_STATUSES.map(model.unofficializeText),
    ...Object.values(model.REJECT_REASON_LABELS),
    ...Object.values(model.CLOSE_REASON_LABELS),
    ...Object.values(model.CLOSE_REASON_HINTS),
    ...Object.values(model.STATUS_REASON_LABELS),
    ...Object.values(model.APPLICATION_STATUS_LABELS),
    ...Object.values(model.RESOLVED_FILTER_LABELS),
    ...Object.values(model.FAN_CLUB_FILTER_LABELS),
    ...model.CLOSE_REASONS.map(model.closeText),
  ];
  for (const text of texts) assert.doesNotMatch(text, DASHES, text);
  assert.equal(model.closeText("staff"), "O fã-clube sai do app de vez e não volta. O fã nunca mais se candidata a um fã-clube.");
  assert.equal(model.fanClubTarget("abc"), "fanClub:abc");
});

test("a decideFanClub recebe o assunto, a decisão e o estado que a tela mostrou", async () => {
  calls.length = 0;
  const shown = { round: 2, submittedAtMs: 1_760_878_800_250 };
  await api.approveApplication("uidCamila", shown, null);
  await api.approveApplication("uidCamila", shown, "Netto Sempre");
  await api.rejectApplication("uidCamila", shown, "rules");
  await api.setFanClubPaused("club1", "active", true);
  await api.setFanClubPaused("club1", "paused", false);
  await api.closeFanClub("club1", "paused", "owner_request");
  await api.officializeFanClub("club1", "active");
  await api.unofficializeFanClub("club1", "paused");
  assert.deepEqual(calls, [
    ["decideFanClub", { subject: "application", id: "uidCamila", decision: "approve", expected: 2, submittedAt: 1_760_878_800_250, name: null }],
    ["decideFanClub", { subject: "application", id: "uidCamila", decision: "approve", expected: 2, submittedAt: 1_760_878_800_250, name: "Netto Sempre" }],
    ["decideFanClub", { subject: "application", id: "uidCamila", decision: "reject", expected: 2, submittedAt: 1_760_878_800_250, reason: "rules" }],
    ["decideFanClub", { subject: "club", id: "club1", decision: "pause", expected: "active" }],
    ["decideFanClub", { subject: "club", id: "club1", decision: "resume", expected: "paused" }],
    ["decideFanClub", { subject: "club", id: "club1", decision: "close", expected: "paused", reason: "owner_request" }],
    // O selo (34.23): sem campo, só o status que a tela mostrou.
    ["decideFanClub", { subject: "club", id: "club1", decision: "officialize", expected: "active" }],
    ["decideFanClub", { subject: "club", id: "club1", decision: "unofficialize", expected: "paused" }],
  ]);
});
