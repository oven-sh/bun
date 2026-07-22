import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The HTTP thread's result callback must hold the tasklet mutex through its
// deref_from_thread call so it is never the 1->0 transition. When it was
// not, the deref could schedule a deinit_callback task that later observed
// a nonzero refcount and panicked with
// "assertion failed: self.raw_count.load(Ordering::SeqCst) == 0".
//
// The race window is a handful of instructions between mutex.unlock() and
// deref_from_thread() on the HTTP thread, so this test is best-effort: it
// exercises many concurrent fetch + abort cycles under load and asserts
// the process completes. It does not deterministically reproduce the crash
// on an unfixed build; a debug_assert in deref_from_thread documents the
// invariant the mutex ordering enforces.
test("FetchTasklet HTTP-thread deref is never the final ref", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fetch-tasklet-deref-race-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Include stderr in the failure message for diagnostics without asserting
  // it is exactly empty (debug/ASAN builds may emit benign warnings).
  expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({
    stdout: "ok",
    exitCode: 0,
  });
}, 30_000);
