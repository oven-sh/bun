import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Only the lowest layer holds modules of Bun's own code, and it is built before anybody has read the test files. What it lacks would run in the interpreter.
const how = `const how = (f) => (typeof f !== "function" ? typeof f : /\\[native code\\]/.test(Function.prototype.toString.call(f)) ? "compiled" : "TEXT");`;
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/fake/package.json": `{ "name": "fake", "main": "index.js" }`,
  "node_modules/fake/index.js": `exports.join = require("node:path").join;\n`,
  "helpers/hash.js": `import { createHash } from "node:crypto";\nexport const hash = text => createHash("sha1").update(text).digest("hex").slice(0, 8);\nexport { createHash };\n`,
  "named.test.js": `import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { gzipSync, gunzipSync } from "node:zlib";
import { strictEqual } from "node:assert";
import { parse } from "node:querystring";
import { join } from "fake";
import { hash, createHash } from "./helpers/hash.js";
${how}
test("modules that a test file and a helper import", () => {
  console.log("SEEN named | " + [createServer, gzipSync, strictEqual, parse, join, createHash].map(how));
  console.log("SEEN named answers | " + [String(gunzipSync(gzipSync("text"))), JSON.stringify(parse("a=1&b=2")), join("a", "b"), hash("x")]);
  expect(1).toBe(1);
});
`,
  "joined.test.js": `import { expect, test } from "bun:test";
${how}
test("modules under names that a test file joins", () => {
  const load = name => require(["node", name].join(":"));
  console.log("SEEN joined | " + [load("child_process").spawn, load("readline").createInterface, load("tls").connect, load("dgram").createSocket, load("worker_threads").Worker].map(how));
  // Native code loads these modules, and no program can name them.
  console.log("SEEN unnamed | " + [Bun.sql, Bun.SQL, process.stdin.on, process.stdout.write].map(how));
  console.log("SEEN joined answers | " + [load("url").parse("http://a/b?c").pathname, load("string_decoder").StringDecoder.name, load("path/posix").basename("/a/b")]);
  expect(1).toBe(1);
});
`,
  // What the library stores only off the main thread (console, members of process) is written in the lowest layer, and the layers over it must not lock it.
  "worker.test.js": `import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
test("a Worker starts", async () => {
  const got = await new Promise(resolve => {
    const worker = new Worker('console.log("in the worker"); require("node:worker_threads").parentPort.postMessage([1, typeof process.umask()])', { eval: true, stdout: true });
    worker.on("message", resolve);
    worker.on("error", error => resolve("error: " + error.message));
  });
  console.log("SEEN worker answers | " + got);
  expect(1).toBe(1);
});
`,
};

async function seenIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-lowest-layer-holds-the-library", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  return {
    seen: stdout
      .split("\n")
      .filter(line => line.startsWith("SEEN "))
      .sort(),
    warnings: stderr.split("\n").filter(line => line.startsWith("warn: ") || line.startsWith("error: ")),
    exitCode,
  };
}

test("a module of the library is compiled whichever layer imports it first", async () => {
  const compiled = {
    seen: [
      "SEEN joined answers | /b,StringDecoder,b",
      "SEEN joined | compiled,compiled,compiled,compiled,compiled",
      `SEEN named answers | text,{"a":"1","b":"2"},a/b,11f6ad8e`,
      "SEEN named | compiled,compiled,compiled,compiled,compiled,compiled",
      "SEEN unnamed | compiled,compiled,compiled,compiled",
      "SEEN worker answers | 1,number",
    ],
    warnings: [],
    exitCode: 0,
  };
  const [plain, one, twoLayers, oneLayer] = await Promise.all([
    seenIn(undefined),
    seenIn(undefined, "--aot"),
    seenIn("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    seenIn("TestRunLayers:1,TestRunPartFiles:1", "--aot"),
  ]);
  const answers = (seen: string[]) => seen.filter(line => line.includes("answers"));
  expect(answers(plain.seen)).toEqual(answers(compiled.seen));
  expect(one).toEqual(compiled);
  expect(twoLayers).toEqual(compiled);
  expect(oneLayer).toEqual(compiled);
}, 240_000);
