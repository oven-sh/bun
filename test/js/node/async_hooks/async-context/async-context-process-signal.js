// process.kill() cannot deliver a signal to a listener on Windows.
if (process.platform === "win32") process.exit(0);

process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { constants } = require("os");
const assert = require("assert");

const asyncLocalStorage = new AsyncLocalStorage();
const SIGNAL = "SIGUSR2";

let seen = [];
let wake;
const record = label => {
  seen.push(`${label}:${asyncLocalStorage.getStore()}`);
  wake?.();
};
// Sends the signal and resolves with what the listeners recorded once `count` of them have run.
async function deliver(count, signal = SIGNAL) {
  seen = [];
  process.kill(process.pid, signal);
  while (seen.length < count) await new Promise(resolve => (wake = resolve));
  return seen;
}

async function main() {
  // A signal listener does not keep Node's event loop alive.
  const keepAlive = setInterval(() => {}, 1000);

  // Every listener of a signal name runs in the store the name's first listener was added in,
  // whichever method added it.
  for (const method of ["on", "addListener", "once", "prependListener", "prependOnceListener"]) {
    asyncLocalStorage.run("first", () => process[method](SIGNAL, () => record("a")));
    asyncLocalStorage.run("second", () => process.on(SIGNAL, () => record("b")));
    assert.deepStrictEqual(await deliver(2), ["a:first", "b:first"], method);
    process.removeAllListeners(SIGNAL);
  }

  // A first listener added outside any store gives every listener of the name no store.
  {
    process.on(SIGNAL, () => record("a"));
    asyncLocalStorage.run("second", () => process.on(SIGNAL, () => record("b")));
    assert.deepStrictEqual(await deliver(2), ["a:undefined", "b:undefined"]);
    process.removeAllListeners(SIGNAL);
  }

  // Removing the first listener while another one remains changes nothing. The name gets a new
  // store only after its last listener is removed.
  {
    const a = () => record("a");
    const b = () => record("b");
    asyncLocalStorage.run("first", () => process.on(SIGNAL, a));
    asyncLocalStorage.run("second", () => process.on(SIGNAL, b));
    process.removeListener(SIGNAL, a);
    assert.deepStrictEqual(await deliver(1), ["b:first"]);

    process.removeListener(SIGNAL, b);
    asyncLocalStorage.run("third", () => process.on(SIGNAL, () => record("c")));
    assert.deepStrictEqual(await deliver(1), ["c:third"]);

    process.removeAllListeners(SIGNAL);
    asyncLocalStorage.run("fourth", () => process.on(SIGNAL, () => record("d")));
    assert.deepStrictEqual(await deliver(1), ["d:fourth"]);
    process.removeAllListeners(SIGNAL);
  }

  // A once() listener is removed before it runs. It still runs in its store, and when it was the
  // last listener the name gets a new store afterwards.
  {
    asyncLocalStorage.run("once", () => process.once(SIGNAL, () => record("a")));
    assert.deepStrictEqual(await deliver(1), ["a:once"]);
    asyncLocalStorage.run("after-once", () => process.on(SIGNAL, () => record("b")));
    assert.deepStrictEqual(await deliver(1), ["b:after-once"]);
    process.removeAllListeners(SIGNAL);
  }

  // Two names of one signal number each keep their own store.
  if (constants.signals.SIGIOT === constants.signals.SIGABRT) {
    asyncLocalStorage.run("abrt", () => process.on("SIGABRT", () => record("SIGABRT")));
    asyncLocalStorage.run("iot", () => process.on("SIGIOT", () => record("SIGIOT")));
    assert.deepStrictEqual((await deliver(2, "SIGABRT")).sort(), ["SIGABRT:abrt", "SIGIOT:iot"]);
    process.removeAllListeners("SIGABRT");
    process.removeAllListeners("SIGIOT");
  }

  // The listeners of one delivery share one entered context: enterWith() in a listener reaches the
  // listeners after it. It does not reach the next delivery (with node --no-async-context-frame
  // it does: that implementation keeps the store on the signal handle).
  {
    asyncLocalStorage.run("base", () => {
      process.on(SIGNAL, () => {
        record("a");
        asyncLocalStorage.enterWith("entered");
      });
      process.on(SIGNAL, () => record("b"));
    });
    assert.deepStrictEqual(await deliver(2), ["a:base", "b:entered"]);
    assert.deepStrictEqual(await deliver(2), ["a:base", "b:entered"]);
    process.removeAllListeners(SIGNAL);
  }

  // process.emit() from script is an ordinary emit: the listeners run in the caller's store.
  {
    asyncLocalStorage.run("listener", () => process.on(SIGNAL, () => record("a")));
    seen = [];
    asyncLocalStorage.run("emitter", () => process.emit(SIGNAL));
    assert.deepStrictEqual(seen, ["a:emitter"]);
    process.removeAllListeners(SIGNAL);
  }

  clearInterval(keepAlive);
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error);
    process.exit(1);
  },
);
