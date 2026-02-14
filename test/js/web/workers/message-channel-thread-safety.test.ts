/**
 * Tests for MessageChannel thread safety between workers.
 *
 * @see https://github.com/oven-sh/bun/pull/25806
 * @see https://github.com/oven-sh/bun/issues/25805
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

test("MessageChannel between workers does not crash with rapid messages", async () => {
  const fixturePath = path.join(import.meta.dir, "message-channel-thread-safety-fixture.js");

  const proc = Bun.spawn({
    cmd: [bunExe(), fixturePath],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }

  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("Bun has crashed");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS");
}, 60000);
