import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A test file writes `new URL("./src/worker/w1.ts", import.meta.url)`, and the `new Worker(entry)` that gets it stands somewhere else: behind a constructor or
// a method, in a field or in an options object, behind `require()`, or in a package. The build follows `entry` back to the URL and compiles the file.
// In a test run a file that nobody compiled runs from its text, in the interpreter, with the right answer, so nobody notices.
// An executable tells: the sources are moved away before it runs, and a Worker without its file never answers.
const url = (n: number) => `new URL("./src/worker/w${n}.ts", import.meta.url)`;
const written: [string, (url: string) => string][] = [
  ["a constructor", url => `new Pool(${url}).ask()`],
  ["a static method", url => `Pool.start(${url})`],
  ["a method of an instance", url => `idle.start(${url})`],
  ["a method of an instance that a function answers with", url => `makeIdle().start(${url})`],
  ["a constructor that keeps the file in a field", url => `new Lazy(${url}).ask()`],
  ["a parameter property", url => `new Kept(${url}).ask()`],
  ["a private field", url => `new Hidden(${url}).ask()`],
  ["a class without a constructor under the class", url => `new Smaller(${url}).ask()`],
  ["super()", url => `new Named("n", ${url}).ask()`],
  ["a method of an object", url => `starter.start(${url})`],
  ["an arrow in an object", url => `starter.begin(${url})`],
  ["a property of an options object", url => `new Configured({ filename: ${url}, threads: 1 }).ask()`],
  ["a property that a pattern takes out of a parameter", url => `startNamed({ entry: ${url} })`],
  ["a class that is the default export", url => `new PoolByDefault(${url}).ask()`],
  ["a class through export * from", url => `new barrel.Pool(${url}).ask()`],
  ["a field that is set later", url => `setLater(${url})`],
  ["exports.name, read off what require() answers", url => `required.start(${url})`],
  ["exports.name, taken out of what require() answers", url => `startRequired(${url})`],
  ["module.exports = { name }", url => `requiredObject.start(${url})`],
  ["module.exports = function", url => `startWhole(${url})`],
  ["module.exports = class", url => `new RequiredPool(${url}).ask()`],
  ["require() of a file that says export", url => `requiredModule.start(${url})`],
  ["the project requires the function", url => `beginByRequire(${url})`],
  ["a function of a package", url => `startOfPackage(${url})`],
  ["a class of a package", url => `new PoolOfPackage(${url}).ask()`],
  ["a class of a package that takes options", url => `new ConfiguredOfPackage({ filename: ${url}.href }).ask()`],
  ["a function of a package that says require()", url => `packageOfOldKind.start(${url})`],
];
const ways = written.map(([name, write], index) => [name, write(url(index + 1))]);
const count = ways.length;

const ask = `const ask = (worker) => new Promise(resolve => { worker.onmessage = event => { resolve(event.data); worker.terminate(); }; worker.postMessage(21); });\n`;
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "src/worker/helper.ts": `export const double = (n: number): number => n * 2;\n`,
  "src/ask.ts": `export const ask = (worker: Worker): Promise<string> => new Promise(resolve => { worker.onmessage = event => { resolve(event.data); worker.terminate(); }; worker.postMessage(21); });\n`,
  "src/pool.ts": `import { ask } from "./ask";
export class Pool {
  worker: Worker;
  constructor(entry: URL) { this.worker = new Worker(entry); }
  ask() { return ask(this.worker); }
  static start(entry: URL) { return ask(new Worker(entry)); }
}
export class Idle {
  start(entry: URL) { return ask(new Worker(entry)); }
}
export const makeIdle = () => new Idle();
export class Lazy {
  entry: URL;
  constructor(entry: URL) { this.entry = entry; }
  ask() { return ask(new Worker(this.entry)); }
}
export class Kept {
  constructor(private readonly file: URL) {}
  ask() { return ask(new Worker(this.file)); }
}
export class Hidden {
  #file: URL;
  constructor(file: URL) { this.#file = file; }
  ask() { return ask(new Worker(this.#file)); }
}
export class Smaller extends Pool {}
export class Named extends Pool {
  constructor(public name: string, entry: URL) { super(entry); }
}
export const starter = {
  start(entry: URL) { return ask(new Worker(entry)); },
  begin: (entry: URL) => ask(new Worker(entry)),
};
export class Configured {
  constructor(private options: { filename: URL; threads: number }) {}
  ask() { return ask(new Worker(this.options.filename)); }
}
export const startNamed = ({ entry }: { entry: URL }) => ask(new Worker(entry));
export class Late {
  script?: URL;
  ask() { return ask(new Worker(this.script!)); }
}
`,
  "src/pool-by-default.ts": `import { ask } from "./ask";
export default class {
  worker: Worker;
  constructor(entry: URL) { this.worker = new Worker(entry); }
  ask() { return ask(this.worker); }
}
`,
  "src/barrel/index.ts": `export * from "../pool";\n`,
  "src/old/names.cjs": `${ask}exports.start = function (entry) { return ask(new Worker(entry)); };\n`,
  "src/old/object.cjs": `${ask}function start(entry) { return ask(new Worker(entry)); }\nmodule.exports = { start };\n`,
  "src/old/whole.cjs": `${ask}module.exports = function (entry) { return ask(new Worker(entry)); };\n`,
  "src/old/class.cjs": `${ask}module.exports = class { constructor(entry) { this.worker = new Worker(entry); } ask() { return ask(this.worker); } };\n`,
  "src/spawn.ts": `import { ask } from "./ask";\nexport const start = (entry: URL) => ask(new Worker(entry));\n`,
  "src/wrap.cjs": `const { start } = require("./old/names.cjs");\nexports.beginByRequire = entry => start(entry);\n`,
  "node_modules/starts-workers/package.json": `{ "name": "starts-workers", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/starts-workers/index.js": `${ask}export const start = entry => ask(new Worker(entry));
export class Pool {
  constructor(entry) { this.worker = new Worker(entry); }
  ask() { return ask(this.worker); }
}
export class Configured {
  constructor(options) { this.options = { threads: 1, ...options }; }
  ask() { return ask(new Worker(this.options.filename)); }
}
// What the package names itself is its own business: most programs never start it.
export const startOwn = () => ask(new Worker(new URL("./own-worker.js", import.meta.url)));
`,
  "node_modules/starts-workers/own-worker.js": `self.onmessage = event => { self.postMessage("own " + event.data); };\n`,
  "node_modules/starts-workers-of-old/package.json": `{ "name": "starts-workers-of-old", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/starts-workers-of-old/index.js": `${ask}exports.start = entry => ask(new Worker(entry));\n`,
  // Most URLs of code files that tests write are there to read a source. No Worker starts from them, so no build takes them in.
  "src/read.ts": `import { readFileSync } from "node:fs";
export const read = (file: URL) => readFileSync(file, "utf8").length;
export class Reader {
  constructor(public source: URL) {}
  read() { return read(this.source); }
}
// ./pool starts a Worker from what it reads under \`filename\`, whichever object has it, and this file gets to ./pool. That this object is meant is a guess.
// That whoever stores under \`source\` has a Worker in mind would be a guess upon that one: two names on, most of a large program stores under one of them.
export { makeIdle as makeIdleToo } from "./pool";
export const describe = (reader: { source: URL }) => ({ filename: reader.source });
`,
  // This file gets to no file that starts a Worker, so its object is its own business.
  "src/listing.ts": `export const listed = { filename: new URL("./only-read.ts", import.meta.url) };\n`,
  "src/only-read.ts": `export const never = "run";\n`,
};

const imports = `import { Configured, Hidden, Idle, Kept, Late, Lazy, makeIdle, Named, Pool, Smaller, starter, startNamed } from "./src/pool";
import PoolByDefault from "./src/pool-by-default";
import * as barrel from "./src/barrel";
import { describe, read, Reader } from "./src/read";
import { listed } from "./src/listing";
import { start as startOfPackage, Pool as PoolOfPackage, Configured as ConfiguredOfPackage } from "starts-workers";
const required = require("./src/old/names.cjs");
const { start: startRequired } = require("./src/old/names.cjs");
const requiredObject = require("./src/old/object.cjs");
const startWhole = require("./src/old/whole.cjs");
const RequiredPool = require("./src/old/class.cjs");
const requiredModule = require("./src/spawn");
const { beginByRequire } = require("./src/wrap.cjs");
const packageOfOldKind = require("starts-workers-of-old");
const idle = new Idle();
const setLater = (file: URL) => { const late = new Late(); late.script = file; return late.ask(); };
`;

const testFiles: Record<string, string> = {
  "workers.test.ts":
    `import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
${imports}test("the Workers answer", async () => {
  // A file that was compiled answers with what it said when the build read it.
  for (let n = 1; process.env.WRITES_OVER_WORKERS && n <= ${count}; n++) {
    const file = new URL("./src/worker/w" + n + ".ts", import.meta.url);
    writeFileSync(file, readFileSync(file, "utf8").replace('"w' + n + ' "', '"from disk "'));
  }
` +
    ways
      .map(([name, code]) => `  console.log("SEEN " + ${JSON.stringify(name)} + " | " + (await ${code}));\n`)
      .join("") +
    `  expect(read(new URL("./src/only-read.ts", import.meta.url))).toBeGreaterThan(0);
  expect(new Reader(new URL("./src/only-read.ts", import.meta.url)).read()).toBeGreaterThan(0);
  expect(read(describe(new Reader(new URL("./src/only-read.ts", import.meta.url))).filename)).toBeGreaterThan(0);
  expect(read(listed.filename)).toBeGreaterThan(0);
});
`,
  "other.test.ts": `import { expect, test } from "bun:test";\ntest("another file", () => { expect(1).toBe(1); });\n`,
};
for (let n = 1; n <= count; n++) {
  files[`src/worker/w${n}.ts`] = `import { double } from "./helper";
declare var self: any;
self.onmessage = (event: any) => { self.postMessage("w${n} " + double(event.data)); };
`;
}

const asWritten = ways.map(([name], index) => `SEEN ${name} | w${index + 1} 42`);

async function see(flags: string[], env: Record<string, string>) {
  using dir = tempDir("aot-worker-behind-a-class-require-or-a-package", { ...files, ...testFiles });
  const ran = await run([bunExe(), "test", ...flags, "--isolate"], String(dir), { ...bunEnv, ...env });
  return {
    seen: ran.stdout.split("\n").filter(line => line.startsWith("SEEN ")),
    taken: [
      ...ran.stderr.matchAll(
        /^AOT (?:files are loaded again|load goes on) \| with (\d+) more files that Workers start from$/gm,
      ),
    ].map(match => Number(match[1])),
    exitCode: ran.exitCode,
  };
}

// Over layers the class, the required function and the package lie in programs below the test file, whose builds don't see it.
for (const words of ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1", "TestRunLayers:3,TestRunPartFiles:1"]) {
  test(`each Worker answers as under plain bun test, and runs compiled (${words})`, async () => {
    const plain = await see([], {});
    expect(plain).toEqual({ seen: asWritten, taken: [], exitCode: 0 });
    expect(await see(["--aot"], { BUN_DEBUG_TEST_AOT_WORDS: words })).toEqual(plain);
    const env = { BUN_DEBUG_TEST_AOT_WORDS: words, WRITES_OVER_WORKERS: "1", BUN_JSC_logAOTPhaseTimes: "1" };
    expect(await see(["--aot"], env)).toEqual({ ...plain, taken: [count] });
  }, 240_000);
}

test("the file of each Worker is in the executable", async () => {
  const main =
    imports +
    `const say = async (name: string, ask: () => Promise<string>) => console.log("SEEN " + name + " | " + (await Promise.race([ask(), new Promise<string>(r => setTimeout(() => r("no answer"), 5000))])));
` +
    ways.map(([name, code]) => `await say(${JSON.stringify(name)}, () => ${code});\n`).join("") +
    `console.log("SEEN " + typeof read + " " + typeof Reader);\nprocess.exit(0);\n`;
  using dir = tempDir("aot-worker-behind-a-class-require-or-a-package", { ...files, "main.ts": main });
  const seenBy = async (...command: string[]) => {
    const { stdout, stderr, exitCode } = await run(command, String(dir), bunEnv);
    return {
      seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")),
      stderr: exitCode ? stderr : "",
      exitCode,
    };
  };
  const plain = await seenBy(bunExe(), "main.ts");
  expect(plain.seen).toEqual([...asWritten, "SEEN function function"]);
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  expect(await seenBy(bunExe(), "build", "--compile", "--aot", "--outfile", executable, "main.ts")).toEqual({
    seen: [],
    stderr: "",
    exitCode: 0,
  });
  renameSync(join(String(dir), "src"), join(String(dir), "moved-away"));
  renameSync(join(String(dir), "node_modules"), join(String(dir), "moved-away-too"));
  expect(await seenBy(executable)).toEqual(plain);
}, 240_000);
