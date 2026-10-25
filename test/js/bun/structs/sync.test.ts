import { describe, expect, test } from "bun:test";

// https://github.com/tc39/proposal-structs: Atomics.Mutex and Atomics.Condition.

describe("Atomics.Mutex", () => {
  test("lock returns a reusable unlock token", () => {
    const m = new Atomics.Mutex();
    const token = Atomics.Mutex.lock(m);
    expect(Atomics.Mutex.lockIfAvailable(m, 0)).toBeNull();
    expect(token.locked).toBe(true);
    expect(token.unlock()).toBe(true);
    expect(token.unlock()).toBe(false);
    const reused = new Atomics.Mutex.UnlockToken();
    expect(Atomics.Mutex.lock(m, reused)).toBe(reused);
    expect(() => Atomics.Mutex.lock(m, reused)).toThrow(TypeError);
    expect(() => Atomics.Mutex.lock(m, {} as any)).toThrow(TypeError);
    expect(reused[Symbol.dispose]()).toBeUndefined();
    const again = Atomics.Mutex.lockIfAvailable(m, 0);
    expect(again).not.toBeNull();
    again!.unlock();
  });

  test("Symbol.dispose unlocks", () => {
    const m = new Atomics.Mutex();
    {
      using _token = Atomics.Mutex.lock(m);
      expect(Atomics.Mutex.lockIfAvailable(m, 0)).toBeNull();
    }
    expect(Atomics.Mutex.lockIfAvailable(m, 0)).not.toBeNull();
  });

  test("shared structs and mutexes cross workers by reference", async () => {
    shared struct Counter {
      n;
    }
    const counter = new Counter();
    counter.n = 0;
    const mutex = new Atomics.Mutex();
    const src = `
      self.onmessage = ({ data: { counter, mutex } }) => {
        for (let i = 0; i < 1000; i++) {
          using _t = Atomics.Mutex.lock(mutex);
          counter.n = counter.n + 1;
        }
        postMessage("done");
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const workers = Array.from({ length: 4 }, () => new Worker(url));
    const done = workers.map(
      w =>
        new Promise<void>(resolve => {
          w.onmessage = () => resolve();
        }),
    );
    for (const w of workers) w.postMessage({ counter, mutex });
    await Promise.all(done);
    for (const w of workers) w.terminate();
    expect(counter.n).toBe(4000);
  });
});

describe("Atomics.Condition", () => {
  test("waitFor times out and reports false", () => {
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    using token = Atomics.Mutex.lock(m);
    expect(Atomics.Condition.waitFor(c, token, 10)).toBe(false);
  });

  test("notify with no waiters wakes none", () => {
    const c = new Atomics.Condition();
    expect(Atomics.Condition.notify(c)).toBe(0);
  });
});
