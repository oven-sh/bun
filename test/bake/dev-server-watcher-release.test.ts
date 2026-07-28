// Each stopped `Bun.serve({ development: true })` must release its file
// watcher. On Linux the watcher thread was parked in a blocking `read()` on
// the inotify fd after `server.stop()`, so every disposed dev server leaked
// one inotify instance (and one thread) until process exit. In a container
// with a tight `fs.inotify.max_user_instances` budget this surfaced as
// `EMFILE while initializing file watcher for development server`.

import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, isLinux, isWindows } from "harness";

// Windows watcher `wake()` is intentionally a no-op (see
// `src/watcher/WindowsWatcher.rs`), so the thread/handle are held until
// process exit there; the inotify-instance budget problem this test covers
// is POSIX-specific.
test.skipIf(isWindows)("dev server releases its file watcher on stop()", async () => {
  const fixture = /* ts */ `
    import { readdirSync, readlinkSync, readFileSync } from "node:fs";
    import html from "./index.html";

    function scan() {
      if (process.platform !== "linux") return { inotify: 0, threads: 0 };
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

    // poll until watcher threads have observed running=false and exited
    for (let i = 0; i < 40; i++) {
      Bun.gc(true);
      const now = scan();
      if (now.inotify <= before.inotify && now.threads <= before.threads) break;
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
  const { iterations, inotifyDelta, threadDelta } = JSON.parse(line);

  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  if (isLinux) {
    // Without the fix every iteration leaks one inotify instance
    // (inotifyDelta == iterations). With the fix all of them are released.
    expect(inotifyDelta).toBeLessThanOrEqual(1);
    expect(inotifyDelta).toBeLessThan(iterations);
    expect(threadDelta).toBeLessThan(iterations);
  }
});
