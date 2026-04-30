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
test("DevServer is notified when [serve.static] plugin setup rejects", async () => {
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
}, 30_000);

// DevServer waits on `[serve.static]` plugins and the plugin promise resolves.
// Exercises ServePlugins.handleOnResolve with pending.dev_server set — the DevServer
// must be handed the resolved plugin so its bundle actually goes through it.
test("DevServer is notified when [serve.static] plugin setup resolves", async () => {
  using dir = tempDir("serve-plugins-devserver-resolve", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": `
      export default {
        name: "marker-plugin",
        async setup(build) {
          await Promise.resolve();
          build.onLoad({ filter: /entry\\.ts$/ }, () => ({
            loader: "ts",
            contents: "console.log('from-plugin');",
          }));
        },
      };
    `,
    "index.html": indexHtml,
    "entry.ts": `console.log("not-from-plugin");`,
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
      console.log(JSON.stringify({ status: res.status, fromPlugin: js.includes("from-plugin") }));
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
}, 30_000);
