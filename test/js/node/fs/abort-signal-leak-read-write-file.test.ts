import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

test("fs.promises readFile/writeFile does not leak AbortSignal", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "abort-signal-leak-read-write-file-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // rss is reported for diagnostics only; the AbortSignal wrapper count is the
  // assertion that actually detects a missing pending-activity unref.
  const { numAbortSignalObjects, nonAbortErrors } = JSON.parse(stdout);
  expect({ nonAbortErrors }).toEqual({ nonAbortErrors: 0 });
  expect(numAbortSignalObjects).toBeLessThanOrEqual(10);
  expect(exitCode).toBe(0);
});
