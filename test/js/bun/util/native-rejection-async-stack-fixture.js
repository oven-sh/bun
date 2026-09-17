// For each way of consuming a native rejection below, prints the names of the
// error's `at async` frames: before and after process.argv[2] takes JSC off its
// promise fast paths, each with and without an AsyncLocalStorage context.
const { AsyncLocalStorage } = require("node:async_hooks");
const { readFile } = require("node:fs/promises");

const missing = "/nonexistent-path/does-not-exist.txt";

// A promise that native code rejects with no JS on the stack. Not text(): on
// Windows a read that rejects does not keep the process alive (#39787).
const native = () => Bun.file(missing).stat();

// Each of these fires a promise watchpoint of the realm, for good. From then on
// JSC resolves a promise with another promise through then(resolve, reject), and
// after the freeze then() also keeps its result in a capability record.
const leaveFastPaths = {
  "defining Object.prototype.then"() {
    Object.defineProperty(Object.prototype, "then", { configurable: true, get() {} });
    delete Object.prototype.then;
  },
  "replacing Promise.prototype.then"() {
    const then = Promise.prototype.then;
    Promise.prototype.then = function (onFulfilled, onRejected) {
      return then.call(this, onFulfilled, onRejected);
    };
  },
  "freezing Promise.prototype"() {
    Object.freeze(Promise.prototype);
  },
}[process.argv[2]];

class MyPromise extends Promise {}

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
    then(onFulfilled, onRejected) {
      native().then(onFulfilled, onRejected);
    },
  };
}

// The rejection goes to the promise that `reject` belongs to. These await it.
async function thenResolveReject() {
  const { promise, resolve, reject } = Promise.withResolvers();
  native().then(resolve, reject);
  await promise;
}
async function catchReject() {
  const { promise, reject } = Promise.withResolvers();
  native().catch(reject);
  await promise;
}

// These await what then() and catch() returned. Only a callback sees the error.
async function thenResolveRejectResult() {
  const { promise, resolve, reject } = Promise.withResolvers();
  const seen = promise.then(undefined, error => error);
  await native().then(resolve, reject);
  return seen;
}
async function catchRejectResult() {
  const { promise, reject } = Promise.withResolvers();
  const seen = promise.then(undefined, error => error);
  await native().catch(reject);
  return seen;
}
// As above, behind a chain that is longer than one walk.
async function catchRejectResultLongChain() {
  const { promise, reject } = Promise.withResolvers();
  let tail = promise;
  for (let i = 0; i < 40; i++) tail = tail.then(value => value);
  const seen = tail.then(undefined, error => error);
  await native().catch(reject);
  return seen;
}
// As above, behind more reject functions than the search has walks.
async function catchRejectResultManyTargets() {
  let { promise, reject } = Promise.withResolvers();
  const first = reject;
  for (let i = 0; i < 10; i++) {
    const next = Promise.withResolvers();
    promise.catch(next.reject);
    ({ promise, reject } = next);
  }
  const seen = promise.then(undefined, error => error);
  await native().catch(first);
  return seen;
}

// worker() awaits a promise that its own failure rejects. The chain is a cycle.
async function failFastWorker() {
  const { promise: aborted, reject: abort } = Promise.withResolvers();
  const seen = aborted.then(undefined, error => error);
  async function worker() {
    await Promise.race([native(), aborted]);
  }
  await worker().catch(abort);
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
  thenResolveReject,
  catchReject,
  thenResolveRejectResult,
  catchRejectResult,
  catchRejectResultLongChain,
  catchRejectResultManyTargets,
  failFastWorker,
];

// The names of the leading `at async` frames, down to this helper.
async function asyncFramesOf(fn) {
  let error;
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
  const frames = {};
  for (const fn of shapes) frames[fn.name] = await asyncFramesOf(fn);
  return frames;
}

async function main() {
  const storage = new AsyncLocalStorage();
  const result = {};
  result["before"] = await collect();
  result["before, in AsyncLocalStorage.run()"] = await storage.run({}, collect);
  leaveFastPaths();
  result["after"] = await collect();
  result["after, in AsyncLocalStorage.run()"] = await storage.run({}, collect);
  console.log(JSON.stringify(result));
}

main();
