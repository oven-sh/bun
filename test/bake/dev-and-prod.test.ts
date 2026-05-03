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
        // The harness emits "exit" before setting client.exited (bake-harness.ts
        // onExit), so a dedicated listener is needed — reading client.exited
        // inside a shared handler would still be false when "exit" fires.
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
    // Writing IDENTICAL content N times forces same-sourceMapId duplicates on
    // every platform (previously this only happened on Windows by accident via
    // watcher double-firing). Use synchronous writeFileSync — open(O_TRUNC) +
    // write + close happen back-to-back on the calling thread with no
    // event-loop turn in between, so the empty-file window is microseconds
    // (well under the watcher → bundler-thread dispatch latency). The previous
    // Bun.write here is two separate async libuv ops on Windows with a
    // JS-thread round-trip in between, giving the bundler a multi-millisecond
    // window to read 0 bytes; the resulting empty module never calls accept(),
    // leaving selfAccept = null and tripping the fullReload() fallback on the
    // next update (the cause of the previous Windows flake).
    const target = dev.join("index.ts");
    const rapidContent = hmrSelfAcceptingModule("render rapid");
    for (let i = 0; i < 10; i++) {
      writeFileSync(target, rapidContent);
    }

    // Wait until at least one rapid hot_update has been applied.
    await waitForMessage("render rapid");

    // Barrier: one more write, then wait for it to appear at the client.
    // Hot_updates are delivered over a single ordered WebSocket and applied in
    // order (client-fixture.mjs evals each blob in a FIFO microtask), so once
    // the sentinel's console.log arrives, every prior hot_update has already
    // been applied — no stragglers can land later and leak into the disposal
    // check. Don't use dev.batchChanges() here: when a bundle from the rapid
    // burst is still in flight as 'H' arrives, the queued event is later
    // drained by startNextBundleIfPresent without publishing SeenFiles, and
    // the harness's seenFiles.promise hangs (the 100% Windows-CI timeout).
    // waitForMessage already gives us the only ordering guarantee this test
    // needs.
    writeFileSync(target, hmrSelfAcceptingModule("render sentinel"));
    await waitForMessage("render sentinel");

    // Drain. The watcher may have coalesced or double-fired, so the exact
    // count is non-deterministic, but every message must be one of the two
    // values we wrote. If #19736 ever regresses, "Unknown HMR script: ..." is
    // thrown inside the bun:hmr callback, which propagates as an unhandled
    // rejection in client-fixture.mjs and exits the subprocess non-zero —
    // failing this test at the disposal check without any explicit assertion
    // here.
    for (const msg of client.messages) {
      if (msg !== "render rapid" && msg !== "render sentinel") {
        throw new Error(`Unexpected HMR message: ${JSON.stringify(msg)}`);
      }
    }
    client.messages.length = 0;
  },
});
