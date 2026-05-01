import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";

// Regression test: EventLoop.tickConcurrentWithCount used `writableSlice(0)`
// after `ensureUnusedCapacity(count)`. The latter guarantees `writableLength()
// >= count` (total free ring-buffer space), but the former only returns the
// contiguous tail segment — which is shorter when `head > 0`. The copy loop
// `break`s when that slice fills, silently dropping the remaining popped
// ConcurrentTasks (and leaking their auto_delete wrappers).
//
// The wrap-vulnerable state (`head > 0 && count > 0` on entry) is reachable
// via HotReloadTask, which early-returns from tickQueueWithCount before the
// queue is fully drained. See the fixture for the exact batch layout.
//
// Windows: `--hot` uses a different watch backend with enough latency that
// the HotReloadTask can't reliably be placed between phases A and C.
test.skipIf(isWindows)(
  "tickConcurrentWithCount does not drop ConcurrentTasks when the task FIFO wraps after a HotReloadTask early-return",
  async () => {
    using dir = tempDir("hot-concurrent-fifo", {
      // File is rewritten by the fixture itself to trigger the reload; copy
      // it into the temp dir so we don't mutate the checked-in fixture.
      "entry.js": "",
    });
    cpSync(join(import.meta.dir, "hot-concurrent-fifo-fixture.js"), join(String(dir), "entry.js"));

    // The watcher enqueueing the HotReloadTask between phase A and phase C is
    // the only timing-dependent step (inotify is normally sub-millisecond and
    // the fixture sleeps 250ms). If it lands late the fixture still exits 0 on
    // any build but reports `run: 1`, so retry a couple of times before
    // treating it as a real miss.
    let result: { run: number; total: number; resolved: number } | undefined;
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = stdout
        .trim()
        .split("\n")
        .findLast(l => l.startsWith("{"));
      expect(line, `no JSON in stdout:\n${stdout}\nstderr:\n${stderr}`).toBeString();
      result = JSON.parse(line!);
      if (result!.run >= 2) break;
      // Watcher didn't fire in time — restore the fixture and retry.
      cpSync(join(import.meta.dir, "hot-concurrent-fifo-fixture.js"), join(String(dir), "entry.js"));
    }

    expect(result!.run, "hot reload never fired; watcher too slow on this platform").toBeGreaterThanOrEqual(2);
    expect({ resolved: result!.resolved, total: result!.total }).toEqual({
      resolved: result!.total,
      total: result!.total,
    });
    expect(exitCode, `stderr:\n${stderr}`).toBe(0);
  },
);
