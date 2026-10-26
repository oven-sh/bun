// For each way of consuming a native rejection below, prints the names of the
// error's `at async` frames, with and without an AsyncLocalStorage context.
// process.argv[2] names what takes JSC off its promise fast paths first.
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const missing = "/nonexistent-path/does-not-exist.txt";

// A promise that native code rejects with no JS on the stack. Not text(): on
// Windows a read that rejects does not keep the process alive (#39787).
const native = () => Bun.file(missing).stat();

// Each of these but the first fires a promise watchpoint of the realm, for good.
// From then on JSC resolves a promise with another promise through
// then(resolve, reject), or then() keeps its result in a capability record, or
// an await calls then().
const triggers: Record<string, () => void> = {
  "with nothing changed"() {},
  "after defining Object.prototype.then"() {
    Object.defineProperty(Object.prototype, "then", { configurable: true, get() {} });
    delete (Object.prototype as any).then;
  },
  "after replacing Promise.prototype.then"() {
    const then = Promise.prototype.then;
    Promise.prototype.then = function (onFulfilled, onRejected) {
      return then.call(this, onFulfilled, onRejected);
    } as typeof then;
  },
  "after freezing Promise.prototype"() {
    Object.freeze(Promise.prototype);
  },
  "after deleting Promise.prototype.constructor"() {
    delete (Promise.prototype as any).constructor;
  },
};
triggers[process.argv[2]]();

class MyPromise<T> extends Promise<T> {}
const never = new Promise<never>(() => {});

// fs.promises.readFile is an async function that returns the native promise.
async function fsPromises() {
  await readFile(missing);
}

async function returnsNativePromise() {
  return native();
}
async function asyncFunctionReturn() {
  await returnsNativePromise();
}

async function resolveWithPromise() {
  const { promise, resolve } = Promise.withResolvers();
  resolve(native());
  await promise;
}

async function race() {
  await Promise.race([native()]);
}

async function thenChain() {
  await native().then(stats => stats);
}

async function promiseSubclass() {
  await MyPromise.resolve(native());
}

async function forwardingThenable() {
  await {
    then(onFulfilled: (value: unknown) => void, onRejected: (reason: unknown) => void) {
      native().then(onFulfilled, onRejected);
    },
  };
}

// The promise meets the Promise functions of another realm. JSC then takes the
// same slow paths for that one promise, with no watchpoint fired.
const {
  Promise: OtherRealmPromise,
  then: otherRealmPromiseThen,
  otherRealmAwait,
} = vm.runInNewContext(
  `({
    Promise,
    then: Promise.prototype.then,
    async otherRealmAwait() {
      await native();
    },
  })`,
  { native },
);
async function otherRealmThen() {
  await otherRealmPromiseThen.call(native(), stats => stats);
}
async function otherRealmResolve() {
  await OtherRealmPromise.resolve(native());
}

// Both functions of one promise, as JSC itself passes them to then().
async function thenResolveReject() {
  const { promise, resolve, reject } = Promise.withResolvers();
  native().then(resolve, reject);
  await promise;
}

// What waits for the promise that then() returned comes first, as on the fast
// paths. Node goes to the promise of `resolve`: no frame for the first of these
// two, and receiver() for the second.
async function thenResolveRejectResult() {
  const { promise, resolve, reject } = Promise.withResolvers();
  const seen = promise.then(undefined, error => error);
  await native().then(resolve, reject);
  return seen;
}
async function bothAwaited() {
  const { promise, resolve, reject } = Promise.withResolvers();
  async function starter() {
    await native().then(resolve, reject);
  }
  async function receiver() {
    await promise;
  }
  const seen = receiver().then(undefined, error => error);
  await starter();
  return seen;
}

// worker() awaits a promise that its own failure settles. The chain is a cycle,
// and the trace has worker() once.
async function failFastWorker() {
  const { promise: aborted, reject: abort } = Promise.withResolvers();
  const seen = aborted.then(undefined, error => error);
  async function worker() {
    await Promise.race([native(), aborted]);
  }
  await worker().catch(abort);
  return seen;
}
async function cycleThroughThen() {
  const rejected = native();
  const seen = rejected.then(undefined, error => error);
  let result: Promise<unknown>;
  async function worker() {
    await null;
    await Promise.race([rejected, result]);
  }
  result = worker().then(value => value);
  result.catch(() => {});
  return seen;
}
async function cycleThroughResolveReject() {
  const { promise, resolve, reject } = Promise.withResolvers();
  const seen = promise.then(undefined, error => error);
  async function worker() {
    await Promise.race([native(), promise]);
  }
  worker().then(resolve, reject);
  return seen;
}

// A reject function alone is no link to its promise, as in V8. then() calls it
// only if the promise before it rejects.
async function catchReject() {
  const { promise, reject } = Promise.withResolvers();
  native().catch(reject);
  await promise;
}
// Here a handler took the rejection, so bystander() never gets it.
async function handledBeforeRejectFunction() {
  const { promise, reject } = Promise.withResolvers();
  async function bystander() {
    await promise;
  }
  bystander();
  const seen = Promise.withResolvers();
  native().catch(seen.resolve).catch(reject);
  return seen.promise;
}
// then() has no reject handler here. The rejection goes on to the promise that
// then() returned, where nothing handles it, and bystander() never gets it.
async function thenResolveOnly() {
  const { promise, resolve } = Promise.withResolvers();
  async function bystander() {
    await promise;
  }
  bystander();
  const unhandled = Promise.withResolvers();
  process.once("unhandledRejection", unhandled.resolve);
  native().then(resolve);
  return unhandled.promise;
}

// The pairs below were called: each resolved its promise with one that never
// settles. A later call does nothing, so the rejection does not reach bystander().
async function calledWithResolversPair() {
  const { promise, resolve, reject } = Promise.withResolvers();
  resolve(never);
  async function bystander() {
    await promise;
  }
  bystander();
  const rejected = native();
  const seen = rejected.then(undefined, error => error);
  rejected.then(resolve, reject);
  return seen;
}
async function calledThenableJobPair() {
  const called = Promise.withResolvers<[(value: unknown) => void, (reason: unknown) => void]>();
  const promise = Promise.resolve({
    then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
      called.resolve([resolve, reject]);
    },
  });
  const [resolve, reject] = await called.promise;
  resolve(never);
  async function bystander() {
    await promise;
  }
  bystander();
  const rejected = native();
  const seen = rejected.then(undefined, error => error);
  rejected.then(resolve, reject);
  return seen;
}
async function calledAwaitPair() {
  const called = Promise.withResolvers<[(value: unknown) => void, (reason: unknown) => void]>();
  async function bystander() {
    await {
      then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        called.resolve([resolve, reject]);
      },
    };
  }
  bystander();
  const [resolve, reject] = await called.promise;
  resolve(never);
  const rejected = native();
  const seen = rejected.then(undefined, error => error);
  rejected.then(resolve, reject);
  return seen;
}

// The newest reaction is the one of Promise.all(), which the walk does not follow.
async function promiseAllAfterThen() {
  const rejected = native();
  const seen = rejected.then(undefined, error => error);
  Promise.all([rejected]).catch(() => {});
  return seen;
}

const shapes = [
  fsPromises,
  asyncFunctionReturn,
  resolveWithPromise,
  race,
  thenChain,
  promiseSubclass,
  forwardingThenable,
  otherRealmAwait,
  otherRealmThen,
  otherRealmResolve,
  thenResolveReject,
  thenResolveRejectResult,
  bothAwaited,
  failFastWorker,
  cycleThroughThen,
  cycleThroughResolveReject,
  catchReject,
  handledBeforeRejectFunction,
  thenResolveOnly,
  calledWithResolversPair,
  calledThenableJobPair,
  calledAwaitPair,
  promiseAllAfterThen,
];

// The names of the leading `at async` frames, down to this helper.
async function asyncFramesOf(fn: () => Promise<unknown>) {
  let error: any;
  try {
    error = await fn();
  } catch (e) {
    error = e;
  }
  if (error?.code !== "ENOENT") throw new Error(`${fn.name}: expected ENOENT, got ${error}`);
  const names = String(error.stack)
    .split("\n")
    .filter(line => line.includes("at async "))
    .map(line => line.trim().split(" ")[2]);
  const end = names.indexOf("asyncFramesOf");
  return end === -1 ? names : names.slice(0, end + 1);
}

async function collect() {
  const frames: Record<string, string[]> = {};
  for (const fn of shapes) frames[fn.name] = await asyncFramesOf(fn);
  return frames;
}

console.log(
  JSON.stringify({
    "outside AsyncLocalStorage.run()": await collect(),
    "in AsyncLocalStorage.run()": await new AsyncLocalStorage().run({}, collect),
  }),
);
