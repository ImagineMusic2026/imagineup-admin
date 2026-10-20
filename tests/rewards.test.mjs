import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const rewards = await import("@/lib/rewards");

const sp = (local) => Date.parse(`${local}-03:00`);
const NOW = sp("2026-10-08T10:00:00");

function reward(fields = {}) {
  return rewards.parseReward("meet", {
    kind: "meet",
    title: "Meet & greet",
    subtitle: "Camarim",
    cost: 10000,
    stockTotal: 20,
    redeemedCount: 3,
    perFanLimit: 1,
    eventId: "sj",
    instructions: "Leve o código.",
    status: "published",
    order: 1,
    publishedAt: Timestamp.fromMillis(sp("2026-10-01T00:00:00")),
    ...fields,
  });
}

test("a recompensa e o pedido lidos, com quem mudou por último", () => {
  const item = reward({ photo: { url: "u", path: "rewards/meet/photo-1.webp" }, perFanLimit: 0, kind: "outro" });
  assert.equal(item.kind, "merch");
  assert.deepEqual(item.photo, { url: "u", path: "rewards/meet/photo-1.webp", width: 1200, height: 643 });
  assert.equal(item.perFanLimit, null);
  const order = rewards.parseRedemption("UP-7QXH2R", {
    rewardId: "passagem",
    rewardTitle: "Passagem de som",
    points: 3000,
    uid: "u1",
    fanName: "Camila",
    fanUsername: "camilarib",
    status: "approved",
    requestedAt: Timestamp.fromMillis(1000),
    updatedBy: { uid: "s1", name: "Editora" },
  });
  assert.equal(order.updatedBy, "Editora");
  assert.equal(rewards.fanLine(order), "Camila · @camilarib");
  assert.equal(rewards.fanLine({ ...order, accountDeleted: true }), "Conta excluída");
  assert.equal(rewards.parseRedemption("UP-X", { status: "estranho" }).status, "requested");
});

test("pedidos: a ordem da fila, as ações pelo status e o código normalizado", () => {
  assert.equal(rewards.redemptionOrder("requested"), "asc");
  assert.equal(rewards.redemptionOrder("approved"), "asc");
  assert.equal(rewards.redemptionOrder("delivered"), "desc");
  assert.equal(rewards.redemptionOrder("all"), "desc");
  assert.deepEqual(rewards.redemptionActions("requested"), ["approve", "deliver", "refuse"]);
  assert.deepEqual(rewards.redemptionActions("approved"), ["deliver", "refuse"]);
  assert.deepEqual(rewards.redemptionActions("refused"), []);
  assert.equal(rewards.normalizeCode("up4kd9tm"), "UP-4KD9TM");
  assert.equal(rewards.normalizeCode(" UP-7qxh2r "), "UP-7QXH2R");
  assert.equal(rewards.normalizeCode("--"), "");
  assert.equal(rewards.CODE_PATTERN.test("UP-7QXH2R"), true);
  assert.equal(rewards.CODE_PATTERN.test("UP-7QX"), false);
  assert.deepEqual(rewards.validateRefusal("  "), { error: null, value: null });
  assert.deepEqual(rewards.validateRefusal(" Show cancelado "), { error: null, value: "Show cancelado" });
  assert.equal(rewards.validateRefusal("x".repeat(201)).error, "Até 200 caracteres, numa linha.");
  assert.equal(rewards.refundText(6000), "Os 6.000 pontos voltam para o saldo do fã.");
});

test("o show aberto como o servidor, o estoque, a esgotada e o apagar", () => {
  const open = { id: "sj", title: "São João", status: "published", startsAt: new Date(sp("2026-10-08T00:30:00")) };
  const yesterday = { ...open, startsAt: new Date(sp("2026-10-07T23:00:00")) };
  assert.equal(rewards.isEventOpen(open, NOW), true);
  assert.equal(rewards.isEventOpen(yesterday, NOW), false);
  assert.equal(rewards.isEventOpen({ ...open, status: "draft" }, NOW), false);
  assert.equal(rewards.stockText(reward()), "17 de 20 restantes");
  assert.equal(rewards.stockText(reward({ stockTotal: 4, redeemedCount: 3 })), "1 de 4 restante");
  assert.equal(rewards.stockText(reward({ stockTotal: null })), "Sem limite");
  assert.equal(rewards.isSoldOut(reward({ stockTotal: 3 }), open, NOW), true);
  assert.equal(rewards.isSoldOut(reward(), yesterday, NOW), true);
  assert.equal(rewards.hasClosedEvent(reward({ status: "draft" }), yesterday, NOW), false);
  assert.equal(rewards.isSoldOut(reward(), open, NOW), false);
  assert.equal(rewards.deleteBlocked(reward()), rewards.WAS_PUBLISHED_TEXT);
  assert.equal(rewards.deleteBlocked(reward({ publishedAt: null, status: "draft" })), null);
});

test("a ordem só mexe nos rascunhos e nas no ar; as encerradas ficam no lugar", () => {
  const list = [
    { id: "a", status: "published" },
    { id: "x", status: "closed" },
    { id: "b", status: "draft" },
    { id: "c", status: "published" },
  ];
  assert.deepEqual(rewards.reorderableIds(list), ["a", "b", "c"]);
  assert.deepEqual(
    rewards.applyRewardOrder(list, ["b", "a", "c"]).map((item) => item.id),
    ["b", "x", "a", "c"],
  );
});

test("o formulário confere como o servidor e manda só o que mudou", () => {
  const form = { ...rewards.EMPTY_REWARD_FORM, title: "Boné", subtitle: "Edição", cost: "4000", instructions: "  Retire no camarim.\r\n\r\n\r\nLeve o código.  " };
  assert.equal(form.stockLimited, false);
  const { input } = rewards.validateReward(form);
  assert.deepEqual(input, {
    kind: "ticket",
    title: "Boné",
    subtitle: "Edição",
    description: null,
    cost: 4000,
    featured: false,
    scarcity: false,
    stockTotal: null,
    perFanLimit: 1,
    eventId: null,
    instructions: "Retire no camarim.\n\nLeve o código.",
  });
  assert.equal(rewards.validateReward({ ...form, cost: "0" }).errors.cost, "De 1 a 1.000.000 pontos.");
  assert.equal(rewards.validateReward({ ...form, stockLimited: true, stockTotal: "" }).errors.stockTotal, "De 0 a 100.000, ou sem limite.");
  assert.equal(rewards.validateReward({ ...form, perFanLimit: "101" }).errors.perFanLimit, "De 1 a 100, ou sem limite.");
  assert.equal(rewards.validateReward({ ...form, instructions: " " }).errors.instructions, "Escreva como retirar, até 1.000 caracteres.");
  assert.equal(rewards.validateReward({ ...form, perFanLimited: false }).input.perFanLimit, null);

  const current = reward();
  const edited = rewards.validateReward({ ...rewards.rewardFormOf(current), cost: "12000", eventId: "" }).input;
  assert.deepEqual(rewards.rewardChanges(current, edited), { cost: 12000, eventId: null });
  assert.equal(rewards.rewardFieldOf("instructions"), "instructions");
  assert.equal(rewards.rewardFieldOf("photo"), null);
});

test("o estoque nunca abaixo do resgatado", () => {
  assert.deepEqual(rewards.validateStock(false, "", 3), { error: null, stockTotal: null });
  assert.deepEqual(rewards.validateStock(true, "3", 3), { error: null, stockTotal: 3 });
  assert.equal(rewards.validateStock(true, "2", 3).error, "Já foram resgatados 3: o estoque não fica abaixo disso.");
  assert.equal(rewards.validateStock(true, "100001", 0).error, "De 0 a 100.000, ou sem limite.");
});

test("os números da loja e a tabela por recompensa", () => {
  const day = (totals, bySource, byReward) => ({
    totals: { redeemRequested: 0, refunded: 0, redeemDelivered: 0, ...totals },
    bySource,
    byReward,
  });
  const days = [
    day({ redeemRequested: 2, refunded: 0, redeemDelivered: 1 }, { redeem: { points: 9000, events: 2 } }, {
      ingressos: { requested: 2, spent: 9000, approved: 0, delivered: 1, refused: 0, canceled: 0, refunded: 0 },
    }),
    day({ redeemRequested: 1, refunded: 6000 }, {}, {
      ingressos: { requested: 0, spent: 0, approved: 0, delivered: 0, refused: 1, canceled: 0, refunded: 6000 },
      camisa: { requested: 3, spent: 45000, approved: 1, delivered: 0, refused: 0, canceled: 0, refunded: 0 },
    }),
  ];
  assert.deepEqual(rewards.rewardNumbers(days), { requested: 3, spent: 9000, refunded: 6000, delivered: 1 });
  assert.deepEqual(
    rewards.rewardTable(days).map((row) => [row.rewardId, row.numbers.requested, row.numbers.refunded]),
    [
      ["camisa", 3, 0],
      ["ingressos", 2, 6000],
    ],
  );
});

test("a recompensa só para prêmios de fã-clube: o status, o Desconto, o custo 0 e fora da ordem", () => {
  const prize = reward({ status: "prize", kind: "discount", cost: 0, order: undefined, publishedAt: null });
  assert.equal(prize.status, "prize");
  assert.equal(prize.kind, "discount");
  assert.equal(rewards.isPrizeReward(prize), true);
  assert.equal(rewards.KIND_LABELS.discount, "Desconto");
  assert.equal(rewards.REWARD_STATUS_LABELS.prize, "Só para prêmios de fã-clube");
  assert.deepEqual(rewards.kindsFor(false), ["ticket", "videocall", "merch", "screen", "meet"]);
  assert.ok(rewards.kindsFor(true).includes("discount"));
  // O status desconhecido continua rascunho, como antes.
  assert.equal(reward({ status: "outro" }).status, "draft");

  // A de prêmio nunca entra na ordem (o servidor recusaria a lista inteira, 34.19).
  const list = [reward({ status: "draft" }), prize, reward({ status: "closed" })].map((item, index) => ({ ...item, id: `r${index}` }));
  assert.deepEqual(rewards.reorderableIds(list), ["r0"]);
  assert.deepEqual(rewards.applyRewardOrder(list, ["r0"]).map((item) => item.id), ["r0", "r1", "r2"]);

  // O formulário: custo 0, sem destaque, vagas nem limite por fã; o Desconto só na de prêmio.
  const base = { ...rewards.EMPTY_REWARD_FORM, title: "Cortesia", subtitle: "São João", instructions: "Retire na bilheteria.", featured: true, scarcity: true };
  const checked = rewards.validateReward({ ...base, prize: true, kind: "discount", cost: "" });
  assert.deepEqual(checked.errors, {});
  assert.equal(checked.input.cost, 0);
  assert.equal(checked.input.perFanLimit, null);
  assert.equal(checked.input.featured, false);
  assert.equal(checked.input.scarcity, false);
  assert.ok(rewards.validateReward({ ...base, prize: false, kind: "discount", cost: "100" }).errors.kind);
  assert.ok(rewards.validateReward({ ...base, prize: false, cost: "0" }).errors.cost);
  assert.equal(rewards.rewardFormOf(prize).prize, true);
});

test("o pedido de prêmio lido: a origem, o fã-clube, a concessão, o cupom e a mensagem", () => {
  const prize = rewards.parseRedemption("UP-ABC123", {
    rewardId: "cortesia",
    rewardTitle: "Ingresso de cortesia",
    points: 0,
    status: "approved",
    origin: "prize",
    fanClubId: "c1",
    grantId: "g-12345678",
    coupon: "CORTESIA-IRARA",
    message: "Parabéns!",
  });
  assert.equal(rewards.isPrizeRedemption(prize), true);
  assert.deepEqual([prize.fanClubId, prize.grantId, prize.coupon, prize.message], ["c1", "g-12345678", "CORTESIA-IRARA", "Parabéns!"]);
  // O pedido de antes (sem a origem) é da loja, sem cupom nem mensagem.
  const store = rewards.parseRedemption("UP-XYZ789", { rewardId: "camisa", status: "requested", points: 900 });
  assert.equal(rewards.isPrizeRedemption(store), false);
  assert.deepEqual([store.origin, store.coupon, store.message, store.grantId], ["store", null, null, null]);
});

test("a tabela por recompensa soma os prêmios de fã-clube dados", () => {
  const day = (byReward) => ({ totals: { redeemRequested: 0, refunded: 0, redeemDelivered: 0 }, bySource: {}, byReward });
  const empty = { requested: 0, spent: 0, approved: 0, delivered: 0, refused: 0, canceled: 0, refunded: 0, prizes: 0 };
  const rows = rewards.rewardTable([day({ cortesia: { ...empty, approved: 1, prizes: 1 } }), day({ cortesia: { ...empty, delivered: 1, prizes: 1 } })]);
  assert.deepEqual(rows, [{ rewardId: "cortesia", numbers: { ...empty, approved: 1, delivered: 1, prizes: 2 } }]);
});
