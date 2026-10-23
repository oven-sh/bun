/**
 * util.aborted() was a plain function, so an invalid argument threw at the call. Node declares it
 * `async`: every error rejects the returned promise, the function is an AsyncFunction, and a valid
 * call settles 2 or 3 microtask ticks after the abort:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/abort_controller.js#L607-L616
 *
 * This file uses node:test/node:assert so the identical file also runs under `node --test`, which is
 * where the expected values come from. It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import { describe, test } from "node:test";
import { aborted, inspect, types } from "node:util";
import { microtaskTicks, settlement, timers } from "../promise-settlement-tick.ts";

describe("util.aborted() rejects the promise and does not throw", () => {
  test("for an invalid signal", async () => {
    for (const signal of [{}, null, undefined, Symbol(), [], 1, 0, 1n, true, false, "a", () => {}]) {
      const promise = aborted(signal as any, {});
      assert.ok(promise instanceof Promise);
      await assert.rejects(promise, { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
    }
  });

  test("for an invalid resource", async () => {
    const signal = new AbortController().signal;
    const resources: [unknown, string][] = [
      [null, "null"],
      [undefined, "undefined"],
      [0, "type number (0)"],
      [1, "type number (1)"],
      [0n, "type bigint (0n)"],
      [1n, "type bigint (1n)"],
      [Symbol(), "type symbol (Symbol())"],
      ["", "type string ('')"],
      ["a", "type string ('a')"],
    ];
    for (const [resource, received] of resources) {
      const promise = aborted(signal, resource as any);
      assert.ok(promise instanceof Promise);
      await assert.rejects(promise, {
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "resource" argument must be of type object. Received ${received}`,
      });
    }
  });

  test("for an error after the argument checks", async () => {
    // Node v26.3.0 runs this trap in its check of the signal. Later versions reject the proxy before they run it.
    const trap = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("getPrototypeOf trap");
        },
      },
    );
    // This object passes the check. Then the `aborted` getter throws, because it is not an AbortSignal.
    const notASignal = Object.create(AbortSignal.prototype);
    const throwingSignal = new AbortController().signal;
    throwingSignal.addEventListener = () => {
      throw new Error("addEventListener");
    };

    const promises = [trap, notASignal, throwingSignal].map(signal => aborted(signal, {}));
    assert.ok(promises.every(promise => promise instanceof Promise));
    await assert.rejects(promises[0], Error);
    await assert.rejects(promises[1], { name: "TypeError" });
    await assert.rejects(promises[2], { name: "Error", message: "addEventListener" });
  });
});

test("util.aborted is an async function", () => {
  assert.strictEqual(inspect(aborted), "[AsyncFunction: aborted]");
  assert.strictEqual(types.isAsyncFunction(aborted), true);
  assert.throws(() => new (aborted as any)(new AbortController().signal, {}), /is not a constructor/);
});

test("util.aborted() settles on the same tick as in Node", async () => {
  const resource = {};
  const invalid = await settlement(() => aborted({} as any, resource));
  const alreadyAborted = await settlement(() => aborted(AbortSignal.abort(), resource));

  const sameTurnController = new AbortController();
  const sameTurn = await settlement(() => {
    const promise = aborted(sameTurnController.signal, resource);
    sameTurnController.abort();
    return promise;
  });

  const laterController = new AbortController();
  const pending = aborted(laterController.signal, resource);
  await microtaskTicks();
  const later = await settlement(() => {
    laterController.abort();
    return pending;
  });

  assert.deepStrictEqual(
    { invalid, alreadyAborted, sameTurn, later },
    {
      invalid: "rejected on tick 1",
      alreadyAborted: "fulfilled on tick 3",
      sameTurn: "fulfilled on tick 3",
      later: "fulfilled on tick 2",
    },
  );
});

test("a call after abort() does not settle before a call that waited for the abort", async () => {
  const ac = new AbortController();
  const resource = {};
  const order: string[] = [];
  const before = aborted(ac.signal, resource).then(() => order.push("called before abort()"));
  ac.abort();
  const after = aborted(ac.signal, resource).then(() => order.push("called after abort()"));
  await Promise.all([before, after]);
  assert.deepStrictEqual(order, ["called before abort()", "called after abort()"]);
});

// Each of these promises rejects with an AbortError when its signal aborts. util.aborted() settles first,
// so a Promise.race() of the two on the same signal fulfils.
describe("util.aborted() settles before a timers/promises promise on the same signal rejects", () => {
  for (const [name, start] of timers) {
    for (const position of ["first", "second"]) {
      for (const timing of ["in the same turn", "later"]) {
        test(`${name}: aborted() is called ${position}, abort() comes ${timing}`, async () => {
          const ac = new AbortController();
          const resource = {};
          const viaAborted = () => aborted(ac.signal, resource).then(() => "aborted() fulfilled");
          const viaTimer = () => start(ac.signal).then(() => "the timer fulfilled");
          const [first, second] = position === "first" ? [viaAborted(), viaTimer()] : [viaTimer(), viaAborted()];
          if (timing === "later") await microtaskTicks();
          ac.abort();

          assert.strictEqual(await Promise.race([first, second]), "aborted() fulfilled");
          await assert.rejects(position === "first" ? second : first, { name: "AbortError", code: "ABORT_ERR" });
        });
      }

      test(`${name}: aborted() is called after abort(), ${position} in the race`, async () => {
        const ac = new AbortController();
        const timer = start(ac.signal).then(() => "the timer fulfilled");
        ac.abort();
        const viaAborted = aborted(ac.signal, {}).then(() => "aborted() fulfilled");

        const race = position === "first" ? [viaAborted, timer] : [timer, viaAborted];
        assert.strictEqual(await Promise.race(race), "aborted() fulfilled");
        await assert.rejects(timer, { name: "AbortError", code: "ABORT_ERR" });
      });
    }
  }
});
