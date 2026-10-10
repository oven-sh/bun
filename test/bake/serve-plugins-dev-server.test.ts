// ServePlugins.handleOnResolve / handleOnReject take `pending = &this.state.pending`,
// then reassign `this.state` to a different union variant, and must still be able to
// notify the DevServer afterwards. That only works if `dev_server` is read out of the
// pending payload *before* the reassignment. When it isn't, the optional reads back as
// null (or garbage, depending on build mode) and the DevServer is never told that
// plugin loading finished, so the request it deferred to `next_bundle` waits forever.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
      await server.stop(true);
      console.log(JSON.stringify({ result }));
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
  const { result } = JSON.parse(line!);
  // With the DevServer notified, the deferred request is released promptly. If it
  // isn't, the fetch sits until the 10s abort fires and we see "TimeoutError" here.
  expect(result).not.toBe("TimeoutError");
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

// The cases below tear the server down while requests are parked in the DevServer on a
// `[serve.static]` plugin whose setup() has not finished. The teardown frees the DevServer,
// so each parked request must be released exactly once, and a load that settles afterwards
// must find no DevServer to tell, also when the server itself is already freed.
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

const teardownWhileParkedServer = /* ts */ `
  import { getDevServerDeinitCount } from "bun:internal-for-testing";
  import { estimateShallowMemoryUsageOf } from "bun:jsc";
  import html from "./index.html";

  const [teardown, settle, count] = [process.argv[2], process.argv[3], Number(process.argv[4])];
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const finished = Promise.withResolvers();
  globalThis.__setup = { entered: entered.resolve, release: release.promise, finished: finished.resolve };

  const turn = () => new Promise(resolve => setImmediate(resolve));
  const outcome = (response: Promise<Response>) =>
    response.then(
      res => String(res.status),
      err => (typeof err.code === "string" ? err.code : err.name),
    );

  let collected = false;
  const registry = new FinalizationRegistry(() => void (collected = true));
  // Refers to the server until the end, except in the case that has it collected.
  let keepServer: unknown;

  // Its own frame, so that nothing on the stack refers to the server once it returns.
  async function teardownWhileParked() {
    const server = Bun.serve({
      port: 0,
      development: true,
      routes: { "/": html },
      fetch: () => new Response("fallback"),
    });
    registry.register(server, "server");
    if (teardown !== "stop-then-collect") keepServer = server;
    const url = server.url;
    const controller = new AbortController();

    // The first request starts the plugin load and is parked behind it.
    const requests = [outcome(fetch(url, { signal: controller.signal }))];
    await entered.promise;
    await turn();
    // Each later request is parked on arrival: one more node in the dev server's memory cost.
    while (requests.length < count) {
      const before = estimateShallowMemoryUsageOf(server);
      requests.push(outcome(fetch(url, { signal: controller.signal })));
      while (estimateShallowMemoryUsageOf(server) <= before) await turn();
    }

    let stopped: Promise<void> | undefined;
    if (teardown === "dispose") {
      server[Symbol.dispose]();
    } else if (teardown === "abort-then-stop") {
      controller.abort();
      await Promise.all(requests);
      stopped = server.stop(true);
    } else if (teardown === "stop-then-disconnect") {
      // The server frees the DevServer when it sees the last connection close.
      stopped = server.stop();
      controller.abort();
    } else {
      stopped = server.stop(true);
    }
    const pendingAfterStop = server.pendingRequests;
    await stopped;
    return { requests: await Promise.all(requests), pendingAfterStop };
  }

  const deinitsBefore = getDevServerDeinitCount();
  const { requests, pendingAfterStop } = await teardownWhileParked();
  const deinits = getDevServerDeinitCount() - deinitsBefore;

  if (teardown === "stop-then-collect") {
    // The server itself is freed before the load settles.
    for (let i = 0; i < 50 && !collected; i++) {
      Bun.gc(true);
      await turn();
    }
    await turn();
  }

  if (settle !== "never") {
    release.resolve(settle);
    await finished.promise;
    // The reaction that reports the load to the server runs in the microtasks of this turn.
    await turn();
  }

  // The event loop and the allocator still work.
  const probe = Bun.serve({ port: 0, fetch: () => new Response("alive") });
  const alive = await fetch(probe.url).then(res => res.text());
  await probe.stop(true);
  console.log(JSON.stringify({ requests, pendingAfterStop, deinits, collected, alive }));
`;

test.concurrent.each([
  // 17 parked requests: the first 16 nodes are slots inside the DevServer, the 17th is a heap box.
  ["stop", "never", 1],
  ["stop", "resolve", 17],
  ["dispose", "reject", 1],
  ["abort-then-stop", "resolve", 1],
  ["stop-then-disconnect", "reject", 17],
  // The server object is garbage collected, and the server freed, before the load settles.
  ["stop-then-collect", "resolve", 1],
] as const)(
  "teardown '%s' with a pending plugin load (settles later: %s) and %d parked",
  async (teardown, settle, count) => {
    using dir = tempDir(`serve-plugins-devserver-${teardown}-${settle}-${count}`, {
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "plugin.ts": parkedPlugin,
      "index.html": indexHtml,
      "entry.ts": `console.log("entry");`,
      "server.ts": teardownWhileParkedServer,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.ts", teardown, settle, String(count)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const line = stdout.split("\n").find(l => l.startsWith("{"));
    const clientAborted = teardown === "abort-then-stop" || teardown === "stop-then-disconnect";
    expect(line === undefined ? undefined : JSON.parse(line), stderr).toEqual({
      requests: Array(count).fill(clientAborted ? "AbortError" : "ECONNRESET"),
      // The load does not hold the server: stop() settles and frees the DevServer without it.
      pendingAfterStop: 0,
      deinits: 1,
      collected: teardown === "stop-then-collect",
      alive: "alive",
    });
    if (settle === "reject") expect(stderr).toContain("plugin setup failed after stop");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  },
  // Passes in about a second; the ceiling is for the failure path, where ASAN
  // symbolizes the report against the debug binary before the child exits.
  30_000,
);
