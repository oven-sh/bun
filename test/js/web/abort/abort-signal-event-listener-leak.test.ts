import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, test } from "bun:test";

// addEventListener({ signal }) registers an abort algorithm on the signal
// that removes the listener when the signal aborts. That algorithm must be
// removed from the signal when the listener is removed by any other path
// (removeEventListener, { once: true } firing, etc.), otherwise a long-lived
// signal reused across many add/remove cycles accumulates dead closures in
// AbortSignal::m_algorithms forever.
//
// We observe this via estimateShallowMemoryUsageOf(signal), which surfaces
// AbortSignal::memoryCost() including m_algorithms.sizeInBytes().

describe("addEventListener({ signal }) does not leak abort algorithms", () => {
  const iterations = 10_000;
  // Before the fix each add/remove left a std::pair<uint32_t, Function>
  // behind in m_algorithms (16 bytes/entry on 64-bit), so the delta was
  // ~160_000. Allow a small slack for incidental state.
  const leakThreshold = 1_000;

  test("removeEventListener releases the abort algorithm", () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const target = new EventTarget();

    // Warm up: Vector capacity grows geometrically, so do one cycle first
    // so the baseline already includes whatever minimum capacity is used.
    {
      const fn = () => {};
      target.addEventListener("foo", fn, { signal });
      target.removeEventListener("foo", fn);
    }

    const before = estimateShallowMemoryUsageOf(signal);

    for (let i = 0; i < iterations; i++) {
      const fn = () => {};
      target.addEventListener("foo", fn, { signal });
      target.removeEventListener("foo", fn);
    }

    const after = estimateShallowMemoryUsageOf(signal);
    expect(after - before).toBeLessThan(leakThreshold);
  });

  test("{ once: true } firing releases the abort algorithm", () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const target = new EventTarget();

    {
      const fn = () => {};
      target.addEventListener("bar", fn, { signal, once: true });
      target.dispatchEvent(new Event("bar"));
    }

    const before = estimateShallowMemoryUsageOf(signal);

    for (let i = 0; i < iterations; i++) {
      const fn = () => {};
      target.addEventListener("bar", fn, { signal, once: true });
      target.dispatchEvent(new Event("bar"));
    }

    const after = estimateShallowMemoryUsageOf(signal);
    expect(after - before).toBeLessThan(leakThreshold);
  });

  test("aborting the signal still removes listeners", () => {
    // Regression guard: after associating the algorithm with the
    // RegisteredEventListener, aborting the signal must still work.
    const controller = new AbortController();
    const signal = controller.signal;
    const target = new EventTarget();

    let calls = 0;
    const fn = () => {
      calls++;
    };
    target.addEventListener("baz", fn, { signal });

    target.dispatchEvent(new Event("baz"));
    expect(calls).toBe(1);

    controller.abort();

    target.dispatchEvent(new Event("baz"));
    expect(calls).toBe(1);
  });

  test("aborting after manual remove does not throw and does not re-add", () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const target = new EventTarget();

    let calls = 0;
    const fn = () => {
      calls++;
    };
    target.addEventListener("qux", fn, { signal });
    target.removeEventListener("qux", fn);

    // With the fix the algorithm was already dropped, so abort is a no-op
    // for this (former) listener. Without the fix the stale algorithm runs
    // and tries to remove an already-removed listener; either way the
    // listener must not fire.
    controller.abort();

    target.dispatchEvent(new Event("qux"));
    expect(calls).toBe(0);
  });
});
