import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

describe("EventTarget addEventListener", () => {
  test("registering N distinct listeners for one type scales linearly", async () => {
    // addEventListener() must check for a duplicate (same callback + capture)
    // before appending. A naive linear scan makes N adds O(N^2). Bun keeps a
    // lazy hash index alongside the listener vector so N adds stay O(N).
    //
    // The subprocess registers N listeners with a 2 s wall-clock budget and
    // reports how far it got. N is sized per build so an O(N) path finishes
    // in well under a second while an O(N^2) path needs tens of seconds.
    const n = isASAN ? 15000 : 200000;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const n = ${n};
          const fns = Array.from({ length: n }, () => () => {});
          const target = new EventTarget();
          const deadline = performance.now() + 2000;
          let i = 0;
          for (; i < n; i++) {
            target.addEventListener("x", fns[i]);
            if ((i & 1023) === 0 && performance.now() > deadline) break;
          }
          console.log(JSON.stringify({ n, registered: i }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const { registered } = JSON.parse(stdout);
    expect(registered).toBe(n);
  });

  test("duplicate detection past the index threshold", () => {
    // Register enough listeners to trip the lazy index, then verify that the
    // spec's duplicate check (same callback + capture) still holds for both a
    // listener registered before the index existed and one registered after.
    const target = new EventTarget();
    let earlyCalls = 0;
    let lateCalls = 0;
    const early = () => earlyCalls++;
    const late = () => lateCalls++;

    target.addEventListener("x", early);
    for (let i = 0; i < 40; i++) target.addEventListener("x", () => {});
    target.addEventListener("x", late);

    target.addEventListener("x", early);
    target.addEventListener("x", late);
    target.addEventListener("x", early, { once: true });
    target.addEventListener("x", late, { passive: true });

    target.dispatchEvent(new Event("x"));
    expect(earlyCalls).toBe(1);
    expect(lateCalls).toBe(1);

    target.dispatchEvent(new Event("x"));
    expect(earlyCalls).toBe(2);
    expect(lateCalls).toBe(2);
  });

  test("same callback with different capture flag is not a duplicate", () => {
    const target = new EventTarget();
    let calls = 0;
    const fn = () => calls++;

    for (let i = 0; i < 40; i++) target.addEventListener("x", () => {});

    target.addEventListener("x", fn, { capture: false });
    target.addEventListener("x", fn, { capture: true });
    target.addEventListener("x", fn, { capture: false });
    target.addEventListener("x", fn, { capture: true });

    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(2);

    target.removeEventListener("x", fn, { capture: true });
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(3);

    target.removeEventListener("x", fn, { capture: false });
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(3);
  });

  test("removeEventListener then addEventListener re-registers past threshold", () => {
    const target = new EventTarget();
    const order: number[] = [];
    const listeners = Array.from({ length: 40 }, (_, i) => () => order.push(i));

    for (const fn of listeners) target.addEventListener("x", fn);

    target.removeEventListener("x", listeners[0]);
    target.removeEventListener("x", listeners[20]);
    target.removeEventListener("x", listeners[39]);

    target.addEventListener("x", listeners[0]);
    target.addEventListener("x", listeners[20]);
    target.addEventListener("x", listeners[39]);
    target.addEventListener("x", listeners[0]);

    target.dispatchEvent(new Event("x"));
    // Removed listeners move to the end; re-adding a duplicate is a no-op.
    const expected = [
      ...Array.from({ length: 40 }, (_, i) => i).filter(i => i !== 0 && i !== 20 && i !== 39),
      0,
      20,
      39,
    ];
    expect(order).toEqual(expected);
  });

  test("removeEventListener for a never-registered callback is a no-op past threshold", () => {
    const target = new EventTarget();
    for (let i = 0; i < 40; i++) target.addEventListener("x", () => {});
    let calls = 0;
    const fn = () => calls++;
    target.removeEventListener("x", fn);
    target.addEventListener("x", fn);
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(1);
  });

  test("handleEvent object listener duplicate detection past threshold", () => {
    const target = new EventTarget();
    for (let i = 0; i < 40; i++) target.addEventListener("x", () => {});

    let calls = 0;
    const obj = { handleEvent: () => calls++ };
    target.addEventListener("x", obj);
    target.addEventListener("x", obj);
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(1);

    target.removeEventListener("x", obj);
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(1);
  });

  test("attribute event listener and addEventListener with same callback are distinct", () => {
    // onabort uses isAttribute=true, addEventListener uses isAttribute=false;
    // both are keyed separately in the index.
    const ac = new AbortController();
    const sig = ac.signal;
    for (let i = 0; i < 40; i++) sig.addEventListener("abort", () => {});

    let calls = 0;
    const fn = () => calls++;
    sig.onabort = fn;
    sig.addEventListener("abort", fn);
    sig.addEventListener("abort", fn);

    sig.onabort = fn;
    sig.addEventListener("abort", fn);

    ac.abort();
    expect(calls).toBe(2);
  });

  test("reassigning an attribute listener then adding the old callback is not a duplicate", () => {
    const ac = new AbortController();
    const sig = ac.signal;
    for (let i = 0; i < 40; i++) sig.addEventListener("abort", () => {});

    let a = 0;
    let b = 0;
    const fnA = () => a++;
    const fnB = () => b++;
    sig.onabort = fnA;
    sig.onabort = fnB;
    sig.addEventListener("abort", fnA);
    sig.addEventListener("abort", fnA);

    ac.abort();
    expect({ a, b }).toEqual({ a: 1, b: 1 });
  });

  test("clearing an attribute listener past threshold removes it", () => {
    const ac = new AbortController();
    const sig = ac.signal;
    for (let i = 0; i < 40; i++) sig.addEventListener("abort", () => {});

    let calls = 0;
    const fn = () => calls++;
    sig.onabort = fn;
    sig.onabort = null;
    sig.addEventListener("abort", fn);
    sig.addEventListener("abort", fn);

    ac.abort();
    expect(calls).toBe(1);
  });

  test("signal-controlled listener removal past threshold", () => {
    const inner = new AbortController();
    const target = new EventTarget();
    for (let i = 0; i < 40; i++) target.addEventListener("x", () => {});

    let calls = 0;
    const fn = () => calls++;
    target.addEventListener("x", fn, { signal: inner.signal });

    inner.abort();
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(0);

    target.addEventListener("x", fn);
    target.addEventListener("x", fn);
    target.dispatchEvent(new Event("x"));
    expect(calls).toBe(1);
  });

  // setAttributeEventListener(null) and the AbortSignal removal algorithm pass
  // the stored listener into removeEventListener without taking an extra Ref,
  // so the listener map's remove() must not touch it after dropping the
  // vector's owning pointer. bmalloc hides this from ASAN by default; Malloc=1
  // routes allocation through the system allocator so the use-after-free is
  // visible.
  test.skipIf(!isASAN)("remove() does not touch a listener the vector solely owned", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const sig = new AbortController().signal;
          for (let i = 0; i < 40; i++) sig.addEventListener("abort", () => {});
          sig.onabort = () => {};
          sig.onabort = null;

          const inner = new AbortController();
          const target = new EventTarget();
          for (let i = 0; i < 40; i++) target.addEventListener("x", () => {});
          target.addEventListener("x", () => {}, { signal: inner.signal });
          inner.abort();

          console.log("ok");
        `,
      ],
      env: { ...bunEnv, Malloc: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });

  test("remove/add churn keeps duplicate detection correct", () => {
    const target = new EventTarget();
    const fns: (() => void)[] = [];
    const calls: number[] = [];
    for (let i = 0; i < 60; i++) {
      const fn = () => calls.push(i);
      fns.push(fn);
      target.addEventListener("x", fn);
    }
    // Remove and re-add the same set repeatedly; the index's stale-key
    // bookkeeping must not let a duplicate through.
    for (let pass = 0; pass < 20; pass++) {
      for (let i = 0; i < 60; i += 3) target.removeEventListener("x", fns[i]);
      for (let i = 0; i < 60; i += 3) {
        target.addEventListener("x", fns[i]);
        target.addEventListener("x", fns[i]);
      }
    }
    target.dispatchEvent(new Event("x"));
    expect(calls.length).toBe(60);
    expect(new Set(calls).size).toBe(60);
  });
});
