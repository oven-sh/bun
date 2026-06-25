import { heapSize, heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";

// Each test fully unwinds the bracket in `finally` so a failing assertion
// can't leave the VM with a non-zero deferral depth and poison later tests.
describe("Bun.unsafe.gcDefer / gcAllow", () => {
  test("are exposed as functions", () => {
    expect(typeof Bun.unsafe.gcDefer).toBe("function");
    expect(typeof Bun.unsafe.gcAllow).toBe("function");
  });

  test("track nesting depth and return to zero", () => {
    let depth = 0;
    try {
      depth = Bun.unsafe.gcDefer();
      expect(depth).toBe(1);
      depth = Bun.unsafe.gcDefer();
      expect(depth).toBe(2);
      depth = Bun.unsafe.gcAllow();
      expect(depth).toBe(1);
      depth = Bun.unsafe.gcAllow();
      expect(depth).toBe(0);
    } finally {
      while (depth > 0) depth = Bun.unsafe.gcAllow();
    }
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

  test("collection is held off inside the bracket and resumes after", () => {
    // Validate the actual DeferGCForAWhile contract, not just the depth
    // counter. Inside the bracket the eden collector must not reclaim
    // garbage even under pressure; after gcAllow() a sync collection
    // brings the heap back near baseline.
    //
    // Use heapStats().heapCapacity (current reserved blocks) to observe
    // growth — heapSize() is the size at the LAST collection, so it's
    // frozen for the duration of the bracket by definition.
    Bun.gc(true);
    const baselineCapacity = heapStats().heapCapacity;
    const baselineSize = heapSize();
    let depth = 0;
    let insideCapacity = 0;
    try {
      depth = Bun.unsafe.gcDefer();
      // Generate well past the eden trigger. None of this is rooted past
      // the loop body, so without the bracket an eden GC would fire and
      // capacity would saw-tooth instead of climbing.
      let sink = 0;
      for (let i = 0; i < 200_000; i++) {
        sink += JSON.stringify({ i, a: [i, i + 1, i + 2], s: "x".repeat(16) }).length;
      }
      expect(sink).toBeGreaterThan(0);
      insideCapacity = heapStats().heapCapacity;
    } finally {
      while (depth > 0) depth = Bun.unsafe.gcAllow();
    }
    // Inside the bracket capacity grew by the garbage we created. 8 MB is
    // a conservative floor (200k × ~50-byte JSON × overhead is tens of MB).
    expect(insideCapacity).toBeGreaterThan(baselineCapacity + 8 * 1024 * 1024);
    // gcAllow() does NOT itself collect — DeferGCForAWhile's dtor only
    // decrements m_deferralDepth. Trigger an explicit sync collection (a
    // normal allocation slow path would do the same) and verify the heap
    // dropped back near baseline.
    Bun.gc(true);
    const afterSize = heapSize();
    // Loose: under 4× baseline + 64 MB slack (live set from this test ≈ 0).
    expect(afterSize).toBeLessThan(baselineSize * 4 + 64 * 1024 * 1024);
  });

  test("Bun.gc(true) outside a bracket still collects (no leaked deferral)", () => {
    // If an earlier test had leaked a deferral level, Bun.gc(true) would
    // be a no-op and post-GC heapSize would not return to baseline.
    Bun.gc(true);
    const baseline = heapSize();
    let sink = 0;
    for (let i = 0; i < 100_000; i++) sink += { i, p: [i, i, i, i] }.p.length;
    expect(sink).toBeGreaterThan(0);
    Bun.gc(true);
    const post = heapSize();
    // heapSize after a full GC isn't guaranteed monotone, but it must be
    // back near the pre-allocation baseline — bound at baseline + slack
    // so a leaked deferral (gc skipped → post tracks the grown heap)
    // actually fails.
    expect(post).toBeLessThan(baseline + 16 * 1024 * 1024);
  });
});
