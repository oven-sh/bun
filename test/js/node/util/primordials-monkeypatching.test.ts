import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// internal/primordials builds SafeSet/SafeMap by wrapping the iterator-returning methods of
// Set/Map. It must not invoke user-defined prototype methods while doing so. Node: `ok` / 0.
const modules = ["node:fs", "node:util", "node:assert", "node:worker_threads", "node:http2"];

test.concurrent.each(modules)("%s does not invoke monkey-patched Set.prototype methods", async module => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `Set.prototype.hi = function () { throw new Error("BOOM") };
       try { require(${JSON.stringify(module)}); console.log("ok") } catch (e) { console.log("CAUGHT:", e.message) }`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("ok\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent.each(["Set", "Map"])("monkey-patched %s.prototype method is never called", async name => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let calls = 0;
       ${name}.prototype.hi = function () { calls++ };
       require("node:fs");
       console.log("calls=" + calls)`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("calls=0\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// Guards against "fixing" the bug by simply not wrapping anything: entries/keys/values/
// Symbol.iterator must still be replaced with the null-prototype SafeIterator, which is what
// keeps util.inspect working after Array.prototype[Symbol.iterator] is tampered with.
test.concurrent("Safe collections keep their iterator wrappers", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const util = require("node:util");
       const value = { nested: new Set(["x"]), map: new Map([["a", 1]]) };
       Array.prototype[Symbol.iterator] = function () { throw new Error("TAMPERED") };
       console.log(util.inspect(value));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("{ nested: Set(1) { 'x' }, map: Map(1) { 'a' => 1 } }\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
