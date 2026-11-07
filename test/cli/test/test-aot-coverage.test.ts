import { spawn } from "bun";
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../../aot/supported";

setDefaultTimeout(60_000);

// Of each file about half runs.
const files = {
  "package.json": `{ "name": "covered", "type": "module" }`,
  "tsconfig.json": `{}`,
  "branches.js": `export function pick(n) {
  if (n > 10) {
    return "big";
  } else if (n > 5) {
    return "middle";
  } else {
    n += 1;
  }
  const label = n > 2
    ? "some"
    : "few";
  return label;
}

export function loops(n) {
  if (!n) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (i === 2) continue;
    if (i === 7) break;
    total += i;
  }
  while (total > 100) {
    total -= 100;
  }
  for (const key in { a: 1 }) {
    total += key.length;
  }
  return total;
}

export function chain(a, b) {
  const both = a &&
    b;
  const either = a ||
    b;
  const given = a
    ?.first
    ?.second;
  return [both, either, given];
}

export function byKind(kind) {
  switch (kind) {
    case "a":
    case "b":
      return 1;
    case "c":
      kind = "d";
    case "d":
      return 2;
    default:
      return 3;
  }
}

export function neverCalled() {
  function inside() {
    return 1;
  }
  return inside();
}
`,
  "throws.js": `function fails() {
  throw new Error("no");
}

export function callsWhatThrows() {
  let before = 1;
  fails();
  before = 2;
  return before;
}

export function catches(shouldThrow) {
  let seen = "";
  try {
    if (shouldThrow) fails();
    seen += "t";
  } catch (error) {
    seen += "c";
  } finally {
    seen += "f";
  }
  return seen;
}

export async function waits(promise) {
  const value = await promise;
  return value * 2;
}

export function* neverResumed() {
  yield 1;
}
`,
  "classes.ts": `export enum Color {
  Red,
  Green,
}

export namespace Geometry {
  export function area(size: number): number {
    return size ** 2;
  }
}

export class Point {
  x = 1;
  static origin = new Point();
  constructor(public label: string = "p") {
    if (label === "q") {
      this.x = 2;
    }
  }
  get length() {
    return this.x;
  }
  scale(by: number) {
    return this.x * by;
  }
}

export class NeverMade {
  field = 1;
  callback = () => {
    return 2;
  };
}

export const greeting = (名前: string) => 名前 ? "はい 😀 " + 名前 : "いいえ";
`,
  "common.cjs": `function used() {
  return 1;
}
function unused() {
  return 2;
}
module.exports = { used, unused };
`,
  "first.test.js": `import { expect, test } from "bun:test";
import { pick, loops, chain, byKind } from "./branches.js";
import { callsWhatThrows, catches, waits, neverResumed } from "./throws.js";
import common from "./common.cjs";

test("branches", () => {
  expect(pick(20)).toBe("big");
  expect(pick(1)).toBe("few");
  expect(loops(0)).toBe(0);
  expect(loops(5)).toBe(9);
  expect(chain(0, 1)).toEqual([0, 1, undefined]);
  expect(byKind("b")).toBe(1);
  expect(byKind("c")).toBe(2);
  expect(common.used()).toBe(1);
});

test("throws", async () => {
  expect(() => callsWhatThrows()).toThrow("no");
  expect(catches(false)).toBe("tf");
  await expect(waits(Promise.reject(new Error("rejected")))).rejects.toThrow("rejected");
  neverResumed();
});
`,
  "second.test.ts": `import { expect, test } from "bun:test";
import { pick } from "./branches.js";
import { Color, Point, greeting } from "./classes";

test("classes", () => {
  expect(Color.Green).toBe(1);
  expect(new Point().length).toBe(1);
  expect(greeting("a")).toContain("a");
  expect(pick(7)).toBe("middle");
});
`,
};

async function report(flags: string[], bunfig = "") {
  using dir = tempDir("test-aot-coverage", { ...files, "bunfig.toml": bunfig });
  await using proc = spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", ...flags],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 3 pass");
  const lines = (stdout + stderr).split("\n");
  const rules = lines.flatMap((line, index) => (/^-+\|-+\|/.test(line) ? [index] : []));
  return {
    table: lines.slice(rules[0], rules[2] + 1).join("\n"),
    lcov: readFileSync(join(String(dir), "coverage", "lcov.info"), "utf8"),
    exitCode,
  };
}

test("bun test --aot --coverage reports what bun test --coverage reports", async () => {
  const [plain, compiled] = await Promise.all([report([]), report(["--aot"])]);
  expect(plain.table).toContain("branches.js");
  expect(plain.table).toContain("classes.ts");
  expect(compiled).toEqual(plain);
  expect(compiled.exitCode).toBe(0);
});

test("a coverage threshold that is not met fails a compiled run too", async () => {
  const bunfig = "[test]\ncoverageThreshold = 0.99\n";
  const [plain, compiled] = await Promise.all([report([], bunfig), report(["--aot"], bunfig)]);
  expect(plain.exitCode).toBe(1);
  expect(compiled).toEqual(plain);
});

test("test files that are built a few at a time add their counts up", async () => {
  const [plain, compiled] = await Promise.all([report(["--parallel=2"]), report(["--aot", "--parallel=2"])]);
  expect(compiled).toEqual(plain);
});

// https://github.com/oven-sh/bun/issues/15538
// The project is a package folder of node_modules. The compiler decides which files count their executions by the
// rule of the coverage gate, so a compiled run lists the files of the project, and no file of a package.
test("a project in a package folder of node_modules gets the rows of a run without --aot", async () => {
  using dir = tempDir("test-aot-coverage", {
    "node_modules/my-pkg": {
      "cake.ts": `export const bake = () => 5;\n`,
      "tests/cake.test.ts": `import { expect, test } from "bun:test";
import { bake } from "../cake.ts";
import { nested } from "nested";
import { hoisted } from "hoisted";
test("bake", () => expect(bake() + nested() + hoisted()).toBe(5));
`,
      "node_modules/nested/index.js": `export const nested = () => 0;\n`,
    },
    "node_modules/hoisted/index.js": `export const hoisted = () => 0;\n`,
  });
  const rows = async (cwd: string, flags: string[]) => {
    await using proc = spawn({
      cmd: [bunExe(), "test", "--coverage", ...flags],
      cwd: join(String(dir), cwd),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A row of the table is ` <file> | % Funcs | % Lines | Uncovered Line #s`. A debug build also lists the test file.
    const rows = [...(stdout + stderr).matchAll(/^ (\S+) +\|(.*)$/gm)]
      .map(row => [row[1].replaceAll("\\", "/"), ...row[2].split("|").map(cell => cell.trim())])
      .filter(([file]) => !file.endsWith(".test.ts"));
    return { cwd, flags, rows, exitCode };
  };
  const starts = { "node_modules/my-pkg": "cake.ts", "node_modules/my-pkg/tests": "../cake.ts" };
  const runs = [[], ["--aot"]].flatMap(flags => Object.entries(starts).map(([cwd, file]) => ({ cwd, flags, file })));
  expect(await Promise.all(runs.map(({ cwd, flags }) => rows(cwd, flags)))).toEqual(
    runs.map(({ cwd, flags, file }) => ({ cwd, flags, rows: [[file, "100.00", "100.00", ""]], exitCode: 0 })),
  );
});
