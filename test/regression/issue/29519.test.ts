// https://github.com/oven-sh/bun/issues/29519
//
// Both --isolate and ShadowRealm construct a fresh Zig::GlobalObject on a
// warm VM. collectContinuously runs a dedicated collector thread so the
// marker overlaps finishCreation/init; sloppy-mode indirect eval below grows
// the global's JSSegmentedVariableObject::m_variables (the storage the
// crashing visitChildren walks) in each new global.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// collectContinuously is very slow under Windows + ASAN in CI; the code path
// is identical on Linux/macOS, so skip Windows to keep duration reasonable.
test.skipIf(isWindows)(
  "bun test --isolate survives concurrent GC while swapping globals",
  async () => {
    const files: Record<string, string> = {};
    // Six files is enough to recycle the Zig::GlobalObject IsoSubspace slot
    // a few times even without the collector thread getting lucky on timing.
    for (let i = 0; i < 6; i++) {
      // Indirect eval (`(0, eval)(…)`) runs in the global scope, so these go
      // through CreateGlobalVarBinding → JSSegmentedVariableObject::addVariables.
      // Top-level `var` in an ES module would instead live in
      // JSModuleEnvironment and never touch the segmented table.
      const names = ["a", "b", "c", "d", "e", "f", "g", "h"].map(n => `${n}${i}`);
      const decls = names.map((n, j) => `var ${n} = ${i + j};`).join(" ");
      const sum = names.map(n => `globalThis.${n}`).join(" + ");
      files[`gc-${i}.test.js`] = `
        import { test, expect } from "bun:test";
        (0, eval)(${JSON.stringify(decls)});
        test("gc pressure ${i}", () => {
          globalThis.__isolateLeak${i} = { data: new Array(4000).fill(${i}) };
          for (let j = 0; j < 4; j++) Bun.gc(true);
          expect(${sum}).toBe(${8 * i + 28});
        });
      `;
    }

    using dir = tempDir("isolate-gc-stress", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "."],
      env: {
        ...bunEnv,
        BUN_JSC_collectContinuously: "1",
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On crash the runner never reaches the summary line and exits non-zero;
    // checking the pass count first gives a readable diff on failure.
    expect(stderr).toContain("6 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  },
  // collectContinuously + ASAN is slow; each isolated file takes ~5-10s on
  // a debug build because the collector thread is constantly preempting the
  // mutator during JSGlobalObject::init().
  120_000,
);

// deriveShadowRealmGlobalObject() is the other path that constructs a
// Zig::GlobalObject on a warm VM; cover it under the same GC pressure so the
// DeferGC there doesn't silently regress.
test.skipIf(isWindows)(
  "ShadowRealm creation survives concurrent GC",
  async () => {
    const src = `
      (0, eval)("var sv0 = 0, sv1 = 1, sv2 = 2, sv3 = 3;");
      for (let i = 0; i < 40; i++) {
        const r = new ShadowRealm();
        r.evaluate("(0, eval)('var a=1,b=2,c=3,d=4'); globalThis.a+globalThis.b");
        if (i % 8 === 0) Bun.gc(true);
      }
      if (globalThis.sv0 + globalThis.sv3 !== 3) throw new Error("segmented vars lost");
      console.log("ok");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: {
        ...bunEnv,
        BUN_JSC_collectContinuously: "1",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Debug/ASAN builds print a "WARNING: ASAN interferes with JSC signal
    // handlers…" banner to stderr at startup; stdout === "ok" + exit 0 is
    // sufficient — a crash during ShadowRealm creation would hit neither.
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  },
  120_000,
);
