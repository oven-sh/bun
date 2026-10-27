// ServePlugins.handleOnResolve / handleOnReject take `pending = &this.state.pending`,
// then reassign `this.state` to a different union variant, and must still be able to
// notify the DevServer afterwards. That only works if `dev_server` is read out of the
// pending payload *before* the reassignment. When it isn't, the optional reads back as
// null (or garbage, depending on build mode) and the DevServer is never told that
// plugin loading finished, so the request it deferred to `next_bundle` waits forever.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const indexHtml = /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><script type="module" src="./entry.ts"></script></body></html>`;

test.concurrent("onStart rejection waits for every started callback before the next bundle", async () => {
  using dir = tempDir("serve-plugins-onstart-settle", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": `
      export default {
        name: "settle-start-callbacks",
        setup(build) {
          build.onStart(() => {
            const state = globalThis.startState;
            if (state.rejecting) {
              state.events.push("fast-reject");
              throw new Error("preparation rejected");
            }
            if (state.armed) {
              state.events.push("next-start");
            }
          });
          build.onStart(async () => {
            const state = globalThis.startState;
            if (!state.rejecting) {
              return;
            }
            state.rejecting = false;
            state.events.push("slow-enter");
            state.entered.resolve();
            await state.release.promise;
            await Bun.write(new URL("./generated.ts", import.meta.url), 'export default "late generated value";');
            state.events.push("slow-settled");
            state.settled.resolve();
          });
        },
      };
    `,
    "render.ts": `export function render(request, meta) { return new Response(meta.pageModule.default); }`,
    "routes/index.ts": `export default "initial";`,
    "routes/next.ts": `import value from "../generated.ts"; export default value;`,
    "generated.ts": `export default "initial generated value";`,
    "server.ts": `
      import { writeFileSync } from "node:fs";
      const state = globalThis.startState = {
        armed: false,
        rejecting: false,
        events: [],
        entered: Promise.withResolvers(),
        release: Promise.withResolvers(),
        settled: Promise.withResolvers(),
      };
      const server = Bun.serve({
        port: 0,
        development: true,
        app: { framework: { fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./render.ts" }] } },
      });
      try {
        await fetch(server.url).then(response => response.text());
        state.armed = true;
        state.rejecting = true;
        writeFileSync("routes/index.ts", 'export default "edited";');
        await state.entered.promise;
        const pendingBeforeRequest = server.pendingRequests;
        let responded = false;
        const next = fetch(new URL("/next", server.url), { signal: AbortSignal.timeout(5_000) });
        next.then(() => { responded = true; }, () => { responded = true; });
        const deadline = Date.now() + 5_000;
        while (server.pendingRequests <= pendingBeforeRequest && !responded && !state.events.includes("next-start")) {
          if (Date.now() >= deadline) {
            throw new Error("second page request was not received");
          }
          await new Promise(setImmediate);
        }
        // Drain promise reactions after observing the queued request, while its sibling remains gated.
        await new Promise(setImmediate);
        const overlapped = responded || state.events.includes("next-start");
        state.events.push("gate-release");
        state.release.resolve();
        await state.settled.promise;
        const response = await next;
        const body = await response.text();
        console.log(JSON.stringify({ overlapped, status: response.status, body, events: state.events }));
      } finally {
        state.release.resolve();
        await server.stop(true);
      }
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
  const line = stdout.split("\n").find(line => line.startsWith("{"));
  expect(line, stderr).toBeDefined();
  const result = JSON.parse(line!);
  expect(result.overlapped).toBe(false);
  expect(result.status).toBe(200);
  expect(result.body).toBe("late generated value");
  expect(result.events).toContain("next-start");
  expect(result.events.indexOf("next-start")).toBeGreaterThan(result.events.indexOf("slow-settled"));
  expect(exitCode, stderr).toBe(0);
});

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

test.concurrent.each(["kept", "collected"])(
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
      cmd: [bunExe(), "server.ts", mode],
      env: bunEnv,
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
