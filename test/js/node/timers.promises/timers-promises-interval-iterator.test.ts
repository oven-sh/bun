/**
 * The async iterator that `setInterval()` of `timers/promises` returns. In Node it is an async generator:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/timers/promises.js#L132-L193
 * So the engine queues the `next()`, `return()` and `throw()` calls and settles each of them in order.
 *
 * This file uses node:test/node:assert so the identical file also runs under `node --test`, which is
 * where every expected value comes from. It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import { describe, test } from "node:test";
import { setInterval as setIntervalPromise } from "node:timers/promises";

// @types/node declares the result as an async iterator on which return() and throw() are optional.
interface IntervalIterator extends AsyncIterableIterator<string> {
  return(value?: unknown): Promise<IteratorResult<string>>;
  throw(error: unknown): Promise<IteratorResult<string>>;
}
const interval = setIntervalPromise as unknown as (...args: unknown[]) => IntervalIterator;

const tick = { value: "tick", done: false };
const done = { value: undefined, done: true };

// Resolves when a second 1 ms interval, started now, fired twice. Timers fire in the order of their
// deadlines, so an interval that was started earlier fired at least one more time by then.
function anotherTickPassed() {
  return new Promise<void>(resolve => {
    let fires = 0;
    const sibling = setInterval(() => {
      if (++fires === 2) {
        clearInterval(sibling);
        resolve();
      }
    }, 1);
  });
}

// How the promise settles and on which microtask tick a reaction of it runs: "fulfilled on tick 2".
// A promise that is already settled gives tick 1.
function settlement(trigger: () => Promise<unknown>) {
  return new Promise<string>((resolve, reject) => {
    let ticks = 0;
    let settled = false;
    const step = () => {
      ticks++;
      if (settled) return;
      if (ticks < 100) Promise.resolve().then(step);
      else reject(new Error("the promise did not settle in 100 ticks"));
    };
    Promise.resolve().then(step);
    const mark = (state: string) => () => {
      settled = true;
      resolve(`${state} on tick ${ticks}`);
    };
    trigger().then(mark("fulfilled"), mark("rejected"));
  });
}

describe("the iterator of timers/promises setInterval() follows the async iterator protocol", () => {
  test("every one of several concurrent next() calls settles", async () => {
    const iterator = interval(1, "tick");
    try {
      assert.deepStrictEqual(await Promise.all([iterator.next(), iterator.next(), iterator.next()]), [
        tick,
        tick,
        tick,
      ]);
    } finally {
      await iterator.return();
    }
  });

  test("return(value) resolves { value, done: true } and closes the iterator", async () => {
    const iterator = interval(1, "tick");
    assert.deepStrictEqual(await iterator.next(), tick);
    assert.deepStrictEqual(await iterator.return("first"), { value: "first", done: true });
    assert.deepStrictEqual(await iterator.return("second"), { value: "second", done: true });
    assert.deepStrictEqual(await iterator.next(), done);
  });

  test("a closed iterator does not give the ticks that fired before return()", async () => {
    const iterator = interval(1, "tick");
    assert.deepStrictEqual(await iterator.next(), tick);
    await anotherTickPassed();
    await iterator.return();
    assert.deepStrictEqual(await iterator.next(), done);
  });

  test("a second for await over the same iterator ends at once", async () => {
    const iterator = interval(1, "tick");
    let first = 0;
    let second = 0;
    for await (const _ of iterator) if (++first === 2) break;
    for await (const _ of iterator) second++;
    assert.deepStrictEqual({ first, second }, { first: 2, second: 0 });
  });

  test("throw(error) rejects with the error and closes the iterator", async () => {
    const iterator = interval(1, "tick");
    try {
      assert.deepStrictEqual(await iterator.next(), tick);
      const error = new Error("thrown into the iterator");
      await assert.rejects(iterator.throw(error), thrown => thrown === error);
      assert.deepStrictEqual(await iterator.next(), done);
    } finally {
      await iterator.return();
    }
  });

  test("return() and throw() wait for the next() that is pending", async () => {
    const returned = interval(1, "tick");
    const beforeReturn = returned.next();
    const fromReturn = returned.return("closed");
    assert.deepStrictEqual(await Promise.all([beforeReturn, fromReturn]), [tick, { value: "closed", done: true }]);

    const thrownInto = interval(1, "tick");
    const beforeThrow = thrownInto.next();
    const error = new Error("thrown into the iterator");
    const fromThrow = thrownInto.throw(error);
    assert.deepStrictEqual(await beforeThrow, tick);
    await assert.rejects(fromThrow, thrown => thrown === error);
  });

  test("return() and throw() before the first next() close the iterator", async () => {
    const returned = interval(1, "tick");
    assert.deepStrictEqual(await returned.return("early"), { value: "early", done: true });
    assert.deepStrictEqual(await returned.next(), done);

    const thrownInto = interval(1, "tick");
    try {
      const error = new Error("thrown into the iterator");
      await assert.rejects(thrownInto.throw(error), thrown => thrown === error);
      assert.deepStrictEqual(await thrownInto.next(), done);
    } finally {
      await thrownInto.return();
    }
  });

  test("an abort rejects the pending next() and ends the next() calls behind it", async () => {
    const controller = new AbortController();
    const iterator = interval(60_000, "tick", { signal: controller.signal });
    const first = iterator.next();
    const second = iterator.next();
    controller.abort();
    await assert.rejects(first, { name: "AbortError", code: "ABORT_ERR" });
    assert.deepStrictEqual(await second, done);
    assert.deepStrictEqual(await iterator.next(), done);
  });

  test("after an abort, one next() rejects and then the iterator is done", async () => {
    const controller = new AbortController();
    const iterator = interval(1, "tick", { signal: controller.signal });
    assert.deepStrictEqual(await iterator.next(), tick);
    controller.abort();
    // A tick that fired before the abort is still delivered first.
    let result: PromiseSettledResult<IteratorResult<string>>;
    do {
      [result] = await Promise.allSettled([iterator.next()]);
    } while (result.status === "fulfilled" && result.value.done === false);
    assert.deepStrictEqual(
      { status: result.status, name: result.status === "rejected" && result.reason.name },
      { status: "rejected", name: "AbortError" },
    );
    assert.deepStrictEqual(await iterator.next(), done);
  });

  test("an invalid argument rejects the first next() and then the iterator is done", async () => {
    const invalid: [string, unknown[]][] = [
      ["delay", ["1"]],
      ["options", [1, "tick", "options"]],
      ["options.signal", [1, "tick", { signal: "signal" }]],
      ["options.ref", [1, "tick", { ref: "ref" }]],
    ];
    for (const [name, args] of invalid) {
      const iterator = interval(...args);
      await assert.rejects(iterator.next(), { code: "ERR_INVALID_ARG_TYPE" }, name);
      assert.deepStrictEqual(await iterator.next(), done, name);
    }
  });

  test("setInterval is an async generator function and the iterator is its generator object", async () => {
    const iterator = interval(1, "tick");
    try {
      assert.deepStrictEqual(
        {
          function: Object.prototype.toString.call(interval),
          length: interval.length,
          iterator: Object.prototype.toString.call(iterator),
          ownKeys: Reflect.ownKeys(iterator),
          methods: [typeof iterator.next, typeof iterator.return, typeof iterator.throw],
          isItsOwnAsyncIterator: iterator[Symbol.asyncIterator]() === iterator,
        },
        {
          function: "[object AsyncGeneratorFunction]",
          length: 2,
          iterator: "[object AsyncGenerator]",
          ownKeys: [],
          methods: ["function", "function", "function"],
          isItsOwnAsyncIterator: true,
        },
      );
    } finally {
      await iterator.return();
    }
  });

  test("each call settles on the same microtask tick as in Node", async () => {
    const buffered = interval(1, "tick");
    await buffered.next();
    await anotherTickPassed();
    const bufferedTick = await settlement(() => buffered.next());
    const returned = await settlement(() => buffered.return("closed"));
    const nextAfterReturn = await settlement(() => buffered.next());

    const thrownInto = interval(1, "tick");
    await thrownInto.next();
    const thrown = await settlement(() => thrownInto.throw(new Error("thrown into the iterator")));

    const controller = new AbortController();
    const aborted = interval(60_000, "tick", { signal: controller.signal });
    const abortedNext = await settlement(() => {
      const pending = aborted.next();
      controller.abort();
      return pending;
    });
    const nextAfterAbort = await settlement(() => aborted.next());

    assert.deepStrictEqual(
      { bufferedTick, returned, nextAfterReturn, thrown, abortedNext, nextAfterAbort },
      {
        bufferedTick: "fulfilled on tick 2",
        returned: "fulfilled on tick 2",
        nextAfterReturn: "fulfilled on tick 1",
        thrown: "rejected on tick 1",
        abortedNext: "rejected on tick 4",
        nextAfterAbort: "fulfilled on tick 1",
      },
    );
  });
});
