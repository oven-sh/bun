import { spawn } from "bun";
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
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
const FIRST = 4;
const SECOND = 5;
const WORD = "w";
const THIRD = 6;
const BESIDE_A_LENGTH = 7;
const MISSING = undefined;
const SIZE = 8;
const LEFT_OF_AN_EQUALITY = 9;
const SHORT = 10;

export function steps(a, b) {
  return a
    ? STEP
    : b
      ? "second"
      : "third";
}

export function folded(given) {
  return [FIRST + SECOND, -FIRST, \`\${SECOND}\`, WORD + "x", given + WORD];
}

export function besideWhatIsFolded() {
  return [FIRST + SECOND + THIRD, BESIDE_A_LENGTH + "abc".length, MISSING === void 0];
}

export function foldedInOneBranch(flag) {
  return flag ? 2 * SIZE : SIZE;
}

export function printedBehindWhatFollows(given) {
  return [LEFT_OF_AN_EQUALITY === given, { SHORT }];
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
import { besideWhatIsFolded, folded, foldedInOneBranch, printedBehindWhatFollows, steps } from "./constants.js";

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
  expect(folded(1).length + folded(2).length).toBe(10);
  expect(besideWhatIsFolded()).toEqual(besideWhatIsFolded());
  expect(foldedInOneBranch(true) + foldedInOneBranch(true)).toBe(32);
  expect(printedBehindWhatFollows(9)).toEqual(printedBehindWhatFollows(9));
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

const fourTests = (imports: string, body: string) => `import { test } from "bun:test";
${imports}
for (const name of ["first", "second", "third", "fourth"]) test(name, () => { ${body} });
`;

const withoutSideEffects = {
  "package.json": `{ "name": "pure", "type": "module", "sideEffects": false }`,
  "index.ts": `export { used } from "./used";\nexport { unused } from "./unused";\n`,
  "used.ts": `export const used = () => 1;\n`,
  "unused.ts": `export const unused = () => 2;\n`,
  "index.test.ts": fourTests(`import { used } from "./index";`, "used();"),
};

// A build has a shorter way for each.
const shortcuts = {
  "package.json": `{ "name": "shortcuts", "type": "module" }`,
  "other.js": `export const a = 1, b = () => 2, fail = () => null.a;\n`,
  "known.js": `import * as other from "./other.js";
const ON = true;
export const chains = () => [other?.a, other?.b(), other.b?.(), Math?.PI, Math.max?.(1), JSON?.parse("1")];
export const folded = v => [ON ? 1 : 2, ON && v, ON || v, ON ?? v, v?.[ON ? "a" : "b"]];
export const spreads = v => [{ ...(v && { v }) }, { ...(v ? { v } : {}) }, [...(v ? [v] : [])], { ...(v && (v > 1 ? { v } : {})), ...(v ? { v } : v) }];
export const again = (n, step = 1) => (n > 0 ? again(n - step) : 0);
export function steps(n) {
  let i = 0;
  while (
    ++i < n
  );
  const unmade = () => 1;
  return i;
}
export function unread() {
  other?.a;
  try {
    other?.fail();
  } catch {}
}
export const constants = v => [v?.[true ? "a" : "b"], !(true && 1), (v, 0) && v, 0 ? 1 : v ? 2 : 3];
export const inside = v => [(true && null)?.a, v && !(true && 1), !(true && !(true && 1))];
export const links = v => [v?.toFixed(true ? 1 : 2), v?.toFixed[true ? "a" : "b"]];
export const dead = v => (v, 0) && import("./missing.js");
export function resolves(v, name = "os") {
  try {
    require.resolve(v ? "bun:os" : name);
    require.resolve(v ? name : (name, 1) ? "bun:os" : name);
  } catch {}
}
export function tests(v) {
  if (v) {
  }
  if (false) v++;
  if (v) for (const a of [v, !(true && 1)]);
  while (!1) break;
  console.log(v || 1);
}
export function reflects() {
  const unnamed = true && function () {};
  return unnamed.name || String(() => true && unnamed).includes("true") || 1;
}
export function countDown(v) {
  function down(n, step = 1) {
    if (n <= 0) return 0;
    return down(n - step, 1);
  }
  return down(v, 1);
}
export function firstStep(n) {
  let i = Symbol();
  try {
    while (++i < n && n);
  } catch {}
}
export function declarators() {
  const a = () => 1,
    b = () => a();
  const sum = b();
  return sum;
}
export async function suspends() {
  for (let i = 0; i < 2; i++) if (i === 1) await null;
}
`,
  "call.cjs": `exports.default = function () {};\nmodule.exports = exports.default;\n`,
  "loader.cjs": `exports.dead = false && (module || Object());
const make = n => class { get() { return n || 1; } };
const One = make(1), Two = make(0);
new One().get(), new Two().get();
`,
  "held.cjs": `const limit = 3;\nconst held = { limit };\nmodule.exports = held;\n`,
  "owner.cjs": `exports.read = 1;\n`,
  "alias.cjs": `var owner = require("./owner.cjs");
Object.defineProperty(exports, "read", { enumerable: true, get: function () { return owner.read; } });
`,
  "reads.js": `export { read } from "./alias.cjs";\nexport { limit } from "./held.cjs";\n`,
  "minified.cjs": `var a, call = (a = require("./call.cjs")) && a.__esModule ? a : { default: a };
(0, call.default)();
`,
  "webpack.cjs": `(() => {
  var modules = { 1: (module, exports) => { exports.a = 1; } }, cache = {};
  function load(id) {
    var cached = cache[id];
    if (void 0 !== cached) return cached.exports;
    var module = cache[id] = { exports: {} };
    return modules[id](module, module.exports, load), module.exports;
  }
  globalThis.loaded = load(1).a;
})();
`,
  "inner.cjs": `exports.shown = function () {};\nexports.hidden = function () {};\n`,
  "emitted.cjs": `"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
  for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
var inner = require("./inner.cjs");
Object.defineProperty(exports, "alias", { enumerable: true, get: function () { return inner.shown; } });
__exportStar(require("./inner.cjs"), exports);
`,
  "bundled.js": `var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => { exports.a = 1; });
export const a = require_a().a + require_a().a;
`,
  "shortcuts.test.js": fourTests(
    `import * as known from "./known.js"; import { alias, shown } from "./emitted.cjs";
    import "./reads.js"; import "./bundled.js"; import "./loader.cjs"; import "./minified.cjs"; import "./webpack.cjs";`,
    "for (const f of [...Object.values(known), alias, shown]) f(0), f(2), f(null);",
  ),
};

async function report(flags: string[], bunfig = "", project: Record<string, string> = files, folder = "app") {
  using dir = tempDir("test-aot-coverage", { app: { ...project, "bunfig.toml": bunfig } });
  symlinkSync(join(String(dir), "app"), join(String(dir), "link"), "junction");
  const cwd = join(String(dir), folder);
  await using proc = spawn({
    cmd: [bunExe(), "test", ...["text", "lcov", "json"].map(name => `--coverage-reporter=${name}`), ...flags],
    cwd,
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
    lcov: readFileSync(join(cwd, "coverage", "lcov.info"), "utf8"),
    json: readFileSync(join(cwd, "coverage", "coverage-final.json"), "utf8").replaceAll(basename(String(dir)), ""),
    warnings: lines.filter(line => line.startsWith("warn: ") && line.includes("coverage")),
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

test('a file that nothing uses is listed though the package says "sideEffects": false', async () => {
  const project = withoutSideEffects;
  const [plain, compiled] = await Promise.all([report([], "", project), report(["--aot"], "", project)]);
  expect(plain.lcov).toContain("FNDA:0,unused");
  expect(compiled).toEqual(plain);
});

test("what a build knows is counted as it is written", async () => {
  const flags = ["--drop=console"];
  const [plain, compiled] = await Promise.all([
    report(flags, "", shortcuts),
    report(["--aot", ...flags], "", shortcuts),
  ]);
  expect(plain.lcov).toContain("FNDA:1,load");
  expect(compiled).toEqual(plain);
});

test("the code in a string is not counted", async () => {
  const project = {
    "strings.cjs": `new Function("a", "return a || 1")();\n`,
    "strings.test.js": fourTests(`import "./strings.cjs";`, ""),
  };
  const [plain, compiled] = await Promise.all([report([], "", project), report(["--aot"], "", project)]);
  expect(plain.lcov).toContain("FNF:0");
  expect(compiled).toEqual(plain);
});

test("an import finds a getter that is not enumerable, as it does without --coverage", async () => {
  const project = { ...shortcuts, "alias.cjs": shortcuts["alias.cjs"].replace("enumerable: true, ", "") };
  expect((await report(["--aot"], "", project)).exitCode).toBe(0);
});

test("coverageIgnoreSourcemaps is said to have no effect", async () => {
  const bunfig = "[test]\ncoverageIgnoreSourcemaps = true\n";
  const [plain, compiled] = await Promise.all([report([], "", neverRead), report(["--aot"], bunfig, neverRead)]);
  expect(compiled).toEqual({
    ...plain,
    warnings: [`warn: "coverageIgnoreSourcemaps" has no effect on the files that --aot compiles`],
  });
});

test("a bundle is reported as if it had no source map", async () => {
  const debugId = "0123456789ABCDEF64756E2164756E21";
  const project = {
    "a.js": "",
    "bundle.js": `// @bun\nObject();\n//# debugId=${debugId}\n`,
    "a.test.js": fourTests(`import "./bundle.js";`, ""),
  };
  const map = JSON.stringify({ version: 3, sources: ["a.js"], sourcesContent: [""], mappings: "", debugId });
  const [plain, compiled] = await Promise.all([
    report([], "", project),
    report(["--aot"], "", { ...project, "bundle.js.map": map }),
  ]);
  expect(compiled).toEqual(plain);
});

// Only on Windows does the working directory keep the link.
test.each(["app", "link"])("a compiled file is known by the path that it has on disk, from %s", async folder => {
  const project = {
    "in/setup.js": "Object();\n",
    "in/loaded.js": "Object();\n",
    "in/unloaded.js": "Object();\n",
    "in/ignored.js": "Object();\n",
    "a.test.js": fourTests(
      `import { codeCoverageForFile } from "bun:jsc"; import "./in/loaded.js"; import "./in/ignored.js";`,
      `codeCoverageForFile(require.resolve("./in/loaded.js"));`,
    ),
  };
  const bunfig = `[test]\npreload = "./in/setup.js"\ncoverageSkipTestFiles = true\ncoverageInclude = ["in", "!in/ig*"]\n`;
  const [plain, compiled] = await Promise.all([[], ["--aot"]].map(flags => report(flags, bunfig, project, folder)));
  expect(plain.lcov.match(/(?<=^SF:).*/gm)).toEqual([join("in", "loaded.js"), join("in", "unloaded.js")]);
  expect(compiled).toEqual(plain);
});

test("test files that are built a few at a time add their counts up", async () => {
  const [plain, compiled] = await Promise.all([report(["--parallel=2"]), report(["--aot", "--parallel=2"])]);
  expect(compiled).toEqual(plain);
});
