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

// On the main thread
nodeWorker.postMessage({ hello: "world" });

// ...some time later

await nodeWorker.terminate();

// Inside a worker, an uncaught error is dispatched to the worker's own global
// scope as an ErrorEvent, so the global EventMap types "error" as ErrorEvent.
{
  addEventListener("error", event => {
    tsd.expectType(event).is<ErrorEvent>();
    tsd.expectType(event.message).is<string>();
    tsd.expectType(event.error).is<any>();
  });
  globalThis.addEventListener("error", event => {
    tsd.expectType(event).is<ErrorEvent>();
  });
  removeEventListener("error", event => {
    tsd.expectType(event).is<ErrorEvent>();
  });

  const onError = (event: ErrorEvent) => event.error;
  addEventListener("error", onError);
  removeEventListener("error", onError);
  addEventListener("error", onError, { once: true });
  removeEventListener("error", onError, { capture: false });
}

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
