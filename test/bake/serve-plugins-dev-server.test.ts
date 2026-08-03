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

// Same reject path but the deferred request is a *framework* route
// (DeferredRequest::Handler::ServerHandler) rather than a BundledHtmlPage.
// on_plugins_rejected drains the deferred list; the ServerHandler arm must
// write a response and release both RequestContext refs (the
// prepare_and_save +1 and defer_request's ctx.ref_() +1) so the server's
// pending_requests reaches zero and DevServer::drop runs after stop(true).
test.concurrent(
  "on_plugins_rejected responds and releases a deferred framework-route RequestContext",
  async () => {
    using dir = tempDir("serve-plugins-devserver-reject-framework", {
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "plugin.ts": `
        export default {
          name: "boom-plugin",
          async setup() {
            await Promise.resolve();
            throw new Error("plugin setup failed on purpose");
          },
        };
      `,
      "minimal.server.ts": `
        export function render(req, meta) {
          return meta.pageModule.default(req, meta);
        }
        export function registerClientReference(value, file, uid) {
          return { value, file, uid };
        }
      `,
      "routes/index.ts": `
        export default function () {
          return new Response("unreachable: plugin load fails first");
        }
      `,
      "server.ts": `
        import { getDevServerDeinitCount } from "bun:internal-for-testing";
        const server = Bun.serve({
          port: 0,
          development: true,
          app: {
            framework: {
              fileSystemRouterTypes: [
                { root: "./routes", style: "nextjs-pages", serverEntryPoint: "./minimal.server.ts" },
              ],
              serverComponents: {
                separateSSRGraph: false,
                serverRuntimeImportSource: "./minimal.server.ts",
                serverRegisterClientReferenceExport: "registerClientReference",
              },
            },
          },
          fetch() { return new Response("fallback"); },
        } as any);

        // First request defers into next_bundle.requests as Handler::ServerHandler
        // while [serve.static] plugins are Pending; the plugin then rejects and
        // on_plugins_rejected drains the list. The deferred entry must be answered
        // (500) and its RequestContext fully released so stop(true) can deinit.
        // The reject runs on the next microtask after the request is deferred, so
        // the fixed path answers well under a second.
        let result;
        try {
          const res = await fetch(server.url, { signal: AbortSignal.timeout(3_000) });
          result = String(res.status);
        } catch (e) {
          result = (e as Error).name;
        }

        const before = getDevServerDeinitCount();
        server.stop(true);
        let deinit = false;
        for (let i = 0; i < 250; i++) {
          Bun.gc(true);
          await new Promise(r => setTimeout(r, 1));
          if (getDevServerDeinitCount() > before) { deinit = true; break; }
        }
        console.log(JSON.stringify({ result, deinit }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("plugin setup failed on purpose");

    const line = stdout.split("\n").find(l => l.startsWith("{"));
    expect(line).toBeDefined();
    // Without the fix the ServerHandler arm wrote nothing and dropped only the
    // js_request Strong, so the fetch hit the AbortSignal timeout
    // ("TimeoutError") and the stranded RequestContext ref kept
    // pending_requests > 0 (deinit: false).
    expect(JSON.parse(line!)).toEqual({ result: "500", deinit: true });
    expect(exitCode).toBe(0);
  },
  20_000,
);

// Same as above but server.stop() takes the listener *before* the plugin
// promise rejects. on_plugins_rejected now drives pending_requests to zero
// inside its drain, so without a keep-alive that would re-enter
// deinit_if_we_can() and drop Box<DevServer> mid-loop (UAF on the deferred
// request pool and next_bundle list head).
test.concurrent(
  "on_plugins_rejected after server.stop(): deferred framework request is released without tearing down the DevServer mid-drain",
  async () => {
    using dir = tempDir("serve-plugins-devserver-reject-framework-stopped", {
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "plugin.ts": `
        import * as fs from "node:fs";
        import * as path from "node:path";
        export default {
          name: "boom-plugin",
          async setup() {
            // setup() is only reached after the first request has triggered
            // get_or_load_plugins and been deferred into next_bundle.requests,
            // so by the time this marker lands the DeferredRequest exists.
            fs.writeFileSync(path.join(import.meta.dir, "entered"), "");
            const stopped = path.join(import.meta.dir, "stopped");
            while (!fs.existsSync(stopped)) {
              await new Promise(r => setTimeout(r, 5));
            }
            throw new Error("plugin setup failed on purpose");
          },
        };
      `,
      "minimal.server.ts": `
        export function render(req, meta) {
          return meta.pageModule.default(req, meta);
        }
        export function registerClientReference(value, file, uid) {
          return { value, file, uid };
        }
      `,
      "routes/index.ts": `
        export default function () {
          return new Response("unreachable: plugin load fails first");
        }
      `,
      "server.ts": `
        import * as fs from "node:fs";
        import * as path from "node:path";
        import { getDevServerDeinitCount } from "bun:internal-for-testing";
        const entered = path.join(import.meta.dir, "entered");
        const stopped = path.join(import.meta.dir, "stopped");
        const server = Bun.serve({
          port: 0,
          development: true,
          app: {
            framework: {
              fileSystemRouterTypes: [
                { root: "./routes", style: "nextjs-pages", serverEntryPoint: "./minimal.server.ts" },
              ],
              serverComponents: {
                separateSSRGraph: false,
                serverRuntimeImportSource: "./minimal.server.ts",
                serverRegisterClientReferenceExport: "registerClientReference",
              },
            },
          },
          fetch() { return new Response("fallback"); },
        } as any);

        // Issue the request (defers as Handler::ServerHandler while plugin setup
        // is spinning), then take the listener away before letting setup throw.
        const pending = fetch(server.url, { signal: AbortSignal.timeout(5_000) })
          .then(r => String(r.status))
          .catch(e => (e as Error).name);
        // Wait until the plugin has actually been entered: that only happens
        // after the request was deferred, so the DeferredRequest is in place.
        while (!fs.existsSync(entered)) {
          await new Promise(r => setTimeout(r, 5));
        }

        const before = getDevServerDeinitCount();
        // Graceful: closes the listen socket only; the deferred request's
        // connection stays open and pending_requests stays > 0.
        server.stop();
        // Now let the plugin throw so on_plugins_rejected drains the list with
        // the listener already gone.
        fs.writeFileSync(stopped, "");

        const result = await pending;
        let deinit = false;
        for (let i = 0; i < 250; i++) {
          Bun.gc(true);
          await new Promise(r => setTimeout(r, 1));
          if (getDevServerDeinitCount() > before) { deinit = true; break; }
        }
        console.log(JSON.stringify({ result, deinit }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("plugin setup failed on purpose");

    const line = stdout.split("\n").find(l => l.startsWith("{"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toEqual({ result: "500", deinit: true });
    expect(exitCode).toBe(0);
  },
  20_000,
);
