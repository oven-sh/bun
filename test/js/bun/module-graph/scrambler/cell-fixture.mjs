// Fixture of module-graph-scrambler.test.ts and module-graph.test.ts, loaded by every graph and by the host. Nothing here knows which
// graph it is of: whose context a callback runs in is decided by where it was scheduled, not by whose code
// scheduled it.
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

const soon = () => new Promise(resolve => setTimeout(resolve, 0));

// Ways to get to `next`, at once or later.
export const hops = {
  call: next => next(),
  timeout: next => void setTimeout(next, 0),
  immediate: next => void setImmediate(next),
  tick: next => process.nextTick(next),
  microtask: next => queueMicrotask(next),
  then: next => void Promise.resolve().then(next),
  thenOfPending: next => void soon().then(next),
  catch: next => void Promise.reject(0).catch(next),
  finally: next => void Promise.resolve().finally(next),
  await: next => void (async () => (await null, next()))(),
  awaitPending: next => void (async () => (await soon(), next()))(),
  awaitAdopted: next => void (async () => (await new Promise(resolve => resolve(soon())), next()))(),
  asyncReturn: next => void (async () => soon())().then(next),
  all: next => void Promise.all([Promise.resolve(), soon()]).then(next),
  race: next => void Promise.race([soon(), soon()]).then(next),
  forAwait: next =>
    void (async () => {
      for await (const _ of (async function* () {
        yield await soon();
      })());
      next();
    })(),
  emitter: next => {
    const emitter = new EventEmitter();
    emitter.once("go", next);
    emitter.emit("go");
  },
  emitterLater: next => {
    const emitter = new EventEmitter();
    emitter.once("go", next);
    setTimeout(() => emitter.emit("go"), 0);
  },
  eventTarget: next => {
    const target = new EventTarget();
    target.addEventListener("go", () => next(), { once: true });
    target.dispatchEvent(new Event("go"));
  },
  readFile: next => void readFile(import.meta.path).then(next),
  sleep: next => void Bun.sleep(0).then(next),
};

const rejecting = tag => (async () => (await null, Promise.reject(new Error(tag))))();
const rejectedLater = tag => new Promise((_, reject) => setTimeout(() => reject(new Error(tag)), 0));

// Ways for an error to end up with nobody handling it. `throws` end as an uncaught exception, `rejects` as an
// unhandled rejection.
export const throws = {
  "a timer's callback": tag =>
    void setTimeout(() => {
      throw new Error(tag);
    }, 0),
  "an immediate's callback": tag =>
    void setImmediate(() => {
      throw new Error(tag);
    }),
  "a tick's callback": tag =>
    process.nextTick(() => {
      throw new Error(tag);
    }),
  "a microtask's callback": tag =>
    queueMicrotask(() => {
      throw new Error(tag);
    }),
  "a listener of an emitter, emitted by a timer": tag => {
    const emitter = new EventEmitter();
    emitter.on("go", () => {
      throw new Error(tag);
    });
    setTimeout(() => emitter.emit("go"), 0);
  },
};
export const rejects = {
  "Promise.reject()": tag => void Promise.reject(new Error(tag)),
  "new Promise, rejected later": tag => void rejectedLater(tag),
  "an async function that throws": tag =>
    void (async () => {
      throw new Error(tag);
    })(),
  "an async function that throws after an await": tag =>
    void (async () => {
      await soon();
      throw new Error(tag);
    })(),
  "then() whose handler throws": tag =>
    void Promise.resolve().then(() => {
      throw new Error(tag);
    }),
  "then() whose handler returns a promise that rejects": tag => void Promise.resolve().then(() => rejecting(tag)),
  "then() whose handler is an async function that throws": tag =>
    void soon().then(async () => {
      throw new Error(tag);
    }),
  "catch() whose handler is an async function that throws": tag =>
    void Promise.reject(0).catch(async () => {
      throw new Error(tag);
    }),
  "finally() whose handler is an async function that throws": tag =>
    void Promise.resolve().finally(async () => {
      throw new Error(tag);
    }),
  "finally() of a promise that rejects": tag => void rejectedLater(tag).finally(() => {}),
  "new Promise resolved with a promise that rejects": tag => void new Promise(resolve => resolve(rejecting(tag))),
  "an async function that returns a promise that rejects": tag => void (async () => rejectedLater(tag))(),
  "then() with no handler for the rejection, of a pending promise": tag => void rejectedLater(tag).then(() => {}),
  "then() with no handler for the rejection, of a rejected promise": tag =>
    void Promise.reject(new Error(tag)).then(() => {}),
  "then() with no handler for the rejection, of a promise that rejected earlier": tag => {
    const rejected = Promise.reject(new Error(tag));
    rejected.catch(() => {});
    setTimeout(() => void rejected.then(() => {}), 0);
  },
  "a chain of then() with no handler for the rejection": tag =>
    void rejectedLater(tag)
      .then(() => {})
      .then(() => {})
      .then(() => {}),
  "Promise.all()": tag => void Promise.all([soon(), rejecting(tag)]),
  "Promise.race()": tag => void Promise.race([rejectedLater(tag)]),
  // Rejects with an AggregateError: `tagOf` reads the tag of its first error.
  "Promise.any()": tag => void Promise.any([rejecting(tag)]),
  "finally() of a rejected promise": tag => void Promise.reject(new Error(tag)).finally(() => {}),
  "new Promise resolved with a thenable that rejects": tag =>
    void new Promise(resolve => resolve({ then: (_, reject) => reject(new Error(tag)) })),
  "then() with no handler for the rejection, of an instance of a subclass": tag =>
    void new (class extends Promise {})((_, reject) => setTimeout(() => reject(new Error(tag)), 0)).then(() => {}),
  "an async generator that throws, in for await": tag =>
    void (async () => {
      for await (const _ of (async function* () {
        await soon();
        throw new Error(tag);
      })());
    })(),
  "a timer's callback that is an async function": tag =>
    void setTimeout(async () => {
      throw new Error(tag);
    }, 0),
  "a tick's callback that is an async function": tag =>
    process.nextTick(async () => {
      throw new Error(tag);
    }),
  "a file that does not exist": tag =>
    void readFile(import.meta.path + ".missing").catch(() => Promise.reject(new Error(tag))),
};

export const tagOf = error => (error instanceof AggregateError ? error.errors[0] : error).message;

export const makeGraph = options => new Bun.ModuleGraph(options);
