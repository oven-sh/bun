// usage: bun context-identifier-fixture.js <node|web|graphs|realms> <identifier> [second identifier]
//
// Sets the identifier that the next script execution context draws, makes that context, and prints
// one line of JSON about it.
//
//   node, web   a Worker through that API (this file again, as the Worker's entry): what it is on
//               both sides, that a task posted to its context reaches it once it runs, that
//               terminating it ends it, and that a task posted to the main thread's context still
//               reaches the main thread
//   graphs      a Bun.ModuleGraph with the first identifier, then one with the second, which is
//               disposed: how many identifiers each drew, and what became of what each of them
//               opened. The process then ends by itself, which it does only if what the disposed
//               graph opened afterwards was stopped
//   realms      two ShadowRealms: how many identifiers they drew, and what they evaluate
import { setNextScriptExecutionContextIdentifier } from "bun:internal-for-testing";
import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import fs from "node:fs";
import * as worker_threads from "node:worker_threads";

const [role, identifier, secondIdentifier] = process.argv.slice(2);

// A MessagePort is woken by a task posted to its context.
async function postToMainThread() {
  const { port1, port2 } = new MessageChannel();
  const received = new Promise(resolve => (port2.onmessage = event => resolve(event.data)));
  port1.postMessage("received");
  const data = await received;
  port2.close();
  return data;
}

if (role === "node") {
  setNextScriptExecutionContextIdentifier(Number(identifier));
  const worker = new worker_threads.Worker(import.meta.filename, { argv: ["node entry"] });
  const seenByParent = worker.threadId;
  const [seenByWorker] = await once(worker, "message");
  // Answered by a task posted to the worker's context.
  const heapStatistics = typeof (await worker.getHeapStatistics()).used_heap_size;
  const exitCode = await worker.terminate();
  const mainThread = await postToMainThread();
  console.log(JSON.stringify({ seenByParent, seenByWorker, heapStatistics, exitCode, mainThread }));
} else if (role === "node entry") {
  const { isMainThread, parentPort, threadId } = worker_threads;
  // What continues this script later carries the identifier of its context: a timer, and a thread pool job.
  await new Promise(resolve => setTimeout(resolve));
  await fs.promises.stat(".");
  // The listener keeps the worker alive, for the parent to terminate.
  parentPort.on("message", () => {});
  parentPort.postMessage({ isMainThread, threadId });
} else if (role === "web") {
  setNextScriptExecutionContextIdentifier(Number(identifier));
  const worker = new Worker(import.meta.url, { argv: ["web entry"] });
  const ask = message =>
    new Promise((resolve, reject) => {
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => reject(new Error(event.message));
      worker.postMessage(message);
    });
  const seenByParent = worker.threadId;
  // Queued until the worker runs.
  const whileStarting = await ask("posted while it starts");
  // Delivered by a task posted to the worker's context.
  const whileRunning = await ask("posted while it runs");
  const closed = new Promise(resolve => worker.addEventListener("close", resolve, { once: true }));
  worker.terminate();
  await closed;
  const mainThread = await postToMainThread();
  console.log(JSON.stringify({ seenByParent, whileStarting, whileRunning, mainThread }));
} else if (role === "web entry") {
  // Answers from a later turn of the loop, when the task that delivered the message has ended:
  // the next message then needs a task of its own.
  self.onmessage = event => setImmediate(() => postMessage({ echo: event.data, isMainThread: Bun.isMainThread }));
} else if (role === "graphs") {
  const until = async condition => {
    while (!condition()) await new Promise(resolve => setImmediate(resolve));
  };
  // What the script of a graph opens belongs to the graph's context: a timer, a database, and a
  // thread pool job, whose completion is a queued task.
  const ticks = { host: 0, first: 0, second: 0 };
  const jobs = { first: 0, second: 0 };
  const databases = {};
  const open = name => {
    setInterval(() => ticks[name]++, 1);
    databases[name] = new Database(":memory:");
    fs.promises.stat(".").then(() => jobs[name]++);
  };
  const isOpen = database => {
    try {
      database.query("select 1").get();
      return true;
    } catch {
      return false;
    }
  };
  const hostTimer = setInterval(() => ticks.host++, 1);

  setNextScriptExecutionContextIdentifier(Number(identifier));
  const first = new Bun.ModuleGraph();
  // The hook returns the identifier that the next context would have drawn.
  const drawnByFirst = setNextScriptExecutionContextIdentifier(Number(secondIdentifier)) - Number(identifier);
  const second = new Bun.ModuleGraph();
  const drawnBySecond = setNextScriptExecutionContextIdentifier(2 ** 40) - Number(secondIdentifier);
  first.run(open, "first");
  second.run(open, "second");
  const inSecond = second.run(() => AsyncLocalStorage.snapshot());
  await until(() => ticks.first > 0 && ticks.second > 0 && jobs.first > 0 && jobs.second > 0);

  second.dispose();
  const atDispose = { ...ticks };
  // What the script of a disposed graph still opens is stopped on the next turn of the loop.
  inSecond(() => setInterval(() => {}, 1));
  await until(() => ticks.host > atDispose.host + 5 && ticks.first > atDispose.first + 5);
  console.log(
    JSON.stringify({
      drawn: [drawnByFirst, drawnBySecond],
      ticksOfSecondAfterDispose: ticks.second - atDispose.second,
      databaseOfFirstIsOpen: isOpen(databases.first),
      databaseOfSecondIsOpen: isOpen(databases.second),
    }),
  );
  clearInterval(hostTimer);
  first.dispose();
} else if (role === "realms") {
  setNextScriptExecutionContextIdentifier(Number(identifier));
  // Each realm draws an identifier: the one that was set, then the one after it.
  const evaluated = [new ShadowRealm().evaluate("1 + 1"), new ShadowRealm().evaluate("2 + 2")];
  const drawn = setNextScriptExecutionContextIdentifier(2 ** 40) - Number(identifier);
  console.log(JSON.stringify({ drawn, evaluated }));
}
