// Bundling bugs that only occur in DevServer; independent cases share one dev server, one route each.
import type { Bake } from "bun";
import { expect } from "bun:test";
import { Dev, devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

const buildFailedTitle = "<title>Bun - Build Failed</title>";

/** Expects the "Build Failed" page; `error` is matched against the base64 failure payload it embeds. */
async function expectBuildFailedPage(dev: Dev, route: string, error?: string) {
  const res = await dev.fetch(route);
  const html = await res.text();
  expect(html).toContain(buildFailedTitle);
  if (error !== undefined) {
    const encoded = html.match(/atob\("([^"]*)"\)/)?.[1];
    expect(encoded).toBeString();
    expect(atob(encoded!)).toContain(error);
  }
  expect(res.status).toBe(500);
}

// separateSSRGraph makes a "use client" file's own bundling failures belong to the client graph's node.
const separateSSRGraphFramework: Bake.Framework = {
  ...minimalFramework,
  serverComponents: {
    ...minimalFramework.serverComponents!,
    separateSSRGraph: true,
  },
};

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

// Module table entries: ESM `"file": [imports, exports, stars, (hmr) => {...}, flag],`, CJS `"file"(hmr) {...},`.
const moduleTableEntry = /^ {2}"((?:[^"\\]|\\.)*)"(?:: \[|\()/gm;

/** Project-relative paths of the modules in a client bundle, sorted. */
function servedModules(bundle: string): string[] {
  return [...bundle.matchAll(moduleTableEntry)].map(m => m[1].replaceAll("\\\\", "/")).sort();
}

/** The module table entry printed for one file of a client bundle. */
function servedModule(bundle: string, file: string): string {
  const entries = [...bundle.matchAll(moduleTableEntry)];
  const index = entries.findIndex(m => m[1].replaceAll("\\\\", "/") === file);
  expect(index, `${file} is not in the served bundle`).not.toBe(-1);
  const start = entries[index].index!;
  const end = index + 1 < entries.length ? entries[index + 1].index! : bundle.indexOf("\n}, {", start);
  expect(end).toBeGreaterThan(start);
  return bundle.slice(start, end).replace(/^ {2}/gm, "").trimEnd();
}

/** The files of the node_modules package `pkg` among `modules`, sorted. */
function packageFiles(modules: string[], pkg: string): string[] {
  const prefix = `node_modules/${pkg}/`;
  return modules
    .filter(file => file.startsWith(prefix))
    .map(file => file.slice(prefix.length))
    .sort();
}

/** The files of the node_modules package `pkg` that are in the bundle currently served for `route`. */
async function bundledPackageFiles(dev: Dev, route: string, pkg: string): Promise<string[]> {
  return packageFiles(servedModules(await servedClientBundle(dev, route)), pkg);
}

/** Writes a file back unchanged, like `dev.writeNoChanges`, without the post-write overlay poll. */
function touch(dev: Dev, file: string) {
  return dev.write(file, dev.read(file), { dedent: false, errors: null });
}

devTest("server routes: import identifier is not renamed, import_<name> collision, development condition", {
  framework: minimalFramework,
  files: {
    // Each route gets its own copy of `db.ts` so both generate the same `import_db` binding.
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
    await dev.patch("routes/identifier.ts", { find: "Hello", replace: "Bun" });
    await dev.fetch("/identifier").equals("Bun, 456!");

    // --- symbol collision with import identifier ---
    await dev.fetch("/collision").equals("Hello, 123, 987!");
    await dev.write("collision/db.ts", `export const abc = "456";`);
    await dev.fetch("/collision").equals("Hello, 456, 987!");

    // --- uses "development" condition ---
    await dev.fetch("/condition").equals("Environment: development");

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
  htmlFiles: ["before-created.html", "import-html.html", "import-bun.html", "text-loader.html"],
  async test(dev) {
    // Each failing case ends by fixing the file so the shared server has no bundling errors for the next case.

    // --- importing a file before it is created ---
    await expectBuildFailedPage(dev, "/before-created");
    {
      await using c = await dev.client("/before-created", {
        errors: [`before-created.ts:1:21: error: Could not resolve: "./second"`],
      });
      await c.expectReload(async () => {
        await dev.write("second.ts", `export const abc = "456";`, { errors: null });
      });
      await c.expectMessage("value: 456");
    }

    // --- importing html file ---
    await expectBuildFailedPage(dev, "/import-html");
    {
      await using c = await dev.client("/import-html", {
        errors: ["import-html.ts:1:18: error: Browser builds cannot import HTML files."],
      });
      await c.expectReload(async () => {
        await dev.write("import-html.ts", `console.log("html import removed");`, { errors: null });
      });
      await c.expectMessage("html import removed");
    }

    // --- importing bun on the client ---
    await expectBuildFailedPage(dev, "/import-bun");
    {
      await using c = await dev.client("/import-bun", {
        errors: ['import-bun.ts:1:17: error: Browser build cannot import Bun builtin: "bun"'],
      });
      await c.expectReload(async () => {
        await dev.write("import-bun.ts", `console.log("bun import removed");`, { errors: null });
      });
      await c.expectMessage("bun import removed");
    }

    // --- importing html file with text loader (#18154): bundles as a text module ---
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
    // --- import.meta.main is inlined as `false`, for ESM and CommonJS alike ---
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

      // A named default export stays a module-scope binding, so the HMR chunk exports the declaration itself.
      await touch(dev, "fixture4.ts");
      expect(await c.getMostRecentHmrChunk()).toMatch(/default:\s*class\s+MOVE\b/);
      await touch(dev, "fixture8.ts");
      expect(await c.getMostRecentHmrChunk()).toMatch(/default:\s*function\s+MOVE\b/);

      await touch(dev, "fixture7.ts");
      expect(await c.getMostRecentHmrChunk()).toMatch(/default:\s*function\b/);
      // fixture7.ts does not accept updates, so the update bubbles to default-export.ts, which re-runs its logs.
      await c.expectMessage("TWO", "FOUR", "FIVE", "SEVEN", "EIGHT", "NINE", "ELEVEN");
    }

    // --- commonjs forms: nothing accepts updates, so every rewrite of cjs.js reloads the page ---
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
          await dev.write("cjs.js", source, { errors: null });
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
    // Creating a file nothing imports yet must not rebuild anything.
    await c.expectNoWebSocketActivity(async () => {
      await dev.write("web/Test.ts", `export const abc = 456;`, { errors: null });
    });
    // The import only resolves if the directory cache entry for web/ was invalidated above.
    await dev.write(
      "web/index.ts",
      `
        import { abc } from "./Test.ts";
        console.log(abc);
      `,
      { errors: null },
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
      await dev.write("other.ts", `export const value = 456;`, { errors: null });
    });
    await c.expectMessage(456);
    // Deleting a file that is not part of the graph is not a rebuild.
    await c.expectNoWebSocketActivity(async () => {
      await dev.delete("unrelated.ts", { errors: null });
    });
    // A reload is only sent while the server has no bundling errors, so the deletion did not register one.
    await c.expectReload(async () => {
      await dev.write("other.ts", `export const value = 789;`, { errors: null });
    });
    await c.expectMessage(789);
  },
});
// Deleting a file whose last bundle failed used to leave that failure in dev.bundling_failures.
devTest("deleting a file that failed to bundle retracts its failure", {
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
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(123);
    await dev.write("other.ts", `export const value = ;`, {
      errors: ["other.ts:1:22: error: Unexpected ;"],
    });
    // The errors packet for this rebuild has to retract other.ts's failure along with adding index.ts's.
    await dev.delete("other.ts", {
      errors: ['index.ts:1:23: error: Could not resolve: "./other"'],
    });
    // A fresh page load lists every failure the dev server still tracks.
    await c.hardReload({
      errors: ['index.ts:1:23: error: Could not resolve: "./other"'],
    });
    // A stale other.ts entry would keep the page stuck on the error page.
    await c.expectReload(async () => {
      await dev.write("index.ts", `console.log("without other");`);
    });
    await c.expectMessage("without other");
    // Recreating the file reuses its node in the incremental graph, which no longer owns a failure.
    await dev.write(
      "index.ts",
      `
        import { value } from "./other";
        console.log(value);
      `,
      { errors: ['index.ts:1:23: error: Could not resolve: "./other"'] },
    );
    await c.expectReload(async () => {
      await dev.write("other.ts", `export const value = 456;`);
    });
    await c.expectMessage(456);
  },
});
// Same as above for a file that only the server graph knows about.
devTest("deleting a server file that failed to bundle retracts its failure", {
  skip: [
    "win32", // unlinkSync is having weird behavior
  ],
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      import { value } from '../db';
      export default function (req, meta) {
        return new Response('value: ' + value);
      }
    `,
    "db.ts": `export const value = 123;`,
  },
  async test(dev) {
    await dev.fetch("/").equals("value: 123");
    await dev.write("db.ts", `export const value = ;`, { errors: null });
    {
      // This client sits on the "Build Failed" page, which only listens for failures being added and removed.
      await using c = await dev.client("/", {
        errors: ["db.ts:1:22: error: Unexpected ;"],
      });
      await dev.delete("db.ts", {
        errors: [`routes/index.ts:1:23: error: Could not resolve: "../db"`],
      });
      await using fresh = await dev.client("/", {
        errors: [`routes/index.ts:1:23: error: Could not resolve: "../db"`],
      });
    }
    // Recreating the file reuses its node in the incremental graph, which no longer owns a failure.
    await dev.write("db.ts", `export const value = 456;`);
    await dev.fetch("/").equals("value: 456");
  },
});
// Demoting a client-component boundary frees the client-graph key a DirectoryWatchStore.Dep borrowed (UAF under ASAN).
devTest("removing 'use client' from a component with a pending resolution failure", {
  // separateSSRGraph so the "use client" file is parsed with the browser target and the client-graph key is borrowed.
  framework: separateSSRGraphFramework,
  files: {
    "routes/index.ts": `
      import * as Comp from '../components/Comp';
      import '../components/Sibling';
      export default function (req, meta) {
        return new Response('page: ' + (typeof Comp.marker));
      }
    `,
    // Only requested at the very end, to show the server is still serving.
    "routes/alive.ts": `
      export default function (req, meta) {
        return new Response('alive');
      }
    `,
    "components/Comp.ts": `
      "use client";
      export const marker = "initial";
    `,
    // Sibling.ts keeps a second Dep on the components/ watch alive; its import is never created.
    "components/Sibling.ts": `
      "use client";
      import './sibling-missing';
      export const sibling = 1;
    `,
  },
  async test(dev) {
    // Comp.ts bundles as a boundary; Sibling.ts fails, leaving a client-graph Dep on the components/ watch.
    await expectBuildFailedPage(dev, "/");

    // Re-bundle Comp.ts with a failing import while it is still a boundary: a Dep now borrows its client-graph key.
    await dev.write(
      "components/Comp.ts",
      `
        "use client";
        import { value } from './missing';
        export const marker = value;
      `,
      { errors: null },
    );

    // Demote it: disconnectAndDeleteFile frees the key string the Comp.ts Dep still references.
    await dev.write(
      "components/Comp.ts",
      `
        export const marker = "no-client";
      `,
      { errors: null },
    );

    // Fire the components/ watch: every Dep's source_file_path is dereferenced (UAF here before the fix).
    await dev.write("components/missing.ts", `export const value = "ok";`, { errors: null });

    // The server must still be alive: index still fails because of Sibling.ts, an untouched route renders.
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.fetch("/alive").equals("alive");
  },
});
devTest("removing 'use client' from a working component", {
  framework: separateSSRGraphFramework,
  files: {
    "routes/index.ts": `
      import * as Comp from '../components/Comp';
      export default function (req, meta) {
        return new Response('marker: ' + typeof Comp.marker);
      }
    `,
    "components/Comp.ts": `
      "use client";
      export const marker = "initial";
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("marker: object");
    await dev.write("components/Comp.ts", `export const marker = "plain";`);
    await dev.fetch("/").equals("marker: string");
  },
});
// Demoting a failing boundary deletes the client graph's node; its failure must leave the overlay with it.
devTest("removing 'use client' from a failing component clears the error overlay", {
  framework: {
    fileSystemRouterTypes: [
      {
        root: "routes",
        style: "nextjs-pages",
        serverEntryPoint: "./framework/server.ts",
        clientEntryPoint: "./framework/client.ts",
      },
    ],
    serverComponents: {
      separateSSRGraph: true,
      serverRuntimeImportSource: "./framework/server.ts",
      serverRegisterClientReferenceExport: "registerClientReference",
    },
  },
  files: {
    "framework/server.ts": `
      export function render(req, meta) {
        const scripts = meta.modules.map(src => '<script type="module" src="' + src + '"></script>').join("");
        return new Response("<!DOCTYPE html><html><body>" + meta.pageModule.default() + scripts + "</body></html>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      export function registerClientReference(value, file, uid) {
        return { value, file, uid };
      }
    `,
    "framework/client.ts": `
      console.log("marker: " + document.body.textContent);
    `,
    "routes/index.ts": `
      import * as Comp from '../components/Comp';
      export default () => typeof Comp.marker;
    `,
    "components/Comp.ts": `
      "use client";
      export const marker = "initial";
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("<body>object<");
    await dev.write(
      "components/Comp.ts",
      `
        "use client";
        import './missing';
        export const marker = "initial";
      `,
      { errors: null },
    );
    await using c = await dev.client("/", {
      errors: ['components/Comp.ts:2:8: error: Could not resolve: "./missing"'],
    });
    await c.expectReload(async () => {
      await dev.write("components/Comp.ts", `export const marker = "plain";`);
    });
    await c.expectMessage("marker: string");
  },
});
devTest("deinit with a free-list slot in DirectoryWatchStore.dependencies", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    // trackResolutionFailure runs for ./sub/a first (dep index 0) and ./sub/b second (dep index 1).
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
    await expectBuildFailedPage(dev, "/");

    {
      await using _ = await dev.batchChanges({ errors: null });
      // The rebuild has no failing imports, so nothing re-tracks and consumes the free-list slot.
      await dev.write("index.ts", `export {};`);
      // Firing the sub/ watch resolves dep 0 (./sub/a), pushing index 0 onto dependencies_free_list.
      await dev.write("sub/a.ts", `export {};`);
    }

    // The rebuilt, import-free page is served normally.
    expect(servedModules(await servedClientBundle(dev, "/"))).toEqual(["index.html", "index.ts"]);
    // Teardown's DevServer.deinit used to free the free-list slot's specifier again.
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
  /** The module importing from the package(s) under test; logs exactly one line. */
  consumer: string;
  log: string;
  files: Record<string, string>;
  /** Per package, exactly which of its files end up in the bundle; the rest were deferred. */
  bundled: Record<string, string[]>;
}

// Cases that only need a page to load once; one page imports every consumer, in this order.
const staticBarrelCases: StaticBarrelCase[] = [
  {
    name: "barrel optimization skips unused submodules",
    consumer: `
      import { Alpha } from 'barrel-skip';
      console.log('skip: ' + Alpha);
    `,
    log: "skip: ALPHA",
    // beta.js and gamma.js are syntax errors; the page only builds if they are never parsed.
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
    // Mirrors @refinedev/core -> @tanstack/react-query (export *) -> @tanstack/query-core (barrel).
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
      ...barrelPackage("outer-lib", {
        "index.js": `
          export * from 'inner-lib';
          export { Unrelated } from './unrelated.js';
        `,
        "unrelated.js": `export const Unrelated = "X";`,
      }),
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
    // outer-lib's unused re-export is still deferred; the export-star target is bundled whole.
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
    // The second import statement is deduplicated into the first; its named import must still be seen.
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

      // Importing a name that was deferred so far re-bundles the barrel; a reload because nothing accepts.
      const importNames = (names: string[]) =>
        c.expectReload(async () => {
          await dev.write(
            "add.ts",
            `
              import { ${names.join(", ")} } from 'barrel-add';
              console.log('result: ' + ${names.join(" + ' ' + ")});
            `,
            { errors: null },
          );
        });

      await importNames(["Alpha", "Beta"]);
      await c.expectMessage("result: ALPHA BETA");
      expect(await bundledPackageFiles(dev, "/add", "barrel-add")).toEqual(["alpha.js", "beta.js", "index.js"]);

      await importNames(["Alpha", "Beta", "Gamma"]);
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

      // Only multi-other.ts is edited; Alpha, requested by multi.ts, must survive the re-bundle.
      await c.expectReload(async () => {
        await dev.write(
          "multi-other.ts",
          `
            import { Beta, Gamma } from 'barrel-multi';
            export const value = Beta + ' ' + Gamma;
          `,
          { errors: null },
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
