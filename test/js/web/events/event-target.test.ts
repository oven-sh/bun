import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("EventTarget with many event types", () => {
  test("lookup cost does not depend on how many other types are registered", async () => {
    // EventListenerMap keeps one entry per event type. Registering n types and
    // then timing the same operations against the first-registered and the
    // last-registered type isolates the per-type lookup: with a linear scan the
    // last type costs O(n) per call while the first costs O(1), with an indexed
    // lookup both cost the same. Comparing the two inside one process cancels
    // out machine speed and build flavour.
    const n = 16000;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const n = ${n};
          const reps = 200;
          const target = new EventTarget();
          const f = () => {};
          const g = () => {};
          for (let i = 0; i < n; i++) target.addEventListener("e" + i, f);

          function time(type) {
            const ev = new Event(type);
            const t0 = Bun.nanoseconds();
            for (let i = 0; i < reps; i++) {
              target.dispatchEvent(ev);
              target.addEventListener(type, f); // duplicate, no-op
              target.removeEventListener(type, g); // not registered, no-op
            }
            return Bun.nanoseconds() - t0;
          }

          let first = Infinity, last = Infinity;
          for (let round = 0; round < 5; round++) {
            first = Math.min(first, time("e0"));
            last = Math.min(last, time("e" + (n - 1)));
          }
          console.log(JSON.stringify({ ratio: last / first, first, last }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    // Linear scan: ~60x in release, ~20x in debug+ASAN. Indexed: ~1x.
    expect(result.ratio, stdout).toBeLessThan(4);
    expect(exitCode).toBe(0);
  });

  // The cases below cross the size at which EventListenerMap switches from a
  // linear scan to a type -> position index and back.

  test("each type dispatches to its own listeners", () => {
    const target = new EventTarget();
    const calls: string[] = [];
    const types = Array.from({ length: 40 }, (_, i) => "type" + i);
    const listeners = new Map(types.map(type => [type, () => calls.push(type)]));
    for (const type of types) target.addEventListener(type, listeners.get(type)!);

    for (const type of types) target.dispatchEvent(new Event(type));
    expect(calls).toEqual(types);

    // Duplicates are still detected once the index is in use.
    calls.length = 0;
    for (const type of types) target.addEventListener(type, listeners.get(type)!);
    for (const type of types) target.dispatchEvent(new Event(type));
    expect(calls).toEqual(types);

    expect(target.dispatchEvent(new Event("unregistered"))).toBe(true);
    target.removeEventListener("unregistered", () => {});
    expect(calls).toEqual(types);
  });

  test("removing a type leaves every other type intact", () => {
    const target = new EventTarget();
    const calls: string[] = [];
    const types = Array.from({ length: 40 }, (_, i) => "type" + i);
    const listeners = new Map(types.map(type => [type, () => calls.push(type)]));
    for (const type of types) target.addEventListener(type, listeners.get(type)!);

    const removed = ["type0", "type20", "type39"];
    for (const type of removed) target.removeEventListener(type, listeners.get(type)!);
    // Removing again, or removing a callback that was never added, is a no-op.
    for (const type of removed) target.removeEventListener(type, listeners.get(type)!);
    target.removeEventListener("type5", () => {});

    for (const type of types) target.dispatchEvent(new Event(type));
    expect(calls).toEqual(types.filter(type => !removed.includes(type)));

    // A removed type can be registered again.
    calls.length = 0;
    for (const type of removed) target.addEventListener(type, listeners.get(type)!);
    for (const type of types) target.dispatchEvent(new Event(type));
    expect(calls).toEqual(types);
  });

  test("a type with several listeners survives removing one of them", () => {
    const target = new EventTarget();
    const calls: string[] = [];
    for (let i = 0; i < 40; i++) target.addEventListener("type" + i, () => calls.push("type" + i));
    const extra = () => calls.push("extra");
    target.addEventListener("type25", extra);
    target.addEventListener("type25", extra, { capture: true });

    // The capture listener runs first.
    target.dispatchEvent(new Event("type25"));
    expect(calls).toEqual(["extra", "type25", "extra"]);

    calls.length = 0;
    target.removeEventListener("type25", extra);
    target.dispatchEvent(new Event("type25"));
    expect(calls).toEqual(["extra", "type25"]);

    calls.length = 0;
    target.removeEventListener("type25", extra, { capture: true });
    target.dispatchEvent(new Event("type25"));
    expect(calls).toEqual(["type25"]);
  });

  test("shrinking below the index threshold and growing past it again", () => {
    const target = new EventTarget();
    const calls: string[] = [];
    const types = Array.from({ length: 40 }, (_, i) => "type" + i);
    const listeners = new Map(types.map(type => [type, () => calls.push(type)]));

    for (let round = 0; round < 3; round++) {
      for (const type of types) target.addEventListener(type, listeners.get(type)!);
      for (const type of types) target.dispatchEvent(new Event(type));
      expect(calls).toEqual(types);
      calls.length = 0;

      // Remove from the front, the middle and the back so that both the removed
      // entry and the entry that takes its place vary.
      const order = [...types.slice(0, 20).reverse(), ...types.slice(30), ...types.slice(20, 30)];
      const remaining = new Set(types);
      for (const type of order) {
        target.removeEventListener(type, listeners.get(type)!);
        remaining.delete(type);
        for (const other of types) target.dispatchEvent(new Event(other));
        expect(calls).toEqual(types.filter(other => remaining.has(other)));
        calls.length = 0;
      }
    }
  });

  test("once listeners and signal-removed listeners with many types", () => {
    const target = new EventTarget();
    const calls: string[] = [];
    const controller = new AbortController();
    for (let i = 0; i < 40; i++) {
      const type = "type" + i;
      if (i % 3 === 0) target.addEventListener(type, () => calls.push(type), { once: true });
      else if (i % 3 === 1) target.addEventListener(type, () => calls.push(type), { signal: controller.signal });
      else target.addEventListener(type, () => calls.push(type));
    }

    for (let i = 0; i < 40; i++) target.dispatchEvent(new Event("type" + i));
    expect(calls).toHaveLength(40);

    calls.length = 0;
    controller.abort();
    for (let i = 0; i < 40; i++) target.dispatchEvent(new Event("type" + i));
    expect(calls).toEqual(Array.from({ length: 40 }, (_, i) => "type" + i).filter((_, i) => i % 3 === 2));
  });
});
