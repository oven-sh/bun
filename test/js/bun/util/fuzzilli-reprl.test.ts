import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// These tests drive the real fuzzilli REPRL wrapper (src/js/eval/fuzzilli-reprl.ts)
// through fuzzilli-reprl.fixture.ts, which mocks the REPRL control/data FDs
// in-process so the loop can run in a normal (non-fuzzilli) build.
async function runReprl(payloads: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl.fixture.ts"), JSON.stringify(payloads)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const resultLine = stdout.split("\n").find(line => line.startsWith("REPRL_FIXTURE_RESULT="));
  const result = resultLine ? JSON.parse(resultLine.slice("REPRL_FIXTURE_RESULT=".length)) : undefined;
  return { stdout, stderr, exitCode, result };
}

// APIs that intentionally kill the process outside of normal exception
// handling must be stubbed out before the loop starts, otherwise every fuzz
// case reaching them is reported as a crash. process.execve is one of those:
// on success it replaces the process image, which would silently end the
// REPRL loop.
test.concurrent("REPRL loop survives a payload that calls process.execve", async () => {
  const { stderr, exitCode, result } = await runReprl([
    `process.execve("fuzzilli-reprl-execve-does-not-exist", []);`,
    `globalThis.probe = "alive";`,
  ]);
  expect(stderr).toBe("");
  expect(result).toEqual({ statuses: [0, 0], probes: [null, "alive"] });
  expect(exitCode).toBe(0);
});

// The loop must give the event loop a turn after each script. Otherwise
// promise reactions queued by fuzzed code never run, and everything they
// capture stays alive in the microtask queue for the lifetime of the REPRL
// child, which grows without bound across executions.
test.concurrent("REPRL loop drains microtasks queued by a payload before reporting its status", async () => {
  const { stderr, exitCode, result } = await runReprl([
    `globalThis.probe = 0;
     Promise.resolve().then(() => { globalThis.probe++; });
     queueMicrotask(() => { globalThis.probe++; });
     (async () => { await 0; globalThis.probe++; })();`,
    `globalThis.probe = "next";`,
  ]);
  expect(stderr).toBe("");
  expect(result).toEqual({ statuses: [0, 0], probes: [3, "next"] });
  expect(exitCode).toBe(0);
});

// Now that async code runs, an unhandled rejection or a throw from a microtask
// must not take down the REPRL child. It is reported as a failed execution
// (exit code 1 in the upper status byte) for the payload that caused it, and
// the loop keeps going.
test.concurrent("REPRL loop reports async failures as a failed execution and keeps running", async () => {
  const { stdout, stderr, exitCode, result } = await runReprl([
    `Promise.reject(new Error("unhandled"));`,
    `queueMicrotask(() => { throw new Error("thrown"); });`,
    `globalThis.probe = "alive";`,
  ]);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual([
    "uncaught:Error: unhandled",
    "uncaught:Error: thrown",
    `REPRL_FIXTURE_RESULT=${JSON.stringify({ statuses: [256, 256, 0], probes: [null, null, "alive"] })}`,
  ]);
  expect(result).toEqual({ statuses: [256, 256, 0], probes: [null, null, "alive"] });
  expect(exitCode).toBe(0);
});
