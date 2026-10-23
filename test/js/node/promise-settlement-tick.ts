/**
 * Helpers for tests that compare the microtask tick of a promise with Node. They use only Node
 * APIs, so a test file that imports them also runs under `node --test`.
 */
import {
  setImmediate as immediate,
  setInterval as interval,
  scheduler,
  setTimeout as sleep,
} from "node:timers/promises";

// [name, start a timer on the signal, the tick of its abort rejection in Node v26.3.0]
export const timers: [string, (signal: AbortSignal) => Promise<unknown>, number][] = [
  ["setTimeout()", signal => sleep(60_000, undefined, { signal }), 6],
  ["setImmediate()", signal => immediate(undefined, { signal }), 6],
  ["scheduler.wait()", signal => scheduler.wait(60_000, { signal }), 6],
  ["setInterval().next()", signal => interval(60_000, undefined, { signal })[Symbol.asyncIterator]().next(), 4],
];

// Microtask ticks only. A turn of the event loop would run the immediate before abort().
export async function microtaskTicks() {
  for (let i = 0; i < 10; i++) await undefined;
}

// How the promise settles and on which microtask tick a reaction of it runs: "rejected on tick 6".
// A Promise.resolve().then() chain counts the ticks. It starts before `trigger` runs, so a promise
// that is already settled gives tick 1.
export function settlement(trigger: () => Promise<unknown>) {
  return new Promise<string>((resolve, reject) => {
    let tick = 0;
    let settled = false;
    const step = () => {
      tick++;
      if (settled) return;
      if (tick < 100) Promise.resolve().then(step);
      else reject(new Error("the promise did not settle in 100 ticks"));
    };
    Promise.resolve().then(step);
    const mark = (state: string) => () => {
      settled = true;
      resolve(`${state} on tick ${tick}`);
    };
    trigger().then(mark("fulfilled"), mark("rejected"));
  });
}
