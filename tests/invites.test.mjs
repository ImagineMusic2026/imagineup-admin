import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const { deactivateMemberText, formatDateTime, inviteExpiryLabel, isInviteExpired, parseStaffInvite, resendResultTitle, sortInvites } =
  await import("@/lib/staff");
const { INVITE_PROBLEM_COPY, inviteProblemOf, inviteSubtitle, isAccountExistsError, isWrongPasswordError, readInviteToken } = await import(
  "@/lib/invite"
);

test("token do convite vem do fragmento, sem o #", () => {
  assert.equal(readInviteToken("#abc_DEF-123"), "abc_DEF-123");
  assert.equal(readInviteToken(""), "");
  assert.equal(readInviteToken("#"), "");
});

test("motivos do servidor viram as telas do convite", () => {
  const error = (code, reason) => ({ code: `functions/${code}`, message: "x [400]", details: reason ? { reason } : undefined });
  assert.equal(inviteProblemOf(error("not-found", "invalid")), "invalid");
  assert.equal(inviteProblemOf(error("failed-precondition", "expired")), "expired");
  assert.equal(inviteProblemOf(error("failed-precondition", "accepted")), "accepted");
  assert.equal(inviteProblemOf(error("failed-precondition", "canceled")), "canceled");
  assert.equal(inviteProblemOf(error("failed-precondition", "already-staff")), "already-staff");
  assert.equal(inviteProblemOf(error("not-found")), null);
  assert.equal(inviteProblemOf(error("internal")), null);
  assert.equal(inviteProblemOf({ code: "auth/invalid-credential" }), null);
  assert.equal(isAccountExistsError(error("failed-precondition", "account-exists")), true);
  assert.equal(isWrongPasswordError({ code: "auth/invalid-credential" }), true);
  assert.equal(isWrongPasswordError({ code: "auth/too-many-requests" }), false);
  assert.match(INVITE_PROBLEM_COPY.expired.text, /Peça um novo ao admin que te convidou/);
  assert.equal(INVITE_PROBLEM_COPY.accepted.text, "Este convite já foi usado. Entre com seu e-mail e senha.");
  assert.equal(INVITE_PROBLEM_COPY.accepted.loginLink, true);
  assert.equal(INVITE_PROBLEM_COPY["already-staff"].loginLink, true);
});

const now = new Date("2026-09-29T12:00:00Z");
const later = (ms) => new Date(now.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test("validade do convite em dias, horas ou vencido", () => {
  assert.equal(inviteExpiryLabel(later(7 * DAY), now), "Vence em 7 dias");
  assert.equal(inviteExpiryLabel(later(7 * DAY - 60_000), now), "Vence em 7 dias");
  assert.equal(inviteExpiryLabel(later(3 * DAY), now), "Vence em 3 dias");
  assert.equal(inviteExpiryLabel(later(DAY + HOUR), now), "Vence em 1 dia");
  assert.equal(inviteExpiryLabel(later(5 * HOUR + 10_000), now), "Vence em 5 horas");
  assert.equal(inviteExpiryLabel(later(HOUR), now), "Vence em 1 hora");
  assert.equal(inviteExpiryLabel(later(10 * 60_000), now), "Vence em menos de 1 hora");
  assert.equal(inviteExpiryLabel(now, now), "Vencido");
  assert.equal(inviteExpiryLabel(later(-DAY), now), "Vencido");
  assert.equal(inviteExpiryLabel(null, now), "Vencido");
  assert.equal(isInviteExpired(later(1), now), false);
  assert.equal(isInviteExpired(later(-1), now), true);
});

test("data e hora no fuso de São Paulo, como no e-mail", () => {
  assert.equal(formatDateTime(new Date("2026-10-06T17:30:00Z")), "6 de outubro, 14:30");
  assert.equal(formatDateTime(new Date("2026-01-01T02:05:00Z")), "31 de dezembro, 23:05");
});

test("convite lido do Firestore e ordenado do mais novo", () => {
  const invite = parseStaffInvite("i1", {
    email: "ana@imagine.com",
    suggestedName: "",
    role: "editor",
    sections: ["missions", "overview"],
    status: "pending",
    expiresAt: { toDate: () => later(DAY) },
    invitedByName: "Rafa",
    emailStatus: "skipped",
    sendCount: 2,
  });
  assert.equal(invite.suggestedName, null);
  assert.deepEqual(invite.sections, ["overview", "missions"]);
  assert.equal(invite.emailStatus, "skipped");
  assert.equal(invite.expiresAt.getTime(), later(DAY).getTime());

  const sorted = sortInvites([
    { id: "a", createdAt: later(-DAY) },
    { id: "b", createdAt: null },
    { id: "c", createdAt: later(0) },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["c", "a", "b"]);
});

test("subtítulo do convite sem gênero quando não há quem convidou", () => {
  assert.equal(inviteSubtitle("Rafa"), "Rafa convidou você para a equipe do painel ImagineUP.");
  assert.equal(inviteSubtitle(""), "Você recebeu um convite para a equipe do painel ImagineUP.");
  assert.equal(inviteSubtitle("   "), "Você recebeu um convite para a equipe do painel ImagineUP.");
  assert.equal(inviteSubtitle(null), "Você recebeu um convite para a equipe do painel ImagineUP.");
  assert.doesNotMatch(inviteSubtitle(""), /convidad[oa]/);
});

test("título do reenvio só diz reenviado quando o e-mail saiu", () => {
  assert.equal(resendResultTitle("sent"), "Convite reenviado");
  assert.equal(resendResultTitle("failed"), "Link novo gerado");
  assert.equal(resendResultTitle("skipped"), "Link novo gerado");
});

test("desativar só promete conta de fã para quem já tinha conta no app", () => {
  const linked = deactivateMemberText("Ana", false);
  const created = deactivateMemberText("Ana", true);
  assert.match(linked, /^Ana sai do painel na hora e não entra até você reativar\./);
  assert.match(linked, /A conta de fã no app ImagineUP continua funcionando\./);
  assert.match(created, /^Ana sai do painel na hora/);
  assert.match(created, /O login não é apagado: se a pessoa também usa o app ImagineUP como fã/);
  assert.doesNotMatch(created, /A conta de fã no app ImagineUP continua funcionando/);
  const dashes = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);
  for (const text of [linked, created]) assert.doesNotMatch(text, dashes);
});
