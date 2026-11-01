import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// A CommonJS file that the top loads, but not first: a function that the top calls has loaded it under a handler, it threw, and the top's own load runs it again.

const forms: Record<string, Record<string, string>> = {
  "a function that the top calls, then require() at the top": {
    "main.cjs": `function attempt() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); } }
attempt();
const m = require("./m.cjs");
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
  },
  "a helper that takes the name": {
    "main.cjs": `function tryRequire(name) { try { return require(name); } catch (e) { console.log("caught " + e.message); return null; } }
const first = tryRequire("./m.cjs");
const m = require("./m.cjs");
console.log("first " + first);
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
  },
  "then await import() at the top": {
    "main.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function attempt() { try { require("./m.cjs"); } catch (e) { console.log("caught " + e.message); } }
attempt();
const m = (await import("./m.cjs")).default;
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
  },
  "the main file of a package": {
    "main.cjs": `function optional(name) { try { return require(name); } catch (e) { console.log("caught " + e.message); return null; } }
const first = optional("pkg");
const m = require("pkg");
console.log("first " + first + " pkgRuns " + globalThis.pkgRuns);
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "node_modules/pkg/index.js": `globalThis.pkgRuns = (globalThis.pkgRuns ?? 0) + 1;
module.exports = require("./lib/m.js");
`,
    "node_modules/pkg/lib/m.js": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "index.js" }
`,
  },
  "it throws twice": {
    "main.cjs": `globalThis.failures = 2;
function attempt() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); } }
attempt(); attempt();
const m = require("./m.cjs");
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
  },
  "the initializer of a static field": {
    "main.cjs": `class Loader { static first = Loader.attempt(); static attempt() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } } }
const m = require("./m.cjs");
console.log("first " + Loader.first);
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
  },
  "a callback of forEach": {
    "main.cjs": `["./m.cjs"].forEach(name => { try { require(name); } catch (e) { console.log("caught " + e.message); } });
const m = require("./m.cjs");
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
  },
  "through a file between": {
    "main.cjs": `function attempt() { try { return require("./mid.cjs"); } catch (e) { console.log("caught " + e.message); } }
attempt();
const m = require("./mid.cjs").m;
console.log("mids " + globalThis.mids);
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
    "mid.cjs": `globalThis.mids = (globalThis.mids ?? 0) + 1;
exports.m = require("./m.cjs");
`,
  },
  "module.require()": {
    "main.cjs": `function attempt() { try { return module.require("./m.cjs"); } catch (e) { console.log("caught " + e.message); } }
attempt();
const m = require("./m.cjs");
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
  },
  "a function of a file that the top has loaded before": {
    "main.cjs": `const helper = require("./helper.cjs");
const m = require("./m.cjs");
console.log("helper " + helper.dep);
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "helper.cjs": `let dep = null;
function init() { try { dep = require("./m.cjs"); } catch (e) { console.log("caught " + e.message); } }
init();
exports.dep = dep;
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
  },
  "a handler for uncaughtException, then a timer": {
    "main.cjs": `globalThis.saved = [];
process.on("uncaughtException", e => console.log("handler", e.message));
setTimeout(() => {
  const m = require("./m.cjs");
  const [a, b] = globalThis.saved;
console.log(globalThis.saved.length, b && a.K === b.K, a.K.id, b && b.K.id, new a.K().who(), b && new b.K().who(), b && new a.K() instanceof b.K, m.K === (b ?? a).K, new a.F().m(), b && new b.F().m(), a.bump(), a.bump(), b && b.bump());
}, 5);
require("./m.cjs");
console.log("not reached");
`,
    "m.cjs": `const n = globalThis.saved.length;
class K { static id = n; who() { return "K" + n + K.id; } }
function F() { this.n = n; }
F.prototype.m = function () { return "F" + n + this.n; };
let counter = 0;
const bump = () => ++counter + n * 100;
globalThis.saved.push({ K, F, bump });
if (n === 0) throw new Error("first");
module.exports = { K, F, bump };
`,
  },
  "a Worker loads in a function what the main thread loads at the top": {
    "main.cjs": `const { Worker } = require("node:worker_threads");
const m = require("./m.cjs");
const worker = new Worker(require("node:path").join(__dirname, "worker.cjs"));
worker.on("message", said => console.log("main " + m.value + " | worker " + said));
worker.on("error", e => console.log("worker error " + e.message));
`,
    "m.cjs": `const { isMainThread } = require("node:worker_threads");
globalThis.runs = (globalThis.runs ?? 0) + 1;
if (!isMainThread && globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
    "worker.cjs": `const { parentPort } = require("node:worker_threads");
function load() { try { return require("./m.cjs"); } catch (e) { return null; } }
const first = load(), second = load();
parentPort.postMessage("first " + first + " runs " + globalThis.runs + " value " + (second && second.value));
`,
  },
  "the top has loaded it first: one run": {
    "main.cjs": `globalThis.failures = 0;
const early = require("./m.cjs");
function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
const m = load();
console.log("same " + (early === m));
console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.trail = (globalThis.trail ?? "") + "[top of m, run " + globalThis.runs + "]";
let inner = 0;
exports.bump = function () { return ++inner; };
if (globalThis.runs < (globalThis.failures ?? 1) + 1) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
globalThis.trail += "[end of m, run " + globalThis.runs + "]";
`,
  },
  "the helper stands behind the loads at the head of the file: one run": {
    "main.cjs": `"use strict";
const m = require("./m.cjs");
const path = require("node:path");
function load(name) { try { return require(name); } catch (e) { return null; } }
console.log("runs " + globalThis.runs + " same " + (load("./m.cjs") === m) + " " + path.basename("/a/b"));
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1; exports.value = "ok" + globalThis.runs;
`,
  },
  "ahead of the load in one declaration": {
    "main.cjs": `"use strict";
const m = (attempt(), require("./m.cjs"));
function attempt() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
console.log("runs " + globalThis.runs + " value " + m.value);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
    "other.cjs": `exports.a = undefined; exports.name = "other"; exports.call = f => f();
`,
  },
  "in the default of a pattern": {
    "main.cjs": `const { a = attempt() } = require("./other.cjs");
const m = require("./m.cjs");
function attempt() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
console.log("runs " + globalThis.runs + " value " + m.value);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
    "other.cjs": `exports.a = undefined; exports.name = "other"; exports.call = f => f();
`,
  },
  "handed to what an earlier load exports": {
    "main.cjs": `const early = require("./other.cjs").call(attempt);
const m = require("./m.cjs");
function attempt() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
console.log("runs " + globalThis.runs + " value " + m.value);
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
    "other.cjs": `exports.a = undefined; exports.name = "other"; exports.call = f => f();
`,
  },
  "exported, and called by a file that requires this one back": {
    "main.cjs": `exports.attempt = attempt;
const back = require("./back.cjs");
const m = require("./m.cjs");
function attempt() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
console.log("runs " + globalThis.runs + " value " + m.value);
`,
    "back.cjs": `require("./main.cjs").attempt();
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
    "other.cjs": `exports.a = undefined; exports.name = "other"; exports.call = f => f();
`,
  },
};

test.concurrent.each(Object.entries(forms))(
  "%s",
  async (_, files) => {
    using dir = tempDir("aot-rerun-first-load", files);
    const entry = Object.keys(files).find(name => name.startsWith("main."))!;
    const run = async (cmd: string[]) => {
      await using proc = Bun.spawn({ cmd, cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const expected = await run([bunExe(), entry]);
    expect(expected.stdout).not.toBe("");
    const executable = join(String(dir), "executable");
    const built = await run([bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", executable]);
    expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const { stdout, exitCode } = await run([executable]);
    expect({ stdout, exitCode }).toEqual({ stdout: expected.stdout, exitCode: expected.exitCode });
  },
  600_000,
);
