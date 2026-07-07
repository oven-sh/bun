// JSModuleLoader's module registry (m_moduleMap / m_loadedModules /
// m_resolutionFailures) is iterated by JSModuleLoader::visitChildrenImpl on
// the concurrent GC marker thread under cellLock(). Bun mutates those maps on
// the mutator thread via removeEntry() (require.cache deletes, mock.module,
// plugin virtual modules) and clearAll() (hot reload, VM teardown, process
// exit), so those mutation sites must hold the same cellLock() or a removal
// can invalidate/ free the table the marker is still walking. Fuzzing caught
// this as a UBSAN null deref in WTF::HashTable's iterator bookkeeping
// (removeIterator racing invalidateIterators).
//
// The race is timing dependent and not reliably observable as a crash, so
// this test is a regression guard for the locking: it drives the ESM registry
// add/remove paths in a tight loop (require(esm) + delete require.cache) and
// exits while collectContinuously keeps the concurrent marker visiting the
// module loader, then asserts the program ran to completion.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// collectContinuously is very slow on Windows in CI and the code path is
// identical across platforms; skip there (same rationale as
// module-children-concurrent-gc.test.ts).
test.skipIf(isWindows)(
  "ESM registry removeEntry/clearAll under concurrent GC",
  async () => {
    const files: Record<string, string> = {
      "dep.mjs": `export const value = 1;\n`,
      "entry.cjs": `
        // Pad the registry so the marker spends longer iterating it.
        const pads = [];
        for (let i = 0; i < 8; i++) pads.push(import("data:text/javascript,export default " + i));
        Promise.all(pads).then(() => {
          const depPath = require.resolve("./dep.mjs");
          let v = 0;
          for (let i = 0; i < 300; i++) {
            // require(esm): loadModuleSync re-adds the registry entry and
            // write-barriers the module loader so the marker re-visits it.
            v = require("./dep.mjs").value;
            // require.cache delete: JSModuleLoader::removeEntry on the mutator.
            delete require.cache[depPath];
          }
          console.log("ok " + v);
          // Process exit then runs the clearAll() teardown path while the
          // continuous collector is still marking.
        });
      `,
    };

    using dir = tempDir("esm-registry-concurrent-gc", files);

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
    expect(stdout.trim()).toBe("ok 1");
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  90_000,
);
