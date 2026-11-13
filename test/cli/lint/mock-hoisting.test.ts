// `bun test` hoists `jest.mock()` and `vi.mock()`, keeps the caller's frame for `return jest.requireActual()` and reads
// the path from `vi.doMock(import("./dep.js"))` where `jest` or `vi` is a global or a named import from `bun:test`,
// `vitest` or `@jest/globals`. It does none of that where the name comes from `require()` or from another module, or is
// a member of a namespace. A fix that moves the name from one group to the other can change what a test does, so
// `bun lint --fix` leaves it to `--fix-dangerously`.
//
// Each case is a test file that passes. `bun test` runs it as written, after `--fix` and after `--fix-dangerously`, and
// what it prints tells which module it got. If `bun test` starts to treat one of these names in another way, a case
// here fails, and src/lint/utils/bun_test.rs has to follow.
//
// The same goes for a fix that moves a call from one object to another. `vitest/consistent-vitest-vi` renames `vitest`
// to `vi` only where both names are Vitest's object, and not where one of them is a name of the file's own.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

type Files = Record<string, string>;

type Case = {
  /** The file that the rule reports. In it and in `files`, `TAG` stands for a string that marks what the case prints. */
  text: string;
  /** Its name, if not `greet.test.js`. */
  file?: string;
  /** The files next to it, if not only `dep.js`. */
  files?: Files;
  /** What `bun test` prints for the file as written. */
  prints: string[];
  /**
   * What it prints after `--fix-dangerously`, for a case whose fix `--fix` holds back. Without it and without `noFix`,
   * `--fix` applies the fix, and the file prints the same as before.
   */
  dangerously?: string[];
  /** The file has a second fix, which `--fix` applies: it changes the file, and the rule still reports it. */
  partly?: true;
  /** `--fix-dangerously` leaves a report: its fix needs the pass after this one, and a config of oxlint gives one. */
  leaves?: true;
  /**
   * The rule has no fix for the file: no flag changes it, and its reports offer none. That isn't a fix that `bun lint`
   * drops because the text it writes doesn't parse. Only for a case with a `bunfig.toml`: the JSON that a config of
   * oxlint gives doesn't say whether a report has a fix.
   */
  noFix?: true;
};

const dep = { "dep.js": 'console.log(TAG, "runs dep.js");\nmodule.exports = { greet: () => "real" };\n' };
const requireGreet = 'const { greet } = require("./dep.js");\n';
const importGreet = 'import { greet } from "./dep.js";\n';
const mock = (object: string) => `${object}.mock("./dep.js", () => ({ greet: () => "mock" }));\n`;
const greets = (test = "test") => `${test}("greets", () => {\n  console.log(TAG, greet());\n});\n`;
const spies = (object: string) =>
  `const spy = ${object}.fn(greet);\ntest("greets", () => {\n  console.log(TAG, spy());\n});\n`;
const chain = (object: string) =>
  `test("greets", async () => {\n  console.log(TAG, await ${object}.importActual("./dep.js").then(it => it.greet()));\n});\n`;
const typeOfVi = "export type Utils = typeof vi;\n";

// A function in `helpers/` calls `jest.requireActual("./dep.js")` and the like for a test in `tests/`. `bun test` looks
// for `./dep.js` next to the file that the frame of the call's caller names. That's `helpers/actual.js`, unless the
// call is the function's last, which drops the frame in strict code.
const helper = (body: string, test = "console.log(TAG, Object.keys(actual()).join());") => ({
  file: "helpers/actual.js",
  text: `"use strict";\nmodule.exports = function actual() {\n  ${body}\n};\n`,
  files: {
    "helpers/dep.js": "module.exports = { helpers: true };\n",
    "tests/dep.js": "module.exports = { tests: true };\n",
    "tests/greet.test.js": `const actual = require("../helpers/actual.js");\ntest("finds dep.js", async () => {\n  ${test}\n});\n`,
  },
});
/** The test for a helper that mocks `./dep.js`, or removes the mock. */
const mocks = 'actual();\n  console.log(TAG, Object.keys(require("./dep.js")).join());';
const unmocks = `jest.doMock("./dep.js", () => ({ mocked: true }));\n  ${mocks}`;
/** The test for a helper that imports `./dep.js`. */
const imports = 'console.log(TAG, Object.keys(await actual()).filter(it => it !== "default").join());';

const doMock = (call: string) =>
  `test("greets", async () => {\n  ${call}(import("./dep.js"), () => ({ greet: () => "mock" }));\n  console.log(TAG, require("./dep.js").greet());\n});\n`;

// Test files in which `name`, which is `vitest` or `vi`, is a name of the file's own and not Vitest's object. Each
// prints "string" until a fix moves the call to the other name, which is Vitest's global. `moved` is what it prints
// then: the type of what `fn()` of the global returns, or nothing where the global has no such function and throws.
const ownNames = (name: "vitest" | "vi"): Record<string, { text: string; moved: string[] }> => {
  const value = '{ fn: () => "own" }';
  const returnsFn = (declaration: string) => ({
    text: `${declaration}\nconst greet = () => ${name}.fn();\n`,
    moved: ["function"],
  });
  const inFunction = (parameters: string, body = `return ${name}.fn();`) => ({
    text: `function greet(${parameters}) {\n  ${body}\n}\n`,
    moved: ["function"],
  });
  const throws = (declaration: string, call: string) => ({
    text: `${declaration}\nfunction greet() {\n  ${name}.${call};\n  return "own";\n}\n`,
    moved: [],
  });
  return {
    "a parameter": inFunction(`${name} = ${value}`),
    "a destructured parameter": inFunction(`{ ${name} } = { ${name}: ${value} }`),
    "a catch variable": inFunction(
      "",
      `try {\n    throw ${value};\n  } catch (${name}) {\n    return ${name}.fn();\n  }`,
    ),
    "a variable": returnsFn(`const ${name} = ${value};`),
    "a variable below the call": {
      text: `const greet = () => ${name}.fn();\nvar ${name} = ${value};\n`,
      moved: ["function"],
    },
    "a variable with two declarations": returnsFn(`var { ${name} } = require("vitest");\nvar ${name} = ${value};`),
    "a function": returnsFn(`function ${name}() {}\n${name}.fn = () => "own";`),
    "a class": returnsFn(`class ${name} {\n  static fn() {\n    return "own";\n  }\n}`),
    "a name from another module": returnsFn(`const { ${name} } = require("./own.js");`),
    "another export of vitest": throws(`const { expect: ${name} } = require("vitest");`, "any(String)"),
    "the whole module": throws(`const ${name} = require("vitest");`, 'expect("own")'),
  };
};
const ownFiles = { ...dep, "own.js": 'const own = { fn: () => "own" };\nmodule.exports = { vitest: own, vi: own };\n' };
/** A case for each of `ownNames`. The rule goes by the name, as oxlint does, so it reports them. `--fix` holds the fix back. */
const ownCases = (name: "vitest" | "vi"): Record<string, Case> =>
  Object.fromEntries(
    Object.entries(ownNames(name)).map(([title, { text, moved }]) => [
      `a call on ${title}`,
      {
        text:
          'const { test } = require("vitest");\n' +
          text +
          'test("greets", () => {\n  console.log(TAG, typeof greet());\n});\n',
        files: ownFiles,
        prints: ["string"],
        dangerously: moved,
      },
    ]),
  );
/** A call on a name from `require()` in a function, in a file that imports the name from Vitest as `imported`. */
const nestedRequire = (imported: string) =>
  `import ${imported} from "vitest";\nimport { test } from "vitest";\n` +
  'function spy() {\n  const { vitest } = require("vitest");\n  return vitest.fn();\n}\n' +
  'test("greets", () => {\n  console.log(TAG, typeof spy());\n});\n';
/** A file that sets a global `vitest` of its own and calls `fn()` on `object`. It removes the global: the cases share a process. */
const assignsGlobal = (object: string) =>
  requireGreet +
  'vitest = { fn: () => "own" };\n' +
  `test("greets", () => {\n  console.log(TAG, typeof ${object}.fn());\n  delete globalThis.vitest;\n});\n`;
/** A use of the global `vi` in a file that imports `vitest` from Vitest as `imported`. */
const besideGlobalVi = (imported: string, use: string) =>
  `import ${imported} from "vitest";\nimport { test } from "vitest";\n` +
  `test("greets", () => {\n  console.log(TAG, typeof vi.fn(), typeof ${use});\n});\n`;

// Packages that the Vitest rules take for Vitest, and `bun test` doesn't.
const packages: Files = {
  "node_modules/@effect/vitest/package.json": '{ "name": "@effect/vitest", "type": "module", "main": "index.js" }',
  "node_modules/@effect/vitest/index.js": 'export * from "vitest";\n',
  "node_modules/vite-plus/package.json":
    '{ "name": "vite-plus", "type": "module", "exports": { "./test": "./test.js" } }',
  "node_modules/vite-plus/test.js": 'export * from "vitest";\n',
};

const groups: { name: string; rule: string; config: Files; cases: Record<string, Case> }[] = [
  {
    name: "jest/prefer-importing-jest-globals",
    rule: "jest/prefer-importing-jest-globals",
    config: { "bunfig.toml": '[lint.rules]\n"jest/prefer-importing-jest-globals" = "warn"\n' },
    cases: {
      // The fix inserts `const { jest, test } = require('@jest/globals');`, and `jest.mock()` then runs where it stands.
      "a mock below a require()": {
        text: requireGreet + mock("jest") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "in a .cjs file": {
        file: "greet.test.cjs",
        text: requireGreet + mock("jest") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "in a .cts file": {
        file: "greet.test.cts",
        text: requireGreet + mock("jest") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "in a .ts file": {
        file: "greet.test.ts",
        text: requireGreet + mock("jest") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "vi.mock()": {
        text: requireGreet + mock("vi") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "jest.unmock() below a require()": {
        text: mock("jest") + requireGreet + 'jest.unmock("./dep.js");\n' + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["mock"],
      },
      "a chain of mocks": {
        text:
          requireGreet + 'jest.mock("./dep.js", () => ({ greet: () => "mock" })).unmock("./other.js");\n' + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "vi.hoisted() below a statement": {
        text:
          'globalThis[TAG] = "below";\nconst where = vi.hoisted(() => globalThis[TAG] ?? "above");\n' +
          'test("is hoisted", () => {\n  console.log(TAG, where);\n});\n',
        prints: ["above"],
        dangerously: ["below"],
      },
      "a mock with a type argument": {
        file: "greet.test.ts",
        text:
          requireGreet + '(jest.mock<unknown>)("./dep.js", () => ({ greet: () => "mock" }));\njest.fn();\n' + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      // `bun test` hoists `const name = "mock"` with the mock, and the factory runs in the `require()`.
      "a literal that a mock reads, below a require()": {
        text:
          'jest.mock("./dep.js", () => ({ name, greet: () => "mock" }));\n' +
          requireGreet +
          'const name = "mock";\n' +
          greets(),
        prints: ["mock"],
        dangerously: [],
      },
      "the name joins the names from require()": {
        text: 'const { test } = require("@jest/globals");\n' + requireGreet + mock("jest") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      // A call that keeps its caller's frame for `jest` the global, as the function's last call.
      'return jest.requireActual("./dep.js")': {
        ...helper('return jest.requireActual("./dep.js");'),
        prints: ["helpers"],
        dangerously: ["tests"],
      },
      "a returned variable with jest.requireActual()": {
        ...helper('const dep = jest.requireActual("./dep.js");\n  return dep;'),
        prints: ["helpers"],
        dangerously: ["tests"],
      },
      "an arrow function that returns jest.requireActual()": {
        ...helper('const load = () => jest.requireActual("./dep.js");\n  return load();'),
        prints: ["helpers"],
        dangerously: ["tests"],
      },
      "a returned && with jest.requireActual()": {
        ...helper('return module && jest.requireActual("./dep.js");'),
        prints: ["helpers"],
        dangerously: ["tests"],
      },
      'return jest.requireMock("./dep.js")': {
        ...helper('return jest.requireMock("./dep.js");'),
        prints: ["helpers"],
        dangerously: ["tests"],
      },
      'return jest.createMockFromModule("./dep.js")': {
        ...helper('return jest.createMockFromModule("./dep.js");'),
        prints: ["helpers"],
        dangerously: ["tests"],
      },
      'return jest.mock("./dep.js")': {
        ...helper('return jest.mock("./dep.js", () => ({ mocked: true }));', mocks),
        prints: ["tests"],
        dangerously: ["mocked"],
      },
      'return jest.doMock("./dep.js")': {
        ...helper('return jest.doMock("./dep.js", () => ({ mocked: true }));', mocks),
        prints: ["tests"],
        dangerously: ["mocked"],
      },
      'return jest.unmock("./dep.js")': {
        ...helper('return jest.unmock("./dep.js");', unmocks),
        prints: ["mocked"],
        dangerously: ["tests"],
      },
      'return jest.dontMock("./dep.js")': {
        ...helper('return jest.dontMock("./dep.js");', unmocks),
        prints: ["mocked"],
        dangerously: ["tests"],
      },
      'return vi.importActual("./dep.js")': {
        ...helper('return vi.importActual("./dep.js");', imports),
        prints: ["helpers"],
        dangerously: ["tests"],
      },
      'return vi.importMock("./dep.js")': {
        ...helper('return vi.importMock("./dep.js");', imports),
        prints: ["helpers"],
        dangerously: ["tests"],
      },
      'return vi.doUnmock("./dep.js")': {
        ...helper('return vi.doUnmock("./dep.js");', unmocks),
        prints: ["mocked"],
        dangerously: ["tests"],
      },
      // A call that gets its path from an `import()` for `jest` the global.
      "jest.doMock() with an import() for its path": {
        text: doMock("jest.doMock"),
        prints: ["mock"],
        dangerously: ["runs dep.js"],
      },
      'jest["doMock"]() with an import() for its path': {
        text: doMock('jest["doMock"]'),
        prints: ["mock"],
        dangerously: ["runs dep.js"],
      },
      "jest.mock() with an import() for its path": {
        text: 'jest.mock(import("./dep.js"), () => ({ greet: () => "mock" }));\n' + requireGreet + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js"],
      },
      "jest.unmock() with an import() for its path": {
        text: 'jest.unmock(import("./dep.js"));\n' + requireGreet + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js"],
      },
      "vi.doUnmock() with an import() for its path": {
        text: 'test("greets", () => {\n  vi.doUnmock(import("./dep.js"));\n  console.log(TAG, require("./dep.js").greet());\n});\n',
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js"],
      },
      // A name from `require()` becomes a named import.
      "require() becomes import": {
        text: importGreet + 'const { jest } = require("@jest/globals");\n' + mock("jest") + greets(),
        prints: ["runs dep.js", "mock"],
        dangerously: ["mock"],
      },
      "require() becomes import, with another name": {
        text: importGreet + 'const { jest: j } = require("@jest/globals");\n' + mock("j") + greets(),
        prints: ["runs dep.js", "mock"],
        dangerously: ["mock"],
      },
      // The fix drops the declaration, which makes `jest` the global. A second fix then adds it to the `require()`.
      "a jest that the fix doesn't keep": {
        text: 'const jest = require("@jest/globals").jest;\n' + requireGreet + mock("jest") + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js", "real"],
      },
      // The default export and the namespace have `mock()` of `bun:test`, which makes a mock function. The fix makes
      // the default import a named one, and drops the namespace.
      "a default import called jest": {
        text: 'import jest from "@jest/globals";\n' + importGreet + mock("jest") + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["mock"],
      },
      "a namespace called jest": {
        text: 'import * as jest from "@jest/globals";\n' + importGreet + mock("jest") + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["mock"],
      },

      "jest.fn()": { text: requireGreet + spies("jest"), prints: ["runs dep.js", "real"] },
      "a mock above the require()": { text: mock("jest") + requireGreet + greets(), prints: ["mock"] },
      "a literal and a mock above the require()": {
        text:
          'const name = "mock";\njest.mock("./dep.js", () => ({ name, greet: () => "mock" }));\n' +
          requireGreet +
          greets(),
        prints: ["mock"],
      },
      // A function declaration is there before the first statement runs, and the types never run.
      "a function and types above the mock": {
        file: "greet.test.ts",
        text:
          "interface Dep {\n  greet(): string;\n}\ndeclare const flag: boolean;\nfunction helper(dep: Dep) {\n  return dep.greet();\n}\n" +
          mock("jest") +
          requireGreet +
          'test("greets", () => {\n  console.log(TAG, helper({ greet }));\n});\n',
        prints: ["mock"],
      },
      "a mock in a test": {
        text: 'test("greets", () => {\n  jest.doMock("./dep.js", () => ({ greet: () => "mock" }));\n  console.log(TAG, require("./dep.js").greet());\n});\n',
        prints: ["mock"],
      },
      "jest.requireActual() that isn't returned": {
        text:
          'jest.mock("./dep.js", () => ({ ...jest.requireActual("./dep.js"), mocked: true }));\n' +
          'const dep = require("./dep.js");\ntest("greets", () => {\n  console.log(TAG, dep.greet(), dep.mocked);\n});\n',
        prints: ["runs dep.js", "real true"],
      },
      "a returned object with jest.requireActual()": {
        ...helper('return { ...jest.requireActual("./dep.js") };'),
        prints: ["helpers"],
      },
      // A global becomes a named import, and `bun test` hoists for both.
      "import": { text: importGreet + mock("jest") + greets(), prints: ["mock"] },
      "the name joins the imported names": {
        text: 'import { test } from "@jest/globals";\n' + importGreet + mock("jest") + greets(),
        prints: ["mock"],
      },
      "require() becomes import, with jest.fn()": {
        text: importGreet + 'const { jest } = require("@jest/globals");\n' + spies("jest"),
        prints: ["runs dep.js", "real"],
      },
      // `jest` already comes from `require()`.
      "a jest from require()": {
        text: 'const { jest } = require("@jest/globals");\n' + requireGreet + mock("jest") + greets(),
        prints: ["runs dep.js", "real"],
      },
    },
  },
  {
    name: "jest/prefer-importing-jest-globals with an oxlint config",
    rule: "jest/prefer-importing-jest-globals",
    config: { ".oxlintrc.json": '{ "plugins": ["jest"], "rules": { "jest/prefer-importing-jest-globals": "warn" } }' },
    cases: {
      "a mock below a require()": {
        text: requireGreet + mock("jest") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "jest.fn()": { text: requireGreet + spies("jest"), prints: ["runs dep.js", "real"] },
    },
  },
  {
    name: "vitest/prefer-importing-vitest-globals",
    rule: "vitest/prefer-importing-vitest-globals",
    config: { "bunfig.toml": '[lint.rules]\n"vitest/prefer-importing-vitest-globals" = "warn"\n' },
    cases: {
      // The global `vi` becomes a name from `require()`.
      "vi.mock()": {
        text: 'const { test } = require("vitest");\n' + requireGreet + mock("vi") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "vi!.mock()": {
        file: "greet.test.ts",
        text: 'const { test } = require("vitest");\n' + requireGreet + mock("vi!") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "vi.hoisted()": {
        text:
          'const { test } = require("vitest");\nglobalThis[TAG] = "below";\nconst where = vi.hoisted(() => globalThis[TAG] ?? "above");\n' +
          'test("is hoisted", () => {\n  console.log(TAG, where);\n});\n',
        prints: ["above"],
        dangerously: ["below"],
      },
      "vi.doMock() with an import() for its path": {
        text: 'const { test } = require("vitest");\n' + doMock("vi.doMock"),
        prints: ["mock"],
        dangerously: ["runs dep.js"],
      },
      // It becomes a named import from a module that `bun test` doesn't know.
      "the name joins the names from @effect/vitest": {
        text: 'import { test } from "@effect/vitest";\n' + importGreet + mock("vi") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "mock"],
      },
      "an import from vite-plus/test": {
        text: 'const plus = require("vite-plus/test");\n' + requireGreet + mock("vi") + greets("plus.test"),
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },

      "vi.fn()": {
        text: 'const { test } = require("vitest");\n' + requireGreet + spies("vi"),
        prints: ["runs dep.js", "real"],
      },
      // It becomes a named import from `vitest`.
      "the name joins the names from vitest": {
        text: 'import { test } from "vitest";\n' + importGreet + mock("vi") + greets(),
        prints: ["mock"],
      },
      "a new import": { text: requireGreet + mock("vi") + greets(), prints: ["mock"] },
    },
  },
  {
    name: "vitest/no-importing-vitest-globals",
    rule: "vitest/no-importing-vitest-globals",
    config: { "bunfig.toml": '[lint.rules]\n"vitest/no-importing-vitest-globals" = "warn"\n' },
    cases: {
      // A name from `require()` becomes a global.
      "vi.mock()": {
        text: 'const { vi, test } = require("vitest");\n' + requireGreet + mock("vi") + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["mock"],
      },
      // So does a named import from a module that `bun test` doesn't know.
      "an import from vite-plus/test": {
        text: 'import { vi, test } from "vite-plus/test";\n' + importGreet + mock("vi") + greets(),
        prints: ["runs dep.js", "mock"],
        dangerously: ["mock"],
      },

      "vi.fn()": {
        text: 'const { vi, test } = require("vitest");\n' + requireGreet + spies("vi"),
        prints: ["runs dep.js", "real"],
      },
      "an import from vitest": {
        text: 'import { vi, test } from "vitest";\n' + importGreet + mock("vi") + greets(),
        prints: ["mock"],
      },
    },
  },
  {
    name: "vitest/consistent-vitest-vi",
    rule: "vitest/consistent-vitest-vi",
    // `--fix-dangerously` also applies the suggestion of `no-unused-vars`, which removes an import that has no use.
    config: { "bunfig.toml": '[lint.rules]\n"vitest/consistent-vitest-vi" = "warn"\n"no-unused-vars" = "off"\n' },
    cases: {
      // `vitest` comes from `require()`, and the `vi` that replaces it is a global.
      "vitest.mock()": {
        text: 'const { vitest, test } = require("vitest");\n' + requireGreet + mock("vitest") + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["mock"],
      },
      "with a declared vi": {
        file: "greet.test.ts",
        text:
          "declare const vi: { mock(path: string, factory: () => unknown): void };\n" +
          'const { vitest, test } = require("vitest");\n' +
          requireGreet +
          mock("vitest") +
          greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["mock"],
      },

      // The renamed import declares `vi`, which takes the calls on the global `vi`.
      "an import from @effect/vitest, and the global vi": {
        text: 'import { vitest, test } from "@effect/vitest";\n' + importGreet + mock("vi") + greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "mock"],
      },
      // A declaration that is gone when the file runs leaves the global `vi`.
      "an import from @effect/vitest, and a declared vi": {
        file: "greet.test.ts",
        text:
          "declare namespace vi {\n  function mock(path: string, factory: () => unknown): void;\n}\n" +
          'import { vitest, test } from "@effect/vitest";\n' +
          importGreet +
          mock("vi") +
          greets(),
        prints: ["mock"],
        dangerously: ["runs dep.js", "mock"],
      },
      // One fix renames the import and the calls on it. A file with only one of the two renamed runs differently.
      "an import from @effect/vitest with a mock, and the global vi": {
        text:
          'import { vitest, test } from "@effect/vitest";\n' +
          importGreet +
          'vi.unmock("./other.js");\n' +
          mock("vitest") +
          greets(),
        prints: ["runs dep.js", "mock"],
        dangerously: ["runs dep.js", "mock"],
      },
      // The call would be on another `vi` than the one that the renamed import declares.
      "an import that has another vi": {
        text: 'import { test as vi, vitest } from "vitest";\n' + importGreet + mock("vitest") + greets("vi"),
        prints: ["mock"],
        dangerously: ["runs dep.js"],
      },
      "a call in a function that has another vi": {
        text:
          'import { vitest, test } from "vitest";\n' +
          'function register(vi) {\n  vitest.doMock("./dep.js", () => ({ greet: () => "mock" }));\n}\n' +
          "register({ doMock() {} });\n" +
          'test("greets", () => {\n  console.log(TAG, require("./dep.js").greet());\n});\n',
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      // The same for a name from `require()`, and for a call that is no module mock call on an import.
      "a call on a name from require() in a function that has another vi": {
        text:
          'const { vitest, test } = require("vitest");\n' +
          'function register(vi) {\n  vitest.doMock("./dep.js", () => ({ greet: () => "mock" }));\n}\n' +
          "register({ doMock() {} });\n" +
          'test("greets", () => {\n  console.log(TAG, require("./dep.js").greet());\n});\n',
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      // A `vi` beside the name is another thing too, unless one declaration has both.
      "a call in a function that has the name and another vi": {
        text:
          'const { vitest, test } = require("vitest");\n' +
          'function register(vitest, vi) {\n  vitest.doMock("./dep.js", () => ({ greet: () => "mock" }));\n}\n' +
          "register(vitest, { doMock() {} });\n" +
          'test("greets", () => {\n  console.log(TAG, require("./dep.js").greet());\n});\n',
        prints: ["mock"],
        dangerously: ["runs dep.js", "real"],
      },
      "a spy on an import that has another vi": {
        text:
          'import { test as vi, vitest } from "vitest";\n' +
          importGreet +
          'const spy = vitest.fn(greet);\nvi("greets", () => {\n  console.log(TAG, spy());\n});\n',
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js"],
      },
      // A `vi` that isn't Vitest's object is another thing as well: another export under that name, from `require()`
      // as from an import of a package that `bun test` doesn't know, and a `vi` that only a type of that name hides.
      "a spy on a name from require() beside another export as vi": {
        text:
          'const { vitest, test: vi } = require("vitest");\n' +
          requireGreet +
          'const spy = vitest.fn(greet);\nvi("greets", () => {\n  console.log(TAG, spy());\n});\n',
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js"],
      },
      "a spy on an import from @effect/vitest that has another vi": {
        text:
          'import { test as vi, vitest } from "@effect/vitest";\n' +
          importGreet +
          'const spy = vitest.fn(greet);\nvi("greets", () => {\n  console.log(TAG, spy());\n});\n',
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js"],
      },
      "a call under a type that has the name of another vi": {
        file: "greet.test.ts",
        text:
          'import { test } from "vitest";\n' +
          'const vi = { fn: () => "own" };\n' +
          "function spy() {\n  type vi = string;\n  return vitest.fn();\n}\n" +
          'test("greets", () => {\n  console.log(TAG, typeof spy(), typeof vi.fn());\n});\n',
        prints: ["function string"],
        dangerously: ["string string"],
      },
      "a use of an import under a type that has the name of another vi": {
        file: "greet.test.ts",
        text:
          'import { vitest, test } from "vitest";\n' +
          "function spies() {\n" +
          '  const vi = { fn: () => "own" };\n' +
          "  function spy() {\n    type vi = string;\n    return vitest.fn();\n  }\n" +
          '  return typeof spy() + " " + typeof vi.fn();\n}\n' +
          'test("greets", () => {\n  console.log(TAG, spies());\n});\n',
        prints: ["function string"],
        dangerously: ["string string"],
      },
      // A name that the file assigns to can be anything at the call. That goes for the name and for `vi`.
      "a call on a name from require() that the file assigns to": {
        text:
          'let { vitest, test } = require("vitest");\n' +
          'vitest = { fn: () => "own" };\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn());\n});\n',
        prints: ["string"],
        dangerously: ["function"],
      },
      "a call beside a vi from the same require() that the file assigns to": {
        text:
          'let { vi, vitest, test } = require("vitest");\n' +
          'vi = { fn: () => "own" };\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn());\n});\n',
        prints: ["function"],
        dangerously: ["string"],
      },
      // So can a global that the file sets, also where a `declare` or a type has its name. `bun test` has no `vitest`
      // of its own in a file that loads no Vitest module. The cases share a process, so the file removes its global.
      "a call on a global that the file assigns to": {
        text: assignsGlobal("vitest"),
        prints: ["runs dep.js", "string"],
        dangerously: ["runs dep.js", "function"],
      },
      "a call on a global under a declare that the file assigns to": {
        file: "greet.test.cts",
        text:
          "declare let vitest: { fn(): unknown };\n" +
          'vitest = { fn: () => "own" };\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn());\n  delete (globalThis as any).vitest;\n});\n',
        prints: ["string"],
        dangerously: ["function"],
      },
      "a call on a global beside an interface of its name that the file assigns to": {
        file: "greet.test.cts",
        text:
          "interface vitest {\n  fn(): unknown;\n}\n" +
          'vitest = { fn: () => "own" };\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn());\n  delete (globalThis as any).vitest;\n});\n',
        prints: ["string"],
        dangerously: ["function"],
      },
      // A use of the global on its own that is no assignment holds nothing back.
      "a call on a global that the file also reads on its own": {
        text:
          'const { test } = require("vitest");\n' +
          "const same = vitest;\n" +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn(), same === vi);\n});\n',
        prints: ["function true"],
      },
      // A file that loads the name itself can be for a runner that has no global `vi`, as Vitest is by default. Vitest
      // can't load `require("vitest")`, and it can load the two below.
      "a call on a name from await import()": {
        text:
          'const { vitest, test } = await import("vitest");\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn());\n});\n',
        prints: ["function"],
        dangerously: ["function"],
      },
      "a call on a name from require() of @effect/vitest": {
        text:
          'const { vitest, test } = require("@effect/vitest");\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn());\n});\n',
        prints: ["function"],
        dangerously: ["function"],
      },
      // The default and a namespace are the module, not Vitest's object. Under the name `vi` they take the uses of
      // the global `vi`, and a call that has a fix of its own.
      "a default import": {
        text: 'import vitest from "vitest";\n' + importGreet + mock("vitest") + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js", "real"],
      },
      "a namespace": {
        text: 'import * as vitest from "vitest";\n' + importGreet + mock("vitest") + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js", "real"],
      },
      "a default import, and a use of the global vi": {
        text: besideGlobalVi("vitest", "vitest.vi.fn"),
        prints: ["function function"],
        dangerously: [],
      },
      "a namespace, and a use of the global vi": {
        text: besideGlobalVi("* as vitest", "vitest.vi.fn"),
        prints: ["function function"],
        dangerously: [],
      },
      "a default import, and a call on a name from require() in a function": {
        text: nestedRequire("vitest"),
        prints: ["function"],
        dangerously: [],
      },
      "a namespace, and a call on a name from require() in a function": {
        text: nestedRequire("* as vitest"),
        prints: ["function"],
        dangerously: [],
      },
      // oxlint writes the entries of an import as one list of names in braces, which is wrong text for an import that
      // has the default or a namespace beside another entry. Such an import has no fix.
      "a default import beside a named import": {
        text:
          'import vitest, { test } from "vitest";\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.vi.fn);\n});\n',
        prints: ["function"],
        noFix: true,
      },
      "a namespace beside a default import": {
        text:
          'import runner, * as vitest from "vitest";\n' +
          'runner.test("greets", () => {\n  console.log(TAG, typeof vitest.vi.fn);\n});\n',
        prints: ["function"],
        noFix: true,
      },
      "a named import beside a default import": {
        text:
          'import runner, { vitest } from "vitest";\n' +
          'runner.test("greets", () => {\n  console.log(TAG, typeof vitest.fn());\n});\n',
        prints: ["function"],
        noFix: true,
      },
      // A type of the name merges with the import. The fix of the import renames the uses of the type too and leaves
      // its declaration, which TypeScript rejects (TS2749).
      "an import beside a type of its name": {
        file: "greet.test.ts",
        text:
          'import { vitest, test } from "vitest";\n' +
          "type vitest = ReturnType<typeof vitest.fn>;\n" +
          'test("greets", () => {\n  const spy: vitest = vitest.fn();\n  console.log(TAG, typeof spy);\n});\n',
        prints: ["function"],
        dangerously: ["function"],
      },
      // The rule goes by the name, as oxlint does, so it reports a call on a name that isn't Vitest's object. `--fix`
      // leaves such a call alone.
      ...ownCases("vitest"),
      "a call on a name from a require() that the file declares": {
        file: "greet.test.mjs",
        text:
          'import { test } from "vitest";\n' +
          'const require = () => ({ vitest: { fn: () => "own" } });\n' +
          'const { vitest } = require("vitest");\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn());\n});\n',
        prints: ["string"],
        dangerously: ["function"],
      },
      // The fix of this import writes an import of `vi` in place of the other export.
      "an import of another export under the name": {
        text:
          'import { expect as vitest, test } from "vitest";\n' +
          'test("greets", () => {\n  vitest.any(String);\n  console.log(TAG, "own");\n});\n',
        prints: ["own"],
        dangerously: [],
      },
      // Here `--fix` renames the import, and the call's own fix would move the call to the `vi` that the import then
      // declares.
      "a call on a parameter of the name": {
        text:
          'import { vitest, test } from "vitest";\n' +
          'function register(vitest) {\n  vitest.doMock("./dep.js", () => ({ greet: () => "mock" }));\n}\n' +
          "register({ doMock() {} });\n" +
          'test("greets", () => {\n  console.log(TAG, require("./dep.js").greet());\n});\n',
        prints: ["runs dep.js", "real"],
        dangerously: ["mock"],
        partly: true,
      },
      // `vitest` comes from `require()`, and `vi` is a global. The call isn't the last of its function, so it runs
      // the same under both names.
      "a chain on a name from require()": {
        text: 'const { vitest, test } = require("vitest");\n' + chain("vitest"),
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js", "real"],
      },
      // `vi` is a type-only import. TypeScript rejects a use of it as a value (TS1361), and `bun test` takes it for the
      // global `vi`.
      "an import that has a type-only vi": {
        file: "greet.test.ts",
        text: 'import { type vi, vitest, test } from "vitest";\n' + importGreet + mock("vitest") + typeOfVi + greets(),
        prints: ["mock"],
        dangerously: ["mock"],
      },
      // An interface of the same name doesn't make the type-only `vi` a value.
      "an import that has a type-only vi, and an interface named vi": {
        file: "greet.test.ts",
        text:
          'import { type vi, vitest, test } from "vitest";\n' +
          importGreet +
          mock("vitest") +
          "export interface vi {\n  name: string;\n}\n" +
          typeOfVi +
          greets(),
        prints: ["mock"],
        dangerously: ["mock"],
      },
      "a use that is no call, and a type-only vi": {
        file: "greet.test.ts",
        text:
          'import { type vi, vitest, test } from "vitest";\n' +
          "const api = vitest;\n" +
          typeOfVi +
          'test("greets", () => {\n  console.log(TAG, typeof api.fn);\n});\n',
        prints: ["function"],
        dangerously: ["function"],
      },
      "a call on the global, and a type-only vi": {
        file: "greet.test.ts",
        text:
          'import type { vi } from "vitest";\nimport { test } from "vitest";\n' +
          importGreet +
          mock("vitest") +
          typeOfVi +
          greets(),
        prints: ["mock"],
        dangerously: ["mock"],
      },
      "a spy on the global, and a type-only vi": {
        file: "greet.test.ts",
        text: 'import { type vi, test } from "vitest";\n' + importGreet + typeOfVi + spies("vitest"),
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js", "real"],
      },
      // The name is a type-only import, and so is the `vi` that it becomes. That `vi` would take the call on the global.
      "a type-only import of the name, and a call on the global vi": {
        file: "greet.test.ts",
        text:
          'import type { vitest } from "vitest";\nimport { test } from "vitest";\n' +
          importGreet +
          mock("vi") +
          "export type Utils = typeof vitest;\n" +
          greets(),
        prints: ["mock"],
        dangerously: ["mock"],
      },
      // Under `import type`, the `vi` is a type-only import beside another name too. A `type` in the braces stays only
      // where the name is the only specifier.
      "a type-only import of the name and of a type, and a call on the global vi": {
        file: "greet.test.ts",
        text:
          'import type { Mock, vitest } from "vitest";\nimport { test } from "vitest";\n' +
          importGreet +
          mock("vi") +
          "export type Utils = typeof vitest | Mock;\n" +
          greets(),
        prints: ["mock"],
        dangerously: ["mock"],
      },
      "a type-only name as the only specifier, and a call on the global vi": {
        file: "greet.test.ts",
        text:
          'import { type vitest } from "vitest";\nimport { test } from "vitest";\n' +
          importGreet +
          mock("vi") +
          "export type Utils = typeof vitest;\n" +
          greets(),
        prints: ["mock"],
        dangerously: ["mock"],
      },

      "vitest.fn()": {
        text: 'const { vitest, test } = require("vitest");\n' + requireGreet + spies("vitest"),
        prints: ["runs dep.js", "real"],
      },
      "an import from vitest, and the global vi": {
        text: 'import { vitest, test } from "vitest";\n' + importGreet + mock("vi") + greets(),
        prints: ["mock"],
      },
      // `bun test` has the global `vitest` in a file that imports or requires `vitest`.
      "two globals": {
        text: 'const { test } = require("vitest");\n' + requireGreet + mock("vitest") + greets(),
        prints: ["mock"],
      },
      "two names from require()": {
        text: 'const { vi, vitest, test } = require("vitest");\n' + requireGreet + mock("vitest") + greets(),
        prints: ["runs dep.js", "real"],
      },
      // The rule renames the import too.
      "an import from vitest": {
        text: 'import { vitest, test } from "vitest";\n' + importGreet + mock("vitest") + greets(),
        prints: ["mock"],
      },
      "an import that has vi too": {
        text: 'import { vi, vitest, test } from "vitest";\n' + importGreet + mock("vitest") + greets(),
        prints: ["mock"],
      },
      "an import from @effect/vitest": {
        text: 'import { vitest, test } from "@effect/vitest";\n' + importGreet + mock("vitest") + greets(),
        prints: ["runs dep.js", "mock"],
      },
      // These are Vitest's object too: a name from `require()` in a function, from one `await import()` with `vi`, and
      // a declared global. The call in the function gets its fix in the pass after the fix of the import.
      "a call on a name from require() in a function": {
        text:
          'const { test } = require("vitest");\n' +
          'test("greets", () => {\n  const { vitest } = require("vitest");\n  console.log(TAG, typeof vitest.fn());\n});\n',
        prints: ["function"],
      },
      "an import of the name, and a call on a name from require() in a function": {
        text: nestedRequire("{ vitest }"),
        prints: ["function"],
      },
      "two names from await import()": {
        file: "greet.test.mjs",
        text:
          'const { vi, vitest, test } = await import("vitest");\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn(), typeof vi.fn);\n});\n',
        prints: ["function function"],
      },
      "a call on a declared global": {
        file: "greet.test.ts",
        text:
          'import { test } from "vitest";\ndeclare const vitest: { fn(): unknown };\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vitest.fn());\n});\n',
        prints: ["function"],
      },
      // The fix of an import renames every use of the name: the calls above it,
      "a mock above the import": {
        text: mock("vitest") + 'import { vitest, test } from "@effect/vitest";\n' + importGreet + greets(),
        prints: ["runs dep.js", "mock"],
      },
      // a call that the rule doesn't report, which `bun test` takes for a call on `vitest` all the same,
      "a mock that the rule doesn't report": {
        text:
          'import { test } from "vitest";\nimport { vitest } from "@effect/vitest";\n' +
          importGreet +
          '(vitest).mock("./dep.js", () => ({ greet: () => "mock" }));\n' +
          greets(),
        prints: ["runs dep.js", "mock"],
      },
      // and a use that is no call. `{ vitest }` becomes `{ vitest: vi }`.
      "uses that are not calls": {
        text:
          'import { vitest, test } from "@effect/vitest";\n' +
          "const api = vitest;\nconst apis = { vitest };\n" +
          'test("greets", () => {\n  console.log(TAG, typeof api.fn, Object.keys(apis).join());\n});\n',
        prints: ["function vitest"],
      },
      // Only the name changes in a chain. The rule reports the chain's first call, `vitest.importActual("./dep.js")`.
      "a chain on the global": {
        text: 'const { test } = require("vitest");\n' + chain("vitest"),
        prints: ["runs dep.js", "real"],
      },
      "a chain on an import": {
        text: 'import { vitest, test } from "vitest";\n' + chain("vitest"),
        prints: ["runs dep.js", "real"],
      },
      // A type-only `vi` is as good as the name in a type, and for a name that is a type-only import itself.
      "a use in a type, and a type-only vi": {
        file: "greet.test.ts",
        text:
          'import { type vi, vitest, test } from "vitest";\n' +
          importGreet +
          "export type Utils = typeof vi | typeof vitest;\n" +
          greets(),
        prints: ["runs dep.js", "real"],
      },
      "type-only imports of the name and of vi": {
        file: "greet.test.ts",
        text:
          'import type { vi, vitest } from "vitest";\nimport { test } from "vitest";\n' +
          importGreet +
          mock("vitest") +
          typeOfVi +
          greets(),
        prints: ["mock"],
      },
      // The same for a call that has its own fix, because no import from Vitest has the name. TypeScript rejects the
      // call as written, and the rename to a type-only `vi` adds nothing.
      "type-only imports of the name and of vi from another module": {
        file: "greet.test.ts",
        text:
          'import type { vi, vitest } from "./types";\nimport { test } from "vitest";\n' +
          importGreet +
          mock("vitest") +
          greets(),
        prints: ["mock"],
      },
      // A type-only `vi` is as good as the global `vi` in a type too.
      "a type-only import of the name, and the global vi in a type": {
        file: "greet.test.ts",
        text:
          'import type { vitest } from "vitest";\nimport { test } from "vitest";\n' +
          importGreet +
          "export type Utils = typeof vitest | typeof vi;\n" +
          greets(),
        prints: ["runs dep.js", "real"],
      },
      // Beside another specifier, the fix writes `vi` without `type`. The call on the global then has a value.
      "a type-only import of the name beside test, and a call on the global vi": {
        file: "greet.test.ts",
        text:
          'import { type vitest, test } from "vitest";\n' +
          importGreet +
          mock("vi") +
          "export type Utils = typeof vitest;\n" +
          greets(),
        prints: ["mock"],
      },
      // So it has where the name has no `type` and is the only specifier.
      "the name as the only specifier, and a call on the global vi": {
        text:
          'import { vitest } from "vitest";\nimport { test } from "vitest";\n' + importGreet + mock("vi") + greets(),
        prints: ["mock"],
      },
      // An interface or a type named `vi` is no second declaration of the `vi` that the import then declares.
      "an interface named vi beside the import": {
        file: "greet.test.ts",
        text:
          'import { vitest, test } from "vitest";\n' +
          importGreet +
          mock("vitest") +
          "export interface vi {\n  name: string;\n}\n" +
          greets(),
        prints: ["mock"],
      },
      "a type named vi beside the import": {
        file: "greet.test.ts",
        text:
          'import { vitest, test } from "vitest";\n' +
          importGreet +
          mock("vitest") +
          "export type vi = string;\n" +
          greets(),
        prints: ["mock"],
      },
    },
  },
  {
    name: 'vitest/consistent-vitest-vi with fn: "vitest"',
    rule: "vitest/consistent-vitest-vi",
    config: { "bunfig.toml": '[lint.rules]\n"vitest/consistent-vitest-vi" = ["warn", { fn = "vitest" }]\n' },
    cases: {
      "vi.mock()": {
        text: 'const { vi, test } = require("vitest");\n' + requireGreet + mock("vi") + greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["mock"],
      },
      "an import that has a type-only vitest": {
        file: "greet.test.ts",
        text:
          'import { type vitest, vi, test } from "vitest";\n' +
          importGreet +
          mock("vi") +
          "export type Utils = typeof vitest;\n" +
          greets(),
        prints: ["mock"],
        dangerously: ["mock"],
      },
      "two globals": {
        text: 'const { test } = require("vitest");\n' + requireGreet + mock("vi") + greets(),
        prints: ["mock"],
      },
      ...ownCases("vi"),
      // `bun test` has no global `vitest` in a file that loads no module named `vitest`.
      "a call on a name from require() of @effect/vitest": {
        text:
          'const { vi, test } = require("@effect/vitest");\n' +
          'test("greets", () => {\n  console.log(TAG, typeof vi.fn());\n});\n',
        prints: ["function"],
        dangerously: [],
      },
      // A file can set that global itself, and the new name is then the file's own object.
      "a call beside a global vitest that the file assigns to": {
        text: assignsGlobal("vi"),
        prints: ["runs dep.js", "function"],
        dangerously: ["runs dep.js", "string"],
      },
    },
  },
  {
    // A config of oxlint gives a fix one pass, and nothing rolls back a fix that declares a name twice.
    name: "vitest/consistent-vitest-vi with an .oxlintrc.json",
    rule: "vitest/consistent-vitest-vi",
    config: {
      ".oxlintrc.json":
        '{ "plugins": ["vitest"], "categories": { "correctness": "off" }, "rules": { "vitest/consistent-vitest-vi": "warn" } }',
    },
    cases: {
      // The renamed import would be a second import of `vi`, which TypeScript rejects (TS2300).
      "a type-only vi in another statement": {
        file: "greet.test.ts",
        text:
          'import type { vi } from "vitest";\nimport { vitest, test } from "vitest";\n' +
          importGreet +
          typeOfVi +
          greets(),
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js", "real"],
      },
      // The same for a value import. `bun test` doesn't load a JavaScript file that imports `vi` twice.
      "vi in another statement": {
        text:
          'import { vi } from "vitest";\nimport { vitest, test } from "vitest";\n' +
          importGreet +
          mock("vi") +
          greets(),
        prints: ["mock"],
        dangerously: [],
      },
      // A name that isn't Vitest's object keeps its name with this config too.
      ...ownCases("vitest"),
      "an import of another export under the name": {
        text:
          'import { expect as vitest, test } from "@effect/vitest";\n' +
          'const own = vitest;\ntest("greets", () => {\n  console.log(TAG, typeof own.any);\n});\n',
        prints: ["function"],
        dangerously: ["undefined"],
      },
      "a namespace, and a use of the global vi": {
        text: besideGlobalVi("* as vitest", "vitest.vi.fn"),
        prints: ["function function"],
        dangerously: [],
      },
      // One pass renames the import. The call in the function has no fix while an import from Vitest has the name.
      "a default import, and a call on a name from require() in a function": {
        text: nestedRequire("vitest"),
        prints: ["function"],
        dangerously: ["function"],
        leaves: true,
      },
      "a namespace, and a call on a name from require() in a function": {
        text: nestedRequire("* as vitest"),
        prints: ["function"],
        dangerously: ["function"],
        leaves: true,
      },
      "a call on a global that the file assigns to": {
        text: assignsGlobal("vitest"),
        prints: ["runs dep.js", "string"],
        dangerously: ["runs dep.js", "function"],
      },
    },
  },
  {
    name: 'vitest/consistent-vitest-vi with fn: "vitest" and an .oxlintrc.json',
    rule: "vitest/consistent-vitest-vi",
    config: {
      ".oxlintrc.json":
        '{ "plugins": ["vitest"], "categories": { "correctness": "off" }, "rules": { "vitest/consistent-vitest-vi": ["warn", { "fn": "vitest" }] } }',
    },
    cases: ownCases("vi"),
  },
  {
    name: "vitest/prefer-import-in-mock",
    rule: "vitest/prefer-import-in-mock",
    config: { "bunfig.toml": '[lint.rules]\n"vitest/prefer-import-in-mock" = "warn"\n' },
    cases: {
      // `bun test` reads the path from `vi.mock(import("./dep.js"))` for a `vi` that it knows. For another, the
      // `import()` runs, and `vi.mock()` throws.
      "an import from @effect/vitest": {
        text: 'import { vi, test } from "@effect/vitest";\n' + importGreet + mock("vi") + greets(),
        prints: ["runs dep.js", "mock"],
        dangerously: ["runs dep.js"],
      },

      "an import from vitest": {
        text: 'import { vi, test } from "vitest";\n' + importGreet + mock("vi") + greets(),
        prints: ["mock"],
      },
      "the global vi": {
        text: 'const { test } = require("vitest");\n' + requireGreet + mock("vi") + greets(),
        prints: ["mock"],
      },
    },
  },
  {
    name: "import/no-namespace",
    rule: "import/no-namespace",
    config: { "bunfig.toml": '[lint.rules]\n"import/no-namespace" = "warn"\n' },
    cases: {
      // A member of a namespace becomes a named import. Jest hoists for the member too, and `bun test` doesn't yet.
      "runner.jest.mock()": {
        text: 'import * as runner from "@jest/globals";\n' + importGreet + mock("runner.jest") + greets("runner.test"),
        prints: ["runs dep.js", "mock"],
        dangerously: ["mock"],
      },
      'runner["jest"].mock()': {
        text:
          'import * as runner from "@jest/globals";\n' + importGreet + mock('runner["jest"]') + greets("runner.test"),
        prints: ["runs dep.js", "mock"],
        dangerously: ["mock"],
      },

      "runner.jest.fn()": {
        text:
          'import * as runner from "@jest/globals";\n' +
          importGreet +
          'const spy = runner.jest.fn(greet);\nrunner.test("greets", () => {\n  console.log(TAG, spy());\n});\n',
        prints: ["runs dep.js", "real"],
      },
      "a namespace of another module": {
        text:
          'import * as dep from "./dep.js";\n' +
          mock("jest") +
          'test("greets", () => {\n  console.log(TAG, dep.greet());\n});\n',
        prints: ["mock"],
      },
    },
  },
];

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined, NO_COLOR: "1" };

async function run(cwd: string, ...args: string[]) {
  await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const fileOf = (it: Case) => it.file ?? "greet.test.js";
/** The cases, each with the directory that it's in and the tag that it prints its lines with. */
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
  /** Whether `bun lint` changed the file. Not for the file as written. */
  isFixed?: boolean;
  /** Whether the rule still reports the file. Not for the file as written, which isn't linted. */
  isReported?: boolean;
  /** Whether one of those reports has a fix for some flag. Only for a case with `noFix`. */
  hasFix?: boolean;
};
const results = new Map<string, Record<Step, Result>>();
/** The exit code of `bun test` in each step. */
const exitCodes: Partial<Record<Step, number>> = {};

// Each step has a copy of all the cases. A copy is linted in one run per rule and tested in one run of `bun test`: a
// process per case and step would be some 300 of them.
beforeAll(async () => {
  const files: Files = { ...packages };
  for (const { copy } of Object.values(steps)) {
    groups.forEach((group, g) => {
      for (const [name, content] of Object.entries(group.config)) files[`${copy}/${g}/${name}`] = content;
    });
    for (const { it, directory, tag } of cases) {
      for (const [path, text] of Object.entries({ ...(it.files ?? dep), [fileOf(it)]: it.text })) {
        files[`${copy}/${directory}/${path}`] = text.replaceAll("TAG", JSON.stringify(tag));
      }
    }
  }
  using dir = tempDir("bun-lint-mock-hoisting", files);
  const root = String(dir);

  /** Runs `bun lint` with the rule of group `g`. Returns what the rule still reports: the file, and whether the report has a fix. */
  const lint = async (copy: string, flag: string, g: number) => {
    const { stdout, stderr } = await run(join(root, copy, String(g)), "lint", "-f", "json", flag);
    if (!/^[[{]/.test(stdout)) throw new Error(`bun lint ${flag} printed no JSON: ${stdout}\n${stderr}`);
    const json = JSON.parse(stdout);
    type Message = { ruleId: string | null; fix?: unknown; suggestions?: unknown[] };
    // An oxlint config gives oxlint's JSON, which has no fixes.
    const reports: { path: string; rule: string; hasFix: boolean }[] = Array.isArray(json)
      ? json.flatMap((file: { filePath: string; messages: Message[] }) =>
          file.messages.map(it => ({
            path: file.filePath,
            rule: it.ruleId ?? "",
            hasFix: it.fix !== undefined || (it.suggestions ?? []).length > 0,
          })),
        )
      : json.diagnostics.map((it: { filename: string; code: string }) => ({
          path: join(root, copy, String(g), it.filename),
          rule: it.code.replace(/^(?:eslint-plugin-)?([\w-]+)\((.+)\)$/, "$1/$2"),
          hasFix: false,
        }));
    return reports.filter(it => it.rule === groups[g].rule);
  };
  const resultsOf = async (step: Step): Promise<[Step, (it: (typeof cases)[number]) => Result, number]> => {
    const { flag, copy } = steps[step];
    const reported = flag ? (await Promise.all(groups.map((_, g) => lint(copy, flag, g)))).flat() : [];
    const tested = await run(join(root, copy), "test");
    const lines = tested.stdout.split("\n");
    const pathOf = (copy: string, it: (typeof cases)[number]) => join(root, copy, it.directory, fileOf(it.it));
    const resultOf = (it: (typeof cases)[number]): Result => {
      const prints = lines.filter(line => line.startsWith(it.tag)).map(line => line.slice(it.tag.length + 1));
      if (!flag) return { prints };
      const asWritten = readFileSync(pathOf(steps["as written"].copy, it), "utf8");
      const reports = reported.filter(report => report.path === pathOf(copy, it));
      return {
        prints,
        isFixed: readFileSync(pathOf(copy, it), "utf8") !== asWritten,
        isReported: reports.length > 0,
        ...(it.it.noFix ? { hasFix: reports.some(report => report.hasFix) } : {}),
      };
    };
    return [step, resultOf, tested.exitCode];
  };

  const all = await Promise.all((Object.keys(steps) as Step[]).map(resultsOf));
  for (const [step, , exitCode] of all) exitCodes[step] = exitCode;
  for (const it of cases) {
    results.set(
      it.tag,
      Object.fromEntries(all.map(([step, resultOf]) => [step, resultOf(it)])) as Record<Step, Result>,
    );
  }
}, longLimit);

// A file that `--fix-dangerously` changes can fail.
test("every case passes as written and after --fix", () => {
  expect({ "as written": exitCodes["as written"], "--fix": exitCodes["--fix"] }).toEqual({
    "as written": 0,
    "--fix": 0,
  });
});

for (const group of groups) {
  describe(group.name, () => {
    for (const { name, it, tag } of cases.filter(it => it.group === group)) {
      const noFix = it.noFix === true;
      const held = it.dangerously !== undefined || noFix;
      const fixes = noFix ? "no flag fixes" : held ? "only --fix-dangerously fixes" : "--fix fixes";
      const offered = noFix ? { hasFix: false } : {};
      test(`${fixes}: ${name}`, () => {
        expect(results.get(tag)).toEqual({
          "as written": { prints: it.prints },
          "--fix": { prints: it.prints, isFixed: !held || it.partly === true, isReported: held, ...offered },
          "--fix-dangerously": {
            prints: it.dangerously ?? it.prints,
            isFixed: !noFix,
            isReported: noFix || it.leaves === true,
            ...offered,
          },
        });
      });
    }
  });
}
