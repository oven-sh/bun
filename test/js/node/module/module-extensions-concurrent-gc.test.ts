// Concurrent-GC smoke test for Module._extensions / require.extensions.
//
// Assigning, defining, and deleting handlers on Module._extensions routes
// through JSCommonJSExtensions::put / defineOwnProperty / deleteProperty,
// which store the handler via jsc.Strong in Zig (NodeModuleModule.zig
// onRequireExtensionModify) and mutate own-property storage on the
// JSCommonJSExtensions cell. This test churns those paths under
// BUN_JSC_collectContinuously=1 so the cell is repeatedly visited on
// concurrent mark threads (exercising JSCommonJSExtensions::visitChildrenImpl,
// which takes cellLock() before scanning m_registeredFunctions) while the
// mutator registers/replaces/deletes handlers with fresh closures each
// iteration, and asserts the program runs to completion with correct output.
//
// Note: m_registeredFunctions itself is currently always empty — the three
// JSCommonJSExtensions__{append,set,swapRemove}Function helpers have had no
// Zig callers since #19231 switched CustomLoader.custom to jsc.Strong — so
// this test cannot observe a regression in the cellLock() or WriteBarrier
// owner fixes for those helpers. It is kept as a concurrent-GC regression
// guard for the Module._extensions code paths that are live today, and for
// visitChildrenImpl's locking should m_registeredFunctions ever be
// repopulated.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// collectContinuously is very slow on Windows in CI and the code path is
// identical across platforms; skip there (same rationale as
// module-children-concurrent-gc.test.ts / issue 29519).
test.skipIf(isWindows)(
  "JSCommonJSExtensions put/defineOwnProperty/deleteProperty under concurrent GC",
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
