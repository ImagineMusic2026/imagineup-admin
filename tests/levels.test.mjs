import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const levels = await import("@/lib/levels");

const RULER = [
  { number: 1, name: "Primeiro passo", minXp: 0 },
  { number: 2, name: "Na roda", minXp: 600 },
  { number: 3, name: "Pé de serra", minXp: 1500 },
];

test("a régua só vale gravada (versão 1 em diante) e no formato", () => {
  assert.equal(levels.parseLevels(null), null);
  assert.equal(levels.parseLevels(undefined), null);
  assert.equal(levels.parseLevels({ version: 0, levels: RULER }), null);
  assert.deepEqual(levels.parseLevels({ version: 1, levels: RULER }), RULER);
  // Fora do formato: número pulado, mínimo que não sobe, primeiro fora do zero, um degrau só.
  assert.equal(levels.parseLevels({ version: 2, levels: [RULER[0], { ...RULER[2], number: 3 }] }), null);
  assert.equal(levels.parseLevels({ version: 2, levels: [RULER[0], { ...RULER[1], minXp: 0 }] }), null);
  assert.equal(levels.parseLevels({ version: 2, levels: [{ ...RULER[0], minXp: 5 }, RULER[1]] }), null);
  assert.equal(levels.parseLevels({ version: 2, levels: [RULER[0]] }), null);
});

test("o nível é o degrau mais alto alcançado, com o que falta para o seguinte", () => {
  assert.deepEqual(levels.levelOf(0, RULER), { ...RULER[0], next: RULER[1], toNext: 600 });
  assert.deepEqual(levels.levelOf(599, RULER), { ...RULER[0], next: RULER[1], toNext: 1 });
  assert.deepEqual(levels.levelOf(600, RULER), { ...RULER[1], next: RULER[2], toNext: 900 });
  assert.deepEqual(levels.levelOf(99999, RULER), { ...RULER[2], next: null, toNext: null });
  assert.equal(levels.levelLabel(RULER[1]), "Nível 2 · Na roda");
  assert.throws(() => levels.levelOf(10, []));
});
