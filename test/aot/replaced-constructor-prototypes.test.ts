// An object keeps the prototype that its constructor had when the object was made. `const q = new Q(); Q.prototype = second;
// const r = new Q();`: q inherits from the first prototype and r from the second. In a warm function the first object was made
// late, behind the write, and had the second: every read through it was wrong, in the first run alone. Each case is a program of
// its own: who holds the member, how it is written, when, how it is read, how often the function runs.
// The fault has tests of its own: engine-tests/answers/first-of-two-objects-keeps-its-prototype.ir, and the program of that name in parallel/constructor-functions.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { partOfGrid } from "./harness/ways";
import { test } from "./supported";

const functions = `const one = function () { return "first"; }, two = function () { return "second"; };\n`;
// "replaced": the constructor's own `prototype` is replaced. The others: a member of what the object inherits from is written.
const holders = {
  "replaced": [
    `function Q() {}\nconst first = Q.prototype;\n${functions}first.describe = one;\nconst second = { describe: two, other: "second" };\n`,
    `new Q()`,
  ],
  "a function's prototype": [
    `function Q() {}\nconst holder = Q.prototype;\n${functions}holder.describe = one;\n`,
    `new Q()`,
  ],
  "a class's prototype": [
    `class Q { describe() { return "first"; } }\nconst holder = Q.prototype;\nconst one = holder.describe, two = function () { return "second"; };\n`,
    `new Q()`,
  ],
  "a parent's prototype": [
    `function P() {}\nfunction Q() {}\nQ.prototype = Object.create(P.prototype);\nconst holder = P.prototype;\n${functions}holder.describe = one;\n`,
    `new Q()`,
  ],
  "what Object.create() took": [`${functions}const holder = { describe: one };\n`, `Object.create(holder)`],
  "what __proto__ names": [`${functions}const holder = { describe: one };\n`, `{ __proto__: holder }`],
};
const descriptor = (key: string, value: string) =>
  key === "prototype"
    ? `{ value: ${value} }`
    : `{ value: ${value}, writable: true, configurable: true, enumerable: true }`;
const writes = {
  "an assignment": (object: string, key: string, value: string) => `${object}.${key} = ${value};`,
  "Object.defineProperty": (object: string, key: string, value: string) =>
    `Object.defineProperty(${object}, "${key}", ${descriptor(key, value)});`,
  "Reflect.defineProperty": (object: string, key: string, value: string) =>
    `Reflect.defineProperty(${object}, "${key}", ${descriptor(key, value)});`,
  "Object.assign": (object: string, key: string, value: string) => `Object.assign(${object}, { ${key}: ${value} });`,
};
const reads = {
  "a call": ["describe", (x: string) => `${x}.describe()`],
  "a read": [
    "describe",
    (x: string) => `(${x}.describe === one ? "first" : ${x}.describe === two ? "second" : "neither")`,
  ],
  "destructuring": ["describe", (x: string) => `(({ describe }) => describe())(${x})`],
  "an optional call": ["describe", (x: string) => `${x}.describe?.()`],
  "typeof": ["other", (x: string) => `typeof ${x}.other`],
  "in": ["other", (x: string) => `("other" in ${x})`],
} as const;
type Use = (x: string) => string;
const whens = {
  "before the first object": (make: string, use: Use) =>
    `CHANGE const q = ${make}; STORE_Q const s = ${use("q")}; UNDO return s;`,
  "between new and the first use": (make: string, use: Use) =>
    `const q = ${make}; CHANGE STORE_Q const s = ${use("q")}; UNDO return s;`,
  "between two uses": (make: string, use: Use) =>
    `const q = ${make}; STORE_Q const s = ${use("q")}; CHANGE const t = ${use("q")}; UNDO return s + " " + t;`,
  "in a callee": (make: string, use: Use) =>
    `const q = ${make}; change(); STORE_Q const s = ${use("q")}; undo(); return s;`,
  "between two objects": (make: string, use: Use) =>
    `const q = ${make}; CHANGE STORE_Q const r = ${make}; UNDO STORE_R return ${use("q")} + " " + ${use("r")};`,
};
const runs = {
  "once": `console.log(run(0));\n`,
  "three times": `let all = ""; for (let turn = 0; turn < 3; turn++) all += String(run(turn)) + " | ";\nconsole.log(all);\n`,
  "3000 times": `const seen = new Map();\nfor (let turn = 0; turn < 3000; turn++) { const s = String(run(turn)); seen.set(s, (seen.get(s) ?? 0) + 1); }\nconsole.log([...seen].map(([s, n]) => s + " x" + n).join(" | "));\n`,
};
type Cell = {
  holder: keyof typeof holders;
  write: keyof typeof writes;
  when: keyof typeof whens;
  read: keyof typeof reads;
  runs: keyof typeof runs;
  bare?: boolean;
};
const witness: Cell = {
  holder: "replaced",
  write: "Reflect.defineProperty",
  when: "between two objects",
  read: "a call",
  runs: "three times",
};

function programOf(cell: Cell) {
  const [declare, make] = holders[cell.holder];
  const [member, show] = reads[cell.read];
  const write = writes[cell.write];
  const isReplaced = cell.holder === "replaced";
  const change = isReplaced
    ? write("Q", "prototype", "second")
    : member === "describe"
      ? write("holder", "describe", "two")
      : write("holder", "other", `"second"`);
  const undo = isReplaced
    ? write("Q", "prototype", "first")
    : member === "describe"
      ? write("holder", "describe", "one")
      : `delete holder.other;`;
  const use: Use = cell.bare ? x => `String(${show(x)})` : x => `String(${show(x)} + " " + ${x}.a)`;
  const body = whens[cell.when](make, use)
    .replace("CHANGE", change)
    .replace("UNDO", undo)
    .replace("STORE_Q", cell.bare ? "" : `q[launderKey("b")] = 1;`)
    .replace("STORE_R", cell.bare ? "" : `r.b = 1;`);
  return (
    `function launderZero() { return 0; }\nfunction launderKey(key) { return [key, "other"][launderZero()]; }\n${declare}` +
    `function change() { ${change} }\nfunction undo() { ${undo} }\n` +
    (cell.bare
      ? ""
      : `function warm(a) { const w = ${make}; return JSON.stringify(w) + Object.keys(w).length; }\nwarm(9);\n`) +
    `function run(a) {\n  ${body}\n}\n${runs[cell.runs]}`
  );
}

const keysOf = <T extends object>(object: T) => Object.keys(object) as (keyof T)[];
const cells: Cell[] = [
  ...keysOf(writes).flatMap(write => keysOf(reads).map(read => ({ ...witness, write, read }))),
  ...keysOf(holders).map(holder => ({ ...witness, holder })),
  ...keysOf(whens).map(when => ({ ...witness, when })),
  ...keysOf(runs).map(runs => ({ ...witness, runs })),
  { ...witness, bare: true },
];
const grid = [...new Map(cells.map(cell => [Object.values(cell).join(", "), cell])).entries()];
const isWitness = ([, cell]: (typeof grid)[number]) => Object.values(cell).join() === Object.values(witness).join();
const cases = [
  ...grid.filter(isWitness),
  ...partOfGrid(
    "replaced constructor prototypes",
    grid.filter(it => !isWitness(it)),
    12,
    ([name]) => name,
  ),
];

test.each(cases)("%s", async (_, cell) => {
  using dir = tempDir("replaced-constructor-prototypes", { "main.js": programOf(cell) });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const { stdout, exitCode } = await run([bunExe(), "run", "main.js"], cwd, bunEnv);
  expect({ stdout, exitCode }).toEqual({ stdout: expect.stringMatching(/first|false|undefined/), exitCode: 0 });
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], cwd, bunEnv);
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  const ran = await run([executable], cwd, bunEnv);
  expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stdout, stderr: "", exitCode });
});
