import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const {
  cleanName,
  emailError,
  isValidEmail,
  nameError,
  newPasswordError,
  normalizeEmail,
  normalizeSections,
  sectionsError,
  validateExistingAccountForm,
  validateInviteForm,
  validateNewAccountForm,
} = await import("@/lib/validation");
const { SECTION_IDS } = await import("@/lib/staff");

test("e-mail vai minúsculo e sem espaços", () => {
  assert.equal(normalizeEmail("  Ana.Souza@Imagine.COM "), "ana.souza@imagine.com");
  for (const email of ["ana@imagine.com", "a.b+painel@sub.dominio.com.br"]) assert.equal(isValidEmail(email), true, email);
  for (const email of ["", "ana", "ana@", "@imagine.com", "ana@imagine", "ana souza@imagine.com", "ana@@imagine.com", "ana@imagine..com"]) {
    assert.equal(isValidEmail(email), false, email);
  }
  assert.equal(emailError(" "), "Digite o e-mail.");
  assert.match(emailError("ana@"), /formato/);
  assert.equal(emailError("ANA@imagine.com"), null);
});

test("nome: uma linha visível de 1 a 60 caracteres", () => {
  assert.equal(nameError("Camila Ribeiro 🎶", { required: true }), null);
  assert.equal(nameError("  Camila  ", { required: true }), null);
  assert.equal(cleanName("  Camila⁦ "), "Camila");
  assert.equal(nameError("", { required: true }), "Digite o nome.");
  assert.equal(nameError("   ", { required: false }), null);
  assert.equal(nameError("a".repeat(60), { required: true }), null);
  assert.match(nameError("a".repeat(61), { required: true }), /60/);
  for (const name of ["A\nB", "​", "Camila ㅤ Ribeiro", "a" + "̶".repeat(10), "A‍B"]) {
    assert.ok(nameError(name, { required: true }), JSON.stringify(name));
  }
});

test("senha nova com pelo menos 8 caracteres", () => {
  assert.equal(newPasswordError("12345678"), null);
  assert.match(newPasswordError("1234567"), /8 caracteres/);
  assert.equal(newPasswordError(""), "Crie uma senha.");
});

test("formulário do convite novo", () => {
  assert.deepEqual(validateNewAccountForm({ name: "Ana", password: "segredo123", confirmation: "segredo123" }), {});
  assert.deepEqual(validateNewAccountForm({ name: "", password: "curta", confirmation: "" }), {
    name: "Digite o nome.",
    password: "A senha precisa ter pelo menos 8 caracteres.",
  });
  assert.deepEqual(validateNewAccountForm({ name: "Ana", password: "segredo123", confirmation: "segredo124" }), {
    confirmation: "As senhas não são iguais.",
  });
  assert.deepEqual(validateExistingAccountForm({ name: "Ana", password: "" }), { password: "Digite a senha." });
});

test("seções: admin leva todas, os outros pelo menos uma", () => {
  assert.deepEqual(normalizeSections("admin", []), [...SECTION_IDS]);
  assert.deepEqual(normalizeSections("editor", ["audit", "fans", "fans"]), ["fans", "audit"]);
  assert.equal(sectionsError("admin", []), null);
  assert.equal(sectionsError("viewer", []), "Marque pelo menos uma seção.");
  assert.equal(sectionsError("editor", ["fans"]), null);
});

test("formulário de convite do admin", () => {
  assert.deepEqual(validateInviteForm({ name: "", email: "ana@imagine.com", role: "viewer", sections: ["fans"] }), {});
  assert.deepEqual(Object.keys(validateInviteForm({ name: "A\nB", email: "x", role: "editor", sections: [] })).sort(), [
    "email",
    "name",
    "sections",
  ]);
});
