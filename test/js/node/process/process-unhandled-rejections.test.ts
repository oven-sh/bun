// The queue of promises that were rejected while they had no handler
// (RejectedPromiseQueue in ZigGlobalObject.cpp): what leaves it, in which order,
// and what leaving it costs. These tests are in their own file because one of
// them compares two timings, so nothing else should run next to it.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "path";

test("reports exactly the rejections that got no handler, in rejection order, whichever ones got a handler first", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "process-unhandled-rejections-model-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
});

test("a handler attached to one of many rejected promises does not take time proportional to their number", async () => {
  // A handler attached before the microtask queue is empty takes the promise
  // out of the queue again. That was a linear search and then a memmove of
  // every later entry: quadratic for n promises rejected in the same turn, in
  // whichever order they get their handlers.
  const n = isDebug || isASAN ? 10_000 : 100_000;
  // How many times longer than with promises that are not in the queue. Measured: 1 to 4.
  // With the search and the memmove, if the loop is left to finish: 100 or more in a debug
  // build at this n, and 300 (newest first) to 7,000 (oldest first) in a release build.
  const limit = 20;
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "process-unhandled-rejections-timing-fixture.js"), String(n), String(limit)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const withinLimit = { baselineMs: expect.any(Number), trackedMs: expect.any(Number), handled: n, withinLimit: true };
  expect(JSON.parse(stdout)).toEqual({ forward: withinLimit, reverse: withinLimit, scattered: withinLimit });
  expect(exitCode).toBe(0);
});
