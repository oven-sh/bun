// `vitest/no-importing-vitest-globals` reports an `import` or a `require()` of the names that Vitest also has as
// globals. Its fix removes them, and oxlint applies it with `--fix` to every statement that the rule reports. That only
// keeps what the file does where the global of the same name takes the place of each binding that goes, and the rest
// of the file stays what it is. `bun lint --fix` applies the fix there and leaves the other statements to
// `--fix-dangerously`. No flag applies a fix whose text is wrong for the code around it.
//
// Each case is a test file that passes. It's linted as written and with each flag, with and without an oxlint config,
// and `bun test` runs it as written and after each flag. What it prints tells whether a fix changed what it does. The
// rule is for a project with Vitest's globals, so `bun test` runs the cases with `globals = "vitest"`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

const rule = "vitest/no-importing-vitest-globals";
/** Its fix removes an `export {}` from a file that has another `import` or `export`. */
const emptyExport = "no-useless-empty-export";

type Case = {
  /** The file that the rule reports. `TAG` stands for the string that starts each line the case prints. */
  text: string;
  /** What `bun test` prints for the case as written. After `--fix` it has to print the same. */
  prints: string[];
  /** The text after `--fix`. Without it, `--fix` leaves the file alone. */
  fixed?: string;
  /** The text after `--fix` where only the fix of another rule applies. */
  fixedByAnotherRule?: string;
  /** The text after each flag next to an oxlint config, where the other rule differs. */
  withOxlintConfig?: Record<Flag, string>;
  /** The text after `--fix-dangerously`, which is oxlint's, for a case that `--fix` leaves alone. */
  dangerously?: string;
  /** What the case prints after `--fix-dangerously`. Nothing, if not set. */
  printsDangerously?: string[];
  /** The reported file's name, if not `case.test.js`. */
  file?: string;
  /** The files next to it. */
  files?: Record<string, string>;
};

/** A test that prints `value`. Every case uses each name it declares, so that no other rule has a fix for it. */
const prints = (value: string, test = "test") =>
  `${test}("prints", () => {\n  expect(${value}).toBe(${value});\n  console.log(TAG, ${value});\n});\n`;
/** A hook of `@effect/vitest` runs what the callback returns. The global one keeps it for later. */
const hook = (name: string) => `let ready = 0;\n${name}(() => () => {\n  ready = 1;\n});\n` + prints("ready");

const withEmptyExportFrom = (first: string) =>
  `${first}\nexport {} from "./other.ts";\nconst name = "one";\n` + prints("name");

// oxlint takes `@effect/vitest` for Vitest: it exports Vitest's names, but `it` and two hooks are its own.
const packages = {
  "node_modules/@effect/vitest/package.json": '{ "name": "@effect/vitest", "type": "module", "main": "index.js" }',
  "node_modules/@effect/vitest/index.js":
    'import { it as base, beforeAll as all, beforeEach as each } from "vitest";\nexport * from "vitest";\n' +
    "export const it = Object.assign((name, fn) => base(name, fn), { effect: base });\n" +
    "export const beforeAll = fn => all(() => fn()());\nexport const beforeEach = fn => each(() => fn()());\n",
};

const cases: Record<string, Case> = {
  // The fix goes by the key alone.
  "require(): a key bound under another name": {
    text: 'const { vi: spy, test, expect } = require("vitest");\n' + prints("spy.fn(() => 1)()"),
    prints: ["1"],
    dangerously: "\n" + prints("spy.fn(() => 1)()"),
  },
  // `vitest` is a global too, and the same object. The fix is held back because the key isn't the name.
  "require(): a key bound under the name of another global": {
    text: 'const { vi: vitest, test, expect } = require("vitest");\n' + prints("vitest.fn(() => 1)()"),
    prints: ["1"],
    dangerously: "\n" + prints("vitest.fn(() => 1)()"),
    printsDangerously: ["1"],
  },
  "require(): a key with a pattern": {
    text: 'const { vi: { fn }, test, expect } = require("vitest");\n' + prints("fn(() => 1)()"),
    prints: ["1"],
    dangerously: "\n" + prints("fn(() => 1)()"),
  },
  // A default can be the value in use. This one isn't.
  "require(): a key with a default": {
    text: 'const { vi = null, test, expect } = require("vitest");\n' + prints("vi.fn(() => 1)()"),
    prints: ["1"],
    dangerously: "\n" + prints("vi.fn(() => 1)()"),
    printsDangerously: ["1"],
  },
  // The fix drops a property with a computed key.
  "require(): a computed key": {
    text:
      'const key = "vi";\nconst { [key]: spy, test, expect } = require("vitest");\n' + prints("spy.fn(() => key)()"),
    prints: ["vi"],
    dangerously: 'const key = "vi";\n\n' + prints("spy.fn(() => key)()"),
  },
  // Here no key is a global, and the rule reports the file.
  "require(): a computed key next to a name that stays": {
    text:
      'const key = "vi";\nconst { [key]: spy, inject } = require("vitest");\n' + prints("spy.fn(() => inject(key))()"),
    prints: ["undefined"],
    dangerously: "const key = \"vi\";\nconst { inject } = require('vitest');\n" + prints("spy.fn(() => inject(key))()"),
  },
  "require(): in the statement's last declaration": {
    text:
      'const one = 1, { test, expect } = require("vitest"), { vi: spy } = require("vitest");\n' +
      prints("spy.fn(() => one)()"),
    prints: ["1"],
    dangerously: "const one = 1;\n" + prints("spy.fn(() => one)()"),
  },
  // The fix drops the annotation.
  "require(): a type annotation": {
    file: "case.test.ts",
    text: 'const { inject, test, expect }: typeof import("vitest") = require("vitest");\n' + prints('inject("port")'),
    prints: ["undefined"],
    dangerously: "const { inject } = require('vitest');\n" + prints('inject("port")'),
    printsDangerously: ["undefined"],
  },
  // The fix drops the type arguments.
  "require(): type arguments": {
    file: "case.test.ts",
    text: 'const { inject, test, expect } = require<typeof import("vitest")>("vitest");\n' + prints('inject("port")'),
    prints: ["undefined"],
    dangerously: "const { inject } = require('vitest');\n" + prints('inject("port")'),
    printsDangerously: ["undefined"],
  },
  // A `var` can be assigned as well. This one isn't.
  "require(): a `var`": {
    text: 'var { test, expect } = require("vitest");\n' + prints("1"),
    prints: ["1"],
    dangerously: "\n" + prints("1"),
    printsDangerously: ["1"],
  },
  // Another module imports the names.
  "require(): exported": {
    file: "helpers.js",
    text: 'export const { test, expect, inject } = require("vitest");\n',
    files: { "case.test.js": 'import { test, expect, inject } from "./helpers.js";\n' + prints('inject("port")') },
    prints: ["undefined"],
    dangerously: "export const { inject } = require('vitest');\n",
  },
  // The assignment would then be to the global.
  "require(): a `let` that the file assigns": {
    text:
      'let { test, expect } = require("vitest");\nconst plain = test;\ntest = (name, fn) => plain(`${name}, wrapped`, fn);\n' +
      prints("1"),
    prints: ["1"],
    dangerously: "\nconst plain = test;\ntest = (name, fn) => plain(`${name}, wrapped`, fn);\n" + prints("1"),
  },
  // Without the declaration, the name is the outer variable's.
  "require(): in a function, under the name of an outer variable": {
    text:
      'const expect = value => ({ toBe: other => console.log(TAG, "outer", value === other) });\nexpect(1).toBe(1);\n' +
      'test("prints", () => {\n  const { expect } = require("vitest");\n  expect(2).toBe(2);\n  console.log(TAG, "done");\n});\n',
    prints: ["outer true", "done"],
    dangerously:
      'const expect = value => ({ toBe: other => console.log(TAG, "outer", value === other) });\nexpect(1).toBe(1);\n' +
      'test("prints", () => {\n  \n  expect(2).toBe(2);\n  console.log(TAG, "done");\n});\n',
    printsDangerously: ["outer true", "outer true", "done"],
  },
  "require(): `it` of @effect/vitest": {
    text: 'const { it, expect } = require("@effect/vitest");\n' + prints("1", "it.effect"),
    prints: ["1"],
    dangerously: "\n" + prints("1", "it.effect"),
  },
  "require(): `beforeEach` of @effect/vitest": {
    text: 'const { beforeEach, test, expect } = require("@effect/vitest");\n' + hook("beforeEach"),
    prints: ["1"],
    dangerously: "\n" + hook("beforeEach"),
    printsDangerously: ["0"],
  },
  "require(): in a namespace": {
    file: "case.test.ts",
    text: 'namespace Tests {\n  const { test, expect } = require("vitest");\n' + prints("1") + "}\n",
    prints: ["1"],
    dangerously: "namespace Tests {\n  \n" + prints("1") + "}\n",
    printsDangerously: ["1"],
  },

  // The fix goes by the local name alone.
  "import: another export under the name of a global": {
    text: 'import { inject as vi, test, expect } from "vitest";\n' + prints('vi("port")'),
    prints: ["undefined"],
    dangerously: "\n" + prints('vi("port")'),
  },
  // The fix drops a specifier that's imported under a string name.
  "import: a global named by a string, under another name": {
    text: 'import { "vi" as spy, test, expect } from "vitest";\n' + prints("spy.fn(() => 1)()"),
    prints: ["1"],
    dangerously: 'import {  } from "vitest";\n' + prints("spy.fn(() => 1)()"),
  },
  "import: another export named by a string": {
    text: 'import { "inject" as inject, test, expect } from "vitest";\n' + prints('inject("port")'),
    prints: ["undefined"],
    dangerously: 'import {  } from "vitest";\n' + prints('inject("port")'),
  },
  "import: `it` of @effect/vitest": {
    text: 'import { it, expect } from "@effect/vitest";\n' + prints("1", "it.effect"),
    prints: ["1"],
    dangerously: "\n" + prints("1", "it.effect"),
  },
  "import: `beforeAll` of @effect/vitest": {
    text: 'import { beforeAll, test, expect } from "@effect/vitest";\n' + hook("beforeAll"),
    prints: ["1"],
    dangerously: "\n" + hook("beforeAll"),
    printsDangerously: ["0"],
  },
  // The package can declare any of the names itself. These two are Vitest's.
  "import: the other names of @effect/vitest": {
    text:
      'import { test, expect, it as base } from "@effect/vitest";\ntest("is a test", () => {});\n' +
      prints("1", "base.effect"),
    prints: ["1"],
    dangerously:
      'import { it as base } from "@effect/vitest";\ntest("is a test", () => {});\n' + prints("1", "base.effect"),
    printsDangerously: ["1"],
  },
  // Without an `import` or an `export`, TypeScript takes the file for a script, unless `moduleDetection` is "force":
  // its names are global, and it can't have an `await`.
  "import: the last import of a TypeScript file that declares a name": {
    file: "case.test.ts",
    text: 'import { test, expect } from "vitest";\nconst name = "one";\n' + prints("name"),
    prints: ["one"],
    dangerously: '\nconst name = "one";\n' + prints("name"),
    printsDangerously: ["one"],
  },
  "import: the last import of a TypeScript file with a top-level await": {
    file: "case.test.ts",
    text: 'import { test, expect } from "vitest";\nawait Promise.resolve();\n' + prints("1"),
    prints: ["1"],
    dangerously: "\nawait Promise.resolve();\n" + prints("1"),
    printsDangerously: ["1"],
  },

  // `typescript/no-useless-empty-export` removes the `export {}` in the same pass, so it can't keep the module.
  "import: the last import of a TypeScript file that declares a name, next to `export {}`": {
    file: "case.test.ts",
    text: 'import { test, expect } from "vitest";\nexport {};\nconst name = "one";\n' + prints("name"),
    prints: ["one"],
    fixedByAnotherRule: 'import { test, expect } from "vitest";\n\nconst name = "one";\n' + prints("name"),
    dangerously: '\n\nconst name = "one";\n' + prints("name"),
    printsDangerously: ["one"],
  },
  // With an oxlint config that rule leaves the statement, because it loads a module.
  "import: the last import of a TypeScript file that declares a name, next to `export {} from`": {
    file: "case.test.ts",
    text: withEmptyExportFrom('import { test, expect } from "vitest";'),
    files: { "other.ts": "export const other = 1;\n" },
    prints: ["one"],
    fixedByAnotherRule: 'import { test, expect } from "vitest";\n\nconst name = "one";\n' + prints("name"),
    dangerously: '\n\nconst name = "one";\n' + prints("name"),
    printsDangerously: ["one"],
    withOxlintConfig: {
      "--fix": withEmptyExportFrom('import { test, expect } from "vitest";'),
      "--fix-dangerously": withEmptyExportFrom(""),
    },
  },

  // oxlint's text is `import  } from "vitest";`.
  "import: next to a default import": {
    text: 'import vitest, { test, expect } from "vitest";\n' + prints("typeof vitest"),
    prints: ["object"],
  },
  // oxlint's text leaves the `export { .. }` without the name.
  "require(): a name that the file exports": {
    file: "helpers.ts",
    text: 'const { expect, inject } = require("vitest");\nexport { expect, inject };\n',
    files: { "case.test.ts": 'import { expect, inject } from "./helpers.ts";\n' + prints('inject("port")') },
    prints: ["undefined"],
  },
  "import: a name that the file exports": {
    file: "helpers.ts",
    text: 'import { expect, inject } from "vitest";\nexport { expect, inject };\n',
    files: { "case.test.ts": 'import { expect, inject } from "./helpers.ts";\n' + prints('inject("port")') },
    prints: ["undefined"],
  },
  // oxlint's text leaves `export` to the next statement.
  "require(): exported, with no name that stays": {
    file: "helpers.js",
    text: 'export const { test, expect } = require("vitest");\nconst one = 1;\nexport { one };\n',
    files: { "case.test.js": 'import { test, expect, one } from "./helpers.js";\n' + prints("one") },
    prints: ["1"],
  },
  // The next statement would become the body of the `if`.
  "require(): a `var` that's the body of an `if`": {
    text:
      'if (typeof Bun === "undefined") var { describe } = require("vitest");\nconsole.log(TAG, typeof describe);\n' +
      prints("1"),
    prints: ["undefined", "1"],
  },
  "require(): a comment among the names": {
    text: 'const {\n  test, // the runner\n  inject,\n  expect,\n} = require("vitest");\n' + prints('inject("port")'),
    prints: ["undefined"],
  },
  "import: a comment among the names": {
    text: 'import {\n  test, // the runner\n  inject,\n  expect,\n} from "vitest";\n' + prints('inject("port")'),
    prints: ["undefined"],
  },
  "import: a comment in a statement that goes": {
    text: 'import { /* the runner */ test, expect } from "vitest";\n' + prints("1"),
    prints: ["1"],
  },
  // The comment would apply to the test.
  "import: below a `// @ts-ignore` comment": {
    text: '// @ts-ignore\nimport { test, expect } from "vitest";\n' + prints("1"),
    prints: ["1"],
  },
  // The string would become a directive.
  "import: above a string statement": {
    text: 'import { test, expect } from "vitest";\n"use strict";\n' + prints("1"),
    prints: ["1"],
  },
  // The compiler drops the type, so the string would be the first statement.
  "require(): above a type and a string statement": {
    file: "case.test.ts",
    text:
      'const { test, expect } = require("vitest");\ntype One = 1;\n"use strict";\nconst one: One = 1;\n' +
      prints("one"),
    prints: ["1"],
  },
  // Bun and esbuild take `calls++` and the `(` on a later line for a call.
  "import: between a statement that ends in `++` and a `(`": {
    text:
      'let ran = 0, calls = 0\ncalls++\nimport { test, expect } from "vitest";\n(function () { ran = 1 })()\n' +
      prints("ran + calls"),
    prints: ["2"],
  },
  // `(function () {` would continue `const id = x => x`.
  "import: between a statement without a `;` and a `(`": {
    text:
      'let ran = 0\nconst id = x => x\nimport { test, expect } from "vitest";\n(function () { ran = 1 })()\n' +
      prints("id(ran)"),
    prints: ["1"],
  },
  "import: between a statement without a `;` and a `<`": {
    file: "case.test.ts",
    text:
      'let ran = 0\nconst id = (x: number) => x\nimport { test, expect } from "vitest";\n<number>(ran = 1)\n' +
      prints("id(ran)"),
    prints: ["1"],
  },

  "require(): every key bound under its own name": {
    text:
      'const { vi: vi, test, "expect": expect, inject } = require("vitest");\n' +
      prints('vi.fn(() => inject("port"))()'),
    prints: ["undefined"],
    fixed: "const { inject } = require('vitest');\n" + prints('vi.fn(() => inject("port"))()'),
  },
  "import: a global named by a string, under its own name": {
    text: 'import { "vi" as vi, test, expect } from "vitest";\n' + prints("vi.fn(() => 1)()"),
    prints: ["1"],
    fixed: 'import {  } from "vitest";\n' + prints("vi.fn(() => 1)()"),
  },
  "import: a global under another name stays": {
    text: 'import { vi as spy, test, expect } from "vitest";\n' + prints("spy.fn(() => 1)()"),
    prints: ["1"],
    fixed: 'import { vi as spy } from "vitest";\n' + prints("spy.fn(() => 1)()"),
  },
  "import: the last import of a TypeScript file that only calls, with an await in a function": {
    file: "case.test.ts",
    text: 'import { test, expect } from "vitest";\ntest("waits", async () => {\n  await 1;\n});\n' + prints("1"),
    prints: ["1"],
    fixed: '\ntest("waits", async () => {\n  await 1;\n});\n' + prints("1"),
  },
  "import: the last import of a JavaScript file that declares a name": {
    text: 'import { test, expect } from "vitest";\nconst name = "one";\n' + prints("name"),
    prints: ["one"],
    fixed: '\nconst name = "one";\n' + prints("name"),
  },
  // The other import of Vitest stays, so the file is still a module.
  "import: next to an import of Vitest that stays, in a TypeScript file that declares a name": {
    file: "case.test.ts",
    text:
      'import { test, expect } from "vitest";\nimport { inject } from "vitest";\nconst name = "port";\n' +
      prints("inject(name)"),
    prints: ["undefined"],
    fixed: '\nimport { inject } from "vitest";\nconst name = "port";\n' + prints("inject(name)"),
  },
  // The export is of the other module's `expect`, not of the one that goes.
  "import: next to an export of the name from another module": {
    text: 'import { test, expect } from "vitest";\nexport { expect as other } from "./other.js";\n' + prints("1"),
    files: { "other.js": "export const expect = 1;\n" },
    prints: ["1"],
    fixed: '\nexport { expect as other } from "./other.js";\n' + prints("1"),
  },
  // The directive is for the line of `// @ts-nocheck`.
  "import: below a header with a directive for another comment": {
    file: "case.test.ts",
    text:
      '// eslint-disable-next-line @typescript-eslint/ban-ts-comment\n// @ts-nocheck\nimport { test, expect } from "vitest";\n' +
      prints("1"),
    prints: ["1"],
    fixed: "// eslint-disable-next-line @typescript-eslint/ban-ts-comment\n// @ts-nocheck\n\n" + prints("1"),
  },
  "import: below a comment that isn't for the next line": {
    text: '// @vitest-environment node\nimport { test, expect } from "vitest";\n' + prints("1"),
    prints: ["1"],
    fixed: "// @vitest-environment node\n\n" + prints("1"),
  },
  "require(): a comment after the statement": {
    text: 'const { test, expect } = require("vitest"); // the runner\n' + prints("1"),
    prints: ["1"],
    fixed: " // the runner\n" + prints("1"),
  },
  "require(): between a statement with a `;` and a `(`": {
    text: 'let ran = 0;\nconst { test, expect } = require("vitest");\n(function () { ran = 1 })()\n' + prints("ran"),
    prints: ["1"],
    fixed: "let ran = 0;\n\n(function () { ran = 1 })()\n" + prints("ran"),
  },
  // The second fix waits for the next pass, where its statement is the one before the `(`.
  "import: two statements between a statement without a `;` and a `(`": {
    text:
      'let ran = 0\nconst id = x => x\nimport { test } from "vitest";\nimport { expect } from "vitest";\n' +
      "(function () { ran = 1 })()\n" +
      prints("id(ran)"),
    prints: ["1"],
    fixed:
      'let ran = 0\nconst id = x => x\n\nimport { expect } from "vitest";\n(function () { ran = 1 })()\n' +
      prints("id(ran)"),
  },
};

// No flag removes a statement if the next one would then continue the one before it.
const continuations = {
  "(": "(function () { ran = 1 })()",
  "[": "[1].forEach(() => { ran = 1 })",
  "`": "`${(ran = 1)}`",
  "/": '/a/.test("a") && (ran = 1)',
  "+": "+(ran = 1)",
  "-": "-(ran = 1)",
};
for (const [first, next] of Object.entries(continuations)) {
  cases[`require(): between a statement without a \`;\` and a \`${first}\``] = {
    text: `let ran = 0\nconst id = x => x\nconst { test, expect } = require("vitest");\n${next}\n` + prints("id(ran)"),
    prints: ["1"],
  };
}

// Each name that `bun test` has as a global of Vitest. It has no `assert` or `chai`, which Vitest has.
const globals =
  "suite test describe it expectTypeOf assertType expect vitest vi beforeAll afterAll beforeEach afterEach onTestFailed onTestFinished";
for (const name of globals.split(" ")) {
  const isTheGlobal = prints(`${name} === globalThis.${name}`);
  cases[`import: \`${name}\` alone`] = {
    text: `import { ${name} } from "vitest";\n` + isTheGlobal,
    prints: ["true"],
    fixed: "\n" + isTheGlobal,
  };
  cases[`require(): \`${name}\` alone`] = {
    text: `const { ${name} } = require("vitest");\n` + isTheGlobal,
    prints: ["true"],
    fixed: "\n" + isTheGlobal,
  };
}

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined, NO_COLOR: "1" };

async function run(cwd: string, ...args: string[]) {
  await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const flags = ["--fix", "--fix-dangerously"] as const;
type Flag = (typeof flags)[number];
type Result = {
  /** How the report of the case as written offers its fix. */
  offers: "a fix" | "a dangerous fix" | "no fix" | "no report";
  prints: Record<"as written" | Flag, string[]>;
  /** The reported file after `bun lint` with the flag. */
  text: Record<Flag, string>;
  /** The same next to an `.oxlintrc.json`, where `bun lint` fixes in one pass. */
  textWithOxlintConfig: Record<Flag, string>;
};

const fileOf = (it: Case) => it.file ?? "case.test.js";
const withTag = (text: string, tag: string) => text.replaceAll("TAG", JSON.stringify(tag));
/** The cases, each with the directory that it's in and the tag that starts its lines. */
const entries = Object.entries(cases).map(([name, it], index) => ({
  name,
  it,
  directory: String(index),
  tag: `@@${index}@@`,
}));
const results = new Map<string, Result>();
let exitCodes: { asWritten: number; fixed: number } | undefined;

// Each flag has a copy of all the cases, with and without an oxlint config. A copy is linted in one run and tested in
// one run of `bun test`: a process per case and step would be some 400 of them.
beforeAll(async () => {
  const oxlintrc = JSON.stringify({
    plugins: ["vitest", "typescript"],
    categories: { correctness: "off" },
    rules: { [rule]: "warn", [`typescript/${emptyExport}`]: "warn" },
  });
  const copies = ["as written", ...flags, ...flags.map(flag => `oxlint ${flag}`)];
  const files: Record<string, string> = { ...packages };
  for (const copy of copies) {
    files[`${copy}/bunfig.toml`] = '[test]\nglobals = "vitest"\n';
    if (copy.startsWith("oxlint")) files[`${copy}/.oxlintrc.json`] = oxlintrc;
    for (const { it, directory, tag } of entries) {
      for (const [path, text] of Object.entries({ ...it.files, [fileOf(it)]: it.text })) {
        files[`${copy}/${directory}/${path}`] = withTag(text, tag);
      }
    }
  }
  using dir = tempDir("bun-lint-vitest-globals", files);
  const root = String(dir);

  const withRule = ["--rule", `${rule}: warn`, "--rule", `@typescript-eslint/${emptyExport}: warn`];
  const lint = (copy: string, ...args: string[]) => run(join(root, copy), "lint", "-f", "json", ...args);
  const lintThenTest = async (flag: Flag) => {
    await lint(flag, flag, ...withRule);
    return run(join(root, flag), "test");
  };
  const [report, asWritten, fixed, fixedDangerously] = await Promise.all([
    lint("as written", ...withRule),
    run(join(root, "as written"), "test"),
    lintThenTest("--fix"),
    lintThenTest("--fix-dangerously"),
    ...flags.map(flag => lint(`oxlint ${flag}`, flag)),
  ]);
  exitCodes = { asWritten: asWritten.exitCode, fixed: fixed.exitCode };

  type Message = { ruleId: string | null; fix?: object; suggestions?: object[] };
  if (!report.stdout.startsWith("[")) throw new Error(`bun lint printed no JSON: ${report.stdout}\n${report.stderr}`);
  const reported: { filePath: string; messages: Message[] }[] = JSON.parse(report.stdout);
  const offers = (path: string): Result["offers"] => {
    const message = reported.find(it => it.filePath === path)?.messages.find(it => it.ruleId === rule);
    if (!message) return "no report";
    return message.fix ? "a fix" : message.suggestions?.length ? "a dangerous fix" : "no fix";
  };
  const printsOf = (tested: { stdout: string }, tag: string) =>
    tested.stdout
      .split("\n")
      .filter(line => line.startsWith(tag))
      .map(line => line.slice(tag.length + 1));
  for (const { name, it, directory, tag } of entries) {
    const textOf = (copy: string) => readFileSync(join(root, copy, directory, fileOf(it)), "utf8");
    results.set(name, {
      offers: offers(join(root, "as written", directory, fileOf(it))),
      prints: {
        "as written": printsOf(asWritten, tag),
        "--fix": printsOf(fixed, tag),
        "--fix-dangerously": printsOf(fixedDangerously, tag),
      },
      text: { "--fix": textOf("--fix"), "--fix-dangerously": textOf("--fix-dangerously") },
      textWithOxlintConfig: {
        "--fix": textOf("oxlint --fix"),
        "--fix-dangerously": textOf("oxlint --fix-dangerously"),
      },
    });
  }
}, longLimit);

test("every case passes as written and after --fix", () => {
  expect(exitCodes).toEqual({ asWritten: 0, fixed: 0 });
});

for (const { name, it, tag } of entries) {
  const isFixed = it.fixed !== undefined;
  const isHeld = it.dangerously !== undefined;
  test(`${isFixed ? "--fix fixes" : isHeld ? "only --fix-dangerously fixes" : "no flag fixes"} ${name}`, () => {
    const afterFix = withTag(it.fixed ?? it.fixedByAnotherRule ?? it.text, tag);
    const afterDangerously = withTag(it.dangerously ?? it.fixed ?? it.text, tag);
    expect(results.get(name)).toEqual({
      offers: isFixed ? "a fix" : isHeld ? "a dangerous fix" : "no fix",
      prints: {
        "as written": it.prints,
        "--fix": it.prints,
        "--fix-dangerously": isHeld ? (it.printsDangerously ?? []) : it.prints,
      },
      text: { "--fix": afterFix, "--fix-dangerously": afterDangerously },
      textWithOxlintConfig: {
        "--fix": withTag(it.withOxlintConfig?.["--fix"] ?? afterFix, tag),
        "--fix-dangerously": withTag(it.withOxlintConfig?.["--fix-dangerously"] ?? afterDangerously, tag),
      },
    });
  });
}
