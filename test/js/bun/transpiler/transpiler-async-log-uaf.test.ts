import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// `Bun.Transpiler.transform()` runs parsing on a worker thread using an arena
// allocator. Log messages (text + locations) were allocated from that arena,
// which was freed before the promise was settled on the JS thread, leading to
// a use-after-free when rendering the error. Run the repro in a subprocess so
// an ASAN abort is observed as a test failure rather than killing the runner.
test("async transform with parse errors does not read freed log messages", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "transpiler-async-log-uaf-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    stdout: stdout.trim(),
    exitCode,
    signalCode: proc.signalCode,
    asan: stderr.includes("AddressSanitizer"),
  }).toEqual({
    stdout: "DONE",
    exitCode: 0,
    signalCode: null,
    asan: false,
  });
});
