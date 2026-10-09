// https://github.com/oven-sh/bun/issues/10428
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every fixture pushes what happens, in order, to `globalThis.events` and prints it from a test.
const modules = {
  "mod.ts": `
    (globalThis.events ??= []).push("load mod");
    export const value = "real";
    export default "real default";
    export function self(this: unknown) { return this; }
  `,
  "side.ts": `
    import { value } from "./mod";
    (globalThis.events ??= []).push("load side");
    export const captured = value;
  `,
  "other.ts": `
    (globalThis.events ??= []).push("load other");
    export const other = "other";
  `,
};
const print = `test("print", () => console.log(JSON.stringify(globalThis.events ?? [])));`;

async function run(
  files: Record<string, string>,
  args: string[] = ["hoist.test.ts"],
  env: Record<string, string> = {},
) {
  using dir = tempDir("mock-hoist", { ...modules, ...files });
  return await runIn(String(dir), args, env);
}

async function runIn(cwd: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, ...env },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** The events of a fixture whose tests all pass. */
async function events(files: Record<string, string>, args?: string[]) {
  const { stdout, stderr, exitCode } = await run(files, args);
  expect(stderr).toContain(" 0 fail");
  expect(exitCode).toBe(0);
  // --parallel prints what its workers print to stderr.
  return (stdout + stderr)
    .split("\n")
    .filter(line => line.startsWith("["))
    .map(line => JSON.parse(line));
}

describe.concurrent("hoisting", () => {
  test.each([
    [`import { test, vi } from "vitest";`, "vi.mock"],
    [`import { test, vi } from "bun:test";`, "vi.mock"],
    [`import { test, jest } from "bun:test";`, "jest.mock"],
    [`import { test, jest } from "@jest/globals";`, "jest.mock"],
    [`import { test, vi as aliased } from "vitest";`, "aliased.mock"],
    [`import { test, jest as aliased } from "@jest/globals";`, "aliased.mock"],
    [``, "vi.mock"],
    [``, "jest.mock"],
  ])("%s %s() runs before the imports", async (header, mock) => {
    expect(
      await events({
        "hoist.test.ts": `
          ${header}
          import { captured } from "./side";
          ${mock}("./mod", () => ({ value: "mocked" }));
          events.push(captured);
          ${print}
        `,
      }),
    ).toEqual([["load side", "mocked"]]);
  });

  // Whether babel-jest hoists each.
  test.each([
    [`jest.mock("./mod", () => ({ value: "mocked" })).mock("./other", () => ({ other: "mocked" }))`, true],
    [
      `jest.unmock("./side").mock("./mod", () => ({ value: "mocked" })).mock("./other", () => ({ other: "mocked" }))`,
      true,
    ],
    [`await jest.mock("./mod", () => ({ value: "mocked" })).mock("./other", () => ({ other: "mocked" }))`, true],
    [`jest.mock("./mod", () => ({ value: "mocked" })).doMock("./other", () => ({ other: "mocked" }))`, false],
    [`jest.doMock("./mod", () => ({ value: "mocked" })).mock("./other", () => ({ other: "mocked" }))`, false],
    [
      `jest.mock("./mod", () => ({ value: "mocked" })).useRealTimers().mock("./other", () => ({ other: "mocked" }))`,
      false,
    ],
    [
      `jest.mock("./mod", () => ({ value: "mocked" })).mock("./other", () => ({ other: "mocked" })).dontMock("./side")`,
      false,
    ],
    [
      `const same = jest.mock("./mod", () => ({ value: "mocked" })).mock("./other", () => ({ other: "mocked" }))`,
      false,
    ],
  ])("a chain: %s", async (chain, isHoisted) => {
    expect(
      await events({
        "hoist.test.ts": `
          import { value } from "./mod";
          import { other } from "./other";
          ${chain};
          (globalThis.events ??= []).push(value, other);
          ${print}
        `,
      }),
      // A mock that is not hoisted replaces the exports of the modules, which were loaded.
    ).toEqual([isHoisted ? ["mocked", "mocked"] : ["load mod", "load other", "mocked", "mocked"]]);
  });

  test.each([
    ["hoist.test.js", ["load other", "load side", "mocked"]],
    ["hoist.test.mjs", ["load other", "load side", "mocked"]],
    ["hoist.test.jsx", ["load other", "load side", "mocked"]],
    // TypeScript removes the unused import.
    ["hoist.test.ts", ["load side", "mocked"]],
    ["hoist.test.mts", ["load side", "mocked"]],
    ["hoist.test.tsx", ["load side", "mocked"]],
  ])("in %s", async (name, expected) => {
    expect(
      await events(
        {
          [name]: `
            import { test, vi } from "vitest";
            import { other } from "./other";
            import { captured } from "./side";
            vi.mock("./mod", () => ({ value: "mocked" }));
            events.push(captured);
            ${print}
          `,
        },
        [name],
      ),
    ).toEqual([expected]);
  });

  test("every shape of import reads the mock", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import def from "./mod";
          import { value } from "./mod";
          import { value as renamed, "quoted name" as quoted } from "./mod";
          import * as ns from "./mod";
          import def2, { value as value2 } from "./mod";
          import def3, * as ns2 from "./mod";
          import "./other";
          import {} from "./side";
          vi.mock("./mod", () => ({ default: "mocked default", value: "mocked", "quoted name": "quoted" }));
          events.push(def, value, renamed, quoted, ns.value, ns.default, def2, value2, def3, ns2.value, ns === ns2);
          events.push({ def, value }, Object.keys(ns));
          ${print}
        `,
      }),
    ).toEqual([
      [
        "load other",
        "load side",
        "mocked default",
        "mocked",
        "mocked",
        "quoted",
        "mocked",
        "mocked default",
        "mocked default",
        "mocked",
        "mocked default",
        "mocked",
        true,
        { def: "mocked default", value: "mocked" },
        ["default", "value", "quoted name"],
      ],
    ]);
  });

  test("an import is a live binding", async () => {
    expect(
      await events({
        "counter.ts": `export let count = 0; export function increment() { count++; }`,
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import def, { value } from "./mod";
          import { count, increment } from "./counter";
          vi.mock("./mod", () => ({ default: "first default", value: "first" }));
          test("mock again", () => {
            (globalThis.events ??= []).push(def, value, count);
            increment();
            vi.mock("./mod", () => ({ default: "second default", value: "second" }));
            events.push(def, value, count);
          });
          ${print}
        `,
      }),
    ).toEqual([["first default", "first", 0, "second default", "second", 1]]);
  });

  test("a call of an import has no this", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import { self } from "./mod";
          import * as ns from "./mod";
          vi.mock("./unrelated", () => ({}));
          events.push(self() === undefined, self\`\` === undefined, self?.() === undefined, ns.self() === ns, new self() instanceof self);
          ${print}
        `,
      }),
    ).toEqual([["load mod", true, true, true, true, true]]);
  });

  test("hoisted statements, then imports, then the rest, each in source order", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          (globalThis.events ??= []).push("body 1");
          import { test, vi, jest } from "bun:test";
          vi.hoisted(() => (globalThis.events ??= []).push("hoisted 1"));
          import "./other";
          jest.mock((events.push("hoisted 2"), "./a"), () => ({}));
          events.push("body 2", typeof captured);
          const three = vi.hoisted(() => events.push("hoisted 3"));
          vi.mock((events.push("hoisted 4"), "./b"), () => ({}));
          import { captured } from "./side";
          events.push("body 3", three);
          ${print}
        `,
      }),
    ).toEqual([
      [
        "hoisted 1",
        "hoisted 2",
        "hoisted 3",
        "hoisted 4",
        "load other",
        "load mod",
        "load side",
        "body 1",
        "body 2",
        "string",
        "body 3",
        3,
      ],
    ]);
  });

  test("vi.hoisted in every form", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import { value } from "./mod";
          vi.hoisted(() => { (globalThis.events ??= []).push("statement"); });
          await vi.hoisted(async () => { await 1; events.push("awaited statement"); });
          const constant = vi.hoisted(() => "const");
          let variable = vi.hoisted(() => "let");
          var old = vi.hoisted(() => "var");
          const { a, b: [b] } = vi.hoisted(() => ({ a: "a", b: ["b"] }));
          const awaited = await vi.hoisted(async () => "awaited");
          const first = "first", second = vi.hoisted(() => first + " second");
          export const exported = vi.hoisted(() => "exported");
          const typed = vi.hoisted<string>(() => "typed") as string;
          vi.mock("./mod", () => ({ value: [constant, variable, old, a, b, awaited, second, exported, typed] }));
          events.push(value);
          ${print}
        `,
      }),
    ).toEqual([
      [
        "statement",
        "awaited statement",
        ["const", "let", "var", "a", "b", "awaited", "first second", "exported", "typed"],
      ],
    ]);
  });

  test("unmock is hoisted", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi, jest } from "bun:test";
          import "./mod";
          vi.hoisted(() => {
            const unmock = path => { (globalThis.events ??= []).push("unmock " + path); };
            Object.defineProperty(vi, "unmock", { value: unmock, configurable: true });
            Object.defineProperty(jest, "unmock", { value: unmock, configurable: true });
          });
          vi.unmock("./a");
          jest.unmock("./b");
          ${print}
        `,
      }),
    ).toEqual([["unmock ./a", "unmock ./b", "load mod"]]);
  });

  test("an awaited vi.mock is hoisted", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import { captured } from "./side";
          await vi.mock("./mod", () => ({ value: "mocked" }));
          events.push(captured);
          ${print}
        `,
      }),
    ).toEqual([["load side", "mocked"]]);
  });

  test("a builtin and a package are mocked before the imports", async () => {
    expect(
      await events({
        "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
        "node_modules/pkg/index.js": `(globalThis.events ??= []).push("load pkg"); module.exports = { name: "real" };`,
        "uses.ts": `
          import { existsSync } from "node:fs";
          import pkg from "pkg";
          export const exists = existsSync("/"), name = pkg.name;
        `,
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import { exists, name } from "./uses";
          import fs, { existsSync } from "node:fs";
          vi.mock("node:fs", () => ({ default: { existsSync: () => "default" }, existsSync: () => "mocked" }));
          vi.mock("pkg", () => ({ default: { name: "mocked" } }));
          (globalThis.events ??= []).push(exists, name, existsSync("/"), fs.existsSync("/"));
          ${print}
        `,
      }),
    ).toEqual([["mocked", "mocked", "mocked", "default"]]);
  });

  test("in a file that a test imports", async () => {
    expect(
      await events({
        "setup.ts": `
          import { vi } from "vitest";
          import { captured } from "./side";
          vi.mock("./mod", () => ({ value: "mocked" }));
          export const copy = captured;
        `,
        "hoist.test.ts": `
          import { test } from "bun:test";
          import { copy } from "./setup";
          events.push(copy);
          ${print}
        `,
      }),
    ).toEqual([["load side", "mocked"]]);
  });

  test("JSX", async () => {
    expect(
      await events(
        {
          "node_modules/react/package.json": `{ "name": "react" }`,
          "node_modules/react/jsx-dev-runtime.js": `exports.jsxDEV = (type, props) => ({ type, props }); exports.Fragment = "fragment";`,
          "node_modules/react/jsx-runtime.js": `exports.jsx = exports.jsxs = (type, props) => ({ type, props }); exports.Fragment = "fragment";`,
          "component.tsx": `(globalThis.events ??= []).push("load component"); export function Component() {} export const name = "real";`,
          "hoist.test.tsx": `
          import { test, vi } from "vitest";
          import { Component, name } from "./component";
          vi.mock("./component", () => ({ Component: "mocked", name: "mocked name" }));
          const element = <Component name={name}><></></Component>;
          (globalThis.events ??= []).push(element.type, element.props.name, element.props.children.type);
          ${print}
        `,
        },
        ["hoist.test.tsx"],
      ),
    ).toEqual([["mocked", "mocked name", "fragment"]]);
  });
});

describe.concurrent("imports that stay static", () => {
  test("a type-only import is still removed", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import type { A } from "./does-not-exist-1";
          import { type B } from "./does-not-exist-2";
          import { C } from "./does-not-exist-3";
          import D, * as E from "./does-not-exist-4";
          import { value, Unused } from "./mod";
          vi.mock("./mod", () => ({ value: "mocked" }));
          const typed: A | B | C | D | E.F | Unused = value;
          (globalThis.events ??= []).push(typed);
          ${print}
        `,
      }),
    ).toEqual([["mocked"]]);
  });

  test("an import with attributes", async () => {
    expect(
      await events({
        "data.ts": `not typescript`,
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import text from "./data.ts" with { type: "text" };
          import { value } from "./mod";
          vi.mock("./mod", () => ({ value: "mocked" }));
          function read() { return text; }
          (globalThis.events ??= []).push(text, value, read.toString().replace(/\\s+/g, " "));
          ${print}
        `,
      }),
    ).toEqual([["not typescript", "mocked", "function read() { return text; }"]]);
  });

  test("import defer", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import defer * as deferred from "./other";
          import { value } from "./mod";
          vi.mock("./mod", () => ({ value: "mocked" }));
          (globalThis.events ??= []).push(value);
          events.push(deferred.other);
          ${print}
        `,
      }),
    ).toEqual([["mocked", "load other", "other"]]);
  });

  test("export from, and an import that an export clause names", async () => {
    expect(
      await events({
        "reexports.ts": `
          import { vi } from "vitest";
          import { other } from "./other";
          import * as ns from "./other";
          import { value } from "./mod";
          export { value as fromClause } from "./mod";
          export * from "./side";
          vi.mock("./unrelated", () => ({}));
          export { other, other as renamed, ns };
          export const read = () => [other, value];
        `,
        "hoist.test.ts": `
          import { test } from "bun:test";
          import * as all from "./reexports";
          events.push(Object.keys(all), all.other, all.renamed, all.ns.other, all.fromClause, all.captured, all.read());
          events.push(all.read.toString().replace(/\\s+/g, " "));
          ${print}
        `,
      }),
    ).toEqual([
      [
        "load other",
        "load mod",
        "load side",
        ["captured", "fromClause", "ns", "other", "read", "renamed"],
        "other",
        "other",
        "other",
        "real",
        "real",
        ["other", "real"],
        "() => [other, import_mod$1.value]",
      ],
    ]);
  });

  test(`"bun"`, async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import Bun2, { version } from "bun";
          import * as ns from "bun";
          import { value } from "./mod";
          vi.mock("./mod", () => ({ value: [Bun2 === Bun, version === Bun.version, ns.version === Bun.version] }));
          (globalThis.events ??= []).push(value);
          ${print}
        `,
      }),
    ).toEqual([[[true, true, true]]]);
  });
});

describe.concurrent("not hoisted", () => {
  // The real module loads first, and `function read` keeps the import as it is written.
  const unchanged = ["load mod", "load side", "real", "function read() { return captured; }"];
  const body = `
    function read() { return captured; }
    events.push(captured, read.toString().replace(/\\s+/g, " "));
    ${print}
  `;

  test.each([
    [
      "a local vi",
      `const vi = { mock() {}, hoisted() {} }; vi.mock("./mod", () => ({ value: "mocked" })); vi.hoisted(() => {});`,
    ],
    ["a local jest", `function jest() {} jest.mock = () => {}; jest.mock("./mod", () => ({ value: "mocked" }));`],
    [
      "vi of another module",
      `import { vi } from "./vi"; vi.mock("./mod", () => ({ value: "mocked" })); const x = vi.hoisted(() => {});`,
    ],
    [
      "another export of a test module",
      `import { mock as vi, test } from "bun:test"; vi.mock = () => {}; vi.mock("./mod", () => ({ value: "mocked" }));`,
    ],
    ["mock.module", `import { mock, test } from "bun:test"; mock.module("./mod", () => ({ value: "mocked" }));`],
    [
      "doMock",
      `vi.doMock = jest.doMock = () => {}; vi.doMock("./mod", () => ({ value: "mocked" })); jest.doMock("./mod", () => ({ value: "mocked" }));`,
    ],
    ["doUnmock and dontMock", `vi.doUnmock = jest.dontMock = () => {}; vi.doUnmock("./mod"); jest.dontMock("./mod");`],
    ["jest.hoisted", `jest.hoisted = () => {}; jest.hoisted(() => {}); const x = jest.hoisted(() => {});`],
    ["a using declaration", `using x = vi.hoisted(() => ({ [Symbol.dispose]() {} }));`],
    ["a block", `{ vi.mock("./mod", () => ({ value: "mocked" })); }`],
    ["an if", `if (true) vi.mock("./mod", () => ({ value: "mocked" }));`],
    ["a function", `(() => { vi.mock("./mod", () => ({ value: "mocked" })); const x = vi.hoisted(() => 1); })();`],
    ["part of an expression", `void vi.mock("./mod", () => ({ value: "mocked" })); const x = [vi.hoisted(() => 1)];`],
    [
      "an optional chain",
      `vi?.mock("./mod", () => ({ value: "mocked" })); vi.mock?.("./mod", () => ({ value: "mocked" }));`,
    ],
    ["a computed member", `vi["mock"]("./mod", () => ({ value: "mocked" }));`],
    ["a reference", `const { mock } = vi; mock("./mod", () => ({ value: "mocked" })); vi.mock;`],
    ["no mock", ``],
  ])("%s", async (_, statements) => {
    expect(
      await events({
        "vi.ts": `export const vi = { mock() {}, hoisted() {} };`,
        "hoist.test.ts": `
          import { captured } from "./side";
          ${statements}
          ${body}
        `,
      }),
    ).toEqual([unchanged]);
  });

  test("a nested vi.mock runs in place in a file that hoists another", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import { value } from "./mod";
          import { other } from "./other";
          vi.mock("./mod", () => ({ value: "mocked" }));
          events.push(value, other);
          { vi.mock("./other", () => ({ other: "mocked in a block" })); }
          events.push(other);
          test("in a test", () => {
            vi.mock("./other", () => ({ other: "mocked in a test" }));
            events.push(other);
          });
          ${print}
        `,
      }),
    ).toEqual([["load other", "mocked", "other", "mocked in a block", "mocked in a test"]]);
  });

  test("without a hoisted statement the module has no top-level await", async () => {
    expect(
      await events({
        "sync.ts": `import { captured } from "./side"; export { captured }; { vi.mock("./unrelated", () => ({})); }`,
        "hoist.test.ts": `
          const { captured } = require("./sync.ts");
          events.push(captured);
          ${print}
        `,
      }),
    ).toEqual([["load mod", "load side", "real"]]);
  });
});

describe.concurrent("vi.mock(import(path))", () => {
  test("names the module without importing it", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi, jest } from "bun:test";
          import { value } from "./mod";
          import { other } from "./other";
          vi.mock(import("./mod"), () => ({ value: "mocked" }));
          vi.mock(await import("./other"), () => ({ other: "mocked other" }));
          (globalThis.events ??= []).push(value, other);
          const paths = [];
          for (const api of [vi, jest])
            for (const name of ["mock", "unmock", "doMock", "doUnmock"])
              Object.defineProperty(api, name, { value: path => { paths.push(path); }, configurable: true });
          test("anywhere", async () => {
            const path = "./variable";
            vi.mock(import("./a"));
            vi.unmock(import("./b"));
            vi.doMock(import("./c"), () => ({}));
            vi.doUnmock(await import("./d"));
            jest.mock(import("./e", { with: { type: "text" } }));
            jest.doMock(import(path));
            events.push(paths);
          });
          ${print}
        `,
      }),
    ).toEqual([["mocked", "mocked other", ["./a", "./b", "./c", "./d", "./e", "./variable"]]]);
  });

  test("only for the first argument of those methods of vi and jest", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "bun:test";
          const local = { mock: path => path, doMock: path => path };
          vi.other = (...args) => args;
          test("imports", async () => {
            (globalThis.events ??= []).push(
              local.mock(import("./other")) instanceof Promise,
              local.doMock(import("./other")) instanceof Promise,
              vi.other(import("./other"))[0] instanceof Promise,
              vi.other("./other", import("./other"))[1] instanceof Promise,
            );
          });
          ${print}
        `,
      }),
    ).toEqual([[true, true, true, true]]);
  });
});

describe.concurrent("modes", () => {
  const files = {
    "a.test.ts": `
      import { test, expect, vi } from "vitest";
      import { captured } from "./side";
      vi.mock("./mod", () => ({ value: "mocked a" }));
      test("a", () => { expect(captured).toBe("mocked a"); console.log(JSON.stringify(["a", ...events])); });
    `,
    "b.test.ts": `
      import { test, expect, vi } from "vitest";
      import { captured } from "./side";
      import { other } from "./other";
      const hoisted = await vi.hoisted(async () => "mocked b");
      vi.mock("./mod", () => ({ value: hoisted }));
      test("b", () => { expect(captured).toBe("mocked b"); console.log(JSON.stringify(["b", ...events, other])); });
    `,
    "c.test.ts": `
      import { test, expect } from "bun:test";
      import { captured } from "./side";
      test("c", () => { expect(captured).toBe("real"); console.log(JSON.stringify(["c", ...events])); });
    `,
  };

  test.each([["--isolate"], ["--parallel"]])("%s", async flag => {
    const lines = await events(files, [flag, "a.test.ts", "b.test.ts", "c.test.ts"]);
    expect(lines.sort()).toEqual([
      ["a", "load side"],
      ["b", "load side", "load other", "other"],
      ["c", "load mod", "load side"],
    ]);
  });

  test("--preload", async () => {
    expect(
      await events(
        {
          "preload.ts": `
            import { vi } from "vitest";
            import { other } from "./other";
            vi.mock("./mod", () => ({ value: "mocked by " + other }));
          `,
          "hoist.test.ts": `
            import { captured } from "./side";
            events.push(captured);
            ${print}
          `,
        },
        ["--preload", "./preload.ts", "hoist.test.ts"],
      ),
    ).toEqual([["load other", "load side", "mocked by other"]]);
  });

  test.each(["hoist.test.cjs", "hoist.test.js", "hoist.test.cts"])("CommonJS: %s", async name => {
    expect(
      await events(
        {
          "side.cjs": `const { value } = require("./mod.ts"); (globalThis.events ??= []).push("load side"); exports.captured = value;`,
          [name]: `
            "use strict";
            (globalThis.events ??= []).push("body");
            const { captured } = require("./side.cjs");
            jest.mock(((globalThis.events ??= []).push("hoisted 1"), "./mod.ts"), () => ({ value: mocked.value }));
            const mocked = vi.hoisted(() => (events.push("hoisted 2"), { value: "mocked" }));
            events.push(captured, typeof module, this === module.exports);
            ${print}
          `,
        },
        [name],
      ),
    ).toEqual([["hoisted 1", "hoisted 2", "body", "load side", "mocked", "object", true]]);
  });

  test("the transpiler cache keeps `bun test` and `bun run` apart", async () => {
    using dir = tempDir("mock-hoist-cache", {
      ...modules,
      "shared.ts": `
        import { vi } from "bun:test";
        import { captured } from "./side";
        vi.mock("./mod", () => ({ value: "mocked" }));
        console.log(captured);
        // ${Buffer.alloc(8192, "x").toString()}
      `,
      "hoist.test.ts": `import "./shared"; test("empty", () => {});`,
    });
    const env = {
      ...bunEnv,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(String(dir), "cache"),
      BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
    };
    const results: unknown[] = [];
    for (const cmd of [["shared.ts"], ["test", "hoist.test.ts"], ["shared.ts"], ["test", "hoist.test.ts"]]) {
      await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited, proc.stderr.text()]);
      results.push([stdout.trim().split("\n").at(-1), exitCode]);
    }
    expect(results).toEqual([
      ["real", 0],
      ["mocked", 0],
      ["real", 0],
      ["mocked", 0],
    ]);
  });

  test.each([[[]], [["--isolate"]]])("a file restored from the transpiler cache: %j", async flags => {
    using dir = tempDir("mock-hoist-cache", {
      ...modules,
      "hoist.test.ts": `
        import { test, vi } from "bun:test";
        import { captured } from "./side";
        vi.mock("./mod", () => ({ value: "mocked" }));
        events.push(captured);
        ${print}
        // ${Buffer.alloc(8192, "x").toString()}
      `,
    });
    const results: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const { stdout, exitCode } = await runIn(String(dir), [...flags, "hoist.test.ts"], {
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(String(dir), "cache"),
        BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
      });
      results.push({
        stdout: stdout.trim().split("\n").at(-1),
        exitCode,
        entries: readdirSync(join(String(dir), "cache")).length,
      });
    }
    expect(results).toEqual([
      { stdout: `["load side","mocked"]`, exitCode: 0, entries: 1 },
      { stdout: `["load side","mocked"]`, exitCode: 0, entries: 1 },
    ]);
  });
});

describe.concurrent("errors", () => {
  test("a factory that runs during the imports cannot read a later const", async () => {
    const { stderr, exitCode } = await run({
      "hoist.test.ts": `
        import { test, vi } from "vitest";
        import { captured } from "./side";
        const later = { value: "mocked" };
        vi.mock("./mod", () => later);
        test("unreachable", () => { captured; });
      `,
    });
    expect(stderr).toContain("ReferenceError: Cannot access 'later' before initialization");
    expect(exitCode).toBe(1);
  });

  test("an import statement in a CommonJS file is still rejected", async () => {
    const { stderr, exitCode } = await run({
      "hoist.test.ts": `
        import { captured } from "./side";
        jest.mock("./mod", () => ({ value: "mocked" }));
        module.exports = captured;
      `,
    });
    expect(stderr).toContain("error: Cannot use import statement with CommonJS-only features");
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("source locations", () => {
  test("an error in a hoisted factory points at the original line", async () => {
    const { stderr, exitCode } = await run({
      "hoist.test.ts": [
        `import { test, vi } from "vitest";`,
        `import { captured } from "./side";`,
        `const padding = 1;`,
        `vi.mock("./mod", () => {`,
        `  throw new Error("from the factory");`,
        `});`,
        `test("unreachable", () => { captured; });`,
      ].join("\n"),
    });
    expect(stderr).toContain("error: from the factory");
    expect(stderr).toMatch(/at <anonymous> \(.*hoist\.test\.ts:5:13\)/);
    expect(exitCode).toBe(1);
  });

  test("an error after the moved statements points at the original line", async () => {
    const { stderr, exitCode } = await run({
      "hoist.test.ts": [
        `import { test, vi } from "vitest";`,
        `function thrower() { throw new Error("from the body"); }`,
        `import { captured } from "./side";`,
        `const hoisted = vi.hoisted(() => 1);`,
        `vi.mock("./mod", () => ({ value: "mocked" }));`,
        `test("throws", () => {`,
        `  captured; thrower();`,
        `});`,
      ].join("\n"),
    });
    expect(stderr).toMatch(/at thrower \(.*hoist\.test\.ts:2:53\)/);
    expect(stderr).toMatch(/at <anonymous> \(.*hoist\.test\.ts:7:13\)/);
    expect(exitCode).toBe(1);
  });

  test("an import that fails reports what a static import reports", async () => {
    const { stderr, exitCode } = await run({
      "hoist.test.ts": [
        `import { test, vi } from "vitest";`,
        `vi.mock("./mod", () => ({ value: "mocked" }));`,
        ``,
        `import { missing } from "./does-not-exist";`,
        `test("unreachable", () => { missing; });`,
      ].join("\n"),
    });
    expect(stderr).toContain(`Cannot find module './does-not-exist' from '`);
    expect(exitCode).toBe(1);
  });

  test("toMatchInlineSnapshot writes to the original line", async () => {
    const source = (snapshots: string[]) =>
      [
        `import { test, expect, vi } from "vitest";`,
        `import { captured } from "./side";`,
        `const hoisted = vi.hoisted(() => {`,
        `  return "hoisted";`,
        `});`,
        `vi.mock("./mod", () => ({ value: "mocked" }));`,
        `import { other } from "./other";`,
        `test("snapshots", () => {`,
        `  expect(captured).toMatchInlineSnapshot(${snapshots[0]});`,
        `  expect([hoisted, other]).toMatchInlineSnapshot(${snapshots[1]});`,
        `});`,
        ``,
      ].join("\n");
    using dir = tempDir("mock-hoist-snapshot", { ...modules, "hoist.test.ts": source(["", ""]) });
    const { stderr, exitCode } = await runIn(String(dir), ["hoist.test.ts"], { CI: "false" });
    expect(stderr).toContain(" 0 fail");
    expect(readFileSync(join(String(dir), "hoist.test.ts"), "utf8")).toBe(
      source(['`"mocked"`', '`\n    [\n      "hoisted",\n      "other",\n    ]\n  `']),
    );
    expect(exitCode).toBe(0);
  });
});
