// Host for structured-clone-shared-array-buffer.test.ts. Sends one message that repeats a
// shared WebAssembly.Memory and a WebAssembly.Module through every structured clone route,
// and prints what each receiver got as JSON.
import { structuredCloneAdvanced } from "bun:internal-for-testing";
import {
  getEnvironmentData,
  isMainThread,
  Worker as NodeWorker,
  parentPort,
  receiveMessageOnPort,
  setEnvironmentData,
  workerData,
} from "node:worker_threads";

type Message = {
  list: [WebAssembly.Memory, WebAssembly.Memory, WebAssembly.Module, WebAssembly.Module, { x: number }];
  nested: {
    memory: WebAssembly.Memory;
    module: WebAssembly.Module;
    map: Map<string, WebAssembly.Memory>;
    set: Set<WebAssembly.Module>;
    first: { x: number };
  };
};

function identity({ list: [memory, memoryAgain, module, moduleAgain, first], nested }: Message) {
  return {
    memory: memory instanceof WebAssembly.Memory && memory.buffer instanceof SharedArrayBuffer,
    module: module instanceof WebAssembly.Module,
    sameMemory: memoryAgain === memory && nested.memory === memory && nested.map.get("memory") === memory,
    sameModule: moduleAgain === module && nested.module === module && nested.set.has(module),
    // A plain object that repeats after the WebAssembly objects. Its back-reference is
    // right only if the reader's object pool holds the same entries as the writer's.
    sameObject: nested.first === first && first.x === 1,
  };
}

if (!isMainThread) {
  const port = parentPort!;
  port.postMessage({
    workerData: identity(workerData),
    environmentData: identity(getEnvironmentData("message") as Message),
  });
  port.on("message", (data: Message) => port.postMessage({ received: identity(data), echo: data }));
} else {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
  const module = new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  const first = { x: 1 };
  const message = (): Message => ({
    list: [memory, memory, module, module, first],
    nested: { memory, module, map: new Map([["memory", memory]]), set: new Set([module]), first },
  });

  const clone = structuredClone(message());
  new Uint8Array(memory.buffer)[0] = 42;
  const cloneSharesMemory = clone.list[0] !== memory && new Uint8Array(clone.list[0].buffer)[0] === 42;

  // The only route to the window context, where a Module can be cloned and a Memory cannot.
  const [windowModule, windowModuleAgain] = structuredCloneAdvanced([module, module], [], false, false, "window");

  const { port1, port2 } = new MessageChannel();
  port1.postMessage(message());
  const polled: Message = receiveMessageOnPort(port2)!.message;
  const delivered = Promise.withResolvers<Message>();
  port2.onmessage = event => delivered.resolve(event.data);
  port2.onmessageerror = () => delivered.reject(new Error("messageerror on the MessagePort"));
  port1.postMessage(message());
  const evented = await delivered.promise;
  port1.close();
  port2.close();

  const sender = new BroadcastChannel("wasm-identity");
  const receivers = [new BroadcastChannel("wasm-identity"), new BroadcastChannel("wasm-identity")];
  const broadcasts = receivers.map(receiver => {
    const { promise, resolve, reject } = Promise.withResolvers<Message>();
    receiver.onmessage = event => resolve(event.data);
    receiver.onmessageerror = () => reject(new Error("messageerror on the BroadcastChannel"));
    return promise;
  });
  sender.postMessage(message());
  const [broadcastA, broadcastB] = await Promise.all(broadcasts);
  sender.close();
  for (const receiver of receivers) receiver.close();

  setEnvironmentData("message", message());
  const nodeWorker = new NodeWorker(new URL(import.meta.url), { workerData: message() });
  const replies: any[] = [];
  const replied = Promise.withResolvers<void>();
  nodeWorker.on("error", replied.reject);
  nodeWorker.on("messageerror", replied.reject);
  nodeWorker.on("exit", code => replied.reject(new Error(`worker exited with code ${code}`)));
  nodeWorker.on("message", reply => {
    replies.push(reply);
    if (replies.length === 1) nodeWorker.postMessage(message());
    else replied.resolve();
  });
  await replied.promise;
  await nodeWorker.terminate();

  const webWorker = new Worker(
    URL.createObjectURL(
      new Blob(["self.onmessage = event => postMessage(event.data);"], { type: "application/javascript" }),
    ),
  );
  const echoed = Promise.withResolvers<Message>();
  webWorker.onmessage = event => echoed.resolve(event.data);
  webWorker.onmessageerror = () => echoed.reject(new Error("messageerror on the web Worker"));
  webWorker.onerror = event => echoed.reject(new Error(event.message));
  webWorker.postMessage(message());
  const webWorkerEcho = await echoed.promise;
  webWorker.terminate();

  // Identity belongs to the JS object: two objects over one native handle stay two.
  const contract = (x: WebAssembly.Memory | WebAssembly.Module) => {
    const other = structuredClone(x);
    const [a, b, c] = structuredClone([x, other, x]);
    const [d, e] = structuredClone(structuredClone([x, x]));
    return {
      distinctObjectsStayDistinct: a !== b && a === c && a !== x,
      cloneOfClone: d === e,
      separateCallsGiveSeparateClones: structuredClone(x) !== structuredClone(x),
    };
  };

  const zero = () => new WebAssembly.Memory({ initial: 0, maximum: 0, shared: true });
  const [zeroA, zeroB] = [zero(), zero()];
  const zeros = structuredClone([zeroA, zeroB, zeroA]);

  const buffer = new ArrayBuffer(8);
  const moved = structuredClone(
    { memories: [memory, memory], buffers: [buffer, buffer], modules: [module, module] },
    { transfer: [buffer] },
  );

  const unshared = new WebAssembly.Memory({ initial: 1 });
  let unsharedError = "none";
  try {
    structuredClone([unshared, unshared]);
  } catch (error) {
    unsharedError = (error as Error).name;
  }

  // `poolEntries` is the size of the object pool when the back-reference to `first` is
  // written: the array, `first`, the filler objects and the Module. The index of a
  // back-reference is one byte wide up to 255 entries and two bytes wide from 256.
  const backReferenceAt = (poolEntries: number) => {
    const filler = Array.from({ length: poolEntries - 3 }, () => ({}));
    const wide = structuredClone([first, ...filler, module, first, module]);
    return wide.at(-2) === wide[0] && wide.at(-1) === wide.at(-3) && wide.at(-1) instanceof WebAssembly.Module;
  };

  console.log(
    JSON.stringify({
      structuredClone: identity(clone),
      receiveMessageOnPort: identity(polled),
      messagePortEvent: identity(evented),
      broadcastChannel: [identity(broadcastA), identity(broadcastB)],
      workerData: replies[0].workerData,
      environmentData: replies[0].environmentData,
      workerPostMessage: replies[1].received,
      parentPortPostMessage: identity(replies[1].echo),
      webWorker: identity(webWorkerEcho),
      windowContextModule: windowModule instanceof WebAssembly.Module && windowModuleAgain === windowModule,
      cloneSharesMemory,
      separatePostsGiveSeparateClones: polled.list[0] !== evented.list[0] && polled.list[2] !== evented.list[2],
      broadcastReceiversGetSeparateClones:
        broadcastA.list[0] !== broadcastB.list[0] && broadcastA.list[2] !== broadcastB.list[2],
      memory: contract(memory),
      module: contract(module),
      zeroSizedMemories:
        zeros[0] !== zeros[1] &&
        zeros[0] === zeros[2] &&
        zeros.every(({ buffer }) => buffer.byteLength === 0 && buffer instanceof SharedArrayBuffer),
      withTransferList:
        moved.memories[0] === moved.memories[1] &&
        moved.modules[0] === moved.modules[1] &&
        moved.buffers[0] === moved.buffers[1] &&
        moved.buffers[0].byteLength === 8 &&
        buffer.byteLength === 0,
      unsharedError,
      backReferenceAt255: backReferenceAt(255),
      backReferenceAt256: backReferenceAt(256),
    }),
  );
}
