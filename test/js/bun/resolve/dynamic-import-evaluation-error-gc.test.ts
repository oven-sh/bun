import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// computeErrorInfoWrapperToString (src/jsc/bindings/FormatStackTraceForJS.cpp,
// installed via vm.setOnComputeErrorInfo) runs from
// ErrorInstance::reconcileWeakReferencesAtGCEnd during Heap::runEndPhase, for
// any live Error whose stack frames now reference dead code. It used to clear
// whatever exception was pending after computing the stack string. With
// concurrent GC that end phase can land while the mutator is parked at a
// safepoint inside CyclicModuleRecord::evaluate, between step 9 (the module's
// evaluation error is the pending exception) and step 9.d
// (rejectWithCaughtException), which then finds no exception and crashes
// (`ASSERTION FAILED: exception` at JSPromise.cpp on assert builds, a SEGV at
// address 0x8 on release: Sentry BUN-4R6E).
//
// This is the plain import() face of the bug. Each iteration writes a fresh
// ESM graph with one member that throws at top level and one that uses
// top-level await. import(a) fails on the throwing member; import(b) reaches
// that already-errored member, so its Evaluate() rethrows the stored error and
// runs the step 9 -> 9.d window again. The race needs the accumulated graphs
// and GC cycles of a long loop; a single iteration does not fire, 100 fire on
// about 1 run in 6, 300 on essentially every run of the unfixed assert build.
// The fixture runs twice and a single crash fails the test.
//
// Skipped on Windows: two runs of a 300-iteration loop that writes 2100 files
// and evaluates 1200 module graphs are several times slower under
// Windows + ASAN in CI, and the fixed C++ path is not platform-specific.
test.skipIf(isWindows)(
  "import() of a module whose evaluation throws survives a GC stack-trace finalizer",
  async () => {
    const fixture = `
    import { mkdirSync, writeFileSync } from "node:fs";
    import { join } from "node:path";

    const root = join(import.meta.dir, "graphs");
    for (let it = 0; it < 300; it++) {
      const d = join(root, "g" + it);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "bad.mjs"), "export const x = " + it + ";\\nthrow new Error('boom " + it + "');\\n");
      writeFileSync(join(d, "tla.mjs"), "await new Promise(r => setTimeout(r, 0));\\nexport const t = " + it + ";\\n");
      writeFileSync(join(d, "leaf.mjs"), "export const l = " + it + ";\\n");
      writeFileSync(join(d, "mid.mjs"), "import { l } from './leaf.mjs';\\nimport './bad.mjs';\\nexport const m = l + 1;\\n");
      writeFileSync(join(d, "a.mjs"), "import { m } from './mid.mjs';\\nimport { t } from './tla.mjs';\\nexport const a = m + t;\\n");
      writeFileSync(join(d, "b.mjs"), "import { t } from './tla.mjs';\\nimport './bad.mjs';\\nexport const b = t;\\n");
      writeFileSync(join(d, "c.mjs"), "import { m } from './mid.mjs';\\nexport const c = m;\\n");

      await import(join(d, "a.mjs")).catch(() => {});
      await import(join(d, "b.mjs")).catch(() => {});
      await import(join(d, "c.mjs")).catch(() => {});
      await import("data:text/javascript,throw new Error('d" + it + "')").catch(() => {});
    }
    console.log("ok");
  `;

    using dir = tempDir("dynamic-import-eval-error-gc", { "fixture.mjs": fixture });

    for (let i = 0; i < 2; i++) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.mjs"],
        cwd: String(dir),
        env: bunEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
      void stderr;
    }
  },
  // Two runs of a 300-iteration loop on a debug+ASAN build take well over the
  // default 5s.
  120_000,
);
