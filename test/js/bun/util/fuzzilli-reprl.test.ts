import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The fuzzilli REPRL wrapper (src/js/eval/fuzzilli-reprl.ts) executes
// fuzzer-generated scripts in-process. APIs that intentionally kill the
// process outside of normal exception handling must be stubbed out before the
// loop starts, otherwise every fuzz case reaching them is reported as a
// crash. process.execve is one of those: on exec failure it prints an error
// and aborts (matching Node), and on success it replaces the process image.
test("REPRL loop survives a payload that calls process.execve", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl-execve.fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("process.execve failed");
  expect(stdout).toContain("STATUS_WRITES=2 LIVE=true");
  expect(exitCode).toBe(0);
});
