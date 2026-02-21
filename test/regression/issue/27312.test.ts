// Regression test for https://github.com/oven-sh/bun/issues/27312
// SIGILL crash in JSC garbage collector during `bun test` cleanup.
//
// Root cause: Three GC safety issues fixed in PR #27190:
// 1. JSCommonJSModule::m_overriddenCompile WriteBarrier not visited in visitChildren
// 2. JSSQLStatement::userPrototype — wrong owner in WriteBarrier::set()
// 3. NodeVMSpecialSandbox — missing visitChildren entirely

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("module._compile override on CJS module instances survives GC", async () => {
  // Fix #1: JSCommonJSModule::m_overriddenCompile WriteBarrier was not visited
  // in visitChildren. The _compile custom setter on JSCommonJSModule stores the
  // function in m_overriddenCompile. Without visiting it in visitChildren, the
  // GC's parallel marker would miss it and the function could be collected.
  //
  // To trigger: override Module._extensions['.js'] to set module._compile on
  // each module instance (the pattern used by ts-node, pirates, @swc-node/register).
  // This calls setterUnderscoreCompile which populates the WriteBarrier.
  using dir = tempDir("27312-compile", {
    "entry.js": `
      const Module = require("module");
      const origExt = Module._extensions['.js'];

      // Override the .js extension handler to set _compile on each module instance.
      // module._compile = fn triggers the setterUnderscoreCompile custom setter,
      // which stores fn in m_overriddenCompile WriteBarrier on the JSCommonJSModule.
      Module._extensions['.js'] = function(module, filename) {
        const origCompile = module._compile;
        // This anonymous function's only strong reference is through
        // the m_overriddenCompile WriteBarrier on this module object.
        module._compile = function(content, fname) {
          return origCompile.call(this, content, fname);
        };
        return origExt(module, filename);
      };

      // Require real CJS files to create JSCommonJSModule objects with overridden _compile
      require('./a.js');
      require('./b.js');
      require('./c.js');

      // Restore original extension handler — now the only references to those
      // per-module _compile functions are through m_overriddenCompile WriteBarriers.
      Module._extensions['.js'] = origExt;

      // Allocation pressure to trigger GC naturally
      for (let i = 0; i < 10000; i++) {
        new Array(100).fill({ key: 'x'.repeat(100) });
      }

      // Force GC — without the fix, visitChildren didn't visit m_overriddenCompile,
      // so the per-module _compile functions could be collected.
      Bun.gc(true);
      Bun.gc(true);

      // Read _compile from each cached module — goes through getterUnderscoreCompile
      // which returns m_overriddenCompile.get(). Would follow a dangling pointer
      // if the function was collected.
      for (const key of Object.keys(require.cache)) {
        const mod = require.cache[key];
        if (mod && mod._compile) {
          if (typeof mod._compile !== "function") {
            throw new Error("_compile should be a function");
          }
        }
      }

      console.log("OK");
    `,
    "a.js": `module.exports = { a: 1 };`,
    "b.js": `module.exports = { b: 2 };`,
    "c.js": `module.exports = { c: 3 };`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("OK");
});

test("SQLite statement .as() prototype survives GC", async () => {
  // Fix #2: JSSQLStatement::userPrototype WriteBarrier::set() used the wrong owner
  // (classObject instead of castedThis). The owner must be the object containing
  // the WriteBarrier so the GC's remembered set is updated correctly.
  //
  // To trigger: call stmt.as(SomeClass), which calls jsSQLStatementSetPrototypeFunction
  // and stores the class prototype in the userPrototype WriteBarrier.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Database } = require("bun:sqlite");
      const db = new Database(":memory:");
      db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
      db.run("INSERT INTO test VALUES (1, 'hello'), (2, 'world')");

      // .as() calls jsSQLStatementSetPrototypeFunction which sets userPrototype
      // WriteBarrier with the class's prototype object.
      class Row {
        get upper() { return this.name.toUpperCase(); }
      }

      const stmt = db.prepare("SELECT * FROM test").as(Row);

      // Allocation pressure
      for (let i = 0; i < 10000; i++) {
        new Array(100).fill({ x: 'y'.repeat(50) });
      }

      // Force GC — without the fix, the wrong owner in WriteBarrier::set()
      // meant the remembered set wasn't updated for the statement object,
      // so the prototype could be collected in a generational GC.
      Bun.gc(true);
      Bun.gc(true);

      // Query using the statement — accesses userPrototype to set the
      // prototype on result objects. Would crash if prototype was collected.
      const rows = stmt.all();
      if (rows[0].upper !== "HELLO") throw new Error("Expected HELLO got " + rows[0].upper);
      if (rows[1].upper !== "WORLD") throw new Error("Expected WORLD got " + rows[1].upper);

      db.close();
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("OK");
});

test("vm context with DONT_CONTEXTIFY survives GC", async () => {
  // Fix #3: NodeVMSpecialSandbox had no visitChildren implementation.
  // NodeVMSpecialSandbox is only created when vm.constants.DONT_CONTEXTIFY
  // is used as the context argument. Its m_parentGlobal WriteBarrier was
  // never visited, so the parent NodeVMGlobalObject could be collected.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const vm = require("vm");

      // vm.constants.DONT_CONTEXTIFY is the only way to create a NodeVMSpecialSandbox.
      // Passing it as the context to runInNewContext triggers the notContextified path
      // in the C++ code, which creates a NodeVMSpecialSandbox with m_parentGlobal.
      if (!vm.constants || !vm.constants.DONT_CONTEXTIFY) {
        console.log("OK"); // Skip if DONT_CONTEXTIFY not available
        process.exit(0);
      }

      const results = [];
      for (let i = 0; i < 20; i++) {
        const result = vm.runInNewContext(
          "globalThis.x = " + i + "; x * 2",
          vm.constants.DONT_CONTEXTIFY
        );
        results.push(result);
      }

      // Allocation pressure
      for (let i = 0; i < 10000; i++) {
        new Array(100).fill({ x: 'y'.repeat(50) });
      }

      // Force GC — without the fix, NodeVMSpecialSandbox::visitChildren didn't
      // exist, so m_parentGlobal was invisible to the GC marker. The parent
      // NodeVMGlobalObject could be collected while still referenced.
      Bun.gc(true);
      Bun.gc(true);

      if (results[0] !== 0 || results[9] !== 18) {
        throw new Error("Unexpected: " + JSON.stringify(results));
      }

      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("OK");
});
