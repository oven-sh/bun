// Regression test for https://github.com/oven-sh/bun/issues/27312
// SIGILL crash in JSC garbage collector during `bun test` cleanup.
//
// Root cause: Three GC safety issues fixed in PR #27190:
// 1. JSCommonJSModule::m_overriddenCompile WriteBarrier not visited in visitChildren
// 2. JSSQLStatement::userPrototype — wrong owner in WriteBarrier::set()
// 3. NodeVMSpecialSandbox — missing visitChildren entirely
//
// This test exercises path (1) by overriding module._compile and forcing
// heavy GC pressure to expose dangling WriteBarrier pointers.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("overriding module._compile with GC pressure does not crash", async () => {
  // This test spawns a subprocess that:
  // 1. Overrides Module.prototype._compile (setting m_overriddenCompile WriteBarrier)
  // 2. Requires several modules to populate the CJS module cache
  // 3. Forces multiple full GC cycles
  // 4. The process should exit cleanly without SIGILL/SIGFPE
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const Module = require("module");
      const originalCompile = Module.prototype._compile;

      // Override _compile to set m_overriddenCompile WriteBarrier on each module
      Module.prototype._compile = function(content, filename) {
        return originalCompile.call(this, content, filename);
      };

      // Require several modules to create CommonJS module objects with the override
      require("path");
      require("fs");
      require("os");
      require("util");
      require("events");
      require("stream");
      require("url");
      require("querystring");

      // Force GC multiple times to stress the parallel marker
      for (let i = 0; i < 10; i++) {
        Bun.gc(true);
      }

      // Clear the override to make the old function eligible for collection
      Module.prototype._compile = originalCompile;

      // Force more GC to collect the now-orphaned function references
      for (let i = 0; i < 10; i++) {
        Bun.gc(true);
      }

      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("spyOn with GC pressure during cleanup does not crash", async () => {
  // This test exercises the mock function + GC interaction path
  // that was reported in the issue (spyOn(Bun, "spawn").mockImplementation)
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spyOn } = require("bun:test");

      // Create multiple spies to increase GC pressure on mock objects
      const targets = [];
      for (let i = 0; i < 20; i++) {
        const obj = { method: () => i };
        const spy = spyOn(obj, "method").mockImplementation(() => i * 2);
        targets.push({ obj, spy });
      }

      // Call each spy to populate calls/contexts/returnValues arrays
      for (const { obj } of targets) {
        for (let j = 0; j < 5; j++) {
          obj.method();
        }
      }

      // Force GC while spies are active
      for (let i = 0; i < 10; i++) {
        Bun.gc(true);
      }

      // Restore all spies, making mock internals eligible for GC
      for (const { spy } of targets) {
        spy.mockRestore();
      }

      // Force GC after restoration to collect orphaned mock data
      for (let i = 0; i < 10; i++) {
        Bun.gc(true);
      }

      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("vm.createContext with GC pressure does not crash", async () => {
  // This exercises the NodeVMSpecialSandbox path (fix #3 in PR #27190)
  // NodeVMSpecialSandbox was missing visitChildren entirely
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const vm = require("vm");

      // Create multiple VM contexts to exercise NodeVMSpecialSandbox
      const contexts = [];
      for (let i = 0; i < 10; i++) {
        const sandbox = { value: i, console };
        const ctx = vm.createContext(sandbox);
        contexts.push(ctx);
      }

      // Run scripts in contexts to populate internal state
      for (const ctx of contexts) {
        vm.runInContext("value = value + 1", ctx);
      }

      // Force GC while contexts are alive
      for (let i = 0; i < 10; i++) {
        Bun.gc(true);
      }

      // Release references and force GC again
      contexts.length = 0;
      for (let i = 0; i < 10; i++) {
        Bun.gc(true);
      }

      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
