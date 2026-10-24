// A value that nobody uses, and whose making nobody can see, leaves nothing in the compiled code: each program below is one such
// statement and `console.log(1)`, and the top-level code that is selected for it holds the call of console.log and nothing else.
// With the built-in prototypes locked none of the statements runs code of the program. An error for lack of memory keeps nothing.
// programs/effects/unused-results-of-built-ins-that-must-stay.js has the same statements with operands that run code or make them throw.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { describe, printIR, test, writesProgramInto } from "./harness/printed-ir";
import { built, slot, spawned } from "./run-programs";

const env = { ...bunEnv, NO_COLOR: "1" };

const removed = {
  "an object literal": `const u = { a: 1, b: "x" };`,
  "a nested literal": `const u = { a: { b: [1, 2, { c: 3 }] } };`,
  "an array literal": `const u = [1, 2, 3];`,
  "a read of a literal": `const u = { a: 1 }; u.a;`,
  "a read of a literal under a constant key": `const k = "a"; const u = { a: 1 }; u[k];`,
  "a literal with a computed key": `const k = "a" + "b"; const u = { [k]: 1 };`,
  "a literal with a getter that nobody reads": `const u = { get a() { console.log("no"); return 1; } };`,
  "an array spread": `const a = [1, 2, 3]; const u = [...a];`,
  "an object spread": `const a = { x: 1 }; const u = { ...a, y: 2 };`,
  "an array pattern": `const [p, q] = [1, 2];`,
  "an object rest pattern": `const { a, ...rest } = { a: 1, b: 2 };`,
  "for-of over a literal": `for (const x of [1, 2, 3]) { x + 1; }`,
  "new Map of constants": `const u = new Map([[1, 2]]);`,
  "new Set of constants": `const u = new Set([1, 2]);`,
  "new WeakMap": `const u = new WeakMap();`,
  "Object.keys of a literal": `const u = Object.keys({ a: 1 });`,
  "Object.entries of a literal": `const u = Object.entries({ a: 1 });`,
  "Object.values of a literal": `const u = Object.values({ a: 1 });`,
  "Object.getOwnPropertyNames of a literal": `const u = Object.getOwnPropertyNames({ a: 1 });`,
  "Object.hasOwn of a literal": `const u = Object.hasOwn({ a: 1 }, "a");`,
  "JSON.stringify of a literal": `const u = JSON.stringify({ a: 1 });`,
  "JSON.stringify of nested literals": `const p = { x: 1, label: "p" }; const u = JSON.stringify({ from: p, to: p }, null, 2);`,
  "methods of a constant string": `const u = "abc".toUpperCase().slice(1);`,
  "methods of a string nobody knows": `const s = String(Math.random()); const u = s.toUpperCase().trim().concat(s).indexOf("1");`,
  "a template": "const n = 3; const u = `a${n}b`;",
  "Math": `const u = Math.max(1, 2) + Math.floor(2.5);`,
  "a regular expression literal": `const u = /a+b/g;`,
  "new RegExp of a constant": `const u = new RegExp("a+b");`,
  "Symbol": `const u = Symbol("x");`,
  "new Error": `const u = new Error("x");`,
  "new TypeError": `const u = new TypeError("x");`,
  "new Date of a number": `const u = new Date(0);`,
  "a closure": `const u = (x) => x + 1;`,
  "a class with a static field": `class U { static s = [1, 2]; m() { return 1; } }`,
  "a typed array of a constant length": `const u = new Uint8Array(8);`,
  "an array of a constant length": `const u = new Array(8);`,
};

// Each stays today, and why.
const stillThere = {
  "a read of a literal under a key nobody knows": [
    `const u = { a: 1 }; u[process.argv[9]];`,
    "the read of process.argv is unknown code",
  ],
  "map with a callback without effects": [
    `const u = [1, 2, 3].map((x) => x * 2);`,
    "a loop without effects whose bound is visible stays",
  ],
  "filter and reduce with callbacks without effects": [
    `const u = [1, 2, 3].filter((x) => x > 1).reduce((s, x) => s + x, 0);`,
    "the summaries of the library functions do not know their operands",
  ],
  "Object.assign onto a fresh literal": [
    `const u = Object.assign({}, { a: 1 });`,
    "a store by a built-in into a literal is unknown code",
  ],
  "Object.freeze of a fresh literal": [
    `const u = Object.freeze({ a: 1 });`,
    "a terminator that writes its fresh operand stays",
  ],
  "Array.from an array-like literal": [
    `const u = Array.from({ length: 3 });`,
    "the summary of the library function does not know its operand",
  ],
  "JSON.parse of a constant": [`const u = JSON.parse("{\\"a\\":1}");`, "nothing parses the text at build time"],
  "an instance of a class of the program": [`class U { n = 1; } const u = new U();`, "NewClass stays without a use"],
  "Promise.resolve of a number": [`const u = Promise.resolve(1);`, "the store into the fresh promise stays"],
} as const;

// The operations of the top-level code but the constants, the jumps, the call of console.log and the return.
function operationsOfModuleBody(dump: string): string[] {
  const lines = dump.split("\n");
  const start = lines.findIndex(line => /^function f\d+ .*\bkind=Module\b/.test(line));
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lines.indexOf("}", start);
  return lines
    .slice(start + 1, end)
    .map(line => line.trim())
    .filter(line => !/^b\d+\(.*\).*:$/.test(line))
    .filter(line => !/= (Integer|Undefined)\b| overload=ConsoleLog\/|^(Return|Jump)\b/.test(line));
}

async function compile(statement: string): Promise<string[]> {
  using dir = tempDir("aot-unused-values", { "main.js": `${statement}\nconsole.log(1);\n` });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const command = [bunExe(), ...compileCommand, writesProgramInto(folder), "main.js", "--outfile", executable];
  built(await spawned(command, folder, env));
  expect(await spawned([executable], folder, env)).toEqual({ stdout: "1\n", stderr: "", exitCode: 0, signal: null });
  return operationsOfModuleBody(await printIR(folder, { until: "Select", functionName: "f0" }));
}

describe.concurrent("nothing is left of", () => {
  for (const [title, statement] of Object.entries(removed)) {
    test(title, () => slot(async () => expect(await compile(statement)).toEqual([])), 300_000);
  }
  for (const [title, [statement, reason]] of Object.entries(stillThere)) {
    test.todo(`${title}: ${reason}`, () => slot(async () => expect(await compile(statement)).toEqual([])), 300_000);
  }
});
