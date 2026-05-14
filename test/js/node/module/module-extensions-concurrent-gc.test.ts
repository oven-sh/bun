// JSCommonJSExtensions::m_registeredFunctions is a
// WTF::Vector<WriteBarrier<Unknown>> visited by visitChildrenImpl on parallel
// GC mark threads. All mutators (JSCommonJSExtensions__appendFunction /
// __setFunction / __swapRemove) and the visitor must hold cellLock() so a
// concurrent Vector reallocation cannot free the backing buffer while a mark
// thread is mid-scan, and WriteBarrier::set() must pass the extensions object
// (not the global object) as the owner cell so eden collections re-scan the
// correct cell.
//
// As with JSCommonJSModule::m_children (see module-children-concurrent-gc),
// the race is not reliably observable as a crash in the default build because
// the prebuilt debug WebKit uses bmalloc, so freed Vector buffers are neither
// ASAN-poisoned nor scribbled. This test is kept as a regression guard for
// the locking and the WriteBarrier owner — it churns Module._extensions under
// collectContinuously so the JSCommonJSExtensions cell is repeatedly visited
// on concurrent mark threads while the mutator registers/replaces/deletes
// handlers, and asserts the program still runs to completion with correct
// output.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// collectContinuously is very slow on Windows in CI and the code path is
// identical across platforms; skip there (same rationale as
// module-children-concurrent-gc.test.ts / issue 29519).
test.skipIf(isWindows)(
  "JSCommonJSExtensions m_registeredFunctions mutation under concurrent GC",
  async () => {
    const files: Record<string, string> = {
      "a.abc": `module.exports = "abc-default";\n`,
      "entry.cjs": `
        const Module = require("module");
        const path = require("path");
        const target = path.join(__dirname, "a.abc");

        // Drive put()/defineOwnProperty()/deleteProperty() on the
        // JSCommonJSExtensions object while the concurrent marker visits it.
        // Each iteration registers a fresh closure so the eden generation
        // always has new cells reachable only via the extensions object.
        let last;
        for (let i = 0; i < 400; i++) {
          const tag = "v" + i;
          // put: custom loader (new function each time)
          Module._extensions[".abc"] = function (mod, filename) {
            mod._compile("module.exports = " + JSON.stringify(tag) + ";", filename);
          };
          // put: overwrite existing custom loader with another new function
          Module._extensions[".abc"] = function (mod, filename) {
            mod._compile("module.exports = " + JSON.stringify(tag + "-b") + ";", filename);
          };
          // defineOwnProperty path
          Object.defineProperty(Module._extensions, ".xyz", {
            value: Module._extensions[".js"],
            configurable: true,
            writable: true,
            enumerable: true,
          });
          delete require.cache[target];
          last = require(target);
          // deleteProperty path
          delete Module._extensions[".xyz"];
        }
        delete Module._extensions[".abc"];

        if (last !== "v399-b") throw new Error("wrong: " + last);
        console.log("ok " + last);
      `,
    };

    using dir = tempDir("cjs-extensions-concurrent-gc", files);

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
    expect(stdout.trim()).toBe("ok v399-b");
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  60_000,
);
