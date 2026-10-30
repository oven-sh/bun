import {
  untilBehindTheEndOfTheThread,
  workerThatEndsInsideItsConstructor,
} from "./worker-that-ends-inside-its-constructor";

// What the listeners of the worker are called with, in that order. The errors are printed behind it.
const events: string[] = [];
const uncaught: string[] = [];
process.on("uncaughtException", error => void uncaught.push("uncaught: " + error.message));

await untilBehindTheEndOfTheThread(async hold => {
  events.length = 0;
  uncaught.length = 0;
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
console.log([...events, ...uncaught].join("\n"));
