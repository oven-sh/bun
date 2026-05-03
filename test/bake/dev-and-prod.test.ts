// Tests which apply to both dev and prod. They are run twice.
import { writeFileSync } from "node:fs";
import { devAndProductionTest, devTest, emptyHtmlFile } from "./bake-harness";

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
    await using client = await dev.client("/");
    await client.expectMessage("render initial");

    const waitForMessage = (value: string) =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
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
    // on every platform. Use synchronous writeFileSync: open(O_TRUNC) +
    // write + close happen back-to-back on the calling thread, so the
    // empty-file window is microseconds. The previous `Bun.write` here is
    // two separate async libuv ops on Windows with a JS-thread round-trip
    // in between, giving the bundler a multi-millisecond window to read 0
    // bytes; the resulting empty module never calls `accept()`, leaving
    // `selfAccept = null` and tripping the fullReload() fallback on the
    // next update.
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
    writeFileSync(target, hmrSelfAcceptingModule("render sentinel"));
    await waitForMessage("render sentinel");

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
