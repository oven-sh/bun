/**
 * A `timers/promises` promise rejected too early after its signal aborted: 2 microtask ticks after the
 * abort. Node takes 6 ticks for `setTimeout()`, `setImmediate()` and `scheduler.wait()`, and 4 ticks for
 * `setInterval().next()`:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/timers/promises.js#L88-L91
 * https://github.com/nodejs/node/blob/v26.3.0/lib/timers/promises.js#L168-L175
 * `events.once(signal, "abort")` settles on tick 2 or 3. So in Node, a `Promise.race()` of `once()` and
 * a timer on the same signal fulfils. In Bun 1.4, the race rejected with the AbortError of the timer.
 *
 * This file uses node:test/node:assert so the identical file also runs under `node --test`, which is
 * where the expected ticks and race results come from. It cannot import from "harness" for the same
 * reason.
 */
import assert from "node:assert";
import { once } from "node:events";
import { describe, test } from "node:test";
import { setInterval as interval } from "node:timers/promises";
import { microtaskTicks, settlement, timers } from "../promise-settlement-tick.ts";

describe("an aborted timers/promises promise rejects on the same tick as in Node", () => {
  for (const [name, start, tick] of timers) {
    test(`${name}: tick ${tick}`, async () => {
      const sameTurnController = new AbortController();
      const sameTurn = await settlement(() => {
        const promise = start(sameTurnController.signal);
        sameTurnController.abort();
        return promise;
      });

      const laterController = new AbortController();
      const pending = start(laterController.signal);
      await microtaskTicks();
      const later = await settlement(() => {
        laterController.abort();
        return pending;
      });

      const alreadyAborted = await settlement(() => start(AbortSignal.abort()));

      assert.deepStrictEqual(
        { sameTurn, later, alreadyAborted },
        {
          sameTurn: `rejected on tick ${tick}`,
          later: `rejected on tick ${tick}`,
          alreadyAborted: "rejected on tick 1",
        },
      );
    });
  }

  test("setInterval().next() that is called after the abort: tick 1", async () => {
    const beforeFirstNext = new AbortController();
    const fresh = interval(60_000, undefined, { signal: beforeFirstNext.signal })[Symbol.asyncIterator]();
    beforeFirstNext.abort();

    const afterOneValue = new AbortController();
    const started = interval(1, "value", { signal: afterOneValue.signal })[Symbol.asyncIterator]();
    assert.deepStrictEqual(await started.next(), { done: false, value: "value" });
    afterOneValue.abort();

    assert.deepStrictEqual(
      { beforeFirstNext: await settlement(() => fresh.next()), afterOneValue: await settlement(() => started.next()) },
      { beforeFirstNext: "rejected on tick 1", afterOneValue: "rejected on tick 1" },
    );
  });
});

describe('events.once(signal, "abort") settles before a timer on the same signal rejects', () => {
  for (const [name, start] of timers) {
    for (const position of ["first", "second"]) {
      for (const timing of ["in the same turn", "later"]) {
        test(`${name}: once() is called ${position}, abort() comes ${timing}`, async () => {
          const ac = new AbortController();
          const viaOnce = () => once(ac.signal, "abort").then(() => "once() fulfilled");
          const viaTimer = () => start(ac.signal).then(() => "the timer fulfilled");
          const [first, second] = position === "first" ? [viaOnce(), viaTimer()] : [viaTimer(), viaOnce()];
          if (timing === "later") await microtaskTicks();
          ac.abort();

          assert.strictEqual(await Promise.race([first, second]), "once() fulfilled");
          await assert.rejects(position === "first" ? second : first, { name: "AbortError", code: "ABORT_ERR" });
        });
      }
    }
  }
});
