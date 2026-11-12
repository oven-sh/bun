// Bun runs a file as CommonJS or as an ES module, by its statements. `bun test` gives a file the globals of `bun:test`
// or of `vitest`, by the modules that it loads. So a fix that adds, removes or retypes an `import`, an `export` or a
// `require()` can change what a passing test does, and `bun lint --fix` leaves such a fix to `--fix-dangerously`.
//
// "how Bun runs a file" has what Bun does with each kind of statement. The checks in src/lint/utils/run_mode.rs copy
// that, so if a case there fails, they have to follow.
//
// Every other case is a test file that passes. `bun test` runs it as written, after `--fix` and after
// `--fix-dangerously`, and the file prints how it runs.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

type Files = Record<string, string>;

const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

async function run(cwd: string, ...args: string[]) {
  await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** "strict" in an ES module, "sloppy" in CommonJS without `"use strict"`. */
const mode = '((function () { return this === undefined; })() ? "strict" : "sloppy")';

describe("how Bun runs a file", () => {
  // `arguments` is only there at the top level of CommonJS. Neither line has a name that asks for CommonJS.
  const probe = (name: string) =>
    `const isCommonJS = typeof arguments !== "undefined";\n` +
    `test("probe", () => {\n  console.log("@@${name}@@", isCommonJS ? "commonjs" : "module", typeof jest === "undefined" ? "vitest" : "bun:test");\n});\n`;
  const file = (name: string, ...lines: string[]) => ({ [name]: lines.map(it => it + "\n").join("") + probe(name) });
  const requires = 'const required = require("./dep.cjs"); void required;';
  const support: Files = {
    "dep.cjs": "module.exports = { dep: 1 };\n",
    "dep.ts": "export const dep = 1;\nexport type T = number;\n",
  };

  /** What the file is with no `"type"` in package.json, with `"commonjs"` and with `"module"`. */
  type Formats = [none: string, commonjs: string, module: string];
  const all = (format: string): Formats => [format, format, format];
  const formats: [Files, Formats][] = [
    // Nothing in the file asks for either.
    [file("nothing.test.js"), ["module", "commonjs", "module"]],
    [file("type-import.test.ts", 'import type { T } from "./dep.ts";', "let t: T | undefined; void t;"), all("module")],
    // These ask for CommonJS.
    [file("require.test.js", requires), ["commonjs", "commonjs", "module"]],
    [
      file("require-in-function.test.js", `function load() { ${requires} }`, "void load;"),
      ["commonjs", "commonjs", "module"],
    ],
    [file("dirname.test.js", "void __dirname;"), ["commonjs", "commonjs", "module"]],
    [file("filename.test.js", "void __filename;"), ["commonjs", "commonjs", "module"]],
    [file("use-strict.test.js", '"use strict";'), ["commonjs", "commonjs", "module"]],
    [file("import-equals.test.ts", 'import dep = require("./dep.cjs"); void dep;'), ["commonjs", "commonjs", "module"]],
    // A call that can't run doesn't.
    [file("dead-require.test.js", `if (false) { ${requires} }`), ["module", "commonjs", "module"]],
    // An import that Bun keeps makes an ES module, used or not. A type-only one does that with `"type": "commonjs"`.
    [file("import.test.js", 'import { dep } from "./dep.ts"; void dep;', requires), all("module")],
    [file("unused-import.test.ts", 'import { dep } from "./dep.ts";', requires), all("module")],
    [
      file("import-of-type.test.ts", 'import { T } from "./dep.ts";', "let t: T | undefined; void t;", requires),
      all("module"),
    ],
    [file("empty-import.test.ts", 'import {} from "./dep.ts";', requires), all("module")],
    [file("side-effect-import.test.js", 'import "./dep.ts";', requires), all("module")],
    [
      file(
        "type-import-require.test.ts",
        'import type { T } from "./dep.ts";',
        "let t: T | undefined; void t;",
        requires,
      ),
      ["commonjs", "module", "module"],
    ],
    [
      file(
        "inline-type-import.test.ts",
        'import { type T } from "./dep.ts";',
        "let t: T | undefined; void t;",
        requires,
      ),
      ["commonjs", "module", "module"],
    ],
    [file("dynamic-import.test.js", 'void import("./dep.ts");', requires), ["commonjs", "commonjs", "module"]],
    // Any `export` makes an ES module.
    [file("empty-export.test.js", "export {};", requires), all("module")],
    [file("export.test.js", "export const a = 1;", requires), all("module")],
    [file("export-type.test.ts", "type U = number;", "export type { U };", requires), all("module")],
    [file("export-interface.test.ts", "export interface U { a: number }", requires), all("module")],
    [file("export-star.test.js", 'export * from "./dep.ts";', requires), all("module")],
    [
      file("namespace-export.test.ts", "namespace N { export const a = 1; }", "void N;", requires),
      ["commonjs", "commonjs", "module"],
    ],
    // `module`, `exports`, and a `this` outside of every function in a file without `import` or `export`.
    [file("module-exports.test.js", "module.exports.a = 1;"), all("commonjs")],
    [file("exports.test.js", "exports.a = 1;"), all("commonjs")],
    [
      file(
        "type-import-module.test.ts",
        'import type { T } from "./dep.ts";',
        "let t: T | undefined; void t;",
        "module.exports.a = 1;",
      ),
      all("commonjs"),
    ],
    [file("this.test.js", "const top = this; void top;"), all("commonjs")],
    [file("this-in-arrow.test.js", "const top = () => this; void top;"), all("commonjs")],
    [file("this-in-function.test.js", "function f() { return this; } void f;"), ["module", "commonjs", "module"]],
    [
      file("this-import.test.js", 'import { dep } from "./dep.ts"; void dep;', "const top = this; void top;"),
      all("module"),
    ],
    [
      file(
        "this-type-import.test.ts",
        'import type { T } from "./dep.ts";',
        "let t: T | undefined; void t;",
        "const top = this; void top;",
      ),
      all("module"),
    ],
    // An `import` that Bun keeps and `module` don't go together.
    [
      file("import-module.test.js", 'import { dep } from "./dep.ts"; void dep;', "module.exports.a = 1;"),
      all("no load"),
    ],
  ];

  /** Whether the file has the globals of `vitest`. */
  const flavors: [Files, "vitest" | "bun:test"][] = [
    [file("no-vitest.test.js"), "bun:test"],
    [file("jest-globals.test.js", 'import { test as t } from "@jest/globals"; void t;'), "bun:test"],
    [file("bun-test.test.js", 'import { test as t } from "bun:test"; void t;'), "bun:test"],
    [file("vitest-import.test.js", 'import { vi } from "vitest"; void vi;'), "vitest"],
    [file("vitest-unused-import.test.ts", 'import { vi } from "vitest";'), "vitest"],
    [
      file("vitest-import-of-type.test.ts", 'import { Mock } from "vitest";', "let m: Mock | undefined; void m;"),
      "vitest",
    ],
    [file("vitest-empty-import.test.ts", 'import {} from "vitest";'), "vitest"],
    [file("vitest-side-effect-import.test.js", 'import "vitest";'), "vitest"],
    [file("vitest-namespace.test.ts", 'import * as all from "vitest";'), "vitest"],
    [file("vitest-type-and-value.test.ts", 'import { type Mock, vi } from "vitest";'), "vitest"],
    [
      file("vitest-type-import.test.ts", 'import type { Mock } from "vitest";', "let m: Mock | undefined; void m;"),
      "bun:test",
    ],
    [
      file(
        "vitest-inline-type-import.test.ts",
        'import { type Mock } from "vitest";',
        "let m: Mock | undefined; void m;",
      ),
      "bun:test",
    ],
    [file("vitest-export.test.js", 'export { vi } from "vitest";'), "vitest"],
    [file("vitest-empty-export.test.js", 'export {} from "vitest";'), "vitest"],
    [file("vitest-export-star.test.js", 'export * from "vitest";'), "vitest"],
    [file("vitest-export-type.test.ts", 'export type { Mock } from "vitest";'), "bun:test"],
    [file("vitest-require.test.js", 'const all = require("vitest"); void all;'), "vitest"],
    [file("vitest-require-in-function.test.js", 'function load() { return require("vitest"); } void load;'), "vitest"],
    [file("vitest-dead-require.test.js", 'if (false) { require("vitest"); }'), "bun:test"],
    [file("vitest-import-equals.test.ts", 'import all = require("vitest");'), "vitest"],
    [file("vitest-dynamic-import.test.js", 'void import("vitest");'), "vitest"],
  ];

  test.concurrent.each([
    ["no type", {}, 0],
    ['"type": "commonjs"', { "package.json": '{ "type": "commonjs" }' }, 1],
    ['"type": "module"', { "package.json": '{ "type": "module" }' }, 2],
  ] as const)(
    "as CommonJS or as an ES module: %s",
    async (_, packageJson, column) => {
      using dir = tempDir(
        "bun-lint-run-mode-format",
        Object.assign({}, support, packageJson, ...formats.map(it => it[0])),
      );
      const { stdout } = await run(String(dir), "test");
      const found = Object.fromEntries(
        formats.flatMap(([files]) =>
          Object.keys(files).map(name => {
            const line = stdout.split("\n").find(line => line.startsWith(`@@${name}@@`));
            return [name, line?.split(" ")[1] ?? "no load"];
          }),
        ),
      );
      expect(found).toEqual(
        Object.fromEntries(formats.map(([files, expected]) => [Object.keys(files)[0], expected[column]])),
      );
    },
    longLimit,
  );

  test.concurrent(
    "with the globals of bun:test or of vitest",
    async () => {
      using dir = tempDir("bun-lint-run-mode-globals", Object.assign({}, ...flavors.map(it => it[0])));
      const { stdout } = await run(String(dir), "test");
      const found = Object.fromEntries(
        flavors.map(([files]) => {
          const name = Object.keys(files)[0];
          return [
            name,
            stdout
              .split("\n")
              .find(line => line.startsWith(`@@${name}@@`))
              ?.split(" ")[2] ?? "no load",
          ];
        }),
      );
      expect(found).toEqual(Object.fromEntries(flavors.map(([files, expected]) => [Object.keys(files)[0], expected])));
    },
    longLimit,
  );

  test.concurrent(
    "the globals and the exports of the test modules",
    async () => {
      // Every name that a fix of these rules can write, or leave as a global.
      const names = [
        ...["test", "it", "describe", "expect", "expectTypeOf", "beforeAll", "beforeEach", "afterEach", "afterAll"],
        ...["jest", "vi", "xit", "xtest", "xdescribe", "onTestFinished", "aroundEach", "aroundAll"],
        ...["suite", "vitest", "onTestFailed", "assertType", "assert", "chai", "bench", "fit", "fdescribe", "pending"],
      ];
      const globals = `test("globals", () => {\n  console.log("@@globals@@", JSON.stringify({ ${names.map(it => `${it}: typeof ${it} !== "undefined"`).join(", ")} }));\n});\n`;
      using dir = tempDir("bun-lint-run-mode-names", {
        "of-bun.test.js": globals,
        "of-vitest.test.js": `import "vitest";\n${globals}`,
        "exports.test.js":
          'import * as vitest from "vitest";\nimport * as jestGlobals from "@jest/globals";\nimport * as bunTest from "bun:test";\n' +
          'test("exports", () => {\n  const names = it => Object.keys(it).filter(it => it !== "default").sort();\n' +
          '  console.log("@@exports@@", JSON.stringify([names(vitest), names(jestGlobals), names(bunTest)]));\n});\n',
      });
      const outputs = await Promise.all(
        ["of-bun.test.js", "of-vitest.test.js", "exports.test.js"].map(name => run(String(dir), "test", `./${name}`)),
      );
      const [ofBun, ofVitest, [vitest, jestGlobals, bunTest]] = outputs.map(({ stdout }) =>
        JSON.parse(
          stdout
            .split("\n")
            .find(line => line.startsWith("@@"))!
            .replace(/^@@\w+@@ /, ""),
        ),
      );
      const defined = (globals: Record<string, boolean>) => names.filter(it => globals[it]);
      const shared = names.slice(0, 9);
      const ofBunOnly = ["jest", "xit", "xtest", "xdescribe"];
      const ofVitestOnly = ["suite", "vitest", "onTestFailed", "assertType"];
      expect(defined(ofBun)).toEqual([
        ...shared,
        "jest",
        "vi",
        "xit",
        "xtest",
        "xdescribe",
        "onTestFinished",
        "aroundEach",
        "aroundAll",
      ]);
      expect(defined(ofVitest)).toEqual([
        ...shared,
        "vi",
        "onTestFinished",
        "aroundEach",
        "aroundAll",
        ...ofVitestOnly,
      ]);
      expect(defined(ofVitest).filter(it => ofBunOnly.includes(it))).toEqual([]);
      const exports = [
        ...["afterAll", "afterEach", "aroundAll", "aroundEach", "beforeAll", "beforeEach", "describe", "expect"],
        ...["expectTypeOf", "it", "jest", "mock", "onTestFinished", "setDefaultTimeout", "setSystemTime", "spyOn"],
        ...["test", "vi", "xdescribe", "xit", "xtest"],
      ];
      expect(jestGlobals).toEqual(exports);
      expect(bunTest).toEqual(exports);
      expect(vitest).toEqual(
        [...exports, "TestRunner", "assertType", "inject", "onTestFailed", "suite", "vitest"].sort(),
      );
    },
    longLimit,
  );
});

type Case = {
  /** The file that the rule reports. In it and in `files`, `TAG` stands for a string that marks what the case prints. */
  text: string;
  /** Its name, if not `a.test.js`. */
  file?: string;
  /** The files next to it. */
  files?: Files;
  /** What `bun test` prints for the file as written. */
  prints: string[];
  /**
   * What it prints after `--fix-dangerously`, for a case whose fix `--fix` holds back. Nothing if the file no longer
   * loads. Without it, `--fix` applies the fix, and the file prints the same as before.
   */
  dangerously?: string[];
  /** The reported file once the fix is applied. */
  fixed?: string;
  /** True if the rule reports the fixed file too. */
  isStillReported?: boolean;
};

/** A test that prints how the file runs. */
const prints = (...what: string[]) => `test("prints", () => {\n  console.log(TAG, ${what.join(", ")});\n});\n`;
/** The same, and whether `test` passes the test context of "vitest" to the function. */
const printsWithContext = (...what: string[]) =>
  `test("prints", function () {\n  console.log(TAG, arguments.length === 0 ? "no context" : "context", ${what.join(", ")});\n});\n`;
const globals = 'typeof jest === "undefined" ? "of vitest" : "of bun:test"';
const math = { "math.js": "export const add = (a, b) => a + b;\n" };
const point = { "point.ts": "export type Point = { x: number };\nexport const origin = { x: 0 };\n" };
const cjs = { "dep.cjs": "module.exports = { one: 1 };\n" };

/** The other rules off, so that `--fix-dangerously` only applies the fix of the rule. */
const only = (rule: string, options = "") =>
  `[lint.rules]\n"eslint/*" = "off"\n"@typescript-eslint/*" = "off"\n"${rule}" = ${options ? `["warn", ${options}]` : '"warn"'}\n`;

// A package that the Vitest rules take for Vitest, and `bun test` doesn't.
const packages: Files = {
  "node_modules/vite-plus/package.json":
    '{ "name": "vite-plus", "type": "module", "exports": { "./test": "./test.js" } }',
  "node_modules/vite-plus/test.js": 'export * from "vitest";\n',
};

const groups: { name: string; rule: string; config: Files; cases: Record<string, Case> }[] = [
  {
    name: "vitest/prefer-importing-vitest-globals",
    rule: "vitest/prefer-importing-vitest-globals",
    config: { "bunfig.toml": only("vitest/prefer-importing-vitest-globals"), ...packages },
    cases: {
      // The file's first import of `vitest` gives it the globals of `vitest`.
      "the first import of vitest": {
        text: 'import { add } from "./math.js";\n' + prints(globals, "add(1, 2)"),
        files: math,
        prints: ["of bun:test 3"],
        dangerously: ["of vitest 3"],
      },
      "with a global jest": {
        text: 'const { one } = require("./dep.cjs");\njest.setTimeout(1000);\n' + prints("one"),
        files: cjs,
        prints: ["1"],
        dangerously: [],
      },
      "for a module that the file loads": {
        text: 'import { globals } from "./helper.js";\n' + prints("globals()"),
        files: { "helper.js": `export const globals = () => (${globals});\n` },
        prints: ["of bun:test"],
        dangerously: ["of vitest"],
      },
      "beside a type import of vitest": {
        file: "a.test.ts",
        text: 'import type { Mock } from "vitest";\nexport let mock: Mock | undefined;\n' + prints(globals),
        prints: ["of bun:test"],
        dangerously: ["of vitest"],
      },
      // An `import` makes a CommonJS file an ES module.
      "an import in a CommonJS file": {
        text: 'const vitest = require("vitest");\n' + prints("typeof vitest.vi", mode),
        prints: ["object sloppy"],
        dangerously: ["object strict"],
      },
      "an import in a file with module.exports": {
        text: 'const vitest = require("vitest");\nmodule.exports = { vitest };\n' + prints("typeof vitest.vi"),
        prints: ["object"],
        dangerously: [],
      },
      // `fit` is no export of "vitest", and the global is only looked up where it's used.
      "a name that vitest lacks": {
        text:
          'import { vi } from "vitest";\ntest.skip("later", () => {\n  fit("too", () => {});\n});\n' +
          prints("typeof vi.fn"),
        prints: ["function"],
        dangerously: [],
      },
      // The file has the globals of `bun:test`, whatever the package gives it.
      "a name from another package": {
        text: 'import { it } from "vite-plus/test";\nit("runs", () => {});\n' + printsWithContext(globals),
        prints: ["no context of bun:test"],
        dangerously: ["context of bun:test"],
      },

      "the names join an import of vitest": {
        text: 'import { vi } from "vitest";\n' + prints("typeof vi.fn", globals),
        prints: ["function of vitest"],
        fixed: 'import { vi, test } from "vitest";\n' + prints("typeof vi.fn", globals),
      },
      "the names join a require() of vitest": {
        text: 'const { vi } = require("vitest");\n' + prints("typeof vi.fn", globals, mode),
        prints: ["function of vitest sloppy"],
        fixed: 'const { vi, test } = require("vitest");\n' + prints("typeof vi.fn", globals, mode),
      },
      "a new import beside a namespace of vitest": {
        text: 'import * as all from "vitest";\n' + prints("typeof all.vi.fn", globals),
        prints: ["function of vitest"],
        fixed:
          "import { test } from 'vitest';\nimport * as all from \"vitest\";\n" + prints("typeof all.vi.fn", globals),
      },
    },
  },
  {
    name: "vitest/no-importing-vitest-globals",
    rule: "vitest/no-importing-vitest-globals",
    config: { "bunfig.toml": only("vitest/no-importing-vitest-globals") },
    cases: {
      // Without its last import of `vitest`, the file has the globals of `bun:test`.
      "the only import of vitest": {
        text: 'import { test } from "vitest";\n' + prints(globals),
        prints: ["of vitest"],
        dangerously: ["of bun:test"],
      },
      "the only require() of vitest": {
        text: 'const { test } = require("vitest");\n' + prints(globals, mode),
        prints: ["of vitest sloppy"],
        dangerously: ["of bun:test strict"],
      },
      "an import that keeps a type": {
        file: "a.test.ts",
        text: 'import { test, type Mock } from "vitest";\nexport let mock: Mock | undefined;\n' + prints(globals),
        prints: ["of vitest"],
        dangerously: ["of bun:test"],
      },
      "an import that keeps a name without a use": {
        text: 'import { test, spyOn } from "vitest";\n' + prints(globals),
        prints: ["of vitest"],
        dangerously: ["of vitest"],
      },

      "an import that keeps a name with a use": {
        text: 'import { test, spyOn } from "vitest";\n' + prints("typeof spyOn", globals),
        prints: ["function of vitest"],
        fixed: 'import { spyOn } from "vitest";\n' + prints("typeof spyOn", globals),
      },
      // The rule reports every `{ .. } = require("vitest")`.
      "a require() that keeps a name": {
        text: 'const { test, spyOn } = require("vitest");\n' + prints("typeof spyOn", globals),
        prints: ["function of vitest"],
        fixed: "const { spyOn } = require('vitest');\n" + prints("typeof spyOn", globals),
        isStillReported: true,
      },
    },
  },
  {
    name: "jest/prefer-importing-jest-globals",
    rule: "jest/prefer-importing-jest-globals",
    config: { "bunfig.toml": only("jest/prefer-importing-jest-globals") },
    cases: {
      // A `require()` makes a file CommonJS if nothing else in it asks for either.
      "a require() in a file that is an ES module": {
        text: prints(mode),
        prints: ["strict"],
        dangerously: ["sloppy"],
      },
      "an import in a CommonJS file": {
        file: "a.test.ts",
        text:
          'import type { Point } from "./point";\nconst { origin } = require("./point");\nconst at: Point = origin;\n' +
          prints("at.x", mode),
        files: point,
        prints: ["0 sloppy"],
        dangerously: ["0 strict"],
      },
      // `@jest/globals` has the functions of `bun:test`, and this file has the ones of `vitest`.
      "in a file that loads vitest": {
        text: 'import { vi } from "vitest";\n' + printsWithContext("typeof vi.fn"),
        prints: ["context function"],
        dangerously: ["no context function"],
      },
      "a name that @jest/globals lacks": {
        text:
          'import { add } from "./math.js";\ntest.skip("later", () => {\n  fit("too", () => {});\n});\n' +
          prints("add(1, 2)"),
        files: math,
        prints: ["3"],
        dangerously: [],
      },

      "a require() in a CommonJS file": {
        text: 'const { one } = require("./dep.cjs");\n' + prints("one", mode),
        files: cjs,
        prints: ["1 sloppy"],
        fixed:
          "const { test } = require('@jest/globals');\nconst { one } = require(\"./dep.cjs\");\n" + prints("one", mode),
      },
      "a require() in a file that calls require() in a test": {
        text: 'test("prints", () => {\n  console.log(TAG, require("./dep.cjs").one, ' + mode + ");\n});\n",
        files: cjs,
        prints: ["1 sloppy"],
      },
      "an import in an ES module": {
        text: 'import { add } from "./math.js";\n' + prints("add(1, 2)", mode),
        files: math,
        prints: ["3 strict"],
        fixed:
          "import { test } from '@jest/globals';\nimport { add } from \"./math.js\";\n" + prints("add(1, 2)", mode),
      },
      "the names join an import of @jest/globals": {
        text: 'import { jest } from "@jest/globals";\n' + prints("typeof jest.fn", mode),
        prints: ["function strict"],
        fixed: "import { jest, test } from '@jest/globals';\n" + prints("typeof jest.fn", mode),
      },
    },
  },
  {
    name: "jest/prefer-importing-jest-globals with a preload script",
    rule: "jest/prefer-importing-jest-globals",
    // The script defines a global of its own. A file gets it once it loads a test module, and `bun test`'s otherwise.
    config: {
      "bunfig.toml": only("jest/prefer-importing-jest-globals") + '\n[test]\npreload = ["./setup.js"]\n',
      "setup.js": "globalThis.onTestFinished = Object.assign(() => {}, { isOfScript: true });\n",
    },
    cases: {
      "a global that the fix doesn't import": {
        text:
          'const { one } = require("./dep.cjs");\n' +
          prints("one", 'onTestFinished.isOfScript ? "of the script" : "of bun:test"'),
        files: cjs,
        prints: ["1 of bun:test"],
        dangerously: ["1 of the script"],
      },
      "every global is imported": {
        text: 'const { one } = require("./dep.cjs");\n' + prints("one"),
        files: cjs,
        prints: ["1"],
      },
    },
  },
  {
    name: "@typescript-eslint/consistent-type-imports",
    rule: "@typescript-eslint/consistent-type-imports",
    config: { "bunfig.toml": only("@typescript-eslint/consistent-type-imports") },
    cases: {
      // Bun keeps an import whose names are only used as types, and `import type` isn't one.
      "the only import of vitest": {
        file: "a.test.ts",
        text: 'import { Mock } from "vitest";\nexport let mock: Mock | undefined;\n' + prints(globals),
        prints: ["of vitest"],
        dangerously: ["of bun:test"],
      },
      "the only import of a file that asks for CommonJS": {
        file: "a.test.ts",
        text:
          'import { Point } from "./point";\nconst { origin } = require("./point");\nconst at: Point = origin;\n' +
          prints("at.x", mode),
        files: point,
        prints: ["0 strict"],
        dangerously: ["0 sloppy"],
      },

      "an import of types": {
        file: "a.test.ts",
        text:
          'import { Point } from "./point";\nimport { origin } from "./point";\nconst at: Point = origin;\n' +
          prints("at.x", mode),
        files: point,
        prints: ["0 strict"],
        fixed:
          'import type { Point } from "./point";\nimport { origin } from "./point";\nconst at: Point = origin;\n' +
          prints("at.x", mode),
      },
      "beside an import with a use, in a file that asks for CommonJS": {
        file: "a.test.ts",
        text:
          'import { Point } from "./point";\nimport { origin } from "./point";\nconst at: Point = origin;\n' +
          prints("at.x", "typeof __dirname", mode),
        files: point,
        prints: ["0 string strict"],
        fixed:
          'import type { Point } from "./point";\nimport { origin } from "./point";\nconst at: Point = origin;\n' +
          prints("at.x", "typeof __dirname", mode),
      },
      "beside another import of vitest with a use": {
        file: "a.test.ts",
        text:
          'import { Mock } from "vitest";\nimport { vi } from "vitest";\nexport const mock: Mock = vi.fn();\n' +
          prints(globals),
        prints: ["of vitest"],
        fixed:
          'import type { Mock } from "vitest";\nimport { vi } from "vitest";\nexport const mock: Mock = vi.fn();\n' +
          prints(globals),
      },
    },
  },
  {
    name: '@typescript-eslint/consistent-type-imports with prefer: "no-type-imports"',
    rule: "@typescript-eslint/consistent-type-imports",
    config: { "bunfig.toml": only("@typescript-eslint/consistent-type-imports", '{ prefer = "no-type-imports" }') },
    cases: {
      "the first import of vitest": {
        file: "a.test.ts",
        text: 'import type { Mock } from "vitest";\nexport let mock: Mock | undefined;\n' + prints(globals),
        prints: ["of bun:test"],
        dangerously: ["of vitest"],
      },
      "the first import of vitest, with type in the braces": {
        file: "a.test.ts",
        text: 'import { type Mock } from "vitest";\nexport let mock: Mock | undefined;\n' + prints(globals),
        prints: ["of bun:test"],
        dangerously: ["of vitest"],
      },
      "in a CommonJS file": {
        file: "a.test.ts",
        text:
          'import type { Point } from "./point";\nconst { origin } = require("./point");\nconst at: Point = origin;\n' +
          prints("at.x", mode),
        files: point,
        prints: ["0 sloppy"],
        dangerously: ["0 strict"],
      },

      "an import type": {
        file: "a.test.ts",
        text:
          'import type { Point } from "./point";\nimport { origin } from "./point";\nconst at: Point = origin;\n' +
          prints("at.x", mode),
        files: point,
        prints: ["0 strict"],
        fixed:
          'import { Point } from "./point";\nimport { origin } from "./point";\nconst at: Point = origin;\n' +
          prints("at.x", mode),
      },
    },
  },
  {
    name: '@typescript-eslint/consistent-type-imports with fixStyle: "inline-type-imports"',
    rule: "@typescript-eslint/consistent-type-imports",
    config: {
      "bunfig.toml": only("@typescript-eslint/consistent-type-imports", '{ fixStyle = "inline-type-imports" }'),
    },
    cases: {
      "the only import of vitest": {
        file: "a.test.ts",
        text: 'import { Mock } from "vitest";\nexport let mock: Mock | undefined;\n' + prints(globals),
        prints: ["of vitest"],
        dangerously: ["of bun:test"],
      },
      "an import that keeps a value": {
        file: "a.test.ts",
        text: 'import { Mock, vi } from "vitest";\nexport const mock: Mock = vi.fn();\n' + prints(globals),
        prints: ["of vitest"],
        fixed: 'import { type Mock, vi } from "vitest";\nexport const mock: Mock = vi.fn();\n' + prints(globals),
      },
    },
  },
  {
    name: "@typescript-eslint/no-unused-vars with enableAutofixRemoval",
    rule: "@typescript-eslint/no-unused-vars",
    config: {
      "bunfig.toml": only("@typescript-eslint/no-unused-vars", "{ enableAutofixRemoval = { imports = true } }"),
    },
    cases: {
      // Bun keeps an import that nothing uses.
      "the only import of vitest": {
        file: "a.test.ts",
        text: 'import { vi } from "vitest";\n' + prints(globals),
        prints: ["of vitest"],
        dangerously: ["of bun:test"],
      },
      "the only import of a file that asks for CommonJS": {
        file: "a.test.ts",
        text: 'import { origin } from "./point";\nconst { sep } = require("node:path");\n' + prints("sep.length", mode),
        files: point,
        prints: ["1 strict"],
        dangerously: ["1 sloppy"],
      },
      'the only import, with "type": "commonjs"': {
        file: "a.test.ts",
        text: 'import { origin } from "./point";\n' + prints(mode),
        files: { ...point, "package.json": '{ "type": "commonjs" }' },
        prints: ["strict"],
        dangerously: ["sloppy"],
      },
      "an import equals of vitest": {
        file: "a.test.ts",
        text: 'import all = require("vitest");\n' + prints(globals),
        prints: ["of vitest"],
        dangerously: ["of bun:test"],
      },

      "beside an import with a use": {
        file: "a.test.ts",
        text: 'import { Point } from "./point";\nimport { origin } from "./point";\n' + prints("origin.x", mode),
        files: point,
        prints: ["0 strict"],
        fixed: 'import { origin } from "./point";\n' + prints("origin.x", mode),
      },
      "beside the file's export {}": {
        file: "a.test.ts",
        text:
          'import { origin } from "./point";\nexport {};\nconst { sep } = require("node:path");\n' +
          prints("sep.length", mode),
        files: point,
        prints: ["1 strict"],
        fixed: 'export {};\nconst { sep } = require("node:path");\n' + prints("sep.length", mode),
      },
    },
  },
  {
    name: "no-unused-vars with an oxlint config",
    rule: "eslint/no-unused-vars",
    config: {
      ".oxlintrc.json":
        '{ "rules": { "no-unused-vars": ["warn", { "fix": { "imports": "safe-fix", "variables": "safe-fix" } }] } }\n',
    },
    cases: {
      "the only import of vitest": {
        file: "a.test.ts",
        text: 'import { vi } from "vitest";\n' + prints(globals),
        prints: ["of vitest"],
        dangerously: ["of bun:test"],
      },
      // The `require()` goes with the variable.
      "the only require() of vitest": {
        text: 'const all = require("vitest");\n' + prints(globals, mode),
        prints: ["of vitest sloppy"],
        dangerously: ["of bun:test strict"],
      },
      "the only require()": {
        text: 'const path = require("node:path");\n' + prints(mode),
        prints: ["sloppy"],
        dangerously: ["strict"],
      },

      "beside an import with a use": {
        file: "a.test.ts",
        text: 'import { Point } from "./point";\nimport { origin } from "./point";\n' + prints("origin.x", mode),
        files: point,
        prints: ["0 strict"],
        fixed: 'import { origin } from "./point";\n' + prints("origin.x", mode),
      },
    },
  },
  {
    name: "@typescript-eslint/no-useless-empty-export",
    rule: "@typescript-eslint/no-useless-empty-export",
    config: { "bunfig.toml": only("@typescript-eslint/no-useless-empty-export") },
    cases: {
      // What is left is a type, so the file runs as CommonJS.
      "beside a type import": {
        file: "a.test.ts",
        text:
          'import type { Point } from "./point";\nexport {};\nconst { origin } = require("./point");\nconst at: Point = origin;\n' +
          prints("at.x", mode),
        files: point,
        prints: ["0 strict"],
        dangerously: ["0 sloppy"],
      },
      "beside an import equals": {
        file: "a.test.ts",
        text: 'import path = require("node:path");\nexport {};\n' + prints("path.sep.length", mode),
        prints: ["1 strict"],
        dangerously: ["1 sloppy"],
      },
      // It loads the module, like an `import`.
      "an export {} from vitest": {
        file: "a.test.ts",
        text: 'export {} from "vitest";\nexport const one = 1;\n' + prints(globals),
        prints: ["of vitest"],
        dangerously: ["of bun:test"],
      },

      "beside an export": {
        file: "a.test.ts",
        text: "export const one = 1;\nexport {};\n" + prints("one", mode),
        prints: ["1 strict"],
        fixed: "export const one = 1;\n\n" + prints("one", mode),
      },
      "beside an import with a use": {
        file: "a.test.ts",
        text:
          'import { origin } from "./point";\nexport {};\nconst { sep } = require("node:path");\n' +
          prints("origin.x", "sep.length", mode),
        files: point,
        prints: ["0 1 strict"],
        fixed:
          'import { origin } from "./point";\n\nconst { sep } = require("node:path");\n' +
          prints("origin.x", "sep.length", mode),
      },
    },
  },
  {
    name: "unicorn/require-module-specifiers",
    rule: "unicorn/require-module-specifiers",
    config: { "bunfig.toml": only("unicorn/require-module-specifiers") },
    cases: {
      "beside a type import": {
        file: "a.test.ts",
        text:
          'import type { Point } from "./point";\nexport {};\nconst { origin } = require("./point");\nconst at: Point = origin;\n' +
          prints("at.x", mode),
        files: point,
        prints: ["0 strict"],
        dangerously: ["0 sloppy"],
      },

      "beside an export": {
        file: "a.test.ts",
        text: "export const one = 1;\nexport {};\n" + prints("one", mode),
        prints: ["1 strict"],
        fixed: "export const one = 1;\n\n" + prints("one", mode),
      },
    },
  },
];

const fileOf = (it: Case) => it.file ?? "a.test.js";
const cases = groups.flatMap((group, g) =>
  Object.entries(group.cases).map(([name, it], c) => ({
    group,
    name,
    it,
    directory: `${g}/${c}`,
    tag: `@@${g}/${c}@@`,
  })),
);

/** The flag that `bun lint` gets in each step, and the directory with the step's copy of the cases. */
const steps = {
  "as written": { flag: undefined, copy: "as-written" },
  "--fix": { flag: "--fix", copy: "fix" },
  "--fix-dangerously": { flag: "--fix-dangerously", copy: "fix-dangerously" },
};
type Step = keyof typeof steps;
type Result = {
  /** What `bun test` prints for the case. */
  prints: string[];
  /** The reported file, if `bun lint` changed it. Not for the file as written. */
  fixed?: string;
  /** Whether the rule still reports the file. Not for the file as written, which isn't linted. */
  isReported?: boolean;
};
const results = new Map<string, Record<Step, Result>>();

// Each step has a copy of all the cases. A copy is linted in one run per group, and each group is tested in one run of
// `bun test`: a process per case and step would be some 300 of them.
beforeAll(async () => {
  const files: Files = {};
  for (const { copy } of Object.values(steps)) {
    groups.forEach((group, g) => {
      for (const [name, content] of Object.entries(group.config)) files[`${copy}/${g}/${name}`] = content;
    });
    for (const { it, directory, tag } of cases) {
      for (const [path, text] of Object.entries({ ...it.files, [fileOf(it)]: it.text })) {
        files[`${copy}/${directory}/${path}`] = text.replaceAll("TAG", JSON.stringify(tag));
      }
    }
  }
  using dir = tempDir("bun-lint-run-mode", files);
  const root = String(dir);

  /** Runs `bun lint` with the rule of group `g`. Returns the files that the rule still reports. */
  const lint = async (copy: string, flag: string, g: number) => {
    const { stdout, stderr } = await run(join(root, copy, String(g)), "lint", "-f", "json", flag);
    if (!/^[[{]/.test(stdout)) throw new Error(`bun lint ${flag} printed no JSON: ${stdout}\n${stderr}`);
    const json = JSON.parse(stdout);
    // An oxlint config gives oxlint's JSON.
    const reports: { path: string; rule: string }[] = Array.isArray(json)
      ? json.flatMap((file: { filePath: string; messages: { ruleId: string | null }[] }) =>
          file.messages.map(it => ({ path: file.filePath, rule: it.ruleId ?? "" })),
        )
      : json.diagnostics.map((it: { filename: string; code: string }) => ({
          path: join(root, copy, String(g), it.filename),
          rule: it.code.replace(/^(?:eslint-plugin-)?([\w-]+)\((.+)\)$/, "$1/$2"),
        }));
    return reports.filter(it => it.rule === groups[g].rule).map(it => it.path);
  };
  const resultsOf = async (step: Step): Promise<[Step, (it: (typeof cases)[number]) => Result]> => {
    const { flag, copy } = steps[step];
    const reported = flag ? (await Promise.all(groups.map((_, g) => lint(copy, flag, g)))).flat() : [];
    const tested = await Promise.all(groups.map((_, g) => run(join(root, copy, String(g)), "test")));
    const lines = tested.flatMap(it => it.stdout.split("\n"));
    const pathOf = (copy: string, it: (typeof cases)[number]) => join(root, copy, it.directory, fileOf(it.it));
    const resultOf = (it: (typeof cases)[number]): Result => {
      const prints = lines.filter(line => line.startsWith(it.tag)).map(line => line.slice(it.tag.length + 1));
      if (!flag) return { prints };
      const [asWritten, now] = [pathOf(steps["as written"].copy, it), pathOf(copy, it)].map(it =>
        readFileSync(it, "utf8"),
      );
      const untagged = (text: string) => text.replaceAll(JSON.stringify(it.tag), "TAG");
      return {
        prints,
        fixed: now === asWritten ? undefined : untagged(now),
        isReported: reported.includes(pathOf(copy, it)),
      };
    };
    return [step, resultOf];
  };

  const all = await Promise.all((Object.keys(steps) as Step[]).map(resultsOf));
  for (const it of cases) {
    results.set(
      it.tag,
      Object.fromEntries(all.map(([step, resultOf]) => [step, resultOf(it)])) as Record<Step, Result>,
    );
  }
}, longLimit);

for (const group of groups) {
  describe(group.name, () => {
    for (const { name, it, tag } of cases.filter(it => it.group === group)) {
      const held = it.dangerously !== undefined;
      test(`${held ? "only --fix-dangerously fixes" : "--fix fixes"}: ${name}`, () => {
        const found = results.get(tag)!;
        // The text of the fix is that of the original rule, which other tests compare.
        const fixed = it.fixed ?? found["--fix-dangerously"].fixed;
        expect(fixed).toBeString();
        const isStillReported = it.isStillReported ?? false;
        expect(found).toEqual({
          "as written": { prints: it.prints },
          "--fix": { prints: it.prints, fixed: held ? undefined : fixed, isReported: held || isStillReported },
          "--fix-dangerously": { prints: it.dangerously ?? it.prints, fixed, isReported: isStillReported },
        });
      });
    }
  });
}

describe("vitest/prefer-importing-vitest-globals with vitest/no-importing-vitest-globals", () => {
  // One rule adds the import that the other removes. Neither is a fix that keeps how the file runs.
  test.concurrent.each([
    ["with the import", 'import { test } from "vitest";\n', ["of vitest"]],
    ["without the import", "", ["of bun:test"]],
  ])(
    "--fix leaves a file %s as it is",
    async (_, head, printed) => {
      const text = head + prints(globals).replaceAll("TAG", '"@@"');
      using dir = tempDir("bun-lint-run-mode-both", {
        "bunfig.toml":
          only("vitest/prefer-importing-vitest-globals") + '"vitest/no-importing-vitest-globals" = "warn"\n',
        "a.test.js": text,
      });
      const linted = await run(String(dir), "lint", "--fix");
      expect(linted.stdout + linted.stderr).not.toContain("Fixed");
      expect(readFileSync(join(String(dir), "a.test.js"), "utf8")).toBe(text);
      const tested = await run(String(dir), "test");
      expect(
        tested.stdout
          .split("\n")
          .filter(it => it.startsWith("@@"))
          .map(it => it.slice(3)),
      ).toEqual(printed);
      expect(tested.exitCode).toBe(0);
    },
    longLimit,
  );
});
