// bun_windows_sys is a #![no_std] leaf crate that several workspace crates
// (bun_errno, bun_spawn_sys) depend on unconditionally so that Win32 POD types
// like IO_COUNTERS resolve on every target. Its #[link(name = "...")]
// attributes must therefore be gated behind cfg(windows), or the linker for
// any standalone test binary on a non-Windows host sees
//   ld.lld: error: unable to find library -lntdll / -lkernel32 / ...
// as soon as bun_windows_sys.rlib lands on the link line.
//
// `cargo check --tests` type-checks only and will not catch this; it has to
// be `cargo test --no-run` so rustc actually drives the linker. The crate has
// zero dependencies, so linking completes in well under a second on a warm tree.
import { which } from "bun";
import { expect, test } from "bun:test";
import { isWindows } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cargo = which("cargo");
const repoRoot = join(import.meta.dir, "..", "..");
// Cargo parses the whole workspace manifest (including path deps) before
// applying -p, so it needs vendor/lolhtml on disk even for a zero-dep crate.
// Test-only CI lanes run a prebuilt binary and never fetch it; skip there.
// Same prerequisite check as linear-fifo.test.ts / scripts/rust-miri.ts.
const workspaceResolvable =
  existsSync(join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(join(repoRoot, "build", "debug", "codegen", "build_options.rs"));

test.skipIf(isWindows || !cargo || !workspaceResolvable)(
  "cargo test -p bun_windows_sys links on non-Windows hosts",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargo!, "test", "--locked", "-p", "bun_windows_sys", "--no-run", "--quiet"],
      cwd: repoRoot,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("unable to find library");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  },
);
