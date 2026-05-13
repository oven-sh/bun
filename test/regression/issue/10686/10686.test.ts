// https://github.com/oven-sh/bun/issues/10686
//
// Bun.write(path, fetchResponse) with a still-in-flight body installs
// `Locked.onReceiveValue` and awaits. Once the await is entered the JS
// Response wrapper is unreachable; when GC collected it, the weak finalizer
// Bun__FetchResponse_finalize only checked `Locked.promise`, missed
// `onReceiveValue`, and discarded the remaining body — so the Bun.write
// promise never resolved.
//
// Separately, when the body *did* arrive, WriteFileWaitFromLockedValueTask.then
// never detached the Blob it got from `value.use()`, leaking one Store per
// write.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import path from "node:path";

test("Bun.write(path, fetchResponse) resolves when the Response is GC'd mid-write", async () => {
  using dir = tempDir("bun-write-response-10686", {});

  // Debug/ASAN has much higher baseline RSS. The leak this covers is
  // 4 MB/iteration × 50 iterations = 200 MB; the ceilings below are well
  // under that growth in both profiles.
  const maxGrowthMB = isASAN || isDebug ? 150 : 80;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", path.join(import.meta.dir, "10686-fixture.js"), String(dir), String(maxGrowthMB)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(60_000),
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Before the fix the child hangs inside `await Bun.write(...)` once GC
  // collects the Response and is killed by the AbortSignal above with no
  // stdout. With the fix every iteration completes and RSS growth is flat.
  expect(stderr).toBe("");
  expect(stdout.trim()).toStartWith('{"ok":true');
  expect(exitCode).toBe(0);
}, 90_000);
