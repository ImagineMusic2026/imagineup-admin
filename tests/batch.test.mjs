import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const { batchSummaryText, runSequential } = await import("@/lib/batch");

test("uma chamada por vez, na ordem, com o resumo de feitos, já assim e falhas", async () => {
  const calls = [];
  const progress = [];
  let running = 0;
  const summary = await runSequential(
    ["a", "b", "c", "d"],
    async (item) => {
      running += 1;
      assert.equal(running, 1, "duas chamadas ao mesmo tempo");
      calls.push(item);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      if (item === "b") return "unchanged";
      if (item === "c") throw new Error("falhou");
      return "done";
    },
    { onProgress: (step) => progress.push(step.attempted) },
  );
  assert.deepEqual(calls, ["a", "b", "c", "d"]);
  assert.deepEqual(progress, [1, 2, 3, 4]);
  assert.equal(summary.done, 2);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.failures[0].item, "c");
  assert.equal(summary.stopped, false);
  assert.equal(batchSummaryText(summary, "recusados"), "2 recusados, 1 já estava assim e 1 falhou.");
});

test("para no erro que não adianta repetir e quando a pessoa pede", async () => {
  const configChanged = Object.assign(new Error("mudou"), { details: { reason: "config-changed" } });
  const stoppedByError = await runSequential(
    [1, 2, 3],
    async (item) => {
      if (item === 2) throw configChanged;
      return "done";
    },
    { stopOn: (error) => error === configChanged },
  );
  assert.equal(stoppedByError.attempted, 2);
  assert.equal(stoppedByError.stopped, true);
  assert.equal(stoppedByError.stopError, configChanged);
  assert.equal(batchSummaryText(stoppedByError, "arquivadas"), "1 arquivadas e 1 falhou. Parou antes do fim: 1 ficou sem tentar.");

  let stop = false;
  const stoppedByPerson = await runSequential(
    [1, 2, 3, 4],
    async (item) => {
      if (item === 2) stop = true;
      return "done";
    },
    { shouldStop: () => stop },
  );
  assert.equal(stoppedByPerson.done, 2);
  assert.equal(stoppedByPerson.stopped, true);
  assert.equal(batchSummaryText(stoppedByPerson, "ocultos"), "2 ocultos. Parou antes do fim: 2 ficaram sem tentar.");
});
