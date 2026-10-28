import { edenGC, fullGC } from "bun:jsc";
import { describe, expect, test } from "bun:test";

// Coverage for the WebKit 191c6a4138 sync. Each case pins an observable difference between
// the old and the new JavaScriptCore.

// Without the JIT or the generational collector every collection is a full one, and edenGC() answers 0.
const hasEdenCollections = edenGC() !== 0;

describe("WebKit 191c6a4138 upgrade", () => {
  // An eden collection only collects what was allocated since the last collection, and the heap
  // subtracts one size from the other.
  test.skipIf(!hasEdenCollections).each([
    ["WeakMap", () => new WeakMap<object, number>(), (table: any, key: object) => table.set(key, 1)],
    ["WeakSet", () => new WeakSet<object>(), (table: any, key: object) => table.add(key)],
  ])("the heap is not smaller after an eden collection because an old %s shrank", (_, create, add) => {
    const table = create();
    const keys = Array.from({ length: 4096 }, () => ({}));
    for (const key of keys) add(table, key);

    const sizes = [fullGC()];
    for (const key of keys) table.delete(key);
    for (let i = 0; i < 2; i++) {
      // A collection of an empty eden does nothing at all.
      (globalThis as any).sink = {};
      sizes.push(edenGC());
    }
    delete (globalThis as any).sink;

    expect(sizes).toEqual(sizes.toSorted((a, b) => a - b));
  });
});
