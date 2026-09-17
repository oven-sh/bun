// For each way of consuming a native rejection below, prints the names of the
// error's `at async` frames: before and after process.argv[2] takes JSC off its
// promise fast paths, each with and without an AsyncLocalStorage context.
const { AsyncLocalStorage } = require("node:async_hooks");
const { readFile } = require("node:fs/promises");

const missing = "/nonexistent-path/does-not-exist.txt";

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
  return Bun.file(missing).text();
}
async function asyncFunctionReturn() {
  await returnsNativePromise();
}

async function resolveWithPromise() {
  const { promise, resolve } = Promise.withResolvers();
  resolve(Bun.file(missing).text());
  await promise;
}

async function race() {
  await Promise.race([Bun.file(missing).text()]);
}

async function thenChain() {
  await Bun.file(missing)
    .text()
    .then(text => text);
}

async function promiseSubclass() {
  await MyPromise.resolve(Bun.file(missing).text());
}

async function forwardingThenable() {
  await {
    then(onFulfilled, onRejected) {
      Bun.file(missing).text().then(onFulfilled, onRejected);
    },
  };
}

// The rejection goes to the promise that `reject` belongs to. These await it.
async function thenResolveReject() {
  const { promise, resolve, reject } = Promise.withResolvers();
  Bun.file(missing).text().then(resolve, reject);
  await promise;
}
async function catchReject() {
  const { promise, reject } = Promise.withResolvers();
  Bun.file(missing).text().catch(reject);
  await promise;
}

// These await what then() and catch() returned. Only a callback sees the error.
async function thenResolveRejectResult() {
  const { promise, resolve, reject } = Promise.withResolvers();
  const seen = promise.then(undefined, error => error);
  await Bun.file(missing).text().then(resolve, reject);
  return seen;
}
async function catchRejectResult() {
  const { promise, reject } = Promise.withResolvers();
  const seen = promise.then(undefined, error => error);
  await Bun.file(missing).text().catch(reject);
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
