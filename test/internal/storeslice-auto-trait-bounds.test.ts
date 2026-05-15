// Soundness regression guard for `bun_ast::StoreRef<T>` / `StoreSlice<T>`
// unsafe Send/Sync impls (`src/ast/nodes.rs`).
//
// The bug: pre-fix the impls were unconditional in `T` —
//   unsafe impl<T> Send for StoreSlice<T> {}
//   unsafe impl<T> Sync for StoreSlice<T> {}
// which laundered `!Send`/`!Sync` payloads past auto-trait inference
// (`StoreSlice<Cell<u32>>: Sync` would hold even though `Cell<u32>: !Sync`).
//
// The fix in `src/ast/nodes.rs` bounds the impls on `T: Send` / `T: Sync`,
// matching the sibling `StoreRef<T>` pattern. This test exercises the
// property via the Rust unit-test module `store_auto_trait_tests` in the
// same file, using autoref-specialization probes so `.tag()` returns `"sync"`
// iff `T: Sync` actually holds.
//
// Gate mechanics: stashing `src/` reverts both the bound *and* the Rust
// test module, so `cargo test` finds no matching tests → `running 0 tests`
// → this JS test fails. Re-applying makes `cargo test` report
// `4 passed; 0 failed` → this JS test passes.
import { expect, test } from "bun:test";
import { bunEnv } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cargoBin = Bun.which("cargo");
const hasCargo = !!cargoBin;
// Skip if this checkout isn't the workspace (e.g. bundled test harness
// without Rust toolchain) — the property is pure compile-time, nothing to
// run if we can't invoke cargo.
const canRunCargo = hasCargo && existsSync(join(repoRoot, "Cargo.toml"));

test.skipIf(!canRunCargo)(
  "bun_ast StoreRef/StoreSlice Send+Sync are bounded on T (autoref-specialization probe)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "test", "-p", "bun_ast", "--lib", "store_auto_trait_tests"],
      env: bunEnv,
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Surface cargo output when anything goes wrong — makes failure messages
    // actionable (missing module vs failing assertion vs toolchain error).
    if (exitCode !== 0) {
      console.error("cargo stdout:\n" + stdout);
      console.error("cargo stderr:\n" + stderr);
    }
    expect(exitCode).toBe(0);

    // Must find the four probe tests — `cargo test` returns success with
    // "running 0 tests" when the filter matches nothing (which is the
    // stashed-source state), so we assert the named tests are present
    // AND passing, not just "exit 0".
    const expectedTests = [
      "storeslice_cell_is_not_sync",
      "storeref_cell_is_not_sync",
      "storeslice_of_raw_ptr_is_not_send_or_sync",
      "storeslice_of_u32_is_send_and_sync",
    ];
    for (const name of expectedTests) {
      expect(stdout).toContain(`${name} ... ok`);
    }
    expect(stdout).toContain("4 passed");
  },
);
