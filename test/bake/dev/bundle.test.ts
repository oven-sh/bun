// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { expect } from "bun:test";
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

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
// A TOML dotted header builds an object nested arbitrarily deep without
// recursing in the parser, so the printer's recursion guard is the first thing
// to hit it. The failed part used to join the incremental graph as empty code
// (imports from it were silently undefined); debug builds crashed on an assert
// in finalizeBundle instead.
devTest("module that fails to print becomes a per-file error instead of an empty module", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import config from "./deep.toml";
      console.log("value: " + config.d);
    `,
    "deep.toml": "[" + Buffer.alloc(200_000, "a.").toString() + "a]\nd = 1\n",
  },
  async test(dev) {
    const printError = "deep.toml: error: Maximum call stack size exceeded while generating code for this file";

    await using c = await dev.client("/", {
      errors: [printError],
    });

    // The dev server must survive the failed bundle and recover once the
    // file becomes printable. `errors: null` skips the overlay check: the
    // error page is being replaced by the reload at that moment.
    await c.expectReload(async () => {
      await dev.write("deep.toml", "d = 1\n", { dedent: false, errors: null });
    });
    await c.expectMessage("value: 1");

    // Re-introduce the failure on an already-bundled file (hot update path).
    // The loaded route reloads into the error page.
    await c.expectReload(async () => {
      await dev.write("deep.toml", "[" + Buffer.alloc(200_000, "a.").toString() + "a]\nd = 2\n", {
        dedent: false,
        errors: null,
      });
    });
    // The client's reload triggered the re-bundle; this request settles with it.
    const errorPage = await dev.fetch("/");
    expect(errorPage.status).toBe(500);
    expect(await errorPage.text()).toContain("Build Failed");
    await c.expectErrorOverlay([printError]);

    await c.expectReload(async () => {
      await dev.write("deep.toml", "d = 3\n", { dedent: false, errors: null });
    });
    await c.expectMessage("value: 3");
  },
});
devTest("server module that fails to print becomes a per-file error", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      import config from "../deep.toml";
      export default function (req, meta) {
        return new Response("value: " + config.d);
      }
    `,
    "deep.toml": "[" + Buffer.alloc(200_000, "a.").toString() + "a]\nd = 1\n",
  },
  async test(dev) {
    const errorPage = await dev.fetch("/");
    expect(errorPage.status).toBe(500);
    expect(await errorPage.text()).toContain("Build Failed");

    await dev.write("deep.toml", "d = 1\n", { dedent: false });
    await dev.fetch("/").equals("value: 1");
  },
});
// Nested `:fullscreen` rules fan out into one copy of the body per vendor
// prefix at every nesting level, tripping the CSS printer's expansion guard.
// The failed chunk used to be registered as an empty stylesheet with no error.
devTest("stylesheet that fails to print becomes a per-file error instead of an empty stylesheet", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["amp.css"],
      body: "hello",
    }),
    "amp.css":
      Array.from({ length: 30 }, (_, i) => `.x${i}:fullscreen {`).join("\n") +
      "\ncolor: red;\n" +
      Buffer.alloc(30, "}").toString() +
      "\n.visible { color: blue; }\n",
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["amp.css: error: Failed to generate CSS for this file (PrintError)"],
    });

    // The dev server must survive the failed bundle and recover once the
    // file becomes printable.
    await c.expectReload(async () => {
      await dev.write("amp.css", ".visible { color: blue; }\n", { dedent: false, errors: null });
    });
    await c.style(".visible").color.expect.toBe("#00f");
  },
});
// Same as above, but the unprintable rules live in an `@import`ed child file.
// The failure belongs to the chunk entry, yet editing the child must still
// re-enqueue the chunk (the child needs its graph edge even in a failed build).
devTest("editing an @imported stylesheet recovers a failed CSS print", {
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

    // Recovery must work by editing the child, not just the entry.
    await c.expectReload(async () => {
      await dev.write("child.css", ".visible { color: blue; }\n", { dedent: false, errors: null });
    });
    await c.style(".visible").color.expect.toBe("#00f");
  },
});
// While a chunk is failed its entry has Unknown content; a hot update that
// adjusts the chunk's edges used to recurse the css trace through it into a
// CssChild and trip a debug assert, killing the dev server.
devTest("adjusting @imports of a failed stylesheet keeps the dev server alive", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      body: "hello",
    }),
    "main.css": `@import "./child.css";\nbody { margin: 0; }\n`,
    "child.css": `.fine { color: red; }\n`,
    "other.css": `.other { color: green; }\n`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".fine").color.expect.toBe("red");

    // One bundle that both fails to print and adjusts the chunk's edges.
    {
      await using _batch = await dev.batchChanges({
        errors: ["main.css: error: Failed to generate CSS for this file (PrintError)"],
      });
      await dev.write(
        "child.css",
        Array.from({ length: 30 }, (_, i) => `.x${i}:fullscreen {`).join("\n") +
          "\ncolor: red;\n" +
          Buffer.alloc(30, "}").toString() +
          "\n",
        { dedent: false },
      );
      await dev.write("main.css", `@import "./child.css";\n@import "./other.css";\nbody { margin: 0; }\n`, {
        dedent: false,
      });
    }

    // The previously applied style stays active while the chunk is broken.
    await c.style(".fine").color.expect.toBe("red");

    // Fixing the child restyles the same page: both imports apply.
    await dev.write("child.css", ".visible { color: blue; }\n", { dedent: false });
    await c.style(".visible").color.expect.toBe("#00f");
    await c.style(".other").color.expect.toBe("green");
  },
});
// A stylesheet can be a chunk entry and also @imported by another linked
// stylesheet; a print failure in it fails both chunks. Fixing the shared file
// must re-enqueue the other failed root too, not just its own chunk.
devTest("stylesheet both linked and @imported recovers both chunks on one edit", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css", "sub.css"],
      body: "hello",
    }),
    "main.css": `@import "./sub.css";\n.main { color: red; }\n`,
    "sub.css":
      Array.from({ length: 30 }, (_, i) => `.x${i}:fullscreen {`).join("\n") +
      "\ncolor: red;\n" +
      Buffer.alloc(30, "}").toString() +
      "\n",
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [
        "main.css: error: Failed to generate CSS for this file (PrintError)",
        "sub.css: error: Failed to generate CSS for this file (PrintError)",
      ],
    });
    await c.expectReload(async () => {
      await dev.write("sub.css", ".sub { color: blue; }\n", { dedent: false, errors: null });
    });
    await c.style(".sub").color.expect.toBe("#00f");
    await c.style(".main").color.expect.toBe("red");
  },
});
devTest("multiple unprintable @imports are each reported", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      body: "hello",
    }),
    "main.css": `@import "./child1.css";\n@import "./child2.css";\n`,
    "child1.css":
      Array.from({ length: 30 }, (_, i) => `.x${i}:fullscreen {`).join("\n") +
      "\ncolor: red;\n" +
      Buffer.alloc(30, "}").toString() +
      "\n",
    "child2.css":
      Array.from({ length: 30 }, (_, i) => `.y${i}:fullscreen {`).join("\n") +
      "\ncolor: red;\n" +
      Buffer.alloc(30, "}").toString() +
      "\n",
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [
        "main.css: error: Failed to generate CSS for this file (PrintError)",
        "main.css: error: Failed to generate CSS for this file (PrintError)",
      ],
    });

    await c.expectReload(async () => {
      await using _batch = await dev.batchChanges({ errors: null });
      await dev.write("child1.css", ".a { color: red; }\n", { dedent: false });
      await dev.write("child2.css", ".b { color: blue; }\n", { dedent: false });
    });
    await c.style(".a").color.expect.toBe("red");
    await c.style(".b").color.expect.toBe("#00f");
  },
});
// The route's failure flag is only reset by an HTTP request, so a client that
// recovers purely over hot updates used to be stuck with a css list that
// never retraced, dropping later stylesheet additions.
devTest("css list updates after a failure recovered over hot updates", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      scripts: ["index.ts"],
      body: "hello",
    }),
    "index.ts": `import.meta.hot.accept();\nimport "./a.css";\n`,
    "main.css": `.base { color: red; }\n`,
    "a.css": `.a { color: red; }\n`,
    "b.css": `.b { color: green; }\n`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".a").color.expect.toBe("red");

    // Break and fix a.css entirely over hot updates; no page request.
    await dev.write(
      "a.css",
      Array.from({ length: 30 }, (_, i) => `.x${i}:fullscreen {`).join("\n") +
        "\ncolor: red;\n" +
        Buffer.alloc(30, "}").toString() +
        "\n",
      {
        dedent: false,
        errors: ["a.css: error: Failed to generate CSS for this file (PrintError)"],
      },
    );
    await dev.write("a.css", ".a { color: blue; }\n", { dedent: false });
    await c.style(".a").color.expect.toBe("#00f");

    // A new stylesheet import must still reach the page.
    await dev.write("index.ts", `import.meta.hot.accept();\nimport "./a.css";\nimport "./b.css";\n`, {
      dedent: false,
    });
    await c.style(".b").color.expect.toBe("green");
  },
});
// A failed js file keeps its import edges, and its css imports are chunk
// roots; the css trace must keep walking through it or the route's css list
// drops stylesheets that only it reaches.
devTest("stylesheets imported through a failed js file stay active", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      scripts: ["index.ts"],
      body: "hello",
    }),
    "index.ts": `import.meta.hot.accept();\nimport "./comp.ts";\n`,
    "comp.ts": `import "./comp.css";\nexport const x = 1;\n`,
    "comp.css": `.comp { color: red; }\n`,
    "main.css": `.base { color: red; }\n`,
    "b.css": `.b { color: green; }\n`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".comp").color.expect.toBe("red");

    // One batch: parse error in comp.ts plus an edge adjustment, so the
    // route's css list retraces while comp.ts is failed.
    {
      await using _batch = await dev.batchChanges({
        errors: ["comp.ts:2:18: error: Unexpected ;"],
      });
      await dev.write("comp.ts", `import "./comp.css";\nexport const x = ;\n`, { dedent: false });
      await dev.write("index.ts", `import.meta.hot.accept();\nimport "./comp.ts";\nimport "./b.css";\n`, {
        dedent: false,
      });
    }
    await c.style(".comp").color.expect.toBe("red");
    await c.style(".b").color.expect.toBe("green");

    // Recovery keeps both stylesheets.
    await dev.write("comp.ts", `import "./comp.css";\nexport const x = 1;\n`, { dedent: false });
    await c.style(".comp").color.expect.toBe("red");
    await c.style(".b").color.expect.toBe("green");
  },
});
// A parse-failed css root keeps its CssRoot content through insert_failure,
// so an edge-adjusting retrace neither recurses into its css children (debug
// assert) nor drops its slot from the route's css list.
devTest("css parse error with an edge adjustment keeps the dev server alive", {
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
// The resolution-failure path routes through insert_stale before
// insert_failure; it must preserve CssRoot content the same way so the
// retrace neither recurses into css children nor drops the slot.
devTest("css resolution error with an edge adjustment keeps the dev server alive", {
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
    await c.style(".b").color.expect.toBe("green");
    await dev.write("main.css", `@import "./child.css";\nbody { margin: 0; }\n`, { dedent: false });
    await c.style(".fine").color.expect.toBe("red");
  },
});
