import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import path from "node:path";

// The fixture is a `bun test` suite of its own: the bunfig.toml in its
// directory registers the serve plugin, and the heap counts it asserts on need
// a process without other servers in it. The child takes a few seconds under
// ASAN, so it gets a timeout above the 5s default.
async function runDeinitializationSuite() {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./test.ts"],
    env: bunEnv,
    cwd: path.join(import.meta.dir, "fixtures/deinitialization"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error(stderr);

  // The per-test results and the summary. The dev server's own log lines and
  // the expect() call count are left out: they change with unrelated edits.
  const report = normalizeBunSnapshot(stderr)
    .split("\n")
    .filter(line => /^\((pass|fail|skip|todo)\) |^ \d+ (pass|fail)$|^Ran /.test(line))
    .join("\n");
  expect(report).toMatchInlineSnapshot(`
    "(pass) baseline: stopped server wrapper collects
    (pass) flags: none
    (pass) flags: websocket=1
    (pass) flags: closeActiveConnections websocket=1
    (pass) flags: sendAnyRequests
    (pass) flags: sendAnyRequests websocket=1
    (pass) flags: closeActiveConnections sendAnyRequests
    (pass) flags: closeActiveConnections sendAnyRequests websocket=1
    (pass) flags: websocket=8
    (pass) flags: closeActiveConnections websocket=8
     10 pass
     0 fail
    Ran 10 tests across 1 file."
  `);
  expect(normalizeBunSnapshot(stdout)).toContain("bun test <version> (<revision>)");
  expect(exitCode).toBe(0);
}

test.concurrent("dev server deinitializes itself", runDeinitializationSuite, 30_000);

test.concurrent("dev server is deinitialized before its arena when listen fails", async () => {
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
