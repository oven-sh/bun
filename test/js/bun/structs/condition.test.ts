import { describe, expect, test } from "bun:test";

describe("Atomics.Condition across workers", () => {
  test("a worker waits and the main thread wakes it", async () => {
    shared struct State {
      ready;
      waiting;
    }
    const state = new State();
    state.ready = false;
    state.waiting = false;
    const mutex = new Atomics.Mutex();
    const cond = new Atomics.Condition();

    const src = `
      self.onmessage = ({ data: { state, mutex, cond } }) => {
        const token = Atomics.Mutex.lock(mutex);
        state.waiting = true;
        while (!state.ready) Atomics.Condition.wait(cond, token);
        token.unlock();
        postMessage("woke");
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const woke = new Promise<string>(resolve => (worker.onmessage = e => resolve(e.data)));
    worker.postMessage({ state, mutex, cond });

    // Wait until the worker holds the condition, then flip the flag under the lock.
    while (!state.waiting) await Bun.sleep(1);
    {
      using _token = Atomics.Mutex.lock(mutex);
      state.ready = true;
      Atomics.Condition.notify(cond);
    }
    expect(await woke).toBe("woke");
    worker.terminate();
  });

  test("waitFor returns the predicate result on timeout", () => {
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    using token = Atomics.Mutex.lock(m);
    expect(Atomics.Condition.waitFor(c, token, 10, () => false)).toBe(false);
    expect(Atomics.Condition.waitFor(c, token, 10, () => true)).toBe(true);
    expect(Atomics.Condition.waitFor(c, token, 10)).toBe(false);
  });

  test("wait requires a Condition and a locked UnlockToken", () => {
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    const token = Atomics.Mutex.lock(m);
    expect(() => Atomics.Condition.wait({} as any, token)).toThrow(TypeError);
    expect(() => Atomics.Condition.wait(c, m as any)).toThrow(TypeError);
    expect(() => Atomics.Condition.wait(c, new Atomics.Mutex.UnlockToken())).toThrow(TypeError);
    token.unlock();
    expect(() => Atomics.Condition.wait(c, token)).toThrow(TypeError);
  });

  test("a blocked worker can be terminated", async () => {
    const mutex = new Atomics.Mutex();
    const token = Atomics.Mutex.lock(mutex);
    const src = `
      self.onmessage = ({ data: mutex }) => {
        postMessage("blocking");
        Atomics.Mutex.lock(mutex);
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const started = new Promise<void>(resolve => (worker.onmessage = () => resolve()));
    worker.postMessage(mutex);
    await started;
    await Bun.sleep(20);
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    worker.terminate();
    await closed;
    token.unlock();
  });
});
