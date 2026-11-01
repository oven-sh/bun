// `bun test` gives the names of the test runner to what its own realm loads. A Worker has a realm of its own, which has none of them,
// whoever names the file of the Worker and whatever else loads that file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

const says = `[
  [typeof expect, typeof jest, typeof test, typeof describe, typeof it, typeof beforeAll, typeof vi, typeof xtest].join(" "),
  (() => { try { return typeof expect(1).toBe; } catch (error) { return error.name; } })(),
].join(" | ")`;
const answerOf = `worker => new Promise(done => {
  worker.onmessage = event => done(event.data);
  worker.on?.("message", done);
})`;
const files = {
  "package.json": `{ "name": "p" }`,
  "helper/index.cjs": `const { Worker } = require("node:worker_threads");
exports.start = () => new Worker(require("node:path").join(__dirname, "by-helper.cjs"));
exports.says = () => ${says};
`,
  "helper/by-helper.cjs": `require("node:worker_threads").parentPort.postMessage(${says});\n`,
  "by-test.js": `postMessage(${says});\n`,
  "both.js": `export const says = () => ${says};\nif (!Bun.isMainThread) postMessage(says());\n`,
  // A binding of the file's own goes before the name of the runner, in either realm.
  "own-binding.js": `import { expect } from "./stand-in.js";
const describe = 1;
export const says = () => [typeof expect, typeof describe, (jest => typeof jest)(true), typeof test].join(" ");
if (!Bun.isMainThread) postMessage(says());
`,
  "stand-in.js": `export const expect = "of the project";\n`,
  // So does what the realm itself puts on its global object, where the realm has no name of the runner.
  "stores.cjs": `globalThis.expect = "stored";
globalThis.vi = 5;
exports.says = () => [typeof expect, typeof vi, typeof globalThis.expect, typeof jest].join(" ");
if (!Bun.isMainThread) postMessage(exports.says());
`,
  "a.test.js": `import { start, says as helperSays } from "./helper/index.cjs";
import { says as bothSay } from "./both.js";
import { says as ownBindingSays } from "./own-binding.js";
test("each realm", async () => {
  console.log("SEEN the test file:", ${says});
  console.log("SEEN a helper, loaded by the tests:", helperSays());
  console.log("SEEN a file of both, loaded by the tests:", bothSay());
  console.log("SEEN a file with bindings of its own, loaded by the tests:", ownBindingSays());
  const workers = {
    "a helper names the file": start,
    "the test file names the file": () => new Worker(new URL("./by-test.js", import.meta.url)),
    "a file of both": () => new Worker(new URL("./both.js", import.meta.url)),
    "a file with bindings of its own": () => new Worker(new URL("./own-binding.js", import.meta.url)),
    "a file that stores the names": () => new Worker(new URL("./stores.cjs", import.meta.url)),
  };
  for (const [name, make] of Object.entries(workers)) {
    const worker = make();
    console.log("SEEN " + name + ", in the Worker:", await (${answerOf})(worker));
    await worker.terminate();
  }
  console.log("SEEN a file that stores the names, loaded by the tests:", require("./stores.cjs").says());
});
`,
  "itself.test.js": `if (Bun.isMainThread) {
  test("a test file that starts itself", async () => {
    const worker = new Worker(import.meta.url);
    console.log("SEEN the test file itself, in the Worker:", await (${answerOf})(worker));
    await worker.terminate();
  });
} else postMessage(${says});
`,
};
const loadsUnknownName = {
  "nothing.js": ``,
  "unknown.test.js": `test("a name that nobody spells", async () => {
  await import(process.env.NAME_THAT_NOBODY_SPELLS ?? "./nothing.js");
});
`,
};

async function see(cwd: string, flags: string[], words: string) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], cwd, env);
  const seen = (stdout + stderr).split("\n").filter(line => line.startsWith("SEEN "));
  return { seen: seen.sort(), exitCode };
}

for (const [name, further] of [
  ["every name is spelled", {}],
  ["a test file loads a name that nobody spells", loadsUnknownName],
] as const) {
  test.each(["TestRunLayers:0", "TestRunLayers:2", "TestRunLayers:3"])(
    `${name}: %s`,
    async words => {
      using dir = tempDir("aot-worker-realm-names", { ...files, ...further });
      const plain = await see(String(dir), [], "");
      expect(plain.seen.length).toBe(11);
      expect(await see(String(dir), ["--aot"], words)).toEqual(plain);
    },
    240_000,
  );
}
