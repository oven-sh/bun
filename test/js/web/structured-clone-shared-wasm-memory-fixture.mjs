// Prints as JSON what each clone route does to a shared WebAssembly.Memory.
// Runs as the main thread, as a node:worker_threads Worker and as a Web Worker.
import { fileURLToPath } from "node:url";
import {
  getEnvironmentData,
  isMainThread,
  Worker as NodeWorker,
  parentPort,
  receiveMessageOnPort,
  setEnvironmentData,
  workerData,
} from "node:worker_threads";

const section = (id, bytes) => [id, bytes.length, ...bytes];
// (module
//   (import "e" "m" (memory <address> 1 2 shared))
//   (func (export "add") (result i32)
//     (i32.atomic.rmw.add (<address>.const 16) (i32.const 1))))
const importing = address =>
  new WebAssembly.Module(
    new Uint8Array([
      ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
      ...section(1, [1, 0x60, 0, 1, 0x7f]),
      ...section(2, [1, 1, 0x65, 1, 0x6d, 0x02, address === "i64" ? 0x07 : 0x03, 1, 2]),
      ...section(3, [1, 0]),
      ...section(7, [1, 3, 0x61, 0x64, 0x64, 0x00, 0]),
      ...section(10, [1, 10, 0, address === "i64" ? 0x42 : 0x41, 16, 0x41, 1, 0xfe, 0x1e, 2, 0, 0x0b]),
    ]),
  );

const create = address =>
  address === "i64"
    ? new WebAssembly.Memory({ address, initial: 1n, maximum: 2n, shared: true })
    : new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });

// grow() takes a BigInt on an i64 memory and a number on an i32 memory.
const addressType = memory => {
  try {
    memory.grow(0n);
    return "i64";
  } catch {
    memory.grow(0);
    return "i32";
  }
};

// Whether a module that imports a memory of this address type instantiates on `memory`.
const link = (address, memory) => {
  try {
    new WebAssembly.Instance(importing(address), { e: { m: memory } });
    return "links";
  } catch (e) {
    return e.name;
  }
};

const report = memory => `${addressType(memory)}, i64 module ${link("i64", memory)}, i32 module ${link("i32", memory)}`;

// Adds 1000 to the counter at address 16 through an i64 module, then reads the counter.
const count = memory => {
  try {
    const { add } = new WebAssembly.Instance(importing("i64"), { e: { m: memory } }).exports;
    for (let i = 0; i < 1000; i++) add();
    return new Uint32Array(memory.buffer)[4];
  } catch (e) {
    return e.name;
  }
};

if (isMainThread) {
  const i64 = create("i64");
  const i32 = create("i32");
  const result = {};

  const both = structuredClone({ a: i64, b: "after i64", c: i32, d: "after i32" });
  result.structuredClone = {
    i64: report(structuredClone(i64)),
    i32: report(structuredClone(i32)),
    "clone of a clone": report(structuredClone(structuredClone(i64))),
    // The value after each memory shows that the reader took the whole record.
    "both in one message": [report(both.a), both.b, report(both.c), both.d],
  };

  const { port1, port2 } = new MessageChannel();
  port1.postMessage(i64);
  const received = receiveMessageOnPort(port2).message;
  const event = new Promise((resolve, reject) => {
    port2.onmessage = ({ data }) => resolve(report(data));
    port2.onmessageerror = reject;
  });
  port1.postMessage(i64);
  result.MessageChannel = { receiveMessageOnPort: report(received), "message event": await event };
  port1.close();
  port2.close();

  const sender = new BroadcastChannel("memory");
  const listeners = [new BroadcastChannel("memory"), new BroadcastChannel("memory")];
  const broadcast = Promise.all(
    listeners.map(
      listener =>
        new Promise((resolve, reject) => {
          listener.onmessage = ({ data }) => resolve(report(data));
          listener.onmessageerror = reject;
        }),
    ),
  );
  sender.postMessage(i64);
  result.BroadcastChannel = await broadcast;
  for (const channel of [sender, ...listeners]) channel.close();

  const webWorker = new Worker(import.meta.url);
  const fromWebWorker = new Promise((resolve, reject) => {
    webWorker.onmessage = ({ data }) => resolve(data);
    webWorker.onmessageerror = reject;
    webWorker.onerror = reject;
  });
  webWorker.postMessage(i64);
  const web = await fromWebWorker;
  result["Web Worker"] = { received: web.received, "sent back": report(web.memory) };
  webWorker.terminate();

  setEnvironmentData("memory", i64);
  const countInMainThread = count(i64);
  const nodeWorker = new NodeWorker(fileURLToPath(import.meta.url), { workerData: { i64, i32 } });
  const fromNodeWorker = new Promise((resolve, reject) => {
    nodeWorker.once("message", resolve);
    nodeWorker.once("error", reject);
    nodeWorker.once("exit", code => reject(new Error(`the Worker exited with code ${code}`)));
  });
  nodeWorker.postMessage(i64);
  const node = await fromNodeWorker;
  result["node:worker_threads"] = { ...node.routes, "parentPort.postMessage": report(node.memory) };
  // Each thread adds 1000 to the one counter through an i64 module.
  result.counter = { "main thread": countInMainThread, Worker: node.count };
  await nodeWorker.terminate();

  console.log(JSON.stringify(result, null, 2));
} else if (workerData) {
  parentPort.once("message", memory => {
    parentPort.postMessage({
      routes: {
        workerData: { i64: report(workerData.i64), i32: report(workerData.i32) },
        environmentData: report(getEnvironmentData("memory")),
        postMessage: report(memory),
      },
      count: count(memory),
      memory,
    });
  });
} else {
  self.onmessage = ({ data }) => postMessage({ received: report(data), memory: data });
}
