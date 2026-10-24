// Bun only: a Worker cannot declare a test, with or without --test-only. The Worker runs this file.
const assert = require("node:assert");
const { test, it, describe, suite } = require("node:test");
const { Worker, isMainThread, parentPort } = require("node:worker_threads");

if (isMainThread) {
  test.only("a declaration in a Worker throws the error of bun:test", async () => {
    const worker = new Worker(__filename);
    const thrown = await new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    assert.deepStrictEqual(thrown, {
      "test": "Cannot use test in a Worker.",
      "test.only": "Cannot use test in a Worker.",
      "test { only: false }": "Cannot use test in a Worker.",
      "it { only: false }": "Cannot use test in a Worker.",
      "test.skip": "Cannot use test.skip in a Worker.",
      "describe": "Cannot use describe in a Worker.",
      "describe.only": "Cannot use describe in a Worker.",
      "describe { only: false }": "Cannot use describe in a Worker.",
      "describe.skip": "Cannot use describe.skip in a Worker.",
      "describe { skip: true }": "Cannot use describe.skip in a Worker.",
      "suite.skip": "Cannot use describe.skip in a Worker.",
    });
  });
} else {
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
  const thrown = {};
  for (const shape in shapes) {
    try {
      shapes[shape]();
      thrown[shape] = "returned";
    } catch (err) {
      thrown[shape] = err.message;
    }
  }
  parentPort.postMessage(thrown);
}
