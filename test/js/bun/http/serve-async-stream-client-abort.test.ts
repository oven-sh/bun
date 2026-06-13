import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/32111
test("client aborting an async-pull ReadableStream response does not crash the server", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-async-stream-client-abort-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stderr: "",
    stdout: expect.stringContaining('"ok":true'),
    exitCode: 0,
    signalCode: null,
  });
}, 60_000);
