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
  const lines = stdout.trim().split("\n");
  const resultLine = lines.find(line => line.startsWith("REPRL_FIXTURE_RESULT="));
  const result = resultLine ? JSON.parse(resultLine.slice("REPRL_FIXTURE_RESULT=".length)) : undefined;
  return { stdout, lines, stderr, exitCode, result };
}

const FAILED = 1 << 8;

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
// must not take down the REPRL child, whatever the thrown value is. It is
// reported as a failed execution (exit code 1 in the upper status byte) for
// the payload that caused it, and the loop keeps going. That includes the
// case where an earlier payload removed the loop's process listeners.
test.concurrent("REPRL loop reports async failures as a failed execution and keeps running", async () => {
  const { lines, stderr, exitCode, result } = await runReprl([
    `Promise.reject(new Error("unhandled"));`,
    `queueMicrotask(() => { throw new Error("thrown"); });`,
    `queueMicrotask(() => { throw Symbol("not implicitly convertible"); });`,
    `Promise.reject({ toString() { throw new Error("toString throws"); } });`,
    `throw Symbol("sync");`,
    `process.removeAllListeners("uncaughtException"); process.removeAllListeners("unhandledRejection");`,
    `Promise.reject(new Error("still handled"));`,
    `globalThis.probe = "alive";`,
  ]);
  expect(stderr).toBe("");
  const expected = {
    statuses: [FAILED, FAILED, FAILED, FAILED, FAILED, 0, FAILED, 0],
    probes: [null, null, null, null, null, null, null, "alive"],
  };
  expect(lines).toEqual([
    "uncaught:Error: unhandled",
    "uncaught:Error: thrown",
    "uncaught:Symbol(not implicitly convertible)",
    "uncaught:<unprintable>",
    "uncaught:Symbol(sync)",
    "uncaught:Error: still handled",
    `REPRL_FIXTURE_RESULT=${JSON.stringify(expected)}`,
  ]);
  expect(result).toEqual(expected);
  expect(exitCode).toBe(0);
});

// Timers, intervals and immediates that a payload leaves behind must not fire
// while later payloads run. A timer that is already due fires within its own
// payload's turn; everything still pending when the status is written is
// cleared.
test.concurrent("REPRL loop clears timers a payload leaves behind", async () => {
  const { lines, stderr, exitCode, result } = await runReprl([
    `globalThis.probe = { interval: 0, immediates: 0, late: false };
     setInterval(() => { globalThis.probe.interval++; throw new Error("interval"); }, 0);
     setTimeout(() => { globalThis.probe.late = true; }, 20);
     setImmediate(function again() { globalThis.probe.immediates++; setImmediate(again); });
     const start = performance.now();
     while (performance.now() - start < 5) {}`,
    `const start = performance.now();
     while (performance.now() - start < 40) {}`,
    `globalThis.probe = "done";`,
  ]);
  expect(stderr).toBe("");
  const expected = {
    statuses: [FAILED, 0, 0],
    probes: [{ interval: 1, immediates: 1, late: false }, { interval: 1, immediates: 1, late: false }, "done"],
  };
  expect(lines).toEqual(["uncaught:Error: interval", `REPRL_FIXTURE_RESULT=${JSON.stringify(expected)}`]);
  expect(result).toEqual(expected);
  expect(exitCode).toBe(0);
});
