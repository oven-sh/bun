// An executable always runs on Bun, so a test that asks which runtime this is has one answer, and `bun build --compile --aot` gives it:
// the arm for another runtime is not loaded, not checked and not compiled, and what it imports is not in the executable.
// The name decides nothing: a parameter, a variable or an import called `Bun` or `process` is read when the program runs.
//
//   asksAndHolds     tests that are true on Bun, each written in every shape of `shapes`. The other arm requires a file that does not
//                    exist, under a name of its own: a build that followed it would say so
//   namedAlike       the same words about something else: the executable prints what `bun run` prints
//   whatAnswersThem  cannot be replaced in an executable
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const asksAndHolds = [
  `typeof Bun !== "undefined"`,
  `typeof Bun != "undefined"`,
  `"undefined" !== typeof Bun`,
  `typeof Bun === "object"`,
  `globalThis.Bun`,
  `globalThis.Bun !== undefined`,
  `typeof globalThis.Bun !== "undefined"`,
  `"Bun" in globalThis`,
  `globalThis?.Bun`,
  `globalThis.Bun != null`,
  `typeof process !== "undefined"`,
  `typeof process === "object"`,
  `globalThis.process`,
  `globalThis.process !== undefined`,
  `"process" in globalThis`,
  `process.isBun`,
  `process.isBun === true`,
  `process?.isBun`,
  `"isBun" in process`,
  `typeof process.versions === "object"`,
  `process.versions !== null`,
  `process.versions != null`,
  `"versions" in process`,
  `process.versions.bun`,
  `process.versions.bun !== undefined`,
  `typeof process.versions.bun === "string"`,
  `process.versions?.bun`,
  `process?.versions?.bun`,
  `globalThis.process?.versions?.bun`,
  `"bun" in process.versions`,
  `process.versions.node`,
  `typeof process.versions.node === "string"`,
  `"node" in process.versions`,
  `typeof process.release === "object"`,
  `process.release.name === "node"`,
  `process.release?.name !== "io.js"`,
  `typeof require === "function"`,
  `typeof module !== "undefined"`,
  `process.platform === ${JSON.stringify(process.platform)}`,
  `process.arch === ${JSON.stringify(process.arch)}`,
  `!process.browser`,
  `typeof process !== "undefined" && typeof process.versions === "object" && process.versions !== null && typeof process.versions.bun === "string"`,
  `typeof process !== "undefined" && "bun" in process.versions`,
  `typeof process !== "undefined" && process.versions != null && process.versions.node != null`,
  `typeof Bun === "undefined" ? false : true`,
  `typeof Bun === "undefined" || !("Bun" in globalThis) ? 0 : 1`,
  `typeof Bun === "undefined" || typeof process === "undefined" ? 0 : 1`,
];

type Shape = (test: string, row: number, other: string) => string;

const shapes: Record<string, Shape> = {
  "in an if": (test, row, other) => `if (${test}) console.log(${row}); else console.log(${other});`,
  "negated": (test, row, other) => `if (!(${test})) console.log(${other}); else console.log(${row});`,
  "in front of &&": (test, row, other) => `console.log(!(${test}) && ${other}, ${row});`,
  "in front of ||": (test, row, other) => `console.log(!!(${test}) || ${other}, ${row});`,
  "in front of ?:": (test, row, other) => `console.log((${test}) ? ${row} : ${other});`,
  "through a const": (test, row, other) =>
    `const c${row} = ${test};\nif (c${row}) console.log(${row}); else console.log(${other});`,
  "through a let": (test, row, other) =>
    `let c${row} = ${test};\nif (c${row}) console.log(${row}); else console.log(${other});`,
  "through a var": (test, row, other) =>
    `var c${row} = ${test};\nif (c${row}) console.log(${row}); else console.log(${other});`,
  "through a const of a const": (test, row, other) =>
    `const c${row} = ${test}, d${row} = !c${row};\nif (d${row}) console.log(${other}); else console.log(${row});`,
  "through a const, in a function": (test, row, other) =>
    `const c${row} = ${test};\nfunction f${row}() { if (c${row}) return ${row}; return ${other}; }\nconsole.log(f${row}());`,
  "through a var, in a function": (test, row, other) =>
    `var c${row} = ${test};\nfunction f${row}() { if (c${row}) return ${row}; return ${other}; }\nconsole.log(f${row}());`,
  "through a var, in a method and an arrow function": (test, row, other) =>
    `var c${row} = ${test};\nclass C${row} { m() { return () => (c${row} ? ${row} : ${other}); } }\nconsole.log(new C${row}().m()());`,
  "in a function": (test, row, other) =>
    `function f${row}() { return (${test}) ? ${row} : ${other}; }\nconsole.log(f${row}());`,
};

test(
  "the default import of node:process is the global",
  () =>
    slot(async () => {
      const tests = asksAndHolds.filter(
        test => /^(typeof )?process\b/.test(test) && !/platform|arch|browser|typeof process [!=]/.test(test),
      );
      const rows = tests.map(
        (test, row) => `console.log((${test}) ? ${row} : await import("./for-another-runtime-${row}.js"));`,
      );
      using dir = tempDir("aot-which-runtime", {
        "main.mjs": `import process from "node:process";\n` + rows.join("\n"),
      });
      const { plain, said, built, compiled } = await buildAndRun(String(dir), "main.mjs");
      expect(tests.length).toBeGreaterThan(15);
      expect([...said.matchAll(/for-another-runtime-(\d+)/g)].map(match => tests[Number(match[1])])).toEqual([]);
      expect({ built, said: built ? "" : said }).toEqual({ built: true, said: "" });
      expect({ stdout: compiled!.stdout, exitCode: compiled!.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    }),
  600_000,
);

const executableIn = (folder: string) => join(folder, isWindows ? "main.exe" : "main");

async function buildAndRun(folder: string, entryPoint: string, interprets = false) {
  const plain = await spawned([bunExe(), entryPoint], folder, bunEnv);
  const build = await spawned(
    [bunExe(), "build", "--compile", "--aot", entryPoint, "--outfile", executableIn(folder)],
    folder,
    bunEnv,
  );
  const said = build.stdout + build.stderr;
  if (build.exitCode !== 0) return { plain, said, built: false as const };
  const compiled = await spawned(
    [executableIn(folder)],
    folder,
    interprets ? bunEnv : { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
  );
  return { plain, said, built: true as const, compiled };
}

describe.concurrent("the arm for another runtime is not followed", () => {
  for (const [name, shape] of Object.entries(shapes)) {
    test(
      name,
      () =>
        slot(async () => {
          const rows = asksAndHolds.map((test, row) => shape(test, row, `require("./for-another-runtime-${row}.js")`));
          using dir = tempDir("aot-which-runtime", { "main.cjs": rows.join("\n") });
          const { plain, said, built, compiled } = await buildAndRun(String(dir), "main.cjs");
          const followed = [...said.matchAll(/for-another-runtime-(\d+)/g)].map(
            match => asksAndHolds[Number(match[1])],
          );
          expect([...new Set(followed)]).toEqual([]);
          expect({ built, said: built ? "" : said }).toEqual({ built: true, said: "" });
          expect({ stdout: compiled!.stdout, exitCode: compiled!.exitCode }).toEqual({
            stdout: plain.stdout,
            exitCode: 0,
          });
        }),
      600_000,
    );
  }
});

// Each prints what it finds; `other()` stands where the arm for another runtime would.
const namedAlike: Record<string, Record<string, string>> = {
  "parameters": {
    "main.cjs": `
function a(Bun) { return typeof Bun === "undefined" ? "other" : "bun"; }
function b(process) { return process.isBun ? "bun" : "other"; }
function c(process) { return "bun" in process.versions ? "bun" : "other"; }
function d(process) { return process.versions.bun ? "bun" : "other"; }
function e(globalThis) { return globalThis.Bun ? "bun" : "other"; }
function f(process) { return typeof process === "undefined" ? "other" : "bun"; }
function g({ process }) { return process?.versions?.bun ?? "other"; }
console.log(a(), a(1), b({}), b({ isBun: 1 }), c({ versions: {} }), c({ versions: { bun: 0 } }), d({ versions: {} }), e({}), e({ Bun: 1 }), f(), f(0), g({}), g({ process: { versions: { bun: "mine" } } }));`,
  },
  "variables, functions, classes and what a catch binds": {
    "main.cjs": `
{
  const process = { versions: {}, release: { name: "mine" } };
  console.log(process.isBun ? "bun" : "other", "bun" in process.versions, typeof process.versions.bun, process.release.name);
}
{
  let Bun;
  console.log(typeof Bun, typeof Bun === "undefined" ? "other" : "bun");
}
function inner() {
  var process;
  function Bun() {}
  return [typeof process, typeof Bun];
}
console.log(inner().join());
{
  class process { static isBun = 0; }
  console.log(typeof process, process.isBun ? "bun" : "other");
}
try { throw undefined; } catch (Bun) { console.log(typeof Bun === "undefined" ? "other" : "bun"); }
for (const process of [{ isBun: false }, { isBun: true }]) console.log(process.isBun ? "bun" : "other");`,
  },
  "a variable of the whole file": {
    "main.cjs": `
var process = { versions: { node: "0" } };
function which() { return typeof process !== "undefined" && "bun" in process.versions ? "bun" : "other"; }
console.log(which(), process.isBun, process.versions.bun, globalThis.process.isBun);`,
  },
  "imports": {
    "main.mjs": `
import process, { Bun } from "./mine.mjs";
import * as globalThis from "./mine.mjs";
console.log(process.isBun ? "bun" : "other", typeof Bun === "undefined" ? "other" : "bun", "bun" in process.versions, globalThis.Bun, typeof globalThis.process);`,
    "mine.mjs": `export default { versions: {} };\nexport const Bun = undefined;`,
  },
  "with and eval": {
    "main.cjs": `
function inWith(scope) { with (scope) { return [typeof Bun, typeof process, process && process.isBun ? "bun" : "other"].join(); } }
function behindEval(text) { eval(text); return [typeof Bun, typeof process === "undefined" ? "other" : "bun"].join(); }
console.log(inWith({}), inWith({ Bun: undefined, process: 0 }), inWith({ process: { isBun: 0 } }));
console.log(behindEval(""), behindEval("var Bun"), behindEval("var process, Bun = 1"));`,
  },
  "other members of the same objects": {
    "main.cjs": `
console.log("deno" in process.versions, process.versions.deno ? "deno" : "none", typeof process.versions.electron, process.release.lts ?? "none", typeof process.type, typeof Bun.nobody, "nobody" in Bun);`,
  },
  "a variable that is read before its initializer has run": {
    "main.cjs": `
var viaEarlyObject = { early };
console.log(early(), viaEarlyObject.early());
var isBun = typeof Bun === "object";
function early() { return isBun ? "bun" : "not yet"; }
var viaObject = { early };
console.log(early(), viaObject.early());
if (process.argv.length > 9) { var never = typeof Bun === "object"; }
function late() { return never ? "bun" : "never"; }
console.log(late());
var twice = typeof Bun === "object";
function both() { return twice ? "bun" : "other"; }
console.log(both());
twice = false;
console.log(both());`,
  },
  "a function that another file of a cycle calls first": {
    "main.mjs": `
import "./first.mjs";
var isBun = typeof Bun === "object";
let alsoBun = typeof Bun === "object";
export function which() { return isBun ? "bun" : "not yet"; }
export function whichOrThrows() { try { return alsoBun ? "bun" : "other"; } catch (error) { return error.name; } }
console.log(which(), whichOrThrows());`,
    "first.mjs": `
import { which, whichOrThrows } from "./main.mjs";
console.log(which(), whichOrThrows());`,
  },
  "a function that another CommonJS file of a cycle calls first": {
    "main.cjs": `
exports.which = which;
require("./first.cjs");
var isBun = typeof Bun === "object";
function which() { return isBun ? "bun" : "not yet"; }
console.log(which());`,
    "first.cjs": `console.log(require("./main.cjs").which());`,
  },
  "stores to the global, which no Bun lets through": {
    "main.cjs": `
"use strict";
const attempts = [
  () => { globalThis.Bun = undefined; },
  () => { Bun = undefined; },
  () => delete globalThis.Bun,
  () => Object.defineProperty(globalThis, "Bun", { value: undefined }),
  () => Reflect.set(globalThis, "Bun", undefined),
  () => Reflect.deleteProperty(globalThis, "Bun"),
];
for (const attempt of attempts) {
  try { console.log(attempt()); } catch (error) { console.log(error.name); }
  console.log(typeof Bun, typeof globalThis.Bun, "Bun" in globalThis, typeof Bun === "undefined" ? "other" : "bun");
}`,
  },
};

describe.concurrent("what is only named alike is read", () => {
  for (const [name, files] of Object.entries(namedAlike)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-which-runtime", files);
          const { plain, said, built, compiled } = await buildAndRun(
            String(dir),
            Object.keys(files)[0],
            name.includes("eval"),
          );
          expect({ built, said: built ? "" : said }).toEqual({ built: true, said: "" });
          expect({ exitCode: plain.exitCode, prints: /\S/.test(plain.stdout) }).toEqual({ exitCode: 0, prints: true });
          expect({ stdout: compiled!.stdout, exitCode: compiled!.exitCode }).toEqual({
            stdout: plain.stdout,
            exitCode: 0,
          });
        }),
      600_000,
    );
  }
});

const refusal = (what: string, how = "assign to") =>
  `TypeError: Cannot ${how} ${what} because built-in objects are read-only in a compiled executable`;

test(
  "what answers them cannot be replaced in an executable",
  () =>
    slot(async () => {
      const attempts: [string, string][] = [
        [`globalThis.process = {}`, refusal("process")],
        [`delete globalThis.process`, refusal("process", "delete")],
        [`Object.defineProperty(globalThis, "process", { value: 1 })`, refusal("process")],
        [`process.isBun = false`, refusal("process.isBun")],
        [`delete process.isBun`, refusal("process.isBun", "delete")],
        [`process.versions = {}`, refusal("process.versions")],
        [`process.release = {}`, refusal("process.release")],
        [`process.versions.bun = "0"`, "TypeError: Attempted to assign to readonly property."],
        [`delete process.versions.bun`, "TypeError: Unable to delete property."],
        [`process.versions.deno = "0"`, "TypeError: Attempting to define property on object that is not extensible."],
        [`process.release.name = "other"`, "TypeError: Attempted to assign to readonly property."],
      ];
      const main = `"use strict";
const attempts = [${attempts.map(([text]) => `() => { ${text}; }`).join(", ")}];
const chosen = process.argv[2] === undefined ? attempts : [];
for (const attempt of chosen) {
  try { attempt(); console.log("done"); } catch (error) { console.log(String(error).split(" (bun compile")[0]); }
}
console.log(typeof process, process.isBun, typeof process.versions.bun, "deno" in process.versions, process.release.name, Object.isFrozen(process.versions), Object.isFrozen(process.release));
process.title = "mine"; process.mine = 1; Bun.mine = 2;
console.log(process.mine, Bun.mine);`;
      using dir = tempDir("aot-which-runtime", { "main.cjs": main });
      const { said, built, compiled } = await buildAndRun(String(dir), "main.cjs");
      expect({ built, said: built ? "" : said }).toEqual({ built: true, said: "" });
      expect(compiled!.stdout.split("\n")).toEqual([
        ...attempts.map(([, answer]) => answer),
        "object true string false node true true",
        "1 2",
        "",
      ]);
      expect(compiled!.exitCode).toBe(0);
    }),
  600_000,
);
