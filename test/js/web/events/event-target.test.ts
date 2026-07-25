import { describe, expect, test } from "bun:test";
import { getEventListeners, listenerCount } from "node:events";

describe("EventTarget {once:true}", () => {
  test("fires each once-listener exactly once, in order, and removes them", () => {
    const et = new EventTarget();
    let calls = 0;
    const order: number[] = [];
    for (let i = 0; i < 50; i++) {
      const n = i;
      et.addEventListener(
        "z",
        () => {
          calls++;
          order.push(n);
        },
        { once: true },
      );
    }
    et.dispatchEvent(new Event("z"));
    expect(calls).toBe(50);
    expect(order).toEqual(Array.from({ length: 50 }, (_, i) => i));

    et.dispatchEvent(new Event("z"));
    expect(calls).toBe(50);
  });

  test("non-once listeners survive alongside once listeners", () => {
    const et = new EventTarget();
    let plain = 0;
    let once = 0;
    et.addEventListener("z", () => plain++);
    for (let i = 0; i < 20; i++) et.addEventListener("z", () => once++, { once: true });
    et.addEventListener("z", () => plain++);

    et.dispatchEvent(new Event("z"));
    expect({ plain, once }).toEqual({ plain: 2, once: 20 });

    et.dispatchEvent(new Event("z"));
    expect({ plain, once }).toEqual({ plain: 4, once: 20 });
  });

  test("re-adding inside a once-callback registers a fresh listener", () => {
    const et = new EventTarget();
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls === 1) et.addEventListener("z", fn, { once: true });
    };
    et.addEventListener("z", fn, { once: true });

    et.dispatchEvent(new Event("z"));
    expect(calls).toBe(1);

    et.dispatchEvent(new Event("z"));
    expect(calls).toBe(2);

    et.dispatchEvent(new Event("z"));
    expect(calls).toBe(2);
  });

  test("stopImmediatePropagation leaves unfired once-listeners in place", () => {
    const et = new EventTarget();
    let a = 0;
    let b = 0;
    et.addEventListener(
      "z",
      e => {
        a++;
        e.stopImmediatePropagation();
      },
      { once: true },
    );
    et.addEventListener("z", () => b++, { once: true });

    et.dispatchEvent(new Event("z"));
    expect({ a, b }).toEqual({ a: 1, b: 0 });

    et.dispatchEvent(new Event("z"));
    expect({ a, b }).toEqual({ a: 1, b: 1 });
  });

  test("removeEventListener from inside a once-callback skips a later listener", () => {
    const et = new EventTarget();
    let a = 0;
    let b = 0;
    const later = () => b++;
    et.addEventListener(
      "z",
      () => {
        a++;
        et.removeEventListener("z", later);
      },
      { once: true },
    );
    et.addEventListener("z", later, { once: true });

    et.dispatchEvent(new Event("z"));
    expect({ a, b }).toEqual({ a: 1, b: 0 });

    et.dispatchEvent(new Event("z"));
    expect({ a, b }).toEqual({ a: 1, b: 0 });
  });

  test("nested dispatch inside a once-callback fires remaining once-listeners once", () => {
    const et = new EventTarget();
    const order: string[] = [];
    et.addEventListener(
      "z",
      () => {
        order.push("a");
        et.dispatchEvent(new Event("z"));
      },
      { once: true },
    );
    et.addEventListener("z", () => order.push("b"), { once: true });
    et.addEventListener("z", () => order.push("c"), { once: true });

    et.dispatchEvent(new Event("z"));
    expect(order).toEqual(["a", "b", "c"]);

    et.dispatchEvent(new Event("z"));
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("listenerCount/getEventListeners inside a once-handler do not see already-fired listeners", () => {
    const t = new EventTarget();
    t.addEventListener("x", () => {}, { once: true });
    t.addEventListener("x", () => {}, { once: true });
    let during: { count: number; list: number } | undefined;
    t.addEventListener(
      "x",
      () => {
        during = { count: listenerCount(t, "x"), list: getEventListeners(t, "x").length };
      },
      { once: true },
    );
    t.dispatchEvent(new Event("x"));
    expect({ during, after: listenerCount(t, "x") }).toEqual({ during: { count: 0, list: 0 }, after: 0 });
  });

  test("AbortSignal fires many once-listeners on abort", () => {
    const ac = new AbortController();
    let calls = 0;
    for (let i = 0; i < 200; i++) {
      ac.signal.addEventListener("abort", () => calls++, { once: true });
    }
    ac.abort();
    expect(calls).toBe(200);
    expect(ac.signal.aborted).toBe(true);
  });
});
