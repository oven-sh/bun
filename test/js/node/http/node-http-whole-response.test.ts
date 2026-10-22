import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

test("a response is the same bytes whether its head and body are written at once or in pieces", async () => {
  await using server = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "node-http-whole-response-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([server.stdout.text(), server.stderr.text(), server.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatchSnapshot();
  expect(exitCode).toBe(0);
});
