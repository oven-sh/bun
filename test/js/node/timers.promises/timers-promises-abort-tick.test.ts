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
import {
  setImmediate as immediate,
  setInterval as interval,
  scheduler,
  setTimeout as sleep,
} from "node:timers/promises";

// [name, start a timer on the signal, the tick of its abort rejection in Node v26.3.0]
const timers: [string, (signal: AbortSignal) => Promise<unknown>, number][] = [
  ["setTimeout()", signal => sleep(60_000, undefined, { signal }), 6],
  ["setImmediate()", signal => immediate(undefined, { signal }), 6],
  ["scheduler.wait()", signal => scheduler.wait(60_000, { signal }), 6],
  ["setInterval().next()", signal => interval(60_000, undefined, { signal })[Symbol.asyncIterator]().next(), 4],
];

// Microtask ticks only. A turn of the event loop would run the immediate before abort().
async function microtaskTicks() {
  for (let i = 0; i < 10; i++) await undefined;
}

// The microtask tick on which a reaction of the promise runs. A Promise.resolve().then() chain counts
// the ticks. It starts before `trigger` runs, so a promise that is already settled gives tick 1.
function tickOf(trigger: () => Promise<unknown>) {
  return new Promise<number>(resolve => {
    let tick = 0;
    let settled = false;
    const step = () => {
      tick++;
      // The limit ends the chain if nothing settles.
      if (!settled && tick < 100) Promise.resolve().then(step);
    };
    Promise.resolve().then(step);
    const mark = () => {
      settled = true;
      resolve(tick);
    };
    trigger().then(mark, mark);
  });
}

describe("an aborted timers/promises promise rejects on the same tick as in Node", () => {
  for (const [name, start, tick] of timers) {
    test(`${name}: tick ${tick}`, async () => {
      const sameTurnController = new AbortController();
      const sameTurn = await tickOf(() => {
        const promise = start(sameTurnController.signal);
        sameTurnController.abort();
        return promise;
      });

      const laterController = new AbortController();
      const pending = start(laterController.signal);
      await microtaskTicks();
      const later = await tickOf(() => {
        laterController.abort();
        return pending;
      });

      const alreadyAborted = await tickOf(() => start(AbortSignal.abort()));

      assert.deepStrictEqual({ sameTurn, later, alreadyAborted }, { sameTurn: tick, later: tick, alreadyAborted: 1 });
    });
  }
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
