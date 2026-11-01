import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// A load at the top that the file passes by loads nothing: whoever asks for the file later is the first, and a run that threw is run again.

const forms: Record<string, Record<string, string>> = {
  "if": {
    "main.cjs": `if (process.env.NEVER_SET_BY_ANYBODY) require("./m.cjs");
function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => {
  const first = load(), m = load();
  console.log("first " + first);
  console.log("runs " + globalThis.runs + " value " + (m && m.value) + " bump " + (m && m.bump && m.bump()) + " " + globalThis.trail);
}, 1);
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
  "?:": {
    "main.cjs": `const chosen = process.env.NEVER_SET_BY_ANYBODY ? require("./m.cjs") : require("./other.cjs");
function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
const first = load(), m = load();
console.log("first " + first + " chosen " + chosen.name);
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
    "other.cjs": `exports.name = "other";
`,
  },
  "&&": {
    "main.cjs": `process.env.NEVER_SET_BY_ANYBODY && require("./m.cjs");
const load = () => { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } };
const first = load(), m = load();
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
  "||=": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
let held = 1; held ||= require("./m.cjs");
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
  },
  "?.()": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
globalThis.neverDefinedByAnybody?.(require("./m.cjs"));
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
  },
  "switch": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
switch (process.env.NEVER_SET_BY_ANYBODY) { case "yes": require("./m.cjs"); break; default: break; }
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
  },
  "a loop": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
for (const name of Object.keys({})) require("./m.cjs");
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
  },
  "the update of a for": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
for (let i = 0; i < 0; require("./m.cjs")) i++;
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
  },
  "a handler": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
try { JSON.parse("1"); } catch { require("./m.cjs"); }
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
  },
  "behind a break": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
skip: { if (!process.env.NEVER_SET_BY_ANYBODY) break skip; require("./m.cjs"); }
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
  },
  "behind a return": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
if (!process.env.NEVER_SET_BY_ANYBODY) return;
require("./m.cjs");
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
  },
  "one of two names": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
const chosen = require(process.env.NEVER_SET_BY_ANYBODY ? "./m.cjs" : "./other.cjs");
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
    "other.cjs": `exports.name = "other";
`,
  },
  "an if in a block in an if": {
    "main.cjs": `function load() { try { return require("./m.cjs"); } catch (e) { console.log("caught " + e.message); return null; } }
setTimeout(() => { const first = load(), m = load(); console.log("first " + first + " runs " + globalThis.runs + " value " + (m && m.value)); }, 1);
{ if (process.argv.length > 0) { if (process.env.NEVER_SET_BY_ANYBODY) { const m = require("./m.cjs"); } } }
`,
    "m.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("boom " + globalThis.runs);
exports.value = "ok" + globalThis.runs;
`,
  },
};

test.concurrent.each(Object.entries(forms))(
  "%s",
  async (_, files) => {
    using dir = tempDir("aot-rerun-skipped-load", files);
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
