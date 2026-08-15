import { Worker } from "node:worker_threads";
import assert from "node:assert";

const { promise, resolve } = Promise.withResolvers();

process.on("worker", assert.fail);
// Reported as-is for the test to compare: the expected TypeError, or the
// AssertionError from the listener above if the event was emitted after all.
process.once("uncaughtException", resolve);

// this will emit the "worker" event on the next tick
new Worker("", { eval: true });
// override it for when we try to emit the event and look up "emit"
process.emit = 5;

const { name, message } = await promise;
console.log(JSON.stringify({ name, message }));
