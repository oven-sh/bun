/**
 * Regression coverage for the `LinearFifo::ordered_remove_item` wrapped-buffer
 * bounds bug (issue #31563).
 *
 * `LinearFifo` (src/collections/linear_fifo.rs) is an internal Rust ring buffer
 * with no JS-visible surface of its own. Its only in-tree caller (the bake dev
 * server's source-map weak-ref store) drives it with CSPRNG keys and an async
 * expiry timer, so the *wrapped* branch of `ordered_remove_item` can't be
 * reached deterministically from a normal test. The `linearFifoOrderedRemoveProbe`
 * helper (src/runtime/linear_fifo_testing.rs, exposed via
 * `bun:internal-for-testing`) reconstructs the exact wrapped states from the
 * issue and returns the resulting FIFO contents.
 *
 * With the buggy bounds (`count - head` / `head - count`) the wrapped branch
 * panics with a `usize` subtraction overflow / out-of-range slice index; with
 * the fix (`head + count - buf_len`) these assertions hold. The crate's own
 * `#[cfg(test)] mod tests` exercise the same states under Miri as well.
 */
import { linearFifoOrderedRemoveProbe } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

test("ordered_remove_item preserves FIFO order in the wrapped tail sub-branch (head < count)", () => {
  // write 12, read 8, write 10 -> head=8, count=14, buf_len=16 (wraps).
  // readable = [8,9,10,11, 100,101,102,103, 104,105,106,107,108,109]
  // remove offset 6 -> index=(8+6)&15=14 >= head -> tail sub-branch, drops 102.
  expect(linearFifoOrderedRemoveProbe(0)).toEqual([8, 9, 10, 11, 100, 101, 103, 104, 105, 106, 107, 108, 109]);
});

test("ordered_remove_item preserves FIFO order in the wrapped prefix sub-branch (head > count)", () => {
  // write 12, read 12, write 8 -> head=12, count=8, buf_len=16 (wraps).
  // readable = [200,201,202,203, 204,205,206,207]
  // remove offset 5 -> index=(12+5)&15=1 < head -> wrapped-prefix sub-branch, drops 205.
  expect(linearFifoOrderedRemoveProbe(1)).toEqual([200, 201, 202, 203, 204, 206, 207]);
});

// The intra-slice `ptr::copy` calls in `shift_down_one` / `realign` used to
// pass `slice.as_ptr()` as src and `slice.as_mut_ptr()` as dst in one call;
// under Stacked Borrows the second retag invalidates the first. This has no
// runtime-observable effect, so the discriminator is `cargo miri test` itself.
// `bun run rust:miri` pins Tree Borrows (which accepts the old shape); this
// test clears MIRIFLAGS to use miri's default Stacked Borrows model. Skipped
// where miri is not installed, or where the cargo workspace is not resolvable
// (test-only lanes run a prebuilt binary and lack vendor/lolhtml; see
// scripts/rust-miri.ts for the same prerequisite check).
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
  "linear_fifo unit tests are clean under Stacked Borrows miri",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "-p", "bun_collections", "--", "linear_fifo"],
      cwd: repoRoot,
      env: { ...process.env, MIRIFLAGS: "" },
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
  120_000,
);
