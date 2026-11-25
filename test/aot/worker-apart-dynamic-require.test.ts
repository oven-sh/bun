import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// As threads.js has it: a Worker starts from a file of the project under a path that is put together at run time, so the build does not hold that file, and the file
// requires a file of a package that the build does hold. Beside it the program loads by a name that the build does not know, and a test file evaluates a text.
const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/pool/package.json": `{ "name": "pool", "main": "index.js" }`,
  "node_modules/pool/index.js": `const { Worker } = require("node:worker_threads");
exports.expose = require("./expose.js").expose;
exports.startFile = (folder, name) => new Worker([folder, name].join("/"));
exports.load = name => require(name);
exports.separator = exports.load("node:path").sep;
`,
  "node_modules/pool/expose.js": `exports.expose = job => require("node:worker_threads").parentPort.postMessage("exposed " + job(2, 3));\n`,
  "exposes.cjs": `const { expose } = require("pool/expose.js");\nexpose((a, b) => a + b);\n`,
  "a.test.js": `import { test } from "bun:test";
import { startFile } from "pool";
test("asks", async () => {
  const worker = startFile(import.meta.dir, "exposes.cjs");
  const got = await new Promise(done => {
    worker.on("message", done);
    worker.on("error", error => done("error: " + String(error.message).slice(0, 11)));
  });
  await worker.terminate();
  console.log("SEEN", got, new Function(process.env.NO_SUCH_NAME || "return 1")());
});
`,
};
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN"));

test.each([[["test"]], [["test", "--aot"]]])("bun %j", async command => {
  using dir = tempDir("aot-worker-apart-dynamic-require", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), ...command], String(dir), bunEnv);
  expect({ seen: seenIn(stdout + stderr), exitCode }).toEqual({ seen: ["SEEN exposed 5 1"], exitCode: 0 });
});
