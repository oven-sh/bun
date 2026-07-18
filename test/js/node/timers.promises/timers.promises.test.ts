import { describe, expect, it } from "bun:test";
import { setImmediate, setInterval, setTimeout } from "node:timers/promises";

const bound = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p.then(
      v => ["settled", v] as const,
      e => ["rejected", e] as const,
    ),
    setTimeout(ms, ["TIMEOUT"] as const),
  ]);

describe("setTimeout", () => {
  it("abort() does not emit global error", async () => {
    let unhandledRejectionCaught = false;

    const catchUnhandledRejection = () => {
      unhandledRejectionCaught = true;
    };
    process.on("unhandledRejection", catchUnhandledRejection);

    const c = new AbortController();

    global.setTimeout(() => c.abort());

    await setTimeout(100, undefined, { signal: c.signal }).catch(() => "aborted");

    // let unhandledRejection to be fired
    await setTimeout(100);

    process.off("unhandledRejection", catchUnhandledRejection);

    expect(c.signal.aborted).toBe(true);
    expect(unhandledRejectionCaught).toBe(false);
  });

  it("AbortController can be passed as the `options` argument", () => {
    expect(async () => await setTimeout(0, undefined, new AbortController())).not.toThrow();
  });

  it("should reject promise when AbortController is aborted", async () => {
    const abortController = new AbortController();
    const promise = setTimeout(100, undefined, abortController);
    abortController.abort();

    await expect(promise).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(abortController.signal.aborted).toBe(true);
  });
});

describe("setInterval async iterator", () => {
  it("settles every concurrent next() call", async () => {
    const it = setInterval(10, "tick");
    try {
      const first = it.next();
      const second = it.next();
      const third = it.next();
      expect(await bound(first, 500)).toEqual(["settled", { done: false, value: "tick" }]);
      expect(await bound(second, 500)).toEqual(["settled", { done: false, value: "tick" }]);
      expect(await bound(third, 500)).toEqual(["settled", { done: false, value: "tick" }]);
    } finally {
      await it.return();
    }
  });

  it("return(value) resolves { value, done: true }", async () => {
    const it = setInterval(10, "x");
    await it.next();
    expect(await it.return("RV")).toEqual({ value: "RV", done: true });
    expect(await it.return("again")).toEqual({ value: "again", done: true });
  });

  it("next() after return() resolves { done: true }", async () => {
    const it = setInterval(10, "x");
    await it.next();
    await it.return();
    expect(await bound(it.next(), 500)).toEqual(["settled", { value: undefined, done: true }]);
  });

  it("next() after return() does not yield buffered ticks", async () => {
    const it = setInterval(1, "buf");
    await it.next();
    await it.next();
    await setTimeout(50);
    await it.return();
    expect(await bound(it.next(), 500)).toEqual(["settled", { value: undefined, done: true }]);
  });

  it("second for-await over the same iterator completes immediately", async () => {
    const it = setInterval(10, "y");
    let count = 0;
    for await (const _ of it) {
      if (++count >= 2) break;
    }
    expect(count).toBe(2);
    let count2 = 0;
    const loop = (async () => {
      for await (const _ of it) count2++;
    })();
    expect(await bound(loop, 500)).toEqual(["settled", undefined]);
    expect(count2).toBe(0);
  });

  it("has a throw() method that rejects and closes the iterator", async () => {
    const it = setInterval(10, "x");
    expect(typeof it.throw).toBe("function");
    await it.next();
    const err = new Error("boom");
    const r = await bound(it.throw(err), 500);
    expect(r[0]).toBe("rejected");
    expect(r[1]).toBe(err);
    expect(await bound(it.next(), 500)).toEqual(["settled", { value: undefined, done: true }]);
  });

  it("abort rejects a pending next() and subsequent next() resolves done", async () => {
    const ac = new AbortController();
    const it = setInterval(100, "tick", { signal: ac.signal });
    const p = it.next();
    ac.abort();
    const r = await bound(p, 500);
    expect(r[0]).toBe("rejected");
    expect((r[1] as Error).name).toBe("AbortError");
    expect(await bound(it.next(), 500)).toEqual(["settled", { value: undefined, done: true }]);
  });
});

describe("setImmediate", () => {
  it("abort() does not emit global error", async () => {
    let unhandledRejectionCaught = false;

    const catchUnhandledRejection = () => {
      unhandledRejectionCaught = true;
    };
    process.on("unhandledRejection", catchUnhandledRejection);

    const c = new AbortController();

    global.setImmediate(() => c.abort());

    await setImmediate(undefined, { signal: c.signal }).catch(() => "aborted");

    // let unhandledRejection to be fired
    await setTimeout(100);

    process.off("unhandledRejection", catchUnhandledRejection);

    expect(c.signal.aborted).toBe(true);
    expect(unhandledRejectionCaught).toBe(false);
  });
});
