// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
// Independent cases share one dev server, with one route or page each.
import { expect } from "bun:test";
import { Dev, devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

/**
 * Expects the "Build Failed" page for `route`. Each of `errors` is matched
 * against the failure payload the page embeds (base64 of the serialized failures).
 */
async function expectBuildFailedPage(dev: Dev, route: string, ...errors: string[]) {
  const res = await dev.fetch(route);
  const html = await res.text();
  expect(html).toContain("<title>Bun - Build Failed</title>");
  if (errors.length > 0) {
    const encoded = html.match(/atob\("([^"]*)"\)/)?.[1];
    expect(encoded).toBeString();
    const payload = atob(encoded!);
    for (const error of errors) {
      expect(payload).toContain(error);
    }
  }
  expect(res.status).toBe(500);
}

/** Fetches an HTML route and returns the client bundle its page links to. */
async function servedClientBundle(dev: Dev, route: string): Promise<string> {
  const page = await dev.fetch(route);
  expect(page.status).toBe(200);
  const scripts = [...(await page.text()).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  expect(scripts).toHaveLength(1);
  const bundle = await dev.fetch(scripts[0]);
  expect(bundle.status).toBe(200);
  return bundle.text();
}

// The module table is the object literal the bundle calls the HMR runtime with,
// followed by the config object. ESM entries print as
// `"file": [imports, exports, stars, (hmr) => {...}, flag],` and CommonJS
// entries as `"file"(hmr, module, exports) {...},`.
const moduleTableStart = "})({\n";
const moduleTableEnd = "\n}, {\n  main: ";
const moduleTableEntry = /^ {2}"((?:[^"\\]|\\.)*)"(?:: \[|\()/gm;

/** The module table of a client bundle, one entry per line group. */
function moduleTable(bundle: string): string {
  const end = bundle.lastIndexOf(moduleTableEnd);
  expect(end, "module table not found in the served bundle").not.toBe(-1);
  // In a release build the HMR runtime before the table is one minified line.
  const start = bundle.lastIndexOf(moduleTableStart, end);
  expect(start, "module table not found in the served bundle").not.toBe(-1);
  return bundle.slice(start + moduleTableStart.length, end + 1);
}

/** Project-relative paths of the modules in a client bundle, sorted. */
function servedModules(bundle: string): string[] {
  return [...moduleTable(bundle).matchAll(moduleTableEntry)].map(m => m[1].replaceAll("\\\\", "/")).sort();
}

/** The module table entry printed for one file of a client bundle. */
function servedModule(bundle: string, file: string): string {
  const table = moduleTable(bundle);
  const entries = [...table.matchAll(moduleTableEntry)];
  const index = entries.findIndex(m => m[1].replaceAll("\\\\", "/") === file);
  expect(index, `${file} is not in the served bundle`).not.toBe(-1);
  const start = entries[index].index!;
  const end = index + 1 < entries.length ? entries[index + 1].index! : table.length;
  return table.slice(start, end).replace(/^ {2}/gm, "").trimEnd();
}

/** The files of the node_modules package `pkg` among `modules`, sorted. */
function packageFiles(modules: string[], pkg: string): string[] {
  const prefix = `node_modules/${pkg}/`;
  return modules.filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length));
}

/** The files of the node_modules package `pkg` in the bundle currently served for `route`. */
async function bundledPackageFiles(dev: Dev, route: string, pkg: string): Promise<string[]> {
  return packageFiles(servedModules(await servedClientBundle(dev, route)), pkg);
}

devTest("server routes: import identifier is not renamed, import_<name> collision, development condition", {
  framework: minimalFramework,
  files: {
    // Each route has its own copy of db.ts so that both generate an `import_db` binding.
    "identifier/db.ts": `export const abc = "123";`,
    "routes/identifier.ts": `
      import { abc } from '../identifier/db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + '!');
      }
    `,
    "collision/db.ts": `export const abc = "123";`,
    "routes/collision.ts": `
      let import_db = 987;
      import { abc } from '../collision/db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + ', ' + import_db + '!');
      }
    `,
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
    "routes/condition.ts": `
      import environment from 'example';
      export default function (req, meta) {
        return new Response('Environment: ' + environment);
      }
    `,
  },
  async test(dev) {
    // --- import identifier doesnt get renamed ---
    await dev.fetch("/identifier").equals("Hello, 123!");
    await dev.write("identifier/db.ts", `export const abc = "456";`);
    await dev.fetch("/identifier").equals("Hello, 456!");
    await dev.patch("routes/identifier.ts", {
      find: "Hello",
      replace: "Bun",
    });
    await dev.fetch("/identifier").equals("Bun, 456!");

    // --- symbol collision with import identifier ---
    await dev.fetch("/collision").equals("Hello, 123, 987!");
    await dev.write("collision/db.ts", `export const abc = "456";`);
    await dev.fetch("/collision").equals("Hello, 456, 987!");

    // --- uses "development" condition ---
    await dev.fetch("/condition").equals("Environment: development");

    // The edits above did not touch the other routes.
    await dev.fetch("/identifier").equals("Bun, 456!");
    await dev.fetch("/").expect404();
  },
});
devTest("client import rules: missing file, html import, bun builtin, html import with text loader", {
  files: {
    "before-created.html": emptyHtmlFile({ scripts: ["before-created.ts"] }),
    "before-created.ts": `
      import { abc } from './second';
      console.log('value: ' + abc);
    `,
    "import-html.html": emptyHtmlFile({ scripts: ["import-html.ts"] }),
    "import-html.ts": `
      import html from "./import-html.html";
      console.log(html);
    `,
    "import-bun.html": emptyHtmlFile({ scripts: ["import-bun.ts"] }),
    "import-bun.ts": `
      import bun from "bun";
      console.log(bun);
    `,
    "text-loader.html": emptyHtmlFile({ scripts: ["text-loader.ts"] }),
    "text-loader.ts": `
      import html from "./app.html" with { type: "text" };
      console.log(html);
    `,
    "app.html": "<div>hello world</div>",
  },
  // app.html is imported as text, it is not a route.
  htmlFiles: ["before-created.html", "import-html.html", "import-bun.html", "text-loader.html"],
  async test(dev) {
    // Build errors are published to every connected client, so each failing
    // case ends by fixing its file before the next case opens a page.

    // --- importing a file before it is created ---
    await expectBuildFailedPage(dev, "/before-created", 'Could not resolve: "./second"');
    {
      await using c = await dev.client("/before-created", {
        errors: [`before-created.ts:1:21: error: Could not resolve: "./second"`],
      });
      await c.expectReload(async () => {
        await dev.write("second.ts", `export const abc = "456";`);
      });
      await c.expectMessage("value: 456");
    }

    // --- importing html file ---
    await expectBuildFailedPage(dev, "/import-html", "Browser builds cannot import HTML files.");
    {
      await using c = await dev.client("/import-html", {
        errors: ["import-html.ts:1:18: error: Browser builds cannot import HTML files."],
      });
      await c.expectReload(async () => {
        await dev.write("import-html.ts", `console.log("html import removed");`);
      });
      await c.expectMessage("html import removed");
    }

    // --- importing bun on the client ---
    await expectBuildFailedPage(dev, "/import-bun", 'Browser build cannot import Bun builtin: "bun"');
    {
      await using c = await dev.client("/import-bun", {
        errors: ['import-bun.ts:1:17: error: Browser build cannot import Bun builtin: "bun"'],
      });
      await c.expectReload(async () => {
        await dev.write("import-bun.ts", `console.log("bun import removed");`);
      });
      await c.expectMessage("bun import removed");
    }

    // --- importing html file with text loader (#18154) ---
    // The attribute picks the text loader, so the html file is a module with
    // its text as the export instead of a route.
    const bundle = await servedClientBundle(dev, "/text-loader");
    expect(servedModules(bundle)).toEqual(["app.html", "text-loader.html", "text-loader.ts"]);
    expect(servedModule(bundle, "app.html")).toMatchInlineSnapshot(`
      ""app.html"(hmr) {
        hmr.cjs.exports = "<div>hello world</div>"; // bun .s_lazy_export
      },"
    `);
  },
});
devTest("client module forms: import.meta.main, default export scoping, commonjs forms", {
  files: {
    "import-meta-main.html": emptyHtmlFile({ scripts: ["import-meta-main.ts"] }),
    "import-meta-main.ts": `
      console.log(import.meta.main);
    `,

    "default-export.html": emptyHtmlFile({ scripts: ["default-export.ts"] }),
    "default-export.ts": `
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

    "commonjs.html": emptyHtmlFile({ scripts: ["commonjs.ts"] }),
    "commonjs.ts": `
      import cjs from "./cjs.js";
      console.log(cjs);
    `,
    "cjs.js": `
      module.exports.field = {};
    `,
  },
  async test(dev) {
    // --- import.meta.main ---
    // There is no single entry point, so it is inlined as `false`, in an ES
    // module and in a CommonJS module alike.
    const esm = await servedClientBundle(dev, "/import-meta-main");
    expect(servedModule(esm, "import-meta-main.ts")).toMatchInlineSnapshot(`
      ""import-meta-main.ts": [ [], [], [], (hmr) => {
        console.log(false);
      }, false],"
    `);
    await dev.write(
      "import-meta-main.ts",
      `
        require;
        console.log(import.meta.main);
      `,
    );
    const cjs = await servedClientBundle(dev, "/import-meta-main");
    expect(servedModule(cjs, "import-meta-main.ts")).toMatchInlineSnapshot(`
      ""import-meta-main.ts"(hmr) {
        hmr.require;
        console.log(false);
      },"
    `);

    // --- default export same-scope handling ---
    {
      await using c = await dev.client("/default-export", { storeHotChunks: true });
      await c.expectMessage("ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN");

      // A named default export keeps its declaration, so the HMR chunk exports
      // the class or function by name.
      await dev.writeNoChanges("fixture4.ts");
      expect(await c.getMostRecentHmrChunk()).toMatch(/default:\s*class\s+MOVE\b/);
      await dev.writeNoChanges("fixture8.ts");
      expect(await c.getMostRecentHmrChunk()).toMatch(/default:\s*function\s+MOVE\b/);

      await dev.writeNoChanges("fixture7.ts");
      expect(await c.getMostRecentHmrChunk()).toMatch(/default:\s*function\b/);
      // Since fixture7.ts is not marked as accepting, it will bubble the update
      // to `default-export.ts`, re-evaluate it and some of the dependencies.
      await c.expectMessage("TWO", "FOUR", "FIVE", "SEVEN", "EIGHT", "NINE", "ELEVEN");
    }

    // --- commonjs forms ---
    // Nothing accepts updates, so every rewrite of cjs.js reloads the page.
    {
      await using c = await dev.client("/commonjs");
      await c.expectMessage({ field: {} });
      const forms: [source: string, field: string][] = [
        [`exports.field = "1";`, "1"],
        [`let theExports = exports; theExports.field = "2";`, "2"],
        [`let theModule = module; theModule.exports.field = "3";`, "3"],
        [`let { exports } = module; exports.field = "4";`, "4"],
        [`var { exports } = module; exports.field = "4.5";`, "4.5"],
        [`let theExports = module.exports; theExports.field = "5";`, "5"],
        [`require; eval("module.exports.field = '6'");`, "6"],
      ];
      for (const [source, field] of forms) {
        await c.expectReload(async () => {
          await dev.write("cjs.js", source);
        });
        await c.expectMessage({ field });
      }
    }
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
    // Only requested at the very end, to show the server still serves.
    "routes/alive.ts": `
      export default function (req, meta) {
        return new Response('alive');
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
    await expectBuildFailedPage(dev, "/", 'Could not resolve: "./sibling-missing"');

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

    // The server must still be alive and responding: the index route still
    // fails because of Sibling.ts, and an untouched route renders.
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.fetch("/alive").equals("alive");
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
    await expectBuildFailedPage(dev, "/", 'Could not resolve: "./sub/a"', 'Could not resolve: "./sub/b"');

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

    // The server should still respond, with the rebuilt import-free page.
    expect(servedModules(await servedClientBundle(dev, "/"))).toEqual(["index.html", "index.ts"]);

    // Test teardown sends graceful-exit, which calls DevServer.deinit.
    // Before the fix, deinit iterated every dependencies.items slot and
    // freed .specifier again for the free-list slot at index 0, tripping
    // AllocationScope's invalid-free panic.
  },
});

// --- Barrel optimization tests ---

/** A `sideEffects: false` package whose `main` is a re-export barrel. */
function barrelPackage(name: string, files: Record<string, string>) {
  const out: Record<string, string> = {
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
  };
  for (const [file, contents] of Object.entries(files)) {
    out[`node_modules/${name}/${file}`] = contents;
  }
  return out;
}

interface StaticBarrelCase {
  name: string;
  /** The module that imports from the package(s) under test. It logs one line. */
  consumer: string;
  log: string;
  files: Record<string, string>;
  /** Per package, the files that end up in the bundle. The rest were deferred. */
  bundled: Record<string, string[]>;
}

// Cases that only need a page to load once. One page imports every consumer, in this order.
const staticBarrelCases: StaticBarrelCase[] = [
  {
    name: "barrel optimization skips unused submodules",
    consumer: `
      import { Alpha } from 'barrel-skip';
      console.log('skip: ' + Alpha);
    `,
    log: "skip: ALPHA",
    // beta.js and gamma.js have syntax errors. The page only builds if the
    // barrel optimization never parses them.
    files: barrelPackage("barrel-skip", {
      "index.js": `
        export { Alpha } from './alpha.js';
        export { Beta } from './beta.js';
        export { Gamma } from './gamma.js';
      `,
      "alpha.js": `export const Alpha = "ALPHA";`,
      "beta.js": `export const Beta = <<<SYNTAX_ERROR>>>;`,
      "gamma.js": `export const Gamma = <<<SYNTAX_ERROR>>>;`,
    }),
    bundled: { "barrel-skip": ["alpha.js", "index.js"] },
  },
  {
    name: "barrel optimization: export star target not deferred (#27521)",
    // The user imports from consumer-lib, which is a non-barrel package
    // that imports QueryClient from outer-lib. This mirrors @refinedev/core
    // importing QueryClient from @tanstack/react-query.
    consumer: `
      import { useQuery } from 'consumer-lib';
      console.log('export star: ' + useQuery());
    `,
    log: "export star: PASS",
    files: {
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
      ...barrelPackage("outer-lib", {
        "index.js": `
          export * from 'inner-lib';
          export { Unrelated } from './unrelated.js';
        `,
        "unrelated.js": `export const Unrelated = "X";`,
      }),
      // inner-lib is a barrel with sideEffects:false that re-exports
      // from submodules. Mirrors @tanstack/query-core. Without the fix,
      // the barrel optimizer defers queryClient.js because it doesn't
      // know inner-lib is an export-star target (source_index is not
      // set in dev-server mode), so QueryClient becomes undefined.
      ...barrelPackage("inner-lib", {
        "index.js": `
          export { QueryClient } from './queryClient.js';
          export { Other } from './other.js';
        `,
        "queryClient.js": `
          export class QueryClient { constructor() { this.ready = true; } }
        `,
        "other.js": `export const Other = "OTHER";`,
      }),
    },
    // outer-lib's unused re-export is still deferred. The export-star target is bundled whole.
    bundled: {
      "consumer-lib": ["index.js"],
      "outer-lib": ["index.js"],
      "inner-lib": ["index.js", "other.js", "queryClient.js"],
    },
  },
  {
    name: "barrel optimization: two export-from blocks pointing to the same source",
    consumer: `
      import { invariant } from 'barrel-split';
      console.log('split export-from: ' + typeof invariant);
    `,
    log: "split export-from: function",
    files: barrelPackage("barrel-split", {
      "index.js": `
        export {
          createDataProperty,
          defineProperty,
        } from './utils.js';

        export { unrelated } from './other.js';

        export {
          invariant,
        } from './utils.js';
      `,
      "utils.js": `
        export function createDataProperty() {}
        export function defineProperty() {}
        export function invariant(cond, msg) {
          if (!cond) throw new Error(msg);
        }
      `,
      "other.js": `export const unrelated = "OTHER";`,
    }),
    bundled: { "barrel-split": ["index.js", "utils.js"] },
  },
  {
    // Regression: #28886
    // Consumer has TWO separate `import { X } from 'barrel'` statements for the
    // same barrel. HMR deduplicates the second into the first; the second's
    // import record is marked is_unused=true and never gets its path resolved.
    // Barrel optimization then fails to see the named import from the dedup'd
    // record and marks its target submodule as unused → submodule stays `{}` →
    // the export is `undefined` at runtime.
    name: "barrel optimization: two import statements from the same barrel (#28886)",
    consumer: `
      import { Alpha } from 'barrel-twice';
      import { Beta } from 'barrel-twice';
      console.log('two imports: ' + Alpha() + ' ' + Beta());
    `,
    log: "two imports: ALPHA BETA",
    files: barrelPackage("barrel-twice", {
      "index.js": `
        export { Alpha } from './alpha.js';
        export { Beta } from './beta.js';
        export { Gamma } from './gamma.js';
      `,
      "alpha.js": `export const Alpha = () => "ALPHA";`,
      "beta.js": `export const Beta = () => "BETA";`,
      "gamma.js": `export const Gamma = () => "GAMMA";`,
    }),
    bundled: { "barrel-twice": ["alpha.js", "beta.js", "index.js"] },
  },
  {
    name: "barrel optimization: namespace re-export cycle through a star-exported module",
    consumer: `
      import { x, y, deepValue } from 'loop-lib';
      import { keep } from 'loop-lib/w.js';
      import { other } from 'loop-lib/g.js';
      console.log('cycle: ' + typeof x + ' ' + y + ' ' + keep + ' ' + deepValue + ' ' + other);
    `,
    log: "cycle: object Y KEEP DEEP OTHER",
    files: barrelPackage("loop-lib", {
      "index.js": `
        export * from './t.js';
      `,
      "t.js": `
        export { x } from './w.js';
        export * from './r.js';
        export * from './g.js';
      `,
      "w.js": `
        import * as ns from './t.js';
        export { ns as x };
        export { keep } from './keep.js';
      `,
      "keep.js": `
        export const keep = "KEEP";
      `,
      "r.js": `
        export const y = "Y";
      `,
      "g.js": `
        export { deepValue } from './deep.js';
        export { other } from './other.js';
      `,
      "deep.js": `
        export const deepValue = "DEEP";
      `,
      "other.js": `
        export const other = "OTHER";
      `,
    }),
    bundled: { "loop-lib": ["deep.js", "g.js", "index.js", "keep.js", "other.js", "r.js", "t.js", "w.js"] },
  },
];

devTest("barrel optimization", {
  files: {
    "static.html": emptyHtmlFile({ scripts: ["static.ts"] }),
    "static.ts": staticBarrelCases.map((_, i) => `import "./static-case-${i}.ts";`).join("\n"),
    ...Object.fromEntries(staticBarrelCases.map((c, i) => [`static-case-${i}.ts`, c.consumer])),
    ...Object.assign({}, ...staticBarrelCases.map(c => c.files)),

    // --- barrel optimization: adding a new import triggers reload ---
    "add.html": emptyHtmlFile({ scripts: ["add.ts"] }),
    "add.ts": `
      import { Alpha } from 'barrel-add';
      console.log('result: ' + Alpha);
    `,
    ...barrelPackage("barrel-add", {
      "index.js": `
        export { Alpha } from './alpha.js';
        export { Beta } from './beta.js';
        export { Gamma } from './gamma.js';
      `,
      "alpha.js": `export const Alpha = "ALPHA";`,
      "beta.js": `export const Beta = "BETA";`,
      "gamma.js": `export const Gamma = "GAMMA";`,
    }),

    // --- barrel optimization: multi-file imports preserved across rebuilds ---
    "multi.html": emptyHtmlFile({ scripts: ["multi.ts"] }),
    "multi.ts": `
      import { Alpha } from 'barrel-multi';
      import { value } from './multi-other';
      console.log('result: ' + Alpha + ' ' + value);
    `,
    "multi-other.ts": `
      import { Beta } from 'barrel-multi';
      export const value = Beta;
    `,
    ...barrelPackage("barrel-multi", {
      "index.js": `
        export { Alpha } from './alpha.js';
        export { Beta } from './beta.js';
        export { Gamma } from './gamma.js';
      `,
      "alpha.js": `export const Alpha = "ALPHA";`,
      "beta.js": `export const Beta = "BETA";`,
      "gamma.js": `export const Gamma = "GAMMA";`,
    }),
  },
  async test(dev) {
    // --- the single-load cases in `staticBarrelCases` ---
    {
      await using c = await dev.client("/static");
      await c.expectMessage(...staticBarrelCases.map(staticCase => staticCase.log));
    }
    const modules = servedModules(await servedClientBundle(dev, "/static"));
    for (const { name, bundled } of staticBarrelCases) {
      for (const [pkg, files] of Object.entries(bundled)) {
        expect(packageFiles(modules, pkg), `${name}: files of ${pkg} in the bundle`).toEqual(files);
      }
    }

    // --- barrel optimization: adding a new import triggers reload ---
    {
      await using c = await dev.client("/add");
      await c.expectMessage("result: ALPHA");
      expect(await bundledPackageFiles(dev, "/add", "barrel-add")).toEqual(["alpha.js", "index.js"]);

      // Add a second import from the barrel. Beta was previously deferred,
      // now needs to be loaded. The barrel file should be re-bundled with
      // Beta un-deferred.
      await c.expectReload(async () => {
        await dev.write(
          "add.ts",
          `
            import { Alpha, Beta } from 'barrel-add';
            console.log('result: ' + Alpha + ' ' + Beta);
          `,
        );
      });
      await c.expectMessage("result: ALPHA BETA");
      expect(await bundledPackageFiles(dev, "/add", "barrel-add")).toEqual(["alpha.js", "beta.js", "index.js"]);

      // Add a third import
      await c.expectReload(async () => {
        await dev.write(
          "add.ts",
          `
            import { Alpha, Beta, Gamma } from 'barrel-add';
            console.log('result: ' + Alpha + ' ' + Beta + ' ' + Gamma);
          `,
        );
      });
      await c.expectMessage("result: ALPHA BETA GAMMA");
      expect(await bundledPackageFiles(dev, "/add", "barrel-add")).toEqual([
        "alpha.js",
        "beta.js",
        "gamma.js",
        "index.js",
      ]);
    }

    // --- barrel optimization: multi-file imports preserved across rebuilds ---
    {
      await using c = await dev.client("/multi");
      await c.expectMessage("result: ALPHA BETA");
      expect(await bundledPackageFiles(dev, "/multi", "barrel-multi")).toEqual(["alpha.js", "beta.js", "index.js"]);

      // Edit only multi-other.ts to also import Gamma. Alpha (from multi.ts)
      // must still be available even though multi.ts is not re-parsed.
      await c.expectReload(async () => {
        await dev.write(
          "multi-other.ts",
          `
            import { Beta, Gamma } from 'barrel-multi';
            export const value = Beta + ' ' + Gamma;
          `,
        );
      });
      await c.expectMessage("result: ALPHA BETA GAMMA");
      expect(await bundledPackageFiles(dev, "/multi", "barrel-multi")).toEqual([
        "alpha.js",
        "beta.js",
        "gamma.js",
        "index.js",
      ]);
    }
  },
});
