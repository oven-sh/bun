import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// addEventListener({ signal }) registers an abort algorithm on the signal
// that removes the listener when the signal aborts. That algorithm must be
// removed from the signal when the listener is removed by any other path
// (removeEventListener, { once: true } firing, etc.), otherwise a long-lived
// signal reused across many add/remove cycles accumulates dead algorithms
// forever.
//
// We observe this via estimateShallowMemoryUsageOf(signal), which surfaces
// AbortSignal::memoryCost(), and that counts the algorithms registered with
// the signal.

describe("addEventListener({ signal }) does not leak abort algorithms", () => {
  const iterations = 10_000;
  // An algorithm that stays registered is counted (16 bytes or more each), so
  // 10,000 of them show as 160,000 or more. Allow a small slack for
  // incidental state.
  const leakThreshold = 1_000;

  test("removeEventListener releases the abort algorithm", () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const target = new EventTarget();

    // Warm up: do one cycle first so the baseline already includes whatever
    // the signal's first registration allocates.
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

  test("GC of signal with self-referencing { signal } listener does not crash", async () => {
    // signal.addEventListener(type, fn, { signal }): the listener's abort
    // algorithm is linked into the signal that is also the listener's
    // target. When the signal is GC'd without aborting, ~AbortSignal() must
    // unlink it before its members are destroyed, otherwise ~EventTarget() →
    // EventListenerMap::clear() → markAsRemoved() unlinks it from a signal
    // that is mid-deletion.
    // Run in a subprocess so an ASAN report or debug ASSERT surfaces as a
    // non-zero exit instead of taking down the test runner.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          for (let i = 0; i < 200; i++) {
            const controller = new AbortController();
            const signal = controller.signal;
            signal.addEventListener("abort", () => {}, { signal });
            signal.addEventListener("foo", () => {}, { signal });
          }
          Bun.gc(true);
          for (let i = 0; i < 200; i++) {
            const controller = new AbortController();
            const signal = controller.signal;
            signal.addEventListener("abort", () => {}, { signal });
          }
          Bun.gc(true);
          console.log("ok");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stdout === "ok" and exitCode === 0 are sufficient to prove the
    // subprocess didn't crash; avoid asserting on stderr directly so
    // benign debug-build / sanitizer banners don't cause false positives,
    // but surface it alongside the failure for context.
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({ stdout: "ok", exitCode: 0, stderr });
  });

  test("the memory cost counts the listeners that are registered", () => {
    // If it did not, the leak tests above would check nothing.
    const { signal } = new AbortController();
    const targets = Array.from({ length: 1000 }, () => new EventTarget());
    const fn = () => {};

    const before = estimateShallowMemoryUsageOf(signal);
    for (const target of targets) target.addEventListener("foo", fn, { signal });
    const during = estimateShallowMemoryUsageOf(signal);
    for (const target of targets) target.removeEventListener("foo", fn);
    const after = estimateShallowMemoryUsageOf(signal);

    expect(during - before).toBeGreaterThanOrEqual(targets.length * 16);
    expect(after).toBe(before);
  });
});

// The signal links the abort algorithm of each { signal } listener, and the
// listener owns it. These are the orders in which the two sides go away.
describe("addEventListener({ signal }) lifetimes", () => {
  // Subprocesses: an ASAN report or a debug ASSERT is a non-zero exit. System
  // malloc, so that ASAN sees a write into a freed AbortSignal. No leak check
  // at exit: with system malloc, LeakSanitizer scans the whole heap for seconds.
  const env = isWindows
    ? bunEnv
    : { ...bunEnv, Malloc: "1", ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") };

  test("the signal is collected before its listeners", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { heapStats } = require("bun:jsc");
          const count = 600;
          const targets = [], fns = [];
          let calls = 0;
          // Nothing but the listener's options object ever refers to the signal.
          (() => {
            for (let i = 0; i < count; i++) {
              const target = new EventTarget();
              const fn = () => calls++;
              target.addEventListener("x", fn, { signal: new AbortController().signal, once: i % 3 === 0 });
              targets.push(target);
              fns.push(fn);
            }
          })();
          let signals;
          for (let i = 0; i < 10; i++) {
            Bun.gc(true);
            await new Promise(resolve => setImmediate(resolve));
            signals = heapStats().objectTypeCounts.AbortSignal ?? 0;
            if (signals <= 2) break;
          }
          // Each way a listener leaves its target: { once }, removeEventListener(), the target's collection.
          for (let i = 0; i < count; i += 3) targets[i].dispatchEvent(new Event("x"));
          for (let i = 1; i < count; i += 3) targets[i].removeEventListener("x", fns[i]);
          for (let i = 1; i < count; i += 3) targets[i].dispatchEvent(new Event("x"));
          targets.length = 0;
          Bun.gc(true);
          console.log(JSON.stringify({ collected: signals < count / 10, calls }));
        `,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: JSON.stringify({ collected: true, calls: 200 }),
      exitCode: 0,
      stderr,
    });
  });

  test("the targets are collected before the signal aborts", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const controller = new AbortController();
          const kept = new EventTarget();
          let calls = 0;
          (() => {
            for (let i = 0; i < 300; i++) new EventTarget().addEventListener("x", () => calls++, { signal: controller.signal });
            kept.addEventListener("x", () => calls++, { signal: controller.signal });
            for (let i = 0; i < 300; i++) new EventTarget().addEventListener("x", () => calls++, { signal: controller.signal });
          })();
          for (let i = 0; i < 3; i++) {
            Bun.gc(true);
            await new Promise(resolve => setImmediate(resolve));
          }
          kept.dispatchEvent(new Event("x"));
          controller.abort();
          kept.dispatchEvent(new Event("x"));
          console.log(JSON.stringify({ calls }));
        `,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: JSON.stringify({ calls: 1 }),
      exitCode: 0,
      stderr,
    });
  });

  test("abort removes every listener before the signal's abort event", () => {
    const controller = new AbortController();
    const { signal } = controller;
    const targets = Array.from({ length: 40 }, () => new EventTarget());
    let calls = 0;
    const fn = () => calls++;
    const seen: string[] = [];

    signal.addEventListener("abort", () => {
      for (const target of targets) target.dispatchEvent(new Event("x"));
      seen.push("abort");
    });
    for (const target of targets) target.addEventListener("x", fn, { signal });
    // The signal is also a target of its own listeners.
    signal.addEventListener("x", fn, { signal });
    signal.addEventListener("abort", () => seen.push("abort with { signal }"), { signal });

    for (const target of targets) target.dispatchEvent(new Event("x"));
    signal.dispatchEvent(new Event("x"));
    expect(calls).toBe(41);

    controller.abort();
    signal.dispatchEvent(new Event("x"));
    expect({ calls, seen }).toEqual({ calls: 41, seen: ["abort"] });
  });

  test("abort() from a listener removes the later listeners of that signal", () => {
    const controller = new AbortController();
    const { signal } = controller;
    const target = new EventTarget();
    const seen: string[] = [];

    target.addEventListener("x", () => (seen.push("a"), controller.abort()), { signal });
    target.addEventListener("x", () => seen.push("b"), { signal });
    target.addEventListener("x", () => seen.push("c"));
    target.dispatchEvent(new Event("x"));
    target.dispatchEvent(new Event("x"));

    expect(seen).toEqual(["a", "c", "c"]);
  });

  // A removed listener took its abort algorithm with it. The listener that is
  // added afterwards is a new one, and the signal knows nothing of it.
  test("a listener that is added again without the signal survives the abort", () => {
    const controller = new AbortController();
    const target = new EventTarget();
    let calls = 0;
    const fn = () => calls++;

    target.addEventListener("x", fn, { signal: controller.signal });
    target.removeEventListener("x", fn);
    target.addEventListener("x", fn);
    controller.abort();
    target.dispatchEvent(new Event("x"));

    expect(calls).toBe(1);
  });

  test("a listener that replaces itself and aborts during its own dispatch keeps its replacement", () => {
    const controller = new AbortController();
    const target = new EventTarget();
    let calls = 0;
    const fn = () => {
      if (++calls === 1) {
        target.removeEventListener("x", fn);
        target.addEventListener("x", fn);
        controller.abort();
      }
    };

    target.addEventListener("x", fn, { signal: controller.signal });
    target.dispatchEvent(new Event("x"));
    target.dispatchEvent(new Event("x"));

    expect(calls).toBe(2);
  });

  test("adding a registered listener again with another signal changes nothing", () => {
    const first = new AbortController();
    const second = new AbortController();
    const target = new EventTarget();
    let calls = 0;
    const fn = () => calls++;

    target.addEventListener("x", fn, { signal: first.signal });
    target.addEventListener("x", fn, { signal: second.signal });
    second.abort();
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(1);

    first.abort();
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(1);
  });
});

describe("addEventListener({ signal }) with many listeners on one signal", () => {
  test("removing a listener does not cost more the more listeners share its signal", async () => {
    // The signal keeps the abort algorithms of its listeners in registration
    // order. When that was a vector, taking one out meant a scan for it and a
    // shift of every entry after it, so one removal cost O(live listeners).
    // The same removals, timed against listeners that each have a signal of
    // their own in one process, cancel out machine speed and build flavour.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const live = 4000, reps = 100, rounds = 5;
          const fn = () => {};
          const event = new Event("x");

          // count targets with one listener each, on one signal or on a signal each.
          function listen(count, shared, once) {
            const sharedSignal = new AbortController().signal;
            return Array.from({ length: count }, () => {
              const target = new EventTarget();
              const options = { once, signal: shared ? sharedSignal : new AbortController().signal };
              target.addEventListener("x", fn, options);
              return { target, options };
            });
          }

          // The time to remove reps listeners. They are then registered again, as the newest.
          function time(entries, first, remove) {
            const t0 = Bun.nanoseconds();
            for (let i = first; i < first + reps; i++) remove(entries[i].target);
            const elapsed = Bun.nanoseconds() - t0;
            for (let i = first; i < first + reps; i++) entries[i].target.addEventListener("x", fn, entries[i].options);
            return elapsed;
          }

          function ratio(shared, own, firstOf, remove) {
            let sharedNs = Infinity, ownNs = Infinity;
            for (let round = 0; round < rounds; round++) {
              sharedNs = Math.min(sharedNs, time(shared, firstOf(round), remove));
              ownNs = Math.min(ownNs, time(own, 0, remove));
            }
            return Math.round((sharedNs / ownNs) * 10) / 10;
          }

          const removeListener = target => target.removeEventListener("x", fn);
          const dispatch = target => target.dispatchEvent(event);
          const shared = listen(live, true, false), own = listen(reps, false, false);
          console.log(JSON.stringify({
            newest: ratio(shared, own, () => live - reps, removeListener),
            oldest: ratio(shared, own, round => round * reps, removeListener),
            once: ratio(listen(live, true, true), listen(reps, false, true), round => round * reps, dispatch),
          }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const ratios = JSON.parse(stdout);
    // With the vector: newest 10, oldest 15, once 10 in release, and 2.8, 8, 9 in debug+ASAN.
    // With the list: 1 for each.
    expect(ratios.oldest, stdout).toBeLessThan(3);
    expect(ratios.newest, stdout).toBeLessThan(3);
    expect(ratios.once, stdout).toBeLessThan(3);
    expect(exitCode).toBe(0);
  });
});
