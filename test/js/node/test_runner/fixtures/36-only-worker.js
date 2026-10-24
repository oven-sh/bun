// Bun only: a Worker cannot declare a test, with or without --test-only.
const assert = require("node:assert");
const { test } = require("node:test");
const { Worker } = require("node:worker_threads");

test.only("a declaration in a Worker throws", async () => {
  const worker = new Worker(
    `
      const { parentPort } = require("node:worker_threads");
      const { test, it, describe, suite } = require("node:test");
      const shapes = {
        "test": () => test("a", () => {}),
        "test.only": () => test.only("a", () => {}),
        "test { only: false }": () => test("a", { only: false }, () => {}),
        "it { only: false }": () => it("a", { only: false }, () => {}),
        "test.skip": () => test.skip("a", () => {}),
        "describe": () => describe("a", () => {}),
        "describe.only": () => describe.only("a", () => {}),
        "describe { only: false }": () => describe("a", { only: false }, () => {}),
        "describe.skip": () => describe.skip("a", () => {}),
        "describe { skip: true }": () => describe("a", { skip: true }, () => {}),
        "suite.skip": () => suite.skip("a", () => {}),
      };
      const returned = [];
      for (const shape in shapes) {
        try {
          shapes[shape]();
          returned.push(shape);
        } catch {}
      }
      parentPort.postMessage(returned);
    `,
    { eval: true },
  );
  const returned = await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  assert.deepStrictEqual(returned, []);
});
