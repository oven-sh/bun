import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The fuzzilli REPRL wrapper (src/js/eval/fuzzilli-reprl.ts) executes
// fuzzer-generated scripts in-process. APIs that intentionally kill the
// process outside of normal exception handling must be stubbed out before the
// loop starts, otherwise every fuzz case reaching them is reported as a
// crash: process.execve replaces the process image, and process.kill sends a
// real signal to any pid. Status 0 means that the payload returned.
test.concurrent.each([
  ["process.execve returns", `process.execve("fuzzilli-reprl-execve-does-not-exist", []);`],
  ["process.kill returns", `process.kill(process.pid, "SIGKILL");`],
  [
    "process.kill still validates its arguments",
    `let code; try { process.kill("not a pid", "SIGKILL"); } catch (e) { code = e.code; } ` +
      `if (code !== "ERR_INVALID_ARG_TYPE") throw new Error("process.kill did not reject the pid: " + code);`,
  ],
])("REPRL wrapper: %s", async (_name, payload) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl.fixture.ts"), payload],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("STATUSES=0,0 LIVE=true\n");
  expect(exitCode).toBe(0);
});
