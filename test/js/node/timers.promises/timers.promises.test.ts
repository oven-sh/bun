import { describe, expect, it } from "bun:test";
import { setImmediate, setInterval, setTimeout } from "node:timers/promises";

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

  // abort() runs the listener synchronously, so the short delay can never win the
  // race: it only exists so a build that ignores the abort resolves and fails the
  // assertion rather than leaving the promise pending forever.
  it("rejects even when another listener stopped propagation", async () => {
    const abortController = new AbortController();
    abortController.signal.addEventListener("abort", e => e.stopImmediatePropagation());

    const promise = setTimeout(1, "not-aborted", { signal: abortController.signal });
    abortController.abort();

    await expect(promise).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
  });

  // A call takes at most 0x100000 arguments in JSC. A spread of this array throws a RangeError.
  it("resolves to an array too long to pass as call arguments", async () => {
    const value = new Array(0x100000 + 1).fill(0);
    const resolved = await setTimeout(1, value);
    expect(resolved === value).toBe(true);
  });

  it("does not read the value before the promise resolves", async () => {
    const traps: string[] = [];
    const value = new Proxy([1, 2, 3], {
      get(target, key, receiver) {
        traps.push(`get ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      has(target, key) {
        traps.push(`has ${String(key)}`);
        return Reflect.has(target, key);
      },
    });

    const promise = setTimeout(1, value);
    expect(traps).toEqual([]);

    expect(await promise).toBe(value);
    // A promise that resolves to an object looks up `then` on it. Nothing else reads the value.
    expect(traps).toEqual(["get then"]);
  });

  it("does not throw for a revoked Proxy value", async () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    const promise = setTimeout(1, proxy);
    // The promise rejects when it resolves to the proxy: the lookup of `then` throws.
    await expect(promise).rejects.toBeInstanceOf(TypeError);
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

  it("rejects even when another listener stopped propagation", async () => {
    const abortController = new AbortController();
    abortController.signal.addEventListener("abort", e => e.stopImmediatePropagation());

    const promise = setImmediate("not-aborted", { signal: abortController.signal });
    abortController.abort();

    await expect(promise).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
  });
});

// node rejects with its own AbortError class (lib/internal/errors.js), whose
// default message has no trailing period. The DOMException stored in
// signal.reason keeps the WebIDL text with the period; it is only the cause.
describe("AbortError shape matches node", () => {
  function nodeAbortError(signal: AbortSignal) {
    return {
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The operation was aborted",
      cause: signal.reason,
    };
  }

  async function shapeOf(promise: Promise<unknown>) {
    const err: any = await promise.then(
      () => {
        throw new Error("expected a rejection");
      },
      e => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DOMException);
    return { name: err.name, code: err.code, message: err.message, cause: err.cause };
  }

  it("setTimeout with an already aborted signal", async () => {
    const signal = AbortSignal.abort();
    expect(await shapeOf(setTimeout(10, undefined, { signal }))).toEqual(nodeAbortError(signal));
    expect(signal.reason.message).toBe("The operation was aborted.");
  });

  it("setTimeout aborted while pending", async () => {
    const controller = new AbortController();
    const promise = setTimeout(10_000, undefined, { signal: controller.signal });
    controller.abort();
    expect(await shapeOf(promise)).toEqual(nodeAbortError(controller.signal));
  });

  it("setTimeout aborted with a custom reason", async () => {
    const reason = new Error("custom reason");
    const signal = AbortSignal.abort(reason);
    expect(await shapeOf(setTimeout(10, undefined, { signal }))).toEqual({ ...nodeAbortError(signal), cause: reason });
  });

  it("setImmediate with an already aborted signal", async () => {
    const signal = AbortSignal.abort();
    expect(await shapeOf(setImmediate(undefined, { signal }))).toEqual(nodeAbortError(signal));
  });

  it("setInterval with an already aborted signal", async () => {
    const signal = AbortSignal.abort();
    const iterate = (async () => {
      for await (const _ of setInterval(1, undefined, { signal })) break;
    })();
    expect(await shapeOf(iterate)).toEqual(nodeAbortError(signal));
  });
});

describe("setInterval", () => {
  it("ends the iterator even when another listener stopped propagation", async () => {
    const abortController = new AbortController();
    abortController.signal.addEventListener("abort", e => e.stopImmediatePropagation());

    const iterator = setInterval(1, "tick", { signal: abortController.signal })[Symbol.asyncIterator]();
    try {
      const next = iterator.next();
      abortController.abort();

      await expect(next).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
    } finally {
      // On a build that ignores the abort the interval is still armed; clear it.
      await iterator.return!();
    }
  });
});
