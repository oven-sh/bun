import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A Bun that is built with `--compiledLibrary=on` holds its own JavaScript compiled, and a run in layers stands on that in place of compiling it again.
// That code was compiled before anybody knew the run, so it has to see whatever the files of a run replace.
const how = `const how = (f) => (typeof f !== "function" ? typeof f : /\\[native code\\]/.test(Function.prototype.toString.call(f)) ? "compiled" : "TEXT");`;
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/fake/package.json": `{ "name": "fake", "main": "index.js" }`,
  "node_modules/fake/index.js": `const { EventEmitter } = require("node:events");\nexports.join = require("node:path").join;\nexports.counter = () => console.count;\nexports.heard = () => { const heard = []; const emitter = new EventEmitter(); emitter.on("a", value => heard.push(value)); emitter.emit("a", 1); return heard; };\n`,
  "src/stamp.ts": `import fs from "node:fs";\nexport const stamp = (): number => (fs as any)._toUnixTimestamp(-1);\n`,
  "modules.test.js": `import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { gzipSync, gunzipSync } from "node:zlib";
import { join, heard } from "fake";
${how}
test("modules of the library", () => {
  const load = name => require(["node", name].join(":"));
  console.log("SEEN compiled | " + [createServer, gzipSync, join, load("readline").createInterface, Bun.sql, process.stdin.on].map(how));
  console.log("SEEN answers | " + [String(gunzipSync(gzipSync("text"))), join("a", "b"), heard(), load("url").parse("http://a/b?c").pathname]);
  expect(1).toBe(1);
});
`,
  "mock.test.js": `import { mock, test } from "bun:test";
function mocked() { return "mocked"; }
test("a mock of a module of the library", async () => {
  mock.module("node:dns", () => ({ getDefaultResultOrder: mocked, default: { getDefaultResultOrder: mocked } }));
  const dns = await import("node:dns");
  console.log("SEEN mock | " + [dns.getDefaultResultOrder === mocked, dns.getDefaultResultOrder(), require("node:dns").getDefaultResultOrder()]);
});
`,
  "spies.test.ts": `import { expect, spyOn, test } from "bun:test";
import url from "node:url";
import { stamp } from "./src/stamp";
test("the library calls what a test puts in the place of a built-in function", () => {
  const now = spyOn(Date, "now").mockReturnValue(5000);
  console.log("SEEN Date.now | " + [stamp(), now.mock.calls.length]);
  now.mockRestore();
  const query = { b: 1 };
  const keys = spyOn(Object, "keys");
  const text = url.format({ protocol: "http", hostname: "a", query });
  console.log("SEEN Object.keys | " + [text, keys.mock.calls.some(call => call[0] === query)]);
  keys.mockRestore();
  expect(stamp()).toBeGreaterThan(5);
});
test("the library reads a name that a test adds to Object.prototype", () => {
  (Object.prototype as any).port = 81;
  try {
    console.log("SEEN Object.prototype.port | " + url.format({ protocol: "http", hostname: "a" }));
  } finally {
    delete (Object.prototype as any).port;
  }
  console.log("SEEN without it | " + url.format({ protocol: "http", hostname: "a" }));
});
`,
  "global.test.js": `import { test } from "bun:test";
import { execFile } from "node:child_process";
test("the library calls what a test puts in the place of a global function", async () => {
  const real = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (callback, delay) => { delays.push(delay); return { unref() { return this; } }; };
  try {
    await new Promise(resolve => execFile("true", [], { timeout: 54321 }, resolve));
  } finally {
    globalThis.setTimeout = real;
  }
  console.log("SEEN setTimeout | " + delays.includes(54321));
});
`,
  "src/counter.ts": `export const counter = () => console.count;\n`,
  "written.test.js": `import { test } from "bun:test";
import { createTracing } from "node:trace_events";
import * as ofPackage from "fake";
import * as own from "./src/counter";
test("node:trace_events replaces console.count", () => {
  const before = [ofPackage.counter(), own.counter()];
  const tracing = createTracing({ categories: ["node.console"] });
  tracing.enable();
  const after = [ofPackage.counter(), own.counter()];
  tracing.disable();
  console.log("SEEN written | " + [before[0] === before[1], after[0] === after[1], after[0] === before[0], after[0].name]);
});
`,
  "refused.test.js": `import { test } from "bun:test";
test("a name that no file of the run spells is not added to Object.prototype", () => {
  let answer = "stored";
  try { Object.prototype[process.env.NAME_THAT_NO_FILE_SPELLS] = 7; } catch (error) { answer = error.constructor.name; }
  delete Object.prototype[process.env.NAME_THAT_NO_FILE_SPELLS];
  console.log("LOCK | " + answer);
});
`,
  "worker.test.js": `import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
test("a Worker starts", async () => {
  const got = await new Promise(resolve => {
    const worker = new Worker('require("node:worker_threads").parentPort.postMessage([1, typeof process.umask(), require("node:path").join("a", "b")])', { eval: true });
    worker.on("message", resolve);
    worker.on("error", error => resolve("error: " + error.message));
  });
  console.log("SEEN worker | " + got);
  expect(1).toBe(1);
});
`,
};

async function seenIn(bun: string, words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-library-that-bun-holds", files);
  const env = { ...bunEnv, NAME_THAT_NO_FILE_SPELLS: "polluted", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bun, "test", "--isolate", ...flags], String(dir), env);
  const linesThatStartWith = (start: string) =>
    stdout
      .split("\n")
      .filter(line => line.startsWith(start))
      .sort();
  return {
    seen: linesThatStartWith("SEEN "),
    lock: linesThatStartWith("LOCK "),
    form: stderr.match(/^AOT test run \| (?:layers|one program|programs without layers)\b.*$/m)?.[0] ?? "",
    warnings: stderr.split("\n").filter(line => line.startsWith("warn: ") || line.startsWith("error: ")),
    exitCode,
  };
}

test.skipIf(!isLinux)(
  "a run in layers over the library that Bun holds answers as plain Bun does",
  async () => {
    using dir = tempDir("aot-bun-with-its-library", {});
    const bun = join(String(dir), "bun");
    copyFileSync(bunExe(), bun);
    const script = join(import.meta.dir, "..", "..", "scripts", "build", "embed-compiled-library.ts");
    const embedded = await run([bunExe(), script, bun], String(dir));
    // A Bun that was built with the option holds it already, and so does the copy.
    if (!embedded.stderr.includes("has a section .bun_library already")) {
      expect({ stderr: embedded.stderr, exitCode: embedded.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(embedded.stdout).toStartWith(".bun_library: ");
    }

    const [plain, twoLayers, oneLayer] = await Promise.all([
      seenIn(bun, undefined),
      seenIn(bun, "TestRunLayers:2,TestRunPartFiles:2", "--aot"),
      seenIn(bun, "TestRunLayers:1,TestRunPartFiles:2", "--aot"),
    ]);
    if (twoLayers.form.includes("this Bun loads one program a realm")) return;
    const compiled = "SEEN compiled | compiled,compiled,compiled,compiled,compiled,compiled";
    const withoutHow = (seen: string[]) => seen.filter(line => !line.startsWith("SEEN compiled"));
    const refusedIfItRuns =
      "warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable";
    expect(plain.exitCode).toBe(0);
    for (const layers of [twoLayers, oneLayer]) {
      expect(layers.form).toEndWith("| over Bun's own code as this Bun holds it");
      // The store and the deletion in refused.test.js.
      expect(layers.warnings).toEqual([refusedIfItRuns, refusedIfItRuns]);
      expect(layers.seen).toContain(compiled);
      expect(withoutHow(layers.seen)).toEqual(withoutHow(plain.seen));
      // The library rests on no lock that a run can open, and the run still has every lock that its own programs rest on.
      expect(layers.lock).toEqual(["LOCK | TypeError"]);
      expect(layers.exitCode).toBe(0);
    }
  },
  600_000,
);
