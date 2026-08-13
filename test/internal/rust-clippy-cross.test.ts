// The CI Clippy job lints the host target, and scripts/rust-clippy-cross.ts
// lints the targets in scripts/rust-clippy-cross-budgets.json against per-file
// budgets of the remaining hits. This runs the plain deny-level lint of one
// crate for each of those targets, the way `cargo clippy -p bun_core` runs on
// such a machine: bun_core is the root of the crate graph, so a hit in its
// cfg-gated code used to make that command fail on a Windows host before it
// reported anything about any other crate.
//
// Skipped where the workspace is not resolvable (test-only CI lanes run a
// prebuilt binary and have neither vendor/lolhtml nor the configure output;
// same check as linear-fifo.test.ts) or where a target's std is not installed
// (`rustup target add <triple>`; rust-toolchain.toml installs them all).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const budgets: Record<string, unknown> = await Bun.file(
  path.join(repoRoot, "scripts", "rust-clippy-cross-budgets.json"),
).json();
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

// Own target dir: with `--no-deps`, cargo reuses a bun_core that some earlier
// `cargo clippy -p <dependent>` compiled as an unlinted dependency, and would
// report it clean here without looking at it. Nothing else builds into this
// directory, so bun_core is always linted when it is (re)built here.
const targetDir = path.join(process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, "target"), "rust-clippy-cross-test");

for (const triple of Object.keys(budgets)) {
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
        env: { ...process.env, CARGO_TARGET_DIR: targetDir, CARGO_TERM_COLOR: "never" },
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
    // The first run per triple checks bun_core's ~40 dependencies into the
    // private target dir (~10s) and any later run re-lints bun_core after a
    // change to it or to build_options.rs (its SHA constant changes with every
    // commit; ~3s): past the default per-test timeout. Serial on purpose:
    // concurrent cargo invocations just block on the target dir's lock.
    120_000,
  );
}
