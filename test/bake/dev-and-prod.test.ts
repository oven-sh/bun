// Tests which apply to both dev and prod. They are run twice.
import { expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { devAndProductionTest, devTest, emptyHtmlFile, WAIT_MULTIPLIER } from "./bake-harness";

const hmrSelfAcceptingModule = (label: string) => `
  console.log(${JSON.stringify(label)});
  if (import.meta.hot) {
    import.meta.hot.accept();
  }
`;

devAndProductionTest("define config via bunfig.toml", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("a=" + DEFINE);
    `,
    "bunfig.toml": `
      [serve.static]
      define = {
        "DEFINE" = "\\"HELLO\\""
      }
    `,
  },
  async test(dev) {
    const c = await dev.client("/");
    await c.expectMessage("a=HELLO");
  },
});
devAndProductionTest("invalid html does not crash 1", {
  files: {
    "public/index.html": `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dashboard</title>
          <link rel="stylesheet" href="../src/app/styles.css" />
        </head>
        <body>
          <div id="root" />
          <script type="module" src="../src/app/index.tsx" />
        </body>
      </html>
    `,
    "src/app/index.tsx": `
      console.log("hello");
    `,
    "src/app/styles.css": `
      body {
        background-color: red;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");
  },
});
devAndProductionTest("missing head end tag works fine", {
  files: {
    "public/index.html": `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dashboard</title>
          <link rel="stylesheet" href="../src/app/styles.css"></link>
        <body>
          <div id="root" />
          <script type="module" src="../src/app/index.tsx"></script>
        </body>
      </html>
    `,
    "src/app/index.tsx": `
      console.log("hello");
    `,
    "src/app/styles.css": `
      body {
        background-color: red;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");
  },
});
devAndProductionTest("missing all meta tags works fine", {
  files: {
    "public/index.html": `
      <title>Dashboard</title>
      <link rel="stylesheet" href="../src/app/styles.css"></link>

      <div id="root" />
      <script type="module" src="../src/app/index.tsx"></script>
    `,
    "src/app/index.tsx": `
      console.log("hello");
    `,
    "src/app/styles.css": `
      body {
        background-color: red;
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("root");
    await using c = await dev.client("/");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");
  },
});
devAndProductionTest("inline script and styles appear", {
  files: {
    "public/index.html": `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dashboard</title>
          <style> body { background-color: red; } </style>
        </head>
        <body>
          <script> console.log("hello " + (1 + 2)); </script>
        </body>
      </html>
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("hello");
    await dev.fetch("/").expect.not.toInclude("hello 3"); // TODO:
    await using c = await dev.client("/");
    await c.expectMessage("hello 3");
    await c.style("body").backgroundColor.expect.toBe("red");
  },
});
// TODO: revive production
devTest("using runtime import", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      // __using
      {
        using a = { [Symbol.dispose]: () => console.log("a") };
        console.log("b");
      }

      // __legacyDecorateClassTS
      function undefinedDecorator(target) {
        console.log("decorator");
      }
      @undefinedDecorator
      class x {}

      // __require
      const A = () => require;
      const B = () => module.require;
      const C = () => import.meta.require;
      if (import.meta.hot) {
        console.log(A.toString().replaceAll(" ", "").replaceAll("\\n", ""));
        console.log(B.toString().replaceAll(" ", "").replaceAll("\\n", ""));
        console.log(C.toString().replaceAll(" ", "").replaceAll("\\n", ""));
        console.log(A() === eval("hmr.require"));
        console.log(B() === eval("hmr.require"));
        console.log(C() === eval("hmr.require"));
        if (typeof A() !== "function") throw new Error("A is not a function");
        if (typeof B() !== "function") throw new Error("B is not a function");
        if (typeof C() !== "function") throw new Error("C is not a function");
      }
    `,
    "tsconfig.json": `
      {
        "compilerOptions": {
          "experimentalDecorators": true
        }
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(
      "b",
      "a",
      "decorator",
      ...(dev.nodeEnv === "development"
        ? [
            // TODO: all of these should be `hmr.require`
            "()=>hmr.require",
            "()=>module.require", // not being visited
            "()=>hmr.importMeta.require", // not being visited
            true,
            false,
            false,
          ]
        : []),
    );
  },
});
devTest("hmr handles rapid consecutive edits", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": hmrSelfAcceptingModule("render initial"),
  },
  async test(dev) {
    // allowUnlimitedReloads (Windows-only): writeFileSync on Windows is
    // CreateFile(truncate) + WriteFile + CloseHandle as separate syscalls;
    // ReadDirectoryChangesW in the dev-server process can fire between the
    // first two and bundle a 0-byte module that never calls accept(),
    // tripping fullReload(). Rather than skip Windows entirely, let the
    // client absorb the reload there — the reloaded page still logs the
    // expected value and the test proceeds. On POSIX leave it off so an
    // unexpected fullReload still fails the test.
    await using client = await dev.client("/", {
      allowUnlimitedReloads: process.platform === "win32",
    });
    await client.expectMessage("render initial");

    const waitForMessage = (value: string) =>
      new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          timer = null;
          cleanup();
          reject(
            new Error(`Timed out waiting for ${JSON.stringify(value)}; buffered: ${JSON.stringify(client.messages)}`),
          );
        }, 5_000 * WAIT_MULTIPLIER);
        const cleanup = () => {
          if (timer !== null) clearTimeout(timer);
          client.off("message", onMessage);
          client.off("exit", onExit);
        };
        const onMessage = () => {
          if (client.messages.includes(value)) {
            cleanup();
            resolve();
          }
        };
        // The harness emits "exit" before setting `client.exited`, so a
        // dedicated listener is needed; reading `client.exited` inside a
        // shared handler would still be `false` when "exit" fires.
        const onExit = () => {
          cleanup();
          reject(new Error(`Client exited while waiting for ${JSON.stringify(value)}`));
        };
        if (client.exited) return onExit();
        client.on("message", onMessage);
        client.on("exit", onExit);
        onMessage();
      });

    // Regression coverage for https://github.com/oven-sh/bun/issues/19736:
    // when multiple hot_update payloads with the SAME sourceMapId reach the
    // client before earlier <script> callbacks fire, the runtime must queue
    // them (Map<id, entry[]>) rather than overwrite (Map<id, entry>, which
    // threw "Unknown HMR script: ...").
    //
    // Writing IDENTICAL content N times forces same-sourceMapId duplicates
    // on every platform. Use synchronous writeFileSync so truncate + write
    // + close happen back-to-back on the calling thread; the previous
    // `Bun.write` here is two separate async libuv ops on Windows with a
    // JS-thread round-trip in between, giving the bundler a multi-ms window
    // to read 0 bytes. writeFileSync shrinks that window to microseconds —
    // usually enough, but the residual race is why allowUnlimitedReloads is
    // set above.
    const target = dev.join("index.ts");
    const rapidContent = hmrSelfAcceptingModule("render rapid");
    for (let i = 0; i < 10; i++) {
      writeFileSync(target, rapidContent);
    }

    // Wait until at least one rapid hot_update has been applied.
    await waitForMessage("render rapid");

    // Barrier: one more write, then wait for it to appear at the client.
    // Hot-updates are delivered over a single ordered WebSocket and applied
    // FIFO, so once the sentinel's console.log arrives every prior update
    // already in the pipe has been applied. Don't use dev.batchChanges()
    // here: if a bundle from the rapid burst is still in flight when the
    // batch 'H' arrives, the harness's seenFiles promise can hang.
    //
    // The sentinel must be re-written whenever the client fixture reports a
    // reload or an HMR-socket event: on Windows the 0-byte race can force a
    // fullReload() (see allowUnlimitedReloads above), and after a full page
    // reload the user module's console.log reaches this process via IPC
    // BEFORE the new HMR WebSocket has subscribed + sent SetUrl. If the
    // sentinel is written in that window its bundle is finalized while
    // `num_subscribers(HotUpdate) == 0` / `active_viewers == 0` and the
    // hot_update is dropped server-side (DevServer.rs finalize_bundle), so
    // the sentinel never reaches the client. Re-writing on each
    // `received-hmr-event` (which fires on socket open and on every 'u'/'e'
    // WS frame) guarantees that at least one sentinel write lands after the
    // server has a subscriber. The same-content writes are idempotent and
    // the loop terminates the moment waitForMessage resolves below.
    const sentinelContent = hmrSelfAcceptingModule("render sentinel");
    const rewriteSentinel = () => writeFileSync(target, sentinelContent);
    client.on("reload", rewriteSentinel);
    client.on("received-hmr-event", rewriteSentinel);
    try {
      rewriteSentinel();
      await waitForMessage("render sentinel");
    } finally {
      client.off("reload", rewriteSentinel);
      client.off("received-hmr-event", rewriteSentinel);
    }

    // Watcher coalescing / double-firing makes the exact count
    // non-deterministic, but every message must be one of the two values
    // we wrote. If #19736 regresses, "Unknown HMR script: ..." is thrown
    // inside the bun:hmr callback, which propagates as an unhandled
    // rejection in client-fixture.mjs and exits the subprocess non-zero —
    // failing this test at disposal without an explicit assertion here.
    const expected = new Set(["render rapid", "render sentinel"]);
    for (const msg of client.messages) {
      if (!expected.has(msg)) {
        throw new Error(`Unexpected HMR message: ${JSON.stringify(msg)}`);
      }
    }
    client.messages.length = 0;

    // The barrier guarantees ordering of in-flight updates but does not
    // bound how many bundles the server may still start (e.g. a queued
    // next_bundle.reload_event, or the sentinel write's IN_MODIFY and
    // IN_CLOSE_WRITE landing in separate inotify reads). Keep a listener
    // active through `await using` disposal that swallows expected values
    // so only genuinely unexpected output trips the unread-messages check.
    client.on("message", (m: unknown) => {
      if (expected.has(m as string)) {
        const i = client.messages.indexOf(m);
        if (i !== -1) client.messages.splice(i, 1);
      }
    });
  },
});

// `bun build` gives a file its default import of a CommonJS module by the module type of that file:
// `__toESM(x, 1)` in an ES module by type (".mjs", ".mts", "type": "module"), where the default is always
// `module.exports`, and `__toESM(x)` in every other file, where a truthy `exports.__esModule` with an own
// `default` makes it `exports.default`. The dev server has to hand each importer the same namespace.
const commonJSPackage = (name: string, index: string, packageJSON: object = {}) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", main: "index.js", ...packageJSON }),
  [`node_modules/${name}/index.js`]: index,
});
// What Babel emits for `export default function Modal() {}; export const x = 1;`
const babelDefault = `
  "use strict";
  exports.__esModule = true;
  exports.default = void 0;
  function Modal() {}
  var _default = Modal;
  exports.default = _default;
  exports.x = 1;
`;
const which = `
  const which = (value, exports) =>
    value === exports ? "module.exports" : value === exports.default ? "exports.default" : typeof value;
`;
// The same source is an importer of every module type below.
const importerOfCommonJS = `
  import d, { default as named, x } from "babel-default";
  import * as ns from "babel-default";
  import tsc from "tsc-default";
  import functionValued from "function-valued";
  import lateDefault from "late-default";
  import truthyFlag from "flag-truthy";
  import inheritedFlag from "flag-inherited";
  import undefinedDefault from "default-undefined";
  import inheritedDefault from "default-inherited";
  import flagWithoutDefault from "flag-without-default";
  import flagFalse from "flag-false";
  import plain from "plain";
  import number from "exports-42";
  import zero from "exports-0";
  import emptyString from "exports-empty-string";
  import nothing from "exports-null";
  import undef from "exports-undefined";
  import twoHops from "two-hops";
  import { inherited } from "class-instance";
  import json from "data/data.json";
  import * as list from "data/list.json";
  import * as text from "data/text.txt";
  export { default as reexported } from "babel-default";
  ${which}
  export const read = async () => ({
    "import d": which(d, require("babel-default")),
    "import { default as d }": which(named, require("babel-default")),
    "ns.default": which(ns.default, require("babel-default")),
    "import()": which((await import("babel-default")).default, require("babel-default")),
    "__esModule from Object.defineProperty (tsc)": which(tsc, require("tsc-default")),
    "function-valued module.exports": which(functionValued, require("function-valued")),
    "default assigned after the import": which(lateDefault, require("late-default")),
    "__esModule = 1": which(truthyFlag, require("flag-truthy")),
    "inherited __esModule": which(inheritedFlag, require("flag-inherited")),
    "own default that is undefined": which(undefinedDefault, require("default-undefined")),
    "inherited default": which(inheritedDefault, require("default-inherited")),
    "__esModule without default": which(flagWithoutDefault, require("flag-without-default")),
    "__esModule = false": which(flagFalse, require("flag-false")),
    "plain CommonJS": which(plain, require("plain")),
    "module.exports = 42, 0, '', null, undefined": [number, zero, emptyString, nothing, typeof undef],
    "export { default } from, two files deep in a package without type": which(twoHops, require("babel-default")),
    "JSON with __esModule and default keys": json,
    "members that a JSON array or a text file has": [typeof list.join, Symbol.iterator in list, typeof text.trim],
    "import { x }": x,
    "Object.keys(ns)": Object.keys(ns).sort(),
    "typeof ns.hasOwnProperty": typeof ns.hasOwnProperty,
    "a member module.exports inherits": typeof inherited,
    "import() is the namespace of import *": (await import("babel-default")) === ns,
    "import() of a module.exports that inherits then": await import("thenable").then(
      () => "resolved",
      e => e.constructor.name,
    ),
    "Object.keys(require())": Object.keys(require("babel-default")).sort(),
  });
`;
{
  const everyImporter = {
    "inherited default": "module.exports",
    "__esModule without default": "module.exports",
    "__esModule = false": "module.exports",
    "plain CommonJS": "module.exports",
    "module.exports = 42, 0, '', null, undefined": [42, 0, "", null, "undefined"],
    "export { default } from, two files deep in a package without type": "exports.default",
    "JSON with __esModule and default keys": { __esModule: true, default: 5, x: 1 },
    "members that a JSON array or a text file has": ["undefined", false, "undefined"],
    "import { x }": 1,
    "Object.keys(ns)": ["__esModule", "default", "x"],
    "typeof ns.hasOwnProperty": "function",
    "a member module.exports inherits": "function",
    "import() is the namespace of import *": true,
    "import() of a module.exports that inherits then": "TypeError",
    "Object.keys(require())": ["__esModule", "default", "x"],
  };
  const defaultImports = (value: "exports.default" | "module.exports") => ({
    "import d": value,
    "import { default as d }": value,
    "ns.default": value,
    "import()": value,
    "export { default } from": value,
    "__esModule from Object.defineProperty (tsc)": value,
    "function-valued module.exports": value,
    "default assigned after the import": value,
    "__esModule = 1": value,
    "inherited __esModule": value,
    "own default that is undefined": value,
    ...everyImporter,
  });
  devAndProductionTest("the default import of a CommonJS module follows the module type of the importer", {
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      ...commonJSPackage("babel-default", babelDefault),
      ...commonJSPackage(
        "tsc-default",
        `"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); class Service {} exports.default = Service;`,
      ),
      ...commonJSPackage(
        "function-valued",
        `function whole() {} whole.__esModule = true; whole.default = function inner() {}; module.exports = whole;`,
      ),
      ...commonJSPackage(
        "late-default",
        `exports.__esModule = true; exports.default = "before"; exports.assign = value => { exports.default = value; };`,
      ),
      ...commonJSPackage("flag-truthy", `exports.__esModule = 1; exports.default = "D";`),
      ...commonJSPackage(
        "flag-inherited",
        `module.exports = Object.create({ __esModule: true }); module.exports.default = "D";`,
      ),
      ...commonJSPackage("default-undefined", `exports.__esModule = true; exports.default = undefined;`),
      ...commonJSPackage(
        "default-inherited",
        `module.exports = Object.create({ default: "inherited" }); module.exports.__esModule = true;`,
      ),
      ...commonJSPackage("flag-without-default", `exports.__esModule = true; exports.x = 1;`),
      ...commonJSPackage("flag-false", `exports.__esModule = false; exports.default = "D"; exports.x = 1;`),
      ...commonJSPackage("plain", `exports.x = 1;`),
      ...commonJSPackage("exports-42", `module.exports = 42;`),
      ...commonJSPackage("exports-0", `module.exports = 0;`),
      ...commonJSPackage("exports-empty-string", `module.exports = "";`),
      ...commonJSPackage("exports-null", `module.exports = null;`),
      ...commonJSPackage("exports-undefined", `module.exports = undefined;`),
      ...commonJSPackage("two-hops", `export { default } from "./hop.js";`),
      "node_modules/two-hops/hop.js": `export { default } from "babel-default";`,
      ...commonJSPackage("class-instance", `class Store { inherited() {} } module.exports = new Store();`),
      ...commonJSPackage("thenable", `module.exports = Promise.resolve(42);`),
      "node_modules/data/data.json": `{ "__esModule": true, "default": 5, "x": 1 }`,
      "node_modules/data/list.json": `["a", "b"]`,
      "node_modules/data/text.txt": `text`,
      ...commonJSPackage("untyped-dependency", importerOfCommonJS),
      ...commonJSPackage("typed-dependency", importerOfCommonJS, { type: "module" }),
      "untyped/importer.js": importerOfCommonJS,
      "type-commonjs/package.json": `{ "type": "commonjs" }`,
      "type-commonjs/importer.js": importerOfCommonJS,
      "type-module/package.json": `{ "type": "module" }`,
      "type-module/importer.js": importerOfCommonJS,
      "importer.mjs": importerOfCommonJS,
      "importer.mts": importerOfCommonJS,
      "star.js": `export * from "babel-default";`,
      "index.ts": `
        import * as star from "./star.js";
        import * as untyped from "./untyped/importer.js";
        import * as typeCommonJS from "./type-commonjs/importer.js";
        import * as typeModule from "./type-module/importer.js";
        import * as mjs from "./importer.mjs";
        import * as mts from "./importer.mts";
        import * as untypedDependency from "untyped-dependency";
        import * as typedDependency from "typed-dependency";
        ${which}
        require("late-default").assign("after");
        const importers = {
          'no "type"': untyped,
          '"type": "commonjs"': typeCommonJS,
          '"type": "module"': typeModule,
          ".mjs": mjs,
          ".mts": mts,
          'in node_modules, no "type"': untypedDependency,
          'in node_modules, "type": "module"': typedDependency,
        };
        globalThis.result = {};
        for (const name in importers) {
          globalThis.result[name] = {
            ...(await importers[name].read()),
            "export { default } from": which(importers[name].reexported, require("babel-default")),
          };
        }
        globalThis.starKeys = Object.keys(star).sort();
        console.log("done");
      `,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("done");
      expect(await c.js`globalThis.result`).toEqual({
        'no "type"': defaultImports("exports.default"),
        '"type": "commonjs"': defaultImports("exports.default"),
        '"type": "module"': defaultImports("module.exports"),
        ".mjs": defaultImports("module.exports"),
        ".mts": defaultImports("module.exports"),
        'in node_modules, no "type"': defaultImports("exports.default"),
        'in node_modules, "type": "module"': defaultImports("module.exports"),
      });
      // A known difference: development lowers `export *` to a spread, which forwards `default` too.
      // https://github.com/oven-sh/bun/pull/40259 removes it.
      expect(await c.js`globalThis.starKeys`).toEqual(
        dev.nodeEnv === "development" ? ["__esModule", "default", "x"] : ["__esModule", "x"],
      );
    },
  });
}
{
  // The rule holds on the other paths that load an importer: `require()` of an ES module, and `import()` in a
  // CommonJS file, whose module type is the one of its package.json like for any other file.
  const importCall = `
    exports.load = () => import("babel-default");
    exports.args = Object.prototype.toString.call(arguments);
  `;
  const defaultImport = `import d from "babel-default"; export const value = d;`;
  devAndProductionTest("require() and import() reach the default import of the module type of the importer", {
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      ...commonJSPackage("babel-default", babelDefault),
      "untyped/required.js": defaultImport,
      "untyped/import-call.cjs": importCall,
      "type-module/package.json": `{ "type": "module" }`,
      "type-module/required.js": defaultImport,
      "type-module/import-call.js": importCall,
      "type-module/required-import-call.js": importCall,
      // `import()` of a CommonJS module that is still running: the namespace is built when the promise settles.
      "running/a.js": `exports.__esModule = true; require("./b.js"); exports.default = "default"; exports.late = 1;`,
      "running/b.js": `globalThis.early = import("./a.js");`,
      "running/esm.js": `import "./imports-esm.js"; export const late = 1;`,
      "running/imports-esm.js": `globalThis.earlyESM = import("./esm.js");`,
      // Reading `__esModule` throws, so no namespace of this module can be built.
      "throws/dep.cjs": `
        module.exports = new Proxy({}, {
          get(target, key) {
            if (key === "__esModule") throw new Error("no namespace");
            return target[key];
          },
        });
      `,
      "throws/importer.js": `import d from "./dep.cjs"; export const value = d;`,
      "throws/imported.js": `import d from "./dep.cjs"; export const value = d;`,
      "index.ts": `
        import untypedImportCall from "./untyped/import-call.cjs";
        import typedImportCall from "./type-module/import-call.js";
        import running from "./running/a.js";
        import "./running/esm.js";
        ${which}
        const throughImportCall = async file => which((await file.load()).default, require("babel-default"));
        const requireImporterOfThrowing = () => {
          try {
            return typeof require("./throws/importer.js").value;
          } catch (e) {
            return e.message;
          }
        };
        const importImporterOfThrowing = async () => {
          try {
            return typeof (await import("./throws/imported.js")).value;
          } catch (e) {
            return e.message;
          }
        };
        const early = await globalThis.early;
        globalThis.result = {
          'an ES module first loaded by require(), no "type"': which(
            require("./untyped/required.js").value,
            require("babel-default"),
          ),
          'an ES module first loaded by require(), "type": "module"': which(
            require("./type-module/required.js").value,
            require("babel-default"),
          ),
          "import() in .cjs": await throughImportCall(untypedImportCall),
          'import() in CommonJS, "type": "module"': await throughImportCall(typedImportCall),
          'import() in CommonJS first loaded by require(), "type": "module"': await throughImportCall(
            require("./type-module/required-import-call.js"),
          ),
          'arguments in CommonJS, "type": "module"': typedImportCall.args,
          "import() of a CommonJS module that is still running": [running, early.default, Object.keys(early).sort()],
          "import() of an ES module that is still running": typeof (await globalThis.earlyESM)?.late,
          "a namespace that cannot be built, through require()": [
            requireImporterOfThrowing(),
            requireImporterOfThrowing(),
          ],
          "a namespace that cannot be built, through import()": [
            await importImporterOfThrowing(),
            await importImporterOfThrowing(),
          ],
        };
        console.log("done");
      `,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("done");
      expect(await c.js`globalThis.result`).toEqual({
        'an ES module first loaded by require(), no "type"': "exports.default",
        'an ES module first loaded by require(), "type": "module"': "module.exports",
        "import() in .cjs": "exports.default",
        'import() in CommonJS, "type": "module"': "module.exports",
        'import() in CommonJS first loaded by require(), "type": "module"': "module.exports",
        'arguments in CommonJS, "type": "module"': "[object Arguments]",
        "import() of a CommonJS module that is still running": [
          "default",
          "default",
          ["__esModule", "default", "late"],
        ],
        "import() of an ES module that is still running": "number",
        "a namespace that cannot be built, through require()": ["no namespace", "no namespace"],
        "a namespace that cannot be built, through import()": ["no namespace", "no namespace"],
      });
    },
  });
}
