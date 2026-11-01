import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// As piscina has it: a package starts a Worker from a file of its own that nothing imports, so the build does not hold it, and that file loads a module of the project
// by the path it is sent. The build holds that module as the file of a Worker.
const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/pool/package.json": `{ "name": "pool", "main": "index.js" }`,
  "node_modules/pool/index.js": `const { Worker } = require("node:worker_threads");
exports.runIn = filename => new Worker(require("node:path").join(__dirname, "runner.js"), { workerData: filename });
`,
  "node_modules/pool/runner.js": `const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const required = require(workerData);
  const imported = await import(workerData);
  parentPort.postMessage([typeof required.default, typeof imported.default, imported.second, String(globalThis.bodyRan)].join(" "));
})();
`,
  "job.mjs": `globalThis.bodyRan = (globalThis.bodyRan ?? 0) + 1;\nexport default (a, b) => a + b;\nexport const second = 2;\n`,
  "a.test.js": `import { test } from "bun:test";
import { runIn } from "pool";
test("asks", async () => {
  const worker = runIn(import.meta.dir + "/job.mjs");
  const got = await new Promise(done => {
    worker.on("message", done);
    worker.on("error", error => done("error: " + String(error.message).slice(0, 60)));
  });
  await worker.terminate();
  console.log("SEEN", got);
});
export const neverCalled = () => new Worker(new URL("./job.mjs", import.meta.url));
`,
};
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN"));

test.each([[["test"]], [["test", "--aot"]]])("bun %j", async command => {
  using dir = tempDir("aot-worker-apart-loads-entry", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), ...command], String(dir), bunEnv);
  expect({ seen: seenIn(stdout + stderr), exitCode }).toEqual({ seen: ["SEEN function function 2 1"], exitCode: 0 });
});
