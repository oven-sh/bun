import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";

// addEventListener({ signal }) registers an abort algorithm on the signal
// that removes the listener when the signal aborts. The listener owns that
// algorithm and the signal links it. When the listener leaves its target by
// any other path (removeEventListener, { once: true } firing, the target's
// collection), its algorithm must leave the signal with it. A stale algorithm
// would run at abort and remove a listener that was added again, and it would
// keep an AbortSignal.timeout() alive until its deadline.

describe("addEventListener({ signal }) does not leak abort algorithms", () => {
  test("removeEventListener releases the abort algorithm", () => {
    const controller = new AbortController();
    const target = new EventTarget();
    let calls = 0;
    const fn = () => calls++;

    target.addEventListener("foo", fn, { signal: controller.signal });
    target.removeEventListener("foo", fn);
    // A new registration, without the signal. A stale algorithm would remove it.
    target.addEventListener("foo", fn);
    controller.abort();
    target.dispatchEvent(new Event("foo"));

    expect(calls).toBe(1);
  });

  test("{ once: true } firing releases the abort algorithm", () => {
    const controller = new AbortController();
    const target = new EventTarget();
    let calls = 0;
    const fn = () => calls++;

    target.addEventListener("bar", fn, { signal: controller.signal, once: true });
    target.dispatchEvent(new Event("bar"));
    target.addEventListener("bar", fn);
    controller.abort();
    target.dispatchEvent(new Event("bar"));

    expect(calls).toBe(2);
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

  test.concurrent("the signal is collected before its listeners", async () => {
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

  test.concurrent("the targets are collected before the signal aborts", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { heapStats } = require("bun:jsc");
          const count = 600;
          const controller = new AbortController();
          const kept = new EventTarget();
          let calls = 0;
          (() => {
            for (let i = 0; i < count / 2; i++) new EventTarget().addEventListener("x", () => calls++, { signal: controller.signal });
            kept.addEventListener("x", () => calls++, { signal: controller.signal });
            for (let i = 0; i < count / 2; i++) new EventTarget().addEventListener("x", () => calls++, { signal: controller.signal });
          })();
          // A collection destroys the targets that nothing refers to, and their listeners with them.
          let targets;
          for (let i = 0; i < 10; i++) {
            Bun.gc(true);
            await new Promise(resolve => setImmediate(resolve));
            targets = heapStats().objectTypeCounts.EventTarget ?? 0;
            if (targets < count / 10) break;
          }
          kept.dispatchEvent(new Event("x"));
          controller.abort();
          kept.dispatchEvent(new Event("x"));
          console.log(JSON.stringify({ collected: targets < count / 10, calls }));
        `,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: JSON.stringify({ collected: true, calls: 1 }),
      exitCode: 0,
      stderr,
    });
  });

  // These two targets count their "message" listeners to hold the event loop open, so
  // EventTarget::removeEventListener() tells them the event type after the listener is gone.
  test.concurrent("abort removes a message listener from the global scope and from a MessagePort", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const controller = new AbortController();
          const { port1, port2 } = new MessageChannel();
          let calls = 0;
          const fn = () => calls++;
          globalThis.addEventListener("message", fn, { signal: controller.signal });
          port1.addEventListener("message", fn, { signal: controller.signal });
          globalThis.dispatchEvent(new MessageEvent("message"));
          port1.dispatchEvent(new MessageEvent("message"));
          controller.abort();
          globalThis.dispatchEvent(new MessageEvent("message"));
          port1.dispatchEvent(new MessageEvent("message"));
          port1.close();
          port2.close();
          console.log(JSON.stringify({ calls }));
          // No process.exit(): the global scope's listener no longer holds the event loop open.
        `,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: JSON.stringify({ calls: 2 }),
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

// An AbortSignal.timeout() lives for as long as something can observe its abort
// (JSAbortSignalOwner::isReachableFromOpaqueRoots). A { signal } listener is
// such an observer, from addEventListener() until it leaves its target.
describe.concurrent("addEventListener({ signal: AbortSignal.timeout() })", () => {
  test("the timeout removes the listener when nothing else refers to the signal", async () => {
    const target = new EventTarget();
    let calls = 0;
    const fn = () => calls++;

    (() => target.addEventListener("x", fn, { signal: AbortSignal.timeout(200) }))();
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(1);

    // A signal that its listener did not keep alive is collected here, and its timer with it.
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);

    // Behind the signal under test in the timer heap, so that one has fired when this one does.
    const fence = AbortSignal.timeout(250);
    await new Promise(resolve => fence.addEventListener("abort", resolve, { once: true }));
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(1);
  });

  test("the signals are collected once their listeners have left", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { heapStats } = require("bun:jsc");
          const count = 200;
          const targets = [], fns = [];
          // Nothing but the listener's registration refers to a signal. An hour: none fires here.
          (() => {
            for (let i = 0; i < count; i++) {
              const target = new EventTarget();
              const fn = () => {};
              target.addEventListener("x", fn, { signal: AbortSignal.timeout(3_600_000), once: i % 2 === 0 });
              targets.push(target);
              fns.push(fn);
            }
          })();
          // The signals that are left after up to rounds collections, or as soon as enough are gone.
          async function signals(rounds, enough) {
            let live;
            for (let i = 0; i < rounds; i++) {
              Bun.gc(true);
              await new Promise(resolve => setImmediate(resolve));
              live = heapStats().objectTypeCounts.AbortSignal ?? 0;
              if (live <= enough) break;
            }
            return live;
          }
          const observed = await signals(3, 0);
          for (let i = 0; i < count; i += 2) targets[i].dispatchEvent(new Event("x"));
          for (let i = 1; i < count; i += 2) targets[i].removeEventListener("x", fns[i]);
          const released = await signals(10, count / 10);
          console.log(JSON.stringify({ observed: observed >= count, released: released <= count / 10 }));
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: JSON.stringify({ observed: true, released: true }),
      exitCode: 0,
      stderr,
    });
  });
});

describe("addEventListener({ signal }) with many listeners on one signal", () => {
  // The listeners on the shared signal, and the ratio that fails. An optimized build registers
  // a listener in about a microsecond, so it can afford the count that sets the two designs far
  // apart. A debug build takes 0.2 ms for each.
  const [live, limit] = isDebug || isASAN ? [4000, 3] : [40000, 16];

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
          const live = ${live}, limit = ${limit}, reps = 25, minRounds = 10, maxRounds = 40;
          const fn = () => {};
          const event = new Event("x");

          // count targets with one listener each, on one signal or on a signal each.
          // { once }: a dispatch removes the listener too.
          function listen(count, shared) {
            const sharedSignal = new AbortController().signal;
            return Array.from({ length: count }, () => {
              const target = new EventTarget();
              const options = { once: true, signal: shared ? sharedSignal : new AbortController().signal };
              target.addEventListener("x", fn, options);
              return { target, options };
            });
          }
          const shared = listen(live, true), own = listen(reps, false);

          // The time to remove reps listeners. They are then registered again, as the newest.
          function time(entries, first, remove) {
            const t0 = Bun.nanoseconds();
            for (let i = first; i < first + reps; i++) remove(entries[i].target);
            const elapsed = Bun.nanoseconds() - t0;
            for (let i = first; i < first + reps; i++) entries[i].target.addEventListener("x", fn, entries[i].options);
            return elapsed;
          }

          // The shared signal's listeners are in index order, from this index on and around.
          let oldest = 0;
          const takeOldest = () => {
            const first = oldest;
            oldest = (oldest + reps) % live;
            return first;
          };
          const newest = () => (oldest + live - reps) % live;

          // The fastest window on the shared signal over the fastest window on own signals.
          // Whatever else runs on the machine only makes a window slower, so a window is
          // short and there are many: more rounds only bring each minimum down to the true
          // cost. The rounds stop when the ratio is well under the limit.
          function ratio(firstOf, remove) {
            let sharedNs = Infinity, ownNs = Infinity;
            for (let round = 1; round <= maxRounds; round++) {
              sharedNs = Math.min(sharedNs, time(shared, firstOf(), remove));
              ownNs = Math.min(ownNs, time(own, 0, remove));
              if (round >= minRounds && sharedNs * 2 < ownNs * limit) break;
            }
            return Math.round((sharedNs / ownNs) * 10) / 10;
          }

          const removeListener = target => target.removeEventListener("x", fn);
          const dispatch = target => target.dispatchEvent(event);
          console.log(JSON.stringify({
            newest: ratio(newest, removeListener),
            oldest: ratio(takeOldest, removeListener),
            once: ratio(takeOldest, dispatch),
          }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const ratios = JSON.parse(stdout || "{}");
    // The three ratios with the vector, then with the list:
    //   optimized, 40,000 listeners: about 90, 140 and 90, then 1 to 4.
    //   debug+ASAN, 4,000 listeners: about 3, 8 to 10 and 7 to 11, then 0.7 to 1.6.
    // The limit is 4x away from both on an optimized build and 2x on a debug build. Only
    // newest-first on a debug build cannot tell the two apart.
    expect(ratios.oldest, stdout + stderr).toBeLessThan(limit);
    expect(ratios.once, stdout + stderr).toBeLessThan(limit);
    expect(ratios.newest, stdout + stderr).toBeLessThan(limit);
    expect(exitCode).toBe(0);
  });
});
