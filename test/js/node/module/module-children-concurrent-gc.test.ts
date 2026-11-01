// JSCommonJSModule::m_children is a WTF::Vector<WriteBarrier<Unknown>> that
// the mutator appends to on every require() (jsFunctionEvaluateCommonJSModule)
// while visitChildrenImpl iterates it on the concurrent GC marker thread.
// Both sides must hold cellLock() so Vector growth cannot free the backing
// buffer while the marker still holds a stale begin() pointer.
//
// require() of an already-cached module does not append again (the child is
// already in m_children), so the loop puts a fresh `new Module()` into
// require.cache before each require(). Every call then appends a distinct
// JSCommonJSModule, which drives a thousand appends (and ~a dozen
// reallocations) while collectContinuously keeps the concurrent marker
// repeatedly visiting the same module via require.cache.
//
// This race is not reliably observable as a crash in the default build
// because the prebuilt debug WebKit uses bmalloc (USE_SYSTEM_MALLOC=0), so
// the freed Vector buffer is neither ASAN-poisoned nor scribbled and the
// marker just re-reads still-valid JSCell pointers. The test is kept as a
// regression guard for the locking — it exercises every m_children mutation
// site (append, setter clear, getter clear) under concurrent GC and asserts
// the program still runs to completion with correct output.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// collectContinuously is very slow on Windows in CI and the code path is
// identical across platforms; skip there (same rationale as issue 29519).
test.skipIf(isWindows)(
  "JSCommonJSModule m_children mutation under concurrent GC",
  async () => {
    const files: Record<string, string> = {
      "c.cjs": `module.exports = 1;\n`,
      "p.cjs": `
        // ~12 reallocations of this module's m_children backing buffer.
        const Module = require("node:module");
        const cPath = require.resolve("./c.cjs");
        for (let i = 0; i < 1000; i++) {
          require.cache[cPath] = new Module(cPath);
          require("./c.cjs");
        }
        // setterChildren: locks, clears the native Vector, stores the JS value.
        module.children = module.children;
        module.exports = module.children.length;
      `,
      "entry.cjs": `
        require("./c.cjs");
        const pPath = require.resolve("./p.cjs");
        let n = 0;
        for (let iter = 0; iter < 4; iter++) {
          // Fresh JSCommonJSModule (and fresh empty m_children) each time.
          delete require.cache[pPath];
          n = require("./p.cjs");
        }
        // getterChildren: materializes the JSArray then locks and clears.
        if (module.children.length < 2) throw new Error("children missing");
        console.log("ok " + n);
      `,
    };

    using dir = tempDir("cjs-children-concurrent-gc", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.cjs"],
      env: {
        ...bunEnv,
        BUN_JSC_collectContinuously: "1",
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Assert output before exit code so a failure shows the actual crash
    // text. Debug/ASAN builds print a harmless "WARNING: ASAN interferes
    // with JSC signal handlers" banner on stderr, so only surface stderr
    // when the process failed.
    expect(stdout.trim()).toBe("ok 1000");
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  60_000,
);
