import { describe, expect, it } from "bun:test";
import { scheduler, setImmediate, setInterval, setTimeout } from "node:timers/promises";

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
});

// In node (lib/timers/promises.js) `scheduler` is the only instance of a Scheduler class:
// the constructor throws, and yield()/wait() are prototype methods that check their receiver.
describe("scheduler", () => {
  const Scheduler = scheduler.constructor as new () => object;
  const SchedulerPrototype = Object.getPrototypeOf(scheduler);

  const illegalConstructor = { name: "TypeError", code: "ERR_ILLEGAL_CONSTRUCTOR", message: "Illegal constructor" };
  const invalidThis = {
    name: "TypeError",
    code: "ERR_INVALID_THIS",
    message: 'Value of "this" must be of type Scheduler',
  };

  function thrownBy(fn: () => unknown) {
    try {
      fn();
    } catch (error: any) {
      expect(error).toBeInstanceOf(TypeError);
      return { name: error.name, code: error.code, message: error.message };
    }
    throw new Error("expected a synchronous throw");
  }

  it("is an instance of a Scheduler class whose constructor throws ERR_ILLEGAL_CONSTRUCTOR", () => {
    expect(Scheduler.name).toBe("Scheduler");
    expect(scheduler).toBeInstanceOf(Scheduler);
    expect(thrownBy(() => new Scheduler())).toEqual(illegalConstructor);
  });

  it("cannot be instantiated through a subclass or Reflect.construct either", () => {
    class Sub extends Scheduler {}
    expect(thrownBy(() => new Sub())).toEqual(illegalConstructor);
    expect(thrownBy(() => Reflect.construct(Scheduler, [], class {}))).toEqual(illegalConstructor);
  });

  it("inherits yield() and wait() from Scheduler.prototype", () => {
    expect(Object.keys(scheduler)).toEqual([]);
    expect(Object.getOwnPropertyNames(SchedulerPrototype)).toEqual(["constructor", "yield", "wait"]);
    expect([scheduler.yield.name, scheduler.yield.length, scheduler.wait.name, scheduler.wait.length]).toEqual([
      "yield",
      0,
      "wait",
      2,
    ]);
    expect(scheduler.yield).not.toBe(setImmediate);
  });

  it("yield() and wait() throw ERR_INVALID_THIS synchronously for a receiver that is not the scheduler", () => {
    const { yield: yieldFn, wait } = scheduler;
    for (const receiver of [{}, Object.create(SchedulerPrototype), "scheduler", 1]) {
      expect(thrownBy(() => yieldFn.call(receiver))).toEqual(invalidThis);
      expect(thrownBy(() => wait.call(receiver, 1))).toEqual(invalidThis);
    }
  });

  // Node reads this[kScheduler] unguarded, so a nullish receiver (including an unbound call)
  // surfaces as the engine's own TypeError with no code rather than ERR_INVALID_THIS.
  it("yield() and wait() throw a plain TypeError for a null or undefined receiver, as in node", () => {
    const { yield: yieldFn, wait } = scheduler;
    for (const receiver of [null, undefined]) {
      const [yieldError, waitError] = [thrownBy(() => yieldFn.call(receiver)), thrownBy(() => wait.call(receiver, 1))];
      expect([yieldError.name, yieldError.code, waitError.name, waitError.code]).toEqual([
        "TypeError",
        undefined,
        "TypeError",
        undefined,
      ]);
    }
  });

  it("yield() and wait() resolve for the scheduler itself and for objects inheriting from it", async () => {
    const inheriting = Object.create(scheduler);
    expect(
      await Promise.all([
        scheduler.yield(),
        scheduler.wait(1),
        scheduler.yield.call(scheduler),
        scheduler.wait.call(scheduler, 1),
        inheriting.yield(),
        inheriting.wait(1),
      ]),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("yield() ignores its arguments instead of forwarding them to setImmediate()", async () => {
    const yieldWithArgs = scheduler.yield as (...args: unknown[]) => Promise<unknown>;
    expect(await yieldWithArgs.call(scheduler, "value")).toBeUndefined();
    expect(await yieldWithArgs.call(scheduler, undefined, { signal: AbortSignal.abort() })).toBeUndefined();
  });

  it("wait() forwards delay and options to setTimeout()", async () => {
    const controller = new AbortController();
    const pending = scheduler.wait(100_000, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(
      expect.objectContaining({ name: "AbortError", code: "ABORT_ERR", cause: controller.signal.reason }),
    );

    const reason = new Error("custom reason");
    await expect(scheduler.wait(1, { signal: AbortSignal.abort(reason) })).rejects.toThrow(
      expect.objectContaining({ name: "AbortError", code: "ABORT_ERR", cause: reason }),
    );

    await expect(scheduler.wait("1" as any)).rejects.toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
    );
    await expect(scheduler.wait(1, null as any)).rejects.toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});
