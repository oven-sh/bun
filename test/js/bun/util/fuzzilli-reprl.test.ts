import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The fuzzilli REPRL wrapper (src/js/eval/fuzzilli-reprl.ts) executes
// fuzzer-generated scripts in-process. APIs that intentionally kill the
// process outside of normal exception handling must be stubbed out before the
// loop starts, otherwise every fuzz case reaching them is reported as a crash.
//
// - process.execve replaces the process image on success, which would silently
//   end the REPRL loop.
// - process.kill delivers a real signal. With this pid it kills the REPRL
//   child, and with pid 0 or -1 it kills the fuzzer and every other REPRL
//   child in the process group.
test.each([
  ["process.execve", `process.execve("fuzzilli-reprl-execve-does-not-exist", []);`],
  ["process.kill", `process.kill(process.pid, "SIGKILL");`],
])("REPRL loop survives a payload that calls %s", async (_name, payload) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl.fixture.ts"), payload],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("STATUS_WRITES=2 LIVE=true");
  expect(exitCode).toBe(0);
});
