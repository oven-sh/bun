/**
 * `bun_threading::Channel` (src/threading/channel.rs) must stay clean under
 * `cargo miri test`.
 *
 * The property this guards is the one `RunCommand::prefetch_remote_images`
 * (src/runtime/cli/run_command.rs) relies on: its done-channel is a local of
 * the function that reads it, so the HTTP thread's publish of the last tick
 * has to be finished with the channel by the time `read_item` returns. With
 * the publish going through `write_item(&self)`, the `&self` argument still
 * asserts the channel's storage while the reader is already free to return,
 * and the crate's own model of that caller
 * (`channel::tests::reader_may_free_a_channel_once_it_has_the_items`) is
 * rejected at its `Box` drop under both Tree Borrows (pinned here, as in
 * `bun run rust:miri`) and the default Stacked Borrows. `Channel::write_item_raw`
 * holds no reference into the channel past the store that releases the reader.
 * Natively the unfixed shape has nothing left to do after that store but
 * return, so there is nothing a bun-level test can observe; miri itself is
 * the discriminator.
 *
 * Only the channel tests run here: the crate's `wait_group` test has the same
 * bug in `WaitGroup::finish` and is fixed separately. Once the whole crate is
 * clean this filter can go and the crate can join `MIRI_CRATES` in
 * scripts/rust-miri.ts.
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
  "a Channel reader may free the channel as soon as read_item returns (Tree Borrows miri)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "-p", "bun_threading", "--", "channel::"],
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
    // The filter matching nothing would also exit 0; the model has to have run.
    expect(stdout).toContain("test channel::tests::reader_may_free_a_channel_once_it_has_the_items ... ok");
    expect(exitCode).toBe(0);
  },
  // Compiles the crate's dependencies for miri, then interprets 1024
  // channel hand-offs: ~20s of interpretation on top of a warm build here,
  // about a minute on a cold one.
  180_000,
);
