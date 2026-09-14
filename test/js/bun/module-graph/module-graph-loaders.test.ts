import { dlopen } from "bun:ffi";
import { heapStats } from "bun:jsc";
import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as hostChildProcess from "node:child_process";
import * as hostEvents from "node:events";
import * as hostFs from "node:fs";
import { readdirSync } from "node:fs";
import * as hostOs from "node:os";
import * as hostPath from "node:path";
import { join } from "node:path";
import * as hostUrl from "node:url";
import * as hostUtil from "node:util";

const { ModuleGraph } = Bun.unsafe as any;

// Runs `main.mjs` in `cwd` and returns what it printed.
async function runMain(cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "main.mjs"], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The frames of `error.stack` inside `dir`, with `dir` stripped.
function framesIn(error: Error, dir: string) {
  return error
    .stack!.split("\n")
    .filter(line => line.includes(dir))
    .map(line => line.trim().replace(dir, ""));
}

function caught(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the function to throw");
}

describe("Bun.unsafe.ModuleGraph loaders", () => {
  describe("source languages", () => {
    test.each([
      ["counter.js", `export let count = 0; export const increment = () => ++count;`],
      ["counter.mjs", `export let count = 0; export const increment = () => ++count;`],
      ["counter.ts", `export let count: number = 0; export const increment = (): number => ++count;`],
      ["counter.mts", `export let count: number = 0; export const increment = (): number => ++count;`],
      ["counter.jsx", `export let count = 0; export const increment = () => ++count;`],
      ["counter.tsx", `export let count: number = 0; export const increment = (): number => ++count;`],
    ])("%s has one instance per graph", async (name, source) => {
      using dir = tempDir("module-graph-loaders-language", { "package.json": `{ "type": "module" }`, [name]: source });
      const file = join(String(dir), name);

      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB, host] = [await a.import(file), await b.import(file), await import(file)];
      inA.increment();
      inA.increment();
      inB.increment();
      expect({ a: inA.count, b: inB.count, host: host.count }).toEqual({ a: 2, b: 1, host: 0 });
    });

    test("TypeScript-only syntax", async () => {
      using dir = tempDir("module-graph-loaders-ts-syntax", {
        "syntax.ts": `
          enum Color { Red, Green = 5, Blue }
          const enum Flag { A = 1, B = 2 }
          namespace Shapes { export const sides = 4; }
          declare const neverDefined: number;
          abstract class Base { constructor(public name: string, private readonly age: number = 3) {} }
          class Derived extends Base {}
          function overloaded(x: string): string;
          function overloaded(x: number): number;
          function overloaded(x: any) { return x; }
          const checked = { a: 1 } satisfies Record<string, number>;
          export const result = {
            Color,
            flags: [Flag.A, Flag.B],
            sides: Shapes.sides,
            checked,
            derived: { ...new Derived("d") },
            cast: (overloaded(1) as unknown as number)!,
            generic: (<T,>(x: T): T => x)("generic"),
          };
          export let count = 0;
          export const increment = () => ++count;
        `,
      });
      const file = join(String(dir), "syntax.ts");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      const expected = {
        Color: { 0: "Red", 5: "Green", 6: "Blue", Red: 0, Green: 5, Blue: 6 },
        flags: [1, 2],
        sides: 4,
        checked: { a: 1 },
        derived: { name: "d", age: 3 },
        cast: 1,
        generic: "generic",
      };
      expect(inGraph.result).toEqual(expected);
      expect(host.result).toEqual(expected);
      expect(inGraph.result.Color).not.toBe(host.result.Color);
      inGraph.increment();
      expect([inGraph.count, host.count]).toEqual([1, 0]);
    });

    test("type-only imports are elided", async () => {
      using dir = tempDir("module-graph-loaders-type-imports", {
        "shapes.ts": `
          evaluated.push("shapes.ts");
          export interface Shape { sides: number }
        `,
        "uses-types.ts": `
          import type { Missing } from "./this-file-does-not-exist";
          import { type AlsoMissing } from "./nor-does-this-one";
          import { Shape } from "./shapes.ts";
          evaluated.push("uses-types.ts");
          export const square: Shape = { sides: 4 };
        `,
      });

      const evaluated: string[] = [];
      using graph = new ModuleGraph({ globals: { evaluated } });
      const inGraph = await graph.import(join(String(dir), "uses-types.ts"));
      expect({ square: inGraph.square, evaluated }).toEqual({ square: { sides: 4 }, evaluated: ["uses-types.ts"] });
    });

    test("experimental decorators", async () => {
      using dir = tempDir("module-graph-loaders-decorators", {
        "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true } }`,
        "decorated.ts": `
          export const log: string[] = [];
          function tag(name: string) {
            return (target: any, key?: string) => { log.push(name + ":" + (key ?? target.name)); };
          }
          @tag("class")
          export class Service {
            @tag("method") run() {}
          }
        `,
      });
      const file = join(String(dir), "decorated.ts");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect(inGraph.log).toEqual(["method:run", "class:Service"]);
      expect(host.log).toEqual(["method:run", "class:Service"]);
      expect(inGraph.log).not.toBe(host.log);
      expect(inGraph.Service).not.toBe(host.Service);
    });

    test("TSX with a `@jsxImportSource` pragma: each graph has its own JSX runtime instance", async () => {
      using dir = tempDir("module-graph-loaders-tsx", {
        "node_modules/local-jsx/package.json": JSON.stringify({
          name: "local-jsx",
          type: "module",
          exports: { "./jsx-runtime": "./runtime.mjs", "./jsx-dev-runtime": "./runtime.mjs" },
        }),
        "node_modules/local-jsx/runtime.mjs": `
          export let calls = 0;
          export const Fragment = "fragment";
          export function jsx(type, props) { calls++; return { type, props }; }
          export function jsxs(type, props) { calls++; return { type, props }; }
          export function jsxDEV(type, props) { calls++; return { type, props }; }
        `,
        "view.tsx": `
          /** @jsxImportSource local-jsx */
          import { calls } from "local-jsx/jsx-runtime";
          export const Item = (props: { n: number }) => <b>{props.n}</b>;
          export const element = <div id="root"><Item n={1} /><>text</></div>;
          export const runtimeCalls = () => calls;
        `,
      });
      const file = join(String(dir), "view.tsx");

      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB] = [await a.import(file), await b.import(file)];
      expect(inA.element).toEqual({
        type: "div",
        props: {
          id: "root",
          children: [
            { type: inA.Item, props: { n: 1 } },
            { type: "fragment", props: { children: "text" } },
          ],
        },
      });
      expect(inA.Item).not.toBe(inB.Item);
      inA.Item({ n: 2 });
      expect([inA.runtimeCalls(), inB.runtimeCalls()]).toEqual([4, 3]);
    });

    // The runtime takes JSX settings from the tsconfig.json of the directory it was started in.
    test.concurrent("JSX with the process's tsconfig `jsxImportSource`", async () => {
      using dir = tempDir("module-graph-loaders-jsx-tsconfig", {
        "tsconfig.json": `{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "configured-jsx" } }`,
        "node_modules/configured-jsx/package.json": JSON.stringify({
          name: "configured-jsx",
          type: "module",
          exports: { "./jsx-runtime": "./runtime.mjs", "./jsx-dev-runtime": "./runtime.mjs" },
        }),
        "node_modules/configured-jsx/runtime.mjs": `
          export let calls = 0;
          export function jsx(type, props) { calls++; return { type, props }; }
          export function jsxs(type, props) { calls++; return { type, props }; }
          export function jsxDEV(type, props) { calls++; return { type, props }; }
        `,
        "configured.jsx": `
          import { calls } from "configured-jsx/jsx-runtime";
          export const element = <p title="configured">text</p>;
          export const render = () => <i />;
          export const runtimeCalls = () => calls;
        `,
        "main.mjs": `
          const { ModuleGraph } = Bun.unsafe;
          const file = import.meta.dir + "/configured.jsx";
          const [inA, inB, host] = [
            await new ModuleGraph().import(file),
            await new ModuleGraph().import(file),
            await import(file),
          ];
          inA.render();
          inA.render();
          inB.render();
          console.log(JSON.stringify({
            element: inA.element,
            calls: [inA.runtimeCalls(), inB.runtimeCalls(), host.runtimeCalls()],
          }));
        `,
      });

      const { stdout, stderr, exitCode } = await runMain(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        element: { type: "p", props: { title: "configured", children: "text" } },
        calls: [3, 2, 1],
      });
      expect(exitCode).toBe(0);
    });

    test("JSX with a `@jsx` pragma to a local factory", async () => {
      using dir = tempDir("module-graph-loaders-jsx-pragma", {
        "pragma.jsx": `
          /** @jsxRuntime classic */
          /** @jsx h */
          /** @jsxFrag Frag */
          const Frag = "frag";
          function h(type, props, ...children) { return { type, props, children }; }
          export const element = <ul class="list"><li>a</li><>b</></ul>;
        `,
      });

      using graph = new ModuleGraph();
      const inGraph = await graph.import(join(String(dir), "pragma.jsx"));
      expect(inGraph.element).toEqual({
        type: "ul",
        props: { class: "list" },
        children: [
          { type: "li", props: null, children: ["a"] },
          { type: "frag", props: null, children: ["b"] },
        ],
      });
    });

    test("tsconfig `paths`", async () => {
      using dir = tempDir("module-graph-loaders-tsconfig-paths", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["src/lib/*"], "@state": ["src/lib/state.ts"] } },
        }),
        "src/lib/state.ts": `export let count = 0; export const increment = (): number => ++count;`,
        "uses-paths.ts": `
          import { increment } from "@lib/state";
          import * as exact from "@state";
          export { increment, exact };
          export const dynamic = () => import("@lib/state");
        `,
      });
      const file = join(String(dir), "uses-paths.ts");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      inGraph.increment();
      expect({
        graph: inGraph.exact.count,
        host: host.exact.count,
        wildcardAndExactAreOneModule: inGraph.exact.increment === inGraph.increment,
        dynamicStaysInGraph: (await inGraph.dynamic()) === inGraph.exact,
      }).toEqual({ graph: 1, host: 0, wildcardAndExactAreOneModule: true, dynamicStaysInGraph: true });
    });
  });

  describe("data and asset loaders", () => {
    test("JSON: default and named imports, one parsed object per graph", async () => {
      using dir = tempDir("module-graph-loaders-json", {
        "settings.json": `{ "name": "settings", "nested": { "list": [1, 2, 3] } }`,
        "reads-json.mjs": `
          import settings, { name, nested } from "./settings.json";
          export { settings, name, nested };
        `,
      });
      const file = join(String(dir), "reads-json.mjs");

      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB, host] = [await a.import(file), await b.import(file), await import(file)];
      expect(inA.settings).toEqual({ name: "settings", nested: { list: [1, 2, 3] } });
      expect({ name: inA.name, namedIsAProperty: inA.nested === inA.settings.nested }).toEqual({
        name: "settings",
        namedIsAProperty: true,
      });
      expect(inA.settings).not.toBe(inB.settings);
      expect(inA.settings).not.toBe(host.settings);

      // A mutation made through one graph's object is invisible everywhere else.
      inA.settings.nested.list.push(4);
      inA.settings.added = true;
      expect([inB.settings, host.settings]).toEqual([
        { name: "settings", nested: { list: [1, 2, 3] } },
        { name: "settings", nested: { list: [1, 2, 3] } },
      ]);
    });

    test("graph.import() of a JSON file", async () => {
      using dir = tempDir("module-graph-loaders-json-direct", { "direct.json": `{ "a": { "b": 1 } }` });
      const file = join(String(dir), "direct.json");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect({ ...inGraph }).toEqual({ default: { a: { b: 1 } }, a: { b: 1 } });
      expect(inGraph.default).not.toBe(host.default);
      expect(graph.mainModule).toBe(file);
    });

    test.each([
      ["config.toml", `title = "t"\n[owner]\nname = "o"\n`, { title: "t", owner: { name: "o" } }],
      ["config.yaml", `title: y\nlist:\n  - 1\n  - 2\n`, { title: "y", list: [1, 2] }],
      ["config.jsonc", `// comment\n{ "k": 1, /* inline */ "t": [1,], }\n`, { k: 1, t: [1] }],
      ["config.json5", `{ k: 1, t: [1,], s: 'single' }\n`, { k: 1, t: [1], s: "single" }],
    ])("%s is parsed once per graph", async (name, contents, expected) => {
      using dir = tempDir("module-graph-loaders-data", {
        [name]: contents,
        "reads-data.mjs": `export { default as data } from "./${name}";`,
      });
      const file = join(String(dir), "reads-data.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect(inGraph.data).toEqual(expected);
      expect(host.data).toEqual(expected);
      expect(inGraph.data).not.toBe(host.data);
    });

    test('`with { type: "json" }` on another extension', async () => {
      using dir = tempDir("module-graph-loaders-json-attribute", {
        "payload.data": `{ "from": "attribute" }`,
        "reads-payload.mjs": `
          import payload from "./payload.data" with { type: "json" };
          export { payload };
        `,
      });

      using graph = new ModuleGraph();
      const inGraph = await graph.import(join(String(dir), "reads-payload.mjs"));
      expect(inGraph.payload).toEqual({ from: "attribute" });
    });

    test('`with { type: "text" }`, also of a file that would otherwise be evaluated', async () => {
      using dir = tempDir("module-graph-loaders-text", {
        "note.txt": "plain text\n",
        "not-evaluated.mjs": `throw new Error("evaluated");`,
        "reads-text.mjs": `
          import note from "./note.txt" with { type: "text" };
          import implicit from "./note.txt";
          import source from "./not-evaluated.mjs" with { type: "text" };
          export { note, implicit, source };
        `,
      });

      using graph = new ModuleGraph();
      const inGraph = await graph.import(join(String(dir), "reads-text.mjs"));
      expect({ ...inGraph }).toEqual({
        note: "plain text\n",
        implicit: "plain text\n",
        source: `throw new Error("evaluated");`,
      });
    });

    test('`with { type: "file" }` is the path', async () => {
      using dir = tempDir("module-graph-loaders-file", {
        "blob.bin": Buffer.from([0, 1, 2, 3]),
        "reads-file.mjs": `
          import path from "./blob.bin" with { type: "file" };
          export { path };
          export const bytes = [...await Bun.file(path).bytes()];
        `,
      });

      using graph = new ModuleGraph();
      const inGraph = await graph.import(join(String(dir), "reads-file.mjs"));
      expect({ ...inGraph }).toEqual({ path: join(String(dir), "blob.bin"), bytes: [0, 1, 2, 3] });
    });

    test("import attributes on dynamic import()", async () => {
      using dir = tempDir("module-graph-loaders-dynamic-attributes", {
        "letter.txt": "dear graph",
        "numbers.data": `[1, 2, 3]`,
        "loads-dynamically.mjs": `
          import numbers from "./numbers.data" with { type: "json" };
          export { numbers };
          export const loadText = () => import("./letter.txt", { with: { type: "text" } });
          export const loadJSON = () => import("./numbers.data", { with: { type: "json" } });
        `,
      });
      const file = join(String(dir), "loads-dynamically.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      const [text, json, hostJSON] = [await inGraph.loadText(), await inGraph.loadJSON(), await host.loadJSON()];
      expect({ text: text.default, json: json.default }).toEqual({ text: "dear graph", json: [1, 2, 3] });
      // The dynamic import finds the graph's record of the static import, not the host's.
      expect(json.default).toBe(inGraph.numbers);
      expect(json.default).not.toBe(hostJSON.default);
    });

    test("JSON through node:module's require() is the shared CommonJS copy", async () => {
      using dir = tempDir("module-graph-loaders-json-require", {
        "required.json": `{ "k": { "v": 1 } }`,
        "requires-json.mjs": `
          import { createRequire } from "node:module";
          export const required = createRequire(import.meta.url)("./required.json");
        `,
      });
      const file = join(String(dir), "requires-json.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect(inGraph.required).toEqual({ k: { v: 1 } });
      expect(inGraph.required).toBe(host.required);
      expect(require.cache[join(String(dir), "required.json")]?.exports).toBe(inGraph.required);
    });

    test("import.meta.require() of a JSON file the graph has not imported", async () => {
      using dir = tempDir("module-graph-loaders-json-meta-require", {
        "only-required.json": `{ "k": { "v": 1 } }`,
        "meta-requires-json.mjs": `export const required = import.meta.require("./only-required.json");`,
      });
      const file = join(String(dir), "meta-requires-json.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect([inGraph.required, host.required]).toEqual([{ k: { v: 1 } }, { k: { v: 1 } }]);
    });

    test("import.meta.require() of a JSON file the graph has imported", async () => {
      using dir = tempDir("module-graph-loaders-json-meta-require-imported", {
        "both.json": `{ "k": { "v": 1 } }`,
        "imports-and-requires-json.mjs": `
          import imported from "./both.json";
          export { imported };
          export const required = import.meta.require("./both.json");
        `,
      });
      const file = join(String(dir), "imports-and-requires-json.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      // Whatever shape the host gives it, the graph gives the same shape around its own parsed object.
      expect({ ...inGraph.required }).toEqual({ ...host.required });
      expect(inGraph.required.k).toBe(inGraph.imported.k);
      expect(inGraph.required.k).not.toBe(host.imported.k);
    });

    test(".wasm imports as its path; the graph's module instantiates it", async () => {
      using dir = tempDir("module-graph-loaders-wasm", {
        // (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
        "add.wasm": Buffer.from([
          0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10,
          9, 1, 7, 0, 32, 0, 32, 1, 106, 11,
        ]),
        "uses-wasm.mjs": `
          import path from "./add.wasm";
          export { path };
          const { instance } = await WebAssembly.instantiate(await Bun.file(path).arrayBuffer());
          export const add = instance.exports.add;
        `,
      });
      const file = join(String(dir), "uses-wasm.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect({ path: inGraph.path, sum: inGraph.add(2, 3) }).toEqual({ path: join(String(dir), "add.wasm"), sum: 5 });
      expect(inGraph.add).not.toBe(host.add);
    });

    test(".node rejects with a TypeError", async () => {
      using dir = tempDir("module-graph-loaders-napi", {
        "addon.node": "not a real addon",
        "imports-addon.mjs": `import addon from "./addon.node"; export { addon };`,
      });

      using graph = new ModuleGraph();
      const message = "To load Node-API modules, use require() or process.dlopen instead of import.";
      const [direct, nested] = await Promise.allSettled([
        graph.import(join(String(dir), "addon.node")),
        graph.import(join(String(dir), "imports-addon.mjs")),
      ]);
      expect([direct, nested]).toEqual([
        { status: "rejected", reason: expect.objectContaining({ name: "TypeError", message }) },
        { status: "rejected", reason: expect.objectContaining({ name: "TypeError", message }) },
      ]);
      expect(direct.status === "rejected" && direct.reason).toBeInstanceOf(TypeError);
    });

    test('`with { type: "sqlite" }` opens one Database per graph', async () => {
      using dir = tempDir("module-graph-loaders-sqlite", {
        "reads-sqlite.mjs": `
          import db from "./rows.sqlite" with { type: "sqlite" };
          export { db };
          export const rows = db.query("select v from t").all();
        `,
      });
      {
        using db = new Database(join(String(dir), "rows.sqlite"));
        db.run("create table t (v text)");
        db.run("insert into t values ('row')");
      }
      const file = join(String(dir), "reads-sqlite.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      try {
        expect(inGraph.rows).toEqual([{ v: "row" }]);
        expect(inGraph.db).toBeInstanceOf(Database);
        expect(inGraph.db).not.toBe(host.db);
      } finally {
        inGraph.db.close();
        host.db.close();
      }
    });

    test(".html imports as one HTMLBundle per graph", async () => {
      using dir = tempDir("module-graph-loaders-html", {
        "page.html": `<!doctype html><title>page</title>`,
        "imports-html.mjs": `import page from "./page.html"; export { page };`,
      });
      const file = join(String(dir), "imports-html.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect(inGraph.page.index).toBe(join(String(dir), "page.html"));
      expect(inGraph.page.index).toBe(host.page.index);
      expect(inGraph.page).not.toBe(host.page);
    });
  });

  describe("builtin modules", () => {
    test("each graph has its own record of a builtin with the host's exports", async () => {
      using dir = tempDir("module-graph-loaders-builtins", {
        "imports-builtins.mjs": `
          export * as fs from "node:fs";
          export * as bareFs from "fs";
          export * as path from "node:path";
          export * as barePath from "path";
          export * as os from "node:os";
          export * as events from "node:events";
          export * as util from "node:util";
          export * as url from "node:url";
          export * as childProcess from "node:child_process";
        `,
      });
      const file = join(String(dir), "imports-builtins.mjs");

      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB] = [await a.import(file), await b.import(file)];
      const host: Record<string, any> = {
        fs: hostFs,
        bareFs: hostFs,
        path: hostPath,
        barePath: hostPath,
        os: hostOs,
        events: hostEvents,
        util: hostUtil,
        url: hostUrl,
        childProcess: hostChildProcess,
      };

      const differing: string[] = [];
      for (const [name, hostNamespace] of Object.entries(host)) {
        if (inA[name] === hostNamespace || inA[name] === inB[name]) differing.push(name + ": namespace is shared");
        for (const key of Object.keys(hostNamespace)) {
          if (inA[name][key] !== hostNamespace[key]) differing.push(name + "." + key);
        }
        if (Object.keys(inA[name]).length !== Object.keys(hostNamespace).length) differing.push(name + ": keys");
      }
      expect(differing).toEqual([]);
      expect(inA.bareFs).toBe(inA.fs);
      expect(inA.barePath).toBe(inA.path);
    });

    test("bun:* modules", async () => {
      using dir = tempDir("module-graph-loaders-bun-builtins", {
        "imports-bun.mjs": `
          import * as jsc from "bun:jsc";
          import * as sqlite from "bun:sqlite";
          import * as ffi from "bun:ffi";
          import * as bun from "bun";
          export const exports = {
            heapStats: jsc.heapStats,
            Database: sqlite.Database,
            dlopen: ffi.dlopen,
            spawn: bun.spawn,
            file: bun.file,
          };
        `,
      });

      using graph = new ModuleGraph();
      const inGraph = await graph.import(join(String(dir), "imports-bun.mjs"));
      expect(inGraph.exports.heapStats).toBe(heapStats);
      expect(inGraph.exports.Database).toBe(Database);
      expect(inGraph.exports.dlopen).toBe(dlopen);
      expect(inGraph.exports.spawn).toBe(Bun.spawn);
      expect(inGraph.exports.file).toBe(Bun.file);
    });

    test("graph.import() of a builtin specifier", async () => {
      using graph = new ModuleGraph();
      const [os, bareOs] = [await graph.import("node:os"), await graph.import("os")];
      expect(os).toBe(bareOs);
      expect(os).not.toBe(hostOs);
      expect(os.platform).toBe(hostOs.platform);
      expect(os.default).toBe(hostOs.default);
      expect(graph.mainModule).toBe("node:os");
    });

    test("bun:test imported by graph code is the running test's bun:test", async () => {
      using dir = tempDir("module-graph-loaders-bun-test", {
        "imports-bun-test.mjs": `
          import { describe, expect, mock, test } from "bun:test";
          export { describe, expect, mock, test };
          export const assertInGraph = value => expect(value).toBe(1);
        `,
      });

      using graph = new ModuleGraph();
      const inGraph = await graph.import(join(String(dir), "imports-bun-test.mjs"));
      expect({
        describe: inGraph.describe === describe,
        expect: inGraph.expect === expect,
        mock: inGraph.mock === mock,
        test: inGraph.test === test,
      }).toEqual({ describe: true, expect: true, mock: true, test: true });
      inGraph.assertInGraph(1);
      expect(() => inGraph.assertInGraph(2)).toThrow();
    });
  });

  describe("CommonJS", () => {
    test("default, named, function and __esModule interop", async () => {
      using dir = tempDir("module-graph-loaders-cjs-interop", {
        "plain.cjs": `exports.named = "named"; exports.other = 2;`,
        "function.cjs": `module.exports = function callable() { return "called"; }; module.exports.extra = 1;`,
        "transpiled.cjs": `
          Object.defineProperty(exports, "__esModule", { value: true });
          exports.default = "the default";
          exports.other = "other";
        `,
        "imports-cjs.mjs": `
          import plain, { named } from "./plain.cjs";
          import callable, { extra } from "./function.cjs";
          import transpiledDefault, { other } from "./transpiled.cjs";
          import * as transpiled from "./transpiled.cjs";
          export const result = {
            plain, named, called: callable(), extra, extraIsProperty: callable.extra === extra,
            transpiledDefault, other, transpiledKeys: Object.keys(transpiled),
          };
        `,
      });
      const file = join(String(dir), "imports-cjs.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect(inGraph.result).toEqual({
        plain: { named: "named", other: 2 },
        named: "named",
        called: "called",
        extra: 1,
        extraIsProperty: true,
        transpiledDefault: "the default",
        other: "other",
        transpiledKeys: ["default", "other"],
      });
      expect(inGraph.result.plain).toBe(host.result.plain);
    });

    test("a CommonJS file imported by two graphs and the host is evaluated once", async () => {
      using dir = tempDir("module-graph-loaders-cjs-once", {
        "evaluations.cjs": `module.exports = [];`,
        "stateful.cjs": `
          require("./evaluations.cjs").push("stateful.cjs");
          let count = 0;
          exports.increment = () => ++count;
          exports.token = {};
        `,
        "imports-stateful.mjs": `
          import stateful, { increment, token } from "./stateful.cjs";
          import evaluations from "./evaluations.cjs";
          export { stateful, increment, token, evaluations };
        `,
      });
      const file = join(String(dir), "imports-stateful.mjs");

      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB, host] = [await a.import(file), await b.import(file), await import(file)];
      expect(inA.evaluations).toEqual(["stateful.cjs"]);
      expect([inA.increment(), inB.increment(), host.increment()]).toEqual([1, 2, 3]);
      expect({
        exports: inA.stateful === host.stateful && inB.stateful === host.stateful,
        token: inA.token === host.token && inB.token === host.token,
        namespace: inA === inB,
        requireCache: require.cache[join(String(dir), "stateful.cjs")]?.exports === inA.stateful,
      }).toEqual({ exports: true, token: true, namespace: false, requireCache: true });
    });

    test("graph.import() of a CommonJS file", async () => {
      using dir = tempDir("module-graph-loaders-cjs-direct", {
        "direct.cjs": `exports.token = {}; exports.name = "direct";`,
      });
      const file = join(String(dir), "direct.cjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect(Object.keys(inGraph)).toEqual(["default", "name", "token"]);
      expect(inGraph).not.toBe(host);
      expect(inGraph.default).toBe(host.default);
      expect(inGraph.token).toBe(host.token);
    });

    test.each([
      ["detected.js", `module.exports = { kind: "commonjs by detection", token: {} };`],
      ["typed.cts", `const kind: string = "cts"; export = { kind, token: {} };`],
    ])("%s is shared", async (name, source) => {
      using dir = tempDir("module-graph-loaders-cjs-kinds", {
        [name]: source,
        "imports-it.mjs": `export { default as exports } from "./${name}";`,
      });
      const file = join(String(dir), "imports-it.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      expect(inGraph.exports.token).toBeObject();
      expect(inGraph.exports).toBe(host.exports);
    });

    describe("an ES module loaded by CommonJS code is the host's instance", () => {
      const files = {
        "state.mjs": `export let count = 0; export const increment = () => ++count;`,
        "loads-esm.cjs": `
          exports.required = () => require("./state.mjs");
          exports.imported = () => import("./state.mjs");
        `,
        "entry.mjs": `
          import { createRequire } from "node:module";
          import loader from "./loads-esm.cjs";
          import * as state from "./state.mjs";
          export { loader, state };
          export const viaCreateRequire = () => createRequire(import.meta.url)("./state.mjs");
          export const viaImportMetaRequire = () => import.meta.require("./state.mjs");
        `,
      };

      test("when the host loaded it first", async () => {
        using dir = tempDir("module-graph-loaders-cjs-esm-host-first", files);
        const host = await import(join(String(dir), "state.mjs"));
        using graph = new ModuleGraph();
        const inGraph = await graph.import(join(String(dir), "entry.mjs"));

        inGraph.state.increment();
        expect(inGraph.state.increment).not.toBe(host.increment);
        expect(inGraph.loader.required().increment).toBe(host.increment);
        expect((await inGraph.loader.imported()).increment).toBe(host.increment);
        expect(inGraph.viaCreateRequire().increment).toBe(host.increment);
        expect(inGraph.viaImportMetaRequire().increment).toBe(inGraph.state.increment);
        expect([inGraph.state.count, host.count]).toEqual([1, 0]);
      });

      test("when the graph loaded it first", async () => {
        using dir = tempDir("module-graph-loaders-cjs-esm-graph-first", files);
        using graph = new ModuleGraph();
        const inGraph = await graph.import(join(String(dir), "entry.mjs"));
        inGraph.state.increment();
        const required = inGraph.loader.required();
        const host = await import(join(String(dir), "state.mjs"));

        expect(required.increment).not.toBe(inGraph.state.increment);
        expect(required.increment).toBe(host.increment);
        expect((await inGraph.loader.imported()).increment).toBe(host.increment);
        expect([inGraph.state.count, host.count]).toEqual([1, 0]);
      });
    });
  });

  describe("packages", () => {
    const packages = {
      "node_modules/conditions/package.json": JSON.stringify({
        name: "conditions",
        type: "module",
        exports: {
          ".": { bun: "./bun.mjs", import: "./import.mjs", default: "./default.mjs" },
          "./feature": { require: "./feature-require.cjs", import: "./feature-import.mjs" },
          "./fallback": { "no-such-condition": "./import.mjs", default: "./default.mjs" },
          "./sub/*": "./sub/*.mjs",
          "./sub/private": null,
        },
        imports: { "#internal": "./internal.mjs" },
      }),
      "node_modules/conditions/bun.mjs": `
        export const picked = "bun";
        export let count = 0;
        export const increment = () => ++count;
        export { internal } from "#internal";
        export * as self from "conditions/feature";
      `,
      "node_modules/conditions/import.mjs": `export const picked = "import";`,
      "node_modules/conditions/default.mjs": `export const picked = "default";`,
      "node_modules/conditions/feature-import.mjs": `export const picked = "feature-import";`,
      "node_modules/conditions/feature-require.cjs": `exports.picked = "feature-require";`,
      "node_modules/conditions/internal.mjs": `export const internal = "internal";`,
      "node_modules/conditions/sub/a.mjs": `export const name = "sub/a";`,
      "node_modules/conditions/sub/private.mjs": `export const name = "sub/private";`,
      "node_modules/commonjs-package/package.json": JSON.stringify({ name: "commonjs-package", main: "./index.js" }),
      "node_modules/commonjs-package/index.js": `
        require("./evaluations.js").push("commonjs-package");
        module.exports = { kind: "commonjs", token: {} };
      `,
      "node_modules/commonjs-package/evaluations.js": `module.exports = [];`,
      "node_modules/dual/package.json": JSON.stringify({
        name: "dual",
        exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs" } },
      }),
      "node_modules/dual/esm.mjs": `export const kind = "esm"; export const token = {};`,
      "node_modules/dual/cjs.cjs": `exports.kind = "cjs"; exports.token = {};`,
      "app/package.json": JSON.stringify({
        name: "app",
        type: "module",
        imports: { "#config": "./config.js", "#dependency": "conditions" },
        exports: { ".": "./index.js", "./config": "./config.js" },
      }),
      "app/config.js": `export const config = { value: 0 };`,
    };

    test("`exports` conditions, subpath patterns and blocked subpaths", async () => {
      using dir = tempDir("module-graph-loaders-package-exports", {
        ...packages,
        "app/index.js": `
          export * as root from "conditions";
          export * as feature from "conditions/feature";
          export * as fallback from "conditions/fallback";
          export * as sub from "conditions/sub/a";
          export const blocked = await import("conditions/sub/private").then(() => "resolved", error => error.code);
          export const missing = await import("conditions/not-exported").then(() => "resolved", error => error.code);
        `,
      });
      const file = join(String(dir), "app/index.js");

      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB, host] = [await a.import(file), await b.import(file), await import(file)];
      expect({
        root: inA.root.picked,
        feature: inA.feature.picked,
        fallback: inA.fallback.picked,
        sub: inA.sub.name,
        blocked: inA.blocked,
        missing: inA.missing,
      }).toEqual({
        root: "bun",
        feature: "feature-import",
        fallback: "default",
        sub: "sub/a",
        blocked: "ERR_MODULE_NOT_FOUND",
        missing: "ERR_MODULE_NOT_FOUND",
      });

      inA.root.increment();
      expect([inA.root.count, inB.root.count, host.root.count]).toEqual([1, 0, 0]);
    });

    test("graph.import() of a bare specifier resolves from the caller", async () => {
      using dir = tempDir("module-graph-loaders-package-bare", {
        ...packages,
        "app/index.js": `
          export async function importBare(graph) {
            const namespace = await graph.import("conditions");
            return namespace;
          }
        `,
      });
      const file = join(String(dir), "app/index.js");

      using graph = new ModuleGraph();
      const host = await import(file);
      const root = await host.importBare(graph);
      const hostRoot = await import(join(String(dir), "node_modules/conditions/bun.mjs"));
      root.increment();
      expect([root.picked, root.count, hostRoot.count]).toEqual(["bun", 1, 0]);
      expect(graph.mainModule).toBe(join(String(dir), "node_modules/conditions/bun.mjs"));
    });

    test("subpath imports (`#internal`) and self-reference stay in the graph", async () => {
      using dir = tempDir("module-graph-loaders-package-imports", {
        ...packages,
        "app/index.js": `
          export * as root from "conditions";
          export * as feature from "conditions/feature";
          export * as dependency from "#dependency";
          export * as self from "app/config";
          export { config } from "#config";
        `,
      });
      const file = join(String(dir), "app/index.js");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      inGraph.config.value = 5;
      expect({
        internal: inGraph.root.internal,
        packageSelfReference: inGraph.root.self === inGraph.feature,
        importsMapToPackage: inGraph.dependency === inGraph.root,
        selfReference: inGraph.self.config === inGraph.config,
        hostRoot: inGraph.root === host.root,
        values: [inGraph.config.value, host.config.value],
      }).toEqual({
        internal: "internal",
        packageSelfReference: true,
        importsMapToPackage: true,
        selfReference: true,
        hostRoot: false,
        values: [5, 0],
      });
    });

    test("a CommonJS package is shared; a dual package is per graph through `import` and shared through `require`", async () => {
      using dir = tempDir("module-graph-loaders-package-dual", {
        ...packages,
        "app/index.js": `
          import { createRequire } from "node:module";
          import commonjs from "commonjs-package";
          import evaluations from "commonjs-package/evaluations.js";
          import * as dual from "dual";
          export const dualRequired = createRequire(import.meta.url)("dual");
          export { commonjs, evaluations, dual };
        `,
      });
      const file = join(String(dir), "app/index.js");

      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB, host] = [await a.import(file), await b.import(file), await import(file)];
      expect({
        evaluations: inA.evaluations,
        commonjsIsShared: inA.commonjs === host.commonjs && inB.commonjs === host.commonjs,
        kinds: [inA.dual.kind, inA.dualRequired.kind],
        dualImportIsShared: inA.dual.token === host.dual.token || inA.dual.token === inB.dual.token,
        dualRequireIsShared: inA.dualRequired === host.dualRequired && inB.dualRequired === host.dualRequired,
      }).toEqual({
        evaluations: ["commonjs-package"],
        commonjsIsShared: true,
        kinds: ["esm", "cjs"],
        dualImportIsShared: false,
        dualRequireIsShared: true,
      });
    });
  });

  describe("query strings", () => {
    const files = {
      "versioned.mjs": `
        export let count = 0;
        export const increment = () => ++count;
        export const url = import.meta.url;
      `,
      "imports-versions.mjs": `
        import * as v1 from "./versioned.mjs?v=1";
        import * as v1Again from "./versioned.mjs?v=1";
        import * as v2 from "./versioned.mjs?v=2";
        import * as hashed from "./versioned.mjs?v=1#hash";
        import * as plain from "./versioned.mjs";
        export { v1, v1Again, v2, hashed, plain };
        export const dynamic = () => import("./versioned.mjs?v=1");
      `,
    };

    test("each query string is its own instance within a graph", async () => {
      using dir = tempDir("module-graph-loaders-query", files);
      const file = join(String(dir), "imports-versions.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      inGraph.v1.increment();
      inGraph.v2.increment();
      inGraph.v2.increment();
      inGraph.hashed.increment();
      inGraph.hashed.increment();
      inGraph.hashed.increment();

      const counts = (m: any) => [m.v1.count, m.v2.count, m.hashed.count, m.plain.count];
      const urls = (m: any) => [m.v1.url, m.v2.url, m.hashed.url, m.plain.url];
      expect({ graph: counts(inGraph), host: counts(host) }).toEqual({ graph: [1, 2, 3, 0], host: [0, 0, 0, 0] });
      expect(inGraph.v1Again).toBe(inGraph.v1);
      expect(await inGraph.dynamic()).toBe(inGraph.v1);
      expect(await inGraph.dynamic()).not.toBe(await host.dynamic());
      expect(urls(inGraph)).toEqual(urls(host));
      expect(urls(inGraph).map(url => url.slice(url.lastIndexOf("/")))).toEqual([
        "/versioned.mjs?v=1",
        "/versioned.mjs?v=2",
        "/versioned.mjs?v=1#hash",
        "/versioned.mjs",
      ]);
    });

    test("graph.import() with a query string", async () => {
      using dir = tempDir("module-graph-loaders-query-direct", files);
      const file = join(String(dir), "versioned.mjs");

      using graph = new ModuleGraph();
      const [v1, v2, plain] = [
        await graph.import(file + "?v=1"),
        await graph.import(file + "?v=2"),
        await graph.import(file),
      ];
      v1.increment();
      expect([v1.count, v2.count, plain.count]).toEqual([1, 0, 0]);
      expect(await graph.import(file + "?v=1")).toBe(v1);
      expect((await graph.import(join(String(dir), "imports-versions.mjs"))).v1).toBe(v1);
    });
  });

  describe("plugins", () => {
    test.concurrent("a virtual module from builder.module() has one instance per graph", async () => {
      using dir = tempDir("module-graph-loaders-plugin-virtual", {
        "uses-virtual.mjs": `export * as virtual from "virtual:counter";`,
        "main.mjs": `
          const { ModuleGraph } = Bun.unsafe;
          const calls = [];
          Bun.plugin({
            name: "virtual",
            setup(builder) {
              builder.module("virtual:counter", () => {
                calls.push("virtual:counter");
                return { contents: "export let count = 0; export const increment = () => ++count;", loader: "js" };
              });
            },
          });

          const file = import.meta.dir + "/uses-virtual.mjs";
          const a = new ModuleGraph();
          const b = new ModuleGraph();
          const [inA, inB, host] = [await a.import(file), await b.import(file), await import(file)];
          const callsAfterStaticImports = calls.length;
          inA.virtual.increment();
          inA.virtual.increment();
          inB.virtual.increment();
          console.log(JSON.stringify({
            counts: [inA.virtual.count, inB.virtual.count, host.virtual.count],
            callsAfterStaticImports,
            direct: (await a.import("virtual:counter")) === inA.virtual,
            calls: calls.length,
          }));
        `,
      });

      const { stdout, stderr, exitCode } = await runMain(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ counts: [2, 1, 0], callsAfterStaticImports: 3, direct: true, calls: 3 });
      expect(exitCode).toBe(0);
    });

    test.concurrent("onResolve() into a namespace and its onLoad() run for the graph's load", async () => {
      using dir = tempDir("module-graph-loaders-plugin-namespace", {
        "uses-namespace.mjs": `export * as thing from "things:thing";`,
        "main.mjs": `
          const { ModuleGraph } = Bun.unsafe;
          const calls = [];
          Bun.plugin({
            name: "namespace",
            setup(builder) {
              builder.onResolve({ filter: /.*/, namespace: "things" }, ({ path, importer }) => {
                calls.push("resolve " + path + " from " + importer.slice(import.meta.dir.length));
                return { path: "resolved-" + path, namespace: "things" };
              });
              builder.onLoad({ filter: /.*/, namespace: "things" }, ({ path }) => {
                calls.push("load " + path);
                return { contents: "export let count = 0; export const increment = () => ++count;", loader: "js" };
              });
            },
          });

          const file = import.meta.dir + "/uses-namespace.mjs";
          const a = new ModuleGraph();
          const b = new ModuleGraph();
          const inA = await a.import(file);
          const callsForA = calls.splice(0);
          const inB = await b.import(file);
          const callsForB = calls.splice(0);
          const host = await import(file);
          inA.thing.increment();
          console.log(JSON.stringify({
            counts: [inA.thing.count, inB.thing.count, host.thing.count],
            callsForA,
            callsForB,
          }));
        `,
      });

      const { stdout, stderr, exitCode } = await runMain(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        counts: [1, 0, 0],
        callsForA: ["resolve thing from /uses-namespace.mjs", "load resolved-thing"],
        callsForB: ["resolve thing from /uses-namespace.mjs", "load resolved-thing"],
      });
      expect(exitCode).toBe(0);
    });

    test.concurrent("an async onLoad() for a custom extension", async () => {
      using dir = tempDir("module-graph-loaders-plugin-extension", {
        "message.shout": "hello",
        "uses-extension.mjs": `
          import message, { token } from "./message.shout";
          export { message, token };
        `,
        "main.mjs": `
          const { ModuleGraph } = Bun.unsafe;
          let loads = 0;
          Bun.plugin({
            name: "shout",
            setup(builder) {
              builder.onLoad({ filter: /\\.shout$/ }, async ({ path }) => {
                loads++;
                const text = await Bun.file(path).text();
                return { contents: "export default " + JSON.stringify(text.toUpperCase()) + "; export const token = {};", loader: "js" };
              });
            },
          });

          const file = import.meta.dir + "/uses-extension.mjs";
          const [inA, inB, host] = [
            await new ModuleGraph().import(file),
            await new ModuleGraph().import(file),
            await import(file),
          ];
          console.log(JSON.stringify({
            messages: [inA.message, inB.message, host.message],
            tokenIsShared: inA.token === inB.token || inA.token === host.token,
            loads,
          }));
        `,
      });

      const { stdout, stderr, exitCode } = await runMain(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ messages: ["HELLO", "HELLO", "HELLO"], tokenIsShared: false, loads: 3 });
      expect(exitCode).toBe(0);
    });

    test.concurrent('an onLoad() returning `loader: "object"` exposes the plugin\'s values in each graph', async () => {
      using dir = tempDir("module-graph-loaders-plugin-object", {
        "uses-object.mjs": `
          import value, { answer, shared } from "virtual:object";
          export * as namespace from "virtual:object";
          export { value, answer, shared };
        `,
        "main.mjs": `
          const { ModuleGraph } = Bun.unsafe;
          const shared = { shared: true };
          let loads = 0;
          Bun.plugin({
            name: "object",
            setup(builder) {
              builder.module("virtual:object", () => {
                loads++;
                return { exports: { default: shared, shared, answer: 42 }, loader: "object" };
              });
            },
          });

          const file = import.meta.dir + "/uses-object.mjs";
          const [inA, inB, host] = [
            await new ModuleGraph().import(file),
            await new ModuleGraph().import(file),
            await import(file),
          ];
          console.log(JSON.stringify({
            answer: inA.answer,
            valuesAreThePlugins: [inA, inB, host].every(m => m.value === shared && m.shared === shared),
            namespaceIsShared: inA.namespace === inB.namespace || inA.namespace === host.namespace,
            loads,
          }));
        `,
      });

      const { stdout, stderr, exitCode } = await runMain(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ answer: 42, valuesAreThePlugins: true, namespaceIsShared: false, loads: 3 });
      expect(exitCode).toBe(0);
    });

    test.concurrent("a plugin registered after the graph was created is honoured by later imports", async () => {
      using dir = tempDir("module-graph-loaders-plugin-late", {
        "data.late": "late file",
        "loads-later.mjs": `
          export const loadVirtual = () => import("virtual:late");
          export const loadFile = () => import("./data.late");
        `,
        "main.mjs": `
          const { ModuleGraph } = Bun.unsafe;
          const graph = new ModuleGraph();
          const inGraph = await graph.import(import.meta.dir + "/loads-later.mjs");
          const before = await inGraph.loadVirtual().then(() => "resolved", error => error.code);

          Bun.plugin({
            name: "late",
            setup(builder) {
              builder.module("virtual:late", () => ({ contents: "export const from = 'builder.module()';", loader: "js" }));
              builder.onLoad({ filter: /\\.late$/ }, () => ({ contents: "export const from = 'onLoad()';", loader: "js" }));
            },
          });

          console.log(JSON.stringify({
            before,
            virtual: (await inGraph.loadVirtual()).from,
            file: (await inGraph.loadFile()).from,
            direct: (await graph.import("virtual:late")).from,
          }));
        `,
      });

      const { stdout, stderr, exitCode } = await runMain(String(dir));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        before: "ERR_MODULE_NOT_FOUND",
        virtual: "builder.module()",
        file: "onLoad()",
        direct: "builder.module()",
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("mock.module()", () => {
    test("a module mocked before the graph imports it is the mock in every graph", async () => {
      using dir = tempDir("module-graph-loaders-mock-before", {
        "mocked-before.mjs": `export const kind = "real";`,
        "imports-mocked-before.mjs": `export * as dependency from "./mocked-before.mjs";`,
      });
      const file = join(String(dir), "imports-mocked-before.mjs");

      const token = {};
      mock.module(join(String(dir), "mocked-before.mjs"), () => ({ kind: "mock", token }));
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB, host] = [await a.import(file), await b.import(file), await import(file)];
      expect([{ ...inA.dependency }, { ...inB.dependency }, { ...host.dependency }]).toEqual([
        { kind: "mock", token },
        { kind: "mock", token },
        { kind: "mock", token },
      ]);
      expect(inA.dependency.token).toBe(token);
      expect(inA.dependency).not.toBe(host.dependency);
      expect(inA.dependency).not.toBe(inB.dependency);
    });

    test("mocking after a graph loaded the module does not change that graph's instance", async () => {
      using dir = tempDir("module-graph-loaders-mock-after", {
        "mocked-after.mjs": `
          export const kind = "real";
          export let count = 0;
          export const increment = () => ++count;
        `,
        "imports-mocked-after.mjs": `
          export * as dependency from "./mocked-after.mjs";
          export const again = () => import("./mocked-after.mjs");
        `,
      });
      const file = join(String(dir), "imports-mocked-after.mjs");

      using early = new ModuleGraph();
      using late = new ModuleGraph();
      const inEarly = await early.import(file);
      inEarly.dependency.increment();
      mock.module(join(String(dir), "mocked-after.mjs"), () => ({ kind: "mock" }));
      const inLate = await late.import(file);

      expect({ ...inEarly.dependency }).toEqual({ kind: "real", count: 1, increment: inEarly.dependency.increment });
      expect(await inEarly.again()).toBe(inEarly.dependency);
      expect({ ...inLate.dependency }).toEqual({ kind: "mock" });
    });

    test("a module mocked after the graph was created, before the graph's first import of it", async () => {
      using dir = tempDir("module-graph-loaders-mock-dynamic", {
        "mocked-lazily.mjs": `export const kind = "real";`,
        "imports-lazily.mjs": `export const load = () => import("./mocked-lazily.mjs");`,
      });

      using graph = new ModuleGraph();
      const inGraph = await graph.import(join(String(dir), "imports-lazily.mjs"));
      mock.module(join(String(dir), "mocked-lazily.mjs"), () => ({ kind: "mock" }));
      expect({ ...(await inGraph.load()) }).toEqual({ kind: "mock" });
    });
  });

  test("a macro import runs at transpile time for the graph's module", async () => {
    using dir = tempDir("module-graph-loaders-macro", {
      "shout.ts": `export function shout(text: string) { return text.toUpperCase() + "!"; }`,
      "uses-macro.ts": `
        import { shout } from "./shout.ts" with { type: "macro" };
        export const value = shout("inlined");
      `,
    });

    using graph = new ModuleGraph();
    const inGraph = await graph.import(join(String(dir), "uses-macro.ts"));
    expect(inGraph.value).toBe("INLINED!");
  });

  describe("stack traces", () => {
    test("TypeScript positions from graph code match the host's instance", async () => {
      using dir = tempDir("module-graph-loaders-stack-ts", {
        "thrower.ts": `type Unused = { a: number };
interface AlsoUnused { b: string }

export function fail(message: string): never {
  const error: Error = new Error(message);
  throw error;
}
`,
      });
      const file = join(String(dir), "thrower.ts");

      using graph = new ModuleGraph({ globals: { tenant: "a" } });
      const [inGraph, host] = [await graph.import(file), await import(file)];
      const frames = framesIn(
        caught(() => inGraph.fail("graph")),
        String(dir),
      );
      expect(frames).toEqual(["at fail (/thrower.ts:5:28)"]);
      expect(frames).toEqual(
        framesIn(
          caught(() => host.fail("host")),
          String(dir),
        ),
      );
    });

    test("a module with a sourceMappingURL comment", async () => {
      // Generated line 2, column 8 maps to original.src line 41, column 2.
      const map = { version: 3, sources: ["original.src"], names: [], mappings: ";QAwCE" };
      using dir = tempDir("module-graph-loaders-stack-source-map", {
        "mapped.mjs":
          `export function boom() {\n  throw new Error("mapped");\n}\n` +
          `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}\n`,
      });
      const file = join(String(dir), "mapped.mjs");

      using graph = new ModuleGraph();
      const [inGraph, host] = [await graph.import(file), await import(file)];
      const frames = framesIn(caught(inGraph.boom), String(dir));
      expect(frames).toHaveLength(1);
      expect(frames).toEqual(framesIn(caught(host.boom), String(dir)));
    });

    test("a 2 MB module", async () => {
      const padding = Buffer.alloc(1000, "p").toString();
      const lines: string[] = [];
      for (let i = 0; i < 2000; i++) lines.push(`function f${i}(x) { return x + ${i}; } // ${padding}`);
      lines.push(`export let count = 0; export const increment = () => ++count; export const last = f1999;`);
      lines.push(`export function failAtEnd() { throw new Error("end"); }`);
      using dir = tempDir("module-graph-loaders-large", { "large.mjs": lines.join("\n") + "\n" });
      const file = join(String(dir), "large.mjs");

      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB, host] = [await a.import(file), await b.import(file), await import(file)];
      inA.increment();
      expect({ counts: [inA.count, inB.count, host.count], last: inB.last(1) }).toEqual({
        counts: [1, 0, 0],
        last: 2000,
      });
      const frames = framesIn(caught(inA.failAtEnd), String(dir));
      expect(frames).toEqual(["at failAtEnd (/large.mjs:2002:41)"]);
      expect(frames).toEqual(framesIn(caught(host.failAtEnd), String(dir)));
    });
  });

  test("a file served from the transpiler cache has independent instances in each graph", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 600; i++) lines.push(`function f${i}(x: number): number { return x + ${i}; } // cached`);
    lines.push(
      `export let count: number = 0; export const increment = (): number => ++count; export const last = f599;`,
    );
    using dir = tempDir("module-graph-loaders-transpiler-cache", {
      "cached.ts": Buffer.alloc(60 * 1024, "/").toString() + "\n" + lines.join("\n") + "\n",
      "main.mjs": `
        const { ModuleGraph } = Bun.unsafe;
        const file = import.meta.dir + "/cached.ts";
        const [inA, inB, inC, host] = [
          await new ModuleGraph().import(file),
          await new ModuleGraph().import(file),
          await new ModuleGraph({ globals: { tenant: "c" } }).import(file),
          await import(file),
        ];
        inA.increment();
        inA.increment();
        inB.increment();
        console.log(JSON.stringify({ counts: [inA.count, inB.count, inC.count, host.count], last: inC.last(1) }));
      `,
    });
    const cache = join(String(dir), ".cache");
    const env = {
      ...bunEnv,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache,
      BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
    };

    const cold = await runMain(String(dir), env);
    expect(JSON.parse(cold.stdout)).toEqual({ counts: [2, 1, 0, 0], last: 600 });
    const entries = readdirSync(cache);
    expect(entries).toHaveLength(1);

    const warm = await runMain(String(dir), env);
    expect(JSON.parse(warm.stdout)).toEqual({ counts: [2, 1, 0, 0], last: 600 });
    expect(readdirSync(cache)).toEqual(entries);
    expect([cold.exitCode, warm.exitCode]).toEqual([0, 0]);
  });
});
