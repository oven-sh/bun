// Verifies that a zeroed ConcurrentTask (the bit pattern produced by
// `ConcurrentTask::default()`, and the one the event loop observes when an
// inline `concurrent_task` field's owner is freed while still queued) is
// caught by the `task_tag::INVALID` sentinel in `run_task` instead of being
// dispatched as whichever real task type happens to be tag value 0.
//
// Before the sentinel existed, tag 0 was `Access` and the dispatch called
// `AsyncFSTask<_, Access, _>::run_from_js_thread` with `self = null`, which
// segfaults at the `self.result` field offset with no hint as to why.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { access } from "node:fs/promises";

test("tag 0 is no longer a real task type (fs.promises.access still dispatches)", async () => {
  // `access` was the tag-0 type before the sentinel reserved it; this round-trip
  // through the work-pool → concurrent queue → dispatch path proves the shift
  // left it intact. A plain await proves dispatch (any rejection fails the test).
  await access(import.meta.path);
  await expect(access(import.meta.path + ".does-not-exist")).rejects.toMatchObject({ code: "ENOENT" });
});

// The child intentionally panics; the debug build's crash handler symbolicates
// the full backtrace, which is slow under ASAN.
test("a zeroed ConcurrentTask is reported, not dispatched", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { enqueueZeroedConcurrentTaskForTesting } = require("bun:internal-for-testing");
        enqueueZeroedConcurrentTaskForTesting();
        // Return to the loop so the concurrent queue drains and run_task sees it.
        await new Promise(r => setImmediate(r));
        console.log("unreachable");
      `,
    ],
    env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("unreachable");
  // The sentinel panic message. Without the sentinel, tag 0 dispatched as
  // `fs.access` with a null self and the process segfaulted (no such text).
  expect(stderr).toContain("zeroed ConcurrentTask");
  expect(stderr).not.toMatch(/Segmentation fault|EXC_BAD_ACCESS|EXCEPTION_ACCESS_VIOLATION/);
  expect(exitCode).not.toBe(0);
}, 30_000);
