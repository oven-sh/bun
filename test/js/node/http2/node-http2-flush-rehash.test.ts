import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// Regression test: Stream.flushQueue in h2_frame_parser.zig held a *Stream
// pointer (into the streams HashMap) across a JS callback. If that callback
// created new streams, the HashMap could rehash and free the backing storage,
// leaving flushQueue to read/write freed memory when it resumed. Under ASAN
// this aborts with heap-use-after-free; in release builds it corrupts state.
test("http2 client write callback that opens new streams during flushQueue does not UAF", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "node-http2-flush-rehash-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Print stderr on failure so ASAN reports are visible in CI output.
  expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "ok", exitCode: 0 });
}, 30_000);
