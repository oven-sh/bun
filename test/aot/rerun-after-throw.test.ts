import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const forms: Record<string, Record<string, string>> = {
  "require() in a try at the top of a CommonJS file": {
    "main.cjs": `const seen = [], errors = [];
for (let i = 0; i < 3; i++) {
  try { require("./thrower.cjs"); seen.push("returned"); } catch (error) { errors.push(error); seen.push(error.message); }
}
console.log("SEEN", JSON.stringify(seen), "runs", globalThis.runsOfThrower, "same error", errors[0] === errors[1]);
`,
    "thrower.cjs": `globalThis.runsOfThrower = (globalThis.runsOfThrower ?? 0) + 1;
exports.half = "set before the throw";
throw new Error("boom " + globalThis.runsOfThrower);
`,
  },
  "a require() made by createRequire() in a try at the top of an ES module": {
    "main.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const seen = [], errors = [];
for (let i = 0; i < 3; i++) {
  try { require("./thrower.cjs"); seen.push("returned"); } catch (error) { errors.push(error); seen.push(error.message); }
}
console.log("SEEN", JSON.stringify(seen), "runs", globalThis.runsOfThrower, "same error", errors[0] === errors[1]);
`,
    "thrower.cjs": `globalThis.runsOfThrower = (globalThis.runsOfThrower ?? 0) + 1;
exports.half = "set before the throw";
throw new Error("boom " + globalThis.runsOfThrower);
`,
  },
  "require() in a function that is called in a try": {
    "main.cjs": `function load() { return require("./t.cjs"); }

const seen = [], errors = [];
for (let i = 0; i < 3; i++) { try { load(); seen.push("returned"); } catch (error) { errors.push(error); seen.push(error.message); } }
console.log(JSON.stringify(seen), "runs", globalThis.runs, "same error", errors[0] === errors[1]);
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "require() in a method": {
    "main.cjs": `class Loader { load() { return require("./t.cjs"); } }
const loader = new Loader();

const seen = [], errors = [];
for (let i = 0; i < 3; i++) { try { loader.load(); seen.push("returned"); } catch (error) { errors.push(error); seen.push(error.message); } }
console.log(JSON.stringify(seen), "runs", globalThis.runs, "same error", errors[0] === errors[1]);
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "require() in the initializer of a field": {
    "main.cjs": `class Holder { value = require("./t.cjs"); }

const seen = [], errors = [];
for (let i = 0; i < 3; i++) { try { new Holder(); seen.push("returned"); } catch (error) { errors.push(error); seen.push(error.message); } }
console.log(JSON.stringify(seen), "runs", globalThis.runs, "same error", errors[0] === errors[1]);
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "require() in an arrow function that is handed on": {
    "main.cjs": `const attempt = f => { try { return f(); } catch (error) { return error.message; } };
console.log(attempt(() => require("./t.cjs")), attempt(() => require("./t.cjs")), globalThis.runs);
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "require() in an async function": {
    "main.cjs": `async function load() { return require("./t.cjs"); }
(async () => { const seen = []; for (let i = 0; i < 3; i++) await load().then(() => seen.push("returned"), error => seen.push(error.message)); console.log(JSON.stringify(seen), globalThis.runs); })();
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "the third run returns, and each run has a module object and exports of its own": {
    "main.cjs": `const seen = [];
for (let i = 0; i < 5; i++) { try { const got = require("./t.cjs"); seen.push(Object.keys(got).join("+") + "=" + got.run); } catch (error) { seen.push(error.message); } }
console.log(JSON.stringify(seen), "runs", globalThis.runs);
console.log("module objects differ", globalThis.modules[0] !== globalThis.modules[1], globalThis.modules[1] !== globalThis.modules[2], "exports differ", globalThis.modules[0].exports !== globalThis.modules[2].exports);
console.log("what earlier runs exported", JSON.stringify(globalThis.modules.map(m => m.exports)));
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
(globalThis.modules ??= []).push(module);
exports["only" + globalThis.runs] = true;
exports.run = globalThis.runs;
if (globalThis.runs < 3) throw new Error("boom " + globalThis.runs);
`,
  },
  "variables, literals, classes and closures of a run that threw stay its own": {
    "main.cjs": `const seen = [];
for (let i = 0; i < 4; i++) { try { seen.push("returned " + require("./t.cjs").count); } catch (error) { seen.push(error.message); } }
console.log(JSON.stringify(seen));
console.log("closures keep their own run", JSON.stringify(globalThis.left.map(f => f())));
console.log("classes differ", globalThis.classes[0] !== globalThis.classes[1], new globalThis.classes[0]() instanceof globalThis.classes[1]);
console.log("literals differ", globalThis.tables[0] !== globalThis.tables[1], JSON.stringify(globalThis.tables));
`,
    "t.cjs": `const state = { runs: 0 }, table = [1, 2, 3], list = [];
let local = 0;
class Thing { static made = 0; constructor() { Thing.made++; } }
function bump() { return ++local; }
state.runs++; table.push(state.runs); list.push(bump(), bump());
new Thing();
(globalThis.left ??= []).push(() => "local " + local + " runs " + state.runs + " made " + Thing.made + " list " + list.join());
(globalThis.classes ??= []).push(Thing);
(globalThis.tables ??= []).push(table);
exports.count = state.runs;
if (state.runs < 3) throw new Error("state.runs is " + state.runs);
`,
  },
  "the file that throws is required by the file that is asked for": {
    "main.cjs": `const seen = [], errors = [];
for (let i = 0; i < 3; i++) { try { require("./a.cjs"); seen.push("returned"); } catch (error) { errors.push(error); seen.push(error.message); } }
console.log(JSON.stringify(seen), "runs", globalThis.runs, "same error", errors[0] === errors[1]);
console.log("a", globalThis.a, "before", globalThis.before, "after", globalThis.after);
`,
    "a.cjs": `globalThis.a = (globalThis.a ?? 0) + 1;
const before = require("./before.cjs");
const t = require("./t.cjs");
const after = require("./after.cjs");
module.exports = { before, t, after };
`,
    "after.cjs": `globalThis.after = (globalThis.after ?? 0) + 1;
`,
    "before.cjs": `globalThis.before = (globalThis.before ?? 0) + 1;
exports.ok = true;
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "the file that throws lies two files below": {
    "main.cjs": `const seen = [], errors = [];
for (let i = 0; i < 3; i++) { try { require("./a.cjs"); seen.push("returned"); } catch (error) { errors.push(error); seen.push(error.message); } }
console.log(JSON.stringify(seen), "runs", globalThis.runs, "same error", errors[0] === errors[1]);
console.log(globalThis.a, globalThis.b);
`,
    "a.cjs": `globalThis.a = (globalThis.a ?? 0) + 1;
module.exports = require("./b.cjs");
`,
    "b.cjs": `globalThis.b = (globalThis.b ?? 0) + 1;
module.exports = require("./t.cjs");
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "a package whose main file requires the file that throws": {
    "main.cjs": `const seen = [], errors = [];
for (let i = 0; i < 3; i++) { try { require("optional"); seen.push("returned"); } catch (error) { errors.push(error); seen.push(error.message); } }
console.log(JSON.stringify(seen), "runs", globalThis.runs, "same error", errors[0] === errors[1]);
`,
    "node_modules/optional/index.js": `globalThis.index = (globalThis.index ?? 0) + 1;
module.exports = require("./lib/binding.js");
`,
    "node_modules/optional/lib/binding.js": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
    "node_modules/optional/package.json": `{ "name": "optional", "main": "index.js" }
`,
  },
  "require() of a computed name": {
    "main.cjs": `const names = ["t", "fine", "t", "t"], seen = [];
for (const name of names) { try { seen.push(require("./plug/" + name + ".cjs").ok); } catch (error) { seen.push(error.message); } }
console.log(JSON.stringify(seen), globalThis.runs, globalThis.fine);
`,
    "plug/fine.cjs": `globalThis.fine = (globalThis.fine ?? 0) + 1;
exports.ok = "fine";
`,
    "plug/t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "an ES module that import() loads requires the file": {
    "main.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const seen = [];
await import("./asks.mjs").then(() => seen.push("imported"), error => seen.push(error.message));
await import("./asks.mjs").then(() => seen.push("imported"), error => seen.push(error.message));
for (let i = 0; i < 2; i++) { try { require("./t.cjs"); seen.push("returned"); } catch (error) { seen.push(error.message); } }
console.log(JSON.stringify(seen), globalThis.runs);
`,
    "asks.mjs": `import { createRequire } from "node:module";
createRequire(import.meta.url)("./t.cjs");
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "a file that an import statement loaded is not run again": {
    "main.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const seen = [];
await import("./imports.mjs").then(() => seen.push("imported"), error => seen.push(error.message));
for (let i = 0; i < 2; i++) { try { const got = require("./t.cjs"); seen.push("returned " + JSON.stringify(got)); } catch (error) { seen.push(error.message); } }
console.log(JSON.stringify(seen), globalThis.runs);
`,
    "imports.mjs": `import "./t.cjs";
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "the file that throws is required back by what it requires": {
    "main.cjs": `const seen = [], errors = [];
for (let i = 0; i < 3; i++) { try { require("./t.cjs"); seen.push("returned"); } catch (error) { errors.push(error); seen.push(error.message); } }
console.log(JSON.stringify(seen), "runs", globalThis.runs, "same error", errors[0] === errors[1]);
console.log("helper", globalThis.helper, JSON.stringify(globalThis.sawOfThrower));
`,
    "helper.cjs": `globalThis.helper = (globalThis.helper ?? 0) + 1;
(globalThis.sawOfThrower ??= []).push(require("./t.cjs").early);
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.early = globalThis.runs;
require("./helper.cjs");
throw new Error("boom " + globalThis.runs);
`,
  },
  "nobody catches the error": {
    "main.cjs": `console.log("before");
require("./t.cjs");
console.log("never");
`,
    "t.cjs": `throw new TypeError("nobody catches this");
`,
  },
  "another file requires it behind the catch": {
    "main.cjs": `try { require("./t.cjs"); } catch (error) { console.log(error.message); }
const other = require("./other.cjs");
console.log(other.said, globalThis.runs);
`,
    "other.cjs": `let said; try { require("./t.cjs"); said = "returned"; } catch (error) { said = error.message; }
exports.said = said;
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
  "what is thrown is no error": {
    "main.cjs": `const seen = [];
for (let i = 0; i < 3; i++) { try { require("./t.cjs"); } catch (thrown) { seen.push(thrown); } }
console.log(JSON.stringify(seen), seen[0] === seen[1]);
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
throw { n: globalThis.runs };
`,
  },
  "module.parent is who asked for this run, and a call that threw lists no child": {
    "main.cjs": `for (let i = 0; i < 2; i++) { try { require("./t.cjs"); } catch {} }
try { require("./other.cjs"); } catch {}
globalThis.succeed = true;
require("./t.cjs");
console.log(globalThis.parents.map(p => p && require("node:path").basename(p.filename)).join(), module.children.map(c => require("node:path").basename(c.filename)).join());
`,
    "other.cjs": `require("./t.cjs");
`,
    "t.cjs": `(globalThis.parents ??= []).push(module.parent);
if (!globalThis.succeed) throw new Error("boom");
`,
  },
  "require() in a TypeScript file": {
    "main.ts": `const seen: string[] = [];
for (let i = 0; i < 3; i++) { try { require("./t.cjs"); seen.push("returned"); } catch (error) { seen.push((error as Error).message); } }
console.log(JSON.stringify(seen), (globalThis as any).runs);
`,
    "t.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.half = "run " + globalThis.runs;
throw new Error("boom " + globalThis.runs);
`,
  },
};

test.concurrent.each(Object.entries(forms))(
  "%s",
  async (_, files) => {
    using dir = tempDir("aot-rerun-after-throw", files);
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
