import {
  untilBehindTheEndOfTheThread,
  workerThatEndsInsideItsConstructor,
} from "./worker-that-ends-inside-its-constructor";

const lines: string[] = [];
process.on("uncaughtException", error => void lines.push("uncaught: " + error.message));

await untilBehindTheEndOfTheThread(async hold => {
  lines.length = 0;
  const worker = workerThatEndsInsideItsConstructor(`parentPort.postMessage("first");`, hold);
  let threadId = 0;
  worker.on("message", message => {
    threadId = worker.threadId;
    lines.push("message: " + message);
    throw new Error("thrown by the listener");
  });
  const code = await new Promise(resolve => worker.on("exit", resolve));
  lines.push("exit: " + code);
  // The error is reported by now.
  await new Promise(resolve => setImmediate(resolve));
  lines.push("terminate: " + (await worker.terminate()));
  return threadId;
});
console.log(lines.sort().join("\n"));
