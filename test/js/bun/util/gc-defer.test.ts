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

  test("nesting to depth 16 emits exactly one process warning", async () => {
    const warnings: string[] = [];
    const onWarning = (w: Error | string) => warnings.push(String(typeof w === "string" ? w : w.message));
    process.on("warning", onWarning);
    let depth = 0;
    try {
      for (let i = 0; i < 18; i++) depth = Bun.unsafe.gcDefer();
      expect(depth).toBe(18);
      await new Promise<void>(resolve => process.nextTick(resolve));
    } finally {
      while (depth > 0) depth = Bun.unsafe.gcAllow();
      process.off("warning", onWarning);
    }
    const deep = warnings.filter(w => /gcDefer/i.test(w) && /16|depth|deep/i.test(w));
    expect(deep.length).toBe(1);
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
      const s16 = "xxxxxxxxxxxxxxxx";
      for (let i = 0; i < 200_000; i++) {
        sink += JSON.stringify({ i, a: [i, i + 1, i + 2], s: s16 }).length;
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
    // dropped back near baseline. If gcAllow() failed to release the
    // bracket, gc(true) would itself be deferred → capacity would NOT
    // drop and heapSize() would still be frozen at baselineSize, so the
    // first assertion below catches that failure mode explicitly.
    Bun.gc(true);
    const afterCapacity = heapStats().heapCapacity;
    const afterSize = heapSize();
    // Capacity must have dropped well below the in-bracket peak — proves
    // the deferral was released and a collection actually ran.
    expect(afterCapacity).toBeLessThan(insideCapacity / 2);
    // And size returned near baseline (live set from this test ≈ 0).
    expect(afterSize).toBeLessThan(baselineSize * 4 + 64 * 1024 * 1024);
  });

  test("Bun.gc(true) outside a bracket still collects (no leaked deferral)", () => {
    // If an earlier test had leaked a deferral level, Bun.gc(true) would
    // be a no-op. heapSize() is frozen-at-last-collection so it can't
    // detect that — use heapCapacity (live block reservation) which
    // grows under allocation and drops on a real collection.
    Bun.gc(true);
    const baselineCap = heapStats().heapCapacity;
    let sink = 0;
    for (let i = 0; i < 100_000; i++) sink += { i, p: [i, i, i, i] }.p.length;
    expect(sink).toBeGreaterThan(0);
    const grownCap = heapStats().heapCapacity;
    expect(grownCap).toBeGreaterThan(baselineCap);
    Bun.gc(true);
    const postCap = heapStats().heapCapacity;
    // If a deferral had leaked, gc(true) is a no-op and capacity stays
    // at grownCap. A real collection drops it well below the grown peak.
    expect(postCap).toBeLessThan((baselineCap + grownCap) / 2);
  });
});
