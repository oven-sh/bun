// https://github.com/oven-sh/bun/issues/21017
//
// When a DevServer is torn down immediately after creation (e.g. the
// configured port is already in use), the file Watcher it spawned must be
// shut down cleanly.
//
// Previously there were two bugs in `Watcher.deinit`:
//  1. It keyed off `watchloop_handle`, which is written by the *spawned*
//     thread. If `deinit()` ran before the thread was scheduled (easy to hit
//     on Windows), it freed the Watcher while the thread still held a
//     pointer to it → segfault in `threadMain`.
//  2. It set `running = false` but never woke the thread out of its blocking
//     wait, so the thread (and the Watcher) leaked until the next filesystem
//     event. With nothing being watched yet, that meant forever.
//
// This test exercises the teardown path repeatedly and asserts the process
// neither crashes nor accumulates watcher threads.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import path from "node:path";

test("Watcher is cleaned up when DevServer fails to start", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "dev-server-port-in-use-fixture.ts")],
    env: bunEnv,
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Diagnose failures with the subprocess output before asserting the exit
  // code, per repo testing convention.
  expect({ stdout, stderr }).toEqual({
    stdout: expect.stringContaining("PASS"),
    stderr: expect.anything(),
  });

  if (isLinux) {
    // On Linux we can observe the watcher-thread and inotify-fd leaks
    // directly via /proc. Without the fix, every failed `Bun.serve` leaves
    // a File Watcher thread parked on a futex and/or an open inotify
    // instance behind.
    const threadMatch = stdout.match(/THREAD_DELTA=(-?\d+)/);
    const inotifyMatch = stdout.match(/INOTIFY_DELTA=(-?\d+)/);
    expect(threadMatch).not.toBeNull();
    expect(inotifyMatch).not.toBeNull();
    const threadDelta = parseInt(threadMatch![1], 10);
    const inotifyDelta = parseInt(inotifyMatch![1], 10);
    // Allow a little slack for unrelated background threads/fds, but a
    // leak of one per iteration would be >= `iterations` (currently 40).
    expect(threadDelta).toBeLessThan(10);
    expect(inotifyDelta).toBeLessThan(10);
  }

  expect(exitCode).toBe(0);
});
