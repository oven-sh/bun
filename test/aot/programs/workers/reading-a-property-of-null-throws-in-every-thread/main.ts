// Reading or writing a property of null or undefined throws a TypeError in a Worker whose entry point is another file, in a Worker inside it, in a Worker of node:worker_threads, and on the main thread before, between and after them.
import { Worker as NodeWorker } from "node:worker_threads";
import { readThroughNothing } from "./reads";

function runWebWorker(file: string): Promise<string[]> {
  return new Promise(resolve => {
    const lines: string[] = [];
    const worker = new Worker(new URL(file, import.meta.url));
    worker.onmessage = event => lines.push(event.data);
    worker.addEventListener("close", event => {
      lines.push(file + " closed with " + (event as Event & { code: number }).code);
      resolve(lines);
    });
  });
}

function runNodeWorker(file: string): Promise<string[]> {
  return new Promise(resolve => {
    const lines: string[] = [];
    const worker = new NodeWorker(new URL(file, import.meta.url));
    worker.on("message", message => lines.push(message));
    worker.on("exit", code => {
      lines.push(file + " exited with " + code);
      resolve(lines);
    });
  });
}

function print(lines: string[]) {
  for (const line of lines) console.log(line);
}

console.log("the main thread: " + readThroughNothing());
print(await runWebWorker("./web-worker.ts"));
console.log("the main thread again: " + readThroughNothing());
print(await runWebWorker("./web-worker.ts"));
print(await runNodeWorker("./node-worker.ts"));
print(await runWebWorker("./outer-worker.ts"));
print(await runWebWorker("./box-worker.ts"));
console.log("three at once:");
print((await Promise.all([runWebWorker("./web-worker.ts"), runNodeWorker("./node-worker.ts"), runWebWorker("./outer-worker.ts")])).flat());
console.log("the main thread at the end: " + readThroughNothing());
