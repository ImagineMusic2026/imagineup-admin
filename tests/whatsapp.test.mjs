import assert from "node:assert/strict";
import test, { mock } from "node:test";

import "./alias.mjs";

// O WhatsApp do fã no "Ver contatos" da aba Pedidos (seção 35 da nota do app):
// a conferência do número, o texto e o link da conversa, e a leitura dos
// contatos pela callable, com o dublê no lugar do Firebase.

const calls = [];
let answer = { contacts: [] };
mock.module("@/lib/callable", {
  namedExports: {
    LONG_CALL_TIMEOUT_MS: 130_000,
    call: async (name, data) => {
      calls.push([name, data]);
      return answer;
    },
  },
});

const { formatWhatsapp, isWhatsapp, whatsappLink, whatsappMessage } = await import("@/lib/whatsapp");
const { getRedemptionContacts, isDeletedContact, parseRedemptionContact } = await import("@/lib/reward-api");

test("só o celular brasileiro no formato guardado passa", () => {
  assert.equal(isWhatsapp("+5575991234567"), true);
  assert.equal(isWhatsapp("+5511987654321"), true);
  assert.equal(isWhatsapp("+5555991234567"), true);
  for (const value of [
    "75991234567",
    // O fixo (8 dígitos depois do DDD) e o celular de 11 dígitos sem o 9 na frente.
    "+557532214567",
    "+5575891234567",
    "+5575191234567",
    // DDDs que não existem.
    "+5520991234567",
    "+5523991234567",
    "+5529991234567",
    "+5590991234567",
    "+5501991234567",
    "+14155550100",
    "+5575991234567 ",
    "+5575991234567\n",
    "",
    null,
    undefined,
    5575991234567,
  ]) {
    assert.equal(isWhatsapp(value), false, JSON.stringify(value));
  }
});

test("o número como a equipe lê", () => {
  assert.equal(formatWhatsapp("+5575991234567"), "+55 (75) 99123-4567");
  assert.equal(formatWhatsapp("(75) 99123-4567"), null);
  assert.equal(formatWhatsapp(null), null);
});

test("o link abre a conversa no wa.me, com os dígitos e a mensagem do pedido codificada", () => {
  const href = whatsappLink("+5575991234567", "UP-4KD9TM");
  // O endereço cru, com a mensagem codificada: o navegador não decide nada sozinho.
  assert.equal(
    href,
    "https://wa.me/5575991234567?text=Ol%C3%A1!%20Aqui%20%C3%A9%20a%20equipe%20do%20ImagineUP%2C%20sobre%20o%20seu%20resgate%20UP-4KD9TM.",
  );
  const url = new URL(href);
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/5575991234567");
  assert.equal(url.searchParams.get("text"), whatsappMessage("UP-4KD9TM"));
  assert.equal(whatsappMessage("UP-4KD9TM"), "Olá! Aqui é a equipe do ImagineUP, sobre o seu resgate UP-4KD9TM.");
  // Fora do formato, nada de link: o número estranho não vira endereço.
  assert.equal(whatsappLink("+55 75 99123-4567", "UP-4KD9TM"), null);
  assert.equal(whatsappLink("javascript:alert(1)", "UP-4KD9TM"), null);
  assert.equal(whatsappLink(null, "UP-4KD9TM"), null);
});

test("os contatos chegam com o WhatsApp conferido; o servidor de antes (sem o campo) vale null", async () => {
  calls.length = 0;
  answer = {
    contacts: [
      { redemptionId: "UP-4KD9TM", name: "Camila Ribeiro", username: "camilarib", email: "camila@teste.imagineup", whatsapp: "+5575991234567" },
      { redemptionId: "UP-RK2TQX", name: "Alan", username: "alanzin", email: "alan@teste.imagineup" },
      { redemptionId: "UP-RK3MZB", name: "Bia", username: null, email: "bia@teste.imagineup", whatsapp: "75 99123-4567" },
      { redemptionId: "UP-RSTVWX", name: null, username: null, email: null, whatsapp: null },
    ],
  };
  const { contacts } = await getRedemptionContacts(["UP-4KD9TM", "UP-RK2TQX", "UP-RK3MZB", "UP-RSTVWX"]);
  assert.deepEqual(calls, [["getRedemptionContacts", { redemptionIds: ["UP-4KD9TM", "UP-RK2TQX", "UP-RK3MZB", "UP-RSTVWX"] }]]);
  assert.deepEqual(
    contacts.map((contact) => [contact.redemptionId, contact.whatsapp]),
    [
      ["UP-4KD9TM", "+5575991234567"],
      ["UP-RK2TQX", null],
      ["UP-RK3MZB", null],
      ["UP-RSTVWX", null],
    ],
  );
  assert.deepEqual(contacts[0], {
    redemptionId: "UP-4KD9TM",
    name: "Camila Ribeiro",
    username: "camilarib",
    email: "camila@teste.imagineup",
    whatsapp: "+5575991234567",
    instagram: null,
  });
});

test("no pedido de prêmio, o Instagram do gestor chega conferido de novo, e a mensagem pronta fala do prêmio", async () => {
  answer = {
    contacts: [
      { redemptionId: "UP-4KD9TM", name: "Camila", username: "camilarib", email: "camila@teste.imagineup", whatsapp: "+5575991234567", instagram: "camila.fa" },
      { redemptionId: "UP-RK2TQX", name: "Alan", username: "alanzin", email: "alan@teste.imagineup", whatsapp: null, instagram: "não é um @" },
      { redemptionId: "UP-RK3MZB", name: null, username: null, email: null, whatsapp: null, instagram: null },
    ],
  };
  const { contacts } = await getRedemptionContacts(["UP-4KD9TM", "UP-RK2TQX", "UP-RK3MZB"]);
  assert.deepEqual(
    contacts.map((contact) => [contact.redemptionId, contact.instagram]),
    [
      ["UP-4KD9TM", "camila.fa"],
      ["UP-RK2TQX", null],
      ["UP-RK3MZB", null],
    ],
  );
  assert.equal(isDeletedContact(contacts[2]), true);
  assert.equal(whatsappLink("+5575991234567", "UP-4KD9TM", true), `https://wa.me/5575991234567?text=${encodeURIComponent("Olá! Aqui é a equipe do ImagineUP, sobre o prêmio do seu fã-clube, pedido UP-4KD9TM.")}`);
  assert.equal(whatsappLink("+5575991234567", "UP-4KD9TM"), `https://wa.me/5575991234567?text=${encodeURIComponent("Olá! Aqui é a equipe do ImagineUP, sobre o seu resgate UP-4KD9TM.")}`);
});

test("a resposta estranha não quebra o diálogo: sem lista, vazia; sem código ou com o código fora do formato, fora", async () => {
  answer = {};
  assert.deepEqual(await getRedemptionContacts(["UP-4KD9TM"]), { contacts: [] });
  answer = { contacts: [null, { name: "Sem código" }] };
  assert.deepEqual(await getRedemptionContacts(["UP-4KD9TM"]), { contacts: [] });
  // O código entra no texto do link: o surrogate solto derrubaria o encodeURIComponent no render.
  const lone = `UP-${String.fromCharCode(0xd800)}`;
  answer = {
    contacts: [
      { redemptionId: lone, email: "a@teste.imagineup", whatsapp: "+5575991234567" },
      { redemptionId: "up-4kd9tm", email: "a@teste.imagineup", whatsapp: "+5575991234567" },
    ],
  };
  assert.deepEqual(await getRedemptionContacts(["UP-4KD9TM"]), { contacts: [] });
  assert.deepEqual(parseRedemptionContact({ redemptionId: "UP-4KD9TM", name: "", email: 7 }), {
    redemptionId: "UP-4KD9TM",
    name: null,
    username: null,
    email: null,
    whatsapp: null,
    instagram: null,
  });
});

test("só a conta com tudo vazio é a excluída; a que não tem e-mail mas tem o WhatsApp, não", () => {
  const base = { redemptionId: "UP-4KD9TM", name: null, username: null, email: null, whatsapp: null, instagram: null };
  assert.equal(isDeletedContact(base), true);
  assert.equal(isDeletedContact({ ...base, instagram: "camila.fa" }), false);
  assert.equal(isDeletedContact({ ...base, whatsapp: "+5575991234567" }), false);
  assert.equal(isDeletedContact({ ...base, name: "Camila" }), false);
  assert.equal(isDeletedContact({ ...base, email: "camila@teste.imagineup" }), false);
});
