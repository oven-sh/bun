// Tests which apply to both dev and prod. They are run twice.
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
devAndProductionTest("a file with an ES import and module.exports", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import mixed from "./mixed.js";
      console.log(JSON.stringify(mixed));
    `,
    "dep.js": `
      export const value = 42;
    `,
    "mixed.js": `
      import { value } from "./dep.js";
      module.exports = { value };
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage('{"value":42}');
  },
});
devAndProductionTest("every import form in a file with module.exports", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import forms from "./forms.js";
      import { fromExports } from "./exports-property.js";
      import exportsObject, * as exportsNamespace from "./exports-object.js";
      import fromExportEquals from "./export-equals.ts";
      console.log(forms);
      console.log({
        fromExports,
        exportsObject,
        exportsNamespaceKeys: Object.keys(exportsNamespace).sort(),
        fromExportEquals,
      });
    `,
    "esm.js": `
      export const named = "esm named";
      export default "esm default";
    `,
    "cjs.js": `
      module.exports = { named: "cjs named" };
    `,
    "side-effect.js": `
      globalThis.sideEffect = "ran";
    `,
    "forms.js": `
      // The import statements below are hoisted above this line.
      const sideEffectBeforeBody = globalThis.sideEffect;
      import esmDefault, { named as esmNamed } from "./esm.js";
      import cjsDefault, { named as cjsNamed } from "./cjs.js";
      import * as cjsNamespace from "./cjs.js";
      import "./side-effect.js";
      module.exports = {
        esmDefault,
        esmNamed,
        cjsDefault,
        cjsNamed,
        cjsNamespaceDefaultIsDefault: cjsNamespace.default === cjsDefault,
        cjsNamespaceKeys: Object.keys(cjsNamespace).sort(),
        sideEffectBeforeBody,
      };
    `,
    "exports-property.js": `
      import { named } from "./esm.js";
      exports.fromExports = named;
    `,
    // A read of the whole exports object keeps this file in a CommonJS wrapper in the production bundle.
    "exports-object.js": `
      import { named } from "./esm.js";
      exports.viaObject = named;
    `,
    "export-equals.ts": `
      import { named } from "./esm.js";
      const value = { named };
      export = value;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(
      {
        esmDefault: "esm default",
        esmNamed: "esm named",
        cjsDefault: { named: "cjs named" },
        cjsNamed: "cjs named",
        cjsNamespaceDefaultIsDefault: true,
        cjsNamespaceKeys: ["default", "named"],
        sideEffectBeforeBody: "ran",
      },
      {
        fromExports: "esm named",
        exportsObject: { viaObject: "esm named" },
        exportsNamespaceKeys: ["default", "viaObject"],
        fromExportEquals: { named: "esm named" },
      },
    );
  },
});
devAndProductionTest("JSX in a file with module.exports or require", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import Component from "./component.jsx";
      import "./require-only.jsx";
      console.log(Component());
      console.log(globalThis.requireOnly);
    `,
    "component.jsx": `
      module.exports = function Component() {
        return <div>hello</div>;
      };
    `,
    "require-only.jsx": `
      const greeting = require("./greeting.cjs");
      globalThis.requireOnly = <p>{greeting}</p>;
    `,
    "greeting.cjs": `
      module.exports = "hi";
    `,
    "node_modules/react/package.json": JSON.stringify({ name: "react", version: "19.0.0" }),
    "node_modules/react/jsx-dev-runtime.js": `
      exports.jsxDEV = (type, props) => ({ type, children: props.children });
    `,
    "node_modules/react/jsx-runtime.js": `
      exports.jsx = (type, props) => ({ type, children: props.children });
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage({ type: "div", children: "hello" }, { type: "p", children: "hi" });
  },
});
devAndProductionTest("a file with an ES import and module.exports runs once for import, require and import()", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import viaImport from "./mixed.js";
      import viaRequire from "./require.cjs";
      console.log("index");
      import("./mixed.js").then(async ({ default: viaDynamic }) => {
        const { default: lazy } = await import("./lazy.js");
        console.log({ viaImport, sameForRequire: viaRequire === viaImport, sameForDynamic: viaDynamic === viaImport, lazy });
      });
    `,
    "require.cjs": `
      const mixed = require("./mixed.js");
      module.exports = mixed;
    `,
    "mixed.js": `
      import { value } from "./dep.js";
      console.log("mixed");
      module.exports = { value };
    `,
    "dep.js": `
      console.log("dep");
      export const value = 42;
    `,
    // Only import() reaches this file, so it and its import run after "index".
    "lazy.js": `
      import { value } from "./lazy-dep.js";
      console.log("lazy");
      module.exports = { value };
    `,
    "lazy-dep.js": `
      console.log("lazy-dep");
      export const value = "lazy value";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("dep", "mixed", "index", "lazy-dep", "lazy", {
      viaImport: { value: 42 },
      sameForRequire: true,
      sameForDynamic: true,
      lazy: { value: "lazy value" },
    });
  },
});
devAndProductionTest("import cycles below and through a file with an ES import and module.exports", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import above from "./above.js";
      import { readThrough } from "./through-esm.js";
      console.log({ below: above.read(), through: readThrough() });
    `,
    // a.js and b.js import each other, below above.js.
    "above.js": `
      import { readBoth } from "./a.js";
      module.exports = { read: () => readBoth() };
    `,
    "a.js": `
      import { b, readA } from "./b.js";
      export const a = "a";
      export function readBoth() {
        return [b, readA()];
      }
    `,
    "b.js": `
      import { a } from "./a.js";
      export const b = "b";
      export function readA() {
        return a;
      }
    `,
    // through-esm.js and through-mixed.js import each other.
    "through-esm.js": `
      import mixed from "./through-mixed.js";
      export const value = 1;
      export function readThrough() {
        return mixed.read();
      }
    `,
    "through-mixed.js": `
      import { value } from "./through-esm.js";
      module.exports = { read: () => value };
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage({ below: ["b", "a"], through: 1 });
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
