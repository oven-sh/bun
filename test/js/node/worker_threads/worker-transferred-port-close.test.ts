// Also runs in Node.js (`node --test <file>`), so it uses node:test and imports only Node modules.
import assert from "node:assert";
import { once } from "node:events";
import { join } from "node:path";
import { describe, test } from "node:test";
import { MessageChannel, Worker } from "node:worker_threads";

describe("a MessagePort transferred to a worker that never runs is closed", () => {
  // Stays referenced, as a Worker in a pool does: a collected Worker drops its ports too.
  let worker: Worker;

  for (const route of ["workerData", "postMessage"]) {
    // Node reports 'exit' and the port's 'close' in either order, so that order is not asserted.
    test(`the entry does not resolve, port transferred through ${route}`, async () => {
      const { port1, port2 } = new MessageChannel();
      worker = new Worker(
        join(import.meta.dirname, "worker-transferred-port-close-missing-entry.cjs"),
        route === "workerData" ? { workerData: { port: port2 }, transferList: [port2] } : undefined,
      );
      const events: string[] = [];
      worker.on("online", () => events.push("online"));
      worker.on("error", (error: NodeJS.ErrnoException) => events.push(`error:${error.code}`));
      const portClosed = once(port1, "close").then(() => events.push("port-close"));
      const exited = new Promise(resolve => worker.on("exit", code => resolve(events.push(`exit:${code}`))));
      if (route === "postMessage") worker.postMessage({ port: port2 }, [port2]);

      await Promise.all([exited, portClosed]);
      assert.deepStrictEqual(
        { first: events.slice(0, 2), rest: events.slice(2).sort() },
        { first: ["online", "error:MODULE_NOT_FOUND"], rest: ["exit:1", "port-close"] },
      );
    });

    // terminate() in the same tick as the constructor stops the thread before it takes its ports.
    // The thread takes them before any user code runs, so nothing can hold it back, and a thread
    // that wins that race closes them as it exits. The exit code depends on that timing too.
    test(`terminate() stops the worker before it starts, port transferred through ${route}`, async () => {
      const { port1, port2 } = new MessageChannel();
      worker = new Worker(
        "setInterval(() => {}, 1000)",
        route === "workerData" ? { eval: true, workerData: { port: port2 }, transferList: [port2] } : { eval: true },
      );
      const portClosed = once(port1, "close").then(() => "port-close");
      if (route === "postMessage") worker.postMessage({ port: port2 }, [port2]);

      await worker.terminate();
      assert.strictEqual(await portClosed, "port-close");
    });
  }
});
