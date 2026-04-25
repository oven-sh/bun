import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Diagnostic for the Windows-only IPInt OutOfBoundsMemoryAccess in pglite (oven-sh/bun#29393).
// Captures JSC_logWasmMemory output so we can see what MemoryMode and mappedCapacity each
// dylink-loaded instance sees. Remove once the root cause is found.
test.runIf(isWindows)("pglite: log Wasm memory mode/capacity (diagnostic)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { PGlite } = require("@electric-sql/pglite");
        const db = new PGlite();
        try {
          const r = await db.query("SELECT 1");
          console.error("[pglite-diag] query OK:", JSON.stringify(r.rows));
        } catch (e) {
          console.error("[pglite-diag] query THREW:", e?.message ?? e);
        }
      `,
    ],
    env: {
      ...bunEnv,
      JSC_logWasmMemory: "1",
      JSC_dumpWasmWarnings: "1",
      JSC_useJIT: undefined,
    },
    cwd: import.meta.dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Always print the diagnostic output so it lands in the CI log even when the test "passes".
  console.error("=== JSC_logWasmMemory output (stderr) ===");
  console.error(stderr);
  console.error("=== stdout ===");
  console.error(stdout);

  // Don't fail the build on this — it's diagnostic.
  expect(stderr.length).toBeGreaterThan(0);
});
