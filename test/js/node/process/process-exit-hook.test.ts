import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

async function run(...args: string[]) {
  await using child = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "process-exit-hook-fixture.js"), ...args],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { lines: stdout.trim().split("\n"), names: /made up/.test(stderr), exitCode };
}

// What the function that runs when the process exits throws is reported, behind the listeners of 'exit': a handler that exits does not keep them from running.
test.each(["asked", "at the end"])("a handler of uncaughtException that exits, the exit %s", async how => {
  expect(await run("handled", how)).toEqual({
    lines: ["the hook runs", "a listener of exit: 0", "reported: made up"],
    names: false,
    exitCode: 3,
  });
});

test.each(["asked", "at the end"])("no handler, the exit %s", async how => {
  const { lines, names } = await run("unhandled", how);
  expect({ lines, names }).toEqual({ lines: ["the hook runs", "a listener of exit: 0"], names: true });
});

test.each([0, 5])("no handler, reallyExit(%d)", async code => {
  expect(await run("unhandled", "really", String(code))).toEqual({
    lines: ["the hook runs"],
    names: true,
    exitCode: 1,
  });
});

test.each([0, 5])("a handler of uncaughtException that returns, reallyExit(%d)", async code => {
  expect(await run("noted", "really", String(code))).toEqual({
    lines: ["the hook runs", "reported: made up"],
    names: false,
    exitCode: code,
  });
});

test("a handler of uncaughtException that exits, reallyExit(0)", async () => {
  expect(await run("handled", "really", "0")).toEqual({
    lines: ["the hook runs", "reported: made up"],
    names: false,
    exitCode: 3,
  });
});
