import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

  it("does not arm the interval until the iterator is first consumed", async () => {
    // An async iterator that is created but never iterated must not keep the event loop alive.
    // Node arms the underlying interval lazily on the first next() (async generator semantics).
    const src = `
      const { setInterval } = require("node:timers/promises");
      const it = setInterval(100000);
      void it;
      const t = setTimeout(() => { console.log("STILL_ALIVE"); process.exit(1); }, 2000);
      t.unref();
      console.log("created");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("created\n");
    expect(exitCode).toBe(0);
  });

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
