// bun_ast is one of the crates scripts/rust-miri.ts runs under Miri, and Miri
// never links, so it stays green while the crate's test binary references
// symbols only the full bun binary defines. A host `cargo test -p bun_ast` is
// what notices: the tape tests build JsonTapes on TapeAlloc::Global, but the
// Arena arm of the same Allocator impl keeps <&MimallocArena as Allocator>
// live, and mimalloc is not part of the test binary. src/ast/native_test_shims.rs
// defines the mi_* entry points that code reaches; without it lld fails with
//   ld.lld: error: undefined symbol: mi_heap_malloc
// Which entry points are live depends on the profile (bun_alloc's
// mi_free_checked frees through mi_free_size* under debug_assertions and
// mi_free otherwise), so both profiles are built. The tests are run rather
// than stopped at --no-run: the shims abort if anything reaches them.
//
// Unix only: the check relies on the linker reporting only references from
// live code (lld with --gc-sections). link.exe also resolves references from
// dead code, so there a test binary depending on bun_core either fails on
// ~100 unrelated externs or is linked with unresolved symbols forced through,
// and neither outcome says anything about these shims. Same remaining
// prerequisites as rust-windows-sys-link.test.ts: cargo on PATH and a
// configured checkout (cargo needs vendor/lolhtml to resolve the workspace,
// bun_core/build.rs needs build_options.rs); test-only CI lanes have neither
// and skip.
import { which } from "bun";
import { expect, test } from "bun:test";
import { isWindows } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cargo = which("cargo");
const repoRoot = join(import.meta.dir, "..", "..");
const workspaceResolvable =
  existsSync(join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(join(repoRoot, "build", "debug", "codegen", "build_options.rs"));

test.skipIf(isWindows || !cargo || !workspaceResolvable).each([
  ["dev", []],
  ["release", ["--release"]],
] as const)(
  "cargo test -p bun_ast links and passes without the rest of bun (%s profile)",
  async (_profile, profileArgs) => {
    await using proc = Bun.spawn({
      cmd: [cargo!, "test", "--locked", "-p", "bun_ast", "--lib", ...profileArgs],
      cwd: repoRoot,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("undefined symbol");
    // The test whose tape allocations keep the arena arm live must have run here, natively.
    expect(stdout).toContain("test e::json_tape_tests::tape_rooted_at_a_mutable_borrow_still_accepts_writes ... ok");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  },
  // Cold target dir: compiles bun_core and ~30 other crates first, and the
  // release row ends in a fat-LTO link.
  180_000,
);
