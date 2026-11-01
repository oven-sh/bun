import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

// As esbuild's lib/main.js has it: the module lies in a variable that is assigned in a try, and the function that starts the Worker is handed it.
const startsItself = (name: string) => `var threads;
try {
  threads = require("node:worker_threads");
} catch {
  threads = void 0;
}
var startWith = (given, data) => new given.Worker(__filename, { workerData: data });
if (threads.isMainThread) {
  exports.start = () => startWith(threads, { name: ${JSON.stringify(name)} });
  // The caller's thread sleeps until the Worker has answered, so nobody looks at an error event.
  exports.wait = () => {
    const word = new Int32Array(new SharedArrayBuffer(4));
    const worker = startWith(threads, { word });
    const status = Atomics.wait(word, 0, 0, 20000);
    worker.terminate();
    return status === "timed-out" ? status : "woken";
  };
} else if (threads.workerData.word) {
  Atomics.store(threads.workerData.word, 0, 1);
  Atomics.notify(threads.workerData.word, 0);
} else {
  threads.parentPort.postMessage("answers from " + threads.workerData.name);
}
`;
const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
  "node_modules/pkg/index.js": startsItself("pkg"),
  "src/own.cjs": startsItself("own"),
  "all.cjs": `const all = { pkg: require("pkg"), own: require("./src/own.cjs") };
exports.askAll = async function askAll() {
  for (const name in all) {
    const worker = all[name].start();
    const got = await new Promise(done => {
      worker.on("message", done);
      worker.on("error", () => done("error"));
    });
    await worker.terminate();
    console.log("SEEN", name, got, "|", all[name].wait());
  }
};
`,
  "main.cjs": `require("./all.cjs").askAll().then(() => process.exit(0));\n`,
  "a.test.js": `import { test } from "bun:test";\nimport { askAll } from "./all.cjs";\ntest("each answers", askAll, 60000);\n`,
};
const answers = ["pkg", "own"].map(name => `SEEN ${name} answers from ${name} | woken`);
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN"));

test("in an executable whose sources are moved away", async () => {
  using dir = tempDir("aot-worker-module-by-parameter", files);
  const cwd = String(dir);
  expect(seenIn((await run([bunExe(), "run", "main.cjs"], cwd, bunEnv)).stdout)).toEqual(answers);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "compiled"], cwd, bunEnv);
  expect({ exitCode: built.exitCode, said: built.exitCode ? built.stdout + built.stderr : "" }).toEqual({
    exitCode: 0,
    said: "",
  });
  renameSync(join(cwd, "node_modules"), join(cwd, "moved-away"));
  renameSync(join(cwd, "src"), join(cwd, "moved-away-too"));
  expect(seenIn((await run([join(cwd, "compiled")], cwd, bunEnv)).stdout)).toEqual(answers);
});

test.each([[["test"]], [["test", "--aot"]]])("in a test run: bun %j", async command => {
  using dir = tempDir("aot-worker-module-by-parameter", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), ...command], String(dir), bunEnv);
  expect({ seen: seenIn(stdout + stderr), exitCode }).toEqual({ seen: answers, exitCode: 0 });
});
