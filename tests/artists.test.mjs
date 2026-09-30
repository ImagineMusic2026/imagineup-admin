import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const {
  GENRES,
  PRIVATE_FAILED_TEXT,
  PRIVATE_LOADING_TEXT,
  RESERVED_HANDLES,
  applyOrder,
  artistChanges,
  artistFormFromArtist,
  artistMissingForPublish,
  artistsSummary,
  bioError,
  cleanBio,
  cleanHandleInput,
  contactEmailError,
  contactPhoneError,
  countArtists,
  createArtistInput,
  createArtistsJoin,
  emptyArtistForm,
  featuredArtistIds,
  formatDay,
  formatFans,
  genreCityLine,
  handleProblem,
  handleStatusFromCheck,
  handleStatusText,
  isAdoptableDraft,
  isAnnouncedHandleStatus,
  isBlockingHandleStatus,
  isHandleFormat,
  joinArtists,
  liveHandleStatus,
  managerEmptyOptionText,
  managerLabel,
  missingForPublish,
  moveId,
  normalizeArtistForm,
  normalizePhone,
  parseArtist,
  parseArtistPrivate,
  pickPrivateFields,
  positionAnnouncement,
  publishBlockedText,
  sameIds,
  shouldCheckHandle,
  shownHandleStatus,
  sortArtists,
  suggestHandle,
  validateArtistForm,
} = await import("@/lib/artists");
const { artistImagePaths, centeredCrop, isSmallPhoto, photoFileProblem, IMAGE_CACHE_CONTROL } = await import("@/lib/artist-photo");
const { REASON_MESSAGES, callableErrorMessage, errorMessage, mayHaveRunOnServer, storageErrorMessage } = await import("@/lib/errors");
const { createLatestSender } = await import("@/lib/latest-sender");

// Meia-risca e travessão (U+2013 e U+2014), que o texto da tela não usa.
const DASHES = new RegExp("[\\u2013\\u2014]");

// ---------------------------------------------------------------------------
// @ da central
// ---------------------------------------------------------------------------

test("sugestão do @ tira acentos, símbolos e espaços e corta em 30", () => {
  assert.equal(suggestHandle("Trio Bem Bahia"), "triobembahia");
  assert.equal(suggestHandle("Forró São João"), "forrosaojoao");
  assert.equal(suggestHandle("MC Lárissa!!"), "mclarissa");
  assert.equal(suggestHandle("Juninho M. 🎶"), "juninhom");
  assert.equal(suggestHandle("Ñandú Çedilha 2"), "nanducedilha2");
  assert.equal(suggestHandle("under_score"), "underscore");
  assert.equal(suggestHandle("  "), "");
  assert.equal(suggestHandle("a".repeat(40)), "a".repeat(30));
  assert.equal(suggestHandle("Os Barões da Pisadinha e Convidados Especiais"), "osbaroesdapisadinhaeconvidados");
});

test("@ segue o formato do servidor e os reservados", () => {
  for (const handle of ["triobembahia", "a_b", "abc123", "x".repeat(30)]) assert.equal(handleProblem(handle), null, handle);
  for (const handle of ["", "ab", "x".repeat(31), "Trio", "trio-bem", "trio bem", "@trio", "forró"]) {
    assert.equal(handleProblem(handle), "invalid", handle);
  }
  for (const handle of RESERVED_HANDLES) assert.equal(handleProblem(handle), "reserved", handle);
  assert.deepEqual(RESERVED_HANDLES, ["admin", "imagine", "imagineup", "imaginemusic", "equipe", "suporte", "staff", "oficial", "ajuda", "contato"]);
  assert.equal(cleanHandleInput("@@Trio Bem"), "triobem");
  assert.equal(cleanHandleInput(" MC_Larissa "), "mc_larissa");
});

// Os mesmos casos do teste do servidor (imagineup-app, functions/src/artists/model.test.ts).
const FIRESTORE_RESERVED_IDS = ["____", "__x__", "__trio__", "__admin__", `__${"a".repeat(26)}__`];
const UNDERSCORES_OK = ["___", "__trio", "trio__", "_trio_", "__trio_", "a__b__"];

test("@ no formato __.*__ (ids que o Firestore reserva) é inválido, mesmo cabendo no formato", () => {
  for (const handle of FIRESTORE_RESERVED_IDS) {
    assert.ok(handle.length >= 3 && handle.length <= 30, handle);
    assert.equal(isHandleFormat(handle), false, handle);
    assert.equal(handleProblem(handle), "invalid", handle);
    assert.equal(handleStatusText("invalid", handle), "O @ não pode começar e terminar com __.", handle);
  }
  // Sublinhado só numa ponta, ou menos de dois em cada, segue valendo.
  for (const handle of UNDERSCORES_OK) {
    assert.equal(isHandleFormat(handle), true, handle);
    assert.equal(handleProblem(handle), null, handle);
  }
  // Fora do formato, a mensagem continua a do formato.
  assert.match(handleStatusText("invalid", "ab"), /3 a 30/);
  assert.match(handleStatusText("invalid", `__${"a".repeat(27)}__`), /3 a 30/);
  assert.match(handleStatusText("invalid"), /3 a 30/);

  // Validação do formulário.
  const base = { ...emptyArtistForm("uid-1"), name: "Trio", handle: "__trio__" };
  assert.equal(validateArtistForm(base, { checkHandle: true }).handle, "O @ não pode começar e terminar com __.");
  assert.equal(validateArtistForm({ ...base, handle: "__trio" }, { checkHandle: true }).handle, undefined);

  // Sugestão: sem _, nunca cai no __.*__.
  for (const name of ["__Trio__", "__ Trio Bem __", "____", "_x_", "__Admin__"]) {
    const suggestion = suggestHandle(name);
    assert.doesNotMatch(suggestion, /_/, name);
    if (suggestion.length >= 3) assert.equal(isHandleFormat(suggestion), true, name);
  }
  assert.equal(suggestHandle("__Trio__"), "trio");
  assert.equal(suggestHandle("____"), "");
});

test("conferência ao vivo do @ usa a mesma regra antes de perguntar ao servidor", () => {
  // Nada vai para o checkArtistHandle com o @ vazio ou reprovado nas regras locais.
  for (const handle of ["", "ab", "Trio", ...FIRESTORE_RESERVED_IDS, ...RESERVED_HANDLES]) {
    assert.equal(shouldCheckHandle(handle), false, handle || "vazio");
  }
  for (const handle of ["triobembahia", ...UNDERSCORES_OK]) assert.equal(shouldCheckHandle(handle), true, handle);

  const typed = { suggested: false };
  // A regra local vence até uma resposta antiga do servidor para o mesmo @.
  assert.equal(liveHandleStatus("__trio__", { handle: "__trio__", status: "available" }, typed), "invalid");
  assert.equal(liveHandleStatus("admin", null, typed), "reserved");
  assert.equal(liveHandleStatus("ab", null, typed), "invalid");
  assert.equal(liveHandleStatus("", null, typed), "empty");
  // Passou nas regras: espera a resposta deste @ (a de outro @ não vale).
  assert.equal(liveHandleStatus("triobembahia", null, typed), "checking");
  assert.equal(liveHandleStatus("triobembahia", { handle: "triobem", status: "available" }, typed), "checking");
  assert.equal(liveHandleStatus("triobembahia", { handle: "triobembahia", status: "taken" }, typed), "taken");
  assert.equal(liveHandleStatus("triobembahia", { handle: "triobembahia", status: "available" }, typed), "available");
  // Sugestão curta enquanto o nome é digitado não vira erro; com 3 ou mais, confere de verdade.
  assert.equal(liveHandleStatus("tr", null, { suggested: true }), "empty");
  assert.equal(liveHandleStatus("tri", null, { suggested: true }), "checking");
});

test("@ sugerido pelo nome: curto não vira erro enquanto o nome é digitado", () => {
  // Duas letras do nome: a sugestão ainda é curta e não aparece em vermelho.
  assert.equal(shownHandleStatus("invalid", "tr", { suggested: true }), "empty");
  assert.equal(shownHandleStatus("invalid", "", { suggested: true }), "empty");
  // Editado à mão, o mesmo @ curto é erro de formato.
  assert.equal(shownHandleStatus("invalid", "tr", { suggested: false }), "invalid");
  // Sugestão com 3 ou mais letras mostra o resultado de verdade.
  assert.equal(shownHandleStatus("taken", "tri", { suggested: true }), "taken");
  assert.equal(shownHandleStatus("reserved", "admin", { suggested: true }), "reserved");
  assert.equal(shownHandleStatus("checking", "trio", { suggested: true }), "checking");
  // Só resultados finais são anunciados, nunca o "Conferindo..." nem o formato.
  for (const status of ["available", "taken", "reserved", "error"]) assert.equal(isAnnouncedHandleStatus(status), true, status);
  for (const status of ["checking", "invalid", "empty"]) assert.equal(isAnnouncedHandleStatus(status), false, status);
});

test("resposta perdida do createArtist: só o rascunho da própria pessoa é retomado", () => {
  const draft = { status: "draft", publishedAt: null };
  const mine = { createdBy: "uid-1" };
  assert.equal(isAdoptableDraft(draft, mine, "uid-1"), true);
  assert.equal(isAdoptableDraft(draft, mine, "uid-2"), false);
  assert.equal(isAdoptableDraft(draft, { createdBy: "" }, ""), false);
  assert.equal(isAdoptableDraft({ ...draft, status: "published" }, mine, "uid-1"), false);
  assert.equal(isAdoptableDraft({ ...draft, status: "unpublished" }, mine, "uid-1"), false);
  assert.equal(isAdoptableDraft({ ...draft, publishedAt: new Date() }, mine, "uid-1"), false);
  // Quem criou está só no privado: sem ele, nada é retomado, nem com `createdBy` sobrando no público.
  assert.equal(isAdoptableDraft(draft, null, "uid-1"), false);
  assert.equal(isAdoptableDraft(parseArtist("trio", { status: "draft", createdBy: "uid-1", publishedAt: null }), null, "uid-1"), false);

  // Sem motivo do servidor e com código de rede ou de servidor: pode ter gravado.
  for (const code of ["functions/internal", "functions/unavailable", "functions/deadline-exceeded", "functions/unknown", ""]) {
    assert.equal(mayHaveRunOnServer({ code, message: "internal" }), true, code || "sem código");
  }
  assert.equal(mayHaveRunOnServer(new TypeError("Failed to fetch")), true);
  // Recusa de propósito (com motivo) ou códigos de validação e acesso: nada foi gravado.
  assert.equal(mayHaveRunOnServer({ code: "functions/already-exists", details: { reason: "handle-taken" } }), false);
  assert.equal(mayHaveRunOnServer({ code: "functions/internal", details: { reason: "invalid-manager" } }), false);
  for (const code of ["functions/invalid-argument", "functions/permission-denied", "functions/unauthenticated", "functions/failed-precondition"]) {
    assert.equal(mayHaveRunOnServer({ code }), false, code);
  }
});

test("status do @ vindo do checkArtistHandle", () => {
  assert.equal(handleStatusFromCheck({ available: true, reason: null }), "available");
  assert.equal(handleStatusFromCheck({ available: false, reason: "taken" }), "taken");
  assert.equal(handleStatusFromCheck({ available: false, reason: "reserved" }), "reserved");
  assert.equal(handleStatusFromCheck({ available: false, reason: "invalid" }), "invalid");
  assert.equal(handleStatusFromCheck({ available: false, reason: null }), "taken");
  assert.equal(handleStatusText("available"), "Disponível.");
  assert.match(handleStatusText("taken"), /em uso/);
  assert.match(handleStatusText("reserved"), /reservado/);
  assert.equal(handleStatusText("empty"), "");
  assert.equal(isBlockingHandleStatus("error"), false);
  assert.equal(isBlockingHandleStatus("checking"), false);
  assert.equal(isBlockingHandleStatus("taken"), true);
});

// ---------------------------------------------------------------------------
// Contato
// ---------------------------------------------------------------------------

test("celular: tira espaços, parênteses e traços; 10 a 15 dígitos com + opcional", () => {
  assert.equal(normalizePhone("+55 (71) 9 9184-2260"), "+5571991842260");
  assert.equal(normalizePhone("(71) 99184‑2260"), "71991842260");
  assert.equal(contactPhoneError("+55 (71) 9 9184-2260"), null);
  assert.equal(contactPhoneError("(71) 3333-4444"), null);
  assert.equal(contactPhoneError(""), null);
  assert.equal(contactPhoneError("   "), null);
  for (const phone of ["123456789", "+1234567890123456", "71.99184.2260", "55+71999999999", "71 9918A-2260"]) {
    assert.ok(contactPhoneError(phone), phone);
  }
});

test("e-mail de contato é opcional, validado e minúsculo", () => {
  assert.equal(contactEmailError(""), null);
  assert.equal(contactEmailError("Contato@TrioBemBahia.com.br"), null);
  assert.match(contactEmailError("contato@"), /formato/);
  const form = normalizeArtistForm({ ...emptyArtistForm("uid-1"), name: "Trio", contactEmail: " Contato@TrioBemBahia.COM.br " });
  assert.equal(form.contactEmail, "contato@triobembahia.com.br");
});

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

test("bio: até 500, quebras de linha valem, cada linha visível", () => {
  assert.equal(cleanBio("  Axé raiz  \r\n\r\n\r\n  de Salvador \n"), "Axé raiz\n\nde Salvador");
  assert.equal(bioError(""), null);
  assert.equal(bioError("a".repeat(500)), null);
  assert.match(bioError("a".repeat(501)), /500/);
  assert.equal(bioError("Primeira linha\n\nSegunda linha 🎶"), null);
  assert.ok(bioError("linha com​invisível"));
  assert.ok(bioError("tab\tno meio"));
});

test("validação do formulário da central", () => {
  const base = { ...emptyArtistForm("uid-1"), name: "Trio Bem Bahia", handle: "triobembahia" };
  assert.deepEqual(validateArtistForm(base, { checkHandle: true }), {});
  assert.deepEqual(validateArtistForm({ ...base, name: " " }, { checkHandle: true }), { name: "Digite o nome artístico." });
  assert.match(validateArtistForm({ ...base, name: "a".repeat(61) }, { checkHandle: true }).name, /60/);
  assert.deepEqual(validateArtistForm({ ...base, handle: "" }, { checkHandle: true }), { handle: "Escolha o @ da central." });
  assert.match(validateArtistForm({ ...base, handle: "ab" }, { checkHandle: true }).handle, /3 a 30/);
  assert.match(validateArtistForm({ ...base, handle: "admin" }, { checkHandle: true }).handle, /reservado/);
  // Na edição o @ não muda e não é conferido.
  assert.deepEqual(validateArtistForm({ ...base, handle: "" }, { checkHandle: false }), {});
  const errors = validateArtistForm(
    { ...base, shortName: "x".repeat(21), genre: "Jazz", city: "Salvador\nBA", contactEmail: "x@", contactPhone: "123" },
    { checkHandle: true },
  );
  assert.deepEqual(Object.keys(errors).sort(), ["city", "contactEmail", "contactPhone", "genre", "shortName"]);
  assert.match(errors.shortName, /20/);
});

test("criar manda só os opcionais preenchidos, já limpos", () => {
  const form = normalizeArtistForm({
    ...emptyArtistForm("uid-1"),
    name: "  Trio Bem Bahia ",
    handle: "@TrioBemBahia",
    shortName: " ",
    genre: "Axé",
    city: "Salvador, BA",
    bio: "  Axé raiz de Salvador.  ",
    verified: true,
    imageRightsConfirmed: true,
    contactPhone: "+55 (71) 9 9184-2260",
  });
  assert.deepEqual(createArtistInput(form), {
    handle: "triobembahia",
    name: "Trio Bem Bahia",
    genre: "Axé",
    city: "Salvador, BA",
    bio: "Axé raiz de Salvador.",
    verified: true,
    managerUid: "uid-1",
    imageRightsConfirmed: true,
    contactPhone: "+5571991842260",
  });
  const empty = createArtistInput(normalizeArtistForm({ ...emptyArtistForm(""), name: "Nenho", handle: "nenho" }));
  assert.deepEqual(empty, { handle: "nenho", name: "Nenho", verified: false, imageRightsConfirmed: false });
});

const SAMPLE = parseArtist("triobembahia", {
  handle: "triobembahia",
  name: "Trio Bem Bahia",
  shortName: null,
  genre: "Axé",
  city: "Salvador, BA",
  bio: "Axé raiz.",
  verified: false,
  photo: null,
  thumb: null,
  order: 2,
  status: "draft",
  fanCount: 0,
  publishedAt: null,
});

const SAMPLE_PRIVATE = parseArtistPrivate({
  email: "contato@trio.com",
  phone: "+5571991842260",
  managerUid: "uid-1",
  managerName: "Iara Costa",
  imageRightsConfirmed: true,
  createdBy: "uid-1",
  updatedBy: "uid-2",
});

test("formulário lê os dois documentos; sem o privado, gestor, autorização e contato ficam vazios", () => {
  const full = artistFormFromArtist(SAMPLE, SAMPLE_PRIVATE);
  assert.equal(full.name, "Trio Bem Bahia");
  assert.equal(full.managerUid, "uid-1");
  assert.equal(full.imageRightsConfirmed, true);
  assert.equal(full.contactEmail, "contato@trio.com");
  assert.equal(full.contactPhone, "+5571991842260");

  const waiting = artistFormFromArtist(SAMPLE, null);
  assert.deepEqual(pickPrivateFields(waiting), { managerUid: "", imageRightsConfirmed: false, contactEmail: "", contactPhone: "" });
  // Quando o privado chega, só esses quatro campos mudam.
  const arrived = { ...waiting, name: "Editado na tela", ...pickPrivateFields(full) };
  assert.equal(arrived.name, "Editado na tela");
  assert.deepEqual(pickPrivateFields(arrived), pickPrivateFields(full));
});

test("formulário: o campo Gestor não diz Sem gestor enquanto o privado não chegou ou falhou", () => {
  // Aberto antes do privado: o valor do campo é a opção vazia, que não pode afirmar "Sem gestor".
  const waiting = artistFormFromArtist(SAMPLE, null);
  assert.equal(waiting.managerUid, "");
  assert.equal(managerEmptyOptionText("loading"), PRIVATE_LOADING_TEXT);
  assert.equal(managerEmptyOptionText("loading"), managerLabel({ internal: null }));
  assert.equal(managerEmptyOptionText("error"), PRIVATE_FAILED_TEXT);
  assert.equal(PRIVATE_FAILED_TEXT, "Não carregou");
  for (const state of ["loading", "error"]) assert.notEqual(managerEmptyOptionText(state), "Sem gestor");

  // Com o privado: o gestor dele fica selecionado; "Sem gestor" só quando ele não tem gestor.
  assert.equal(artistFormFromArtist(SAMPLE, SAMPLE_PRIVATE).managerUid, "uid-1");
  const noManager = { ...SAMPLE_PRIVATE, managerUid: null, managerName: null };
  assert.equal(artistFormFromArtist(SAMPLE, noManager).managerUid, "");
  assert.equal(managerEmptyOptionText("ready"), "Sem gestor");
  assert.equal(managerEmptyOptionText("ready"), managerLabel({ internal: noManager }));
  for (const state of ["loading", "ready", "error"]) assert.doesNotMatch(managerEmptyOptionText(state), DASHES);
});

test("editar manda só o que mudou; null limpa; gestor, autorização e contato só depois de carregar o privado", () => {
  const before = normalizeArtistForm(artistFormFromArtist(SAMPLE, SAMPLE_PRIVATE));
  const same = normalizeArtistForm(artistFormFromArtist(SAMPLE, SAMPLE_PRIVATE));
  assert.deepEqual(artistChanges(before, same, { includePrivate: true }), {});

  const after = normalizeArtistForm({
    ...artistFormFromArtist(SAMPLE, SAMPLE_PRIVATE),
    city: "",
    shortName: "Trio",
    verified: true,
    managerUid: "",
    imageRightsConfirmed: false,
    contactEmail: "",
  });
  assert.deepEqual(artistChanges(before, after, { includePrivate: true }), {
    shortName: "Trio",
    city: null,
    verified: true,
    managerUid: null,
    imageRightsConfirmed: false,
    contactEmail: null,
  });
  // Sem o privado carregado, nada dele vai no envio (nem o gestor nem a autorização).
  assert.deepEqual(artistChanges(before, after, { includePrivate: false }), {
    shortName: "Trio",
    city: null,
    verified: true,
  });
  // Depois de um envio sem o privado, o servidor fica com o privado de antes.
  const saved = { ...after, ...pickPrivateFields(before) };
  assert.deepEqual(artistChanges(saved, after, { includePrivate: true }), {
    managerUid: null,
    imageRightsConfirmed: false,
    contactEmail: null,
  });
});

// ---------------------------------------------------------------------------
// Publicação, contagens e ordem
// ---------------------------------------------------------------------------

test("para publicar: foto (as duas versões) e autorização de imagem", () => {
  assert.deepEqual(missingForPublish({ hasPhoto: false, imageRightsConfirmed: false }), ["photo", "image-rights"]);
  assert.deepEqual(missingForPublish({ hasPhoto: true, imageRightsConfirmed: false }), ["image-rights"]);
  assert.deepEqual(missingForPublish({ hasPhoto: true, imageRightsConfirmed: true }), []);
  const image = { url: "https://x/y.webp", path: "artists/a/y.webp", width: 1200, height: 1600 };
  const rights = { imageRightsConfirmed: true };
  assert.deepEqual(artistMissingForPublish({ photo: image, thumb: null, internal: rights }), ["photo"]);
  assert.deepEqual(artistMissingForPublish({ photo: image, thumb: image, internal: rights }), []);
  assert.deepEqual(artistMissingForPublish({ photo: image, thumb: image, internal: { imageRightsConfirmed: false } }), ["image-rights"]);
  // Privado ainda não chegou: a autorização conta como não recebida e nunca libera publicar.
  assert.deepEqual(artistMissingForPublish({ photo: image, thumb: image, internal: null }), ["image-rights"]);
  assert.deepEqual(artistMissingForPublish({ photo: null, thumb: null, internal: null }), ["photo", "image-rights"]);
  assert.equal(publishBlockedText(["photo", "image-rights"]), "Para publicar, faltam a foto e a autorização de uso de imagem.");
  assert.equal(publishBlockedText(["photo"]), "Para publicar, falta a foto.");
  assert.match(publishBlockedText(["image-rights"]), /autorização/);
  assert.equal(publishBlockedText([]), "");
});

test("leitura defensiva do documento e ordem de destaque", () => {
  const odd = parseArtist("x", { status: "arquivado", order: "3", fanCount: -4, photo: { path: "sem-url" }, thumb: { url: "u", width: 0 } });
  assert.equal(odd.status, "draft");
  assert.equal(odd.order, Number.MAX_SAFE_INTEGER);
  assert.equal(odd.fanCount, 0);
  assert.equal(odd.photo, null);
  assert.deepEqual(odd.thumb, { url: "u", path: "", width: 480, height: 640 });
  assert.equal(odd.name, "x");

  // O público nunca traz dado interno, mesmo que sobre algum no documento.
  const leaked = parseArtist("x", { managerUid: "u", managerName: "N", imageRightsConfirmed: true, createdBy: "u", updatedBy: "u" });
  for (const field of ["managerUid", "managerName", "imageRightsConfirmed", "createdBy", "updatedBy"]) {
    assert.equal(field in leaked, false, field);
  }

  // Privado: a autorização só vale com true de verdade; vazios viram null.
  assert.equal(SAMPLE_PRIVATE.managerName, "Iara Costa");
  assert.deepEqual(parseArtistPrivate({ imageRightsConfirmed: "true", email: "", managerUid: 3 }), {
    email: null,
    phone: null,
    managerUid: null,
    managerName: null,
    imageRightsConfirmed: false,
    createdBy: "",
    updatedBy: "",
    updatedAt: null,
  });

  const list = sortArtists([
    { id: "c", name: "Cc", order: 1 },
    { id: "a", name: "Aa", order: 0 },
    { id: "b", name: "Bb", order: 1 },
  ]);
  assert.deepEqual(list.map((item) => item.id), ["a", "b", "c"]);
});

test("listas: centrais e privados juntos pelo id, com Carregando... até o privado chegar", () => {
  const artists = [
    { ...SAMPLE, id: "b", name: "Bb", order: 1 },
    { ...SAMPLE, id: "a", name: "Aa", order: 0 },
  ];
  const waiting = joinArtists(artists, null);
  assert.deepEqual(waiting.map((entry) => entry.internal), [null, null]);
  assert.equal(managerLabel(waiting[0]), PRIVATE_LOADING_TEXT);
  assert.equal(PRIVATE_LOADING_TEXT, "Carregando...");

  const privates = new Map([["a", SAMPLE_PRIVATE], ["z", SAMPLE_PRIVATE]]);
  const joined = joinArtists(artists, privates);
  assert.equal(joined[0].internal, null);
  assert.equal(joined[1].internal, SAMPLE_PRIVATE);
  assert.equal(managerLabel(joined[1]), "Iara Costa");
  assert.equal(managerLabel({ internal: { ...SAMPLE_PRIVATE, managerName: null } }), "Sem gestor");

  // Duas escutas: a lista sai quando as centrais chegam (na ordem), e de novo a cada mudança.
  const emitted = [];
  const join = createArtistsJoin((entries) => emitted.push(entries));
  join.setPrivates([["a", SAMPLE_PRIVATE]]);
  assert.equal(emitted.length, 0);
  join.setArtists(artists);
  assert.equal(emitted.length, 1);
  assert.deepEqual(
    emitted[0].map((entry) => [entry.id, managerLabel(entry)]),
    [
      ["a", "Iara Costa"],
      ["b", PRIVATE_LOADING_TEXT],
    ],
  );
  assert.deepEqual(artistMissingForPublish(emitted[0][1]), ["photo", "image-rights"]);

  join.setPrivates([
    ["a", SAMPLE_PRIVATE],
    ["b", { ...SAMPLE_PRIVATE, managerName: "Rui" }],
  ]);
  assert.deepEqual(emitted[1].map((entry) => managerLabel(entry)), ["Iara Costa", "Rui"]);
  // Privado que some volta a Carregando... e à autorização não recebida.
  join.setPrivates([]);
  assert.deepEqual(emitted[2].map((entry) => managerLabel(entry)), [PRIVATE_LOADING_TEXT, PRIVATE_LOADING_TEXT]);
  assert.ok(emitted[2].every((entry) => artistMissingForPublish(entry).includes("image-rights")));
});

test("contagens e subtítulo", () => {
  const counts = countArtists([{ status: "published" }, { status: "draft" }, { status: "unpublished" }, { status: "draft" }]);
  assert.deepEqual(counts, { total: 4, published: 1, drafts: 2, unpublished: 1 });
  assert.equal(artistsSummary(counts), "1 central no ar · 2 aguardando publicação");
  assert.equal(artistsSummary({ published: 19, drafts: 3 }), "19 centrais no ar · 3 aguardando publicação");
  assert.equal(artistsSummary({ published: 0, drafts: 0 }), "0 centrais no ar · 0 aguardando publicação");
});

test("subir e descer, ordem local e destaques", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(moveId(ids, "c", -1), ["a", "c", "b", "d"]);
  assert.deepEqual(moveId(ids, "c", 1), ["a", "b", "d", "c"]);
  assert.equal(moveId(ids, "a", -1), null);
  assert.equal(moveId(ids, "d", 1), null);
  assert.equal(moveId(ids, "z", 1), null);
  assert.deepEqual(ids, ["a", "b", "c", "d"]);

  const items = ids.map((id) => ({ id }));
  // Quem não está na ordem local (criado por outra pessoa) vai para o fim; quem sumiu, sai.
  assert.deepEqual(applyOrder([...items, { id: "e" }], ["d", "c", "x", "b", "a"]).map((item) => item.id), ["d", "c", "b", "a", "e"]);
  assert.equal(sameIds(["a", "b"], ["a", "b"]), true);
  assert.equal(sameIds(["a", "b"], ["b", "a"]), false);

  const statuses = [
    { id: "a", status: "draft" },
    { id: "b", status: "published" },
    { id: "c", status: "published" },
    { id: "d", status: "unpublished" },
    { id: "e", status: "published" },
    { id: "f", status: "published" },
    { id: "g", status: "published" },
  ];
  assert.deepEqual([...featuredArtistIds(statuses)], ["b", "c", "e", "f"]);
  assert.equal(positionAnnouncement("Netto Brito", 2, 5), "Netto Brito agora está na posição 2 de 5.");
});

/** Envio que só termina quando o teste manda. */
function manualDelivery() {
  const calls = [];
  const deliver = (value) =>
    new Promise((resolve, reject) => {
      calls.push({ value, resolve, reject });
    });
  return { calls, deliver };
}

test("ordem: um pedido antigo atrasado nunca chega depois do novo", async () => {
  // O "servidor" guarda a última ordem que chegou.
  let saved = null;
  const { calls, deliver } = manualDelivery();
  const sender = createLatestSender((ids) => deliver(ids).then(() => (saved = ids)));

  const first = sender.send(["a", "b", "c"]);
  assert.equal(sender.busy, true);
  const second = sender.send(["b", "a", "c"]);
  // O segundo espera o primeiro terminar: nada de dois pedidos no ar.
  assert.equal(calls.length, 1);

  calls[0].resolve();
  assert.deepEqual(await first, { status: "sent" });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].value, ["b", "a", "c"]);
  calls[1].resolve();
  assert.deepEqual(await second, { status: "sent" });
  assert.deepEqual(saved, ["b", "a", "c"]);
  assert.equal(sender.busy, false);
});

test("ordem: na fila só vai o mais novo, e a falha de um não trava os seguintes", async () => {
  const { calls, deliver } = manualDelivery();
  const sender = createLatestSender(deliver);

  const first = sender.send(["a"]);
  const middle = sender.send(["b"]);
  const last = sender.send(["c"]);
  // O do meio foi trocado pelo mais novo antes de sair.
  assert.deepEqual(await middle, { status: "skipped" });

  const failure = new Error("sem rede");
  calls[0].reject(failure);
  assert.deepEqual(await first, { status: "failed", error: failure });
  assert.deepEqual(
    calls.map((call) => call.value),
    [["a"], ["c"]],
  );
  calls[1].resolve();
  assert.deepEqual(await last, { status: "sent" });

  // Livre de novo, o envio sai na hora.
  const alone = sender.send(["d"]);
  assert.equal(calls.length, 3);
  calls[2].resolve();
  assert.deepEqual(await alone, { status: "sent" });
});

test("textos das linhas", () => {
  assert.equal(genreCityLine({ genre: "Arrocha", city: "Feira de Santana, BA" }), "Arrocha · Feira de Santana, BA");
  assert.equal(genreCityLine({ genre: null, city: "Recife, PE" }), "Recife, PE");
  assert.equal(genreCityLine({ genre: null, city: null }), "");
  assert.equal(formatFans(412180), "412.180");
  const now = new Date("2026-09-29T12:00:00Z");
  assert.equal(formatDay(new Date("2026-08-02T15:00:00Z"), now), "2 ago");
  // 02:00 em UTC ainda é dia 1 em São Paulo.
  assert.equal(formatDay(new Date("2026-08-02T02:00:00Z"), now), "1 ago");
  assert.equal(formatDay(new Date("2025-12-31T15:00:00Z"), now), "31 dez 2025");
  assert.equal(GENRES.length, 16);
  assert.ok(GENRES.includes("Forró pé de serra"));
});

// ---------------------------------------------------------------------------
// Foto
// ---------------------------------------------------------------------------

test("recorte central 3:4 sem distorcer", () => {
  assert.deepEqual(centeredCrop(4000, 3000), { x: 875, y: 0, width: 2250, height: 3000 });
  assert.deepEqual(centeredCrop(3000, 4000), { x: 0, y: 0, width: 3000, height: 4000 });
  assert.deepEqual(centeredCrop(1080, 1920), { x: 0, y: 240, width: 1080, height: 1440 });
  assert.deepEqual(centeredCrop(1200, 1600), { x: 0, y: 0, width: 1200, height: 1600 });
  assert.deepEqual(centeredCrop(601, 800), { x: 0, y: 0, width: 600, height: 800 });
  assert.deepEqual(centeredCrop(1000, 1000), { x: 125, y: 0, width: 750, height: 1000 });
  assert.deepEqual(centeredCrop(1, 1), { x: 0, y: 0, width: 1, height: 1 });
  for (const [width, height] of [[4032, 3024], [3024, 4032], [1920, 1080], [777, 1333]]) {
    const crop = centeredCrop(width, height);
    assert.ok(Math.abs(crop.width / crop.height - 0.75) < 0.002, `${width}x${height}`);
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= width && crop.y + crop.height <= height, `${width}x${height}`);
  }
});

test("aviso de foto pequena abaixo de 600x800 (na área recortada)", () => {
  assert.equal(isSmallPhoto({ width: 600, height: 800 }), false);
  assert.equal(isSmallPhoto({ width: 599, height: 800 }), true);
  assert.equal(isSmallPhoto({ width: 600, height: 799 }), true);
  // Paisagem 1000x700: o recorte fica 525x700, pequeno.
  assert.equal(isSmallPhoto(centeredCrop(1000, 700)), true);
});

test("tipos de arquivo aceitos e HEIC com mensagem própria", () => {
  assert.equal(photoFileProblem({ type: "image/jpeg", name: "a.jpg", size: 1000 }), null);
  assert.equal(photoFileProblem({ type: "image/png", name: "a.png", size: 1000 }), null);
  assert.equal(photoFileProblem({ type: "image/webp", name: "a.webp", size: 1000 }), null);
  assert.equal(photoFileProblem({ type: "", name: "FOTO.JPG", size: 1000 }), null);
  assert.match(photoFileProblem({ type: "image/heic", name: "IMG_1.HEIC", size: 1000 }), /HEIC/);
  assert.match(photoFileProblem({ type: "", name: "IMG_1.heif", size: 1000 }), /HEIC/);
  assert.equal(photoFileProblem({ type: "image/gif", name: "a.gif", size: 1000 }), "Use uma foto em JPG, PNG ou WebP.");
  assert.equal(photoFileProblem({ type: "", name: "sem-extensao", size: 1000 }), "Use uma foto em JPG, PNG ou WebP.");
  assert.match(photoFileProblem({ type: "image/jpeg", name: "a.jpg", size: 0 }), /vazio/);
  assert.match(photoFileProblem({ type: "image/jpeg", name: "a.jpg", size: 26 * 1024 * 1024 }), /25 MB/);
});

test("caminhos no Storage com nome novo a cada envio", () => {
  assert.deepEqual(artistImagePaths("triobembahia", 1790718061494), {
    photoPath: "artists/triobembahia/photo-1790718061494-1200.webp",
    thumbPath: "artists/triobembahia/thumb-1790718061494-480.webp",
  });
  assert.deepEqual(artistImagePaths("nenho", 1, "jpg"), {
    photoPath: "artists/nenho/photo-1-1200.jpg",
    thumbPath: "artists/nenho/thumb-1-480.jpg",
  });
  assert.equal(IMAGE_CACHE_CONTROL, "public, max-age=31536000, immutable");
});

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

test("motivos novos das funções dos artistas", () => {
  const cases = {
    "invalid-handle": ["functions/invalid-argument", /3 a 30/],
    "handle-taken": ["functions/already-exists", /em uso/],
    "handle-reserved": ["functions/already-exists", /reservado/],
    "invalid-manager": ["functions/invalid-argument", /gestor/],
    "published-needs-photo": ["functions/failed-precondition", /precisa de foto/],
    "published-needs-image-rights": ["functions/failed-precondition", /autorização/],
    "missing-photo": ["functions/failed-precondition", /foto/],
    "missing-image-rights": ["functions/failed-precondition", /autorização/],
    "unknown-artist": ["functions/invalid-argument", /lista de centrais mudou/],
    "was-published": ["functions/failed-precondition", /nunca foi publicado/],
    "not-admin": ["functions/permission-denied", /admin/],
  };
  for (const [reason, [code, pattern]] of Object.entries(cases)) {
    // Sem frase do servidor (só o código), vale o motivo.
    assert.match(callableErrorMessage({ code, message: code.replace("functions/", ""), details: { reason } }), pattern, reason);
  }
  // Com frase do servidor, ela vence.
  assert.equal(
    callableErrorMessage({ code: "functions/already-exists", message: "Esse @ já é de um fã. [409]", details: { reason: "handle-taken" } }),
    "Esse @ já é de um fã.",
  );
  for (const message of Object.values(REASON_MESSAGES)) assert.doesNotMatch(message, DASHES, message);
});

test("erros do envio da foto", () => {
  assert.match(storageErrorMessage({ code: "storage/unauthorized" }), /recusado/);
  assert.match(storageErrorMessage({ code: "storage/retry-limit-exceeded" }), /conexão/);
  assert.equal(storageErrorMessage({ code: "storage/unknown" }), "Não foi possível enviar a foto. Tente de novo.");
  assert.equal(storageErrorMessage(new Error("x")), "Não foi possível enviar a foto. Tente de novo.");
  assert.equal(errorMessage({ code: "storage/unauthenticated" }), "Sua sessão terminou. Entre de novo.");
});
