import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const prep = await import("@/lib/image-prep");

test("recorte no centro numa proporção fixa", () => {
  // 3:4 numa foto deitada perde as laterais.
  assert.deepEqual(prep.centeredCrop(4000, 3000, 3 / 4), { x: 875, y: 0, width: 2250, height: 3000 });
  // 1200:643 numa foto em pé perde em cima e embaixo.
  assert.deepEqual(prep.centeredCrop(1000, 2000, 1200 / 643), { x: 0, y: 732, width: 1000, height: 536 });
});

test("faixa de proporções: dentro dela a imagem fica inteira; fora, vai até a borda mais perto", () => {
  const range = { min: 4 / 5, max: 16 / 9 };
  assert.deepEqual(prep.cropForSpec(1200, 1200, { aspectRange: range }), { x: 0, y: 0, width: 1200, height: 1200 });
  // Alta demais (9:16) vira 4:5.
  assert.deepEqual(prep.cropForSpec(900, 1600, { aspectRange: range }), { x: 0, y: 237, width: 900, height: 1125 });
  // Larga demais (3:1) vira 16:9.
  assert.deepEqual(prep.cropForSpec(3000, 1000, { aspectRange: range }), { x: 611, y: 0, width: 1778, height: 1000 });
  // Proporção fixa ganha da faixa.
  assert.equal(prep.cropForSpec(1600, 900, { aspect: 3 / 4, aspectRange: range }).width, 675);
});

test("tamanho de saída: exato com proporção fixa, no máximo com faixa", () => {
  assert.deepEqual(prep.outputSize({ width: 2250, height: 3000 }, 1200, true), { width: 1200, height: 1600 });
  assert.deepEqual(prep.outputSize({ width: 600, height: 800 }, 1200, true), { width: 1200, height: 1600 });
  assert.deepEqual(prep.outputSize({ width: 800, height: 1000 }, 1080, false), { width: 800, height: 1000 });
  assert.deepEqual(prep.outputSize({ width: 2160, height: 2700 }, 1080, false), { width: 1080, height: 1350 });
  assert.equal(prep.isSmallImage({ width: 599, height: 800 }, { large: 1200 }), true);
  assert.equal(prep.isSmallImage({ width: 600, height: 800 }, { large: 1200 }), false);
  assert.equal(prep.isSmallImage({ width: 700, height: 800 }, { large: 1080, minWidth: 720 }), true);
});

test("arquivos aceitos e recusados antes de abrir", () => {
  assert.equal(prep.imageFileProblem({ type: "image/jpeg", name: "a.jpg", size: 10 }), null);
  assert.equal(prep.imageFileProblem({ type: "", name: "a.webp", size: 10 }), null);
  assert.match(prep.imageFileProblem({ type: "image/heic", name: "a.heic", size: 10 }), /HEIC/);
  assert.match(prep.imageFileProblem({ type: "image/gif", name: "a.gif", size: 10 }), /JPG, PNG ou WebP/);
  assert.match(prep.imageFileProblem({ type: "image/png", name: "a.png", size: 0 }), /vazio/);
  assert.match(prep.imageFileProblem({ type: "image/png", name: "a.png", size: 26 * 1024 * 1024 }), /25 MB/);
});
