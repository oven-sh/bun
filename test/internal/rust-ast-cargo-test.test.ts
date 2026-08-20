// The Miri lane (scripts/rust-miri.ts) runs bun_ast's tests without linking,
// so only a host `cargo test -p bun_ast` notices when the test binary
// references symbols that exist only in the full bun link. The tape tests keep
// the TapeAlloc::Arena arm live, and src/ast/native_test_shims.rs defines the
// mimalloc symbols it reaches; without it:
//   ld.lld: error: undefined symbol: mi_heap_malloc
// The set differs per profile (bun_alloc's mi_free_checked uses mi_free_size*
// under debug_assertions and mi_free otherwise), hence both rows; the tests
// are run, not just linked, because the shims abort if anything reaches them.
//
// Unix only: this relies on the linker reporting only references from live
// code (lld --gc-sections). link.exe reports dead ones too, so a bun_core
// dependent's test binary there either fails on ~100 unrelated externs or has
// them forced through; neither says anything about these shims. Remaining
// prerequisites as in rust-windows-sys-link.test.ts: cargo, and a configured
// checkout (vendor/lolhtml, build_options.rs), which test-only CI lanes lack.
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
    // The tape tests are what make the arena arm live; they must have run here, natively.
    expect(stdout).toMatch(/^test e::json_tape_tests::\w+ \.\.\. ok$/m);
    expect(stdout).toContain("test result: ok.");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  },
  // Cold target dir: compiles bun_core and ~30 other crates first, and the
  // release row ends in a fat-LTO link.
  180_000,
);
