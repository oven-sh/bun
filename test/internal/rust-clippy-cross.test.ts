// The CI Clippy job lints the host target only, so code behind `#[cfg(windows)]`
// / `#[cfg(target_os = "freebsd")]` can fail clippy without anything noticing
// until someone runs `cargo clippy` on that OS. scripts/rust-clippy-cross.ts
// lints those targets from any host; this pins bun_core on each of them.
// bun_core is the root of the crate graph, so when it fails, `cargo clippy`
// reports nothing about any other crate on that target (the full per-target
// crate list is CI's job: `bun run rust:clippy-cross`, ~1 min per target).
//
// Skipped where the workspace is not resolvable (test-only CI lanes run a
// prebuilt binary and have neither vendor/lolhtml nor the configure output;
// same check as linear-fifo.test.ts) or where a target's std is not installed
// (`rustup target add <triple>`; rust-toolchain.toml installs them all).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { CROSS_CLIPPY_TARGETS } from "../../scripts/rust-clippy-cross.ts";

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const cargo = Bun.which("cargo");
const rustup = Bun.which("rustup");
const codegenDir = process.env.BUN_CODEGEN_DIR ?? path.join(repoRoot, "build", "debug", "codegen");
const workspaceResolvable =
  existsSync(path.join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(path.join(codegenDir, "build_options.rs"));

// Run from the repo root so rustup reports the toolchain rust-toolchain.toml
// pins, i.e. the one `cargo` below will use.
const installedTargets = new Set(
  cargo && rustup && workspaceResolvable
    ? Bun.spawnSync({
        cmd: [rustup, "target", "list", "--installed"],
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "ignore",
        timeout: 30_000,
      })
        .stdout.toString()
        .split(/\r?\n/)
    : [],
);

for (const triple of Object.keys(CROSS_CLIPPY_TARGETS)) {
  test.skipIf(!installedTargets.has(triple))(
    `bun_core is clippy-clean for ${triple}`,
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          cargo!,
          "clippy",
          "--locked",
          "--no-deps",
          "-p",
          "bun_core",
          "--target",
          triple,
          "--message-format=short",
        ],
        cwd: repoRoot,
        env: { ...process.env, CARGO_TERM_COLOR: "never" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // `--message-format=short` prints one `file:line:col: level: message` line per diagnostic.
      const diagnostics = stderr.split(/\r?\n/).filter(line => /^\S+\.rs:\d+:\d+: (error|warning)/.test(line));
      if (exitCode !== 0 && diagnostics.length === 0) {
        // Failed for a non-lint reason (build script, dependency), which the assertions below cannot show.
        console.error(stderr || stdout);
      }
      expect(diagnostics).toEqual([]);
      expect(exitCode).toBe(0);
    },
    // Fully cached this is ~150ms per target, but any change to bun_core or to
    // build_options.rs (its SHA constant changes with every commit) re-lints
    // the crate (~3s), and a cold target dir first checks its ~40 dependencies
    // for the triple (~10s): past the default per-test timeout. Serial on
    // purpose: concurrent cargo invocations just block on each other's
    // build-directory lock.
    120_000,
  );
}
