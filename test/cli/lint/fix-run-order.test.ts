// `bun lint --fix` must not make a file read a variable before the line that gives the variable its value has run.
//
// The fixes here write a name of the test runner: `jest.mocked()` for a cast, `it.skip()` for `xit()`. Two of them add
// names to a `const { .. } = require("@jest/globals")` line. If a variable declaration gives the name its value, the
// name has no value for code that runs before the declaration. `--fix` only trusts a `require()` line at the top of the
// file: below nothing but directives, imports and other `require()` lines, in a file that has no `export` of a value.
// For any other declaration it leaves the fix to `--fix-dangerously`.
//
// Each case is a test file that passes. `bun test` runs it as written, after `--fix` and after `--fix-dangerously`,
// and what the file prints tells whether it still does the same.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

type Files = Record<string, string>;

type Case = {
  /** The file that the rule reports. In it and in `files`, `TAG` stands for a string that marks what the case prints. */
  text: string;
  /** Its name, if not `greet.test.js`. */
  file?: string;
  /** The files next to it. */
  files?: Files;
  /** True if `--fix` leaves the fix to `--fix-dangerously`. */
  held?: true;
  /** True if the file prints something else, or fails, once `--fix-dangerously` has applied the fix. */
  breaks?: true;
  /** True if the report has no fix: the name that the fix writes is something else there. */
  unfixed?: true;
  /** True if another rule of the plugin has a fix that breaks the file for a reason that this file isn't about. */
  alone?: true;
};

/** A test that prints `value`. */
const logs = (value: string, test = "test") => `${test}("logs", () => {\n  console.log(TAG, ${value});\n});\n`;
const line = (source: string, names = "test") => `const { ${names} } = require("${source}");\n`;
const jestLine = line("@jest/globals");
const vitestLine = line("vitest");
const makeSpy = (object: string) => `function makeSpy() {\n  return ${object}.fn(() => "real");\n}\n`;
const spy = (object: string) => `const spy = ${object}.fn(() => "real");\n`;
/** A statement that uses no name of the runner. */
const other = 'const greeting = "real";\n';
/** An assignment that doesn't run. Bun rejects a file that assigns to a `const`, even then. */
const assigns = (name: string) => `if (globalThis.never) {\n  ${name} = undefined;\n}\n${name}(() => {});\n`;
/** A module that calls `makeSpy()` of the test file before the test file's first statement runs. */
const early = (file: string) => `import { makeSpy } from "./${file}";\nglobalThis[TAG] = makeSpy();\n`;

/** The cases of a rule that adds names to the `require()` line of `source`, which has the object `mock`. */
const importing = (source: string, mock: string): Record<string, Case> => ({
  // The fix adds the name to the line, and the statement above the line reads it.
  "a call above the line": {
    text: spy(mock) + line(source) + logs("spy()"),
    held: true,
    breaks: true,
  },
  "typeof above the line": {
    text: `const kind = typeof ${mock};\n` + line(source) + `const spy = ${mock}.fn(() => kind);\n` + logs("spy()"),
    held: true,
    breaks: true,
  },
  // A function declaration is there before the line runs, so code above the line can run it.
  "a function declaration that code above the line calls": {
    text: "const spy = makeSpy();\n" + line(source) + makeSpy(mock) + logs("spy()"),
    held: true,
    breaks: true,
  },
  // The static field calls the method as the class is defined.
  "a class above the line that calls its own method": {
    text:
      `class Spies {\n  static make() {\n    return ${mock}.fn(() => "real");\n  }\n  static greet = this.make();\n}\n` +
      line(source) +
      logs("Spies.greet()"),
    held: true,
    breaks: true,
  },
  // Bun defines a class declaration before the file's first statement runs, if the class allows that.
  "a class below the line that code above the line uses": {
    text:
      "const spy = Spies.make();\n" +
      line(source) +
      `class Spies {\n  static make = () => ${mock}.fn(() => "real");\n}\n` +
      logs("spy()"),
    held: true,
    breaks: true,
  },
  // The line declares the names in the function, and for the whole `switch`.
  "a call above a line in a function": {
    text:
      `function run() {\n  const spy = ${mock}.fn(() => "real");\n  const { test } = require("${source}");\n` +
      '  test("logs", () => {\n    console.log(TAG, spy());\n  });\n}\nrun();\n',
    held: true,
    breaks: true,
  },
  "a line in a case that doesn't run": {
    text:
      `const kind = "b";\nswitch (kind) {\n  case "a":\n    const { describe } = require("${source}");\n` +
      '    describe("a", () => {});\n    break;\n  case "b":\n    test("logs", () => {\n      console.log(TAG, kind);\n    });\n}\n',
    held: true,
    breaks: true,
  },
  "an assignment to a name, and the line": {
    text: line(source) + assigns("afterEach") + logs('"real"'),
    held: true,
    breaks: true,
  },
  "an assignment to a name, and no line": {
    text: assigns("afterEach") + logs('"real"'),
    held: true,
    breaks: true,
  },
  // `require("vitest").vi` isn't the module, so it has no `test`.
  "a line that takes its names from a member of the module": {
    text: `const { fn } = require("${source}").${mock};\n` + logs('fn(() => "real")()'),
    held: true,
    breaks: true,
  },
  // A name that the fix adds to the line is no longer in `runner`.
  "a line with a rest that the file reads a name from": {
    text:
      `const { ${mock}, ...runner } = require("${source}");\n` +
      'test("is empty", () => {});\n' +
      logs(`${mock}.fn(() => "real")()`, "runner.test"),
    held: true,
    breaks: true,
  },
  // These do the same with the fix. `--fix` doesn't look at what the code above the line does.
  "a statement above the line that uses none of the names": {
    text: other + line(source) + `const spy = ${mock}.fn(() => greeting);\n` + logs("spy()"),
    held: true,
  },
  "a function declaration above the line that code below the line calls": {
    text: makeSpy(mock) + line(source) + "const spy = makeSpy();\n" + logs("spy()"),
    held: true,
  },

  "the line first": {
    text: line(source) + spy(mock) + logs("spy()"),
  },
  "the line below a directive and other require() lines": {
    files: { "setup.js": 'module.exports = ["real"];\n' },
    text:
      '"use strict";\nrequire("./setup.js");\nconst path = require(`node:path`);\n' +
      'const { join } = require("node:path");\nconst sep = require("node:path").sep;\n' +
      'const [first] = require("./setup.js");\n' +
      line(source) +
      `const spy = ${mock}.fn(() => (join("a", "b") === "a" + sep + "b" ? path.basename(first) : ""));\n` +
      logs("spy()"),
  },
  "function and class declarations below the line": {
    text:
      line(source) +
      makeSpy(mock) +
      `class Maker {\n  spy = makeSpy();\n  static make = () => ${mock}.fn(new this().spy);\n}\n` +
      "const spy = Maker.make();\n" +
      logs("spy()"),
  },
  "no line": {
    text: spy(mock) + logs("spy()"),
  },
});

const skipped = 'xit("is skipped", () => {});\n';
/** The cases of a rule that writes `it.skip()` for `xit()`, for the runner's module `source`. */
const noTestPrefixes = (source: string): Record<string, Case> => ({
  // The fix writes `it.skip()` above the line that declares `it`.
  "xit() above the line that declares it": {
    text: skipped + line(source, "it") + logs('"real"', "it"),
    held: true,
    breaks: true,
  },
  "xit() in a function declaration that code above the line calls": {
    text: "suite();\n" + line(source, "it") + `function suite() {\n  ${skipped}}\n` + logs('"real"', "it"),
    held: true,
    breaks: true,
  },
  // This one does the same with the fix.
  "xit() below a line that stands below another statement": {
    text: other + line(source, "it") + skipped + logs("greeting", "it"),
    held: true,
  },
  // The line calls this function, so the function runs before the line has given `it` its value.
  "xit() in a function named require": {
    text: line(source, "it") + `function require() {\n  ${skipped}  return { it: test };\n}\n` + logs('"real"', "it"),
    held: true,
    breaks: true,
  },
  "xit() below a second declaration that gives it another value": {
    text:
      `var { it, test } = require("${source}");\nvar it = (name, fn) => test(name, fn);\n` +
      skipped +
      logs('"real"', "it"),
    held: true,
    breaks: true,
  },
  "xit() below an assignment to it": {
    text:
      `let { it, test } = require("${source}");\nit = (name, fn) => test(name, fn);\n` + skipped + logs('"real"', "it"),
    held: true,
    breaks: true,
  },
  "xit() below the line that declares it": {
    text: line(source, "it") + skipped + logs('"real"', "it"),
  },
  // A `var` without a value gives `it` no other value.
  "xit() below the line and a second declaration without a value": {
    text: `var { it } = require("${source}");\nvar it;\n` + skipped + logs('"real"', "it"),
  },
  // `it` is then no name of the runner's module that `--fix` knows.
  "xit() below a line in a function": {
    text:
      line(source) +
      `function suite() {\n  const { it } = require("${source}");\n  ${skipped}}\nsuite();\n` +
      logs('"real"'),
    unfixed: true,
  },
});
/** The cases of a rule that writes `test()` for `it()`. */
const consistentTestIt = (source: string): Record<string, Case> => ({
  "it() above the line that declares test": {
    text: logs('"real"', "it") + line(source) + 'test("is empty", () => {});\n',
    held: true,
    breaks: true,
  },
  "it() below the line that declares test": {
    text: line(source) + logs('"real"', "it") + 'test("is empty", () => {});\n',
  },
});

/** Two packages that the Vitest rules take for Vitest, and `bun test` doesn't. The second one is a module. */
const packages: Files = {
  "node_modules/vite-plus/package.json": '{ "name": "vite-plus", "exports": { "./test": "./test.js" } }',
  "node_modules/vite-plus/test.js": 'module.exports = require("bun:test");\n',
  "node_modules/@effect/vitest/package.json": '{ "name": "@effect/vitest", "type": "module", "exports": "./index.js" }',
  "node_modules/@effect/vitest/index.js":
    'import * as runner from "bun:test";\nexport const { it, test, vi } = runner;\n',
};
/** A file that imports `it` under another name, so that a fix which writes `expect` writes a new name. */
const checked = (source: string, names: string, code: string) =>
  `import { expect as check, ${names} } from "${source}";\n${code}const { expect } = require("${source}");\n` +
  'test("logs", () => {\n  expect(1).toBe(1);\n  console.log(TAG, "real");\n});\n';
const jasmine = "globalThis.jasmine = { any: kind => kind.name };\n";
const greet = 'const greet = () => "real";\n';
const jestAndTest = line("@jest/globals", "jest, test");

const groups: Record<string, Record<string, Case>> = {
  "jest/prefer-importing-jest-globals": {
    ...importing("@jest/globals", "jest"),
    // Another file can call what a file exports before the file's first statement runs.
    "a function declaration that the file exports": {
      file: "greet.test.cts",
      files: { "early.cjs": 'const { makeSpy } = require("./greet.test.cts");\nglobalThis[TAG] = makeSpy();\n' },
      text: 'require("./early.cjs");\n' + jestLine + "export " + makeSpy("jest") + logs("globalThis[TAG]()"),
      held: true,
      breaks: true,
    },
    // The fix writes a new line first in the file. `early.mjs` still runs before it.
    "a function declaration that the file exports, and no line": {
      file: "greet.test.cts",
      files: { "early.mjs": early("greet.test.cts") },
      text: 'import "./early.mjs";\nexport ' + makeSpy("jest") + logs("globalThis[TAG]()"),
      held: true,
      breaks: true,
    },
    // The fix writes the whole statement again. It only knows `{ key, key: name }` of a `const` that declares nothing else.
    "a line that binds the module to one name": {
      text:
        'const runner = require("@jest/globals");\ndescribe("suite", () => {\n  ' +
        logs('"real"', "runner.test") +
        "});\n",
      held: true,
      breaks: true,
    },
    "a line with a second declarator": {
      text:
        'const { test } = require("@jest/globals"),\n  greeting = "real";\n' +
        "const spy = jest.fn(() => greeting);\n" +
        logs("spy()"),
      held: true,
      breaks: true,
    },
    "a let line that the file assigns to": {
      text:
        'let { test } = require("@jest/globals");\nif (globalThis.never) {\n  test = undefined;\n}\n' +
        spy("jest") +
        logs("spy()"),
      held: true,
      breaks: true,
    },
    "a line with a pattern in a pattern": {
      text:
        'const { jest: { fn }, test } = require("@jest/globals");\n' +
        'test("logs", () => {\n  expect(1).toBe(1);\n  console.log(TAG, fn(() => "real")());\n});\n',
      held: true,
      breaks: true,
    },
    // The comment is all that the new text drops.
    "a line with a comment in it": {
      text: 'const { test /* the runner\'s */ } = require("@jest/globals");\n' + spy("jest") + logs("spy()"),
      held: true,
    },
    // In a module the line becomes an `import`.
    "a line with a rest, in a module": {
      file: "greet.test.mjs",
      text: 'const { test, ...runner } = require("@jest/globals");\n' + spy("jest") + logs("spy()", "runner.it"),
      held: true,
      breaks: true,
    },
    "a line that takes its names from a member of the module, in a module": {
      file: "greet.test.mjs",
      text: 'const { fn } = require("@jest/globals").jest;\n' + logs('fn(() => "real")()'),
      held: true,
      breaks: true,
    },
    // The fix writes `import { .. }` in place of the whole `import`.
    "an import of all of the module": {
      file: "greet.test.mjs",
      text:
        'import * as runner from "@jest/globals";\n' +
        'runner.test("logs", () => {\n  expect(1).toBe(1);\n  console.log(TAG, "real");\n});\n',
      held: true,
      breaks: true,
    },
    // The new first line calls this function, which reads the names of that line.
    "no line, in a file that declares require": {
      text:
        line("@jest/globals", "it") +
        `function require() {\n  ${skipped}  return { it: test };\n}\n` +
        logs('"real"', "it"),
      held: true,
      breaks: true,
    },
    // Another file could call the function before the `import` has its module. Bun has this module from the start.
    "a function that the file exports, and an import that gets the names": {
      file: "greet.test.mjs",
      text: 'import { test } from "@jest/globals";\nexport ' + makeSpy("jest") + logs("makeSpy()()"),
      held: true,
    },
    // A new `import` is the first statement, so its module runs before all other code of the file.
    "no line, in a module that exports a function": {
      file: "greet.test.mjs",
      text: "export " + makeSpy("jest") + logs("makeSpy()()"),
    },
    "the line below an import of TypeScript's own kind": {
      file: "greet.test.cts",
      text:
        'import path = require("node:path");\n' +
        jestLine +
        'const spy = jest.fn(() => path.basename("real"));\n' +
        logs("spy()"),
    },
    // In a module the line becomes an `import`, which has its names before any statement runs.
    "a call above a line that becomes an import": {
      files: { "dep.js": 'export const greet = () => "real";\n' },
      text: 'import { greet } from "./dep.js";\nconst spy = jest.fn(greet);\n' + jestLine + logs("spy()"),
    },
    // The names go into the `import`, not into the line.
    "a call above the line in a file that imports from @jest/globals": {
      file: "greet.test.cts",
      text:
        'import { describe } from "@jest/globals";\n' +
        spy("jest") +
        jestLine +
        'describe("suite", () => {\n  ' +
        logs("spy()") +
        "});\n",
    },
  },

  "vitest/prefer-importing-vitest-globals": {
    ...importing("vitest", "vi"),
    // The fix writes an `import` here. Bun rejects an assignment to an import when it runs, and this one doesn't.
    "an assignment to a name, and no line": {
      text: assigns("afterEach") + logs('"real"'),
      held: true,
    },
    // The fix keeps the `var`, which has no value above the line. A `const` throws there.
    "a call above a var line": {
      text: spy("vi") + 'var { test } = require("vitest");\n' + logs("spy()"),
      held: true,
      breaks: true,
    },
    "typeof above a var line": {
      text:
        'const has = typeof vi !== "undefined";\nvar { test } = require("vitest");\n' +
        "const spy = vi.fn(() => String(has));\n" +
        logs("spy()"),
      held: true,
      breaks: true,
    },
    "a call in a declarator above the line's": {
      text: 'const spy = vi.fn(() => "real"),\n  { test } = require("vitest");\n' + logs("spy()"),
      held: true,
      breaks: true,
    },
    // The fix writes the names behind the properties that the line has.
    "a call in a default of the line": {
      text: 'const { test, missing = vi.fn(() => "real") } = require("vitest");\n' + logs("missing()"),
      held: true,
      breaks: true,
    },
    // A `var` is declared for the whole file, and this line doesn't run.
    "a var line in a branch that doesn't run": {
      text: 'if (globalThis.never) {\n  var { it } = require("vitest");\n}\n' + logs('"real"'),
      held: true,
      breaks: true,
    },
    // The fix adds the names to the `require()` line of a file that has an `import`, too.
    "a call above the line in a module": {
      files: { "dep.js": 'export const greet = () => "real";\n' },
      text: 'import { greet } from "./dep.js";\nconst spy = vi.fn(greet);\n' + vitestLine + logs("spy()"),
      held: true,
      breaks: true,
    },
    "a function declaration that the file exports": {
      file: "greet.test.mjs",
      files: { "early.mjs": early("greet.test.mjs") },
      text: 'import "./early.mjs";\n' + vitestLine + "export " + makeSpy("vi") + logs("globalThis[TAG]()"),
      held: true,
      breaks: true,
    },
    "a function declaration that the file exports in a list": {
      file: "greet.test.mjs",
      files: { "early.mjs": early("greet.test.mjs") },
      text:
        'import "./early.mjs";\n' + vitestLine + makeSpy("vi") + "export { makeSpy };\n" + logs("globalThis[TAG]()"),
      held: true,
      breaks: true,
    },
    // `early.mjs` calls the function before the `import` below it has its module.
    "a function that the file exports, and an import that gets the names": {
      file: "greet.test.mjs",
      files: { "early.mjs": early("greet.test.mjs") },
      text:
        'import "./early.mjs";\nimport { test } from "@effect/vitest";\nexport ' +
        makeSpy("vi") +
        logs("globalThis[TAG]()"),
      held: true,
      breaks: true,
    },
    // Bun evaluates this `export default` before the first statement, and `run.cjs` calls it from the first line.
    "an arrow function that the file exports by default": {
      file: "greet.test.mjs",
      files: { "run.cjs": 'globalThis[TAG] = require("./greet.test.mjs").default();\n' },
      text:
        'require("./run.cjs");\n' +
        vitestLine +
        'export default () => vi.fn(() => "real");\n' +
        logs("globalThis[TAG]()"),
      held: true,
      breaks: true,
    },
    // This `import` is a statement that reads `vi`.
    "an import of a member above the line": {
      file: "greet.test.ts",
      text: "import fn = vi.fn;\n" + vitestLine + logs('fn(() => "real")()'),
      held: true,
      breaks: true,
    },
    // The key and the file name are computed before the line has given `vi` its value.
    "a computed key in the line": {
      text: 'const { test, [typeof vi]: kind } = require("vitest");\n' + logs('kind ?? "real"'),
      held: true,
      breaks: true,
    },
    "a require() above the line that calls a function of the file": {
      files: { "dep.js": 'module.exports = { greet: () => "real" };\n' },
      text:
        "const dep = require(`./${pick()}.js`);\n" +
        vitestLine +
        'function pick() {\n  return typeof vi === "object" ? "dep" : "";\n}\n' +
        logs("dep.greet()"),
      held: true,
      breaks: true,
    },
    // The fix can't add names to `import * as runner`, so they go into the line.
    "a call above the line in a file that imports all of vitest": {
      file: "greet.test.mjs",
      text: 'import * as runner from "vitest";\n' + spy("vi") + vitestLine + logs("spy() && runner.vi ? spy() : 0"),
      held: true,
      breaks: true,
    },

    "a call in a declarator below the line's": {
      text: 'const { test } = require("vitest"),\n  spy = vi.fn(() => "real");\n' + logs("spy()"),
    },
    "the line below an import and an import()": {
      file: "greet.test.mjs",
      files: { "dep.js": 'export const greet = () => "real";\n' },
      text:
        'import { greet } from "./dep.js";\nconst { basename } = await import("node:path");\n' +
        vitestLine +
        "const spy = vi.fn(() => basename(greet()));\n" +
        logs("spy()"),
    },
    // Nothing that another file gets from these exports is code of this file.
    "the line first in a file that exports types and another module": {
      file: "greet.test.mts",
      files: { "dep.js": 'export const greet = () => "real";\n' },
      text:
        vitestLine +
        spy("vi") +
        logs("spy()") +
        "export type Greeting = string;\nexport type { Greeting as Text };\nexport { type Greeting as Word };\n" +
        'export * from "./dep.js";\nexport { greet } from "./dep.js";\nexport {};\n',
    },
    // The names go into the `import`, not into the line.
    "a call above the line in a file that imports from vitest": {
      file: "greet.test.mjs",
      text:
        'import { describe } from "vitest";\n' +
        spy("vi") +
        vitestLine +
        'describe("suite", () => {\n  ' +
        logs("spy()") +
        "});\n",
    },
  },

  // One run with both rules. The cast becomes `jest.mocked(greet)`, which reads the global. Had the other fix added
  // `jest` to the line below it in the same run, the call would read a variable without a value.
  "jest/prefer-jest-mocked + jest/prefer-importing-jest-globals": {
    "a cast above the line, and a call below it": {
      file: "greet.test.ts",
      text: greet + "const typed = greet as jest.Mock;\n" + jestLine + logs("jest.fn(typed)()"),
      breaks: true,
    },
  },

  "jest/prefer-jest-mocked": {
    // The fix writes `jest.mocked(greet)`, which reads `jest` where the file only named a type.
    "a cast above the line that declares jest": {
      file: "greet.test.ts",
      text: greet + "const typed = greet as jest.Mock;\n" + jestAndTest + logs("typed()"),
      held: true,
      breaks: true,
    },
    "a cast below the line that declares jest": {
      file: "greet.test.ts",
      text: jestAndTest + greet + "const typed = greet as jest.Mock;\n" + logs("typed()"),
    },
    // Bun defines this class before the first statement, and it is not Jest's object.
    "a cast above a class named jest": {
      file: "greet.test.ts",
      text:
        greet +
        "const typed = greet as jest.Mock;\n" +
        'class jest {\n  static mocked = () => () => "other";\n}\n' +
        logs('typed() + (jest.name ? "" : "")'),
      held: true,
      breaks: true,
    },
    "a cast above an enum named jest": {
      file: "greet.test.ts",
      text:
        greet +
        "const typed = greet as jest.Mock;\nenum jest {\n  mocked,\n}\n" +
        logs('typed() + (jest.mocked ? "" : "")'),
      held: true,
      breaks: true,
    },
    "a cast above a namespace named jest": {
      file: "greet.test.ts",
      text:
        greet +
        "const typed = greet as jest.Mock;\n" +
        'namespace jest {\n  export const mocked = () => () => "other";\n}\n' +
        logs('typed() + (jest.mocked ? "" : "")'),
      held: true,
      breaks: true,
    },
    "a cast above a type import of TypeScript's own kind": {
      file: "greet.test.ts",
      text:
        greet +
        "const typed = greet as jest.Mock;\n" +
        'import type jest = require("@jest/globals");\n' +
        logs("typed()"),
    },
    // An import of a type declares nothing that runs.
    "a cast in a file that exports a value and imports jest as a type": {
      file: "greet.test.ts",
      text:
        'import type { jest } from "@jest/globals";\nexport ' +
        greet +
        "const typed = greet as jest.Mock;\n" +
        logs("typed()"),
    },
    // An import has its value before any statement runs.
    "a cast above a statement, in a file that imports jest from bun:test": {
      file: "greet.test.ts",
      text:
        'import { jest, test } from "bun:test";\n' + greet + "const typed = greet as jest.Mock;\n" + logs("typed()"),
    },
  },

  "jest/no-jasmine-globals": {
    // The fix writes `expect.any(Number)`.
    "jasmine.any() above the line that declares expect": {
      text:
        jasmine +
        "const matcher = jasmine.any(Number);\n" +
        line("@jest/globals", "expect, test") +
        logs('matcher ? "real" : ""'),
      held: true,
      breaks: true,
    },
    "jasmine.any() below the line that declares expect": {
      text:
        line("@jest/globals", "expect, test") +
        jasmine +
        "const matcher = jasmine.any(Number);\n" +
        logs('matcher ? "real" : ""'),
    },
    // This `expect` isn't a `require()` line at the top, so `--fix` doesn't write it.
    "jasmine.any() below an expect that isn't Jest's": {
      text:
        'const expect = { any: () => "" };\n' +
        jasmine +
        "const matcher = jasmine.any(Number);\n" +
        logs('matcher ? "real" : String(expect.any())'),
      held: true,
      breaks: true,
    },
    // Bun runs `import expect = require(..)` as a `const`.
    "jasmine.any() above an import of TypeScript's own kind that declares expect": {
      file: "greet.test.cts",
      files: { "expect-shim.cjs": "module.exports = { any: () => 1 };\n" },
      text:
        jasmine +
        "const matcher = jasmine.any(Number);\n" +
        'import expect = require("./expect-shim.cjs");\n' +
        logs('matcher && expect ? "real" : ""'),
      held: true,
      breaks: true,
    },
    "jasmine.any() below an import of TypeScript's own kind at the top": {
      file: "greet.test.cts",
      files: { "expect-shim.cjs": "module.exports = { any: () => 1 };\n" },
      text:
        'import expect = require("./expect-shim.cjs");\n' +
        jasmine +
        "const matcher = jasmine.any(Number);\n" +
        logs('matcher && expect ? "real" : ""'),
    },
    "jasmine.any() above an import of a member that declares expect": {
      file: "greet.test.ts",
      text:
        jasmine +
        "const matcher = jasmine.any(Number);\n" +
        "const shim = { expect: { any: () => 1 } };\nimport expect = shim.expect;\n" +
        logs('matcher && expect ? "real" : ""'),
      held: true,
      breaks: true,
    },
    // `early.mjs` calls the function before the `import` below it has its module.
    "jasmine.any() in a function that the file exports, and a default import that declares expect": {
      file: "greet.test.mjs",
      files: {
        "jasmine.mjs": jasmine,
        "early.mjs": 'import { matcher } from "./greet.test.mjs";\nglobalThis[TAG] = matcher();\n',
        "expect-shim.mjs": "export default { any: () => 1 };\n",
      },
      text:
        'import "./jasmine.mjs";\nimport "./early.mjs";\nimport expect from "./expect-shim.mjs";\n' +
        "export function matcher() {\n  return jasmine.any(Number);\n}\n" +
        logs('globalThis[TAG] && expect ? "real" : ""'),
      held: true,
      breaks: true,
    },
    // The fix writes `jest.setTimeout(5000)`.
    "a timeout above the line that declares jest": {
      text: jasmine + "jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000;\n" + jestAndTest + logs('jest ? "real" : ""'),
      held: true,
      breaks: true,
    },
    "a timeout below the line that declares jest": {
      text: jestAndTest + jasmine + "jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000;\n" + logs('jest ? "real" : ""'),
    },
  },

  "jest/no-deprecated-functions": {
    // The fix writes `jest.requireActual`.
    "require.requireActual above the line that declares jest": {
      text: "const kind = typeof require.requireActual;\n" + jestAndTest + logs('kind && jest ? "real" : ""'),
      held: true,
      breaks: true,
    },
    "require.requireActual below the line that declares jest": {
      text: jestAndTest + "const kind = typeof require.requireActual;\n" + logs('kind && jest ? "real" : ""'),
    },
    // The fix writes `expect.extend`. One `const` gives `jest` and `expect` their values together.
    "jest.addMatchers below a line that declares jest and expect, below another statement": {
      text:
        other +
        line("@jest/globals", "expect, jest, test") +
        "const kind = typeof jest.addMatchers;\n" +
        logs('kind ? greeting : ""'),
    },
    // `jest.resetModules` for `jest.resetModuleRegistry` reads `jest` where the code reads it already.
    "jest.resetModuleRegistry in a function above the var line that declares jest": {
      text:
        "const kind = () => typeof jest.resetModuleRegistry;\n" +
        'var { jest, test } = require("@jest/globals");\n' +
        logs('kind() ? "real" : ""'),
    },
  },

  "jest/no-test-prefixes": {
    ...noTestPrefixes("@jest/globals"),
    // An assigned `it` can be another function than Jest's. This assignment doesn't run.
    "xit() in a file that assigns to the global it": {
      text: "if (globalThis.never) {\n  it = undefined;\n}\n" + skipped + logs('"real"'),
      held: true,
    },
  },
  // `bun test` has no `xit` in a file that gets `it` from "vitest" itself.
  "vitest/no-test-prefixes": {
    ...noTestPrefixes("vite-plus/test"),
    // The other rule writes `import { xit } from "vitest"` into this file, and `bun test` has no `xit` in that module.
    "xit() in a function named require": {
      ...noTestPrefixes("vite-plus/test")["xit() in a function named require"],
      alone: true,
    },
    // `early.mjs` calls the function before the `import` below it has its module.
    "xit() in a function that the file exports, and an import that declares it": {
      file: "greet.test.mjs",
      files: { "early.mjs": 'import { suite } from "./greet.test.mjs";\nsuite();\n' },
      text:
        'import "./early.mjs";\nimport { it } from "@effect/vitest";\n' +
        `export function suite() {\n  ${skipped}}\n` +
        logs('"real"', "it"),
      held: true,
      breaks: true,
    },
  },
  "bun:test/no-test-prefixes": {
    ...noTestPrefixes("bun:test"),
    // One `const` gives `xit` and `it` their values together, so `it` has its value wherever `xit()` runs.
    "xit() and it from one line, below another statement": {
      text: other + line("bun:test", "it, xit") + skipped + logs("greeting", "it"),
    },
    // `bun:test` is there before any file runs, so its names always have their values.
    "xit() in a file that exports a value and imports it from bun:test": {
      file: "greet.test.mjs",
      text: 'import { it, xit } from "bun:test";\nexport const greeting = "real";\n' + skipped + logs("greeting", "it"),
    },
    "xit.each() and it from one line, below another statement": {
      text:
        other + line("bun:test", "it, xit") + 'xit.each([1])("is skipped %i", () => {});\n' + logs("greeting", "it"),
    },
    // A `var` has no value above its line, and reading it doesn't throw.
    "xit() and it from one var line, below another statement": {
      text: other + 'var { it, xit } = require("bun:test");\n' + skipped + logs("greeting", "it"),
      held: true,
    },
    // The key is computed when `xit` has its value and `it` has none yet.
    "xit() in a function that a computed key of the line calls": {
      text:
        'const { xit, [pick()]: found, it } = require("bun:test");\n' +
        `function pick() {\n  ${skipped}  return "test";\n}\n` +
        logs('found ? "real" : ""', "it"),
      held: true,
      breaks: true,
    },
  },
  // These four write `expect(..)` where the file calls the function by another name.
  "jest/prefer-to-have-length": {
    "an expect under another name above the line that declares expect": {
      file: "greet.test.mjs",
      text: checked("@jest/globals", "test", "check([1].length).toBe(1);\n"),
      held: true,
      breaks: true,
    },
    "an expect under its own name": {
      file: "greet.test.mjs",
      text: 'import { expect, test } from "@jest/globals";\nexpect([1].length).toBe(1);\n' + logs('"real"'),
    },
  },
  "jest/prefer-to-have-been-called-times": {
    "an expect under another name above the line that declares expect": {
      file: "greet.test.mjs",
      text: checked(
        "@jest/globals",
        "jest, test",
        "const spy = jest.fn();\nspy();\ncheck(spy.mock.calls).toHaveLength(1);\n",
      ),
      held: true,
      breaks: true,
    },
  },
  "vitest/prefer-called-times": {
    "an expect under another name above the line that declares expect": {
      file: "greet.test.mjs",
      text: checked("vitest", "test, vi", "const spy = vi.fn();\nspy();\ncheck(spy).toHaveBeenCalledOnce();\n"),
      held: true,
      breaks: true,
    },
  },
  "vitest/prefer-expect-type-of": {
    "an expect under another name above the line that declares expect": {
      file: "greet.test.mjs",
      text: checked("vitest", "test", 'check(typeof "a").toBe("string");\n'),
      held: true,
      breaks: true,
    },
  },
  "jest/consistent-test-it": consistentTestIt("@jest/globals"),
  "vitest/consistent-test-it": consistentTestIt("vitest"),
  "bun:test/consistent-test-it": consistentTestIt("bun:test"),
};

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined, NO_COLOR: "1" };

async function run(cwd: string, ...args: string[]) {
  await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const fileOf = (it: Case) => it.file ?? "greet.test.js";
/** The cases, each with the directory that it's in and the tag that it prints its lines with. */
const cases = Object.entries(groups).flatMap(([rules, group], g) =>
  Object.entries(group).map(([name, it], c) => ({ rules, name, it, directory: `${g}/${c}`, tag: `@@${g}/${c}@@` })),
);
type Entry = (typeof cases)[number];

/** The rules of each plugin that this file has cases for. A fix of one must not break what another one fixed. */
const gated: Record<string, string[]> = {
  "jest": [
    ...["prefer-importing-jest-globals", "prefer-jest-mocked", "no-jasmine-globals", "no-deprecated-functions"],
    ...["no-test-prefixes", "consistent-test-it", "prefer-to-have-length", "prefer-to-have-been-called-times"],
  ],
  "vitest": [
    ...["prefer-importing-vitest-globals", "no-test-prefixes", "consistent-test-it", "prefer-to-have-length"],
    ...["prefer-to-have-been-called-times", "prefer-called-times", "prefer-expect-type-of"],
  ],
  "bun:test": ["no-test-prefixes", "consistent-test-it"],
};

/** The flag that `bun lint` gets in each step, and the directory with the step's copy of the cases. */
const steps = {
  "as written": { flag: undefined, copy: "as-written", together: false },
  "--fix": { flag: "--fix", copy: "fix", together: false },
  "--fix-dangerously": { flag: "--fix-dangerously", copy: "fix-dangerously", together: false },
  // With every rule of `gated` for the plugin of the case's group.
  "--fix together": { flag: "--fix", copy: "fix-together", together: true },
};
type Step = keyof typeof steps;
type Offers = "a fix" | "a fix for --fix-dangerously" | "no fix" | "no report";
type Result = {
  /** What `bun test` prints for the case. */
  prints: string[];
  /** Whether `bun lint` changed the file. */
  isFixed: boolean;
  /** For the file as written: what the reports of the rules carry. */
  offers?: Offers;
};
const results = new Map<string, Record<Step, Result>>();
const exitCodes: Partial<Record<Step, number>> = {};

// Each step has a copy of all the cases. A copy is linted in one run per group and tested in one run of `bun test`: a
// process per case and step would be some 400 of them.
beforeAll(async () => {
  const files: Files = {};
  for (const { copy, together } of Object.values(steps)) {
    for (const [path, text] of Object.entries(packages)) files[`${copy}/${path}`] = text;
    for (const { it, directory, tag } of cases) {
      if (together && it.alone) continue;
      for (const [path, text] of Object.entries({ ...it.files, [fileOf(it)]: it.text })) {
        files[`${copy}/${directory}/${path}`] = text.replaceAll("TAG", JSON.stringify(tag));
      }
    }
  }
  using dir = tempDir("bun-lint-fix-run-order", files);
  const root = realpathSync(String(dir));
  const pathOf = (copy: string, it: Entry) => join(root, copy, it.directory, fileOf(it.it));

  type Message = { ruleId: string | null; fix?: unknown; suggestions?: { fix?: unknown }[] };
  /** Runs `bun lint` on group `g` with the rules of the group turned on. Returns what the reports of each file carry. */
  const lint = async (copy: string, flag: string | undefined, rules: string, g: number, together: boolean) => {
    const plugin = rules.slice(0, rules.indexOf("/"));
    const names = together ? gated[plugin].map(it => `${plugin}/${it}`) : rules.split(" + ");
    // The rules that are on by default run too. `--fix-dangerously` applies the suggestions of these two, which
    // rewrite a declaration of a case.
    const settings = [...names.map(it => `${it}: warn`), "no-unused-vars: off", "no-case-declarations: off"];
    const args = ["lint", "-f", "json", ...(flag ? [flag] : []), ...settings.flatMap(it => ["--rule", it])];
    const { stdout, stderr } = await run(join(root, copy, String(g)), ...args);
    if (!stdout.startsWith("[")) throw new Error(`bun lint ${flag} printed no JSON: ${stdout}\n${stderr}`);
    const reported = JSON.parse(stdout) as { filePath: string; messages: Message[] }[];
    return reported.map(file => {
      const messages = file.messages.filter(it => names.includes(it.ruleId ?? ""));
      const held = messages.some(it => it.suggestions?.some(it => it.fix));
      const offers: Offers =
        messages.length === 0
          ? "no report"
          : messages.some(it => it.fix)
            ? "a fix"
            : held
              ? "a fix for --fix-dangerously"
              : "no fix";
      // The case and the file: `3/0/greet.test.js`.
      return [file.filePath.split(/[\\/]/).slice(-3).join("/"), offers] as const;
    });
  };
  const resultsOf = async (step: Step): Promise<(it: Entry) => Result> => {
    const { flag, copy, together } = steps[step];
    const linted = await Promise.all(Object.keys(groups).map((rules, g) => lint(copy, flag, rules, g, together)));
    const offers = new Map(linted.flat());
    const tested = await run(join(root, copy), "test");
    exitCodes[step] = tested.exitCode;
    const lines = tested.stdout.split("\n");
    return it => ({
      prints: lines.filter(line => line.startsWith(it.tag)).map(line => line.slice(it.tag.length + 1)),
      isFixed:
        !(together && it.it.alone) &&
        readFileSync(pathOf(copy, it), "utf8") !== readFileSync(pathOf(steps["as written"].copy, it), "utf8"),
      ...(flag ? {} : { offers: offers.get(`${it.directory}/${fileOf(it.it)}`) ?? "no report" }),
    });
  };

  // One step at a time: each one starts a `bun lint` per group.
  const all: [Step, (it: Entry) => Result][] = [];
  for (const step of Object.keys(steps) as Step[]) all.push([step, await resultsOf(step)]);
  for (const it of cases) {
    results.set(
      it.tag,
      Object.fromEntries(all.map(([step, resultOf]) => [step, resultOf(it)])) as Record<Step, Result>,
    );
  }
}, longLimit);

test("every file passes as written and after --fix", () => {
  expect(exitCodes).toMatchObject({ "as written": 0, "--fix": 0, "--fix together": 0 });
});

for (const rules of Object.keys(groups)) {
  describe(rules, () => {
    for (const { name, it, tag } of cases.filter(it => it.rules === rules)) {
      const title = it.unfixed ? "no flag fixes" : it.held ? "only --fix-dangerously fixes" : "--fix fixes";
      test(`${title}: ${name}`, () => {
        const { "as written": written, "--fix": fixed, "--fix-dangerously": all, ...others } = results.get(tag)!;
        // The test of the case runs to the line that prints.
        expect(written.prints).not.toEqual([]);
        expect(written.offers).toBe(it.unfixed ? "no fix" : it.held ? "a fix for --fix-dangerously" : "a fix");
        expect(fixed).toEqual({ prints: written.prints, isFixed: !it.held && !it.unfixed });
        if (!it.alone) expect(others["--fix together"].prints).toEqual(written.prints);
        expect(all.isFixed).toBe(!it.unfixed);
        if (it.breaks) expect(all.prints).not.toEqual(written.prints);
        else expect(all.prints).toEqual(written.prints);
      });
    }
  });
}

// The same question for the fixes that oxlint's own tests have of a Jest or Vitest rule. Each case that declares no
// name itself gets a `require()` line below its code, which declares the names of the runner that the case doesn't
// use. Whatever the fix of the rule writes, it may not write one of these names above the line, and it may not add a
// name to the line.
describe("the cases of oxlint's tests, with a require() line of the runner below them", () => {
  const names = {
    jest: "jest expect test it describe beforeEach afterEach beforeAll afterAll xit xtest fit xdescribe fdescribe",
    vitest: "vi vitest expect test it describe beforeEach afterEach beforeAll afterAll expectTypeOf assert bench suite",
  };
  const sources = { jest: "@jest/globals", vitest: "vitest" };
  type Plugin = keyof typeof names;
  type RecordedCase = { code: string; filename: string; output: string | null; options: unknown[]; settings: unknown };
  type Recorded = { rule: string; cases: RecordedCase[] };
  /** `jest.Mock` names a type, which the line doesn't declare. */
  const withoutTypes = (code: string) => code.replace(/\bjest\.(Mock|Mocked\w*|SpyInstance)\b/g, "");

  /** What oxlint's tests have for the rules of `plugin`, from the bundle of the conformance tests. */
  function recorded(bundle: Buffer, plugin: Plugin): Recorded[] {
    const header = `\n=== /oxlint/${plugin}/`;
    const rules: Recorded[] = [];
    for (
      let at = bundle.indexOf(header);
      at >= 0 && bundle.subarray(at, at + header.length).equals(Buffer.from(header));
    ) {
      const start = bundle.indexOf("\n", at + 1) + 1;
      const end = bundle.indexOf("\n=== /", start);
      rules.push(JSON.parse(bundle.toString("utf8", start, end < 0 ? bundle.length : end)));
      at = end;
    }
    return rules;
  }

  test(
    "--fix writes no name above the line that declares it",
    async () => {
      const bundle = Bun.zstdDecompressSync(await Bun.file(join(import.meta.dir, "conformance", "bundle.zst")).bytes());
      const files: Files = {};
      /** The path of each file with its rule, the names that its line declares, the line, and the whole text. */
      const written: { path: string; rule: string; declared: string[]; line: string; text: string }[] = [];
      for (const plugin of Object.keys(names) as Plugin[]) {
        for (const { rule, cases } of recorded(bundle, plugin)) {
          const id = `${plugin}/${rule}`;
          /** The directory of each combination of options and settings that a case has. */
          const configs = new Map<string, number>();
          cases.forEach(({ code, filename, output, options, settings }, index) => {
            // A case without a fix, and a case that declares the names itself, has nothing to show.
            if (output === null || /^\s*(import|export)\s|\brequire\s*\(/m.test(code)) return;
            const uses = withoutTypes(code);
            const declared = names[plugin]
              .split(" ")
              .filter(it => !new RegExp(`(^|[^\\w$.])${it}(?![\\w$])`).test(uses));
            if (declared.length === 0) return;
            const line = `\n;const { ${declared.join(", ")} } = require("${sources[plugin]}");\n`;
            const rules = { [id]: ["warn", ...(options ?? [])] };
            const rest = { categories: { correctness: "off" }, rules, settings: settings ?? undefined };
            const config = JSON.stringify({ plugins: [plugin], ...rest });
            const directory = `${id}/${configs.get(config) ?? configs.set(config, configs.size).size - 1}`;
            const path = `${directory}/${index}.${filename.slice(filename.indexOf(".") + 1)}`;
            for (const copy of ["fix", "fix-dangerously"]) {
              files[`${copy}/${directory}/.oxlintrc.json`] = config;
              files[`${copy}/${path}`] = code + line;
            }
            written.push({ path, rule: id, declared, line, text: code + line });
          });
        }
      }
      using dir = tempDir("bun-lint-fix-run-order-recorded", files);
      const root = String(dir);
      const [fix, fixDangerously] = await Promise.all(
        ["fix", "fix-dangerously"].map(copy => run(join(root, copy), "lint", `--${copy}`)),
      );

      // In `copy`: how many files changed, and the rules whose fix wrote a declared name above the line or added a name
      // to the line.
      const read = (copy: string) => {
        const early = new Set<string>();
        let changed = 0;
        for (const { path, rule, declared, line, text: before } of written) {
          const text = readFileSync(join(root, copy, path), "utf8");
          if (text !== before) changed++;
          const at = text.lastIndexOf("\n;");
          const [above, last] = [withoutTypes(text.slice(0, at)), text.slice(at)];
          const uses = declared.filter(it => new RegExp(`(^|[^\\w$.'"\`])${it}(?![\\w$])`).test(above));
          // In a module the line becomes an `import`, which has its names before any statement runs.
          if (uses.length > 0 || (last !== line && !last.startsWith("\n;import "))) early.add(rule);
        }
        return { changed, early: [...early].sort() };
      };
      expect(written.length).toBeGreaterThan(500);
      // Both runs fixed files, so the lists below are about files that have their fixes.
      expect({ fix: fix.exitCode, fixDangerously: fixDangerously.exitCode }).toEqual({ fix: 0, fixDangerously: 0 });
      const [safe, all] = [read("fix"), read("fix-dangerously")];
      expect(safe.changed).toBeGreaterThan(written.length / 2);
      expect(all.changed).toBeGreaterThan(safe.changed);
      // This one has its own change: https://github.com/oven-sh/bun/pull/48674. That change empties the list.
      expect(safe.early).toEqual(["vitest/consistent-vitest-vi"]);
      // The fixes that `--fix` holds back are the ones that do it.
      expect(all.early).toEqual(
        expect.arrayContaining([
          "jest/consistent-test-it",
          "jest/no-deprecated-functions",
          "jest/no-jasmine-globals",
          "jest/no-test-prefixes",
          "jest/prefer-importing-jest-globals",
          "jest/prefer-jest-mocked",
          "vitest/consistent-test-it",
          "vitest/no-test-prefixes",
          "vitest/prefer-importing-vitest-globals",
        ]),
      );
    },
    longLimit,
  );
});
