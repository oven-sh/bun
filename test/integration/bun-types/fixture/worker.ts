import { Worker as NodeWorker } from "node:worker_threads";
import * as tsd from "./utilities";

const webWorker = new Worker("./worker.js");

webWorker.addEventListener("message", event => {
  tsd.expectType<MessageEvent>(event);
});
webWorker.addEventListener("error", event => {
  tsd.expectType<ErrorEvent>(event);
});
webWorker.addEventListener("messageerror", event => {
  tsd.expectType<MessageEvent>(event);
});
webWorker.onmessage = ev => "asdf";
webWorker.onmessageerror = ev => "asdf";
webWorker.postMessage("asdf", []);
webWorker.terminate();
webWorker.addEventListener("close", () => {});
webWorker.removeEventListener("sadf", () => {});

// these methods don't exist if lib.dom.d.ts is present
webWorker.ref();
webWorker.unref();
webWorker.threadId;

const nodeWorker = new NodeWorker("./worker.ts");
nodeWorker.on("message", event => {
  console.log("Message from worker:", event);
});
nodeWorker.postMessage("Hello from main thread!");

const workerURL = new URL("worker.ts", "/path/to/").href;
const _worker2 = new Worker(workerURL);

nodeWorker.postMessage("hello");
webWorker.onmessage = event => {
  console.log(event.data);
};

// On the worker thread, `postMessage` is automatically "routed" to the parent thread.
postMessage({ hello: "world" });

// On the worker thread, the global is a DedicatedWorkerGlobalScope with a `location`.
tsd.expectType<string>(location.href);
tsd.expectType<string>(location.origin);
tsd.expectType<string>(location.pathname);
tsd.expectType<WorkerLocation>(location);
if (globalThis instanceof WorkerGlobalScope) {
  tsd.expectType<WorkerLocation>(globalThis.location);
}
tsd.expectType<boolean>(globalThis instanceof DedicatedWorkerGlobalScope);
tsd.expectType<DedicatedWorkerGlobalScope>(DedicatedWorkerGlobalScope.prototype);
declare const workerSelf: DedicatedWorkerGlobalScope;
workerSelf.postMessage({ a: 1 }, []);
workerSelf.postMessage({ a: 1 });
workerSelf.onmessage = e => {
  tsd.expectType<MessageEvent>(e);
};
workerSelf.onerror = e => {
  tsd.expectType<ErrorEvent>(e);
};
workerSelf.addEventListener("message", e => {
  tsd.expectType<MessageEvent>(e);
});
tsd.expectType<WorkerLocation>(workerSelf.location);
tsd.expectType<WorkerLocation>(workerSelf.self.location);

// On the main thread
nodeWorker.postMessage({ hello: "world" });

// ...some time later

await nodeWorker.terminate();

// Bun.pathToFileURL
const _worker3 = new Worker(new URL("worker.ts", "/path/to/").href, {
  ref: true,
  smol: true,
  credentials: "same-origin",
  name: "a name",
  env: {
    envValue: "hello",
  },
});

export { _worker2, _worker3, nodeWorker as worker };
