import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const profile = await import("@/lib/fan-profile");

/**
 * Os casos do `isSocialHandle` no molde de `functions/src/fan-profile/details.test.ts`
 * do app: só o usuário já guardado passa (sem o link, a arroba e as maiúsculas),
 * e as páginas da própria rede ficam fora.
 */
const HANDLE_CASES = [
  ["instagram", "camila.teste.up", true],
  ["instagram", "@camila.teste.up", false],
  ["instagram", "Camila.Teste.Up", false],
  ["instagram", "https://www.instagram.com/camila.teste.up/", false],
  ["instagram", "explore", false],
  ["instagram", "reels", false],
  ["instagram", "explorer", true],
  ["instagram", "camila.explore", true],
  ["instagram", ".camila", false],
  ["instagram", "camila.", false],
  ["instagram", "camila..teste", false],
  ["instagram", "camila teste", false],
  ["instagram", "a".repeat(30), true],
  ["instagram", "a".repeat(31), false],
  ["instagram", "", false],
  ["tiktok", "camila.teste.up", true],
  ["tiktok", "@camila.teste.up", false],
  ["tiktok", "c", false],
  ["tiktok", "camila.", false],
  ["tiktok", "a".repeat(24), true],
  ["tiktok", "a".repeat(25), false],
  ["linkedin", "thalita-teste-imagineup", true],
  ["linkedin", "joão-teste", true],
  ["linkedin", "žofia-teste", true],
  ["linkedin", "Thalita-Teste", false],
  ["linkedin", "ab", false],
  ["linkedin", "thalitaㅤteste", false],
  ["linkedin", "ᅟthalita-teste", false],
  ["linkedin", "שלום-teste", false],
  ["linkedin", "ｔｈａｌｉｔａ", false],
  ["linkedin", "thalita÷teste", false],
  ["linkedin", "a".repeat(100), true],
  ["linkedin", "a".repeat(101), false],
  ["x", "thalitatesteup", true],
  ["x", "@thalitatesteup", false],
  ["x", "thalita.teste", false],
  ["x", "home", false],
  ["x", "i", false],
  ["x", "logout", false],
  ["x", "homes", true],
  ["x", "home_up", true],
  ["x", "a".repeat(15), true],
  ["x", "a".repeat(16), false],
];

test("o usuário de cada rede pelo padrão do servidor, sem as páginas da rede", () => {
  for (const [network, handle, expected] of HANDLE_CASES) {
    assert.equal(profile.isSocialHandle(network, handle), expected, `${network}: ${JSON.stringify(handle)}`);
  }
  for (const value of [null, undefined, 42, ["camila"], { handle: "camila" }]) {
    assert.equal(profile.isSocialHandle("instagram", value), false);
  }
});

test("o link de cada rede, com domínio fixo e o LinkedIn codificado", () => {
  const cases = [
    ["instagram", "camila.teste.up", "https://www.instagram.com/camila.teste.up/"],
    ["tiktok", "camila.teste.up", "https://www.tiktok.com/@camila.teste.up"],
    ["linkedin", "camila-teste-imagineup", "https://www.linkedin.com/in/camila-teste-imagineup/"],
    ["linkedin", "maria-joão", "https://www.linkedin.com/in/maria-jo%C3%A3o/"],
    ["x", "camilatesteup", "https://x.com/camilatesteup"],
    ["instagram", "https://golpe.example/camila", null],
    ["x", "explore", null],
    ["tiktok", 7, null],
  ];
  for (const [network, handle, href] of cases) {
    assert.equal(profile.socialHref(network, handle), href, `${network}: ${JSON.stringify(handle)}`);
  }
});

test("o perfil novo lido: bio, gênero, conta privada e redes pela lista fixa", () => {
  const camila = profile.parseFanProfile("camila", {
    displayName: "Camila Ribeiro",
    username: "camilarib",
    bio: "Feira de Santana.\nFã do Netto desde o primeiro show.",
    gender: "woman",
    privateAccount: false,
    socials: {
      x: "camilatesteup",
      instagram: "camila.teste.up",
      tiktok: "camila.teste.up",
      linkedin: "camila-teste-imagineup",
      site: "https://golpe.example",
    },
  });
  assert.equal(camila.bio, "Feira de Santana.\nFã do Netto desde o primeiro show.");
  assert.equal(camila.gender, "woman");
  assert.equal(camila.privateAccount, false);
  assert.deepEqual(
    camila.socials.map((social) => [social.network, social.handle, social.href]),
    [
      ["instagram", "camila.teste.up", "https://www.instagram.com/camila.teste.up/"],
      ["tiktok", "camila.teste.up", "https://www.tiktok.com/@camila.teste.up"],
      ["linkedin", "camila-teste-imagineup", "https://www.linkedin.com/in/camila-teste-imagineup/"],
      ["x", "camilatesteup", "https://x.com/camilatesteup"],
    ],
  );
  assert.equal(camila.socialsStored, true);

  const torta = profile.parseFanProfile("t", { gender: "outro", privateAccount: "sim", bio: "   ", socials: { instagram: "https://golpe.example/x", x: 42 } });
  assert.equal(torta.gender, null);
  assert.equal(torta.privateAccount, false);
  assert.equal(torta.bio, null);
  assert.deepEqual(torta.socials, []);
  assert.equal(torta.socialsStored, true, "a rede fora do padrão não aparece, mas a equipe pode apagar");

  const vazia = profile.parseFanProfile("v", { socials: ["camila"], privateAccount: true, gender: "undisclosed" });
  assert.deepEqual(vazia.socials, []);
  assert.equal(vazia.socialsStored, false);
  assert.equal(vazia.privateAccount, true);
  assert.equal(profile.parseFanProfile("n", {}).socialsStored, false);
});

test("os rótulos do gênero e o usuário como a rede mostra", () => {
  assert.equal(profile.genderLabel("woman"), "Mulher");
  assert.equal(profile.genderLabel("man"), "Homem");
  assert.equal(profile.genderLabel("nonbinary"), "Não binário");
  assert.equal(profile.genderLabel("undisclosed"), "Prefiro não dizer");
  assert.equal(profile.genderLabel(null), "Não informado");
  assert.equal(profile.SOCIAL_NETWORK_LABELS.x, "X (Twitter)");
  assert.equal(profile.socialHandleText({ network: "instagram", handle: "camila.teste.up" }), "@camila.teste.up");
  assert.equal(profile.socialHandleText({ network: "linkedin", handle: "camila-teste-imagineup" }), "camila-teste-imagineup");
});
