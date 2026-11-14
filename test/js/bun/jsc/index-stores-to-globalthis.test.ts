import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A store to an index key of globalThis ends in JavaScriptCore's putByIndex(), which has no parameter for the receiver.
// A setter and a Proxy's set trap get globalThis as the receiver all the same, as they do for a name.
//
// Each realm evaluates this string itself: Bun's transpiler would drop the "use strict" of the setters
// (https://github.com/oven-sh/bun/issues/14251).
const source = `
(function () {
  const results = {};
  const name = value => (value === globalThis ? "globalThis" : typeof value);
  function store(label, holder, key, run) {
    let calls = 0;
    let receiver = "no call";
    Object.defineProperty(holder, key, {
      set(value) {
        "use strict";
        calls++;
        receiver = name(this);
      },
      configurable: true,
    });
    try {
      run();
    } finally {
      delete holder[key];
    }
    results[label] = calls === 1 ? receiver : calls + " calls";
  }

  // The target of an event on the global object can be the object behind globalThis, not globalThis itself.
  let eventTarget;
  addEventListener("index-store", event => { eventTarget = event.target; }, { once: true });
  dispatchEvent(new Event("index-store"));

  for (const [holderName, holder] of [["an inherited setter", Object.prototype], ["an own setter", globalThis]]) {
    store(holderName + ", globalThis[0] = v", holder, 0, () => { globalThis[0] = 1; });
    store(holderName + ", strict code", holder, 0, () => { "use strict"; globalThis[0] = 1; });
    store(holderName + ", a string key", holder, 0, () => { globalThis[String(0)] = 1; });
    store(holderName + ", an index beyond the vector", holder, 1000000000, () => { globalThis[1000000000] = 1; });
    store(holderName + ", Reflect.set", holder, 0, () => { Reflect.set(globalThis, 0, 1); });
    store(holderName + ", Object.assign", holder, 0, () => { Object.assign(globalThis, { 0: 1 }); });
    store(holderName + ", the target of an event on globalThis", holder, 0, () => { eventTarget[0] = 1; });
  }

  const prototype = Object.getPrototypeOf(globalThis);
  let trapReceiver = "no call";
  const proxy = new Proxy({}, {
    set(target, key, value, receiver) {
      trapReceiver = name(receiver);
      return true;
    },
  });
  Object.setPrototypeOf(globalThis, Object.create(proxy));
  try {
    globalThis[3] = 1;
  } finally {
    Object.setPrototypeOf(globalThis, prototype);
  }
  results["a Proxy's set trap"] = trapReceiver;
  return JSON.stringify(results);
})()`;

const everyReceiverIsGlobalThis = {
  "an inherited setter, globalThis[0] = v": "globalThis",
  "an inherited setter, strict code": "globalThis",
  "an inherited setter, a string key": "globalThis",
  "an inherited setter, an index beyond the vector": "globalThis",
  "an inherited setter, Reflect.set": "globalThis",
  "an inherited setter, Object.assign": "globalThis",
  "an inherited setter, the target of an event on globalThis": "globalThis",
  "an own setter, globalThis[0] = v": "globalThis",
  "an own setter, strict code": "globalThis",
  "an own setter, a string key": "globalThis",
  "an own setter, an index beyond the vector": "globalThis",
  "an own setter, Reflect.set": "globalThis",
  "an own setter, Object.assign": "globalThis",
  "an own setter, the target of an event on globalThis": "globalThis",
  "a Proxy's set trap": "globalThis",
};

// An index setter on Object.prototype slows every array of its realm down, so the main realm is the one of a subprocess.
test.concurrent("index stores to globalThis in the main realm and in a Worker", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { Worker } = require("node:worker_threads");
      const source = ${JSON.stringify(source)};
      const main = (0, eval)(source);
      const worker = new Worker(
        "require('node:worker_threads').parentPort.postMessage((0, eval)(" + JSON.stringify(source) + "));",
        { eval: true },
      );
      worker.once("message", fromWorker => console.log(JSON.stringify({ main: JSON.parse(main), worker: JSON.parse(fromWorker) })));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ main: everyReceiverIsGlobalThis, worker: everyReceiverIsGlobalThis });
  expect(exitCode).toBe(0);
});

test("index stores to globalThis in a ShadowRealm", () => {
  expect(JSON.parse(new ShadowRealm().evaluate(source) as string)).toEqual(everyReceiverIsGlobalThis);
});
