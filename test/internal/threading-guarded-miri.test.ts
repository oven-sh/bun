/**
 * `Guarded::with_lock_raw` (src/threading/guarded.rs) exists for the writer
 * side of a handoff whose reader frees the `Guarded` as soon as it has taken
 * the value: `AsyncHTTP::send_sync` heap-allocates a `SingleHTTPChannel`,
 * blocks in `read_item` and frees the channel on the next line, so the HTTP
 * thread's publish may find the channel gone the instant its lock release
 * lands. A publisher written as `fn write_item(&self)` with a guard (the shape
 * this replaced) still holds references into the channel at that point, and
 * the aliasing models reject the reader's free for it; natively the only work
 * left after the releasing store is frames returning (plus a futex wake keyed
 * by the dead address when the unlock was contended), so nothing a bun-level
 * test can observe distinguishes the two shapes. The discriminator is miri on
 * the crate's model of the handoff, `guarded::tests`, which this runs under
 * the Tree Borrows model `bun run rust:miri` pins; the `&self` shape fails it
 * within a few dozen iterations.
 *
 * Scoped to `guarded::` rather than the whole crate because the crate's own
 * `wait_group` test is still rejected on main (the same bug class, fixed
 * separately); once the whole crate is clean this can become a crate-wide run.
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
  "the reader of a Guarded handoff may free it once with_lock_raw has released it (Tree Borrows miri)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "-p", "bun_threading", "--", "guarded::"],
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
    // A filter that matches nothing exits 0 too; the model has to have run.
    expect(stdout).toContain("test guarded::tests::reader_may_free_the_channel_once_the_raw_release_has_landed ... ok");
    expect(exitCode).toBe(0);
  },
  // Compiles the crate's dependencies for miri, then interprets 300 thread
  // spawns: about 10s on a warm tree, around a minute on a cold one.
  180_000,
);
