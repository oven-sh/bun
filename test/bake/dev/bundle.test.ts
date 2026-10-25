// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { expect } from "bun:test";
import { MAX_PATH_BYTES } from "harness";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Dev, devTest, emptyHtmlFile, minimalFramework, WatchSynchronization } from "../bake-harness";

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
// changed its file, so a page or a server that has the barrel loaded evaluates it again in place:
// no importer has to accept it.
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
// The barrel pass does not defer a re-export for the last two routes. It still bundles the barrel again.
for (const [route, message, what, keepsScript] of [
  ["/second", "second: B", "another export", false],
  ["/third", "third: A", "the same export", true],
  ["/all", "all: ABC", "every export", false],
  ["/star", "star: A", "the barrel through export *", false],
] as const) {
  devTest(`barrel optimization: the first build of a route that reads ${what} does not reload an open page`, {
    files: {
      ...Object.fromEntries(
        ["first", "second", "third", "all", "star"].map(name => [
          `${name}.html`,
          emptyHtmlFile({ scripts: [`${name}.ts`] }),
        ]),
      ),
      "first.ts": `import { a } from 'two-lib'; console.log('first: ' + a);`,
      "second.ts": `import { b } from 'two-lib'; console.log('second: ' + b);`,
      "third.ts": `import { a } from 'two-lib'; console.log('third: ' + a);`,
      "all.ts": `import * as lib from 'two-lib'; console.log('all: ' + lib.a + lib.b + lib.c);`,
      "star.ts": `import { a } from 'star-lib'; console.log('star: ' + a);`,
      ...deferringBarrel("two-lib", ["a", "b", "c"]),
      "node_modules/star-lib/package.json": JSON.stringify({
        name: "star-lib",
        version: "1.0.0",
        main: "./index.js",
        sideEffects: false,
      }),
      "node_modules/star-lib/index.js": `export * from 'two-lib';`,
    },
    async test(dev) {
      await using first = await dev.client("/first");
      await first.expectMessage("first: A");
      const script = await scriptOf(dev, "/first");
      // Every open page gets the modules of this build, the barrel with them.
      await using other = await dev.client(route);
      await other.expectMessage(message);
      await first.drainAcks();
      expect(first.messages).toEqual([]);
      // The cached script of /first holds the barrel. It is out of date when the barrel loads more.
      expect((await scriptOf(dev, "/first")) === script).toBe(keepsScript);
    },
  });
}

const appBarrel = {
  "lib/package.json": JSON.stringify({ name: "app-lib", sideEffects: false }),
  "lib/index.ts": `export { a } from './a'; export { b } from './b'; export { c } from './c';`,
  "lib/a.ts": `export const a = "A";`,
  "lib/b.ts": `export const b = "B";`,
  "lib/c.ts": `export const c = "C";`,
};
devTest("barrel optimization: an open page evaluates a barrel again when another route requests more of it", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
    "first.ts": `
      import { readA } from './util';
      globalThis.openPanel = () => require('./panel').panel();
      console.log('first: ' + readA());
      import.meta.hot.accept();
    `,
    "util.ts": `import { a } from './lib'; export const readA = () => a;`,
    "panel.ts": `import { a } from './lib'; export const panel = () => 'panel: ' + a;`,
    "second.ts": `import { readB } from './shared'; console.log('second: ' + readB());`,
    "shared.ts": `import { b } from './lib'; export const readB = () => b;`,
    ...appBarrel,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    {
      await using second = await dev.client("/second");
      await second.expectMessage("second: B");
    }
    await first.drainAcks();
    expect(first.messages).toEqual([]);
    // No module of that update imports the barrel. A barrel that waits for its next importer is
    // evaluated by this require(), which does not give the new exports to util.ts.
    expect(await first.js<string>`openPanel()`).toBe("panel: A");
    await dev.write("lib/a.ts", `export const a = "A2";`);
    await first.expectMessage("first: A2");
    expect(await first.js<string>`openPanel()`).toBe("panel: A2");
    // The page was open when the build of /second sent shared.ts and lib/b.ts, and stored them.
    await dev.write(
      "first.ts",
      `
        import { readA } from './util';
        import { readB } from './shared';
        console.log('saved: ' + readA() + ' ' + readB());
        import.meta.hot.accept();
      `,
    );
    await first.expectMessage("saved: A2 B");
  },
});

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
    // The barrel has deferred c until this save. comp.ts reads it when it is evaluated.
    await dev.write(
      "comp.ts",
      `
        import { b, c } from 'two-lib';
        console.log('again: ' + b + ' ' + c);
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("again: B C");
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
    expect(c.messages).toEqual([]);
  },
});

// The barrel has new exports each time it is evaluated, and the callback gets them. The page
// waits for lib/b.ts before it calls the callback.
devTest("barrel optimization: a module that accepts a barrel gets the exports that a build adds", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
    "first.ts": `
      import { a } from './lib';
      console.log('first: ' + a);
      import.meta.hot.accept('./lib', lib => console.log('accepted: ' + lib.a + ' ' + lib.b));
    `,
    "second.ts": `import { b } from './lib'; console.log('second: ' + b);`,
    ...appBarrel,
    "lib/b.ts": `export const b = await Promise.resolve("B");`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    await using second = await dev.client("/second");
    await second.expectMessage("second: B");
    await first.expectMessage("accepted: A B");
  },
});

// The page would run the statements of the file again, and no importer with them.
devTest("barrel optimization: a file of re-exports with statements of its own is a changed module", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
    "first.ts": `import { a } from './lib'; console.log('first: ' + a);`,
    "second.ts": `import { b } from './lib'; console.log('second: ' + b);`,
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
    await using second = await dev.client("/second");
    await second.expectMessage("second: B");
    await first.expectMessage("dispose lib");
  },
});

// outer-lib copies a, b and c from lib when it is evaluated.
const outerBarrel = {
  "node_modules/outer-lib/package.json": JSON.stringify({
    name: "outer-lib",
    version: "1.0.0",
    main: "./index.js",
    sideEffects: false,
  }),
  "node_modules/outer-lib/index.js": `export { a, b, c } from 'lib'; export { own } from './own.js';`,
  "node_modules/outer-lib/own.js": `export const own = "OWN";`,
  ...deferringBarrel("lib", ["a", "b", "c"]),
};
devTest("barrel optimization: a saved module reads a new re-export through an outer barrel", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { own } from 'outer-lib';
      import { b } from 'lib';
      console.log('index: ' + own + ' ' + b);
      import.meta.hot.accept();
    `,
    ...outerBarrel,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("index: OWN B");
    await dev.write(
      "index.ts",
      `
        import { a } from 'outer-lib';
        console.log('saved: ' + a);
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("saved: A");
  },
});

// The server has one module registry for all routes. It evaluates lib before outer-lib, which
// copies a from it. Each barrel has a server copy and an SSR copy.
devTest("barrel optimization: the server evaluates both copies of a barrel again when a route requests more of it", {
  framework: { ...minimalFramework, serverComponents: separateSSRGraph },
  files: {
    "routes/first.ts": `
      import { own } from 'outer-lib';
      import { b } from 'lib';
      import { read } from '../first-ssr' with { bunBakeGraph: 'ssr' };
      export default function () {
        return new Response('first: ' + own + ' ' + b + ', ssr: ' + read());
      }
    `,
    "first-ssr.ts": `
      import { own } from 'outer-lib';
      import { b } from 'lib';
      export const read = () => own + ' ' + b;
    `,
    "routes/second.ts": `
      import { a, b } from 'outer-lib';
      import { read } from '../second-ssr' with { bunBakeGraph: 'ssr' };
      export default function () {
        return new Response('second: ' + b + ' ' + a + ', ssr: ' + read());
      }
    `,
    "second-ssr.ts": `
      import { a, b } from 'outer-lib';
      export const read = () => b + ' ' + a;
    `,
    ...outerBarrel,
  },
  async test(dev) {
    await dev.fetch("/first").equals("first: OWN B, ssr: OWN B");
    await dev.fetch("/second").equals("second: B A, ssr: B A");
    await dev.fetch("/first").equals("first: OWN B, ssr: OWN B");
  },
});

// Each importer accepts itself, so an update that has the barrel as a changed module runs it again.
const countedImporter = (name: string, label = "") => `
  import { a } from './lib';
  const runs = (globalThis.runs ??= {});
  runs.${name} = (runs.${name} ?? 0) + 1;
  import.meta.hot.accept();
  export const value = '${label}' + a;
`;
devTest("barrel optimization: the server does not run the importers of either copy of a barrel again", {
  framework: { ...minimalFramework, serverComponents: separateSSRGraph },
  files: {
    "routes/first.ts": `
      import { value as server } from '../server-user';
      import { value as ssr } from '../ssr-user' with { bunBakeGraph: 'ssr' };
      export default function () {
        return Response.json({ server, ssr, runs: globalThis.runs });
      }
    `,
    "server-user.ts": countedImporter("server"),
    "ssr-user.ts": countedImporter("ssr"),
    "routes/second.ts": `
      import { b } from '../lib';
      import { readB } from '../ssr-b' with { bunBakeGraph: 'ssr' };
      export default function () {
        return Response.json({ b, ssr: readB(), runs: globalThis.runs });
      }
    `,
    "ssr-b.ts": `import { b } from './lib'; export const readB = () => b;`,
    ...appBarrel,
  },
  async test(dev) {
    await dev.fetch("/first").equals({ server: "A", ssr: "A", runs: { server: 1, ssr: 1 } });
    // The first build of /second bundles the server copy and the SSR copy of the barrel again.
    await dev.fetch("/second").equals({ b: "B", ssr: "B", runs: { server: 1, ssr: 1 } });
    await dev.write("server-user.ts", countedImporter("server", "saved "));
    await dev.fetch("/first").equals({ server: "saved A", ssr: "A", runs: { server: 2, ssr: 1 } });
    await dev.write("ssr-user.ts", countedImporter("ssr", "saved "));
    await dev.fetch("/first").equals({ server: "saved A", ssr: "saved A", runs: { server: 2, ssr: 2 } });
  },
});

// Each module of ui-lib has a stylesheet, so the stylesheets of a route tell which modules of the
// barrel the dev server knows that the route loads.
const uiLib = {
  ...deferringBarrel("ui-lib", ["a", "b", "c"]),
  ...Object.fromEntries(
    ["a", "b", "c"].flatMap(e => [
      [`node_modules/ui-lib/${e}.js`, `import './${e}.css'; export const ${e} = "${e.toUpperCase()}";`],
      [`node_modules/ui-lib/${e}.css`, `.${e} { color: red; }`],
    ]),
  ),
};
const uiLibRoute = (imports: string, from = "ui-lib") => `
  import { ${imports} } from '${from}';
  export default function (req, meta) {
    return Response.json({ values: [${imports}], styles: meta.styles.length });
  }
`;
devTest("barrel optimization: a save on one framework route reloads another route only when the barrel loads more", {
  framework: minimalFramework,
  files: {
    "routes/first.ts": uiLibRoute("a"),
    "routes/third.ts": uiLibRoute("a"),
    "routes/direct.ts": uiLibRoute("b", "ui-lib/b.js"),
    ...uiLib,
  },
  async test(dev) {
    await dev.fetch("/direct").equals({ values: ["B"], styles: 1 });
    await dev.fetch("/first").equals({ values: ["A"], styles: 1 });
    await dev.fetch("/third").equals({ values: ["A"], styles: 1 });
    const third = await dev.viewRoute("/third");

    // The build bundles the barrel again with the same re-exports.
    await dev.write("routes/first.ts", uiLibRoute("a") + "// saved");
    expect(third.reloadedRoutes).toEqual([[]]);

    // The barrel loads b.js, which the build of /direct has bundled. /third gets its stylesheet.
    await dev.write("routes/first.ts", uiLibRoute("a, b"));
    expect(third.reloadedRoutes.slice(1)).toEqual([[third.routeBundleIndex]]);
    await dev.fetch("/third").equals({ values: ["A"], styles: 2 });

    // The barrel loads c.js, which no build has bundled.
    await dev.write("routes/first.ts", uiLibRoute("a, b, c"));
    expect(third.reloadedRoutes.slice(2)).toEqual([[third.routeBundleIndex]]);
    await dev.fetch("/third").equals({ values: ["A"], styles: 3 });
  },
});

const twoGraphRoute = (name: string) => ({
  [`routes/${name}.ts`]: `
    import { a } from 'ui-lib';
    import { read } from '../${name}-ssr' with { bunBakeGraph: 'ssr' };
    export default function () {
      return new Response('${name}: ' + a + ', ssr: ' + read());
    }
  `,
  [`${name}-ssr.ts`]: `import { a } from 'ui-lib'; export const read = () => a;`,
});
devTest(
  "barrel optimization: a save on one framework route does not reload a route that reads the barrel in two graphs",
  {
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    files: {
      ...twoGraphRoute("first"),
      ...twoGraphRoute("third"),
      ...uiLib,
    },
    async test(dev) {
      await dev.fetch("/first").equals("first: A, ssr: A");
      await dev.fetch("/third").equals("third: A, ssr: A");
      const third = await dev.viewRoute("/third");
      // This build bundles the server copy of the barrel again, and the next one its SSR copy.
      await dev.patch("routes/first.ts", { find: "first: ", replace: "saved: " });
      await dev.patch("first-ssr.ts", { find: "() => a", replace: "() => a + '!'" });
      expect(third.reloadedRoutes).toEqual([[], []]);
      await dev.fetch("/first").equals("saved: A, ssr: A!");
    },
  },
);

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
      expect((await dev.fetch("/third")).status).toBe(200);
    });
    await first.expectMessage("first: A");
  },
});

// The page of /first has b.js from the build of /direct, and not its stylesheet: an update has
// the stylesheets of the modules that its build bundled. The page loads again, as before.
devTest("barrel optimization: a barrel that loads a module of an earlier build reloads an open page", {
  files: {
    ...Object.fromEntries(
      ["first", "second", "direct"].map(name => [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`] })]),
    ),
    "first.ts": `import { a } from 'ui-lib'; console.log('first: ' + a);`,
    "second.ts": `import { b } from 'ui-lib'; console.log('second: ' + b);`,
    "direct.ts": `import { b } from 'ui-lib/b.js'; console.log('direct: ' + b);`,
    ...uiLib,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("first: A");
    expect((await dev.fetch("/direct")).status).toBe(200);
    await first.expectReload(async () => {
      await using second = await dev.client("/second");
      await second.expectMessage("second: B");
    });
    await first.expectMessage("first: A");
    await first.style(".b").color.expect.toBe("red");
  },
});

// `export *` copies the exports of x.ts when the barrel is evaluated. main.ts evaluates the barrel
// before x.ts loads again, so the barrel is evaluated once more after it.
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

// The update of the batch has a route module that fails to load. The rest of it still loads.
devTest("barrel optimization: the server evaluates a barrel again in an update with a module that throws", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function () {
        return new Response('index');
      }
    `,
    "routes/other.ts": `
      import { v, readY } from '../lib';
      export default function () {
        return new Response('other: ' + v + ' ' + readY());
      }
    `,
    ...starBarrel,
  },
  async test(dev) {
    await dev.fetch("/").equals("index");
    await dev.fetch("/other").equals("other: 1 Y");
    {
      await using batch = await dev.batchChanges();
      await dev.write("routes/index.ts", `throw new Error("thrown when the module loads");`);
      await dev.write("lib/x.ts", starTarget(2));
    }
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.fetch("/other").equals("other: 2 Y");
  },
});

// The first build of /second makes each barrel load a module that fails: the second one with a
// throw, the other two after a top-level await.
const failingBarrel = (n: number, moduleOfB: string) => ({
  [`lib${n}/package.json`]: JSON.stringify({ name: `app-lib${n}`, sideEffects: false }),
  [`lib${n}/index.ts`]: `export { a } from './a'; export { b } from './b';`,
  [`lib${n}/a.ts`]: `export const a = "A${n}";`,
  [`lib${n}/b.ts`]: moduleOfB,
});
devTest("barrel optimization: the server keeps a route when a barrel loads a module that fails", {
  framework: minimalFramework,
  files: {
    "routes/first.ts": `
      import { a as a1 } from '../lib1';
      import { a as a2 } from '../lib2';
      import { a as a3 } from '../lib3';
      export default function () {
        return new Response('first: ' + a1 + ' ' + a2 + ' ' + a3);
      }
    `,
    "routes/second.ts": `
      import { b as b1 } from '../lib1';
      import { b as b2 } from '../lib2';
      import { b as b3 } from '../lib3';
      export default function () {
        return new Response('second: ' + b1 + ' ' + b2 + ' ' + b3);
      }
    `,
    ...failingBarrel(1, `await Promise.resolve(); throw new Error("b of lib1 failed to load");`),
    ...failingBarrel(2, `throw new Error("b of lib2 failed to load");`),
    ...failingBarrel(3, `await Promise.resolve(); throw new Error("b of lib3 failed to load");`),
  },
  async test(dev) {
    await dev.fetch("/first").equals("first: A1 A2 A3");
    expect((await dev.fetch("/second")).status).toBe(500);
    await dev.fetch("/first").equals("first: A1 A2 A3");
    expect((await dev.fetch("/second")).status).toBe(500);
    await dev.fetch("/first").equals("first: A1 A2 A3");
  },
});

// The server copy and the SSR copy of a file share one record of the dev server, and one mark
// for a save. The test holds the build of the save back, so the first build of /other bundles
// both copies of the saved barrel, as imports.
const copyingImporter = `import { a } from './lib'; export const copy = 'copy of ' + a; import.meta.hot.accept();`;
devTest("barrel optimization: a route build that reaches a saved barrel reloads the importers of both copies", {
  framework: { ...minimalFramework, serverComponents: separateSSRGraph },
  files: {
    "routes/index.ts": `
      import { copy as server } from '../server-user';
      import { copy as ssr } from '../ssr-user' with { bunBakeGraph: 'ssr' };
      export default function () {
        return new Response('server: ' + server + ', ssr: ' + ssr);
      }
    `,
    "routes/other.ts": `
      import { a } from '../lib';
      import { read } from '../ssr-other' with { bunBakeGraph: 'ssr' };
      import { copy as server } from '../server-user';
      import { copy as ssr } from '../ssr-user' with { bunBakeGraph: 'ssr' };
      export default function () {
        return new Response('other: ' + a + ' ' + read() + ', server: ' + server + ', ssr: ' + ssr);
      }
    `,
    "server-user.ts": copyingImporter,
    "ssr-user.ts": copyingImporter,
    "ssr-other.ts": `import { a } from './lib'; export const read = () => a;`,
    ...appBarrel,
    "lib/a.ts": `export const a = "A"; export const a2 = "A2";`,
  },
  async test(dev) {
    await dev.fetch("/").equals("server: copy of A, ssr: copy of A");
    {
      await using batch = await dev.batchChanges();
      const seen = new Promise<void>(resolve => {
        dev.on("watch_synchronization", function onEvent(event: WatchSynchronization) {
          if (event !== WatchSynchronization.SeenFiles) return;
          dev.off("watch_synchronization", onEvent);
          resolve();
        });
      });
      await dev.write("lib/index.ts", appBarrel["lib/index.ts"].replace("{ a }", "{ a2 as a }"));
      await seen;
      await dev.fetch("/other").equals("other: A2 A2, server: copy of A2, ssr: copy of A2");
    }
    await dev.fetch("/").equals("server: copy of A2, ssr: copy of A2");
  },
});

// The update of the save waits in slow.ts. The build of /second then makes the page evaluate the
// barrel, which waits in b.js. The first update goes on while the barrel is still loading.
const slowImporter = (text: string) => `
  import { a } from 'two-lib';
  console.log('${text} waits');
  await globalThis.gates?.slow;
  console.log('${text}: ' + a);
  import.meta.hot.accept();
`;
devTest("barrel optimization: an update goes on while a later update loads the barrel", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
    "first.ts": `import './slow';`,
    "slow.ts": slowImporter("slow"),
    "second.ts": `import { b } from 'two-lib'; console.log('second: ' + b);`,
    ...deferringBarrel("two-lib", ["a", "b", "c"]),
    "node_modules/two-lib/b.js": `console.log('b waits');\nawait globalThis.gates?.b;\nexport const b = "B";`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.expectMessage("slow waits", "slow: A");
    await first.js`
      globalThis.gates = {};
      gates.slow = new Promise(resolve => (gates.releaseSlow = resolve));
      gates.b = new Promise(resolve => (gates.releaseB = resolve));
    `;
    const saved = dev.write("slow.ts", slowImporter("saved"));
    await first.expectMessage("saved waits");
    expect((await dev.fetch("/second")).status).toBe(200);
    await first.expectMessage("b waits");
    await first.js`gates.releaseSlow()`;
    await first.expectMessage("saved: A");
    await saved;
    await first.js`gates.releaseB()`;
    await first.drainAcks();
  },
});

const clientComponent = (text: string) => `
  "use client";
  import { b } from 'two-lib';
  export function Counter() {
    return <p id="counter">{"${text} " + b}</p>;
  }
`;
// The page imports the barrel in the server graph, and the client component in the SSR graph. A
// route that the reload list names does not apply the JavaScript of the update.
devTest("barrel optimization: a save of a client component that imports a barrel shows on a React page", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      import { a } from 'two-lib';
      import { Counter } from '../components/Counter';
      export default function Page() {
        return <div><h1>{a}</h1><Counter /></div>;
      }
    `,
    "components/Counter.tsx": clientComponent("first"),
    ...deferringBarrel("two-lib", ["a", "b", "c"]),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectElemText("#counter", "first B");
    await dev.write("components/Counter.tsx", clientComponent("saved"));
    await c.expectElemText("#counter", "saved B");
  },
});

// React loads a client component with import(), and keeps the exports that it got. A "use client"
// barrel that is evaluated again in place gives them no new export, so it is a changed module.
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
