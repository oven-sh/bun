import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
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
// `server.stop()`, so every disposed dev server kept one inotify instance (and
// one thread) until process exit. With a tight `fs.inotify.max_user_instances`
// budget this surfaced as `EMFILE while initializing file watcher`.
// The `/proc/self/{fd,status}` probes are Linux-specific.
test.skipIf(!isLinux)(
  "dev server releases its file watcher on stop()",
  async () => {
    const fixture = /* ts */ `
    import { readdirSync, readlinkSync, readFileSync } from "node:fs";
    import html from "./index.html";

    function scan() {
      let inotify = 0;
      for (const name of readdirSync("/proc/self/fd")) {
        try {
          if (readlinkSync("/proc/self/fd/" + name) === "anon_inode:inotify") inotify++;
        } catch {}
      }
      const status = readFileSync("/proc/self/status", "utf8");
      const threads = Number(/^Threads:\\s+(\\d+)/m.exec(status)?.[1] ?? 0);
      return { inotify, threads };
    }

    const ITER = 10;

    // warm-up: the first server initialises process-global state
    {
      const s = Bun.serve({ port: 0, development: true, static: { "/": html }, fetch: () => new Response("") });
      await (await fetch(s.url)).text();
      s.stop(true);
    }
    // wait for the warm-up watcher to release so it isn't counted
    for (let i = 0; i < 40 && scan().inotify > 0; i++) {
      Bun.gc(true);
      await Bun.sleep(50);
    }
    const before = scan();

    for (let i = 0; i < ITER; i++) {
      const s = Bun.serve({ port: 0, development: true, static: { "/": html }, fetch: () => new Response("") });
      await (await fetch(s.url)).text();
      s.stop(true);
    }

    // poll until the watcher threads have closed their inotify instances
    // (Threads: is not a reliable gate; JSC may spawn a collector thread)
    for (let i = 0; i < 40 && scan().inotify > before.inotify; i++) {
      Bun.gc(true);
      await Bun.sleep(50);
    }

    const after = scan();
    console.log(JSON.stringify({
      iterations: ITER,
      inotifyDelta: after.inotify - before.inotify,
      threadDelta: after.threads - before.threads,
    }));
  `;

    using dir = tempDir("dev-server-watcher-release", {
      "index.html": "<!doctype html><html><body>hi</body></html>",
      "fixture.ts": fixture,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const line = stdout
      .split("\n")
      .reverse()
      .find(l => l.startsWith("{"));
    if (!line) {
      throw new Error(`no JSON summary in stdout.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    const { inotifyDelta, threadDelta } = JSON.parse(line);

    expect(stderr).not.toContain("error:");

    // Without the fix every iteration leaks one inotify instance
    // (inotifyDelta == iterations). With the fix all of them are released.
    // `threadDelta` is reported for diagnostics only: `Threads:` also counts
    // JSC/bundler threads and can transiently read high right after `stop()`
    // has closed the inotify fd but before the watcher thread has exited.
    expect({ inotifyDelta, threadDelta }).toEqual({
      inotifyDelta: 0,
      threadDelta: expect.any(Number),
    });

    expect(exitCode).toBe(0);
    // 11 dev-server start/stop cycles under ASAN; without the fix the fixture's
    // two 2s release polls also run to completion.
  },
  30_000,
);
