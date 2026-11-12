// `bun test` hoists `jest.mock()` and `vi.mock()`, keeps the caller's frame for `return jest.requireActual()` and reads
// the path from `vi.doMock(import("./dep.js"))` where `jest` or `vi` is a global or a named import from `bun:test`,
// `vitest` or `@jest/globals`. It does none of that where the name comes from `require()` or from another module, or is
// a member of a namespace. A fix that moves the name from one group to the other can change what a test does, so
// `bun lint --fix` leaves it to `--fix-dangerously`.
//
// Each case is a test file that passes. `bun test` runs it as written, after `--fix` and after `--fix-dangerously`, and
// what it prints tells which module it got. If `bun test` starts to treat one of these names in another way, a case
// here fails, and src/lint/utils/bun_test.rs has to follow.
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
   * What it prints after `--fix-dangerously`, for a case whose fix `--fix` holds back. Without it, `--fix` applies the
   * fix, and the file prints the same as before.
   */
  dangerously?: string[];
};

const dep = { "dep.js": 'console.log(TAG, "runs dep.js");\nmodule.exports = { greet: () => "real" };\n' };
const requireGreet = 'const { greet } = require("./dep.js");\n';
const importGreet = 'import { greet } from "./dep.js";\n';
const mock = (object: string) => `${object}.mock("./dep.js", () => ({ greet: () => "mock" }));\n`;
const greets = (test = "test") => `${test}("greets", () => {\n  console.log(TAG, greet());\n});\n`;
const spies = (object: string) =>
  `const spy = ${object}.fn(greet);\ntest("greets", () => {\n  console.log(TAG, spy());\n});\n`;

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
      // The mock stays hoisted. The file's first import of `vitest` changes how it runs: see run-mode.test.ts.
      "a new import": { text: requireGreet + mock("vi") + greets(), prints: ["mock"], dangerously: ["mock"] },
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

      // These keep what the calls do. Without its only load of `vitest`, the file runs in another way: see
      // run-mode.test.ts.
      "vi.fn()": {
        text: 'const { vi, test } = require("vitest");\n' + requireGreet + spies("vi"),
        prints: ["runs dep.js", "real"],
        dangerously: ["runs dep.js", "real"],
      },
      "an import from vitest": {
        text: 'import { vi, test } from "vitest";\n' + importGreet + mock("vi") + greets(),
        prints: ["mock"],
        dangerously: ["mock"],
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
      // Without the renamed import, `vi.mock()` in the place of `vitest.mock()` is a call on the global. With it,
      // both calls are on the import.
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
      "an import from @effect/vitest": {
        text: 'import { vitest, test } from "@effect/vitest";\n' + importGreet + mock("vitest") + greets(),
        prints: ["runs dep.js", "mock"],
      },
      "a default import": {
        text: 'import vitest from "vitest";\n' + importGreet + mock("vitest") + greets(),
        prints: ["runs dep.js", "real"],
      },
      "a namespace": {
        text: 'import * as vitest from "vitest";\n' + importGreet + mock("vitest") + greets(),
        prints: ["runs dep.js", "real"],
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
      "two globals": {
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
};
const results = new Map<string, Record<Step, Result>>();
let exitCodeAsWritten: number | undefined;

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
      return {
        prints,
        isFixed: readFileSync(pathOf(copy, it), "utf8") !== asWritten,
        isReported: reported.includes(pathOf(copy, it)),
      };
    };
    return [step, resultOf, tested.exitCode];
  };

  const all = await Promise.all((Object.keys(steps) as Step[]).map(resultsOf));
  exitCodeAsWritten = all.find(it => it[0] === "as written")?.[2];
  for (const it of cases) {
    results.set(
      it.tag,
      Object.fromEntries(all.map(([step, resultOf]) => [step, resultOf(it)])) as Record<Step, Result>,
    );
  }
}, longLimit);

test("every case passes as written", () => {
  expect(exitCodeAsWritten).toBe(0);
});

for (const group of groups) {
  describe(group.name, () => {
    for (const { name, it, tag } of cases.filter(it => it.group === group)) {
      const held = it.dangerously !== undefined;
      test(`${held ? "only --fix-dangerously fixes" : "--fix fixes"}: ${name}`, () => {
        expect(results.get(tag)).toEqual({
          "as written": { prints: it.prints },
          "--fix": { prints: it.prints, isFixed: !held, isReported: held },
          "--fix-dangerously": { prints: it.dangerously ?? it.prints, isFixed: true, isReported: false },
        });
      });
    }
  });
}
