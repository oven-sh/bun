/**
 * `index_sort::apply_permutation_in_place` (src/collections/index_sort.rs) rearranges a slice
 * to match a sorted index array and, as part of its contract, leaves that index array as the
 * identity permutation (it used to be overwritten with a u32::MAX marker instead). Every
 * in-tree caller throws the index array away, so the `applyPermutationInPlaceProbe` helper
 * (src/runtime/index_sort_testing.rs, exposed via `bun:internal-for-testing`) returns both the
 * reordered items and the array's final state. The items start out as [0, 10, 20, ...], so the
 * expected items are simply each index in `order` times 10.
 *
 * The crate's own `#[cfg(test)]` tests check every permutation of up to 5 elements; this covers
 * one example of each shape from the bun test tree.
 */
import { applyPermutationInPlaceProbe } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

const permutations: [name: string, order: number[]][] = [
  ["empty", []],
  ["identity (all fixed points)", [0, 1, 2]],
  ["one cycle through every element", [1, 2, 3, 4, 0]],
  ["reversal (2-cycles around a fixed point)", [4, 3, 2, 1, 0]],
  ["3-cycle, fixed point, 2-cycle", [2, 0, 1, 3, 5, 4]],
];

describe("apply_permutation_in_place", () => {
  test.each(permutations)("%s", (_name, order) => {
    expect(applyPermutationInPlaceProbe(order)).toEqual({
      items: order.map(i => i * 10),
      order: order.map((_, i) => i),
    });
  });

  test("the probe rejects an order array that is not a permutation", () => {
    expect(() => applyPermutationInPlaceProbe([0, 0])).toThrow("more than once");
    expect(() => applyPermutationInPlaceProbe([0, 2])).toThrow("not an index into the array");
  });
});
