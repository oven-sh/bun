import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, noCoreCmd } from "harness";
import { accessSync, constants, readFileSync } from "node:fs";

test.skipIf(!isLinux)("noCoreCmd executes its child with unchanged arguments even if procfs is read-only", () => {
  let expectedFilter = 0;
  try {
    accessSync("/proc/self/coredump_filter", constants.W_OK);
  } catch {
    expectedFilter = parseInt(readFileSync("/proc/self/coredump_filter", "utf8"), 16);
  }
  const args = ["two words", `quote'"`, "$HOME;$(false)", ""];
  const result = Bun.spawnSync({
    cmd: noCoreCmd([
      bunExe(),
      "-e",
      `console.log(JSON.stringify({
        args: process.argv.slice(-4),
        filter: parseInt(require("node:fs").readFileSync("/proc/self/coredump_filter", "utf8"), 16),
      }))`,
      "--",
      ...args,
    ]),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
  expect(result.stderr.toString()).toBe("");
  expect(JSON.parse(result.stdout.toString())).toEqual({ args, filter: expectedFilter });
});
