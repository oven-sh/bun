import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The fuzzilli REPRL wrapper (src/js/eval/fuzzilli-reprl.ts) executes
// fuzzer-generated scripts in-process. APIs that intentionally kill the
// process outside of normal exception handling must be stubbed out before the
// loop starts, otherwise every fuzz case reaching them is reported as a
// crash. The fixture drives the real wrapper source with mocked REPRL fds,
// feeds it each payload plus a final `globalThis.stillAlive = true`, and
// prints the exit code the wrapper reported for every payload.
async function run(...payloads: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl.fixture.ts"), ...payloads],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout: stdout.trim(), exitCode };
}

// process.execve replaces the process image on success, which would silently
// end the REPRL loop.
test.concurrent("REPRL loop survives a payload that calls process.execve", async () => {
  expect(await run(`process.execve("fuzzilli-reprl-execve-does-not-exist", []);`)).toEqual({
    stdout: "STATUSES=0,0 LIVE=true",
    exitCode: 0,
  });
});

// process.exit ends the child. process.kill can signal the child itself, the
// fuzzer (its parent) and the other REPRL children (pid 0 is the whole
// process group). Only the child's own pid is used here, so that a regression
// cannot signal the test runner.
test.concurrent("REPRL loop survives payloads that call process.exit and process.kill", async () => {
  expect(
    await run(
      `process.exit(3); process.reallyExit(4);`,
      `process.kill(process.pid, "SIGKILL"); process.kill(process.pid); process._kill(process.pid, 9);`,
    ),
  ).toEqual({
    stdout: "STATUSES=0,0,0 LIVE=true",
    exitCode: 0,
  });
});
