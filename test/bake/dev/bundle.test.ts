// Bundling bugs that only occur in DevServer; independent cases share one dev server, one route each.
import type { Bake } from "bun";
import { expect } from "bun:test";
import { isWindows } from "harness";
import { readdirSync, readlinkSync } from "node:fs";
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
    expect(servedModules(bundle)).toStrictEqual(["app.html", "text-loader.html", "text-loader.ts"]);
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
    expect(servedModules(await servedClientBundle(dev, "/"))).toStrictEqual(["index.html", "index.ts"]);
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
        expect(packageFiles(modules, pkg), `${name}: files of ${pkg} in the bundle`).toStrictEqual(files);
      }
    }

    // --- barrel optimization: adding a new import triggers reload ---
    {
      await using c = await dev.client("/add");
      await c.expectMessage("result: ALPHA");
      expect(await bundledPackageFiles(dev, "/add", "barrel-add")).toStrictEqual(["alpha.js", "index.js"]);

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
      expect(await bundledPackageFiles(dev, "/add", "barrel-add")).toStrictEqual(["alpha.js", "beta.js", "index.js"]);

      await importNames(["Alpha", "Beta", "Gamma"]);
      await c.expectMessage("result: ALPHA BETA GAMMA");
      expect(await bundledPackageFiles(dev, "/add", "barrel-add")).toStrictEqual([
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
      expect(await bundledPackageFiles(dev, "/multi", "barrel-multi")).toStrictEqual([
        "alpha.js",
        "beta.js",
        "index.js",
      ]);

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
      expect(await bundledPackageFiles(dev, "/multi", "barrel-multi")).toStrictEqual([
        "alpha.js",
        "beta.js",
        "gamma.js",
        "index.js",
      ]);
    }
  },
});

// A separate-SSR-graph "use client" file's errors are owned by the client graph; the route importing it must still see them.
for (const mode of ["0", "1"]) {
  devTest(`route importing a failing "use client" file (BUN_ASSUME_PERFECT_INCREMENTAL=${mode})`, {
    framework: separateSSRGraphFramework,
    env: { BUN_ASSUME_PERFECT_INCREMENTAL: mode },
    files: {
      "routes/index.ts": `
        import { good } from '../good';
        import '../components/Sibling';
        export default function (req, meta) {
          return new Response('page: ' + good);
        }
      `,
      "good.ts": `export const good = "v1";`,
      "components/Sibling.ts": `
        "use client";
        import './sibling-missing';
        export const sibling = 1;
      `,
    },
    async test(dev) {
      const error = `Could not resolve: "./sibling-missing"`;
      await expectBuildFailedPage(dev, "/", error);
      await expectBuildFailedPage(dev, "/", error);

      await dev.write("good.ts", `export const good = "v2";`, { errors: null });
      await expectBuildFailedPage(dev, "/", error);

      // Creating the missing file re-bundles Sibling.ts through the directory watcher, now as a working component.
      await dev.write("components/sibling-missing.ts", `export {};`, { errors: null });
      await dev.fetch("/").equals("page: v2");

      // The same thing for a component that has already been bundled once.
      const otherError = `Could not resolve: "./other-missing"`;
      await dev.write(
        "components/Sibling.ts",
        `
          "use client";
          import './other-missing';
          export const sibling = 2;
        `,
        { errors: null },
      );
      await expectBuildFailedPage(dev, "/", otherError);
      await dev.write("good.ts", `export const good = "v3";`, { errors: null });
      await expectBuildFailedPage(dev, "/", otherError);
      await dev.write("components/other-missing.ts", `export {};`, { errors: null });
      await dev.fetch("/").equals("page: v3");
    },
  });
}
// Both boundaries end up in `client_components_affected`, which `finalize_bundle` appends to while walking it (ASAN).
devTest('"use client" file that fails to bundle, imported from another "use client" file', {
  framework: separateSSRGraphFramework,
  files: {
    "routes/index.ts": `
      import '../components/Comp';
      export default function (req, meta) {
        return new Response('page');
      }
    `,
    "components/Comp.ts": `
      "use client";
      import './Sibling';
      export const comp = 1;
    `,
    "components/Sibling.ts": `
      "use client";
      import './sibling-missing';
      export const sibling = 1;
    `,
  },
  async test(dev) {
    const error = `Could not resolve: "./sibling-missing"`;
    await expectBuildFailedPage(dev, "/", error);
    await dev.patch("routes/index.ts", { find: "'page'", replace: "'page2'", errors: null });
    await expectBuildFailedPage(dev, "/", error);
    await dev.write("components/sibling-missing.ts", `export {};`, { errors: null });
    await dev.fetch("/").equals("page2");
  },
});
// Dropping the directive while fixing the file deletes the client side of the boundary that never bundled.
devTest('removing "use client" from a file that never bundled', {
  framework: separateSSRGraphFramework,
  files: {
    "routes/index.ts": `
      import { sibling } from '../components/Sibling';
      export default function (req, meta) {
        return new Response('page: ' + sibling);
      }
    `,
    "components/Sibling.ts": `
      "use client";
      import './sibling-missing';
      export const sibling = 1;
    `,
  },
  async test(dev) {
    await expectBuildFailedPage(dev, "/", `Could not resolve: "./sibling-missing"`);
    await dev.write("components/Sibling.ts", `export const sibling = "server";`, { errors: null });
    await dev.fetch("/").equals("page: server");
  },
});
// The route's SSR copy imports the component as a plain SSR module; that must not count as a demotion.
devTest('deleting and re-creating a "use client" file that never bundled', {
  framework: separateSSRGraphFramework,
  files: {
    "routes/index.ts": `
      import '../components/Sibling';
      export default function (req, meta) {
        return new Response('page');
      }
    `,
    "components/Sibling.ts": `
      "use client";
      import './sibling-missing';
      export const sibling = 1;
    `,
  },
  async test(dev) {
    await expectBuildFailedPage(dev, "/", `Could not resolve: "./sibling-missing"`);
    await dev.delete("components/Sibling.ts", { errors: null });
    await expectBuildFailedPage(dev, "/", `Could not resolve: "../components/Sibling"`);
    await dev.write("components/Sibling.ts", `"use client"; export const sibling = 2;`, { errors: null });
    await dev.fetch("/").equals("page");
  },
});
// Same rule when everything bundles; whether the inner boundary got deleted depended on parse order.
devTest('working "use client" file imported from another "use client" file', {
  framework: separateSSRGraphFramework,
  files: {
    "routes/index.ts": `
      import '../components/Comp';
      export default function (req, meta) {
        return new Response('page');
      }
    `,
    "components/Comp.ts": `
      "use client";
      import './Sibling';
      export const comp = 1;
    `,
    "components/Sibling.ts": `
      "use client";
      export const sibling = 1;
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("page");
    // The inner component is still a boundary, so it is re-bundled as one.
    await dev.write("components/Sibling.ts", `"use client"; export const sibling = 2;`, { errors: null });
    await dev.fetch("/").equals("page");
  },
});
// Dropping the directive from a boundary that another client component still imports must keep its client-graph node (debug assert / tombstoned import).
devTest('removing "use client" from a file imported by another "use client" file', {
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
      import { comp } from '../components/Comp';
      console.log("marker: " + comp);
    `,
    "routes/index.ts": `
      import { comp } from '../components/Comp';
      export default () => 'page ' + typeof comp;
    `,
    "components/Comp.ts": `
      "use client";
      import { sibling } from './Sibling';
      export const comp = sibling;
    `,
    "components/Sibling.ts": `
      "use client";
      export const sibling = 1;
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("<body>page object<");
    await using c = await dev.client("/");
    await c.expectMessage("marker: 1");
    // The write re-bundles only the server copy, which drops the boundary. The client copy stays because Comp's client build imports it,
    // and is rebuilt as a plain module in a follow-up bundle. Comp does not accept that update, so the page reloads.
    await c.expectReload(async () => {
      await dev.write("components/Sibling.ts", `export const sibling = 2;`);
    });
    await c.expectMessage("marker: 2");
    await dev.fetch("/").expect.toInclude("<body>page object<");
  },
});
// A route first requested while another route's bundle is in flight, whose files that bundle already covers, has nothing left to bundle when its turn comes.
devTest("route deferred to the next bundle with no stale files left is answered", {
  framework: minimalFramework,
  files: {
    "routes/a.ts": `
      import { b } from './b';
      export default function (req, meta) {
        return new Response('a: ' + b);
      }
    `,
    "routes/b.ts": `
      export const b = "B";
      export default function (req, meta) {
        return new Response('b: ' + b);
      }
    `,
  },
  async test(dev) {
    // /b arrives while /a's bundle (which includes routes/b.ts) is still building.
    await Promise.all([dev.fetch("/a").equals("a: B"), dev.fetch("/b").equals("b: B")]);
  },
});
// Same, while an unrelated route's build error is still on record: the deferred route is traced for failures it can reach instead of
// being handed every recorded failure.
devTest("route deferred to the next bundle with no stale files left ignores unrelated failures", {
  framework: minimalFramework,
  files: {
    "routes/a.ts": `
      import { b } from './b';
      export default function (req, meta) {
        return new Response('a: ' + b);
      }
    `,
    "routes/b.ts": `
      export const b = "B";
      export default function (req, meta) {
        return new Response('b: ' + b);
      }
    `,
    "routes/c.ts": `
      import { broken } from '../broken';
      export default function (req, meta) {
        return new Response('c: ' + broken);
      }
    `,
    "broken.ts": `export const broken = ;`,
  },
  async test(dev) {
    await expectBuildFailedPage(dev, "/c", "broken.ts");
    // /b arrives while /a's bundle (which includes routes/b.ts) is still building; neither route reaches broken.ts.
    await Promise.all([dev.fetch("/a").equals("a: B"), dev.fetch("/b").equals("b: B")]);
  },
});
// `bun.app.ts` for the deferred-route tests below. Its plugin holds the first load of routes/held.ts until `/__release` sees one more
// request waiting on the server than `/__started` did, and makes flaky.ts fail to parse the first time it is bundled and only then,
// with no change on disk for the watcher to pick up.
const heldBundleFiles = {
  "bun.app.ts": `
    const hold = { armed: true, started: Promise.withResolvers(), release: Promise.withResolvers(), pending: 0 };
    let flakyLoads = 0;
    export default {
      app: {
        framework: ${JSON.stringify(minimalFramework)},
        plugins: [
          {
            name: "hold-and-flaky",
            setup(build) {
              build.onLoad({ filter: /held\\.ts$/ }, async args => {
                if (hold.armed) {
                  hold.armed = false;
                  hold.started.resolve();
                  await hold.release.promise;
                }
                return { loader: "ts", contents: await Bun.file(args.path).text() };
              });
              build.onLoad({ filter: /flaky\\.ts$/ }, () => ({
                loader: "ts",
                contents: flakyLoads++ === 0 ? "export const flaky = ;" : "export const flaky = 'fixed';",
              }));
            },
          },
        ],
      },
      routes: {
        "/__started": async (req, server) => {
          await hold.started.promise;
          hold.pending = server.pendingRequests;
          return new Response("started");
        },
        "/__release": async (req, server) => {
          // A request parked behind the held bundle keeps one more request pending than /__started saw.
          while (server.pendingRequests <= hold.pending) await new Promise(done => setImmediate(done));
          hold.release.resolve();
          return new Response("released");
        },
      },
    };
  `,
  // Requesting this records flaky.ts's failure and bundles routes/parked.ts on the way, so a later /parked has nothing stale of its own.
  "routes/first.ts": `
    import { flaky } from './parked';
    export default () => new Response('first: ' + flaky);
  `,
  "routes/parked.ts": `
    import { flaky } from '../flaky';
    export { flaky };
    export default () => new Response('parked: ' + flaky);
  `,
  "routes/held.ts": `
    export default () => new Response('held');
  `,
  "routes/render.ts": `
    export default () => { throw Response.render('/parked'); };
  `,
  "flaky.ts": `export const flaky = "on disk";`,
};
/** `expectBuildFailedPage` for a response that is already on its way. */
async function expectBuildFailedResponse(response: Promise<Response>, error: string) {
  const res = await response;
  const html = await res.text();
  expect(html).toContain(buildFailedTitle);
  expect(atob(html.match(/atob\("([^"]*)"\)/)![1])).toContain(error);
  expect(res.status).toBe(500);
}
/** Parks a request for /parked behind /held's first bundle, then lets that bundle finish. */
async function parkBehindHeldBundle(dev: Dev) {
  const held = dev.fetch("/held");
  await dev.fetch("/__started").equals("started");
  const parked = dev.fetch("/parked");
  await dev.fetch("/__release").equals("released");
  await held.equals("held");
  return parked;
}
// The route deferred behind another bundle has no stale files, but a failure recorded earlier is reachable from it: with perfect
// incremental bundling assumed, its parked request is answered with that failure and nothing is rebuilt.
devTest("route deferred to the next bundle that reaches a recorded failure gets the error page", {
  files: heldBundleFiles,
  env: { BUN_ASSUME_PERFECT_INCREMENTAL: "1" },
  async test(dev) {
    await expectBuildFailedPage(dev, "/first", "flaky.ts");
    await expectBuildFailedResponse(parkBehindHeldBundle(dev), "flaky.ts");
    await expectBuildFailedPage(dev, "/parked", "flaky.ts");
  },
});
// Same, without that assumption: the failure gets one rebuild of everything the route reaches, and the parked request rides it.
devTest("route deferred to the next bundle that reaches a recorded failure is rebuilt once", {
  files: heldBundleFiles,
  async test(dev) {
    await expectBuildFailedPage(dev, "/first", "flaky.ts");
    const parked = await parkBehindHeldBundle(dev);
    expect(await parked.text()).toBe("parked: fixed");
    expect(parked.status).toBe(200);
    await dev.fetch("/parked").equals("parked: fixed");
  },
});
// `Response.render()` to a route nobody requested yet goes through `bundleNewRoute`, whose promise is parked on the next bundle while
// the rendering route's own bundle is still being finalized. The target reaches the recorded failure: the promise rejects.
devTest("Response.render() to an unrequested route that reaches a recorded failure rejects", {
  files: heldBundleFiles,
  env: { BUN_ASSUME_PERFECT_INCREMENTAL: "1" },
  async test(dev) {
    await expectBuildFailedPage(dev, "/first", "flaky.ts");
    expect((await dev.fetch("/render")).status).toBe(500);
    // The target route was left in a state a plain request can pick up from.
    await expectBuildFailedPage(dev, "/parked", "flaky.ts");
    expect((await dev.fetch("/render")).status).toBe(500);
  },
});
// Same, without the assumption: the promise waits for the rebuild and resolves, and the target route is `Loaded` afterwards.
devTest("Response.render() to an unrequested route that reaches a recorded failure waits for its rebuild", {
  files: heldBundleFiles,
  async test(dev) {
    await expectBuildFailedPage(dev, "/first", "flaky.ts");
    await dev.fetch("/render").equals("parked: fixed");
    await dev.fetch("/parked").equals("parked: fixed");
  },
});
// `checkRouteFailures` must start from an empty `failures_added`, not the previous bundle's list.
devTest("route marked by an earlier failure does not report another route's errors", {
  framework: minimalFramework,
  env: { BUN_ASSUME_PERFECT_INCREMENTAL: "1" },
  files: {
    "routes/a.ts": `
      import { shared } from '../shared';
      import { a } from '../a';
      export default function (req, meta) {
        return new Response('a: ' + shared + a);
      }
    `,
    "routes/b.ts": `
      import { shared } from '../shared';
      export default function (req, meta) {
        return new Response('b: ' + shared);
      }
    `,
    "shared.ts": `export const shared = "s";`,
    "a.ts": `export const a = "a";`,
  },
  async test(dev) {
    await dev.fetch("/a").equals("a: sa");
    await dev.fetch("/b").equals("b: s");

    // Both routes import shared.ts, so both get marked as possibly failing.
    await dev.write("shared.ts", `import './missing'; export const shared = "s";`, { errors: null });
    await expectBuildFailedPage(dev, "/a", `shared.ts`);
    await expectBuildFailedPage(dev, "/b", `shared.ts`);

    // Fixing it does not revisit the routes; they stay marked until requested.
    await dev.write("shared.ts", `export const shared = "s";`, { errors: null });
    // Only /a imports a.ts.
    await dev.write("a.ts", `import './missing'; export const a = "a";`, { errors: null });

    await dev.fetch("/b").equals("b: s");
    await expectBuildFailedPage(dev, "/a", `a.ts`);
  },
});
devTest("requests for a route with build errors do not re-bundle it every time", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from "./other";
      console.log(value);
    `,
    "other.ts": `
      export const value = 1;
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(200);

    for (const broken of ["export const value = <<<SYNTAX_ERROR>>>;", "export const value = <<<ANOTHER_ONE>>>;"]) {
      await dev.write("other.ts", broken);

      // The first request after a file change re-bundles the route once, in case the incremental build got the failures wrong.
      const rebundled = dev.waitForHotReload(false);
      await expectBuildFailedPage(dev, "/");
      await rebundled;

      // Until another file changes, requests serve the failures that bundle produced.
      expect(
        await dev.countBundles(async () => {
          for (let i = 0; i < 5; i++) {
            await expectBuildFailedPage(dev, "/");
          }
        }),
      ).toBe(0);
    }

    await dev.write("other.ts", "export const value = 2;");
    expect((await dev.fetch("/")).status).toBe(200);
  },
});
devTest("re-bundling a watched file does not leak a file descriptor (counted through /proc, so linux only)", {
  skip: ["win32", "darwin"],
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from "./other";
      console.log(value);
    `,
    "other.ts": `
      export const value = 0;
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(200);

    const other = dev.join("other.ts");
    const fdDir = `/proc/${dev.devProcess.pid}/fd`;
    const descriptorsForOther = () => {
      let count = 0;
      for (const fd of readdirSync(fdDir)) {
        let target: string;
        try {
          target = readlinkSync(`${fdDir}/${fd}`);
        } catch {
          continue;
        }
        if (target === other) count++;
      }
      return count;
    };

    // The watcher keeps one descriptor; each re-bundle opens another to read the file, which must be closed once the watcher declines it.
    const before = descriptorsForOther();
    for (let i = 1; i <= 5; i++) {
      await dev.write("other.ts", `export const value = ${i};`);
    }
    expect(descriptorsForOther()).toBe(before);
  },
});
devTest("importing a file with the html loader through an import attribute", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import html from "./partial.mustache" with { type: "html" };
      console.log(html);
    `,
    "partial.mustache": "<div>{{hello}}</div>",
  },
  async test(dev) {
    // Used to pass the extension-only check and crash the dev server with an html chunk for a non-route file.
    await using c = await dev.client("/", {
      errors: ["index.ts:1:18: error: Browser builds cannot import HTML files."],
    });
  },
});
devTest("plugin loading an imported file with the html loader", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "tpl-as-html",
        setup(build) {
          build.onLoad({ filter: /\\.tpl$/ }, () => ({ contents: "<div>hello</div>", loader: "html" }));
        },
      };
    `,
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import "./partial.tpl";
    `,
    "partial.tpl": "hello",
  },
  async test(dev) {
    // Nothing rejects the loader before the bundle finishes; it used to crash the dev server.
    await using c = await dev.client("/", {
      errors: [
        "partial.tpl: error: Only the HTML files served as routes can be bundled with the html loader in development.",
      ],
    });
  },
});
devTest("editing an html file imported with the text loader (#22533, #24893)", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
      body: "<p>root document</p>",
    }),
    "index.ts": `
      import html from "./app.html" with { type: "text" };
      console.log(html);
    `,
    "app.html": "<div>first</div>",
  },
  htmlFiles: ["index.html"],
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("<div>first</div>");

    // The rebundle used to pick the loader from the extension: crash as an html route (#22533) or served as the root document (#24893).
    await c.expectReload(async () => {
      await dev.write("app.html", "<div>second</div>");
    });
    await c.expectMessage("<div>second</div>");
    await dev.fetch("/").expect.toInclude("<p>root document</p>");

    await c.expectReload(async () => {
      await dev.write("app.html", "<div>third</div>");
    });
    await c.expectMessage("<div>third</div>");
    await dev.fetch("/").expect.toInclude("<p>root document</p>");
  },
});
devTest("editing a text-imported html file that an onResolve plugin claims (#22533)", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    // Entry points are resolved by the plugin, so the rebundle takes the plugin resolution path.
    "plugin.ts": `
      export default {
        name: "resolve-html-entry-points",
        setup(build) {
          build.onResolve({ filter: /\\.html$/ }, args => (args.importer ? undefined : { path: args.path }));
        },
      };
    `,
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import html from "./app.html" with { type: "text" };
      console.log(html);
    `,
    "app.html": "<div>first</div>",
  },
  htmlFiles: ["index.html"],
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("<div>first</div>");

    await c.expectReload(async () => {
      await dev.write("app.html", "<div>second</div>");
    });
    await c.expectMessage("<div>second</div>");
  },
});
devTest("editing files imported with a loader other than their extension's keeps that loader (#24893, #23299)", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import template from "./template.mustache" with { type: "text" };
      import data from "./data.json" with { type: "text" };
      import snippet from "./snippet.ts" with { type: "text" };
      console.log(template);
      console.log(typeof data + ":" + data);
      console.log(snippet);
    `,
    "template.mustache": "{{first}}",
    "data.json": `{"version":1}`,
    "snippet.ts": `console.log("snippet ran");`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("{{first}}", 'string:{"version":1}', 'console.log("snippet ran");');

    // The rebundle used to use the extension's loader: an asset URL, an object and a module that runs.
    await c.expectReload(async () => {
      await dev.write("template.mustache", "{{second}}");
    });
    await c.expectMessage("{{second}}", 'string:{"version":1}', 'console.log("snippet ran");');

    await c.expectReload(async () => {
      await dev.write("data.json", `{"version":2}`);
    });
    await c.expectMessage("{{second}}", 'string:{"version":2}', 'console.log("snippet ran");');

    await c.expectReload(async () => {
      await dev.write("snippet.ts", `console.log("snippet ran again");`);
    });
    await c.expectMessage("{{second}}", 'string:{"version":2}', 'console.log("snippet ran again");');
  },
});
devTest("dropping an import attribute rebundles the file with its extension's loader", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import t from "./data.ts" with { type: "text" };
      console.log("t:" + typeof t);
    `,
    "data.ts": `
      export const x = 1;
      console.log("data ran");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("t:string");

    // data.ts is cached as a text module; the importer no longer asks for that loader.
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
          import { x } from "./data.ts";
          console.log("x:" + x);
        `,
      );
    });
    await c.expectMessage("data ran", "x:1");

    // The rebundle of data.ts itself used to reuse the recorded text loader.
    await c.expectReload(async () => {
      await dev.write(
        "data.ts",
        `
          export const x = 2;
          console.log("data ran");
        `,
      );
    });
    await c.expectMessage("data ran", "x:2");
  },
});
devTest("deleting a file imported by a module loaded through an import attribute", {
  skip: [
    "win32", // unlinkSync is having weird behavior
  ],
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import "./app.txt" with { type: "js" };
    `,
    "app.txt": `
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

    // The importer's rebundle must keep the js loader for the unresolved import to be reported.
    await dev.delete("other.ts", {
      errors: ['app.txt:1:23: error: Could not resolve: "./other"'],
    });
  },
});
devTest("editing an html file imported with the text loader on the server (#22533)", {
  framework: minimalFramework,
  // Keep template.html from being registered as an HTML route.
  htmlFiles: [],
  files: {
    "template.html": "<p>template</p>",
    "routes/index.ts": `
      import template from '../template.html' with { type: 'text' };
      export default function (req, meta) {
        return new Response(template);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("<p>template</p>");

    // The rebundle used to crash the dev server (`dev.write` rejects); the updated text is a separate HMR runtime bug.
    await dev.write("template.html", "<p>template 2</p>");
    await dev.write("template.html", "<p>template 3</p>");
    await dev.fetch("/").expect.toStartWith("<p>template");
  },
});
devTest("editing a server file imported with a loader other than its extension's keeps that loader", {
  framework: minimalFramework,
  files: {
    "message.txt": `export const message = "first";`,
    "routes/index.ts": `
      import { message } from '../message.txt' with { type: 'js' };
      export default function (req, meta) {
        return new Response(message);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("first");
    // The rebundle used to use the text loader, leaving no "message" export.
    await dev.write("message.txt", `export const message = "second";`);
    await dev.fetch("/").equals("second");
    await dev.write("message.txt", `export const message = "third";`);
    await dev.fetch("/").equals("third");
  },
});
devTest("a file whose first bundle fails is still rebundled with the loader its import chose", {
  framework: minimalFramework,
  files: {
    "message.txt": `export const message = ;`,
    "routes/index.ts": `
      import { message } from '../message.txt' with { type: 'js' };
      export default function (req, meta) {
        return new Response(message);
      }
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    // The failed attempt is the only bundle so far; the fix must still use the js loader.
    await dev.write("message.txt", `export const message = "first";`);
    await dev.fetch("/").equals("first");
    await dev.write("message.txt", `export const message = "second";`);
    await dev.fetch("/").equals("second");
  },
});
devTest("an html route that client code also imports as text is still bundled as the route", {
  files: {
    "main.html": emptyHtmlFile({
      styles: [],
      scripts: ["main.ts"],
    }),
    "main.ts": `
      import about from "./about.html" with { type: "text" };
      console.log(typeof about);
    `,
    "about.html": emptyHtmlFile({
      styles: [],
      scripts: [],
      body: "<p>about, first</p>",
    }),
  },
  async test(dev) {
    // Bundling /main records about.html as a text module before the route is requested; the route must not pick up that loader.
    await dev.fetch("/main").expect.toInclude("<script");
    await dev.fetch("/about").expect.toInclude("<p>about, first</p>");

    await dev.write(
      "about.html",
      emptyHtmlFile({
        styles: [],
        scripts: [],
        body: "<p>about, second</p>",
      }),
    );
    await dev.fetch("/about").expect.toInclude("<p>about, second</p>");
  },
});

// Longer than MAX_PATH_BYTES (4 KiB posix, ~96 KiB Windows); used to overflow the resolver's join buffer and abort.
const specifierLongerThanPathBuffer = Buffer.alloc((isWindows ? 96 : 4) * 1024 + 1024, "a").toString();

devTest("unresolvable relative import longer than the path buffer is a bundling error", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import './${specifierLongerThanPathBuffer}';
      console.log('loaded');
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("index.ts", `console.log('fixed');`);
    expect((await dev.fetch("/")).status).toBe(200);
  },
});

// A CSS url() without "./" skips the resolver's directory cache busting, so only DirectoryWatchStore.track_resolution_failure sees it.
devTest("unresolvable css url() longer than the path buffer is a bundling error", {
  files: {
    "index.html": emptyHtmlFile({ styles: ["styles.css"] }),
    "styles.css": `
      body {
        background-image: url(${specifierLongerThanPathBuffer});
      }
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("styles.css", `body { color: blue; }`);
    expect((await dev.fetch("/")).status).toBe(200);
  },
});
// Module ids are relative to the dev server root, not the live cwd: `app.root` below the cwd, and chdir() after creation.
devTest("app.root that is not the cwd", {
  files: {
    "bun.app.ts": `
      import path from "node:path";
      export default {
        app: {
          root: path.join(process.cwd(), "app"),
          framework: {
            fileSystemRouterTypes: [
              {
                root: "app/routes",
                style: "nextjs-pages",
                serverEntryPoint: "./app/server.ts",
                clientEntryPoint: "./app/client.ts",
              },
            ],
          },
        },
      };
    `,
    "app/server.ts": `
      export function render(req, meta) {
        const scripts = meta.modules.map(src => '<script type="module" src="' + src + '"></script>').join("");
        return new Response("<!DOCTYPE html><html><body><p>" + meta.pageModule.default() + "</p>" + scripts + "</body></html>", {
          headers: { "Content-Type": "text/html" },
        });
      }
    `,
    "app/client.ts": `
      console.log("client loaded");
    `,
    "app/message.ts": `
      export const message = "Hello";
    `,
    "app/routes/index.ts": `
      import { message } from "../message";
      export default () => message;
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("<p>Hello</p>");

    await using c = await dev.client("/");
    await c.expectMessage("client loaded");

    // Server-side changes make connected clients reload the page.
    await c.expectReload(async () => {
      await dev.write("app/message.ts", `export const message = "Updated";`);
    });
    await c.expectMessage("client loaded");
    await dev.fetch("/").expect.toInclude("<p>Updated</p>");
  },
});
devTest("process.chdir() after the server was created", {
  files: {
    // Root-absolute specifiers resolve against the project root too.
    "index.html": emptyHtmlFile({
      scripts: ["index.ts", "/rooted.ts"],
    }),
    "index.ts": `
      console.log("loaded");
      import.meta.hot.accept();
    `,
    "rooted.ts": `
      console.log("rooted loaded");
    `,
    "elsewhere/placeholder.txt": "",
    "bun.app.ts": `
      import html from "./index.html";
      export default {
        routes: {
          "/": html,
          "/chdir": () => {
            process.chdir("elsewhere");
            return new Response("ok");
          },
        },
        fetch() {
          return new Response("Not Found", { status: 404 });
        },
      };
    `,
  },
  htmlFiles: [],
  async test(dev) {
    // Nothing is bundled yet, so the first bundle and the hot update both happen after the chdir.
    await dev.fetch("/chdir").equals("ok");

    await using c = await dev.client("/");
    await c.expectMessageInAnyOrder("loaded", "rooted loaded");

    await dev.write(
      "index.ts",
      `
        console.log("updated");
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("updated");
  },
});

// Every rebuild re-resolves the import records of the files it re-bundles, and
// `Path::dupe_alloc` used to append each resolved path to the process-lifetime
// FilenameStore every time, so a dev server grew by one copy of every import's
// path per rebuild for as long as it ran (here: the entry plus its
// PATH_STORE_MODULES imports per edit). The edited file is kept in a directory
// of its own so that the files whose paths are being counted are only ever
// re-resolved, never re-read from disk.
const PATH_STORE_MODULES = 20;
const PATH_STORE_EDITS = 5;
function pathStoreEntry(edit: number) {
  return (
    Array.from({ length: PATH_STORE_MODULES }, (_, i) => `import { v${i} } from "../lib/m${i}.ts";`).join("\n") +
    `\nimport.meta.hot.accept();\nconsole.log("edit ${edit}: " + (${Array.from({ length: PATH_STORE_MODULES }, (_, i) => `v${i}`).join(" + ")}));\n`
  );
}
devTest("rebuilding after an edit does not intern the imported files' paths again", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["src/entry.ts"] }),
    "src/entry.ts": pathStoreEntry(0),
    ...Object.fromEntries(
      Array.from({ length: PATH_STORE_MODULES }, (_, i) => [`lib/m${i}.ts`, `export const v${i} = ${i};\n`]),
    ),
    // The harness-generated config only serves the HTML; the counts have to be
    // read inside the dev server's process, so serve them from a route.
    "bun.app.ts": `
      import { bundlerInternals } from "bun:internal-for-testing";
      import html from "./index.html";
      export default {
        static: { "/": html },
        fetch(req) {
          if (new URL(req.url).pathname === "/path-store-counts") {
            return Response.json(bundlerInternals.pathStoreCounts());
          }
          return new Response("Not Found", { status: 404 });
        },
      };
    `,
  },
  htmlFiles: [],
  async test(dev) {
    const counts = () => dev.fetch("/path-store-counts").json();
    const sum = (PATH_STORE_MODULES * (PATH_STORE_MODULES - 1)) / 2;
    await using c = await dev.client("/");
    await c.expectMessage(`edit 0: ${sum}`);
    const before = await counts();
    for (let edit = 1; edit <= PATH_STORE_EDITS; edit++) {
      await dev.write("src/entry.ts", pathStoreEntry(edit));
      await c.expectMessage(`edit ${edit}: ${sum}`);
    }
    const after = await counts();
    expect({
      filenames: after.filenames - before.filenames,
      dirnames: after.dirnames - before.dirnames,
    }).toEqual({ filenames: 0, dirnames: 0 });
  },
});
