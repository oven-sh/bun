// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
//
// Each dev server boot and each connected client costs about a second of wall
// time, so small related cases share one dev server.
import { expect } from "bun:test";
import { type Dev, devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

/** A route whose bundle failed is served as the dev server's error page. */
async function expectBuildFailed(dev: Dev, url: string) {
  const res = await dev.fetch(url);
  expect(res.status).toBe(500);
  expect(await res.text()).toInclude("<title>Bun - Build Failed</title>");
}

/** The JS bundle the dev server currently serves for an html route. */
async function fetchClientBundle(dev: Dev, route: string) {
  const html = await dev.fetch(route).text();
  const src = html.match(/src="([^"]+)" data-bun-dev-server-script/)?.[1];
  if (!src) throw new Error("No dev server script tag in the html for " + route);
  return dev.fetch(src).text();
}

/** Files of a package installed at `<dir>/node_modules/<name>`. */
function inNodeModules(dir: string, name: string, files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([file, contents]) => [`${dir}/node_modules/${name}/${file}`, contents]),
  );
}

const barrelPackageJson = (name: string) =>
  JSON.stringify({ name, version: "1.0.0", main: "./index.js", sideEffects: false });

devTest("import identifier: not renamed, no symbol collision, development condition", {
  framework: minimalFramework,
  files: {
    "db.ts": `export const abc = "123";`,
    // The import identifier does not get renamed by the member accesses.
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
    // A local binding named like the generated import namespace does not
    // collide with it.
    "routes/collision.ts": `
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
    // The dev server resolves the "development" export condition.
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
    await dev.fetch("/").equals("Hello, 123!");
    await dev.fetch("/collision").equals("Hello, 123, 987!");
    await dev.fetch("/condition").equals("Environment: development");

    // Both routes import db.ts, so one edit updates both.
    await dev.write("db.ts", `export const abc = "456";`);
    await dev.fetch("/").equals("Hello, 456!");
    await dev.fetch("/collision").equals("Hello, 456, 987!");

    // Editing one route leaves the others untouched.
    await dev.patch("routes/index.ts", {
      find: "Hello",
      replace: "Bun",
    });
    await dev.fetch("/").equals("Bun, 456!");
    await dev.fetch("/collision").equals("Hello, 456, 987!");
    await dev.fetch("/condition").equals("Environment: development");
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
    await c.expectMessage(
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

    // A self-accepting module keeps the declared name of its default export
    // when it is re-bundled. Both files are rebuilt in one batch, so a single
    // HMR chunk carries both modules.
    {
      await using _ = await dev.batchChanges();
      await dev.writeNoChanges("fixture4.ts");
      await dev.writeNoChanges("fixture8.ts");
    }
    const moveChunk = await c.getMostRecentHmrChunk();
    expect(moveChunk).toMatch(/default:\s*class\s+MOVE/);
    expect(moveChunk).toMatch(/default:\s*function\s+MOVE/);

    await dev.writeNoChanges("fixture7.ts");
    const chunk = await c.getMostRecentHmrChunk();
    expect(chunk).toMatch(/default:\s*function/);

    // Since fixture7.ts is not marked as accepting, it will bubble the update
    // to `index.ts`, re-evaluate it and some of the dependencies.
    await c.expectMessage("TWO", "FOUR", "FIVE", "SEVEN", "EIGHT", "NINE", "ELEVEN");
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
    await expectBuildFailed(dev, "/");

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

    // The server must still be alive. Sibling's import is still unresolved,
    // so the route cannot render and answers with an error page.
    const res = await dev.fetch("/");
    expect(res.status).toBe(500);
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
    await expectBuildFailed(dev, "/");

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

    // The server still responds, and the rewritten page now bundles.
    const res = await dev.fetch("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toInclude('<script type="module" crossorigin src="/_bun/client/index-');

    // Test teardown sends graceful-exit, which calls DevServer.deinit.
    // Before the fix, deinit iterated every dependencies.items slot and
    // freed .specifier again for the free-list slot at index 0, tripping
    // AllocationScope's invalid-free panic.
  },
});
devTest("browser imports: html with the text loader works, html and bun builtins are errors", {
  files: {
    // Importing an html file with the text loader (#18154).
    "text-loader.html": emptyHtmlFile({ scripts: ["text-loader.ts"] }),
    "text-loader.ts": `
      import html from "./app.html" with { type: "text" };
      console.log(html);
    `,
    "app.html": "<div>hello world</div>",
    // Importing an html file without a loader, and importing a Bun builtin,
    // are both build errors in a browser bundle.
    "errors.html": emptyHtmlFile({ scripts: ["errors.ts"] }),
    "errors.ts": `
      import html from "./errors.html";
      import bun from "bun";
      console.log(html, bun);
    `,
  },
  // app.html is an import target, not a page.
  htmlFiles: ["text-loader.html", "errors.html"],
  async test(dev) {
    {
      await using c = await dev.client("/text-loader");
      await c.expectMessage("<div>hello world</div>");
    }
    await using c = await dev.client("/errors", {
      errors: [
        "errors.ts:1:18: error: Browser builds cannot import HTML files.",
        'errors.ts:2:17: error: Browser build cannot import Bun builtin: "bun"',
      ],
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

// Every way a module can reach its CommonJS `exports` object. Each form gets
// its own file so one page load checks all of them, and one batched rebuild
// swaps every file to the next form so the rebuild path re-detects each form.
const cjsForms: Record<string, (value: string) => string> = {
  "module-exports": v => `module.exports.field = ${v};`,
  "exports": v => `exports.field = ${v};`,
  "exports-alias": v => `let theExports = exports; theExports.field = ${v};`,
  "module-alias": v => `let theModule = module; theModule.exports.field = ${v};`,
  "let-destructure": v => `let { exports } = module; exports.field = ${v};`,
  "var-destructure": v => `var { exports } = module; exports.field = ${v};`,
  "module-exports-alias": v => `let theExports = module.exports; theExports.field = ${v};`,
  "eval": v => `require; eval("module.exports.field = ${v}");`,
};
const cjsFormNames = Object.keys(cjsForms);
const nextCjsForm = (i: number) => cjsFormNames[(i + 1) % cjsFormNames.length];

devTest("commonjs forms", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": [
      ...cjsFormNames.map((name, i) => `import cjs${i} from "./${name}.js";`),
      `console.log({ ${cjsFormNames.map((name, i) => `${JSON.stringify(name)}: cjs${i}`).join(", ")} });`,
    ].join("\n"),
    ...Object.fromEntries(cjsFormNames.map(name => [`${name}.js`, cjsForms[name](`'${name}'`)])),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(Object.fromEntries(cjsFormNames.map(name => [name, { field: name }])));

    // None of the files accept hot updates, so the batch ends in a full reload.
    await c.expectReload(async () => {
      await using _ = await dev.batchChanges();
      for (let i = 0; i < cjsFormNames.length; i++) {
        await dev.write(`${cjsFormNames[i]}.js`, cjsForms[nextCjsForm(i)](`'${nextCjsForm(i)}'`));
      }
    });
    await c.expectMessage(Object.fromEntries(cjsFormNames.map((name, i) => [name, { field: nextCjsForm(i) }])));
  },
});

// --- Barrel optimization tests ---

// These cases only read the initial bundle, so they share one page. Each case
// lives in its own directory with its own node_modules, so packages with the
// same name do not collide, and logs a message prefixed with its directory.
devTest("barrel optimization: initial bundle cases", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./skips-unused/index.ts";
      import "./export-star/index.ts";
      import "./two-export-blocks/index.ts";
      import "./two-imports/index.ts";
      import "./namespace-cycle/index.ts";
    `,

    // beta.js and gamma.js have syntax errors. If barrel optimization works,
    // they are never parsed, so no error.
    "skips-unused/index.ts": `
      import { Alpha } from 'barrel-lib';
      console.log('skips-unused: ' + Alpha);
    `,
    ...inNodeModules("skips-unused", "barrel-lib", {
      "package.json": barrelPackageJson("barrel-lib"),
      "index.js": `
        export { Alpha } from './alpha.js';
        export { Beta } from './beta.js';
        export { Gamma } from './gamma.js';
      `,
      "alpha.js": `export const Alpha = "ALPHA";`,
      "beta.js": `export const Beta = <<<SYNTAX_ERROR>>>;`,
      "gamma.js": `export const Gamma = <<<SYNTAX_ERROR>>>;`,
    }),

    // Export star target not deferred (#27521). The user imports from
    // consumer-lib, which is a non-barrel package that imports QueryClient
    // from outer-lib.
    "export-star/index.ts": `
      import { useQuery } from 'consumer-lib';
      console.log('export-star: ' + useQuery());
    `,
    // consumer-lib is NOT a barrel — it has real code that uses
    // QueryClient from outer-lib. This mirrors @refinedev/core
    // importing QueryClient from @tanstack/react-query.
    ...inNodeModules("export-star", "consumer-lib", {
      "package.json": JSON.stringify({
        name: "consumer-lib",
        version: "1.0.0",
        main: "./index.js",
      }),
      "index.js": `
        import { QueryClient } from 'outer-lib';
        export function useQuery() {
          const client = new QueryClient();
          return client instanceof QueryClient ? 'PASS' : 'FAIL';
        }
      `,
    }),
    // outer-lib is a barrel with sideEffects:false that re-exports
    // everything from inner-lib via export *. Mirrors @tanstack/react-query.
    ...inNodeModules("export-star", "outer-lib", {
      "package.json": barrelPackageJson("outer-lib"),
      "index.js": `
        export * from 'inner-lib';
        export { Unrelated } from './unrelated.js';
      `,
      "unrelated.js": `export const Unrelated = "UNRELATED";`,
    }),
    // inner-lib is a barrel with sideEffects:false that re-exports
    // from submodules. Mirrors @tanstack/query-core. Without the fix,
    // the barrel optimizer defers queryClient.js because it doesn't
    // know inner-lib is an export-star target (source_index is not
    // set in dev-server mode), so QueryClient becomes undefined.
    ...inNodeModules("export-star", "inner-lib", {
      "package.json": barrelPackageJson("inner-lib"),
      "index.js": `
        export { QueryClient } from './queryClient.js';
        export { Other } from './other.js';
      `,
      "queryClient.js": `
        export class QueryClient { constructor() { this.ready = true; } }
      `,
      "other.js": `export const Other = "OTHER";`,
    }),

    // Two export-from blocks pointing to the same source.
    "two-export-blocks/index.ts": `
      import { invariant } from 'barrel-lib';
      console.log('two-export-blocks: ' + typeof invariant);
    `,
    ...inNodeModules("two-export-blocks", "barrel-lib", {
      "package.json": barrelPackageJson("barrel-lib"),
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
      "other.js": `export const unrelated = "UNRELATED";`,
    }),

    // Regression: #28886
    // Consumer has TWO separate `import { X } from 'barrel'` statements for the
    // same barrel. HMR deduplicates the second into the first; the second's
    // import record is marked is_unused=true and never gets its path resolved.
    // Barrel optimization then fails to see the named import from the dedup'd
    // record and marks its target submodule as unused → submodule stays `{}` →
    // the export is `undefined` at runtime.
    "two-imports/index.ts": `
      import { Alpha } from 'barrel-lib';
      import { Beta } from 'barrel-lib';
      console.log('two-imports: ' + Alpha() + ' ' + Beta());
    `,
    ...inNodeModules("two-imports", "barrel-lib", {
      "package.json": barrelPackageJson("barrel-lib"),
      "index.js": `
        export { Alpha } from './alpha.js';
        export { Beta } from './beta.js';
        export { Gamma } from './gamma.js';
      `,
      "alpha.js": `export const Alpha = () => "ALPHA";`,
      "beta.js": `export const Beta = () => "BETA";`,
      "gamma.js": `export const Gamma = () => "GAMMA";`,
    }),

    // Namespace re-export cycle through a star-exported module.
    "namespace-cycle/index.ts": `
      import { x, y, deepValue } from 'loop-lib';
      import { keep } from 'loop-lib/w.js';
      import { other } from 'loop-lib/g.js';
      console.log('namespace-cycle: ' + typeof x + ' ' + y + ' ' + keep + ' ' + deepValue + ' ' + other);
    `,
    ...inNodeModules("namespace-cycle", "loop-lib", {
      "package.json": barrelPackageJson("loop-lib"),
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
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(
      "skips-unused: ALPHA",
      "export-star: PASS",
      "two-export-blocks: function",
      "two-imports: ALPHA BETA",
      "namespace-cycle: object Y KEEP DEEP OTHER",
    );

    // Submodules nothing imports are left out of the served bundle: Gamma in
    // two-imports, Unrelated in export-star, and unrelated in two-export-blocks.
    const bundle = await fetchClientBundle(dev, "/");
    expect(bundle).toInclude('"ALPHA"');
    expect(bundle).not.toInclude('"GAMMA"');
    expect(bundle).not.toInclude('"UNRELATED"');
  },
});

devTest("barrel optimization: adding a new import triggers reload", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Alpha } from 'barrel-lib';
      console.log('result: ' + Alpha);
    `,
    "node_modules/barrel-lib/package.json": barrelPackageJson("barrel-lib"),
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
    let bundle = await fetchClientBundle(dev, "/");
    expect(bundle).toInclude('"ALPHA"');
    expect(bundle).not.toInclude('"BETA"');
    expect(bundle).not.toInclude('"GAMMA"');

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
    bundle = await fetchClientBundle(dev, "/");
    expect(bundle).toInclude('"BETA"');
    expect(bundle).not.toInclude('"GAMMA"');

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
    expect(await fetchClientBundle(dev, "/")).toInclude('"GAMMA"');
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
    "node_modules/barrel-lib/package.json": barrelPackageJson("barrel-lib"),
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
    expect(await fetchClientBundle(dev, "/")).not.toInclude('"GAMMA"');

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
    const bundle = await fetchClientBundle(dev, "/");
    expect(bundle).toInclude('"ALPHA"');
    expect(bundle).toInclude('"GAMMA"');
  },
});
