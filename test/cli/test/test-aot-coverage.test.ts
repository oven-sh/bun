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

export function makers(flag, given = () => {
  return "given";
}) {
  const chosen = flag
    ? () => {
      return "yes";
    }
    : () => {
      return "no";
    };
  return [chosen, given];
}
`,
  "constants.js": `const STEP = 3;

export function steps(a, b) {
  return a
    ? STEP
    : b
      ? "second"
      : "third";
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
import { pick, loops, chain, byKind, makers } from "./branches.js";
import { callsWhatThrows, catches, waits, neverResumed } from "./throws.js";
import common from "./common.cjs";
import { steps } from "./constants.js";

test("branches", () => {
  expect(pick(20)).toBe("big");
  expect(pick(1)).toBe("few");
  expect(loops(0)).toBe(0);
  expect(loops(5)).toBe(9);
  expect(chain(0, 1)).toEqual([0, 1, undefined]);
  expect(byKind("b")).toBe(1);
  expect(byKind("c")).toBe(2);
  expect(common.used()).toBe(1);
  expect(makers(true).length).toBe(2);
  expect(steps(1, 0) + steps(1, 0)).toBe(6);
  expect(steps(0, 1)).toBe("second");
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
  "third.test.js": `import { pick } from "./branches.js";

describe(
  "the names of the runner are globals",
  () => {
    it("picks", () => {
      expect(
        pick(7),
      ).toBe("middle");
    });
  },
);
`,
};

// What the transpiler makes of a class hangs on the options of the project.
const classesUnder = (compilerOptions: string) => ({
  "package.json": `{ "name": "rewritten", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { ${compilerOptions} } }`,
  "entities.ts": `function column(target: any, key: string) {}
function inject(target: any, key: string | undefined, index: number) {}

export class Stored {
  @column
  name = "n";
  @column
  size?: number;
  takes(
    @inject value: number,
  ) {
    return value;
  }
}

export class NeverStored {
  @column
  name = "n";
  [column.name] = 1;
}

export class Filled {
  first = 1;
}

export class NeverFilled {
  first = 1;
}

export class Bare {
  first?: number;
}
`,
  "entities.test.ts": `import { expect, test } from "bun:test";
import { Bare, Filled, Stored } from "./entities";

for (const name of ["first", "second", "third", "fourth"]) {
  test(name, () => {
    expect(new Stored().name).toBe("n");
    expect(new Filled().first).toBe(1);
    expect(new Bare().first).toBe(undefined);
  });
}
`,
});

const standardDecorators = {
  "package.json": `{ "name": "marked", "type": "module" }`,
  "tsconfig.json": `{}`,
  "marked.ts": `function log(value: Function, context: unknown) {
  return value;
}

function plus(value: undefined, context: unknown) {
  return (initial: number) => initial + 1;
}

export class Marked {
  @log
  called() {
    return 1;
  }
  @log
  never() {
    return 2;
  }
  @plus
  counted = 1;
}

export class NeverMade {
  @log
  method() {
    return 1;
  }
}

export class Kept {
  accessor read = 1;
  accessor written = 2;
  accessor left;
  static accessor shared = 3;
}

export class Hidden {
  @log
  #method() {
    return 1;
  }
  never() {
    return this.#method();
  }
}

export class Sealed {
  @log
  #method() {
    return 1;
  }
}
`,
  "marked.test.ts": `import { expect, test } from "bun:test";
import { Kept, Marked } from "./marked";

for (const name of ["first", "second", "third", "fourth"]) {
  test(name, () => {
    const marked = new Marked();
    expect(marked.called() + marked.called()).toBe(2);
    const kept = new Kept();
    expect(kept.read).toBe(1);
    kept.written = 5;
    kept.written = 6;
  });
}
`,
};

const neverRead = {
  "package.json": `{ "name": "never-read", "type": "module" }`,
  "things.ts": `const flag = Date.now() > 0;

export const used = 1;

export const neverRead = flag
  ? "yes"
  : "no";

export class NeverUsed {
  static picked = flag
    ? "yes"
    : "no";
}

export function useless(first: boolean) {
  first
    ? "a"
    : "b";
  return 1;
}
`,
  "things.test.ts": `import { expect, test } from "bun:test";
import { used, useless } from "./things";

for (const name of ["first", "second", "third", "fourth"]) {
  test(name, () => {
    expect(used + useless(true)).toBe(2);
  });
}
`,
};

async function report(flags: string[], bunfig = "", project: Record<string, string> = files) {
  using dir = tempDir("test-aot-coverage", { ...project, "bunfig.toml": bunfig });
  await using proc = spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", ...flags],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 4 pass");
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

test("the lines of the test files are counted where the report holds them", async () => {
  const bunfig = "[test]\ncoverageSkipTestFiles = false\n";
  const [plain, compiled] = await Promise.all([report([], bunfig), report(["--aot"], bunfig)]);
  expect(plain.table).toContain("third.test.js");
  expect(compiled).toEqual(plain);
});

test.each([`"experimentalDecorators": true`, `"experimentalDecorators": true, "useDefineForClassFields": false`])(
  "classes under %s",
  async compilerOptions => {
    const project = classesUnder(compilerOptions);
    const [plain, compiled] = await Promise.all([report([], "", project), report(["--aot"], "", project)]);
    expect(plain.table).toContain("entities.ts");
    expect(compiled).toEqual(plain);
  },
);

test("standard decorators and accessor fields", async () => {
  const project = standardDecorators;
  const [plain, compiled] = await Promise.all([report([], "", project), report(["--aot"], "", project)]);
  expect(plain.table).toContain("marked.ts");
  expect(compiled).toEqual(plain);
});

test("what nothing reads runs as it does in bun test --coverage", async () => {
  const project = neverRead;
  const [plain, compiled] = await Promise.all([report([], "", project), report(["--aot"], "", project)]);
  expect(plain.table).toContain("things.ts");
  expect(compiled).toEqual(plain);
});

test("test files that are built a few at a time add their counts up", async () => {
  const [plain, compiled] = await Promise.all([report(["--parallel=2"]), report(["--aot", "--parallel=2"])]);
  expect(compiled).toEqual(plain);
});
