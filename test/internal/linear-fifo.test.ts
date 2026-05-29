/**
 * Regression coverage for the `LinearFifo::ordered_remove_item` wrapped-buffer
 * bounds bug (issue #31563).
 *
 * `LinearFifo` (src/collections/linear_fifo.rs) is an internal Rust collection
 * in the `bun_collections` crate. Its only in-tree caller is the bake dev
 * server's source-map weak-ref store, which drives it with CSPRNG keys and an
 * asynchronous expiry timer — there is no JS-visible, deterministic way to
 * force its `ordered_remove_item` onto a *wrapped* buffer layout from here, and
 * the type is not exposed through `bun:internal-for-testing`. The authoritative
 * coverage therefore lives in the crate's own `#[cfg(test)] mod tests`
 * (src/collections/linear_fifo.rs), which builds the exact wrapped states from
 * the issue deterministically via `write_item`/`read_item`.
 *
 * This test is the discoverable `test/` entry point for that fix: it runs those
 * Rust unit tests with the workspace `cargo` and asserts they pass. With the
 * buggy bounds (`count - head` / `head - count`) the wrapped-branch tests panic
 * with a `usize` subtraction overflow / out-of-range slice index; with the fix
 * (`head + count - buf_len`) they pass.
 */
import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

// The wrapped-branch regression tests added alongside the fix. Each must be
// reported by `cargo test` as `<name> ... ok`.
const REQUIRED_TESTS = [
  "ordered_remove_item_wrapped_tail_branch_head_lt_count",
  "ordered_remove_item_wrapped_prefix_branch_head_gt_count",
  "ordered_remove_item_wrapped_all_offsets_match_reference",
] as const;

// Cargo is on PATH on the Linux/macOS CI test lanes (same baked image as the
// build lanes). Windows test agents don't reliably expose it, so skip there —
// the Miri CI lane already runs these same tests on `src/collections/**`.
describe.skipIf(isWindows)("LinearFifo::ordered_remove_item (Rust crate tests)", () => {
  test("wrapped-buffer removal regression tests pass", async () => {
    await using proc = Bun.spawn({
      cmd: [
        "cargo",
        "test",
        "-p",
        "bun_collections",
        "--",
        // Run exactly the three wrapped-branch regression tests by prefix.
        "linear_fifo::tests::ordered_remove_item_wrapped",
      ],
      cwd: repoRoot,
      env: process.env as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const output = stdout + stderr;

    // `cargo` missing (e.g. a stripped local env): don't fail the suite, the
    // Miri CI lane covers it. This never triggers on the real CI test lanes.
    if (exitCode === null || (exitCode !== 0 && /No such file or directory|program not found|ENOENT/i.test(output))) {
      return;
    }

    // Every wrapped-branch regression test must have run AND passed. If the fix
    // (and its co-located tests) are absent, cargo runs 0 matching tests and
    // these assertions fail — which is the intended fail-before behavior.
    for (const name of REQUIRED_TESTS) {
      expect(output).toContain(`test linear_fifo::tests::${name} ... ok`);
    }

    // The summary must report success with at least the three required tests.
    const summary = output.match(/test result: ok\. (\d+) passed; (\d+) failed/);
    expect(summary, `cargo did not report a passing summary:\n${output}`).not.toBeNull();
    expect(Number(summary![1])).toBeGreaterThanOrEqual(REQUIRED_TESTS.length);
    expect(Number(summary![2])).toBe(0);

    expect(exitCode).toBe(0);
  });
});
