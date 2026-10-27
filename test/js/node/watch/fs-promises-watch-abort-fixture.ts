// Prints how the next() of fs.promises.watch() settles after an abort: on which microtask tick, and before or after
// events.once(signal, "abort") on the same signal. It uses only Node APIs, so
// `node fs-promises-watch-abort-fixture.ts <path>` prints the values that the test expects.
import { once } from "node:events";
import { watch } from "node:fs/promises";
import { basename } from "node:path";

const watched = process.argv[2];
const turnOfTheEventLoop = () => new Promise(resolve => setImmediate(resolve));
const iterate = (signal: AbortSignal, recursive: boolean) =>
  watch(watched, { signal, recursive })[Symbol.asyncIterator]();

// How the promise settles and on which microtask tick a reaction of it runs: "rejected on tick 3".
// A Promise.resolve().then() chain counts the ticks. It starts before `trigger` runs.
function settlement(trigger: () => Promise<unknown>) {
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

async function ticks(recursive: boolean) {
  const result: Record<string, string> = {};
  {
    const ac = new AbortController();
    const pending = iterate(ac.signal, recursive).next();
    await turnOfTheEventLoop();
    result["next() waits, then abort()"] = await settlement(() => {
      ac.abort();
      return pending;
    });
  }
  {
    const ac = new AbortController();
    result["next() and abort() in the same turn"] = await settlement(() => {
      const pending = iterate(ac.signal, recursive).next();
      ac.abort();
      return pending;
    });
  }
  {
    const ac = new AbortController();
    const iterator = iterate(ac.signal, recursive);
    await turnOfTheEventLoop();
    ac.abort();
    result["abort(), then the first next()"] = await settlement(() => iterator.next());
    result["abort(), then the second next()"] = await settlement(() => iterator.next());
  }
  {
    const iterator = iterate(AbortSignal.abort(), recursive);
    result["watch() with an aborted signal"] = await settlement(() => iterator.next());
    result["watch() with an aborted signal, the second next()"] = await settlement(() => iterator.next());
  }
  {
    const ac = new AbortController();
    ac.signal.addEventListener("abort", event => event.stopImmediatePropagation());
    const pending = iterate(ac.signal, recursive).next();
    await turnOfTheEventLoop();
    result["an earlier listener stops the propagation of the abort event"] = await settlement(() => {
      ac.abort();
      return pending;
    });
  }
  {
    const ac = new AbortController();
    const iterator = iterate(ac.signal, recursive);
    await turnOfTheEventLoop();
    ac.abort();
    // No async function waits for this next(), so only the frames of the call itself can name this file.
    const stack = await new Promise<string>(resolve =>
      iterator.next().then(
        () => resolve("next() fulfilled"),
        error => resolve(String(error.stack)),
      ),
    );
    result["the stack of the AbortError names the file that called next()"] = String(
      stack.includes(basename(import.meta.filename)),
    );
  }
  return result;
}

// The promise that settles first in a Promise.race() of events.once(signal, "abort") and next().
async function races(recursive: boolean) {
  const result: Record<string, string> = {};
  for (const first of ["once()", "next()"]) {
    for (const timing of ["in the same turn", "later"]) {
      const ac = new AbortController();
      const viaOnce = () => once(ac.signal, "abort").then(() => "once() fulfilled");
      const viaWatch = () =>
        iterate(ac.signal, recursive)
          .next()
          .then(
            () => "next() fulfilled",
            error => `next() rejected with ${error.name}`,
          );
      const promises = first === "once()" ? [viaOnce(), viaWatch()] : [viaWatch(), viaOnce()];
      if (timing === "later") await turnOfTheEventLoop();
      ac.abort();
      result[`${first} is called first, abort() comes ${timing}`] = await Promise.race(promises);
      await Promise.all(promises);
    }
  }
  return result;
}

// The order in which the promises of one signal settle. Each once() is named after the call it follows.
async function order(recursive: boolean) {
  const result: Record<string, string> = {};
  const settled = (log: string[], name: string, promise: Promise<unknown>) =>
    promise.then(
      value => log.push(name === "once()" || !(value as IteratorResult<unknown>).done ? name : `${name} is done`),
      error => log.push(`${name} rejected with ${error.name}`),
    );
  for (const timing of ["in the same turn", "later"]) {
    const ac = new AbortController();
    const log: string[] = [];
    const iterator = iterate(ac.signal, recursive);
    const all = [
      settled(log, "once() after watch()", once(ac.signal, "abort")),
      settled(log, "next()", iterator.next()),
      settled(log, "once() after next()", once(ac.signal, "abort")),
    ];
    if (timing === "later") await turnOfTheEventLoop();
    ac.abort();
    await Promise.all(all);
    result[`watch(), once(), next(), once(), and abort() comes ${timing}`] = log.join(", ");
  }
  {
    const ac = new AbortController();
    const log: string[] = [];
    const first = iterate(ac.signal, recursive);
    const second = iterate(ac.signal, recursive);
    const all = [settled(log, "the second watcher", second.next()), settled(log, "the first watcher", first.next())];
    await turnOfTheEventLoop();
    ac.abort();
    await Promise.all(all);
    result["two watchers, next() of the second is called first, and abort() comes later"] = log.join(", ");
  }
  {
    const ac = new AbortController();
    const log: string[] = [];
    const iterator = iterate(ac.signal, recursive);
    await turnOfTheEventLoop();
    ac.abort();
    await Promise.all([settled(log, "first next()", iterator.next()), settled(log, "second next()", iterator.next())]);
    result["abort(), then two next() calls in one turn"] = log.join(", ");
  }
  {
    const log: string[] = [];
    const iterator = iterate(AbortSignal.abort(), recursive);
    await Promise.all([settled(log, "first next()", iterator.next()), settled(log, "second next()", iterator.next())]);
    result["watch() with an aborted signal, then two next() calls in one turn"] = log.join(", ");
  }
  {
    const ac = new AbortController();
    const log: string[] = [];
    const watcher = watch(watched, { signal: ac.signal, recursive });
    const viaOnce = settled(log, "once() after watch()", once(ac.signal, "abort"));
    const loop = (async () => {
      try {
        for await (const _ of watcher);
      } catch (error) {
        log.push(`for await rejected with ${(error as Error).name}`);
      }
    })();
    await turnOfTheEventLoop();
    ac.abort();
    await Promise.all([viaOnce, loop]);
    result["watch(), once(), for await, and abort() comes later"] = log.join(", ");
  }
  return result;
}

const result = {
  "ticks": await ticks(false),
  "ticks with recursive: true": await ticks(true),
  "races": await races(false),
  "races with recursive: true": await races(true),
  "order": await order(false),
  "order with recursive: true": await order(true),
};
console.log(JSON.stringify(result, null, 2));
