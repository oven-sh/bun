import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe } from "harness";
import { join } from "node:path";

// The assertions live in spawnsync-error-shape.node.mts and encode Node's
// spawnSync result shape. Running the same file under both Node and Bun proves
// the fix for https://github.com/oven-sh/bun/issues/31767 matches Node exactly.
const fixture = join(import.meta.dir, "spawnsync-error-shape.node.mts");

async function run(cmd: string[]) {
  await using proc = Bun.spawn({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("spawnSync error/result shape parity", () => {
  test.if(!!nodeExe())("tests pass on node.js", async () => {
    const { stdout, stderr, exitCode } = await run([nodeExe()!, "--test", fixture]);
    const output = stdout + stderr;
    // node --test reports failures both in the summary and via a non-zero exit.
    expect(output).toContain("pass 2");
    expect(output).toContain("fail 0");
    expect(exitCode).toBe(0);
  });

  test("tests pass on bun", async () => {
    const { stdout, stderr } = await run([bunExe(), "test", fixture]);
    const output = stdout + stderr;
    // `bun test` on a node:test file does not propagate failures to the exit
    // code, so assert on the reported pass/fail counts instead.
    expect(output).toContain(" 2 pass");
    expect(output).toContain(" 0 fail");
  });
});
