// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { expect } from "bun:test";
import { MAX_PATH_BYTES } from "harness";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Client, Dev, devTest, emptyHtmlFile, minimalFramework, WatchSynchronization } from "../bake-harness";

devTest("import identifier doesnt get renamed", {
  framework: minimalFramework,
  files: {
    "db.ts": `export const abc = "123";`,
    "routes/index.ts": `
      import { abc } from '../db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + '!');
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Hello, 123!");
    await dev.write("db.ts", `export const abc = "456";`);
    await dev.fetch("/").equals("Hello, 456!");
    await dev.patch("routes/index.ts", {
      find: "Hello",
      replace: "Bun",
    });
    await dev.fetch("/").equals("Bun, 456!");
  },
});
devTest("symbol collision with import identifier", {
  framework: minimalFramework,
  files: {
    "db.ts": `export const abc = "123";`,
    "routes/index.ts": `
      let import_db = 987;
      import { abc } from '../db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + ', ' + import_db + '!');
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Hello, 123, 987!");
    await dev.write("db.ts", `export const abc = "456";`);
    await dev.fetch("/").equals("Hello, 456, 987!");
  },
});
devTest('uses "development" condition', {
  framework: minimalFramework,
  files: {
    "node_modules/example/package.json": JSON.stringify({
      name: "example",
      version: "1.0.0",
      exports: {
        ".": {
          development: "./development.js",
          default: "./production.js",
        },
      },
    }),
    "node_modules/example/development.js": `export default "development";`,
    "node_modules/example/production.js": `export default "production";`,
    "routes/index.ts": `
      import environment from 'example';
      export default function (req, meta) {
        return new Response('Environment: ' + environment);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Environment: development");
  },
});
devTest("importing a file before it is created", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { abc } from './second';
      console.log('value: ' + abc);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [`index.ts:1:21: error: Could not resolve: "./second"`],
    });

    await c.expectReload(async () => {
      await dev.write("second.ts", `export const abc = "456";`);
    });

    await c.expectMessage("value: 456");
  },
});
// After a failed resolution, the dev server evicts the specifier's path and its parent from the
// resolver's directory cache. Here one of those two paths ends in a slash.
devTest("recovers from an unresolved import of a path that ends in a slash", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { abc } from './second/';
      console.log('value: ' + abc);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [`index.ts:1:21: error: Could not resolve: "./second/"`],
    });

    for (const specifier of [
      dev.join("second") + path.sep,
      // This path's parent is `<root>/`.
      dev.rootDir + path.sep + path.sep + "second",
    ]) {
      await dev.write("index.ts", `import ${JSON.stringify(specifier)};`, {
        errors: [`index.ts:1:8: error: Could not resolve: "${specifier}"`],
      });
    }

    await c.expectReload(async () => {
      await dev.write("index.ts", `console.log('value: ' + 789);`);
    });
    await c.expectMessage("value: 789");
  },
});
devTest("default export same-scope handling", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import.meta.hot.accept();
      await import("./fixture1.ts"); 
      console.log((new ((await import("./fixture2.ts")).default)).a); 
      await import("./fixture3.ts"); 
      console.log((new ((await import("./fixture4.ts")).default)).result); 
      console.log((await import("./fixture5.ts")).default);
      console.log((await import("./fixture6.ts")).default);
      console.log((await import("./fixture7.ts")).default());
      console.log((await import("./fixture8.ts")).default());
      console.log((await import("./fixture9.ts")).default(false));
    `,
    "fixture1.ts": `
      const sideEffect = () => "a";
      export default class A {
        [sideEffect()] = "ONE";
      }
      console.log(new A().a);
    `,
    "fixture2.ts": `
      const sideEffect = () => "a";
      export default class A {
        [sideEffect()] = "TWO";
      }
    `,
    "fixture3.ts": `
      export default class A {
        result = "THREE"
      }
      console.log(new A().result);
    `,
    "fixture4.ts": `
      import.meta.hot.accept();
      export default class MOVE {
        result = "FOUR"
      }
    `,
    "fixture5.ts": `
      const default_export = "FIVE";
      export default default_export;
    `,
    "fixture6.ts": `
      const default_export = "S";
      function sideEffect() {
        return default_export + "EVEN";
      }
      export default sideEffect();
      console.log(default_export + "IX");
    `,
    "fixture7.ts": `
      export default function() { return "EIGHT" };
    `,
    "fixture8.ts": `
      import.meta.hot.accept();
      export default function MOVE() { return "NINE" };
    `,
    "fixture9.ts": `
      export default function named(flag = true) { return flag ? "TEN" : "ELEVEN" };
      console.log(named());
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    c.expectMessage(
      //
      "ONE",
      "TWO",
      "THREE",
      "FOUR",
      "FIVE",
      "SIX",
      "SEVEN",
      "EIGHT",
      "NINE",
      "TEN",
      "ELEVEN",
    );

    const filesExpectingMove = Object.entries(dev.options.files)
      .filter(([, content]) => content.includes("MOVE"))
      .map(([path]) => path);
    for (const file of filesExpectingMove) {
      await dev.writeNoChanges(file);
      const chunk = await c.getMostRecentHmrChunk();
      expect(chunk).toMatch(/default:\s*(function|class)\s*MOVE/);
    }

    await dev.writeNoChanges("fixture7.ts");
    const chunk = await c.getMostRecentHmrChunk();
    expect(chunk).toMatch(/default:\s*function/);

    // Since fixture7.ts is not marked as accepting, it will bubble the update
    // to `index.ts`, re-evaluate it and some of the dependencies.
    c.expectMessage("TWO", "FOUR", "FIVE", "SEVEN", "EIGHT", "NINE", "ELEVEN");
  },
});
// An anonymous `export default class` that cannot be moved into the exports
// object (it has an `extends` clause, a static block, or a computed key) has to
// stay a class statement, which needs a name. It used to crash the dev server
// with `called Option::unwrap() on a None value` while visiting the file.
devTest("anonymous export default class that must stay a statement", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import.meta.hot.accept();
      import { Base } from "./base";
      import Derived from "./derived";
      import StaticBlock from "./static-block";
      import ComputedKey from "./computed-key";
      console.log("extends: " + (new Derived() instanceof Base) + " " + new Derived().tag);
      console.log("static block: " + StaticBlock.initialized);
      console.log("computed key: " + new ComputedKey().computed);
    `,
    "base.ts": `
      export class Base {
        tag = "base";
      }
    `,
    "derived.ts": `
      import { Base } from "./base";
      export default class extends Base {
        tag = "derived";
      }
    `,
    "static-block.ts": `
      export default class {
        static initialized = false;
        static {
          this.initialized = true;
        }
      }
    `,
    "computed-key.ts": `
      const key = "computed";
      export default class {
        [key] = "value";
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("extends: true derived", "static block: true", "computed key: value");

    await dev.patch("derived.ts", { find: '"derived"', replace: '"updated"' });
    await c.expectMessage("extends: true updated", "static block: true", "computed key: value");
  },
});
devTest("directory cache bust case #17576", {
  files: {
    "web/index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "web/index.ts": `
      console.log(123);
      import.meta.hot.accept();
    `,
  },
  mainDir: "server",
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(123);
    await c.expectNoWebSocketActivity(async () => {
      await dev.write(
        "web/Test.ts",
        `
          export const abc = 456;
        `,
      );
    });
    await dev.write(
      "web/index.ts",
      `
        import { abc } from "./Test.ts";
        console.log(abc);
      `,
    );
    await c.expectMessage(456);
  },
});
devTest("deleting imported file shows error then recovers", {
  skip: [
    "win32", // unlinkSync is having weird behavior
  ],
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from "./other";
      console.log(value);
    `,
    "other.ts": `
      export const value = 123;
    `,
    "unrelated.ts": `
      export const value = 123;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(123);
    await dev.delete("other.ts", {
      errors: ['index.ts:1:23: error: Could not resolve: "./other"'],
    });
    await c.expectReload(async () => {
      await dev.write(
        "other.ts",
        `
          export const value = 456;
        `,
      );
    });
    await c.expectMessage(456);
    await c.expectNoWebSocketActivity(async () => {
      await dev.delete("unrelated.ts");
    });
  },
});
// Without a separate SSR graph, the server bundle keeps a "use client" module
// and the parser wraps its exported values in `registerClientReference(value,
// file, name)`. The parser chose `file` by the JSX development flag. A
// `@jsxRuntime react-jsx` pragma turns that flag off for one file, and the
// parser then aborted the process in a branch that was written for production
// builds.
devTest('a "use client" module with a @jsxRuntime pragma keeps its client references', {
  framework: minimalFramework,
  files: {
    "components/Button.ts": `
      "use client";
      export function Button() {}
      export const label = "label";
      export default class Panel {}
    `,
    "routes/index.ts": `
      import Panel, { Button, label } from '../components/Button';
      export default function (req, meta) {
        return Response.json(
          [Panel, Button, label].map(ref => ({ file: ref.file.replaceAll("\\\\", "/"), uid: ref.uid })),
        );
      }
    `,
  },
  async test(dev) {
    const references = [
      { file: "components/Button.ts", uid: "default" },
      { file: "components/Button.ts", uid: "Button" },
      { file: "components/Button.ts", uid: "label" },
    ];
    await dev.fetch("/").equals(references);

    await dev.write(
      "components/Button.ts",
      `
        "use client";
        /** @jsxRuntime react-jsx */
        export function Button() {}
        export const label = "label";
        export default class Panel {}
      `,
    );
    await dev.fetch("/").equals(references);
  },
});
for (const count of [4, 9]) {
  const ids = Array.from({ length: count }, (_, i) => i);
  devTest(`a page that imports ${count} "use client" modules`, {
    framework: minimalFramework,
    files: {
      ...Object.fromEntries(ids.map(i => [`components/c${i}.ts`, `"use client";\nexport default function C${i}() {}`])),
      "routes/index.ts": `
        ${ids.map(i => `import c${i} from "../components/c${i}";`).join("\n")}
        export default function () {
          return Response.json([${ids.map(i => `c${i}`).join(", ")}].map(ref => ref.file.replaceAll("\\\\", "/")));
        }
      `,
    },
    async test(dev) {
      await dev.fetch("/").equals(ids.map(i => `components/c${i}.ts`));
    },
  });
}
devTest("repairing a missing import in a framework without server components", {
  framework: { fileSystemRouterTypes: minimalFramework.fileSystemRouterTypes },
  files: {
    "routes/index.ts": `
      import "./does-not-exist";
      export default function () {
        return new Response("index");
      }
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write(
      "routes/index.ts",
      `
        export default function () {
          return new Response("index");
        }
      `,
    );
    await dev.fetch("/").equals("index");
  },
});
// Regression test: DirectoryWatchStore.Dep.source_file_path borrows the key
// string from IncrementalGraph.bundled_files. When a client-component boundary
// is demoted (its "use client" directive is removed) the server graph calls
// client_graph.disconnectAndDeleteFile which frees that key. Previously the
// Dep was left pointing at freed memory, and the next directory-watch event
// that re-resolved that Dep read it (use-after-free, caught by ASAN).
devTest("removing 'use client' from a component with a pending resolution failure", {
  // separateSSRGraph is required so the "use client" file is parsed with the
  // browser target; otherwise the resolution failure is attributed to the
  // server graph and the client-graph key is never borrowed.
  framework: {
    ...minimalFramework,
    serverComponents: {
      ...minimalFramework.serverComponents!,
      separateSSRGraph: true,
    },
  },
  files: {
    "routes/index.ts": `
      import * as Comp from '../components/Comp';
      import '../components/Sibling';
      export default function (req, meta) {
        return new Response('page: ' + (typeof Comp.marker));
      }
    `,
    "components/Comp.ts": `
      "use client";
      export const marker = "initial";
    `,
    // Sibling.ts keeps a second, stable client-graph Dep on the
    // components/ directory watch so the watch survives after the
    // Comp.ts-owned Dep is cleaned up.
    "components/Sibling.ts": `
      "use client";
      import './sibling-missing';
      export const sibling = 1;
    `,
  },
  async test(dev) {
    // Initial bundle: Comp.ts compiles cleanly as a client-component
    // boundary, so the server graph records is_client_component_boundary
    // and the client graph owns the key string for Comp.ts. Sibling.ts
    // fails to resolve './sibling-missing' under the browser target,
    // leaving a client-graph Dep on the components/ directory watch.
    await dev.fetch("/");

    // Re-bundle Comp.ts with a failing import while it is still a CCB.
    // With separateSSRGraph the re-parse runs under the browser target,
    // so trackResolutionFailure inserts a second Dep whose
    // source_file_path is the client graph's key for Comp.ts.
    await dev.write(
      "components/Comp.ts",
      `
        "use client";
        import { value } from './missing';
        export const marker = value;
      `,
      { errors: null },
    );

    // Drop the directive and the failing import so the server parse
    // succeeds. server_graph.receiveChunk now sees scb=false with
    // was_ccb=true and calls client_graph.disconnectAndDeleteFile, which
    // frees the key string that the Comp.ts Dep still references.
    await dev.write(
      "components/Comp.ts",
      `
        export const marker = "no-client";
      `,
      { errors: null },
    );

    // Create the previously-missing file. The components/ directory watch
    // is still alive (Sibling's Dep), so HotReloadEvent.processFileList
    // walks every Dep for components/ and dereferences each
    // source_file_path. Under ASAN the stale Comp.ts client-graph Dep is
    // a heap-use-after-free here and the dev server aborts.
    await dev.write("components/missing.ts", `export const value = "ok";`, { errors: null });

    // The server must still be alive and responding.
    const res = await dev.fetch("/");
    expect(res).toBeInstanceOf(Response);
  },
});
// The bundler has no transform for a module that starts with "use server".
// Bundling one used to abort the process from a bundler thread (the parser
// panics on `registerServerReference`), so saving a server-action file took
// down every route.
const useServerError = (file: string) => `${file}:1:1: error: "use server" is not supported yet`;
devTest('saving a "use server" module is a build error', {
  framework: minimalFramework,
  files: {
    "actions.ts": `
      export async function save() {
        return "saved";
      }
    `,
    "routes/index.ts": `
      import { save } from '../actions';
      export default async function (req, meta) {
        return new Response('Hello, ' + (await save()) + '!');
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Hello, saved!");

    await dev.write(
      "actions.ts",
      `
        "use server";
        export async function save() {
          return "saved";
        }
      `,
    );
    {
      await using c = await dev.client("/", { errors: [useServerError("actions.ts")] });
    }

    await dev.write(
      "actions.ts",
      `
        export async function save() {
          return "saved again";
        }
      `,
    );
    await dev.fetch("/").equals("Hello, saved again!");
  },
});
devTest('a "use server" module that exists at startup is a build error', {
  framework: minimalFramework,
  files: {
    "actions.ts": `
      "use server";
      export async function save() {
        return "saved";
      }
    `,
    "routes/index.ts": `
      import { save } from '../actions';
      export default async function (req, meta) {
        return new Response('Hello, ' + (await save()) + '!');
      }
    `,
    "routes/other.ts": `
      export default function (req, meta) {
        return new Response('other');
      }
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/", { errors: [useServerError("actions.ts")] });
    }
    // A route that does not import the module still works.
    await dev.fetch("/other").equals("other");
  },
});
// With a separate SSR graph, a "use server" module with nothing to wrap got
// past the parser and aborted on the bundler's main thread instead.
devTest('a "use server" module with no exports is a build error', {
  framework: {
    ...minimalFramework,
    serverComponents: {
      ...minimalFramework.serverComponents!,
      separateSSRGraph: true,
    },
  },
  files: {
    "setup.ts": `
      "use server";
      globalThis.didSetup = true;
    `,
    "routes/index.ts": `
      import '../setup';
      export default function (req, meta) {
        return new Response('setup: ' + globalThis.didSetup);
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { errors: [useServerError("setup.ts")] });
  },
});
// The browser graph and the SSR graph bundle what a client component imports.
// Neither has the stubs that would call the server in place of the module.
devTest('a "use server" module imported by a client component is a build error', {
  framework: {
    ...minimalFramework,
    serverComponents: {
      ...minimalFramework.serverComponents!,
      separateSSRGraph: true,
    },
  },
  files: {
    "actions.ts": `
      "use server";
      export async function save() {
        return "saved";
      }
    `,
    "components/Comp.ts": `
      "use client";
      import { save } from '../actions';
      export function Button() {
        return save;
      }
    `,
    "routes/index.ts": `
      import * as Comp from '../components/Comp';
      export default function (req, meta) {
        return new Response('page: ' + (typeof Comp.Button));
      }
    `,
  },
  async test(dev) {
    {
      // One entry for each graph that bundles the module.
      await using c = await dev.client("/", {
        errors: [useServerError("actions.ts"), useServerError("actions.ts")],
      });
    }

    await dev.write(
      "actions.ts",
      `
        export async function save() {
          return "saved";
        }
      `,
    );
    await dev.fetch("/").equals("page: object");
  },
});
// Every loader got the scan for a use directive. A text file that starts with
// the same bytes hit the "use server" abort, or became a client component
// reference for "use client".
devTest("a file that is not JavaScript does not carry a use directive", {
  framework: {
    ...minimalFramework,
    serverComponents: {
      ...minimalFramework.serverComponents!,
      separateSSRGraph: true,
    },
  },
  files: {
    "actions.ts": `"use server"; export async function save() {}`,
    "server-note.txt": `"use server" marks the exports of a module as server actions.`,
    "client-note.txt": `"use client" marks a module as a client component.`,
    "routes/index.ts": `
      import source from '../actions.ts' with { type: 'text' };
      import serverNote from '../server-note.txt';
      import clientNote from '../client-note.txt';
      export default function (req, meta) {
        return new Response(JSON.stringify({ source, serverNote, clientNote }));
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals({
      source: `"use server"; export async function save() {}`,
      serverNote: `"use server" marks the exports of a module as server actions.`,
      clientNote: `"use client" marks a module as a client component.`,
    });
  },
});
// Counts how often each file matching `filter` is loaded. Loads for the client graph are counted separately.
const countLoads = (filter: string) => `
  import { basename } from "node:path";
  export default [
    {
      name: "count-loads",
      setup(build) {
        build.onLoad({ filter: /${filter}/ }, args => {
          const loads = (globalThis.loads ??= {});
          const file = basename(args.path) + (args.side === "client" ? " (client)" : "");
          loads[file] = (loads[file] ?? 0) + 1;
        });
      },
    },
  ];
`;
// `#name` resolves to `name-rsc.ts` in a graph with the "react-server" condition, and to `name-ssr.ts` otherwise.
const conditionalImport = (name: string) => ({
  "package.json": JSON.stringify({
    imports: { [`#${name}`]: { "react-server": `./${name}-rsc.ts`, "default": `./${name}-ssr.ts` } },
  }),
  [`${name}-rsc.ts`]: `export const which = "rsc";`,
  [`${name}-ssr.ts`]: `export const which = "ssr";`,
});
const oneServerGraph = { ...minimalFramework.serverComponents!, separateSSRGraph: false };
const separateSSRGraph = { ...minimalFramework.serverComponents!, separateSSRGraph: true };
// A failed import belongs to the importing file's graph.
// `#cond` shows which graphs bundle the page.
{
  const page = `
    import { which } from "#cond";
    export default function () {
      return Response.json({ which, loads: globalThis.loads });
    }
  `;
  for (const { name, serverComponents, failedImport, which } of [
    { name: "no server components", serverComponents: undefined, failedImport: `import "./missing";`, which: "ssr" },
    {
      name: "separate SSR graph",
      serverComponents: separateSSRGraph,
      failedImport: `import "./missing";`,
      which: "rsc",
    },
    {
      name: "bunBakeGraph attribute without an SSR graph",
      serverComponents: oneServerGraph,
      failedImport: `import "../other.ts" with { bunBakeGraph: "ssr" };`,
      which: "rsc",
    },
  ]) {
    devTest(`bundles a page once per save after a failed import (${name})`, {
      framework: { fileSystemRouterTypes: minimalFramework.fileSystemRouterTypes, serverComponents },
      pluginFile: countLoads("(routes.index|cond-(rsc|ssr))[.]ts$"),
      files: {
        ...conditionalImport("cond"),
        "other.ts": `export default 1;`,
        "routes/index.ts": failedImport + page,
      },
      async test(dev) {
        expect((await dev.fetch("/")).status).toBe(500);
        await dev.write("routes/index.ts", page);
        expect(await dev.fetch("/").json()).toEqual({ which, loads: { "index.ts": 2, [`cond-${which}.ts`]: 1 } });
        await dev.write("routes/index.ts", page + "// saved again");
        expect(await dev.fetch("/").json()).toEqual({ which, loads: { "index.ts": 3, [`cond-${which}.ts`]: 1 } });
        // The page still depends on the file that its graph resolved.
        await dev.write(`cond-${which}.ts`, `export const which = ;`);
        expect((await dev.fetch("/")).status).toBe(500);
      },
    });
  }
}
// A file must not move to a graph that doesn't bundle it. shared.ts is in the server
// and SSR graphs. ssr-only.ts is only in the SSR graph.
{
  const files = {
    ...conditionalImport("only"),
    "routes/index.ts": `
      import "../shared";
      import "../Comp";
      export default function () {
        return Response.json(globalThis.loads);
      }
    `,
    "Comp.ts": `
      "use client";
      import "./shared";
      import "./ssr-only";
      export const marker = 1;
    `,
  };
  const shared = (n: number) => `export const shared = ${n};`;
  const ssrOnly = (n: number) => `import "#only"; export const ssrOnly = ${n};`;
  const oncePerGraph = { "shared.ts": 2, "shared.ts (client)": 1, "ssr-only.ts": 1, "ssr-only.ts (client)": 1 };
  const difference = (before: Record<string, number>, after: Record<string, number>) =>
    Object.fromEntries(
      Object.keys(after)
        .filter(file => after[file] !== before[file])
        .map(file => [file, after[file] - (before[file] ?? 0)]),
    );
  devTest("bundles a file once per graph per save after its import is deleted and restored", {
    skip: [
      "win32", // unlinkSync is having weird behavior
    ],
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    pluginFile: countLoads("(shared|ssr-only|only-rsc|only-ssr)[.]ts$"),
    files: {
      ...files,
      "shared.ts": `import "./leaf"; ${shared(1)}`,
      "ssr-only.ts": `import "./leaf"; ${ssrOnly(1)}`,
      "leaf.ts": `export const leaf = 1;`,
    },
    async test(dev) {
      await dev.fetch("/");
      await dev.delete("leaf.ts", { errors: null });
      await dev.write("leaf.ts", `export const leaf = 2;`);
      const restored = await dev.fetch("/").json();
      expect(restored).toEqual({
        "shared.ts": 6,
        "shared.ts (client)": 3,
        "ssr-only.ts": 3,
        "ssr-only.ts (client)": 3,
        "only-ssr.ts": 1,
        "only-ssr.ts (client)": 1,
      });
      await dev.write("shared.ts", `import "./leaf"; ${shared(2)}`);
      await dev.write("ssr-only.ts", `import "./leaf"; ${ssrOnly(2)}`);
      expect(difference(restored, await dev.fetch("/").json())).toEqual(oncePerGraph);
    },
  });
  devTest("bundles a module with a previously failed import for the SSR graph when a second route imports it", {
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    files: {
      "shared.ts": `
        import "./missing";
        export const shared = "shared";
      `,
      "routes/index.ts": `
        import { shared } from "../shared";
        export default function () {
          return new Response("index " + shared);
        }
      `,
      "routes/other.ts": `
        import { shared } from "../shared" with { bunBakeGraph: "ssr" };
        export default function () {
          return new Response("other " + shared);
        }
      `,
    },
    async test(dev) {
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("shared.ts", `export const shared = "shared";`);
      await dev.fetch("/").equals("index shared");
      await dev.fetch("/other").equals("other shared");
    },
  });
}
devTest("build error in a file imported by a 'use client' component", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      import * as Comp from "../Comp";
      export default function (req, meta) {
        return new Response(typeof Comp.Button);
      }
    `,
    "routes/manifest.ts": `
      import { serverManifest } from "bun:bake/server";
      export default function (req, meta) {
        return Response.json(Object.keys(serverManifest).sort());
      }
    `,
    "Comp.ts": `
      "use client";
      export * from "./inner";
      import { save } from "./actions";
      export function Button() { return save; }
    `,
    "inner.ts": `
      export const Inner = 1;
    `,
    "actions.ts": `
      export function save() { return 1 +; }
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    // Comp.ts is registered even though it can't be evaluated yet.
    expect(await dev.fetch("/manifest").json()).toEqual(["Comp.ts#Button", "Comp.ts#Inner"]);
    await dev.write("actions.ts", `export function save() { return 1; }`);
    await dev.fetch("/").equals("object");
  },
});
devTest("deinit with a free-list slot in DirectoryWatchStore.dependencies", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    // Import-record order is source order, so trackResolutionFailure is
    // called for ./sub/a first (dep index 0) and ./sub/b second (dep index 1).
    "index.ts": `
      import './sub/a';
      import './sub/b';
      export {};
    `,
    // sub/ must exist for the directory watch to be opened.
    "sub/placeholder.ts": `export {};`,
  },
  async test(dev) {
    // Initial bundle: both imports fail and attach deps to the sub/ watch.
    await dev.fetch("/");

    {
      await using _ = await dev.batchChanges({ errors: null });
      // Rewrite index.ts so the rebuild has no failing imports and therefore
      // does not re-track anything (which would consume the free-list slot).
      await dev.write("index.ts", `export {};`);
      // Creating sub/a.ts fires the sub/ directory watch. Walking the dep
      // chain (LIFO: 1 then 0), dep 1 (./sub/b) still fails and is kept;
      // dep 0 (./sub/a) now resolves, so freeDependencyIndex(0) frees its
      // specifier and, because 0 != len-1, pushes index 0 onto
      // dependencies_free_list.
      await dev.write("sub/a.ts", `export {};`);
    }

    // The server should still respond.
    const res = await dev.fetch("/");
    expect(res).toBeInstanceOf(Response);

    // Test teardown sends graceful-exit, which calls DevServer.deinit.
    // Before the fix, deinit iterated every dependencies.items slot and
    // freed .specifier again for the free-list slot at index 0, tripping
    // AllocationScope's invalid-free panic.
  },
});
// The dev server skips a router type whose root doesn't exist.
devTest("reports a build error when an earlier router type has a missing root", {
  framework: {
    ...minimalFramework,
    fileSystemRouterTypes: ["missing", "routes"].map(root => ({ ...minimalFramework.fileSystemRouterTypes![0], root })),
  },
  files: {
    "routes/index.ts": "export default () => {",
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("routes/index.ts", `export default () => new Response("index");`);
    await dev.fetch("/").equals("index");
  },
});
// A file in both the server and SSR graphs shares one server-side record.
for (const [first, second] of [
  ["/", "/other"],
  ["/other", "/"],
]) {
  devTest(`bundles a module for the graph of ${second} after ${first} bundled it for its graph`, {
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    files: {
      "shared.ts": `export const shared = "shared";`,
      "routes/index.ts": `
        import { shared } from "../shared";
        export default () => new Response("/ " + shared);
      `,
      "routes/other.ts": `
        import { shared } from "../shared" with { bunBakeGraph: "ssr" };
        export default () => new Response("/other " + shared);
      `,
    },
    async test(dev) {
      await dev.fetch(first).equals(first + " shared");
      await dev.fetch(second).equals(second + " shared");
    },
  });
}
devTest("importing html file", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import html from "./index.html";
      console.log(html);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["index.ts:1:18: error: Browser builds cannot import HTML files."],
    });
  },
});
devTest("importing html file with text loader (#18154)", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import html from "./app.html" with { type: "text" };
      console.log(html);
    `,
    "app.html": "<div>hello world</div>",
  },
  htmlFiles: ["index.html"],
  async test(dev) {
    await using c = await dev.client("/", {});
    await c.expectMessage("<div>hello world</div>");
  },
});
devTest("importing bun on the client", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import bun from "bun";
      console.log(bun);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ['index.ts:1:17: error: Browser build cannot import Bun builtin: "bun"'],
    });
  },
});
devTest("import.meta.main", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log(import.meta.main);
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(false); // import.meta.main is always false because there is no single entry point

    await dev.write(
      "index.ts",
      `
        require;
        console.log(import.meta.main);
      `,
    );
    await c.expectMessage(false);
  },
});
devTest("commonjs forms", {
  timeoutMultiplier: 2,
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import cjs from "./cjs.js";
      console.log(cjs);
    `,
    "cjs.js": `
      module.exports.field = {};
    `,
  },
  async test(dev) {
    console.log("Initial");
    await using c = await dev.client("/");
    console.log("  expecting message");
    await c.expectMessage({ field: {} });
    console.log("  expecting reload");
    await c.expectReload(async () => {
      console.log("  writing");
      await dev.write("cjs.js", `exports.field = "1";`);
      console.log("  now reloading");
    });
    console.log("  expecting message");
    await c.expectMessage({ field: "1" });
    console.log("Second");
    console.log("  expecting reload");
    await c.expectReload(async () => {
      console.log("  writing");
      await dev.write("cjs.js", `let theExports = exports; theExports.field = "2";`);
    });
    console.log("  expecting message");
    await c.expectMessage({ field: "2" });
    console.log("Third");
    console.log("  expecting reload");
    await c.expectReload(async () => {
      console.log("  writing");
      await dev.write("cjs.js", `let theModule = module; theModule.exports.field = "3";`);
    });
    console.log("  expecting message");
    await c.expectMessage({ field: "3" });
    console.log("Fourth");
    await c.expectReload(async () => {
      await dev.write("cjs.js", `let { exports } = module; exports.field = "4";`);
    });
    await c.expectMessage({ field: "4" });
    console.log("Fifth");
    await c.expectReload(async () => {
      await dev.write("cjs.js", `var { exports } = module; exports.field = "4.5";`);
    });
    await c.expectMessage({ field: "4.5" });
    console.log("Sixth");
    await c.expectReload(async () => {
      await dev.write("cjs.js", `let theExports = module.exports; theExports.field = "5";`);
    });
    await c.expectMessage({ field: "5" });
    console.log("Seventh");
    await c.expectReload(async () => {
      await dev.write("cjs.js", `require; eval("module.exports.field = '6'");`);
    });
    await c.expectMessage({ field: "6" });
  },
});

// --- Barrel optimization tests ---

devTest("barrel optimization skips unused submodules", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Alpha } from 'barrel-lib';
      console.log('got: ' + Alpha);
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export { Alpha } from './alpha.js';
      export { Beta } from './beta.js';
      export { Gamma } from './gamma.js';
    `,
    "node_modules/barrel-lib/alpha.js": `export const Alpha = "ALPHA";`,
    "node_modules/barrel-lib/beta.js": `export const Beta = <<<SYNTAX_ERROR>>>;`,
    "node_modules/barrel-lib/gamma.js": `export const Gamma = <<<SYNTAX_ERROR>>>;`,
  },
  async test(dev) {
    // Beta.js and Gamma.js have syntax errors.
    // If barrel optimization works, they are never parsed, so no error.
    await using c = await dev.client("/");
    await c.expectMessage("got: ALPHA");
  },
});

devTest("barrel optimization: adding a new import triggers reload", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Alpha } from 'barrel-lib';
      console.log('result: ' + Alpha);
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export { Alpha } from './alpha.js';
      export { Beta } from './beta.js';
      export { Gamma } from './gamma.js';
    `,
    "node_modules/barrel-lib/alpha.js": `export const Alpha = "ALPHA";`,
    "node_modules/barrel-lib/beta.js": `export const Beta = "BETA";`,
    "node_modules/barrel-lib/gamma.js": `export const Gamma = "GAMMA";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("result: ALPHA");

    // Add a second import from the barrel — Beta was previously deferred,
    // now needs to be loaded. The barrel file should be re-bundled with
    // Beta un-deferred.
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
        import { Alpha, Beta } from 'barrel-lib';
        console.log('result: ' + Alpha + ' ' + Beta);
      `,
      );
    });
    await c.expectMessage("result: ALPHA BETA");

    // Add a third import
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
        import { Alpha, Beta, Gamma } from 'barrel-lib';
        console.log('result: ' + Alpha + ' ' + Beta + ' ' + Gamma);
      `,
      );
    });
    await c.expectMessage("result: ALPHA BETA GAMMA");
  },
});

devTest("barrel optimization: multi-file imports preserved across rebuilds", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Alpha } from 'barrel-lib';
      import { value } from './other';
      console.log('result: ' + Alpha + ' ' + value);
    `,
    "other.ts": `
      import { Beta } from 'barrel-lib';
      export const value = Beta;
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export { Alpha } from './alpha.js';
      export { Beta } from './beta.js';
      export { Gamma } from './gamma.js';
    `,
    "node_modules/barrel-lib/alpha.js": `export const Alpha = "ALPHA";`,
    "node_modules/barrel-lib/beta.js": `export const Beta = "BETA";`,
    "node_modules/barrel-lib/gamma.js": `export const Gamma = "GAMMA";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("result: ALPHA BETA");

    // Edit only other.ts to also import Gamma. Alpha (from index.ts) must
    // still be available even though index.ts is not re-parsed.
    await c.expectReload(async () => {
      await dev.write(
        "other.ts",
        `
        import { Beta, Gamma } from 'barrel-lib';
        export const value = Beta + ' ' + Gamma;
      `,
      );
    });
    await c.expectMessage("result: ALPHA BETA GAMMA");
  },
});

// A barrel that has deferred a re-export is bundled again by every build that reaches it. No save
// changed its file. When the dev server prints such a barrel as it was, a page that has it loaded
// keeps it as it is: it is not a changed module, and no importer has to accept it. A barrel that
// prints another definition (one more import, or one less) is a changed module, as before. So is
// a barrel that can have a copy of an export that a save changes.
const deferringBarrel = (name: string, exports: string[]) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({
    name,
    version: "1.0.0",
    main: "./index.js",
    sideEffects: false,
  }),
  // A comment is not a statement of the barrel.
  [`node_modules/${name}/index.js`]:
    `/** @license ${name} */\n` + exports.map(e => `export { ${e} } from './${e}.js';`).join("\n"),
  ...Object.fromEntries(
    exports.map(e => [`node_modules/${name}/${e}.js`, `export const ${e} = "${e.toUpperCase()}";`]),
  ),
});
const scriptOf = async (dev: Dev, route: string) =>
  (await dev.fetch(route).text()).match(/<script[^>]* src="([^"]+)"/)![1];
// A page that asked for a reload has no console.
const expectNoReload = async (client: Client) => {
  await client.drainAcks();
  expect(client.messages).toEqual([]);
  await client.js`console.log("no reload")`;
  await client.expectMessage("no reload");
};
// The first build of a route with no page of it. Each open page has the update of the build at
// the end, or is loaded again.
const firstBuild = async (dev: Dev, route: string) => {
  // A page that loaded again has its socket from here.
  await Promise.all([...dev.connectedClients].map(client => client.drainAcks()));
  const applied = dev.waitForHotReload(true);
  expect((await dev.fetch(route)).status).toBe(200);
  await applied;
};
// The open page has each module that the build of the route makes the barrel load. The barrel
// pass does not defer a re-export for /every and /star. It still bundles the barrel again.
// twice-lib has two statements for a.js, as rxjs and lodash-es have for some files. space-lib
// defers two namespaces, as lucide-react does for one. chain-lib re-exports from two-lib.
// Kind.js of enum-lib assigns its export again, as a compiled TypeScript enum does. The module
// has a getter for that export, and the getter only returns the variable of the module.
for (const [page, loaded, route, what] of [
  ["/first", "first: A", "/third", "the same export"],
  ["/all", "all: ABC", "/every", "every export"],
  ["/all", "all: ABC", "/star", "the barrel through export *"],
  ["/twice", "twice: A", "/again", "a barrel with two statements for one file"],
  ["/space", "space: A", "/room", "a barrel with a namespace that it does not load"],
  ["/chain", "chain: A", "/link", "a barrel with a copy of an export of another barrel"],
  ["/kind", "kind: a", "/sort", "a barrel with a copy of an export that its module assigns again"],
] as const) {
  devTest(`barrel optimization: the first build of a route that reads ${what} does not reload an open page`, {
    files: {
      ...Object.fromEntries(
        "first third all every star twice again space room chain link more kind sort"
          .split(" ")
          .map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
      ),
      "first.ts": `import { a } from 'two-lib'; console.log('first: ' + a);`,
      "third.ts": `import { a } from 'two-lib'; console.log('third: ' + a);`,
      "all.ts": `import * as lib from 'two-lib'; console.log('all: ' + lib.a + lib.b + lib.c);`,
      "every.ts": `import * as lib from 'two-lib'; console.log('every: ' + lib.a + lib.b + lib.c);`,
      "star.ts": `import { a } from 'star-lib'; console.log('star: ' + a);`,
      "twice.ts": `import { a } from 'twice-lib'; console.log('twice: ' + a);`,
      "again.ts": `import { a } from 'twice-lib'; console.log('again: ' + a);`,
      "space.ts": `import { a } from 'space-lib'; console.log('space: ' + a);`,
      "room.ts": `import { a } from 'space-lib'; console.log('room: ' + a);`,
      "more.ts": `
        import { a } from 'two-lib';
        import { a as twice } from 'twice-lib';
        import { a as space } from 'space-lib';
        import { a as chain } from 'chain-lib';
        import { Kind } from 'enum-lib';
        console.log('more: ' + a + twice + space + chain + Kind.A);
      `,
      "chain.ts": `import { a } from 'chain-lib'; console.log('chain: ' + a);`,
      "link.ts": `import { a } from 'chain-lib'; console.log('link: ' + a);`,
      "kind.ts": `import { Kind } from 'enum-lib'; console.log('kind: ' + Kind.A);`,
      "sort.ts": `import { Kind } from 'enum-lib'; console.log('sort: ' + Kind.A);`,
      ...deferringBarrel("two-lib", ["a", "b", "c"]),
      "node_modules/star-lib/package.json": JSON.stringify({
        name: "star-lib",
        version: "1.0.0",
        main: "./index.js",
        sideEffects: false,
      }),
      "node_modules/star-lib/index.js": `export * from 'two-lib';`,
      ...deferringBarrel("twice-lib", ["a", "b"]),
      "node_modules/twice-lib/index.js": `
        export { a } from './a.js';
        export { b } from './b.js';
        export { other } from './a.js';
      `,
      "node_modules/twice-lib/a.js": `export const a = "A"; export const other = "OTHER";`,
      ...deferringBarrel("space-lib", ["a", "b", "c"]),
      "node_modules/space-lib/index.js": `
        import * as c from './c.js';
        export { a } from './a.js';
        export * as b from './b.js';
        export { c };
      `,
      ...deferringBarrel("chain-lib", ["spare"]),
      "node_modules/chain-lib/index.js": `export { a } from 'two-lib';\nexport { spare } from './spare.js';`,
      ...deferringBarrel("enum-lib", ["Kind", "spare"]),
      "node_modules/enum-lib/Kind.js": `
        export var Kind;
        (function (Kind) { Kind["A"] = "a"; })(Kind || (Kind = {}));
      `,
    },
    async test(dev) {
      // two-lib defers a re-export in this build, so each later build bundles it again.
      expect((await dev.fetch("/first")).status).toBe(200);
      await using open = await dev.client(page);
      await open.expectMessage(loaded);
      const script = await scriptOf(dev, page);
      // Every open page gets the modules of this build, the barrel with them.
      await firstBuild(dev, route);
      await expectNoReload(open);
      // The page has applied that update, so it does the same for the next build.
      await firstBuild(dev, "/more");
      await expectNoReload(open);
      // The cached script of the page holds the barrel, and the builds did not change it.
      expect(await scriptOf(dev, page)).toBe(script);
    },
  });
}

// Each barrel imports the other one, and the build of /again prints both again as they were.
const cyclicBarrel = (name: string, own: string, other: string, from: string) => ({
  [`${name}/package.json`]: JSON.stringify({ name, sideEffects: false }),
  [`${name}/index.ts`]: `
    export { ${other} } from '../${from}';
    export { ${own} } from './${own}';
    export { spare } from './spare';
  `,
  [`${name}/${own}.ts`]: `export const ${own} = "${own.toUpperCase()}";`,
  [`${name}/spare.ts`]: `export const spare = "SPARE";`,
});
devTest("barrel optimization: the first build of a route does not reload a page for two barrels of one cycle", {
  files: {
    "cycle.html": emptyHtmlFile({ scripts: ["cycle.ts"] }),
    "again.html": emptyHtmlFile({ scripts: ["again.ts"] }),
    "cycle.ts": `import { b } from './lib-a'; import { a } from './lib-b'; console.log('cycle: ' + a + b);`,
    "again.ts": `import { b } from './lib-a'; import { a } from './lib-b'; console.log('again: ' + a + b);`,
    ...cyclicBarrel("lib-a", "a", "b", "lib-b"),
    ...cyclicBarrel("lib-b", "b", "a", "lib-a"),
  },
  async test(dev) {
    await using open = await dev.client("/cycle");
    await open.expectMessage("cycle: AB");
    await firstBuild(dev, "/again");
    await expectNoReload(open);
  },
});

const appBarrel = {
  "lib/package.json": JSON.stringify({ name: "app-lib", sideEffects: false }),
  "lib/index.ts": `export { a } from './a'; export { b } from './b'; export { c } from './c';`,
  "lib/a.ts": `export const a = "A";`,
  "lib/b.ts": `export const b = "B";`,
  "lib/c.ts": `export const c = "C";`,
};

// main.ts has no accept boundary. The build of a save of comp.ts bundles the barrel again, which
// main.ts also imports.
devTest("barrel optimization: a save of a module that accepts itself does not reload the page", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["main.ts"] }),
    "main.ts": `
      import { a } from 'two-lib';
      import './comp';
      console.log('main: ' + a);
    `,
    "comp.ts": `
      import { b } from 'two-lib';
      console.log('comp: ' + b);
      import.meta.hot.accept();
    `,
    ...deferringBarrel("two-lib", ["a", "b", "c"]),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("comp: B", "main: A");
    await dev.patch("comp.ts", { find: "comp: ", replace: "saved: " });
    // A reload would also run main.ts again.
    await c.expectMessage("saved: B");
    await expectNoReload(c);
  },
});

// lib/a.ts imports the barrel that re-exports it, so the build of its save bundles the barrel
// again. The barrel has no copy of an export: it reads lib/a.ts when a module asks for one. The
// update of lib/a.ts is for lib/a.ts, which accepts it, and not for a module that accepts the
// barrel.
const cyclicLeaf = (text: string) => `
  import { b } from './index';
  export const a = "${text}";
  export const readB = () => b;
  import.meta.hot.accept();
`;
devTest("barrel optimization: a save of a module that the barrel re-exports does not reload the page", {
  files: {
    "plain.html": emptyHtmlFile({ scripts: ["main.ts"] }),
    "accepting.html": emptyHtmlFile({ scripts: ["accepting.ts"] }),
    "main.ts": `import { a } from './lib'; globalThis.read = () => a; console.log('main: ' + a);`,
    "accepting.ts": `
      import { a } from './lib';
      globalThis.read = () => a;
      console.log('accepting: ' + a);
      import.meta.hot.accept('./lib', () => console.log('accepted'));
    `,
    ...appBarrel,
    "lib/a.ts": cyclicLeaf("A"),
  },
  async test(dev) {
    // The save is the one build that a page sees.
    expect((await dev.fetch("/plain")).status).toBe(200);
    expect((await dev.fetch("/accepting")).status).toBe(200);
    await using c = await dev.client("/plain");
    await c.expectMessage("main: A");
    await using accepting = await dev.client("/accepting");
    await accepting.expectMessage("accepting: A");
    await dev.write("lib/a.ts", cyclicLeaf("saved"));
    for (const page of [c, accepting]) {
      expect(await page.js<string>`read()`).toBe("saved");
      await expectNoReload(page);
    }
  },
});

const acceptingImporter = (name: string) => `
  import { a } from 'two-lib';
  console.log('${name}: ' + a);
  import.meta.hot.dispose(() => console.log('dispose ${name}'));
  import.meta.hot.accept();
`;
devTest("barrel optimization: a save of a module does not run another importer of the barrel again", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `import './one'; import './two';`,
    "one.ts": acceptingImporter("one"),
    "two.ts": acceptingImporter("two"),
    ...deferringBarrel("two-lib", ["a", "b"]),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("one: A", "two: A");
    await dev.patch("one.ts", { find: "one: ", replace: "saved: " });
    await c.expectMessage("dispose one", "saved: A");
    await expectNoReload(c);
  },
});

// The callback is for a change of the barrel. The builds of /third and /again make none, and the
// build of /second makes the barrel load lib/b.ts.
devTest("barrel optimization: a module that accepts a barrel is called only when the barrel changed", {
  files: {
    ...Object.fromEntries(
      ["first", "second", "third", "again"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `
      import { a } from './lib';
      console.log('first: ' + a);
      import.meta.hot.accept('./lib', lib => console.log('accepted: ' + lib.a));
    `,
    "second.ts": `import { b } from './lib'; console.log('second: ' + b);`,
    "third.ts": `import { a } from './lib'; console.log('third: ' + a);`,
    "again.ts": `import { a } from './lib'; console.log('again: ' + a);`,
    ...appBarrel,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    await firstBuild(dev, "/third");
    await expectNoReload(first);
    await firstBuild(dev, "/second");
    await first.expectMessage("accepted: A");
    await firstBuild(dev, "/again");
    await expectNoReload(first);
  },
});

// The file imports what it imported. A page that keeps it as it is would not run its dispose
// handler.
devTest("barrel optimization: a file of re-exports with statements of its own is a changed module", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "first.ts": `import { a } from './lib'; console.log('first: ' + a);`,
    "third.ts": `import { a } from './lib'; console.log('third: ' + a);`,
    ...appBarrel,
    "lib/index.ts": `
      ${appBarrel["lib/index.ts"]}
      import.meta.hot.dispose(() => console.log('dispose lib'));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    await using third = await dev.client("/third");
    await third.expectMessage("third: A");
    await first.expectMessage("dispose lib");
  },
});

// Each of these builds bundles the barrel again, and each time it is a changed module for the
// page: index.ts does not accept it.
devTest("barrel optimization: a barrel that changed reloads a page with no accept boundary", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `import './comp'; import { a } from './lib'; console.log('index: ' + a);`,
    "comp.ts": `import { a } from './lib'; console.log('comp: ' + a); import.meta.hot.accept();`,
    ...appBarrel,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("comp: A", "index: A");
    // A save of the barrel.
    await c.expectReload(async () => {
      await dev.write("lib/index.ts", appBarrel["lib/index.ts"] + " // saved");
    });
    await c.expectMessage("comp: A", "index: A");
    // A re-export that resolves to another file.
    await c.expectReload(async () => {
      await using batch = await dev.batchChanges();
      fs.renameSync(dev.join("lib/a.ts"), dev.join("lib/a.tsx"));
    });
    await c.expectMessage("comp: A", "index: A");
    // A save gives the file an export of its own. The dev server still bundles it in every build.
    await c.expectReload(async () => {
      await dev.write("lib/index.ts", appBarrel["lib/index.ts"] + " export const own = 1;");
    });
    await c.expectMessage("comp: A", "index: A");
    await c.expectReload(async () => {
      await dev.patch("comp.ts", { find: "comp: ", replace: "saved: " });
    });
    await c.expectMessage("saved: A", "index: A");
  },
});

// A saved file is a changed module, also when the save leaves its text as it was.
devTest("barrel optimization: a save of a barrel with the same text reloads an open page", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `import { a, b, c } from './lib'; console.log('index: ' + a + b + c);`,
    ...appBarrel,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("index: ABC");
    await c.expectReload(async () => {
      await dev.write("lib/index.ts", appBarrel["lib/index.ts"]);
    });
    await c.expectMessage("index: ABC");
  },
});

// A saved barrel is an entry point of its build, and that build prints each re-export: here the
// second statement for lib/a.ts too. The build of /third prints the barrel as an import again,
// as it was before the save. That is another print than the last one, so the page gets a new
// script, and keeps the barrel from there.
devTest("barrel optimization: a page keeps a barrel again after the build that follows its save", {
  files: {
    ...Object.fromEntries(
      ["first", "third", "again"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `import { a, b, c } from './lib'; console.log('first: ' + a + b + c);`,
    "third.ts": `import { a, b, c } from './lib'; console.log('third: ' + a + b + c);`,
    "again.ts": `import { a, b, c } from './lib'; console.log('again: ' + a + b + c);`,
    ...appBarrel,
    "lib/index.ts": `${appBarrel["lib/index.ts"]} export { other } from './a.ts';`,
    "lib/a.ts": `export const a = "A"; export const other = "OTHER";`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: ABC");
    await first.expectReload(async () => {
      await dev.write("lib/index.ts", `${appBarrel["lib/index.ts"]} export { other } from './a.ts';`);
    });
    await first.expectMessage("first: ABC");
    await first.expectReload(async () => {
      await firstBuild(dev, "/third");
    });
    await first.expectMessage("first: ABC");
    await firstBuild(dev, "/again");
    await expectNoReload(first);
  },
});

// The barrel has a statement of its own for one build, and then the text that it had.
devTest("barrel optimization: a barrel in node_modules that had a statement of its own is a changed module", {
  files: {
    ...Object.fromEntries(
      ["first", "second", "third"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `import { a } from 'two-lib'; console.log('first: ' + a);`,
    "second.ts": `import { a } from 'two-lib'; console.log('second: ' + a);`,
    "third.ts": `import { a } from 'two-lib'; console.log('third: ' + a);`,
    ...deferringBarrel("two-lib", ["a", "b"]),
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    const barrel = dev.read("node_modules/two-lib/index.js");
    fs.writeFileSync(dev.join("node_modules/two-lib/index.js"), barrel + `\nconsole.log("barrel");`);
    await first.expectReload(async () => {
      await firstBuild(dev, "/second");
    });
    await first.expectMessage("barrel", "first: A");
    fs.writeFileSync(dev.join("node_modules/two-lib/index.js"), barrel);
    await first.expectReload(async () => {
      await firstBuild(dev, "/third");
    });
    await first.expectMessage("first: A");
  },
});

// `./a` of the barrel is lib/a.tsx. lib/a.ts is in the graph too: pin.ts imports it with its
// extension. The build after the delete of lib/a.tsx prints the barrel with the text and the live
// re-exports that it had, and with lib/a.ts for `./a`.
devTest("barrel optimization: a barrel that imports another file for a re-export reloads an open page", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "first.ts": `import { a } from './lib'; import './pin'; console.log('first: ' + a);`,
    "pin.ts": `import { marker } from './lib/a.ts'; console.log('pin: ' + marker);`,
    "lib/package.json": JSON.stringify({ name: "app-lib", sideEffects: false }),
    "lib/index.ts": `export { a } from './a'; export { z } from './z';`,
    "lib/a.tsx": `export const a = "A of a.tsx";`,
    "lib/a.ts": `export const a = "A of a.ts"; export const marker = "M";`,
    "lib/z.ts": `export const z = "Z";`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("pin: M", "first: A of a.tsx");
    await first.expectReload(async () => {
      await using batch = await dev.batchChanges();
      fs.rmSync(dev.join("lib/a.tsx"));
    });
    await first.expectMessage("pin: M", "first: A of a.ts");
  },
});

// The save changes what the server renders for the page. The update has the page module for the
// browser too, so the framework does not load the page again, and the page shows what the server
// rendered before. The build of /other prints the barrel as it was. The page can be out of date,
// so it does not keep the barrel: it loads again, as before.
const loaderPage = (props: string) => `
  export const loader = () => "${props}";
  export default function page() {}
  import.meta.hot.accept();
`;
devTest("barrel optimization: a page that got a server-side update of its route does not keep a barrel", {
  framework: {
    fileSystemRouterTypes: [
      {
        root: "pages",
        style: "nextjs-pages",
        serverEntryPoint: "./render/server.ts",
        clientEntryPoint: "./render/client.ts",
        extensions: [".ts"],
        clientPages: { serverExports: ["loader"] },
      },
    ],
  },
  files: {
    "render/server.ts": `
      export function render(request, meta) {
        const scripts = meta.modules.map(src => '<script type="module" src="' + src + '"></script>').join('');
        const body = '<p id="props">' + meta.pageModule.loader() + '</p>' + scripts;
        return new Response('<!doctype html><html><head></head><body>' + body + '</body></html>', {
          headers: { 'content-type': 'text/html' },
        });
      }
    `,
    "render/client.ts": `
      import { route, onServerSideReload } from "bun:bake/client";
      import { a } from '../lib';
      await route.page();
      console.log('client: ' + document.getElementById('props').textContent + ' ' + a);
      onServerSideReload(({ clientCodeChanged }) => {
        console.log('server-side reload');
        if (!clientCodeChanged) location.reload();
      });
    `,
    "pages/index.ts": loaderPage("first"),
    "pages/other.ts": `
      import { a } from '../lib';
      export const loader = () => "other";
      export default function page() {
        return a;
      }
    `,
    ...appBarrel,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("client: first A");
    await dev.write("pages/index.ts", loaderPage("saved"));
    await c.expectMessage("server-side reload");
    await c.expectReload(async () => {
      await firstBuild(dev, "/other");
    });
    await c.expectMessage("client: saved A");
  },
});

// A file in node_modules has no watcher. A build that reaches the barrel reads its file again.
devTest("barrel optimization: a barrel in node_modules with another text reloads an open page", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "first.ts": `import { a } from 'two-lib'; console.log('first: ' + a);`,
    "third.ts": `import { a } from 'two-lib'; console.log('third: ' + a);`,
    ...deferringBarrel("two-lib", ["a", "b"]),
    "node_modules/two-lib/a.js": `export const a = "A"; export const a2 = "A2";`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    fs.writeFileSync(
      dev.join("node_modules/two-lib/index.js"),
      `export { a2 as a } from './a.js';\nexport { b } from './b.js';`,
    );
    await first.expectReload(async () => {
      await using third = await dev.client("/third");
      await third.expectMessage("third: A2");
    });
    await first.expectMessage("first: A2");
  },
});

// The build of /third does not know that first.ts reads every export, and bundles the barrel
// with a only (#46648). The page of /first has a module that can read b, so the barrel is a
// changed module for it.
devTest("barrel optimization: a barrel that loads less reloads an open page", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "first.ts": `import * as lib from 'two-lib'; console.log('first: ' + lib.a);`,
    "second.ts": `import { a } from 'two-lib'; console.log('second: ' + a);`,
    "third.ts": `import { a } from 'two-lib'; console.log('third: ' + a);`,
    ...deferringBarrel("two-lib", ["a", "b", "c"]),
  },
  async test(dev) {
    // The barrel defers b and c for this build, so every later build bundles it again.
    expect((await dev.fetch("/second")).status).toBe(200);
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    await first.expectReload(async () => {
      await firstBuild(dev, "/third");
    });
    await first.expectMessage("first: A");
  },
});

// Each module of ui-lib has a stylesheet.
const uiLib = {
  ...deferringBarrel("ui-lib", ["a", "b", "c"]),
  ...Object.fromEntries(
    ["a", "b", "c"].flatMap(e => [
      [`node_modules/ui-lib/${e}.js`, `import './${e}.css'; export const ${e} = "${e.toUpperCase()}";`],
      [`node_modules/ui-lib/${e}.css`, `.${e} { color: red; }`],
    ]),
  ),
};
// b.js is new to the page of /first. The page gets its stylesheet when it loads again. The page
// then has all that the barrel loads, so the next build does not reload it.
devTest("barrel optimization: a barrel that loads one more module reloads an open page once", {
  files: {
    ...Object.fromEntries(
      ["first", "second", "third"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `import { a } from 'ui-lib'; console.log('first: ' + a);`,
    "second.ts": `import { b } from 'ui-lib'; console.log('second: ' + b);`,
    "third.ts": `import { b } from 'ui-lib'; console.log('third: ' + b);`,
    ...uiLib,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    await first.expectReload(async () => {
      await using second = await dev.client("/second");
      await second.expectMessage("second: B");
    });
    await first.expectMessage("first: A");
    // The page answers when its stylesheets are loaded.
    await first.drainAcks();
    await first.style(".b").color.expect.toBe("red");
    await using third = await dev.client("/third");
    await third.expectMessage("third: B");
    await expectNoReload(first);
  },
});

// lib/b.ts imports helper.ts, a module of the build of /other, which the page of /first did not
// get. A page that evaluates lib/b.ts with no reload fails to load helper.ts.
devTest("barrel optimization: a barrel that loads a module with an import of an earlier build reloads an open page", {
  files: {
    ...Object.fromEntries(
      ["first", "second", "other"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `import { a } from './lib'; console.log('first: ' + a);`,
    "second.ts": `import { b } from './lib'; console.log('second: ' + b);`,
    "other.ts": `import { help } from './helper'; console.log('other: ' + help);`,
    "helper.ts": `export const help = "HELP";`,
    ...appBarrel,
    "lib/b.ts": `import { help } from '../helper'; export const b = "B " + help;`,
  },
  async test(dev) {
    expect((await dev.fetch("/other")).status).toBe(200);
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    await first.expectReload(async () => {
      await using second = await dev.client("/second");
      await second.expectMessage("second: B HELP");
    });
    await first.expectMessage("first: A");
  },
});

// The barrel has two statements for a.js, with two spellings of its path. The build of /second
// makes it print the second one. It imports the same files as before, and its definition is
// another one, so it is a changed module and the dev server prints the script of /first again.
devTest("barrel optimization: a barrel that prints one more statement for a file reloads an open page", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
    "first.ts": `import { a } from 'dup-lib'; console.log('first: ' + a);`,
    "second.ts": `import { other } from 'dup-lib'; console.log('second: ' + other);`,
    ...deferringBarrel("dup-lib", ["a", "b"]),
    "node_modules/dup-lib/index.js": `
      export { a } from './a.js';
      export { b } from './b.js';
      export { other } from './a';
    `,
    "node_modules/dup-lib/a.js": `export const a = "A"; export const other = "OTHER";`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    const script = await scriptOf(dev, "/first");
    await first.expectReload(async () => {
      await using second = await dev.client("/second");
      await second.expectMessage("second: OTHER");
    });
    await first.expectMessage("first: A");
    expect(await scriptOf(dev, "/first")).not.toBe(script);
  },
});

// lib/a.ts is loading when the build of /third arrives: the page started it for starter.ts, and
// the barrel did not wait for it. A barrel with an import that is not loaded is a changed module.
devTest("barrel optimization: a build that arrives while a module of the barrel is loading reloads the page", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "first.ts": `import './starter'; import { a } from './lib'; console.log('first: ' + a);`,
    "starter.ts": `import './lib/a';`,
    "third.ts": `import { a } from './lib'; console.log('third: ' + a);`,
    ...appBarrel,
    "lib/a.ts": `export const a = await new Promise(() => {});`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectReload(async () => {
      await firstBuild(dev, "/third");
    });
  },
});

// The page is still applying the save of slow.ts when the build of /third arrives.
const slowModule = (text: string) => `
  console.log('${text} waits');
  await globalThis.gate;
  console.log('${text} is done');
  import.meta.hot.accept();
`;
devTest("barrel optimization: a build that arrives while the page applies another update does not reload it", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "first.ts": `import './slow'; import { a } from 'two-lib'; console.log('first: ' + a);`,
    "slow.ts": slowModule("slow"),
    "third.ts": `import { a } from 'two-lib'; console.log('third: ' + a);`,
    ...deferringBarrel("two-lib", ["a", "b", "c"]),
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("slow waits", "slow is done", "first: A");
    await first.js`globalThis.gate = new Promise(resolve => (globalThis.open = resolve));`;
    // The page answers for this save when slow.ts is loaded.
    const saved = dev.write("slow.ts", slowModule("saved"));
    saved.catch(() => {});
    await first.expectMessage("saved waits");
    // The page has the update of this build before the gate opens.
    const applied = dev.waitForHotReload(true);
    expect((await dev.fetch("/third")).status).toBe(200);
    await applied;
    await first.js`open()`;
    await first.expectMessage("saved is done");
    await saved;
    await expectNoReload(first);
  },
});

// The update of the batch waits in the dispose handler of closer.ts. It has a barrel that imports
// lib/b.ts, and the page did not load that barrel yet. The build of /third prints the barrel as
// it was, and the page loads it with user.ts, which accepts the update.
const seenByWatcher = (dev: Dev) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  dev.on("watch_synchronization", function onEvent(event: WatchSynchronization) {
    if (event !== WatchSynchronization.SeenFiles) return;
    dev.off("watch_synchronization", onEvent);
    resolve();
  });
  return promise;
};
const closingModule = (text: string) => `
  console.log('${text}');
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    console.log('closer waits');
    return globalThis.gate;
  });
`;
const barrelUser = (text: string, imports: string) => `
  import { ${imports} } from './lib';
  globalThis.read = () => [${imports}].join('');
  console.log('${text}');
  import.meta.hot.accept();
`;
devTest("barrel optimization: a page loads a barrel that an update in wait did not load", {
  files: {
    "main.html": emptyHtmlFile({ scripts: ["main.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "main.ts": `import './closer'; import './user';`,
    "closer.ts": closingModule("closer"),
    "user.ts": barrelUser("user", "a"),
    "third.ts": `import { a, b } from './lib'; console.log('third: ' + a + b);`,
    ...appBarrel,
  },
  async test(dev) {
    await using c = await dev.client("/main");
    await c.expectMessage("closer", "user");
    await c.js`globalThis.gate = new Promise(resolve => (globalThis.open = resolve));`;
    // One build for the two saves: the watcher has the first file before the second save.
    const batch = (await dev.batchChanges())!;
    const seen = seenByWatcher(dev);
    await dev.write("closer.ts", closingModule("closer again"));
    await seen;
    await dev.write("user.ts", barrelUser("more", "a, b"));
    // The page answers for this build when the gate is open.
    const applied = batch[Symbol.asyncDispose]();
    applied.catch(() => {});
    await c.expectMessage("closer waits");
    expect((await dev.fetch("/third")).status).toBe(200);
    await c.expectMessage("more");
    expect(await c.js<string>`read()`).toBe("AB");
    await c.js`open()`;
    await c.expectMessageInAnyOrder("closer again", "more");
    await applied;
  },
});

// An update does not have a stylesheet that an earlier build printed, so the page of /first
// lacks the one of m.ts after the save of widget.ts. A page gets it when it loads again, and the
// build of /third is a reason to do that, as before.
devTest("barrel optimization: a build reloads a page that lacks a stylesheet", {
  files: {
    ...Object.fromEntries(
      ["first", "third", "other"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `import { a } from 'two-lib'; import './widget'; console.log('first: ' + a);`,
    "widget.ts": `console.log('widget: none'); import.meta.hot.accept();`,
    "third.ts": `import { a } from 'two-lib'; console.log('third: ' + a);`,
    "other.ts": `import { m } from './m'; console.log('other: ' + m);`,
    "m.ts": `import './m.css'; export const m = "M";`,
    "m.css": `.m { color: red; }`,
    ...deferringBarrel("two-lib", ["a", "b", "c"]),
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("widget: none", "first: A");
    await firstBuild(dev, "/other");
    await dev.write("widget.ts", `import { m } from './m'; console.log('widget: ' + m); import.meta.hot.accept();`);
    await first.expectMessage("widget: M");
    await first.expectReload(async () => {
      await firstBuild(dev, "/third");
    });
    await first.expectMessage("widget: M", "first: A");
    // The page answers when its stylesheets are loaded.
    await first.drainAcks();
    await first.style(".m").color.expect.toBe("red");
  },
});

// The page got the content of widget.css with the update that added it, so it lacks nothing.
devTest("barrel optimization: a page that got a stylesheet with an update keeps a barrel", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "first.ts": `import { a } from 'two-lib'; import './widget'; console.log('first: ' + a);`,
    "widget.ts": `console.log('widget: none'); import.meta.hot.accept();`,
    "widget.css": `.w { color: red; }`,
    "third.ts": `import { a } from 'two-lib'; console.log('third: ' + a);`,
    ...deferringBarrel("two-lib", ["a", "b", "c"]),
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("widget: none", "first: A");
    await dev.write("widget.ts", `import './widget.css'; console.log('widget: css'); import.meta.hot.accept();`);
    await first.expectMessage("widget: css");
    await first.style(".w").color.expect.toBe("red");
    await firstBuild(dev, "/third");
    await expectNoReload(first);
  },
});

// The route of the page has the stylesheet of m.ts for one save only. The page never got its
// content, and lacks nothing when the route has it no more.
devTest("barrel optimization: a page whose route lost the stylesheet that it lacked keeps a barrel", {
  files: {
    ...Object.fromEntries(
      ["first", "third", "other"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `import { a } from 'two-lib'; import './widget'; console.log('first: ' + a);`,
    "widget.ts": `console.log('widget: none'); import.meta.hot.accept();`,
    "third.ts": `import { a } from 'two-lib'; console.log('third: ' + a);`,
    "other.ts": `import { m } from './m'; console.log('other: ' + m);`,
    "m.ts": `import './m.css'; export const m = "M";`,
    "m.css": `.m { color: red; }`,
    ...deferringBarrel("two-lib", ["a", "b", "c"]),
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("widget: none", "first: A");
    await firstBuild(dev, "/other");
    await dev.write("widget.ts", `import { m } from './m'; console.log('widget: ' + m); import.meta.hot.accept();`);
    await first.expectMessage("widget: M");
    await dev.write("widget.ts", `console.log('widget: none again'); import.meta.hot.accept();`);
    await first.expectMessage("widget: none again");
    await firstBuild(dev, "/third");
    await expectNoReload(first);
  },
});

// `export *` copies the exports of x.ts when the barrel is evaluated, and a save can change
// x.ts. The dev server does not list such a barrel: it is a changed module, as before.
const starBarrel = {
  "lib/package.json": JSON.stringify({ name: "app-lib", sideEffects: false }),
  "lib/index.ts": `export * from './x'; export { y } from './y'; export { z } from './z';`,
  "lib/x.ts": `import { y } from './index'; export const v = 1; export const readY = () => y;`,
  "lib/y.ts": `export const y = "Y";`,
  "lib/z.ts": `export const z = "Z";`,
};
const starTarget = (v: number) => `import { y } from './index'; export const v = ${v}; export const readY = () => y;`;
devTest("barrel optimization: a barrel with export * copies a saved module that imports the barrel", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["main.ts"] }),
    "main.ts": `
      import { v, readY } from './lib';
      globalThis.read = () => v + ' ' + readY();
      console.log('main');
      import.meta.hot.accept();
    `,
    ...starBarrel,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("main");
    expect(await c.js<string>`read()`).toBe("1 Y");
    await dev.write("lib/x.ts", starTarget(2));
    await c.expectMessage("main");
    expect(await c.js<string>`read()`).toBe("2 Y");
  },
});

// The copy in the outer barrel is of an export that lib/index.ts reads from lib/e.ts when a
// module asks for it. lib/e.ts imports the outer barrel, so the build of its save prints that
// barrel again as it was. The dev server lists neither outer barrel: the one outside
// node_modules has `export *`, and the one in node_modules imports a file outside.
const copiedLeaf = (text: string, from: string) => `
  import { spare } from '${from}';
  export const e = "${text}";
  export const readSpare = () => spare;
`;
const copyReader = (from: string) => `
  import { e } from '${from}';
  globalThis.read = () => e;
  console.log('main');
  import.meta.hot.accept();
`;
for (const [where, from, barrel] of [
  ["outside node_modules", "./outer", "outer/index.ts"],
  ["in node_modules", "outer-lib", "node_modules/outer-lib/index.js"],
] as const) {
  devTest(`barrel optimization: a barrel ${where} copies a module below a barrel that a save changed`, {
    files: {
      "index.html": emptyHtmlFile({ scripts: ["main.ts"] }),
      "main.ts": copyReader(from),
      "outer/package.json": JSON.stringify({ name: "outer", sideEffects: false }),
      ...deferringBarrel("outer-lib", ["spare", "rest"]),
      [barrel]:
        where === "in node_modules"
          ? `export { e } from '../../lib/index.ts';\nexport { spare } from './spare.js';\nexport { rest } from './rest.js';`
          : `export * from '../lib'; export { spare } from './spare'; export { rest } from './rest';`,
      "outer/spare.ts": `export const spare = "SPARE";`,
      "outer/rest.ts": `export const rest = "REST";`,
      ...appBarrel,
      "lib/index.ts": `export { e } from './e'; export { b } from './b';`,
      "lib/e.ts": copiedLeaf("first", where === "in node_modules" ? "outer-lib" : "../outer"),
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("main");
      expect(await c.js<string>`read()`).toBe("first");
      await dev.write("lib/e.ts", copiedLeaf("saved", where === "in node_modules" ? "outer-lib" : "../outer"));
      await c.expectMessage("main");
      expect(await c.js<string>`read()`).toBe("saved");
    },
  });
}

// The barrel imports lib/a.ts with two statements. An update of lib/a.ts gives its exports to the
// first one only, so the page does not keep such a barrel.
devTest("barrel optimization: a barrel with two imports of one file is a changed module", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "first.ts": `import { a, other } from './lib'; console.log('first: ' + a + other);`,
    "third.ts": `import { a, other } from './lib'; console.log('third: ' + a + other);`,
    ...appBarrel,
    "lib/index.ts": `${appBarrel["lib/index.ts"]} export { other } from './a.ts';`,
    "lib/a.ts": `export const a = "A"; export const other = "OTHER";`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: AOTHER");
    await first.expectReload(async () => {
      await firstBuild(dev, "/third");
    });
    await first.expectMessage("first: AOTHER");
  },
});

// value.cjs logs each read of its export. first.ts accepts an update, so the page stays. When
// the barrel is a changed module, first.ts runs again and the page has one more read of the
// export. To compare a barrel with its new definition, a page evaluates the definition. There it
// gets a revoked Proxy in place of the exports of a CommonJS module, because a read of one can run
// code of that module. A copy of an export throws on the Proxy, and the Proxy is not the namespace
// that the barrel has. So a barrel in node_modules with a CommonJS import is a changed module.
const loggedExport = (value: string) => `
  let reads = 0;
  Object.defineProperty(exports, "value", {
    enumerable: true,
    configurable: true,
    get() {
      console.log("read " + ++reads);
      return "${value}";
    },
  });
`;
const barrelOfCommonJS = (reexport: string, name: string, use: string) => ({
  "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
  "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
  "first.ts": `import { ${name} } from 'cjs-lib'; console.log('first: ' + ${use}); import.meta.hot.accept();`,
  "third.ts": `import { ${name} } from 'cjs-lib'; console.log('third: ' + ${use});`,
  ...deferringBarrel("cjs-lib", ["spare"]),
  "node_modules/cjs-lib/index.js": `${reexport}\nexport { spare } from './spare.js';`,
  "node_modules/cjs-lib/value.cjs": loggedExport("V"),
});
const loadsOneTime = async (dev: Dev) => {
  await using first = await dev.client("/first");
  await first.expectMessage("read 1", "first: V");
  await firstBuild(dev, "/third");
  await first.expectMessage("read 2", "first: V");
};
for (const [what, reexport, name, use] of [
  ["a copy of an export", `export { value } from './value.cjs';`, "value", "value"],
  ["a copy of each export", `export * from './value.cjs';`, "value", "value"],
  ["the namespace", `export * as ns from './value.cjs';`, "ns", "ns.value"],
] as const) {
  devTest(`barrel optimization: a barrel in node_modules with ${what} of a CommonJS module is a changed module`, {
    files: barrelOfCommonJS(reexport, name, use),
    test: loadsOneTime,
  });
}

// The module of the plugin is no file in node_modules, so its re-export of value.cjs is a getter.
// A barrel in node_modules has a copy of that export. A read of it for a check runs the getter,
// and with it the code of value.cjs. The dev server does not list such a barrel.
devTest("barrel optimization: a barrel with a copy of an export of a plugin module is a changed module", {
  files: {
    ...barrelOfCommonJS(`export { value } from 'virtual:value';`, "value", "value"),
    "bunfig.toml": `
      [serve.static]
      plugins = ["./virtual-plugin.ts"]
    `,
    "virtual-plugin.ts": `
      import path from "node:path";
      const target = path.join(import.meta.dirname, "node_modules/cjs-lib/value.cjs");
      export default {
        name: "virtual",
        setup(build) {
          build.onResolve({ filter: /^virtual:value$/ }, () => ({ path: "value", namespace: "virtual" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
            contents: "export { value } from " + JSON.stringify(target) + ";",
            loader: "js",
          }));
        },
      };
    `,
  },
  test: loadsOneTime,
});

// A barrel that the dev server lists outside node_modules has a getter for each export, and reads
// none when it evaluates.
devTest("barrel optimization: a page keeps a barrel with a getter for an export of a CommonJS module", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "first.ts": `
      import { value } from './lib';
      globalThis.read = () => value;
      console.log('first: ' + value);
      import.meta.hot.accept();
    `,
    "third.ts": `import { value } from './lib'; console.log('third: ' + value);`,
    ...appBarrel,
    "lib/index.ts": `export { value } from './value.cjs'; export { b } from './b';`,
    "lib/value.cjs": loggedExport("V"),
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("read 1", "first: V");
    await firstBuild(dev, "/third");
    // The update read no export of value.cjs, and first.ts did not run again.
    await expectNoReload(first);
    expect(await first.js<string>`read()`).toBe("V");
    await first.expectMessage("read 2");
    // The barrel that the page kept reads the module that a save loads again.
    await dev.write("lib/value.cjs", loggedExport("saved"));
    await first.expectMessage("read 1", "first: saved");
    expect(await first.js<string>`read()`).toBe("saved");
    await first.expectMessage("read 2");
  },
});

// outer-lib has a copy of the export of mid-lib, which has a copy of the one of two-lib. A file
// in node_modules has no watcher, and a build that reaches a barrel there reads its file again.
const copyingBarrel = (name: string, inner: string) => ({
  ...deferringBarrel(name, ["spare"]),
  [`node_modules/${name}/index.js`]: `export { a } from '${inner}';\nexport { spare } from './spare.js';`,
});
const renamedExport = `export { a2 as a } from './a.js';\nexport { b } from './b.js';`;
// The build of /third reads the new file of two-lib, and prints the other two barrels as they
// were. Each has a copy of a module that loads again, so first.ts gets the update of outer-lib.
devTest("barrel optimization: a barrel with a copy of a barrel that changed is a changed module", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "third.html": emptyHtmlFile({ scripts: ["third.ts"] }),
    "first.ts": `
      import { a } from 'outer-lib';
      console.log('first: ' + typeof a);
      import.meta.hot.accept();
      import.meta.hot.accept('outer-lib', () => console.log('outer-lib changed'));
    `,
    "third.ts": `import { a } from 'outer-lib'; console.log('third: ' + a);`,
    ...copyingBarrel("outer-lib", "mid-lib"),
    ...copyingBarrel("mid-lib", "two-lib"),
    ...deferringBarrel("two-lib", ["a", "b"]),
    "node_modules/two-lib/a.js": `export const a = "A"; export const a2 = "A2";`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: string");
    fs.writeFileSync(dev.join("node_modules/two-lib/index.js"), renamedExport);
    await firstBuild(dev, "/third");
    await first.expectMessage("first: string", "outer-lib changed");
  },
});

// The build of /direct reads the new file of mid-lib and has no outer-lib in it, so the copy in
// outer-lib stays, as before. The build of /third prints both barrels as they were, and that
// copy is out of date.
devTest("barrel optimization: a barrel with a copy that is out of date is a changed module", {
  files: {
    ...Object.fromEntries(
      ["first", "direct", "third"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `
      import { a } from 'outer-lib';
      globalThis.read = () => a;
      console.log('first');
      import.meta.hot.accept();
    `,
    "direct.ts": `import { a } from 'mid-lib'; console.log('direct: ' + a);`,
    "third.ts": `import { a } from 'outer-lib'; console.log('third: ' + a);`,
    ...copyingBarrel("outer-lib", "mid-lib"),
    ...deferringBarrel("mid-lib", ["a", "b"]),
    "node_modules/mid-lib/a.js": `export const a = "A"; export const a2 = "A2";`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first");
    expect(await first.js<string>`read()`).toBe("A");
    fs.writeFileSync(dev.join("node_modules/mid-lib/index.js"), renamedExport);
    await firstBuild(dev, "/direct");
    await first.expectMessage("first");
    await firstBuild(dev, "/third");
    await first.expectMessage("first");
    expect(await first.js<string>`read()`).toBe("A2");
  },
});

// star-lib copies each export of inner-lib when it is evaluated. The build of /more reads the new
// file of inner-lib and has no star-lib in it, so star-lib has no x2, as before. The build of
// /third prints both barrels as they were, and the new definition of star-lib evaluates to a
// name that the barrel of the page does not have.
devTest("barrel optimization: a barrel that lacks a name of its new definition is a changed module", {
  files: {
    ...Object.fromEntries(
      ["first", "direct", "more", "third"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `
      import { x1 } from 'star-lib';
      if (!globalThis.names) console.log('first: ' + x1);
      globalThis.names ??= 'none';
      import.meta.hot.accept();
      import.meta.hot.accept('star-lib', lib => (globalThis.names = Object.keys(lib).sort().join(',')));
    `,
    "direct.ts": `import { x1 } from 'inner-lib'; console.log('direct: ' + x1);`,
    "more.ts": `import { x1, x2, spare } from 'inner-lib'; console.log('more: ' + x1 + x2 + spare);`,
    "third.ts": `import { x1 } from 'star-lib'; console.log('third: ' + x1);`,
    ...deferringBarrel("star-lib", ["y", "z"]),
    "node_modules/star-lib/index.js": `export * from 'inner-lib';\nexport { y } from './y.js';\nexport { z } from './z.js';`,
    ...deferringBarrel("inner-lib", ["spare"]),
    "node_modules/inner-lib/index.js": `export { x1 } from './x.js';\nexport { spare } from './spare.js';`,
    "node_modules/inner-lib/x.js": `export const x1 = "X1"; export const x2 = "X2";`,
  },
  async test(dev) {
    // inner-lib defers spare in this build, so each later build that reaches it reads its file again.
    expect((await dev.fetch("/direct")).status).toBe(200);
    await using first = await dev.client("/first");
    await first.expectMessage("first: X1");
    fs.writeFileSync(
      dev.join("node_modules/inner-lib/index.js"),
      `export { x1 } from './x.js';\nexport { x2 } from './x.js';\nexport { spare } from './spare.js';`,
    );
    await firstBuild(dev, "/more");
    expect(await first.js<string>`globalThis.names`).toBe("none");
    await firstBuild(dev, "/third");
    expect(await first.js<string>`globalThis.names`).toBe("spare,x1,x2,y,z");
  },
});

// The page did not load the two files: each one threw. One build has both, and main.ts, which
// accepts the update, loads again after the first of the two.
const lateModule = (value: string) =>
  `if (!globalThis.ok) throw new Error('not yet'); module.exports = { v: '${value}' };`;
devTest("barrel optimization: an update loads each module that failed to load before", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["main.ts"] }),
    "main.ts": `
      export const marker = 1;
      import.meta.hot.accept();
      let one, two;
      try { one = require('./one.cjs').v; } catch (e) { one = e.message; }
      try { two = require('./two.cjs').v; } catch (e) { two = e.message; }
      console.log('main: ' + one + ', ' + two);
    `,
    "one.cjs": lateModule("one 1"),
    "two.cjs": lateModule("two 1"),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("main: not yet, not yet");
    await c.js`globalThis.ok = true`;
    {
      // One build for the two saves: the watcher has the first file before the second save.
      await using batch = await dev.batchChanges();
      const seen = seenByWatcher(dev);
      await dev.write("one.cjs", lateModule("one 2"));
      await seen;
      await dev.write("two.cjs", lateModule("two 2"));
    }
    await c.expectMessage("main: one 2, two 2");
  },
});

// React loads a client component with import(), and keeps the exports that it got. The build of
// /other makes the "use client" barrel load Card.js, so the barrel is a changed module.
devTest('barrel optimization: a page renders an export of a "use client" barrel that another route requested', {
  framework: "react",
  files: {
    "pages/index.tsx": `
      import { Button } from '../ui';
      export default function Index() {
        return <Button />;
      }
    `,
    "pages/other.tsx": `
      import { Card } from '../ui';
      export default function Other() {
        return <Card />;
      }
    `,
    "ui/package.json": JSON.stringify({ name: "ui", sideEffects: false }),
    "ui/index.js": `"use client";\nexport { Button } from './Button.js';\nexport { Card } from './Card.js';`,
    "ui/Button.js": `import * as React from 'react';\nexport const Button = () => React.createElement('p', { id: 'button' }, 'BUTTON');`,
    "ui/Card.js": `import * as React from 'react';\nexport const Card = () => React.createElement('p', { id: 'card' }, 'CARD');`,
  },
  async test(dev) {
    await using index = await dev.client("/");
    await index.expectElemText("#button", "BUTTON");
    await index.expectReload(async () => {
      await using other = await dev.client("/other");
      await other.expectElemText("#card", "CARD");
    });
    // The page answers when it is loaded again.
    await index.drainAcks();
    await index.js`
      history.pushState(1, "", "/other");
      $bake.goto(location.origin + "/other", 1);
    `;
    await index.expectElemText("#card", "CARD");
  },
});

devTest("barrel optimization: export star target not deferred (#27521)", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    // The user imports from consumer-lib, which is a non-barrel package
    // that imports QueryClient from outer-lib.
    "index.ts": `
      import { useQuery } from 'consumer-lib';
      console.log('result: ' + useQuery());
    `,
    // consumer-lib is NOT a barrel — it has real code that uses
    // QueryClient from outer-lib. This mirrors @refinedev/core
    // importing QueryClient from @tanstack/react-query.
    "node_modules/consumer-lib/package.json": JSON.stringify({
      name: "consumer-lib",
      version: "1.0.0",
      main: "./index.js",
    }),
    "node_modules/consumer-lib/index.js": `
      import { QueryClient } from 'outer-lib';
      export function useQuery() {
        const client = new QueryClient();
        return client instanceof QueryClient ? 'PASS' : 'FAIL';
      }
    `,
    // outer-lib is a barrel with sideEffects:false that re-exports
    // everything from inner-lib via export *. Mirrors @tanstack/react-query.
    "node_modules/outer-lib/package.json": JSON.stringify({
      name: "outer-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/outer-lib/index.js": `
      export * from 'inner-lib';
      export { Unrelated } from './unrelated.js';
    `,
    "node_modules/outer-lib/unrelated.js": `export const Unrelated = "X";`,
    // inner-lib is a barrel with sideEffects:false that re-exports
    // from submodules. Mirrors @tanstack/query-core. Without the fix,
    // the barrel optimizer defers queryClient.js because it doesn't
    // know inner-lib is an export-star target (source_index is not
    // set in dev-server mode), so QueryClient becomes undefined.
    "node_modules/inner-lib/package.json": JSON.stringify({
      name: "inner-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/inner-lib/index.js": `
      export { QueryClient } from './queryClient.js';
      export { Other } from './other.js';
    `,
    "node_modules/inner-lib/queryClient.js": `
      export class QueryClient { constructor() { this.ready = true; } }
    `,
    "node_modules/inner-lib/other.js": `export const Other = "OTHER";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("result: PASS");
  },
});

devTest("barrel optimization: two export-from blocks pointing to the same source", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { invariant } from 'barrel-lib';
      console.log('got: ' + typeof invariant);
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export {
        createDataProperty,
        defineProperty,
      } from './utils.js';

      export { unrelated } from './other.js';

      export {
        invariant,
      } from './utils.js';
    `,
    "node_modules/barrel-lib/utils.js": `
      export function createDataProperty() {}
      export function defineProperty() {}
      export function invariant(cond, msg) {
        if (!cond) throw new Error(msg);
      }
    `,
    "node_modules/barrel-lib/other.js": `export const unrelated = "OTHER";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("got: function");
  },
});

// Regression: #28886
// Consumer has TWO separate `import { X } from 'barrel'` statements for the
// same barrel. HMR deduplicates the second into the first; the second's
// import record is marked is_unused=true and never gets its path resolved.
// Barrel optimization then fails to see the named import from the dedup'd
// record and marks its target submodule as unused → submodule stays `{}` →
// the export is `undefined` at runtime.
devTest("barrel optimization: two import statements from the same barrel (#28886)", {
  // Flakes on darwin in CI (timing); fix is platform-agnostic, coverage via linux/windows/alpine.
  skip: ["darwin"],
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Alpha } from 'barrel-lib';
      import { Beta } from 'barrel-lib';
      console.log('got: ' + Alpha() + ' ' + Beta());
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export { Alpha } from './alpha.js';
      export { Beta } from './beta.js';
      export { Gamma } from './gamma.js';
    `,
    "node_modules/barrel-lib/alpha.js": `export const Alpha = () => "ALPHA";`,
    "node_modules/barrel-lib/beta.js": `export const Beta = () => "BETA";`,
    "node_modules/barrel-lib/gamma.js": `export const Gamma = () => "GAMMA";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("got: ALPHA BETA");
  },
});

// HMR lowering merges the statements of one import path into the first one. The
// import record of each later statement is never resolved.
const abBarrel = `export { a } from './a.js'; export { b } from './b.js';`;
const abPackage = (name: string, index: string) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({
    name,
    version: "1.0.0",
    main: "./index.js",
    sideEffects: false,
  }),
  [`node_modules/${name}/index.js`]: index,
  [`node_modules/${name}/inner.js`]: abBarrel,
  [`node_modules/${name}/a.js`]: `export const a = "A";`,
  [`node_modules/${name}/b.js`]: `export function b() {}`,
});

devTest("barrel optimization: export star after another statement of the same path", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { b as b1 } from 'named-first';
      import { b as b2 } from 'star-first';
      import { b as b3 } from 'star-twice';
      import { b as b4 } from './import-first';
      import { a as importLate } from 'parsed-first';
      const { b: b5 } = await importLate();
      console.log('got: ' + [b1, b2, b3, b4, b5].map(b => typeof b).join(' '));
    `,
    ...abPackage("named-first", `export { a } from './inner.js'; export * from './inner.js';`),
    ...abPackage("star-first", `export * from './inner.js'; export { a } from './inner.js';`),
    ...abPackage("star-twice", `import './inner.js'; export * from './inner.js'; export * from './inner.js';`),
    "import-first.ts": `
      import { a } from 'leaf';
      export * from 'leaf';
      export const own = a;
    `,
    ...abPackage("leaf", abBarrel),
    // parsed-first has deferred b.js by the time its a.js leads to late.ts.
    ...abPackage("parsed-first", abBarrel),
    "node_modules/parsed-first/a.js": `export const a = () => import('../../late');`,
    "late.ts": `
      import { a } from 'parsed-first';
      export * from 'parsed-first';
      export const own = a;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("got: function function function function function");
  },
});

devTest("barrel optimization: namespace re-export cycle through a star-exported module", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { x, y, deepValue } from 'loop-lib';
      import { keep } from 'loop-lib/w.js';
      import { other } from 'loop-lib/g.js';
      console.log('result: ' + typeof x + ' ' + y + ' ' + keep + ' ' + deepValue + ' ' + other);
    `,
    "node_modules/loop-lib/package.json": JSON.stringify({
      name: "loop-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/loop-lib/index.js": `
      export * from './t.js';
    `,
    "node_modules/loop-lib/t.js": `
      export { x } from './w.js';
      export * from './r.js';
      export * from './g.js';
    `,
    "node_modules/loop-lib/w.js": `
      import * as ns from './t.js';
      export { ns as x };
      export { keep } from './keep.js';
    `,
    "node_modules/loop-lib/keep.js": `
      export const keep = "KEEP";
    `,
    "node_modules/loop-lib/r.js": `
      export const y = "Y";
    `,
    "node_modules/loop-lib/g.js": `
      export { deepValue } from './deep.js';
      export { other } from './other.js';
    `,
    "node_modules/loop-lib/deep.js": `
      export const deepValue = "DEEP";
    `,
    "node_modules/loop-lib/other.js": `
      export const other = "OTHER";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("result: object Y KEEP DEEP OTHER");
  },
});
// The dev server's runtime threw `$ERR_SSR_RESPONSE_EXPECTED(...)`, a name only src/js resolves: what the
// user saw was "ReferenceError: $ERR_SSR_RESPONSE_EXPECTED is not defined".
devTest("a render() that does not return a Response is reported as that", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function () {
        return "not a response";
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const text = await response.text();
    expect({
      status: response.status,
      saysWhatIsWrong: text.includes("was expected to return a Response object"),
      referenceError: text.includes("is not defined"),
    }).toEqual({ status: 500, saysWhatIsWrong: true, referenceError: false });
  },
});
devTest("require() of a built-in module in server code returns what require() returns", {
  framework: minimalFramework,
  files: {
    "node_modules/cjsdep/package.json": JSON.stringify({ name: "cjsdep", main: "index.js" }),
    "node_modules/cjsdep/index.js": `
      var Stream = require("stream");
      var EventEmitter = require("events");
      var util = require("util");
      function DataStream() {}
      util.inherits(DataStream, Stream);
      module.exports = {
        stream: typeof Stream + ":" + typeof Stream.prototype,
        events: typeof EventEmitter + ":" + typeof EventEmitter.prototype,
        inherits: new DataStream() instanceof Stream,
      };
    `,
    "routes/index.ts": `
      import info from "cjsdep";
      import * as streamNamespace from "stream";
      export default function () {
        return new Response(JSON.stringify({ ...info, importReadable: typeof streamNamespace.Readable }));
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals({
      stream: "function:object",
      events: "function:object",
      inherits: true,
      importReadable: "function",
    });
  },
});
devTest("a route whose import throws on load throws that error again on the next request", {
  framework: minimalFramework,
  files: {
    "dep.cjs": `throw new Error("dep.cjs failed to load");`,
    "esm-dep.ts": `throw new Error("esm-dep.ts failed to load"); export const value = 1;`,
    // A top-level await that rejects, after the module started.
    "tla-dep.ts": `await Promise.resolve(); throw new Error("tla-dep.ts failed to load"); export const value = 1;`,
    // Reached through require(), so through the synchronous loader: a body that throws, and an import that throws.
    "sync-body.ts": `throw new Error("sync-body.ts failed to load"); export const value = 1;`,
    "sync-body.cjs": `module.exports = require("./sync-body.ts").value;`,
    "sync-import-dep.ts": `throw new Error("sync-import-dep.ts failed to load"); export const value = 1;`,
    "sync-import.ts": `export { value } from "./sync-import-dep.ts";`,
    "sync-import.cjs": `module.exports = require("./sync-import.ts").value;`,
    "routes/index.ts": `
      import dep from "../dep.cjs";
      export default function () {
        return new Response("dep: " + dep);
      }
    `,
    "routes/esm.ts": `
      import { value } from "../esm-dep.ts";
      export default function () {
        return new Response("esm-dep: " + value);
      }
    `,
    "routes/tla.ts": `
      import { value } from "../tla-dep.ts";
      export default function () {
        return new Response("tla-dep: " + value);
      }
    `,
    "routes/sync-body.ts": `
      import value from "../sync-body.cjs";
      export default function () {
        return new Response("sync-body: " + value);
      }
    `,
    "routes/sync-import.ts": `
      import value from "../sync-import.cjs";
      export default function () {
        return new Response("sync-import: " + value);
      }
    `,
  },
  async test(dev) {
    for (const [url, message] of [
      ["/", "dep.cjs failed to load"],
      ["/esm", "esm-dep.ts failed to load"],
      ["/tla", "tla-dep.ts failed to load"],
      ["/sync-body", "sync-body.ts failed to load"],
      ["/sync-import", "sync-import-dep.ts failed to load"],
    ]) {
      for (let i = 0; i < 2; i++) {
        const response = await dev.fetch(url);
        const text = await response.text();
        expect({ url, status: response.status, hasMessage: text.includes(message) }).toEqual({
          url,
          status: 500,
          hasMessage: true,
        });
      }
    }
    await dev.write("dep.cjs", `module.exports = "fixed";`);
    await dev.fetch("/").equals("dep: fixed");
    await dev.write("esm-dep.ts", `export const value = "fixed";`);
    await dev.fetch("/esm").equals("esm-dep: fixed");
    await dev.write("tla-dep.ts", `await Promise.resolve(); export const value = "fixed";`);
    await dev.fetch("/tla").equals("tla-dep: fixed");
    await dev.write("sync-body.ts", `export const value = "fixed";`);
    await dev.fetch("/sync-body").equals("sync-body: fixed");
    await dev.write("sync-import-dep.ts", `export const value = "fixed";`);
    await dev.fetch("/sync-import").equals("sync-import: fixed");
  },
});
devTest("a route module that throws when a save reloads it is reported and recovers", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function () {
        return new Response("index v1");
      }
    `,
    "routes/other.ts": `
      export default function () {
        return new Response("other v1");
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("index v1");
    await dev.fetch("/other").equals("other v1");
    {
      await using batch = await dev.batchChanges();
      await dev.write(
        "routes/index.ts",
        `
          throw new Error("thrown at module scope");
          export default function () {
            return new Response("index v2");
          }
        `,
      );
      await dev.patch("routes/other.ts", { find: "v1", replace: "v2" });
    }
    const failed = await dev.fetch("/");
    expect(await failed.text()).toContain("thrown at module scope");
    expect(failed.status).toBe(500);
    await dev.fetch("/other").equals("other v2");
    await dev.write(
      "routes/index.ts",
      `
        export default function () {
          return new Response("index v3");
        }
      `,
    );
    await dev.fetch("/").equals("index v3");
  },
});
devTest("a route loads after a request for it was answered with 413", {
  files: {
    "routes/about.ts": `
      export default function () {
        return new Response("about");
      }
    `,
    "routes/other.ts": `
      export default function () {
        return new Response("other");
      }
    `,
    "bun.app.ts": `
      export default {
        maxRequestBodySize: 1024,
        app: { framework: ${JSON.stringify(minimalFramework)} },
      };
    `,
  },
  async test(dev) {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const socket = net.connect(dev.port, "localhost", () => {
      socket.write("POST /about HTTP/1.1\r\nHost: localhost\r\nContent-Length: 999999\r\n\r\n");
    });
    let data = "";
    socket.on("data", chunk => (data += chunk));
    socket.on("error", reject);
    socket.on("close", () => resolve(data.split("\r\n")[0]));
    expect(await promise).toBe("HTTP/1.1 413 Request Entity Too Large");

    await dev.fetch("/other").equals("other");
    await dev.fetch("/about").equals("about");
  },
});
// "loop" is a symlink to itself, so kqueue can't open the directory to watch it.
devTest("recovers from importing a file in a directory that can't be opened", {
  skip: ["win32"],
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { abc } from './loop/second';
      console.log('value: ' + abc);
    `,
  },
  async test(dev) {
    fs.symlinkSync("loop", dev.join("loop"));
    await using c = await dev.client("/", {
      errors: [`index.ts:1:21: error: Could not resolve: "./loop/second"`],
    });

    await c.expectReload(async () => {
      await dev.write("index.ts", `console.log('value: ' + 456);`);
    });

    await c.expectMessage("value: 456");
  },
});

// Nested `:fullscreen` rules copy the body once per vendor prefix at each level, which the CSS
// printer rejects. This only fails because the dev server prints and minifies with different targets.
// If that changes, this test needs another stylesheet that fails to print.
devTest("editing an @imported stylesheet recovers from a failed CSS print", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      body: "hello",
    }),
    "main.css": `@import "./child.css";\nbody { margin: 0; }\n`,
    "child.css":
      Array.from({ length: 30 }, (_, i) => `.x${i}:fullscreen {`).join("\n") +
      "\ncolor: red;\n" +
      Buffer.alloc(30, "}").toString() +
      "\n",
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["main.css: error: Failed to generate CSS for this file (PrintError)"],
    });

    await c.expectReload(async () => {
      await dev.write("child.css", ".visible { color: blue; }\n", { dedent: false, errors: null });
    });
    await c.style(".visible").color.expect.toBe("#00f");
  },
});

devTest("an @imported stylesheet recovers from a parse error", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      body: "hello",
    }),
    "main.css": `@import "./child.css";\nbody { margin: 0; }\n`,
    "child.css": `.fine { color: red; }\n`,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(200);
    await dev.write("child.css", `.fine {\n color`, { dedent: false });
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("child.css", `.fine { color: blue; }\n`, { dedent: false });
    await using c = await dev.client("/");
    await c.style(".fine").color.expect.toBe("#00f");
    // Every later save must rebuild main.css too, not only the first one.
    for (const color of ["green", "tan", "red"]) {
      await dev.write("child.css", `.fine { color: ${color}; }\n`, { dedent: false });
      await c.style(".fine").color.expect.toBe(color);
    }
  },
});

// Changing index.ts makes the route trace its stylesheets again while main.css is in a failed state.
devTest("dev server survives a css parse error with an edge adjustment", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      scripts: ["index.ts"],
      body: "hello",
    }),
    "index.ts": `import.meta.hot.accept();\n`,
    "main.css": `@import "./child.css";\nbody { margin: 0; }\n`,
    "child.css": `.fine { color: red; }\n`,
    "b.css": `.b { color: green; }\n`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".fine").color.expect.toBe("red");
    {
      await using _batch = await dev.batchChanges({
        errors: ["main.css:5:1: error: Unexpected end of input"],
      });
      await dev.write("main.css", `@import "./child.css";\nbody {\n color: red;\n background-color\n}\n`, {
        dedent: false,
      });
      await dev.write("index.ts", `import.meta.hot.accept();\nimport "./b.css";\n`, { dedent: false });
    }
    await c.style(".fine").color.expect.toBe("red");
    await c.style(".b").color.expect.toBe("green");
    await dev.write("main.css", `@import "./child.css";\nbody { margin: 0; }\n`, { dedent: false });
    await c.style(".fine").color.expect.toBe("red");
  },
});

devTest("dev server survives a css resolution error with an edge adjustment", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      scripts: ["index.ts"],
      body: "hello",
    }),
    "index.ts": `import.meta.hot.accept();\n`,
    "main.css": `@import "./child.css";\nbody { margin: 0; }\n`,
    "child.css": `.fine { color: red; }\n`,
    "b.css": `.b { color: green; }\n`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".fine").color.expect.toBe("red");
    {
      await using _batch = await dev.batchChanges({
        errors: ['main.css:1:1: error: Could not resolve: "./missing.css"'],
      });
      await dev.write("main.css", `@import "./missing.css";\nbody { margin: 0; }\n`, { dedent: false });
      await dev.write("index.ts", `import.meta.hot.accept();\nimport "./b.css";\n`, { dedent: false });
    }
    await c.style(".fine").color.expect.toBe("red");
    await c.style(".b").color.expect.toBe("green");
    await dev.write("main.css", `@import "./child.css";\nbody { margin: 0; }\n`, { dedent: false });
    await c.style(".fine").color.expect.toBe("red");
  },
});

// The dev server builds its define table from the env map once. Assigning to a proxy variable frees the map's value.
const startupProxy = "http://proxy-at-startup.example:8080/" + Buffer.alloc(120, "a").toString();
async function clientBundle(dev: Dev) {
  const html = await dev.fetch("/").text();
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)];
  expect(scripts).toHaveLength(1);
  return dev.fetch(scripts[0][1]).text();
}
devTest("inlined env var survives a runtime process.env write to a proxy variable", {
  files: {
    "bunfig.toml": `
      [serve.static]
      env = "inline"
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `console.log("v1", process.env.HTTPS_PROXY);`,
    "bun.app.ts": `
      import html from "./index.html";
      export default {
        static: { "/": html },
        fetch(req) {
          if (new URL(req.url).pathname === "/set-proxy") {
            process.env.HTTPS_PROXY = "http://changed-at-runtime.example:1/";
            return new Response("ok");
          }
          return new Response("Not Found", { status: 404 });
        },
      };
    `,
  },
  htmlFiles: [],
  env: { HTTPS_PROXY: startupProxy },
  async test(dev) {
    const before = await clientBundle(dev);
    expect(before).toContain('"v1"');
    expect(before).toContain(startupProxy);

    await dev.fetch("/set-proxy").equals("ok");

    await dev.write("index.ts", `console.log("v2", process.env.HTTPS_PROXY);`);
    const after = await clientBundle(dev);
    expect(after).toContain('"v2"');
    expect(after).toContain(startupProxy);
  },
});

// An unresolved CSS url() is passed to the directory watcher. The HTML scanner joins a rooted src to the project root.
devTest("recovers from an unresolved css url() and html script src longer than the path buffer", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      scripts: ["/" + Buffer.alloc(MAX_PATH_BYTES + 1024, "a").toString() + ".js"],
    }),
    "styles.css": `
      body {
        background-image: url(${Buffer.alloc(MAX_PATH_BYTES + 1024, "a").toString()});
      }
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    // The stylesheet is bundled and watched only after the page's imports resolve.
    await dev.write("index.html", emptyHtmlFile({ styles: ["styles.css"] }), { errors: null });
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("styles.css", `body { color: blue; }`);
    expect((await dev.fetch("/")).status).toBe(200);
  },
});
