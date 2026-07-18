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

// Scenarios 2/3 cover `ensure_total_capacity`/`realign` on a wrapped buffer.
// The old `realign` wrapped branch rotated via a 2KB stack scratch in a loop
// that memmoved the whole buffer once per 2KB of `head` (effectively quadratic,
// and an infinite loop when `size_of::<T>() > 2048`). The fix grows by copying
// the two readable segments directly into the new allocation, and realigns via
// a single O(n) rotation. On a build without the fix these scenarios are
// unimplemented and return `[]`.
test("ensure_total_capacity on a wrapped Dynamic buffer preserves FIFO order", () => {
  // write 12, read 10, write 12 -> head=10, count=14, buf_len=16 (wraps), then grow to 64.
  expect(linearFifoOrderedRemoveProbe(2)).toEqual([10, 11, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
});

test("realign on a wrapped Static buffer preserves FIFO order", () => {
  // write 12, read 10, write 12 -> head=10, count=14, buf_len=16 (wraps), then realign.
  expect(linearFifoOrderedRemoveProbe(3)).toEqual([10, 11, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
});
