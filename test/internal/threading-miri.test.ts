/**
 * `bun_threading` (src/threading/) must stay clean under `cargo miri test`; it
 * is one of the crates `bun run rust:miri` (scripts/rust-miri.ts) covers.
 *
 * The property this was added for is `WaitGroup`'s: `wait()` returning lets the
 * owner free the group, so the thread that finishes the last task must neither
 * touch the group nor still hold a reference into it once it has let `wait()`
 * return (`WaitGroup::finish_raw`, and the `Mutex::unlock_raw` /
 * `Futex::wake_raw` it rests on). Natively the unfixed shape's only extra work
 * after the releasing store is a futex wake keyed by the freed address, which
 * the kernel ignores, so there is nothing a bun-level test can observe; the
 * discriminator is miri itself. With `finish()` taking `&self` through the
 * release, the crate's own `wait_group` test is rejected at its `Box` drop under
 * both Tree Borrows (pinned here, as in `rust:miri`) and the default Stacked
 * Borrows.
 *
 * Skipped where miri is not installed or the cargo workspace is not resolvable
 * (test-only CI lanes run a prebuilt binary and lack vendor/lolhtml); same
 * prerequisite check as linear-fifo.test.ts and scripts/rust-miri.ts.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

const cargoBin = Bun.which("cargo");
const repoRoot = path.resolve(import.meta.dir, "..", "..");
const workspaceResolvable =
  existsSync(path.join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(path.join(repoRoot, "build", "debug", "codegen", "build_options.rs"));
const miriAvailable =
  !!cargoBin &&
  workspaceResolvable &&
  Bun.spawnSync({
    cmd: [cargoBin, "miri", "--version"],
    cwd: repoRoot,
    stdout: "ignore",
    stderr: "ignore",
    timeout: 30_000,
  }).exitCode === 0;

test.skipIf(!miriAvailable)(
  "bun_threading unit tests are clean under Tree Borrows miri",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "-p", "bun_threading"],
      cwd: repoRoot,
      env: { ...process.env, MIRIFLAGS: "-Zmiri-tree-borrows" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Surface miri's diagnostic so the gate/CI log shows the actual UB.
      console.error(stderr || stdout);
    }
    expect(stderr).not.toContain("Undefined Behavior");
    expect(exitCode).toBe(0);
  },
  // Compiles the crate's dependencies for miri, then interprets the WaitGroup
  // test's 500 thread spawns: ~30s on a warm tree, more on a cold one.
  180_000,
);
