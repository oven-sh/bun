// Tests which apply to both dev and prod. They are run twice.
//
// Every case boots a server (a dev server, then a production build) and waits
// for it to exit. That is most of a case's time, so pages that only differ in
// their HTML live in one project, one route each.
import { expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { Dev, devAndProductionTest, devTest, emptyHtmlFile, WAIT_MULTIPLIER } from "./bake-harness";

const hmrSelfAcceptingModule = (label: string) => `
  console.log(${JSON.stringify(label)});
  if (import.meta.hot) {
    import.meta.hot.accept();
  }
`;

/**
 * Fetches a page and splits off the tags the bundler injects in place of the
 * page's own `<script>` and `<link rel="stylesheet">` tags: one `<link>` per
 * stylesheet, the page's bundle as one module script and, in development, the
 * dev server's inline snippet. `html` keeps a marker where they were, with the
 * whitespace between tags collapsed so the expected document fits on one line.
 */
async function fetchPage(dev: Dev, url: string) {
  const res = await dev.fetch(url);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/html;charset=utf-8");
  const html = await res.text();
  const injected = html.match(
    /((?:<link rel="stylesheet" (?:crossorigin )?href="[^"]+">)*)<script type="module" crossorigin src="([^"]+)"(?: data-bun-dev-server-script)?><\/script>(?:<script>[^<]*<\/script>)?/,
  );
  if (!injected) throw new Error("The bundler did not inject its script tag:\n" + html);
  return {
    html: html.replace(injected[0], "<!--injected-->").replace(/\s+/g, " ").replaceAll("> <", "><").trim(),
    styles: Array.from(injected[1].matchAll(/href="([^"]+)"/g), m => m[1]),
    script: injected[2],
  };
}

/** The dev server's "Bundled page" lines so far, without colors and timings. */
function bundledPages(dev: Dev) {
  return dev.output.lines
    .map(line => line.replace(/\x1b\[\d+m/g, "").replaceAll("\\", "/"))
    .filter(line => line.startsWith("Bundled page"))
    .map(line => line.replace(/ in \d+ms/, ""));
}

devAndProductionTest("html entry points of every shape", {
  files: {
    "bunfig.toml": `
      [serve.static]
      define = {
        "DEFINE" = "\\"HELLO\\""
      }
    `,
    // define config via bunfig.toml
    "define/index.html": emptyHtmlFile({
      styles: [],
      scripts: ["../src/define.ts"],
    }),
    "src/define.ts": `
      console.log("a=" + DEFINE);
    `,
    // invalid html does not crash: a self-closing <script /> swallows the rest
    // of the document as script text.
    "invalid/index.html": `
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
    // missing head end tag works fine
    "no-head-end/index.html": `
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
    // missing all meta tags works fine
    "no-meta/index.html": `
      <title>Dashboard</title>
      <link rel="stylesheet" href="../src/app/styles.css"></link>

      <div id="root" />
      <script type="module" src="../src/app/index.tsx"></script>
    `,
    // inline script and styles appear
    "inline/index.html": `
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
    const isDev = dev.nodeEnv === "development";
    const script = expect.stringMatching(
      isDev ? /^\/_bun\/client\/index-[0-9a-f]{16}\.js$/ : /^\/chunk-[a-z0-9]+\.js$/,
    );
    const style = expect.stringMatching(isDev ? /^\/_bun\/asset\/[0-9a-f]{16}\.css$/ : /^\/chunk-[a-z0-9]+\.css$/);

    // define config via bunfig.toml
    expect(await fetchPage(dev, "/define")).toEqual({
      html: "<!DOCTYPE html><html><head><!--injected--></head><body></body></html>",
      styles: [],
      script,
    });
    // One client visits every page, as a browser that navigates between them.
    await using c = await dev.client("/define");
    await c.expectMessage("a=HELLO");

    // invalid html does not crash 1
    const invalid = await fetchPage(dev, "/invalid");
    expect(invalid).toEqual({
      html: '<!DOCTYPE html><html><head><title>Dashboard</title><!--injected--></head><body><div id="root" />',
      styles: [style],
      script,
    });
    await c.navigate("/invalid");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");

    // missing head end tag works fine
    const noHeadEnd = await fetchPage(dev, "/no-head-end");
    expect(noHeadEnd).toEqual({
      html: isDev
        ? '<!DOCTYPE html><html><head><title>Dashboard</title></link><body><div id="root" /></body><!--injected--></html>'
        : '<!DOCTYPE html><html><head><title>Dashboard</title></link><body><div id="root" /><!--injected--></body></html>',
      styles: [style],
      script,
    });
    await c.navigate("/no-head-end");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");

    // missing all meta tags works fine
    const noMeta = await fetchPage(dev, "/no-meta");
    expect(noMeta).toEqual({
      html: '<title>Dashboard</title></link><div id="root" /><!--injected-->',
      styles: [style],
      script,
    });
    await c.navigate("/no-meta");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");

    // The three pages import the same stylesheet, so they share one URL.
    expect(noHeadEnd.styles).toEqual(invalid.styles);
    expect(noMeta.styles).toEqual(invalid.styles);
    const css = await dev.fetch(invalid.styles[0]);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css;charset=utf-8");
    expect(await css.text()).toBe(
      isDev ? "/* src/app/styles.css */\nbody {\n  background-color: red;\n}\n" : "body{background-color:red}\n",
    );

    // inline script and styles appear, untouched by the bundler
    expect(await fetchPage(dev, "/inline")).toEqual({
      html: '<!DOCTYPE html><html><head><title>Dashboard</title><style> body { background-color: red; } </style><!--injected--></head><body><script> console.log("hello " + (1 + 2)); </script></body></html>',
      styles: [],
      script,
    });
    await c.navigate("/inline");
    await c.expectMessage("hello 3");
    await c.style("body").backgroundColor.expect.toBe("red");

    if (isDev) {
      // Each page is bundled once, on its first request. The page loads above
      // are served from that bundle.
      await dev.output.waitForLine(/Bundled page .*inline[\\/]index\.html/);
      expect(bundledPages(dev)).toEqual([
        "Bundled page: define/index.html",
        "Bundled page: invalid/index.html",
        "Bundled page: no-head-end/index.html",
        "Bundled page: no-meta/index.html",
        "Bundled page: inline/index.html",
      ]);
    }
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
