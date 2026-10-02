import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readdirSync, readlinkSync } from "node:fs";
import path from "node:path";

test("dev server deinitializes itself", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "test", path.join(import.meta.dir, "fixtures/deinitialization/test.ts")],
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
    cwd: path.join(import.meta.dir, "fixtures/deinitialization"),
  });
  expect(result.signalCode).toBeUndefined();
  expect(result.exitCode).toBe(0);
  // The child runs a whole `bun test` suite (nine GC-heavy cases plus leak
  // reporting at exit), which takes longer than the 5s default under ASAN.
}, 60_000);

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

// Each stopped `Bun.serve({ development: true })` must release its file
// watcher. The watcher thread used to stay parked in its blocking wait after
// `server.stop()`, so every disposed dev server kept one inotify instance until
// process exit, and a tight `fs.inotify.max_user_instances` budget ended in
// `EMFILE while initializing file watcher`. The `/proc/self/fd` probe is Linux-specific.
test.skipIf(!isLinux)("dev server releases its file watcher on stop()", async () => {
  using dir = tempDir("dev-server-watcher-release", {
    "index.html": "<!doctype html><html><body>hi</body></html>",
  });
  const { default: html } = await import(path.join(String(dir), "index.html"));
  const inotifyInstances = () => {
    let n = 0;
    for (const name of readdirSync("/proc/self/fd")) {
      try {
        if (readlinkSync("/proc/self/fd/" + name) === "anon_inode:inotify") n++;
      } catch {}
    }
    return n;
  };

  const before = inotifyInstances();
  for (let i = 0; i < 2; i++) {
    const server = Bun.serve({ port: 0, development: true, routes: { "/": html }, fetch: () => new Response("") });
    await (await fetch(server.url)).text();
    server.stop(true);
  }

  // The watcher thread closes its inotify fd once stop() wakes it. Without the
  // fix the thread never wakes and this never ends.
  while (inotifyInstances() > before) {
    await Bun.sleep(10);
  }
  expect(inotifyInstances()).toBe(before);
});
