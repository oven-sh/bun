import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import path from "node:path";

test("dev server deinitializes itself", async () => {
  // The child runs a whole `bun test` suite: nine GC-heavy dev server cases
  // plus leak reporting at exit (see fixtures/deinitialization/test.ts).
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./test.ts"],
    env: bunEnv,
    cwd: path.join(import.meta.dir, "fixtures/deinitialization"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Every case's result line plus the child's summary. A case that hangs or
  // crashes the child is missing from this list before the exit code says so.
  const results = normalizeBunSnapshot(stderr)
    .split("\n")
    .filter(line => /^\((pass|fail|skip|todo)\) /.test(line) || /^\s*\d+ (pass|fail)$/.test(line));
  expect(results).toMatchInlineSnapshot(`
    [
      "(pass) baseline: stopped server wrapper collects",
      "(pass) flags: ",
      "(pass) flags: websocket=1",
      "(pass) flags: closeActiveConnections websocket=1",
      "(pass) flags: sendAnyRequests",
      "(pass) flags: sendAnyRequests websocket=1",
      "(pass) flags: closeActiveConnections sendAnyRequests",
      "(pass) flags: closeActiveConnections sendAnyRequests websocket=1",
      "(pass) flags: websocket=8",
      "(pass) flags: closeActiveConnections websocket=8",
      " 10 pass",
      " 0 fail",
    ]
  `);
  expect(stdout).toStartWith("bun test v");
  expect(exitCode).toBe(0);
  // About 3s under a debug ASAN build, most of it the child's startup.
}, 20_000);

test("dev server is deinitialized before its arena when listen fails", async () => {
  using dir = tempDir("dev-server-listen-fails", {
    "index.html": `<!DOCTYPE html><html><body></body></html>`,
    "listen-fails-fixture.ts": `
      import { getDevServerDeinitCount } from "bun:internal-for-testing";
      import html from "./index.html";

      const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("taken") });
      const deinitsBefore = getDevServerDeinitCount();
      let code = "listen succeeded";
      try {
        Bun.serve({ development: true, hostname: "127.0.0.1", port: taken.port, routes: { "/": html } }).stop(true);
      } catch (e) {
        code = e.code;
      }
      const deinits = getDevServerDeinitCount() - deinitsBefore;
      taken.stop(true);
      console.log(JSON.stringify({ code, deinits }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "listen-fails-fixture.ts"],
    // A read of a freed arena then faults in debug builds instead of seeing stale bytes.
    env: { ...bunEnv, MIMALLOC_PURGE_DELAY: "0" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe('{"code":"EADDRINUSE","deinits":1}\n');
  expect(exitCode).toBe(0);
});
