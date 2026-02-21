import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/18890
// Adding functions to Set/Map/WeakSet/WeakMap prototypes before import('fs')
// should not cause those functions to be invoked by Bun's internal primordials.

test("import('fs') does not invoke user-defined Set.prototype methods", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "Set.prototype.hi = function () { throw 'hi' }; await import('fs')"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error: hi");
  expect(exitCode).toBe(0);
});

test("import('fs') does not invoke user-defined Map.prototype methods", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "Map.prototype.hi = function () { throw 'hi' }; await import('fs')"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error: hi");
  expect(exitCode).toBe(0);
});

test("static import with prototype pollution does not throw", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "Set.prototype.hi = function () { throw 'hi' }; require('fs'); import fs from 'fs'"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error: hi");
  expect(exitCode).toBe(0);
});

test("fs module works correctly after prototype pollution", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "Set.prototype.hi = function () { throw 'hi' }; const fs = await import('fs'); console.log(typeof fs.readFileSync)",
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("function");
  expect(exitCode).toBe(0);
});
