import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import { setImmediate } from "node:timers/promises";
import { BroadcastChannel, MessageChannel, Worker } from "node:worker_threads";

const mode = process.argv[2];
const events = ["message", "messageerrors", "messageerror", "error", "online", "custom", "exit"];
const counts = (worker, names = events) => Object.fromEntries(names.map(name => [name, worker.listenerCount(name)]));
const scope = new AsyncLocalStorage();
const listenerFor = snapshot => () => snapshot(() => {});

async function capture() {
  const worker = new Worker(
    `
    const { parentPort } = require('node:worker_threads');
    parentPort.once('message', mode => {
      if (mode === 'error') throw new Error('expected worker failure');
      if (mode === 'terminate') setInterval(() => {}, 1000);
      else parentPort.close();
    });
    parentPort.postMessage('ready');
  `,
    { eval: true },
  );
  await once(worker, "message");
  const { port1, port2 } = new MessageChannel();
  const channel = new BroadcastChannel("worker-exit-cleanup");
  port1.close();
  port2.close();
  channel.close();
  const caller = { port1, port2, channel };
  const references = [caller, port1, port2, channel].map(value => new WeakRef(value));
  scope.run(caller, () => {
    const snapshot = AsyncLocalStorage.snapshot();
    for (const event of events.slice(0, -1)) worker.on(event, listenerFor(snapshot));
  });
  let before;
  let errorMessage;
  worker.on("error", error => {
    errorMessage = error.message;
  });
  const exited = new Promise(resolve => {
    worker.on("exit", code => {
      before = counts(worker, events.slice(0, -1));
      for (const event of events) worker.on(event, () => {});
      resolve(code);
    });
  });
  worker.postMessage(mode);
  if (mode === "terminate") await worker.terminate();
  const code = await exited;
  return { worker, references, before, code, errorMessage };
}

const { worker, references, before, code, errorMessage } = await capture();
const control = new WeakRef({});
for (let pass = 0; pass < 8; pass++) {
  await setImmediate();
  globalThis.gc();
}
const result = {
  before,
  after: counts(worker),
  eventNames: worker.eventNames(),
  collected: references.map(reference => reference.deref() === undefined),
  controlCollected: control.deref() === undefined,
  code,
  errorMessage: errorMessage ?? null,
};
console.log(JSON.stringify(result));
assert.deepEqual(before, { message: 0, messageerrors: 0, messageerror: 1, error: 2, online: 1, custom: 1 });
assert.deepEqual(result.after, Object.fromEntries(events.map(name => [name, 0])));
assert.deepEqual(result.eventNames, []);
assert.equal(result.controlCollected, true);
assert.deepEqual(result.collected, [true, true, true, true]);
assert.equal(code, mode === "normal" ? 0 : 1);
assert.equal(result.errorMessage, mode === "error" ? "expected worker failure" : null);
