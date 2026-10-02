import { Worker } from "node:worker_threads";
import assert from "node:assert";

const { promise, resolve, reject } = Promise.withResolvers();

process.on("worker", assert.fail);
// on() and not once(): a once() listener removes itself, and process emits 'removeListener' with process.emit,
// which is 5 below.
process.on("uncaughtException", exception => {
  try {
    assert.strictEqual(exception.name, "TypeError");
    assert(exception.message.includes("5 is not a function"), "message should include '5 is not a function'");
    resolve();
  } catch (e) {
    reject(e);
  }
});

// this will emit the "worker" event on the next tick
new Worker("", { eval: true });
// override it for when we try to emit the event and look up "emit"
process.emit = 5;
// wait for the error
await promise;
