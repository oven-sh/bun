import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Diagnostic for the Windows-x64-only IPInt OutOfBoundsMemoryAccess in pglite (oven-sh/bun#29393).
// Captures JSC_logWasmMemory output so we can see what MemoryMode and mappedCapacity each
// dylink-loaded instance sees. Remove once the root cause is found.
test.if(isWindows && process.arch === "x64")(
  "pglite: log Wasm memory mode/capacity (diagnostic, Windows x64)",
  async () => {
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
  },
);

// Discriminator: same repro on x64 with fast memory forced OFF (BoundsChecking + realloc-on-grow,
// matching the Windows path). If this fails on Linux/macOS x64 too, the bug is x86_64 IPInt asm.
// If only Windows fails, it's clang-cl/VEH/VirtualAlloc-specific.
test.if(process.arch === "x64")("pglite: BoundsChecking+IPInt-only repro (diagnostic, any x64)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { PGlite } = require("@electric-sql/pglite");
        const db = new PGlite();
        try {
          await db.query("SELECT 1");
          console.error("[pglite-diag] x64 BoundsChecking+IPInt: OK");
        } catch (e) {
          console.error("[pglite-diag] x64 BoundsChecking+IPInt: THREW:", e?.message ?? e);
        }
      `,
    ],
    env: {
      ...bunEnv,
      BUN_JSC_useWasmFastMemory: "0",
      BUN_JSC_useJIT: "0",
      JSC_useJIT: undefined,
    },
    cwd: import.meta.dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.error(stderr);
  console.error(stdout);
  expect(stderr).toContain("[pglite-diag]");
});

// Second discriminator: all tiers active (IPInt+BBQ+OMG) with fast memory off.
// Windows fails ONLY with all 3 tiers active. If Linux/macOS x64 also fails here,
// the bug is the BoundsChecking + tier-up interaction (fixable from posix).
test.if(process.arch === "x64")("pglite: BoundsChecking + all-3-tiers (diagnostic, any x64)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { PGlite } = require("@electric-sql/pglite");
        const db = new PGlite();
        try {
          await db.query("SELECT 1");
          console.error("[pglite-diag] x64 BoundsChecking+all-tiers: OK");
        } catch (e) {
          console.error("[pglite-diag] x64 BoundsChecking+all-tiers: THREW:", e?.message ?? e);
        }
      `,
    ],
    env: {
      ...bunEnv,
      BUN_JSC_useWasmFastMemory: "0",
      JSC_useJIT: undefined,
    },
    cwd: import.meta.dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.error(stderr);
  console.error(stdout);
  expect(stderr).toContain("[pglite-diag]");
});
