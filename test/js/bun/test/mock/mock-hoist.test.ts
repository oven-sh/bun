// https://github.com/oven-sh/bun/issues/10428
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const isolationFlags: [string[]][] = [[[]], [["--isolate"]], [["--isolate=modules"]]];

// Each fixture pushes what happens to `globalThis.events`, in order, and a final test prints it.
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

// Each module says when it is evaluated, and each function whether a call passes it a `this`.
const withoutThis = (value: string) => `(this === undefined ? ${value} : "has this")`;
const memoCache = `new Array(size).fill(Symbol.for("react.memo_cache_sentinel"))`;
const react = {
  "node_modules/react/package.json": `{ "name": "react", "type": "module" }`,
  "node_modules/react/index.js": `
    (globalThis.events ??= []).push("load react");
    export function createElement(type) { return ${withoutThis("type")}; }
  `,
  "node_modules/react/jsx-dev-runtime.js": `
    (globalThis.events ??= []).push("load runtime");
    export function jsxDEV(type) { return ${withoutThis("type")}; }
    export const Fragment = "fragment";
  `,
  "node_modules/react/jsx-runtime.js": `
    (globalThis.events ??= []).push("load production runtime");
    export function jsx(type) { return ${withoutThis("type")}; }
    export const jsxs = jsx, Fragment = "fragment";
  `,
  "node_modules/react/compiler-runtime.js": `
    (globalThis.events ??= []).push("load compiler runtime");
    export function c(size) { events.push(${withoutThis(`"cache"`)}); return ${memoCache}; }
  `,
  "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module" }`,
  "node_modules/pkg/self.js": `
    (globalThis.events ??= []).push("load pkg");
    export function self() { return ${withoutThis(`"self"`)}; }
  `,
};
const mockedRuntime = `() => {
  (globalThis.events ??= []).push("factory");
  return { jsxDEV: type => "mocked " + type, Fragment: "fragment of the mock" };
}`;

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

async function events(files: Record<string, string>, args?: string[]) {
  const { stdout, stderr, exitCode } = await run(files, args);
  expect(stderr).toContain(" 0 fail");
  expect(exitCode).toBe(0);
  // --parallel forwards its workers' output to stderr.
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

  // The boolean is whether babel-jest hoists the chain.
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
      // A mock that isn't hoisted still patches the exports of the already-loaded modules.
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

  test("a call of an import has no this, however the callee is written", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import { self } from "./mod";
          vi.mock("./unrelated", () => ({}));
          enum Initializer { A = self() as any }
          events.push(
            [(0, self)(), (true ? self : null)(), (false ? null : self)(), (null ?? self)(), (1 && self)(), (0 || self)()],
            [(0, self)\`\`, (true ? self : null)\`\`, (0, self)?.()],
            Object.keys(Initializer),
          );
          ${print}
        `,
      }),
    ).toEqual([["load mod", [null, null, null, null, null, null], [null, null, null], ["A", "undefined"]]]);
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

  test.each(["pkg", "./mod", "node:os"])(
    "as in Jest, a default import of %s gets the object that a jest.mock() factory returns",
    async specifier => {
      expect(
        await events(
          {
            "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
            "node_modules/pkg/index.js": `exports.name = () => "real";`,
            "uses.ts": `
            import all from "${specifier}";
            export const name = () => all.name();
          `,
            "hoist.test.ts": `
            import { test, jest } from "bun:test";
            import { name } from "./uses";
            import all, * as namespace from "${specifier}";
            jest.mock("${specifier}", () => ({ name: () => "mocked" }));
            (globalThis.events ??= []).push(name(), all.name(), namespace.default === all, require("${specifier}") === all);
            ${print}
          `,
            "marked.test.ts": `
            import { test, jest } from "bun:test";
            import all, { name } from "${specifier}";
            jest.mock("${specifier}", () => ({ __esModule: true, name: () => "mocked" }));
            (globalThis.events ??= []).push(name(), typeof all);
            ${print}
          `,
            "own.test.ts": `
            import { test, jest } from "bun:test";
            import all from "${specifier}";
            jest.mock("${specifier}", () => ({ __esModule: true, default: "own default" }));
            (globalThis.events ??= []).push(all);
            ${print}
          `,
          },
          ["--isolate", "hoist.test.ts", "marked.test.ts", "own.test.ts"],
        ),
      ).toEqual([["mocked", "mocked", true, true], ["mocked", "undefined"], ["own default"]]);
    },
  );

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

  test.each([
    [`import { test, vi } from "vitest";`, `vi.mock("react/jsx-dev-runtime"`],
    [`import { test, vi } from "bun:test";`, `vi.mock("react/jsx-dev-runtime"`],
    [``, `vi.mock("react/jsx-dev-runtime"`],
    [`import { test, jest } from "bun:test";`, `jest.mock("react/jsx-dev-runtime"`],
    [`import { test, vi } from "vitest";`, `await vi.mock(import("react/jsx-dev-runtime")`],
    [`import { test, vi } from "vitest"; const runtime = "react/jsx-dev-runtime";`, `vi.mock(runtime`],
  ])("%s %s, factory) reaches the JSX of the file", async (header, call) => {
    expect(
      await events(
        {
          ...react,
          "hoist.test.tsx": `
            ${header}
            ${call}, ${mockedRuntime});
            (globalThis.events ??= []).push(<b />, <></>);
            ${print}
          `,
        },
        ["hoist.test.tsx"],
      ),
      // The real runtime is never evaluated.
    ).toEqual([["factory", "mocked b", "mocked fragment of the mock"]]);
  });

  // `"jsx": "react-jsx"` makes the file import "react/jsx-runtime", and a mock of the other runtime names nothing it imports.
  test.each([
    ["react/jsx-runtime", ["mocked b", "mocked many a", "mocked fragment of the mock"]],
    ["react/jsx-dev-runtime", ["load production runtime", "b", "a", "fragment"]],
  ])(`with "jsx": "react-jsx", a mock of %s`, async (runtime, expected) => {
    expect(
      await events(
        {
          ...react,
          "tsconfig.json": `{ "compilerOptions": { "jsx": "react-jsx" } }`,
          "hoist.test.tsx": `
            import { test, vi } from "vitest";
            vi.mock("${runtime}", () => ({
              jsx: type => "mocked " + type,
              jsxs: type => "mocked many " + type,
              jsxDEV: type => "mocked " + type,
              Fragment: "fragment of the mock",
            }));
            (globalThis.events ??= []).push(<b />, <a><i /><i /></a>, <></>);
            ${print}
          `,
        },
        ["hoist.test.tsx"],
      ),
    ).toEqual([expected]);
  });

  test("a hand-written import of the JSX runtime gets the same mock as the file's JSX", async () => {
    expect(
      await events(
        {
          ...react,
          "hoist.test.tsx": `
            import { test, vi } from "vitest";
            import { jsxDEV as byHand } from "react/jsx-dev-runtime";
            vi.mock("react/jsx-dev-runtime", ${mockedRuntime});
            (globalThis.events ??= []).push(byHand("u"), <b />);
            ${print}
          `,
        },
        ["hoist.test.tsx"],
      ),
    ).toEqual([["factory", "mocked u", "mocked b"]]);
  });

  // The factory that public suites write: it wraps the real runtime.
  test.each([
    [[], ["load runtime", "factory", "load other", "b", 1, "other"]],
    [
      ["--preload", "./preload.jsx"],
      ["load runtime", "preloaded i", "factory", "load other", "b", 1, "other"],
    ],
  ])("a factory that wraps the real JSX runtime sees the JSX of the file: %j", async (flags, expected) => {
    expect(
      await events(
        {
          ...react,
          "preload.jsx": `(globalThis.events ??= []).push("preloaded " + <i />);`,
          "hoist.test.tsx": `
            import { test, vi } from "vitest";
            import { jsxDEV } from "react/jsx-dev-runtime";
            import { other } from "./other";
            vi.mock("react/jsx-dev-runtime", async importOriginal => {
              const actual = await importOriginal();
              (globalThis.events ??= []).push("factory");
              return { ...actual, jsxDEV: vi.fn(actual.jsxDEV) };
            });
            events.push(<b />, jsxDEV.mock.calls.length, other);
            ${print}
          `,
        },
        [...flags, "hoist.test.tsx"],
      ),
    ).toEqual([expected]);
  });

  test("a mocked JSX runtime loads behind the hoisted statements and ahead of the file's imports", async () => {
    expect(
      await events(
        {
          ...react,
          "hoist.test.tsx": `
            import { test, vi } from "vitest";
            import { other } from "./other";
            vi.hoisted(() => (globalThis.events ??= []).push("hoisted"));
            vi.unmock("react/jsx-dev-runtime");
            events.push(<b />, other);
            ${print}
          `,
        },
        ["hoist.test.tsx"],
      ),
    ).toEqual([["hoisted", "load runtime", "load other", "b", "other"]]);
  });

  test("a hoisted mock of the JSX runtime loads nothing in a file without JSX", async () => {
    expect(
      await events(
        {
          ...react,
          "hoist.test.tsx": `
            import { test, vi } from "vitest";
            vi.mock("react/jsx-dev-runtime", ${mockedRuntime});
            ${print}
          `,
        },
        ["hoist.test.tsx"],
      ),
    ).toEqual([[]]);
  });

  test("JSX in a function that vi.hoisted() returns uses the mocked JSX runtime", async () => {
    expect(
      await events(
        {
          ...react,
          "hoist.test.tsx": `
            import { test, vi } from "vitest";
            const mocks = vi.hoisted(() => ({ icon: () => <i /> }));
            vi.mock("react/jsx-dev-runtime", ${mockedRuntime});
            (globalThis.events ??= []).push(mocks.icon());
            ${print}
          `,
        },
        ["hoist.test.tsx"],
      ),
    ).toEqual([["factory", "mocked i"]]);
  });

  // The factory runs where vi.mock() is written, to update the module that "reader" is linked to. The JSX runtime is
  // loaded by then, because no hoisted call names it.
  test("a hoisted factory with JSX updates a module that is already linked", async () => {
    expect(
      await events({
        ...react,
        "reader.ts": `import { value } from "./mod"; export const read = () => value;`,
        "mocks.tsx": `
          import { vi } from "bun:test";
          vi.mock("./mod", () => ({ value: <i /> }));
        `,
        "hoist.test.ts": `
          import { test } from "bun:test";
          import "./mocks";
          import { read } from "./reader";
          (globalThis.events ??= []).push(read());
          ${print}
        `,
      }),
    ).toEqual([["load runtime", "load mod", "i"]]);
  });

  test("a mock of a package reaches an import of it with attributes", async () => {
    expect(
      await events({
        "node_modules/pkg/package.json": `{ "name": "pkg" }`,
        "node_modules/pkg/data.json": `{ "v": "real" }`,
        "node_modules/pkg/note.txt": `real`,
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import data from "pkg/data.json" with { type: "json" };
          import note from "pkg/note.txt" with { type: "text" };
          vi.mock("pkg/data.json", () => ({ default: { v: "mocked" } }));
          vi.mock("pkg/note.txt", () => ({ default: "mocked" }));
          (globalThis.events ??= []).push(data.v, note);
          ${print}
        `,
      }),
    ).toEqual([["mocked", "mocked"]]);
  });

  test("an import with attributes that a hoisted call names keeps its loader", async () => {
    expect(
      await events({
        "data.ts": `not typescript`,
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          import text from "./data.ts" with { type: "text" };
          vi.unmock("./data.ts");
          function read() { return text; }
          (globalThis.events ??= []).push(text, read.toString().replace(/\\s+/g, " "));
          ${print}
        `,
      }),
    ).toEqual([
      ["not typescript", expect.stringMatching(/^function read\(\) \{ return import_data\$\d+\.default; \}$/)],
    ]);
  });

  test("an eager import.meta.glob entry with a query follows a hoisted mock that names it", async () => {
    expect(
      await events({
        "node_modules/pkg/package.json": `{ "name": "pkg" }`,
        "node_modules/pkg/note.txt": `real`,
        "hoist.test.ts": `
          import { test, vi } from "vitest";
          const notes = import.meta.glob("./node_modules/pkg/*.txt", { eager: true, query: "?raw", import: "default" });
          vi.mock("./node_modules/pkg/note.txt?raw", () => ({ default: "mocked" }));
          (globalThis.events ??= []).push(notes);
          ${print}
        `,
      }),
    ).toEqual([[{ "./node_modules/pkg/note.txt": "mocked" }]]);
  });

  // The visit pass can't drop the namespace of these callees: the parser and the React Compiler write the calls later.
  test.each([
    ["a classic JSX factory", [], `/** @jsxRuntime classic @jsx h */`, `<b />`, ["b"]],
    [
      "a call that the React Compiler writes again",
      ["--react-compiler"],
      ``,
      `useLast("b")[0]`,
      ["load compiler runtime", "cache", "b"],
    ],
  ])("%s that the file imports has no this", async (_, flags, pragma, use, expected) => {
    expect(
      await events(
        {
          ...react,
          "h.ts": `export function h(this: unknown, type: string) { return ${withoutThis("type")}; }`,
          "view.jsx": `
            ${pragma}
            import { h } from "./h";
            vi.mock("./mod", () => ({ value: "mocked" }));
            function useOne() { return 1; }
            function useLast(type) { const one = useOne(); return [h(type), one]; }
            export const view = () => ${use};
          `,
          "hoist.test.ts": `
            import { test } from "bun:test";
            import { view } from "./view.jsx";
            (globalThis.events ??= []).push(view());
            ${print}
          `,
        },
        [...flags, "hoist.test.ts"],
      ),
    ).toEqual([expected]);
  });
});

// An import that stays static in a file that hoists: the ones that Bun adds for JSX and for the React Compiler, and one
// with attributes. It runs behind the hoisted statements once one of them names its path.
describe.concurrent.each([
  {
    kind: "the JSX runtime",
    path: "react/jsx-dev-runtime",
    file: "node_modules/react/jsx-dev-runtime.js",
    head: ``,
    use: `<b />`,
    mock: `{ jsxDEV: () => "mocked" }`,
    real: ["load runtime", "b"],
    flags: [],
  },
  {
    kind: "createElement of the JSX package",
    path: "react",
    file: "node_modules/react/index.js",
    head: `const props = {};`,
    use: `<b {...props} key="k" />`,
    mock: `{ createElement: () => "mocked" }`,
    real: ["load react", "b"],
    flags: [],
  },
  {
    kind: "the runtime of the React Compiler",
    path: "react/compiler-runtime",
    file: "node_modules/react/compiler-runtime.js",
    head: `function useOne() { return 1; } function useLast(value) { const one = useOne(); return [value, one]; }`,
    use: `(useLast(1), events.pop())`,
    mock: `{ c(size) { events.push("mocked"); return ${memoCache}; } }`,
    real: ["load compiler runtime", "cache"],
    flags: ["--react-compiler"],
  },
  {
    kind: "an import with attributes",
    path: "pkg/self.js",
    file: "node_modules/pkg/self.js",
    head: `import { self } from "pkg/self.js" with { type: "js" };`,
    use: `self()`,
    mock: `{ self: () => "mocked" }`,
    real: ["load pkg", "self"],
    flags: [],
  },
])("$kind", ({ path, file, head, use, mock, real, flags }) => {
  async function eventsOf(hoisted: string, body = `events.push(result());`, files: Record<string, string> = react) {
    return await events(
      {
        ...files,
        "module.jsx": `
          import { vi } from "bun:test";
          ${head}
          ${hoisted}
          export const result = () => ${use};
        `,
        "hoist.test.ts": `
          import { test, mock } from "bun:test";
          import { result } from "./module.jsx";
          globalThis.events ??= [];
          ${body}
          ${print}
        `,
      },
      [...flags, "hoist.test.ts"],
    );
  }

  test("gets a hoisted mock of its path, and the real module is not evaluated", async () => {
    expect(await eventsOf(`vi.mock("${path}", () => (${mock}));`)).toEqual([["mocked"]]);
  });

  test("needs no real module once it is mocked", async () => {
    const { [file]: _, ...notInstalled } = react;
    expect(await eventsOf(`vi.mock("${path}", () => (${mock}));`, undefined, notInstalled)).toEqual([["mocked"]]);
  });

  test("is called without a this and read through its namespace, so a later mock.module() reaches it", async () => {
    const body = `events.push(result()); mock.module("${path}", () => (${mock})); events.push(result());`;
    expect(await eventsOf(`vi.unmock("${path}");`, body)).toEqual([[...real, "mocked"]]);
  });

  test("stays static while no hoisted call names its path", async () => {
    const hoisted = `vi.mock("./mod", () => ({})); vi.hoisted(() => (globalThis.events ??= []).push("hoisted"));`;
    expect(await eventsOf(hoisted)).toEqual([[real[0], "hoisted", real[1]]]);
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
  // The real module loads first, and read.toString() shows that the import binding wasn't rewritten.
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

  test.each([
    ["a file without any test API", ``],
    ["a file that hoists", `import { value } from "./mod"; vi.mock("./mod", () => ({ value: "mocked" }));`],
  ])("a call into another block of a TypeScript namespace keeps its this: %s", async (_, header) => {
    expect(
      await events({
        "registry.ts": `
          ${header}
          export namespace Registry {
            export function isThis(this: unknown, ..._: unknown[]) { return this === Registry; }
          }
          export namespace Registry {
            export function calls() { return [isThis(), isThis\`\`, isThis?.()]; }
          }
        `,
        "hoist.test.ts": `
          import { Registry } from "./registry";
          (globalThis.events ??= []).push(Registry.calls(), Registry.calls.toString().replace(/\\s+/g, " "));
          ${print}
        `,
      }),
    ).toEqual([
      [[true, true, true], "function calls() { return [Registry.isThis(), Registry.isThis``, Registry.isThis?.()]; }"],
    ]);
  });

  // The JSX transform of esbuild puts its import there too. The one of Vite 8 puts it behind the imports that lead the file.
  test("without a hoisted call the JSX runtime loads ahead of the file's imports", async () => {
    expect(
      await events(
        {
          ...react,
          "mocks.ts": `import { vi } from "vitest"; vi.mock("react/jsx-dev-runtime", ${mockedRuntime});`,
          "hoist.test.tsx": `
            import { test } from "vitest";
            import "./mocks";
            import { other } from "./other";
            events.push(<b />, other);
            ${print}
          `,
        },
        ["hoist.test.tsx"],
      ),
    ).toEqual([["load runtime", "load other", "b", "other"]]);
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

  test.each(["vi.mock", "vi.unmock", "jest.doMock", "jest.doUnmock"])(
    "%s() in dead code, in a module that uses no other test API",
    async mock => {
      expect(
        await events({
          "dead.js": `
            if (false) ${mock}(import("./mod", class {}), class { static {} });
            (globalThis.events ??= []).push("load dead");
          `,
          "hoist.test.ts": `
            import "./dead.js";
            ${print}
          `,
        }),
      ).toEqual([["load dead"]]);
    },
  );

  // Each of these opens a scope. Dropping it must not desync the visit pass, which walks scopes in parse order.
  test.each([
    `class {}`,
    `class { static {} }`,
    `(() => ({}))()`,
    `function () {}`,
    `{ with: { get type() { return "js"; } } }`,
  ])("drops the options of the import: %s", async options => {
    expect(
      await events({
        "hoist.test.ts": `
          import { value } from "./mod";
          vi.mock(import("./mod", ${options}), () => ({ value: "mocked" }));
          jest.unmock(await import((() => "./unrelated")(), ${options}));
          function shadows(value) { return value; }
          (globalThis.events ??= []).push(value, shadows("parameter"));
          test("nested", () => {
            vi.doUnmock(import("./unrelated", ${options}));
            events.push((value => value)("nested parameter"));
          });
          ${print}
        `,
      }),
    ).toEqual([["mocked", "parameter", "nested parameter"]]);
  });

  test("nothing inside of the dropped options is resolved", async () => {
    expect(
      await events({
        "hoist.test.ts": `
          import { value } from "./mod";
          import { other } from "./other";
          vi.mock(import("./mod", { with: other, more: import("./missing"), again: require("./missing") }), () => ({ value: "mocked" }));
          (globalThis.events ??= []).push(value);
          ${print}
        `,
      }),
    ).toEqual([["load other", "mocked"]]);
  });

  test("only applies to the first argument of vi's and jest's mocking methods", async () => {
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

  test("`bun test` and `bun run` use separate transpiler cache entries", async () => {
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

  test.each(isolationFlags)("a file restored from the transpiler cache: %j", async flags => {
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

describe.concurrent.each(["jest", "vi"])("a top-level variable in a factory of %s.mock", api => {
  const file = (declaration: string, exported: string, read: string) => ({
    "hoist.test.ts": `
      import { value } from "./mod";
      ${declaration}
      ${api}.mock("./mod", () => ({ value: ${exported} }));
      test("print", () => console.log(JSON.stringify([${read}])));
    `,
  });

  // A declaration of only primitive literals is hoisted with the mocks. babel-jest does that for the first two rows.
  test.each([
    [`const fake = "fake";`, `fake`, `value`, "fake"],
    [`let fake = "fake";`, `fake`, `value`, "fake"],
    [`const mockFake = "fake";`, `mockFake`, `value`, "fake"],
    [`const mockFake = String("fake");`, `() => mockFake`, `value()`, "fake"],
    [`function fake() { return "fake"; }`, `fake()`, `value`, "fake"],
    [`export const fake = "fake";`, `fake`, `value`, "fake"],
    [
      "const a = 1, b = -1.5, c = `c`, d = true, e = null, f = undefined; let g = -2n;",
      `[a, b, c, d, e, typeof f, String(g)]`,
      `value`,
      [1, -1.5, "c", true, null, "undefined", "-2"],
    ],
  ])("%s", async (declaration, exported, read, expected) => {
    expect(await events(file(declaration, exported, read))).toEqual([[expected]]);
  });

  test.each([
    [`const fake = String("fake");`, "fake"],
    [`const mockFake = String("fake");`, "mockFake"],
    ["const fake = `${1}`;", "fake"],
    [`const fake = { a: 1 };`, "fake"],
    [`const fake = -"1";`, "fake"],
    [`const fake = "fake", other = String("other");`, "fake"],
    [`const [fake] = "fake";`, "fake"],
    [`const undefined = String("local"), fake = undefined;`, "fake"],
    [`const local = "local"; const fake = local;`, "fake"],
  ])("stays in its place: %s", async (declaration, name) => {
    const { stderr, exitCode } = await run(file(declaration, name, `value`));
    expect(stderr).toContain(
      `ReferenceError: Cannot access '${name}' before initialization.\nnote: vi.mock() and jest.mock() are hoisted above the file's imports and top-level variables`,
    );
    expect(exitCode).toBe(1);
  });

  test("the same variable with a literal and with a call", async () => {
    expect(await events(file(`const fake = "x";`, `fake`, `value`))).toEqual([["x"]]);
    const { stderr, exitCode } = await run(file(`const fake = String("x");`, `fake`, `value`));
    expect(stderr).toContain(
      `ReferenceError: Cannot access 'fake' before initialization.\nnote: vi.mock() and jest.mock() are hoisted above the file's imports and top-level variables`,
    );
    expect(exitCode).toBe(1);
  });

  test("a var stays in its place", async () => {
    expect(await events(file(`var fake = "fake";`, `typeof fake`, `value`))).toEqual([["undefined"]]);
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

  test.each([
    [
      "JSX that vi.hoisted() evaluates",
      `vi.mock("react/jsx-dev-runtime", () => ({})); const element = vi.hoisted(() => <b />);`,
      /ReferenceError: Cannot access 'jsx_dev_runtime\$\d+' before initialization/,
    ],
    [
      "a factory that reads a later const",
      `const later = () => "mocked"; vi.mock("react/jsx-dev-runtime", () => ({ jsxDEV: later }));`,
      /ReferenceError: Cannot access 'later' before initialization/,
    ],
  ])("a mocked JSX runtime is imported behind the hoisted statements: %s", async (_, statements, error) => {
    const { stderr, exitCode } = await run(
      {
        ...react,
        "hoist.test.tsx": `
          import { test, vi } from "vitest";
          ${statements}
          test("unreachable", () => { <b />; });
        `,
      },
      ["hoist.test.tsx"],
    );
    expect(stderr).toMatch(error);
    expect(exitCode).toBe(1);
  });

  test.each(isolationFlags.flatMap(([flags]) => ["vi", "jest"].map(api => [api, flags] as const)))(
    "a %s.mock() factory can read a later const though an earlier file or a preload loaded the module: %j",
    async (api, flags) => {
      const { stderr, exitCode } = await run(
        {
          "preload.ts": `
            import { mock } from "bun:test";
            import "node:os";
            import "node:querystring";
            mock.module("node:querystring", () => ({ escape: () => "preload" }));
          `,
          "1.test.ts": `
            import { expect, test } from "bun:test";
            import { existsSync } from "node:fs";
            import { other } from "./other";
            import { captured } from "./side";
            test("loads them", () => expect([existsSync("/"), captured, other]).toEqual([true, "real", "other"]));
          `,
          "2.test.ts": `
            import { expect, test, ${api} } from "bun:test";
            const fn = ${api}.fn(() => "mock"), value = String("mock");
            ${api}.mock("node:fs", () => ({ statSync: fn }));
            ${api}.mock("node:os", async () => ({ hostname: fn }));
            ${api}.mock("node:querystring", () => ({ escape: fn }));
            ${api}.mock("./mod", () => ({ value }));
            ${api}.mock("./other", () => ({ other: "first" }));
            ${api}.mock("./other", () => ({ other: value }));
            test("gets the mocks", async () => {
              const [fs, os, querystring, side, other] = await Promise.all(
                ["node:fs", "node:os", "node:querystring", "./side", "./other"].map(name => import(name)),
              );
              expect([fs.statSync("/"), os.hostname(), querystring.escape(""), side.captured, other.other]).toEqual(Array(5).fill("mock"));
            });
          `,
          "3.test.ts": `
            import { expect, test } from "bun:test";
            import { existsSync } from "node:fs";
            import { hostname } from "node:os";
            import { escape } from "node:querystring";
            import { other } from "./other";
            import { captured } from "./side";
            test("gets what was there before", () =>
              expect([existsSync("/"), typeof hostname(), escape(""), captured, other]).toEqual([true, "string", "preload", "real", "other"]));
          `,
        },
        ["--preload", "./preload.ts", ...flags, "1.test.ts", "2.test.ts", "3.test.ts"],
      );
      expect(stderr).toContain(" 3 pass\n 0 fail\n");
      expect(exitCode).toBe(0);
    },
  );

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

  test("two files that hoist and import each other are both named in the error", async () => {
    const { stderr, exitCode } = await run({
      "helper.ts": `
        import { shared } from "./hoist.test";
        vi.mock("./unrelated", () => ({}));
        export const helper = () => shared;
      `,
      "hoist.test.ts": `
        import { helper } from "./helper";
        vi.mock("./unrelated", () => ({}));
        export const shared = 1;
        test("unreachable", () => { helper(); });
      `,
    });
    expect(stderr).toMatch(/error: ".*hoist\.test\.ts" never finished loading/);
    expect(stderr).toMatch(/note: unsettled top-level await in ".*hoist\.test\.ts"/);
    expect(stderr).toMatch(/note: unsettled top-level await in ".*helper\.ts"/);
    expect(exitCode).toBe(1);
  });

  test("only one of two files that import each other hoists", async () => {
    expect(
      await events({
        "helper.ts": `
          import { shared } from "./hoist.test";
          export const helper = () => shared;
        `,
        "hoist.test.ts": `
          import { helper } from "./helper";
          vi.mock("./unrelated", () => ({}));
          export const shared = "shared";
          (globalThis.events ??= []).push(helper());
          ${print}
        `,
      }),
    ).toEqual([["shared"]]);
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

  test("a failed import after vi.mock() reports the same error as a static import", async () => {
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
