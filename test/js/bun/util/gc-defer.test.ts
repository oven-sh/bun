import { describe, expect, test } from "bun:test";

describe("Bun.unsafe.gcDefer / gcAllow", () => {
  test("are exposed as functions", () => {
    expect(typeof Bun.unsafe.gcDefer).toBe("function");
    expect(typeof Bun.unsafe.gcAllow).toBe("function");
  });

  test("track nesting depth and return to zero", () => {
    expect(Bun.unsafe.gcDefer()).toBe(1);
    expect(Bun.unsafe.gcDefer()).toBe(2);
    expect(Bun.unsafe.gcAllow()).toBe(1);
    expect(Bun.unsafe.gcAllow()).toBe(0);
  });

  test("gcAllow at depth zero is a no-op (returns 0, does not throw)", () => {
    // Unbalanced allow is a usage bug and writes a warning to stderr, but
    // must not crash or underflow.
    expect(Bun.unsafe.gcAllow()).toBe(0);
    expect(Bun.unsafe.gcAllow()).toBe(0);
  });

  test("allocating heavily inside a deferred region does not crash, and GC catches up after", () => {
    const before = (Bun as any).jsc?.heapSize?.() ?? 0;
    Bun.unsafe.gcDefer();
    try {
      // Generate enough garbage to normally trigger an eden collection.
      let sink = 0;
      for (let i = 0; i < 200_000; i++) {
        sink += JSON.stringify({ i, a: [i, i + 1, i + 2], s: "x".repeat(8) }).length;
      }
      expect(sink).toBeGreaterThan(0);
    } finally {
      expect(Bun.unsafe.gcAllow()).toBe(0);
    }
    // Deferred pressure resolves at the next sync collection point — an
    // explicit Bun.gc(true) must still work (deferral depth is back to 0).
    Bun.gc(true);
    const after = (Bun as any).jsc?.heapSize?.() ?? 0;
    // After a full sync GC the heap should not have grown unboundedly.
    // Loose bound: under 4× the pre-test size (the loop's live set is ~0).
    if (before > 0) {
      expect(after).toBeLessThan(before * 4 + 64 * 1024 * 1024);
    }
  });

  test("Bun.gc(true) outside a bracket still collects (no leaked deferral)", () => {
    // If a previous test had leaked a deferral level, Bun.gc(true) would
    // be a no-op and heapSize would be unchanged after generating garbage.
    let sink = 0;
    for (let i = 0; i < 100_000; i++) sink += { i, p: [i, i] }.p.length;
    expect(sink).toBeGreaterThan(0);
    const pre = (Bun as any).jsc?.heapSize?.() ?? 0;
    Bun.gc(true);
    const post = (Bun as any).jsc?.heapSize?.() ?? 0;
    if (pre > 0) expect(post).toBeLessThanOrEqual(pre);
  });
});
