import {
  untilBehindTheEndOfTheThread,
  workerThatEndsInsideItsConstructor,
} from "./worker-that-ends-inside-its-constructor";

// What the listeners of the worker and the 'uncaughtException' listener are called with, in that order.
const events: string[] = [];
process.on("uncaughtException", error => void events.push("uncaught: " + error.message));

await untilBehindTheEndOfTheThread(async hold => {
  events.length = 0;
  const worker = workerThatEndsInsideItsConstructor(
    `parentPort.postMessage("first"); parentPort.postMessage("second"); parentPort.postMessage("third");`,
    hold,
  );
  let threadId = 0;
  worker.on("message", message => {
    threadId ||= worker.threadId;
    events.push("message: " + message);
    throw new Error("thrown at " + message);
  });
  await new Promise<void>(resolve => {
    worker.on("exit", code => {
      events.push("exit: " + code);
      resolve();
    });
  });
  // The errors are reported by now.
  await new Promise(resolve => setImmediate(resolve));
  events.push("terminate: " + (await worker.terminate()));
  return threadId;
});
console.log(events.join("\n"));
