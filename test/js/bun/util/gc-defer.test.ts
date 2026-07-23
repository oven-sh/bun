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

  test("nesting to depth 16 emits at most one process warning (one-shot per VM)", async () => {
    // gcDeferWarned is a per-VM latch (never reset). Under --rerun-each the
    // file re-runs in the same VM, so iteration 2+ legitimately emits zero
    // warnings. Track first-run via a global so we can assert ==1 on the
    // first pass and ==0 thereafter — together that proves both "fires"
    // and "one-shot".
    const firstRun = !(globalThis as { __gcDeferDepth16TestRan?: boolean }).__gcDeferDepth16TestRan;
    (globalThis as { __gcDeferDepth16TestRan?: boolean }).__gcDeferDepth16TestRan = true;
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
    expect(deep.length).toBe(firstRun ? 1 : 0);
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
    // Capacity must have dropped from the in-bracket peak by at least
    // half the in-bracket growth — proves the deferral was released and
    // a collection actually ran. (Bounding the *drop* relative to the
    // *growth* is robust to whatever baselineCapacity the test process
    // started with; an absolute or insideCapacity/2 bound implicitly
    // assumes baselineCapacity < G, which isn't guaranteed across lanes.)
    const grew = insideCapacity - baselineCapacity;
    const dropped = insideCapacity - afterCapacity;
    expect(dropped).toBeGreaterThan(grew / 2);
    // And size returned near baseline (live set from this test ≈ 0).
    expect(afterSize).toBeLessThan(baselineSize * 4 + 64 * 1024 * 1024);
  });

  test("no deferral leaked from earlier tests", () => {
    // Direct check: if an earlier test left a bracket open, gcDefer()
    // here would return >1. The contract test above already proves
    // gc(true) works after a properly-closed bracket; this test only
    // needs to prove the depth state is clean. (Heap-size-based checks
    // are unreliable here because without a bracket eden GC fires
    // mid-loop and saw-tooths capacity to a build-dependent threshold.)
    const depth = Bun.unsafe.gcDefer();
    try {
      expect(depth).toBe(1);
    } finally {
      Bun.unsafe.gcAllow();
    }
  });
});
