// Under `cargo test --release --doc`, cargo builds dependencies (including
// bun_ptr) with the release profile (cfg(debug_assertions) off), but rustdoc
// compiles the crate-under-test with cfg(debug_assertions) on. The
// CellRefCounted / ThreadSafeRefCounted derive macros previously emitted an
// `rc_debug_data` override gated on the *deriving* crate's
// cfg(debug_assertions), so every derive site in bun_http (and any other
// consumer) failed to compile under rustdoc's release doctest harness with
//   E0407 method `rc_debug_data` is not a member of trait `AnyRefCounted`
//   E0405 cannot find trait `DebugDataOps` in module `::bun_ptr::ref_count`
// even though the dev-profile doctests and the plain release lib build were
// fine. CI never ran release-profile doctests, so this was invisible.
//
// This test drives that exact configuration against bun_http (the crate the
// report was filed against) so the profile skew stays covered end to end.
import { which } from "bun";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cargo = which("cargo");
const repoRoot = join(import.meta.dir, "..", "..");
const codegenDir = join(repoRoot, "build", "debug", "codegen");
// Same prerequisite check as rust-windows-sys-link.test.ts / linear-fifo.test.ts:
// cargo parses the whole workspace manifest (including path deps) before
// applying -p, and test-only CI lanes run a prebuilt binary without
// vendor/lolhtml or the codegen tree on disk.
const workspaceResolvable =
  existsSync(join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) && existsSync(join(codegenDir, "build_options.rs"));

test.skipIf(!cargo || !workspaceResolvable)(
  "cargo test --release --doc -p bun_http compiles the ref-count derives",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargo!, "test", "--locked", "--release", "--doc", "-p", "bun_http", "--quiet"],
      cwd: repoRoot,
      env: { ...process.env, CARGO_TERM_COLOR: "never", BUN_CODEGEN_DIR: codegenDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Surface the rustc diagnostic so the gate/CI log shows the real error.
      console.error(stderr || stdout);
    }
    expect(stderr).not.toContain("is not a member of trait");
    expect(stderr).not.toContain("cannot find trait `DebugDataOps`");
    expect(exitCode).toBe(0);
  },
  120_000,
);
