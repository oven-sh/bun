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

// stop(true) while the first request is parked on the `[serve.static]` plugin's setup(): the DevServer must survive until the load settles (it shows as a pending request) and be freed once it does.
const pluginParkedInSetup = (afterRelease: string) => `
  export default {
    name: "parked-plugin",
    async setup() {
      globalThis.__parked();
      await globalThis.__release;
      ${afterRelease}
    },
  };
`;

const stopDuringPluginLoadServer = /* ts */ `
  import html from "./index.html";

  const parked = Promise.withResolvers();
  const release = Promise.withResolvers();
  globalThis.__parked = parked.resolve;
  globalThis.__release = release.promise;

  const server = Bun.serve({
    port: 0,
    development: true,
    routes: { "/": html },
    fetch() { return new Response("fallback"); },
  });

  const controller = new AbortController();
  const request = fetch(server.url, { signal: controller.signal }).then(
    res => String(res.status),
    err => (typeof err.code === "string" ? err.code : err.name),
  );
  // setup() has been entered, so the request is deferred inside the DevServer.
  await parked.promise;

  if (process.argv[2] === "client-abort") {
    controller.abort();
    await request;
    // A round trip through the plain fetch handler lets the server process the aborted connection before stop().
    await fetch(new URL("/probe", server.url)).then(res => res.text());
  }

  const stopped = server.stop(true);
  const pendingAfterStop = server.pendingRequests;

  release.resolve();
  let timer;
  const stop = await Promise.race([
    stopped.then(() => "closed"),
    new Promise(resolve => { timer = setTimeout(() => resolve("timeout"), 10_000); }),
  ]);
  clearTimeout(timer);

  console.log(JSON.stringify({ request: await request, pendingAfterStop, stop }));
`;

async function stopDuringPluginLoad(name: string, plugin: string, abortedBy: "client-abort" | "stop") {
  using dir = tempDir(`serve-plugins-devserver-${name}`, {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": plugin,
    "index.html": indexHtml,
    "entry.ts": `console.log("entry");`,
    "server.ts": stopDuringPluginLoadServer,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts", abortedBy],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const line = stdout.split("\n").find(l => l.startsWith("{"));
  return { out: line === undefined ? undefined : JSON.parse(line), stderr, exitCode };
}

test.concurrent("stop(true) after the client aborted a request parked on plugin setup; setup resolves", async () => {
  const { out, stderr, exitCode } = await stopDuringPluginLoad(
    "abort-stop-resolve",
    pluginParkedInSetup(""),
    "client-abort",
  );
  expect(out, stderr).toEqual({ request: "AbortError", pendingAfterStop: 1, stop: "closed" });
  expect(exitCode).toBe(0);
});

test.concurrent("stop(true) after the client aborted a request parked on plugin setup; setup rejects", async () => {
  const { out, stderr, exitCode } = await stopDuringPluginLoad(
    "abort-stop-reject",
    pluginParkedInSetup(`throw new Error("plugin setup failed after stop");`),
    "client-abort",
  );
  expect(out, stderr).toEqual({ request: "AbortError", pendingAfterStop: 1, stop: "closed" });
  expect(stderr).toContain("plugin setup failed after stop");
  expect(exitCode).toBe(0);
});

test.concurrent("stop(true) itself aborts the request parked on plugin setup", async () => {
  const { out, stderr, exitCode } = await stopDuringPluginLoad("stop-aborts", pluginParkedInSetup(""), "stop");
  expect(out, stderr).toEqual({ request: "ECONNRESET", pendingAfterStop: 1, stop: "closed" });
  expect(exitCode).toBe(0);
});
