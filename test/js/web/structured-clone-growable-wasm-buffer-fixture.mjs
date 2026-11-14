// Prints as JSON what a clone of a shared WebAssembly.Memory's growable buffer can do to the memory,
// for each route that makes a clone. With the argument "worker" the clones go to a node:worker_threads
// Worker, which is this file again.
import { fileURLToPath } from "node:url";
import {
  getEnvironmentData,
  isMainThread,
  parentPort,
  receiveMessageOnPort,
  setEnvironmentData,
  Worker,
  workerData,
} from "node:worker_threads";

const page = 65536;
const maximum = 64;

// Asks one clone for one byte more, then for one page more. The second grow adds one page to the memory.
const probe = clone => {
  const length = clone.byteLength;
  const attempt = newLength => {
    try {
      clone.grow(newLength);
      return clone.byteLength === length + page ? "grows" : `grew to ${clone.byteLength} bytes`;
    } catch (e) {
      return e instanceof RangeError && clone.byteLength === length ? "RangeError" : `${e.name}: ${e.message}`;
    }
  };
  return {
    "1 byte more": attempt(length + 1),
    "1 page more": `${clone.growable ? "growable" : "fixed length"}, ${attempt(length + page)}`,
  };
};

// Turns { route: clone } into { "1 byte more": { route: outcome }, "1 page more": { route: outcome } }.
const probeEach = clones => {
  const result = { "1 byte more": {}, "1 page more": {} };
  for (const [route, clone] of Object.entries(clones))
    for (const [request, outcome] of Object.entries(probe(clone))) result[request][route] = outcome;
  return result;
};

if (isMainThread) {
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  // (module
  //   (import "e" "m" (memory 1 64 shared))
  //   (func (export "size") (result i32) memory.size)
  //   (func (export "grow") (param i32) (result i32) (memory.grow (local.get 0))))
  const importing = new WebAssembly.Module(
    new Uint8Array([
      ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
      ...section(1, [2, 0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]),
      ...section(2, [1, 1, 0x65, 1, 0x6d, 0x02, 0x03, 1, maximum]),
      ...section(3, [2, 0, 1]),
      ...section(7, [2, 4, 0x73, 0x69, 0x7a, 0x65, 0x00, 0, 4, 0x67, 0x72, 0x6f, 0x77, 0x00, 1]),
      ...section(10, [2, 4, 0, 0x3f, 0, 0x0b, 6, 0, 0x20, 0, 0x40, 0, 0x0b]),
    ]),
  );
  const create = () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum, shared: true });
    return { memory, wasm: new WebAssembly.Instance(importing, { e: { m: memory } }).exports };
  };
  // How the memory looks to its own API and to wasm code, and whether both can still grow it.
  const state = ({ memory, wasm }) => ({
    "memory.size instruction": wasm.size(),
    "memory.buffer pages": memory.buffer.byteLength / page,
    "Memory.prototype.grow(1)": memory.grow(1),
    "memory.grow instruction": wasm.grow(1),
  });

  const subject = create();
  const source = subject.memory.toResizableBuffer();
  let result;

  if (process.argv[2] === "worker") {
    // workerData and the environment data travel in one message. A second reference to one object in a
    // message is not a second clone, so the environment data gets a buffer object of its own.
    setEnvironmentData("buffer", structuredClone(source));
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: source });
    const fromWorker = new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`the Worker exited with code ${code}`)));
    });
    worker.postMessage(source);
    // The Worker grows the memory from its own thread, then sends its buffer back.
    const { probed, buffer } = await fromWorker;
    const back = probeEach({ "parentPort.postMessage": buffer });
    result = {
      "1 byte more": { ...probed["1 byte more"], ...back["1 byte more"] },
      "1 page more": { ...probed["1 page more"], ...back["1 page more"] },
    };
    await worker.terminate();
  } else {
    const { port1, port2 } = new MessageChannel();
    port1.postMessage(source);
    const received = receiveMessageOnPort(port2).message;
    const event = new Promise((resolve, reject) => {
      port2.onmessage = ({ data }) => resolve(data);
      port2.onmessageerror = reject;
    });
    port1.postMessage(source);
    const delivered = await event;
    port1.close();
    port2.close();

    const sender = new BroadcastChannel("buffer");
    const listeners = [new BroadcastChannel("buffer"), new BroadcastChannel("buffer")];
    const broadcast = Promise.all(
      listeners.map(
        listener =>
          new Promise((resolve, reject) => {
            listener.onmessage = ({ data }) => resolve(data);
            listener.onmessageerror = reject;
          }),
      ),
    );
    sender.postMessage(source);
    const [first, second] = await broadcast;
    for (const channel of [sender, ...listeners]) channel.close();

    result = probeEach({
      "structuredClone of the buffer": structuredClone(source),
      "structuredClone of a length-tracking Uint8Array": structuredClone(new Uint8Array(source)).buffer,
      "structuredClone of a DataView in an object": structuredClone({ views: [new DataView(source)] }).views[0].buffer,
      "structuredClone of a clone": structuredClone(structuredClone(source)),
      "MessageChannel, receiveMessageOnPort": received,
      "MessageChannel, message event": delivered,
      "BroadcastChannel, first listener": first,
      "BroadcastChannel, second listener": second,
    });

    const plain = new SharedArrayBuffer(8, { maxByteLength: 2 * page });
    structuredClone(plain).grow(9);
    result.controls = {
      "a memory with no clone": state(create()),
      "the clone of a memory's fixed-length buffer is growable": structuredClone(create().memory.buffer).growable,
      "bytes of a plain growable SharedArrayBuffer of 8 bytes after its clone grows it by 1 byte": plain.byteLength,
    };
  }

  result["the memory after the clones"] = {
    "memory.buffer is the cloned buffer": subject.memory.buffer === source,
    ...state(subject),
  };
  console.log(JSON.stringify(result, null, 2));
} else {
  parentPort.once("message", buffer => {
    parentPort.postMessage({
      probed: probeEach({
        workerData,
        environmentData: getEnvironmentData("buffer"),
        "worker.postMessage": buffer,
      }),
      buffer,
    });
  });
}
