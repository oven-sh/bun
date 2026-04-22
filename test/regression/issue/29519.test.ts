// https://github.com/oven-sh/bun/issues/29519
//
// `bun test --isolate` creates a fresh Zig::GlobalObject on the same JSC::VM
// for every file and gcUnprotect()s the previous one. Prior to this it was
// never possible for a Zig::GlobalObject to be collected, so the concurrent
// marker never had a chance to walk one while another was mid-finishCreation.
// On macOS arm64 this surfaced as a near-null dereference inside
// JSSegmentedVariableObject::visitChildrenImpl (SlotVisitor walking the
// half-built new global) and as "marks not empty!" MarkedBlock assertions.
//
// This test stresses the swap by running several isolated test files back to
// back under BUN_JSC_collectContinuously=1 (a dedicated thread that calls
// Heap::collectSync in a loop). Each file grows the global's segmented
// variable storage via sloppy-mode indirect eval and forces full GCs. The fix
// defers GC across the global swap and null-guards the unique_ptr visitor
// overload; without it this spawn segfaults intermittently.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// collectContinuously is very slow under Windows + ASAN in CI; the failure
// mode this covers was observed on macOS arm64 and the code path is identical
// on Linux/macOS, so skip Windows to keep the suite duration reasonable.
test.skipIf(isWindows)(
  "bun test --isolate survives concurrent GC while swapping globals",
  async () => {
    const files: Record<string, string> = {};
    // Six files is enough to recycle the Zig::GlobalObject IsoSubspace slot
    // a few times even without the collector thread getting lucky on timing.
    for (let i = 0; i < 6; i++) {
      // Build a sloppy-mode global eval that declares eight vars per file.
      // Indirect eval (`(0, eval)(…)`) runs in the global scope, so these go
      // through CreateGlobalVarBinding → JSSegmentedVariableObject::addVariables
      // and actually land in the global's m_variables SegmentedVector — the
      // storage JSSegmentedVariableObject::visitChildrenImpl iterates under
      // cellLock(). Top-level `var` in an ES module would instead live in
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
        // Dedicated collector thread running Heap::collectSync in a loop — this
        // is what makes the "marker visits global mid-finishCreation" window
        // observable without needing the macOS concurrent-GC scheduler timing.
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
