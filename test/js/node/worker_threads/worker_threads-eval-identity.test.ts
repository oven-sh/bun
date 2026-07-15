import { test, expect } from "bun:test";
import { Worker } from "node:worker_threads";

test("eval worker __filename/__dirname match node's '[worker eval]' / '.'", async () => {
  const code = `
    const { parentPort } = require("node:worker_threads");
    parentPort.postMessage({ f: __filename, d: __dirname, a1: process.argv[1] });
  `;
  const run = () =>
    new Promise((resolve, reject) => {
      const w = new Worker(code, { eval: true });
      w.on("message", m => {
        w.terminate().then(() => resolve(m), reject);
      });
      w.on("error", reject);
    });
  const [r1, r2] = await Promise.all([run(), run()]);
  expect(r1).toEqual({ f: "[worker eval]", d: ".", a1: "[worker eval]" });
  expect(r2).toEqual(r1);
});
