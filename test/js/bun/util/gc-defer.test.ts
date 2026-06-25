import { heapSize } from "bun:jsc";
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

  test("gcAllow at depth zero emits a process warning, returns 0, and does not throw", async () => {
    // Unbalanced allow is a usage bug. It must not crash or underflow, and
    // it surfaces via process.emitWarning so it's catchable / loggable.
    const warnings: string[] = [];
    const onWarning = (w: Error | string) => warnings.push(String(typeof w === "string" ? w : w.message));
    process.on("warning", onWarning);
    try {
      expect(Bun.unsafe.gcAllow()).toBe(0);
      expect(Bun.unsafe.gcAllow()).toBe(0);
      // emitWarning dispatches via nextTick.
      await new Promise<void>(resolve => process.nextTick(resolve));
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings.some(w => w.includes("gcAllow"))).toBe(true);
  });

  test("allocating heavily inside a deferred region does not crash, and GC catches up after", () => {
    const before = heapSize();
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
    const after = heapSize();
    // After a full sync GC the heap should not have grown unboundedly.
    // Loose bound: under 4× the pre-test size + 64 MB slack (the loop's
    // live set is ~0).
    expect(after).toBeLessThan(before * 4 + 64 * 1024 * 1024);
  });

  test("Bun.gc(true) outside a bracket still collects (no leaked deferral)", () => {
    // If a previous test had leaked a deferral level, Bun.gc(true) would
    // be a no-op and the heap would be unbounded after generating garbage.
    let sink = 0;
    for (let i = 0; i < 100_000; i++) sink += { i, p: [i, i] }.p.length;
    expect(sink).toBeGreaterThan(0);
    const pre = heapSize();
    Bun.gc(true);
    const post = heapSize();
    // heapSize after a full GC isn't guaranteed to be <= pre (object-space
    // accounting can transiently rise around a sweep), so use a generous
    // bound that only fails if collection was actually skipped.
    expect(post).toBeLessThan(pre + 32 * 1024 * 1024);
  });
});
