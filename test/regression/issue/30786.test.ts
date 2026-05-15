// https://github.com/oven-sh/bun/issues/30786
//
// Issue: `src/bundler/ThreadPool.rs` initialized the module-static
// `io_thread_pool::MUTEX: Mutex` with `unsafe { bun_core::ffi::zeroed_unchecked() }`,
// relying on each `bun_threading::Mutex` backend (`OsUnfairLock`,
// `SRWLOCK_INIT`, `FutexImpl`) happening to have an all-zero unlocked state.
// The fix is to use the public `const fn Mutex::new()` — the documented
// constructor for `static` items — which every other `static Mutex` site
// already uses.
//
// This test exercises the code path that touches the static MUTEX:
// `BUN_FEATURE_FLAG_FORCE_IO_POOL=1` forces `ThreadPool::uses_io_pool()` to
// return true regardless of platform/thread-count, so `ThreadPool::init`
// calls `io_thread_pool::acquire()`. The first caller hits
// `MUTEX.lock_guard()` on `REF_COUNT == 0` and initializes the pool under the
// lock; subsequent `Bun.build()` calls in the same process reuse it via the
// `REF_COUNT` fast-path. A broken static-init (already-locked, poisoned
// futex word, ...) would deadlock at the first `lock_guard()` or trip the
// `debug_assert!(old > 1)` in `release()`. A successful end-to-end build is
// the regression coverage — both constructor variants produce an unlocked
// mutex at runtime today, but the previous `zeroed_unchecked()` approach
// was only sound by coincidence of each backend's layout; this test guards
// against a future Mutex rework that changes the zero representation.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("Bun.build runs with BUN_FEATURE_FLAG_FORCE_IO_POOL (io_thread_pool static MUTEX init)", async () => {
  const dir = tempDirWithFiles("bun-build-force-io-pool", {
    "a.js": "import {b} from './b.js'; import {c} from './c.js'; console.log(b + c);",
    "b.js": "export const b = 1;",
    "c.js": "import {d} from './d.js'; export const c = 2 + d;",
    "d.js": "export const d = 3;",
    "run.ts": `
      const dir = process.argv[2];
      // Two back-to-back builds: the first takes the slow path (REF_COUNT 0 ->
      // lock MUTEX -> init THREAD_POOL), the second takes the fast path
      // (REF_COUNT != 0, skips MUTEX entirely). Both must succeed.
      for (let i = 0; i < 2; i++) {
        const res = await Bun.build({ entrypoints: [dir + "/a.js"] });
        if (!res.success) throw new AggregateError(res.logs, "build " + i + " failed");
        if (res.outputs.length !== 1) throw new Error("expected 1 output, got " + res.outputs.length);
      }
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "run.ts"), dir],
    env: { ...bunEnv, BUN_FEATURE_FLAG_FORCE_IO_POOL: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
