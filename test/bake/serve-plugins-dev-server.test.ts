// ServePlugins.handleOnResolve / handleOnReject take `pending = &this.state.pending`,
// then reassign `this.state` to a different union variant, and must still be able to
// notify the DevServer afterwards. That only works if `dev_server` is read out of the
// pending payload *before* the reassignment. When it isn't, the optional reads back as
// null (or garbage, depending on build mode) and the DevServer is never told that
// plugin loading finished, so the request it deferred to `next_bundle` waits forever.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import { join } from "node:path";

const indexHtml = /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><script type="module" src="./entry.ts"></script></body></html>`;

// DevServer waits on `[serve.static]` plugins and the plugin promise rejects.
// Exercises ServePlugins.handleOnReject with pending.dev_server set — the request that
// was deferred while plugins were pending must be released once the DevServer is told
// the load failed.
test.concurrent("DevServer is notified when [serve.static] plugin setup rejects", async () => {
  using dir = tempDir("serve-plugins-devserver-reject", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": `
      export default {
        name: "boom-plugin",
        async setup() {
          // Make the load observably async so ServePlugins sits in .pending with
          // dev_server stored before handleOnReject runs.
          await Promise.resolve();
          throw new Error("plugin setup failed on purpose");
        },
      };
    `,
    "index.html": indexHtml,
    "entry.ts": `console.log("unused");`,
    "server.ts": `
      import html from "./index.html";
      const server = Bun.serve({
        port: 0,
        development: true,
        routes: { "/": html },
        fetch() { return new Response("fallback"); },
      });
      // First request while plugin_state == .unknown:
      //   DevServer.ensureRouteIsBundled -> getOrLoadPlugins(.{ .dev_server = dev })
      //   -> ServePlugins .pending (dev_server stored) -> request deferred to next_bundle.
      // Plugin promise rejects -> handleOnReject must call dev.onPluginsRejected(),
      // which releases the deferred request. If the DevServer is never notified the
      // request hangs indefinitely; the AbortSignal below turns that hang into a
      // concrete failure.
      let result: string;
      try {
        const res = await fetch(server.url, { signal: AbortSignal.timeout(10_000) });
        result = String(res.status);
      } catch (e) {
        result = (e as Error).name;
      }
      // The route must not be stuck in the queue for a bundle that never starts.
      const second = await fetch(server.url).then(res => res.text());
      await server.stop(true);
      console.log(JSON.stringify({ result, second }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // handleOnReject always prints the plugin error regardless of the bug; this just
  // confirms we actually reached the reject path.
  expect(stderr).toContain("plugin setup failed on purpose");

  const line = stdout.split("\n").find(l => l.startsWith("{"));
  expect(line).toBeDefined();
  const { result, second } = JSON.parse(line!);
  // With the DevServer notified, the deferred request is released promptly. If it
  // isn't, the fetch sits until the 10s abort fires and we see "TimeoutError" here.
  expect(result).not.toBe("TimeoutError");
  expect(second).toBe("Plugin Error");
  expect(exitCode).toBe(0);
});

// DevServer waits on `[serve.static]` plugins and the plugin promise resolves.
// Exercises ServePlugins.handleOnResolve with pending.dev_server set — the DevServer
// must be handed the resolved plugin so its bundle actually goes through it.
test.concurrent("DevServer is notified when [serve.static] plugin setup resolves", async () => {
  using dir = tempDir("serve-plugins-devserver-resolve", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": `
      export default {
        name: "marker-plugin",
        async setup(build) {
          await Promise.resolve();
          build.onLoad({ filter: /entry\\.ts$/ }, () => ({
            loader: "ts",
            contents: "console.log('PLUGIN_MARKER');",
          }));
        },
      };
    `,
    "index.html": indexHtml,
    "entry.ts": `console.log("ORIGINAL_MARKER");`,
    "server.ts": `
      import html from "./index.html";
      const server = Bun.serve({
        port: 0,
        development: true,
        routes: { "/": html },
        fetch() { return new Response("fallback"); },
      });
      const res = await fetch(server.url, { signal: AbortSignal.timeout(10_000) });
      const body = await res.text();
      const m = body.match(/src="([^"]+)"/);
      const js = m
        ? await fetch(new URL(m[1], server.url), { signal: AbortSignal.timeout(10_000) }).then(r => r.text())
        : "";
      await server.stop(true);
      console.log(JSON.stringify({
        status: res.status,
        fromPlugin: js.includes("PLUGIN_MARKER") && !js.includes("ORIGINAL_MARKER"),
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const line = stdout.split("\n").find(l => l.startsWith("{"));
  expect(line).toBeDefined();
  const out = JSON.parse(line!);
  expect(out).toEqual({ status: 200, fromPlugin: true });
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  { development: true, setup: "resolves" },
  { development: false, setup: "resolves" },
  { development: true, setup: "rejects" },
])(
  "a server that is gone unroots its plugins (development: $development, setup $setup)",
  async ({ development, setup }) => {
    using dir = tempDir("serve-plugins-unrooted", {
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "plugin.ts": `
        export default {
          name: "p",
          async setup() {
            globalThis.rootedInSetup = globalThis.rooted();
            await new Promise(setImmediate);
            if (${setup === "rejects"}) throw new Error("plugin setup failed on purpose");
          },
        };
      `,
      "index.html": indexHtml,
      "entry.ts": `console.log("entry");`,
      "server.ts": `
        import { heapStats } from "bun:jsc";
        import html from "./index.html";
        globalThis.rooted = () => heapStats().protectedObjectTypeCounts.BundlerPlugin ?? 0;
        async function serve() {
          const server = Bun.serve({ port: 0, development: ${development}, routes: { "/": html } });
          await fetch(server.url).then(r => r.text(), () => {});
          await server.stop(true);
        }
        await serve();
        for (let i = 0; i < 50 && rooted() > 0; i++) {
          Bun.gc(true);
          await new Promise(setImmediate);
        }
        console.log(JSON.stringify({ rootedInSetup, rooted: rooted() }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.includes("plugin setup failed on purpose")).toBe(setup === "rejects");
    expect(stdout).toEndWith(`{"rootedInSetup":1,"rooted":0}\n`);
    expect(exitCode).toBe(0);
  },
);

// The first request to an HTML route starts the plugin load, and the load runs user code: the
// plugin module, its setup(), and what a Bun.plugin() hook or an accessor adds to them. All of it
// runs after the handler of that request has returned, so it can stop the server and it can run
// the event loop. `parked` is server.pendingRequests when that code starts: the handler has parked
// the request by then. A dev server does not count a parked page there.
const loadFixture = {
  "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
  "index.html": indexHtml,
  "other.html": indexHtml,
  "entry.ts": `console.log("unused");`,
  "render.ts": `export function render() { return new Response("rendered"); }`,
  "routes/index.ts": `export default {};`,
  "routes/other.ts": `export default {};`,
  // Each kind of server whose first request starts the plugin load. The two HTML routes without
  // a dev server start it in html_bundle::Route::schedule_bundle.
  "serve.ts": /* ts */ `
    import html from "./index.html";
    import other from "./other.html";

    const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./render.ts" };
    const barrier = { "/barrier": new Response("barrier") };
    const routes = { "/": html, "/other": other, ...barrier };
    const kinds = {
      "dev-server-page": { development: true, routes },
      "dev-server-framework-route": {
        development: true,
        routes: barrier,
        app: { framework: { fileSystemRouterTypes: [fsr] } },
      },
      "html-route": { development: false, routes },
      "html-route-without-hmr": { development: { hmr: false }, routes },
    };
    export const serve = kind => Bun.serve({ port: 0, ...kinds[kind] });
  `,
};
const parkedIn = (kind: string) => (kind === "dev-server-page" ? 0 : 1);

async function runServer(cwd: string, args: string[], env = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts", ...args],
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const line = stdout.split("\n").find(line => line.startsWith("{"));
  return { report: line === undefined ? undefined : JSON.parse(line), exitCode, stderr };
}

// A server in a process of its own: the test sends the requests and reads what the server prints.
function spawnServer(cwd: string, cmd: string[], env = bunEnv) {
  const proc = Bun.spawn({ cmd: [bunExe(), ...cmd], env, cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  return {
    proc,
    // The match, or null when the process closes its stdout first.
    async waitFor(pattern: RegExp) {
      for (;;) {
        const match = stdout.match(pattern);
        if (match) return match;
        const { value, done } = await reader.read();
        if (done) return null;
        stdout += decoder.decode(value, { stream: true });
      }
    },
  };
}
const closed = (url: string | URL) =>
  fetch(url).then(
    res => "status " + res.status,
    () => "closed",
  );

// `how` is what lets the load reach setup() with no turn of the event loop: server.ts imports
// the plugin module first, NODE_COMPILE_CACHE is set, or an earlier server imported the module.
test.concurrent.each([
  { kind: "dev-server-page", mode: "stop", how: "imported" },
  { kind: "dev-server-page", mode: "stop-in-a-promise-reaction", how: "imported" },
  { kind: "dev-server-page", mode: "stop-and-run-the-event-loop", how: "imported" },
  { kind: "dev-server-framework-route", mode: "stop", how: "imported" },
  { kind: "html-route", mode: "stop", how: "imported" },
  { kind: "html-route-without-hmr", mode: "stop", how: "imported" },
  { kind: "dev-server-page", mode: "stop", how: "compile-cache" },
  { kind: "html-route", mode: "stop", how: "compile-cache" },
  { kind: "html-route", mode: "stop", how: "second-server" },
])("stop(true) from the setup() of a plugin ($kind, $mode, $how)", async ({ kind, mode, how }) => {
  using dir = tempDir("serve-plugins-setup-stop", {
    ...loadFixture,
    "plugin.ts": /* ts */ `
      export default {
        name: "stop-plugin",
        setup() {
          const test = globalThis.__test;
          if (test.mode === "nothing") return;
          test.parked = test.server.pendingRequests;
          if (test.mode === "stop-in-a-promise-reaction") return test.setupRan.resolve();
          test.stopped = test.server.stop(true);
          if (test.mode === "stop-and-run-the-event-loop") {
            // Bun.build() runs the event loop until the setup() of this plugin settles.
            let inSetup = true;
            const turn = resolve => setImmediate(() => resolve((test.loopRanInSetup = inSetup)));
            const wait = { name: "wait", setup: () => new Promise(turn) };
            Bun.build({ entrypoints: [import.meta.dir + "/entry.ts"], plugins: [wait] }).catch(() => {});
            inSetup = false;
          }
          test.setupRan.resolve();
        },
      };
    `,
    "server.ts": /* ts */ `
      import { getDevServerDeinitCount } from "bun:internal-for-testing";
      import { getCompileCacheDir } from "node:module";
      import { serve } from "./serve.ts";

      const [kind, mode, how] = process.argv.slice(2);
      const test = (globalThis.__test = { mode: "nothing", setupRan: Promise.withResolvers() });
      if (how === "imported") await import("./plugin.ts");
      if (how === "second-server") {
        const earlier = (test.server = serve(kind));
        await fetch(earlier.url).then(res => res.text());
        await earlier.stop(true);
      }

      const deinits = getDevServerDeinitCount();
      const server = (test.server = serve(kind));
      test.mode = mode;
      test.setupRan.promise.then(() => void (test.stopped ??= server.stop(true)));
      const request = await fetch(server.url).then(
        res => "status " + res.status,
        err => err.code,
      );
      // Bun.build() in setup() runs this file too: the report waits for setup() to return.
      await test.setupRan.promise;
      await test.stopped;
      console.log(
        JSON.stringify({
          request,
          parked: test.parked,
          loopRanInSetup: test.loopRanInSetup,
          compileCache: getCompileCacheDir() !== undefined,
          deinits: getDevServerDeinitCount() - deinits,
        }),
      );
    `,
  });

  const env = how === "compile-cache" ? { ...bunEnv, NODE_COMPILE_CACHE: join(String(dir), "cache") } : bunEnv;
  const { report, exitCode, stderr } = await runServer(String(dir), [kind, mode, how], env);
  expect({ report, exitCode }, stderr).toEqual({
    report: {
      request: "ECONNRESET",
      parked: parkedIn(kind),
      loopRanInSetup: mode === "stop-and-run-the-event-loop" ? true : undefined,
      compileCache: how === "compile-cache",
      deinits: kind.startsWith("dev-server") ? 1 : 0,
    },
    exitCode: 0,
  });
});

// The plugin is not imported. The load reaches this user code before it reaches setup().
test.concurrent.each([
  { kind: "dev-server-page", trigger: "onResolve" },
  { kind: "html-route", trigger: "onResolve" },
  { kind: "html-route", trigger: "TypeError" },
  { kind: "html-route", trigger: "Promise.prototype.constructor" },
])("stop(true) from user code that the plugin load reaches ($kind, $trigger)", async ({ kind, trigger }) => {
  using dir = tempDir("serve-plugins-load-stop", {
    ...loadFixture,
    "plugin.ts": `export default { name: "plugin", setup() {} };`,
    "server.ts": /* ts */ `
      import { serve } from "./serve.ts";

      const [kind, trigger] = process.argv.slice(2);
      const server = serve(kind);
      let armed = false;
      function reached() {
        if (!armed) return;
        armed = false;
        const parked = server.pendingRequests;
        server.stop(true);
        setImmediate(() => console.log(JSON.stringify({ parked })));
      }
      if (trigger === "onResolve") {
        // Bun.resolve() of the plugin name calls this hook.
        Bun.plugin({
          name: "hook",
          setup(build) {
            build.onResolve({ filter: /plugin\\.ts$/ }, () => void reached());
          },
        });
      } else if (trigger === "TypeError") {
        // The load makes a subclass of TypeError for its errors.
        const original = TypeError;
        Object.defineProperty(globalThis, "TypeError", { configurable: true, get: () => (reached(), original) });
      } else {
        // An await of a promise reads its constructor.
        const original = Promise;
        Object.defineProperty(Promise.prototype, "constructor", { configurable: true, get: () => (reached(), original) });
      }
      // No code of this file runs after the callback, so the request is the next thing that runs the accessors.
      setImmediate(() => {
        console.log("url: " + server.url.href);
        armed = true;
      });
    `,
  });

  const { proc, waitFor } = spawnServer(String(dir), ["server.ts", kind, trigger]);
  await using _ = proc;
  const url = (await waitFor(/url: (http:\/\/\S+)\s/))?.[1];
  expect(url).toBeDefined();
  const request = await closed(url!);
  const report = (await waitFor(/^\{.*\}$/m))?.[0];
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect({ request, report: report && JSON.parse(report), exitCode }, stderr).toEqual({
    request: "closed",
    report: { parked: parkedIn(kind) },
    exitCode: 0,
  });
});

test.concurrent.each(["dev-server-page", "html-route"])(
  "a client that disconnects while the setup() of an imported plugin runs the event loop (%s)",
  async kind => {
    using dir = tempDir("serve-plugins-setup-disconnect", {
      ...loadFixture,
      "plugin.ts": /* ts */ `
        export default {
          name: "disconnect-plugin",
          setup() {
            const test = globalThis.__test;
            test.setups++;
            test.parked = test.server.pendingRequests;
            // The client of the first request goes away. Bun.build() runs the event loop until the
            // setup() of this plugin settles: the server has read the close when it answers a
            // connection made later.
            test.abort();
            let inSetup = true;
            const ran = () => void (test.loopRanInSetup = inSetup);
            const wait = { name: "wait", setup: () => test.barrier().then(ran) };
            Bun.build({ entrypoints: [import.meta.dir + "/entry.ts"], plugins: [wait] }).catch(() => {});
            inSetup = false;
          },
        };
      `,
      "server.ts": /* ts */ `
        import "./plugin.ts";
        import { serve } from "./serve.ts";

        const controller = new AbortController();
        const server = serve(process.argv[2]);
        const test = (globalThis.__test = {
          server,
          setups: 0,
          abort: () => controller.abort(),
          barrier: () => fetch(new URL("/barrier", server.url)).then(res => res.text()),
        });

        const first = await fetch(server.url, { signal: controller.signal }).then(
          res => "status " + res.status,
          err => err.name,
        );
        const second = await fetch(server.url).then(res => res.status);
        await server.stop(true);
        const { setups, parked, loopRanInSetup } = test;
        console.log(JSON.stringify({ first, second, setups, parked, loopRanInSetup }));
      `,
    });

    const { report, exitCode, stderr } = await runServer(String(dir), [kind]);
    expect({ report, exitCode }, stderr).toEqual({
      report: { first: "AbortError", second: 200, setups: 1, parked: parkedIn(kind), loopRanInSetup: true },
      exitCode: 0,
    });
  },
);

// A parked framework request counts in server.pendingRequests. So `parked` shows that the event
// loop in setup() read the other two requests: it is the first request and those two.
test.concurrent.each([
  { kind: "dev-server-page", parked: 0 },
  { kind: "dev-server-framework-route", parked: 3 },
])(
  "two more requests while the setup() of an imported plugin runs the event loop ($kind)",
  async ({ kind, parked }) => {
    using dir = tempDir("serve-plugins-setup-requests", {
      ...loadFixture,
      "plugin.ts": /* ts */ `
        export default {
          name: "event-loop-plugin",
          setup() {
            const test = globalThis.__test;
            test.setups++;
            // Bun.build() runs the event loop until the setup() of this plugin settles: the server
            // has read the other two requests when it answers a connection made later.
            let inSetup = true;
            const ran = () => void (test.loopRanInSetup = inSetup);
            const wait = { name: "wait", setup: () => test.barrier().then(ran) };
            Bun.build({ entrypoints: [import.meta.dir + "/entry.ts"], plugins: [wait] }).catch(() => {});
            inSetup = false;
            test.parked = test.server.pendingRequests;
          },
        };
      `,
      "server.ts": /* ts */ `
        import "./plugin.ts";
        import { serve } from "./serve.ts";

        const server = serve(process.argv[2]);
        const test = (globalThis.__test = {
          server,
          setups: 0,
          barrier: () => fetch(new URL("/barrier", server.url)).then(res => res.text()),
        });

        const get = path => fetch(new URL(path, server.url)).then(res => res.status);
        const statuses = await Promise.all([get("/"), get("/other"), get("/")]);
        await server.stop(true);
        const { setups, parked, loopRanInSetup } = test;
        console.log(JSON.stringify({ statuses, setups, parked, loopRanInSetup }));
      `,
    });

    const { report, exitCode, stderr } = await runServer(String(dir), [kind]);
    expect({ report, exitCode }, stderr).toEqual({
      report: { statuses: [200, 200, 200], setups: 1, parked, loopRanInSetup: true },
      exitCode: 0,
    });
  },
);

// These loads need no turn of the event loop to fail. They answer like a load that fails later:
// the request that waits for the load gets 500, and the error is reported once.
test.concurrent.each([
  { kind: "dev-server-page", failure: "the name does not resolve", second: "200 Plugin Error" },
  { kind: "dev-server-framework-route", failure: "the name does not resolve", second: "200 Plugin Error" },
  { kind: "html-route", failure: "the name does not resolve", second: "200 " },
  { kind: "html-route-without-hmr", failure: "the name does not resolve", second: "200 " },
  { kind: "dev-server-page", failure: "setup() throws", second: "200 Plugin Error" },
  { kind: "html-route", failure: "setup() throws", second: "200 " },
])("a plugin load that can fail with no turn of the event loop ($kind, $failure)", async ({ kind, ...row }) => {
  const throws = row.failure === "setup() throws";
  using dir = tempDir("serve-plugins-load-fails", {
    ...loadFixture,
    "bunfig.toml": `[serve.static]\nplugins = ["${throws ? "./plugin.ts" : "./missing.ts"}"]\n`,
    "plugin.ts": `export default { name: "plugin", setup() { throw new Error("setup failed on purpose"); } };`,
    "server.ts": /* ts */ `
      import { serve } from "./serve.ts";

      if (process.argv[3] === "true") await import("./plugin.ts");
      const server = serve(process.argv[2]);
      const get = () => fetch(server.url).then(async res => res.status + " " + (await res.text()));
      const first = await get();
      const second = await get();
      await server.stop(true);
      console.log(JSON.stringify({ first, second }));
    `,
  });

  const { report, exitCode, stderr } = await runServer(String(dir), [kind, String(throws)]);
  expect({ report, errors: stderr.match(/^error: /gm)?.length, exitCode }, stderr).toEqual({
    report: { first: "500 ", second: row.second },
    // "Failed to load plugins for Bun.serve:", then the error.
    errors: 2,
    exitCode: 0,
  });
});

// `bun bake` gives the plugin objects of bake.config.ts to the plugin load: it has no module to
// import for them.
const bakeFiles = {
  "app/server.ts": /* ts */ `
    export default {
      fetch(req, server) {
        globalThis.server = server;
        return new Response("api");
      },
    };
  `,
};
const bakePage = { "app/pages/index.html": `<!DOCTYPE html><html><body></body></html>` };
const bakeFrameworkRoute = {
  "src/routes/index.ts": `export default () => "home";`,
  "render/server.ts": `export function render(request, meta) { return new Response(meta.pageModule.default()); }`,
};
const bakeFramework = /* ts */ `framework: {
  fileSystemRouterTypes: [
    { root: "src/routes", style: "nextjs-pages", serverEntryPoint: "./render/server.ts", extensions: [".ts"] },
  ],
},`;
const bakeEnv = { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE: "1" };

// The first request is for /api, which gives the server to bake.config.ts. The second one is
// for the route, and it starts the plugin load.
async function requestBakeRoute(cwd: string) {
  const { proc, waitFor } = spawnServer(cwd, ["bake", "--port=0"], bakeEnv);
  await using _ = proc;
  const url = (await waitFor(/url: (http:\/\/\S+)\s/))?.[1];
  expect(url).toBeDefined();
  expect(await fetch(new URL("/api", url)).then(res => res.text())).toBe("api");
  const request = await closed(url!);
  // The user code prints its two lines after it has closed the connection of the request.
  if (request === "closed") await waitFor(/^next turn$/m);
  proc.kill("SIGKILL");
  const parked = (await waitFor(/^parked: (\d+)$/m))?.[1];
  const nextTurn = (await waitFor(/^next turn$/m))?.[0];
  return { request, parked, nextTurn, stderr: await proc.stderr.text() };
}

// bake.config.ts with one plugin. `reached()` is the user code that stops the server.
const bakeConfig = (framework: string, setup: string, rest = "") => /* ts */ `
  function reached() {
    console.log("parked: " + globalThis.server.pendingRequests);
    globalThis.server.stop(true);
    // A turn of the event loop that starts after the frame that reached this code is done.
    setImmediate(() => console.log("next turn"));
  }
  const plugin = {
    name: "stop-plugin",
    ${framework}
    setup() {
      ${setup}
    },
  };
  ${rest}
  export default { plugins: [plugin] };
`;

test.concurrent.each([
  { route: "page", files: bakePage, framework: "", parked: "0" },
  { route: "framework-route", files: bakeFrameworkRoute, framework: bakeFramework, parked: "1" },
])("stop(true) from the setup() of a bake.config.ts plugin ($route)", async ({ files, framework, parked }) => {
  using dir = tempDir("serve-plugins-bake-config-stop", {
    ...bakeFiles,
    ...files,
    "bake.config.ts": bakeConfig(framework, "reached();"),
  });

  const { stderr, ...result } = await requestBakeRoute(String(dir));
  expect(result, stderr).toEqual({ request: "closed", parked, nextTurn: "next turn" });
});

// A store of the plugin object at index 0 of an array that has no such property calls this setter.
test.concurrent("the plugin load calls no setter of Array.prototype for a bake.config.ts plugin", async () => {
  using dir = tempDir("serve-plugins-bake-config-setter", {
    ...bakeFiles,
    ...bakeFrameworkRoute,
    "bake.config.ts": bakeConfig(
      bakeFramework,
      "",
      /* ts */ `
        Object.defineProperty(Array.prototype, "0", {
          configurable: true,
          set(value) {
            Object.defineProperty(this, "0", { value, writable: true, enumerable: true, configurable: true });
            if (value === plugin && globalThis.server) reached();
          },
        });
      `,
    ),
  });

  const { stderr, ...result } = await requestBakeRoute(String(dir));
  expect(result, stderr).toEqual({ request: "status 200", parked: undefined, nextTurn: undefined });
});

test.concurrent("bun bake answers every request when the setup() of a bake.config.ts plugin throws", async () => {
  using dir = tempDir("serve-plugins-bake-config-throws", {
    ...bakePage,
    "bake.config.ts": /* ts */ `
      export default {
        plugins: [
          {
            name: "throwing-plugin",
            setup() {
              throw new Error("setup failed on purpose");
            },
          },
        ],
      };
    `,
  });

  const { proc, waitFor } = spawnServer(String(dir), ["bake", "--port=0"], bakeEnv);
  await using _ = proc;
  const url = (await waitFor(/url: (http:\/\/\S+)\s/))?.[1];
  expect(url).toBeDefined();
  const get = () =>
    fetch(url!).then(
      async res => res.status + " " + (await res.text()),
      () => "closed",
    );
  const answers = [await get(), await get(), await get()];
  proc.kill("SIGKILL");
  const stderr = await proc.stderr.text();
  expect({ answers, errors: stderr.match(/^error: setup failed on purpose$/gm)?.length }, stderr).toEqual({
    answers: ["500 ", "200 Plugin Error", "200 Plugin Error"],
    errors: 1,
  });
});

const parkedPlugin = /* ts */ `
  export default {
    name: "parked-plugin",
    async setup() {
      const { entered, release, finished } = globalThis.__setup;
      entered();
      try {
        if ((await release) === "reject") throw new Error("plugin setup failed after stop");
      } finally {
        finished();
      }
    },
  };
`;

// With a compile cache, the load reaches the parked setup() with no turn of the event loop.
test.concurrent.each(["kept", "collected", "kept, with a compile cache"])(
  "stop(true) releases a request waiting on a plugin load that settles later (server %s)",
  async mode => {
    using dir = tempDir(`serve-plugins-devserver-stop-${mode}`, {
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "plugin.ts": parkedPlugin,
      "index.html": indexHtml,
      "entry.ts": `console.log("entry");`,
      "server.ts": `
        import { getDevServerDeinitCount } from "bun:internal-for-testing";
        import html from "./index.html";

        const entered = Promise.withResolvers();
        const release = Promise.withResolvers();
        const finished = Promise.withResolvers();
        globalThis.__setup = { entered: entered.resolve, release: release.promise, finished: finished.resolve };
        const turn = () => new Promise(resolve => setImmediate(resolve));

        let collected = false;
        const registry = new FinalizationRegistry(() => void (collected = true));
        let keepServer;

        // A separate function so that the stack doesn't reference the server after it returns.
        async function stopWhileParked() {
          const server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
          registry.register(server, "server");
          if (process.argv[2] === "kept") keepServer = server;
          const request = fetch(server.url).then(res => String(res.status), err => err.code);
          await entered.promise;
          await server.stop(true);
          return await request;
        }
        const request = await stopWhileParked();

        for (let i = 0; i < 50 && !keepServer && !collected; i++) {
          Bun.gc(true);
          await turn();
        }

        release.resolve("resolve");
        await finished.promise;
        // The reaction that reports the load to the server runs in this turn's microtasks.
        await turn();
        console.log(JSON.stringify({ request, deinits: getDevServerDeinitCount(), collected }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.ts", mode.split(",")[0]],
      env: mode.endsWith("cache") ? { ...bunEnv, NODE_COMPILE_CACHE: join(String(dir), "cache") } : bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const line = stdout.split("\n").find(l => l.startsWith("{"));
    expect(line === undefined ? undefined : JSON.parse(line), stderr).toEqual({
      request: "ECONNRESET",
      deinits: 1,
      collected: mode === "collected",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent("responds to a framework route waiting on a plugin load that rejects after stop()", async () => {
  using dir = tempDir("serve-plugins-devserver-reject-framework", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": parkedPlugin,
    "render.ts": `export function render() { return new Response("rendered"); }`,
    "routes/index.ts": `export default {};`,
    "server.ts": `
      import { getDevServerDeinitCount } from "bun:internal-for-testing";
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      globalThis.__setup = { entered: entered.resolve, release: release.promise, finished() {} };

      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./render.ts" };
      const server = Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } });
      const status = fetch(server.url).then(res => res.status);
      await entered.promise;
      const stopped = server.stop();
      release.resolve("reject");
      console.log(await status);
      await stopped;
      console.log(server.pendingRequests, getDevServerDeinitCount());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("plugin setup failed after stop");
  expect(stdout).toBe("500\n0 1\n");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "responds to a framework route waiting on a plugin load that rejects, and to its next request",
  async () => {
    using dir = tempDir("serve-plugins-devserver-reject-framework-live", {
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "plugin.ts": parkedPlugin,
      "render.ts": `export function render() { return new Response("rendered"); }`,
      "routes/index.ts": `export default {};`,
      "server.ts": `
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      globalThis.__setup = { entered: entered.resolve, release: release.promise, finished() {} };

      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./render.ts" };
      const server = Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } });
      const waiting = fetch(server.url).then(async res => res.status + " " + (await res.text()));
      await entered.promise;
      release.resolve("reject");
      console.log(await waiting);
      console.log(await fetch(server.url).then(res => res.text()));
      console.log(server.pendingRequests);
      await server.stop(true);
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("plugin setup failed after stop");
    expect(stdout).toBe("500 \nPlugin Error\n0\n");
    expect(exitCode).toBe(0);
  },
);

// The server answers 413 and closes the connection while the request still waits, so the
// response that the request was saved with is gone when the load rejects.
test.concurrent(
  "does not answer a framework request again that got a 413 while it waited for a plugin load",
  async () => {
    using dir = tempDir("serve-plugins-devserver-reject-framework-413", {
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "plugin.ts": parkedPlugin,
      "render.ts": `export function render() { return new Response("rendered"); }`,
      "routes/index.ts": `export default {};`,
      "server.ts": `
      import { getDevServerDeinitCount } from "bun:internal-for-testing";
      import { connect } from "node:net";
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      globalThis.__setup = { entered: entered.resolve, release: release.promise, finished() {} };

      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./render.ts" };
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        development: true,
        maxRequestBodySize: 16,
        app: { framework: { fileSystemRouterTypes: [fsr] } },
      });

      // A chunked body has no Content-Length, so the server finds that it is too large only when a chunk arrives.
      let response = "";
      const closed = Promise.withResolvers();
      const socket = connect(server.port, "127.0.0.1");
      socket.setEncoding("latin1");
      socket.on("data", data => (response += data));
      socket.on("close", closed.resolve);
      socket.on("error", closed.reject);
      socket.write("POST / HTTP/1.1\\r\\nHost: localhost\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n");
      await entered.promise;
      socket.write("40\\r\\n" + Buffer.alloc(64, "a").toString() + "\\r\\n");
      await closed.promise;
      release.resolve("reject");
      console.log(response.split("\\r\\n")[0]);
      console.log(await fetch(server.url).then(res => res.text()));
      await server.stop();
      console.log(server.pendingRequests, getDevServerDeinitCount());
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("plugin setup failed after stop");
    expect(stdout).toBe("HTTP/1.1 413 Payload Too Large\nPlugin Error\n0 1\n");
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(isWindows)("a backslash separates in the path of a [serve.static] plugin only", async () => {
  using dir = tempDir("serve-plugins-devserver-backslash", {
    "bunfig.toml": String.raw`
      [serve.static]
      plugins = ['.\plugins\a.ts?x=\d', 'data:text/javascript,console.log("b\nc"); export default { name: "b", setup() {} };']
    `,
    "plugins/a.ts": `console.log(import.meta.url.split("?")[1]); export default { name: "a", setup() {} };`,
    "index.html": `<!DOCTYPE html><html><body></body></html>`,
    "server.ts": `
      import html from "./index.html";
      using server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
      console.log((await fetch(server.url)).status);
    `,
  });
  const { stdout, exitCode } = await bunRun(join(String(dir), "server.ts"));
  expect(stdout).toBe("x=\\d\nb\nc\n200");
  expect(exitCode).toBe(0);
});

// `bun ./index.html` and `bun bake` load the plugins when the first request arrives, so that
// request waits for them. The later ones must not wait for a bundle that never starts.
test.each([
  { name: "bun ./index.html", args: ["index.html", "--port=0"], page: "index.html" },
  { name: "bun bake", args: ["bake", "--port=0"], page: "app/pages/index.html" },
])("$name answers every request when a [serve.static] plugin throws as it loads", async ({ args, page }) => {
  using dir = tempDir("serve-plugins-devserver-cli", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": `throw new Error("plugin failed on purpose");`,
    [page]: `<!DOCTYPE html><html><body></body></html>`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE: "1" },
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  let stdout = "";
  let url: string | undefined;
  for await (const chunk of proc.stdout) {
    stdout += decoder.decode(chunk, { stream: true });
    url = stdout.match(/url: (http:\/\/\S+)\s/)?.[1];
    if (url) break;
  }
  expect(url, stdout).toBeDefined();

  const waiting = await fetch(url!);
  expect({ status: waiting.status, body: await waiting.text() }).toEqual({ status: 500, body: "" });
  for (let i = 0; i < 2; i++) {
    expect(await fetch(url!).then(res => res.text())).toBe("Plugin Error");
  }
  expect(proc.exitCode).toBeNull();

  proc.kill("SIGKILL");
  const stderr = await proc.stderr.text();
  expect(stderr.match(/^error: plugin failed on purpose$/gm), stderr).toHaveLength(1);
});

test.concurrent("releases a framework request that the client aborts while it waits for a plugin load", async () => {
  using dir = tempDir("serve-plugins-devserver-abort-framework", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": parkedPlugin,
    "render.ts": `export function render() { return new Response("rendered"); }`,
    "routes/index.ts": `export default {};`,
    "server.ts": `
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      globalThis.__setup = { entered: entered.resolve, release: release.promise, finished() {} };

      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./render.ts" };
      const server = Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } });
      const controller = new AbortController();
      const aborted = fetch(server.url, { signal: controller.signal }).catch(err => err.name);
      await entered.promise;
      controller.abort();
      console.log(await aborted);
      // The server has seen the disconnect by the time it responds to this request.
      console.log((await fetch(new URL("/no-such-route", server.url))).status);
      release.resolve("resolve");
      console.log(await fetch(server.url).then(res => res.text()), server.pendingRequests);
      await server.stop();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout, stderr).toBe("AbortError\n404\nrendered 0\n");
  expect(exitCode).toBe(0);
});

// Windows refuses to rename over a file that the watcher has open.
test.skipIf(isWindows)("responds to a framework request queued behind the reload that bundles its page", async () => {
  using dir = tempDir("serve-plugins-devserver-queued-framework", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": `
      export default {
        name: "park-page",
        setup(build) {
          build.onLoad({ filter: /edited\\.ts$/ }, async () => {
            if (!globalThis.loadParked) return;
            globalThis.loadParked.resolve();
            await globalThis.releaseLoad.promise;
          });
        },
      };
    `,
    "render.ts": `export function render(request, meta) { return new Response(meta.pageModule.default); }`,
    // The import gets the page bundled, which is what makes kqueue and Windows watch it.
    "routes/index.ts": `import "./edited.ts"; export default "index";`,
    "routes/edited.ts": `export default "before";`,
    "server.ts": `
      import { renameSync, writeFileSync } from "node:fs";
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./render.ts" };
      const server = Bun.serve({ port: 0, development: true, app: { framework: { fileSystemRouterTypes: [fsr] } } });
      const get = path => fetch(new URL(path, server.url)).then(res => res.text());
      console.log(await get("/"));
      globalThis.loadParked = Promise.withResolvers();
      globalThis.releaseLoad = Promise.withResolvers();

      // A rename is a single watcher event, so a second reload isn't queued behind the first.
      writeFileSync("edited.next", 'export default "after";');
      renameSync("edited.next", "routes/edited.ts");
      await globalThis.loadParked.promise;
      const queued = get("/edited");
      // The server has read the request for the page by the time it responds to this one.
      await get("/no-such-route");
      globalThis.releaseLoad.resolve();
      console.log(await queued);
      console.log(await get("/edited"));
      await server.stop();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout, stderr).toBe("index\nafter\nafter\n");
  expect(exitCode).toBe(0);
});
