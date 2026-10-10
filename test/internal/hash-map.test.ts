/**
 * `bun_collections::HashMap` (src/collections/zig_hash_map.rs) is an internal
 * Rust map with no JS-visible surface of its own. From JS the length of a
 * lookup shows only as time, so these tests count it: `hashMapChurnProbe`
 * (src/runtime/hash_map_testing.rs, exposed via `bun:internal-for-testing`)
 * returns how many stored entries a lookup of an absent key is compared against.
 */
import { hashMapChurnProbe } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

// The exact count depends on the integer hash, so these bound it. A delete that leaves tombstones gives `length` after the churn.
test("a lookup in a map that never removed an entry walks one short run", () => {
  const { maxComparisons, ...size } = hashMapChurnProbe(256, 0);
  expect(size).toEqual({ capacity: 512, length: 256 });
  expect(maxComparisons).toBeLessThanOrEqual(32);
});

test("a lookup still walks one short run after 2,000 removals", () => {
  const { maxComparisons, ...size } = hashMapChurnProbe(256, 2000);
  expect(size).toEqual({ capacity: 512, length: 256 });
  expect(maxComparisons).toBeLessThanOrEqual(32);
});

test("the probe churns nothing when no key is live", () => {
  expect(hashMapChurnProbe(0, 1000)).toEqual({ capacity: 0, length: 0, maxComparisons: 0 });
});
