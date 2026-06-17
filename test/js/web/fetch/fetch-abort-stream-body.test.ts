import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// Aborting a fetch whose request body stream is still uploading must also
// settle the response side. The failure callback used to return right after
// cancelling the request-body sink, so a buffered body promise
// (arrayBuffer/text/json) never rejected and awaiting it hung forever.
// Runs in a subprocess because the buggy build leaves zombie requests behind
// that keep the process from exiting.
test.concurrent(
  "abort mid-response rejects buffered body promises while the request body stream is active",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fetch-abort-buffered-body-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("arrayBuffer rejected AbortError\ntext rejected AbortError\n");
    expect(exitCode).toBe(0);
  },
);

test("aborting fetch with a ReadableStream request body does not double-cancel the sink", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fetch-abort-stream-body-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("done 50\n");
  expect(exitCode).toBe(0);
});
