// A function that the program never calls has no code in the executable, however its module hands it out: as an export nobody
// imports, through a namespace object, a barrel, the exports object of a CommonJS module, a class, an object of functions or
// `import()`. Where the function object is still created, a stub of a few bytes stands in for its entry point. The files are
// compiled one by one, not bundled, so nothing but the analysis of the whole program removes these bodies.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(240_000);

const largestStub = 64;

const globals = `declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
`;

const functions = `export function usedOne(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += i * n;
  return total;
}
export function unusedOne(n) {
  let text = "";
  for (let i = 0; i < n; i++) text += String(i);
  return text;
}
export function unusedTwo(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(i);
  return list;
}
`;

const commonJsFunctions = functions.replaceAll("export function", "function");

interface Case {
  files: Record<string, string>;
  entry: string;
  unused: string[];
}

const cases: Record<string, Case> = {
  "an export that nobody imports": {
    entry: "main.mjs",
    files: {
      "main.mjs": `import { usedOne } from "./functions.mjs";\nconsole.log(usedOne(process.argv.length + 1));\n`,
      "functions.mjs": functions,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "what only an unused export calls in a third file": {
    entry: "main.mjs",
    files: {
      "main.mjs": `import { first } from "./callers.mjs";\nconsole.log(first(process.argv.length + 1));\n`,
      "callers.mjs": `import { usedOne, unusedOne, unusedTwo } from "./functions.mjs";
export function first(n) { return usedOne(n); }
export function second(n) { return unusedOne(n); }
export const third = n => unusedTwo(n);
`,
      "functions.mjs": functions,
    },
    unused: ["unusedOne", "unusedTwo", "second", "third"],
  },
  "a namespace object of which one member is called": {
    entry: "main.mjs",
    files: {
      "main.mjs": `import * as functions from "./functions.mjs";\nconsole.log(functions.usedOne(process.argv.length + 1));\n`,
      "functions.mjs": functions,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "a barrel that passes everything on": {
    entry: "main.mjs",
    files: {
      "main.mjs": `import { usedOne } from "./barrel.mjs";\nconsole.log(usedOne(process.argv.length + 1));\n`,
      "barrel.mjs": `export * from "./functions.mjs";
export { unusedOne as renamed } from "./functions.mjs";
export * as everything from "./functions.mjs";
`,
      "functions.mjs": functions,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "members of `exports` of which one is called": {
    entry: "main.cjs",
    files: {
      "main.cjs": `const functions = require("./functions.cjs");\nconsole.log(functions.usedOne(process.argv.length + 1));\n`,
      "functions.cjs": `${commonJsFunctions}exports.usedOne = usedOne;\nexports.unusedOne = unusedOne;\nexports.unusedTwo = unusedTwo;\n`,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "an object assigned to `module.exports` and destructured": {
    entry: "main.cjs",
    files: {
      "main.cjs": `const { usedOne } = require("./functions.cjs");\nconsole.log(usedOne(process.argv.length + 1));\n`,
      "functions.cjs": `${commonJsFunctions}module.exports = { usedOne, unusedOne, unusedTwo };\n`,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "a CommonJS module imported by name": {
    entry: "main.mjs",
    files: {
      "main.mjs": `import { usedOne } from "./functions.cjs";\nconsole.log(usedOne(process.argv.length + 1));\n`,
      "functions.cjs": `${commonJsFunctions}exports.usedOne = usedOne;\nexports.unusedOne = unusedOne;\nexports.unusedTwo = unusedTwo;\n`,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "an exported object of functions": {
    entry: "main.mjs",
    files: {
      "main.mjs": `import { functions } from "./object.mjs";\nconsole.log(functions.usedOne(process.argv.length + 1));\n`,
      "object.mjs": `${commonJsFunctions}export const functions = { usedOne, unusedOne, unusedTwo };\n`,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "an object that is the default export": {
    entry: "main.mjs",
    files: {
      "main.mjs": `import functions from "./object.mjs";\nconsole.log(functions.usedOne(process.argv.length + 1));\n`,
      "object.mjs": `${commonJsFunctions}export default { usedOne, unusedOne, unusedTwo };\n`,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "what `import()` answers with, of which one member is called": {
    entry: "main.mjs",
    files: {
      "main.mjs": `const functions = await import("./functions.mjs");\nconsole.log(functions.usedOne(process.argv.length + 1));\n`,
      "functions.mjs": functions,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "what `import()` answers with, destructured in a function": {
    entry: "main.mjs",
    files: {
      "main.mjs": `async function run() {
  const { usedOne } = await import("./functions.mjs");
  console.log(usedOne(process.argv.length + 1));
}
run();
`,
      "functions.mjs": functions,
    },
    unused: ["unusedOne", "unusedTwo"],
  },
  "members of a class, and a class that nobody names": {
    entry: "main.ts",
    files: {
      "main.ts": `${globals}import { Counter } from "./counter";\nconsole.log(new Counter(process.argv.length + 1).usedMethod());\n`,
      "counter.ts": `export class Counter {
  constructor(public size: number) {}
  usedMethod(): number {
    let total = 0;
    for (let i = 0; i < this.size; i++) total += i * this.size;
    return total;
  }
  unusedMethod(): string {
    let text = "";
    for (let i = 0; i < this.size; i++) text += String(i);
    return text;
  }
  get unusedGetter(): number[] {
    const list: number[] = [];
    for (let i = 0; i < this.size; i++) list.push(i);
    return list;
  }
  static unusedStatic(size: number): Counter {
    const made = new Counter(size);
    for (let i = 0; i < size; i++) made.size -= i;
    return made;
  }
}
export class UnusedClass {
  size = 1;
  methodOfUnusedClass(n: number): number {
    for (let i = 0; i < n; i++) this.size *= 2;
    return this.size;
  }
}
`,
    },
    unused: ["unusedMethod", "unusedGetter", "unusedStatic", "methodOfUnusedClass"],
  },
  "a method that an interface declares and nobody calls": {
    entry: "main.ts",
    files: {
      "main.ts": `${globals}import { make, type Shape } from "./shapes";
const shape: Shape = make(process.argv.length + 1);
console.log(shape.usedMethod());
`,
      "shapes.ts": `export interface Shape {
  usedMethod(): number;
  unusedMethod(): string;
}
class Square implements Shape {
  constructor(public side: number) {}
  usedMethod(): number {
    let total = 0;
    for (let i = 0; i < this.side; i++) total += i * this.side;
    return total;
  }
  unusedMethod(): string {
    let text = "";
    for (let i = 0; i < this.side; i++) text += String(i);
    return text;
  }
}
class Circle implements Shape {
  constructor(public radius: number) {}
  usedMethod(): number {
    return this.radius * 3;
  }
  unusedMethod(): string {
    let text = "circle";
    for (let i = 0; i < this.radius; i++) text += String(i * 2);
    return text;
  }
}
export function make(size: number): Shape {
  return size > 1 ? new Square(size) : new Circle(size);
}
`,
    },
    unused: ["unusedMethod"],
  },
};

async function run(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  return { stdout, errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode };
}

async function build(directory: string, entry: string) {
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const report = join(directory, "report.json");
  const flags = ["--aot-report=" + report, "--aot-report-detail=functions"];
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", executable],
    directory,
  );
  expect({ errors: built.errors, exitCode: built.exitCode }).toEqual({ errors: [], exitCode: 0 });
  const { functions } = (await Bun.file(report).json()) as { functions: { name: string; codeBytes: number }[] };
  const largestCode = (name: string) =>
    Math.max(0, ...functions.filter(it => it.name === name).map(it => it.codeBytes));
  return { executable, largestCode };
}

for (const [title, { files, entry, unused }] of Object.entries(cases)) {
  test.concurrent(title, async () => {
    using dir = tempDir("aot-unused-code", files);
    const directory = String(dir);
    const { executable, largestCode } = await build(directory, entry);
    const tooLarge = unused.filter(name => largestCode(name) > largestStub);
    expect(tooLarge).toEqual([]);
    expect(await run([executable], directory)).toEqual({ stdout: "9\n", errors: [], exitCode: 0 });
  });
}

test("a member that is read under a name nobody knows keeps every function", async () => {
  using dir = tempDir("aot-unused-code-control", {
    "main.mjs": `import * as functions from "./functions.mjs";\nconsole.log(functions[process.argv[2] ?? "usedOne"](process.argv.length + 1));\n`,
    "functions.mjs": functions,
  });
  const directory = String(dir);
  const { executable, largestCode } = await build(directory, "main.mjs");
  expect(largestCode("unusedOne")).toBeGreaterThan(largestStub);
  expect(largestCode("unusedTwo")).toBeGreaterThan(largestStub);
  expect(await run([executable], directory)).toEqual({ stdout: "9\n", errors: [], exitCode: 0 });
  expect(await run([executable, "unusedOne"], directory)).toEqual({ stdout: "0123\n", errors: [], exitCode: 0 });
});
