import {
  untilBehindTheEndOfTheThread,
  workerThatEndsInsideItsConstructor,
} from "./worker-that-ends-inside-its-constructor";

// The event of worker.stdout whose listener throws, on its first call: "data" or "readable".
const event = process.argv[2];
const uncaught: string[] = [];
process.on("uncaughtException", error => void uncaught.push(error.message));

let result = {};
await untilBehindTheEndOfTheThread(async hold => {
  uncaught.length = 0;
  const worker = workerThatEndsInsideItsConstructor(
    `process.stdout.write("out 1\\n");
    process.stderr.write("err 1\\n");
    process.stdout.write("out 2\\n");
    process.stderr.write("err 2\\n");
    process.exit(3);`,
    hold,
    { stdout: true, stderr: true },
  );
  let threadId = 0;
  let stdout = "";
  let stderr = "";
  const ended: string[] = [];
  worker.stdout.on(event, (chunk?: Buffer) => {
    const first = threadId === 0;
    threadId ||= worker.threadId;
    if (chunk) stdout += chunk;
    if (first) throw new Error(`thrown by the '${event}' listener`);
  });
  worker.stdout.on("end", () => void ended.push("stdout"));
  worker.stderr.on("data", chunk => void (stderr += chunk));
  worker.stderr.on("end", () => void ended.push("stderr"));
  const code = await new Promise(resolve => worker.on("exit", resolve));
  // The error is reported by now, and a stream that nothing is left to read from has ended.
  await new Promise(resolve => setImmediate(resolve));
  const endedAtExit = [...ended];
  // `left` is what worker.stdout still holds: all of it behind a 'readable' listener, which reads nothing here.
  let left = "";
  for (let chunk: Buffer | null; (chunk = worker.stdout.read()) !== null;) left += chunk;
  await new Promise(resolve => setImmediate(resolve));
  result = { code, uncaught: [...uncaught], stdout, stderr, ended: endedAtExit, left, endedAfterRead: [...ended] };
  return threadId;
});
console.log(JSON.stringify(result));
