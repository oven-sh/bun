// Buffers and ports are moved by a transfer list: what is left behind is detached, typed code that holds a view sees length 0, and a wrong list is a DataCloneError that moves nothing.
function sum(bytes: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < bytes.length; i++) total += bytes[i];
  return total;
}
function sumOfDoubles(list: Float64Array): number {
  let total = 0;
  for (const value of list) total += value;
  return total;
}
const attempt = (what: string, run: () => unknown) => {
  try {
    console.log(what, "=", run());
  } catch (error) {
    console.log(what, "THROWS", (error as Error).name + ": " + (error as Error).message);
  }
};

if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  const next = () => new Promise<any>(resolve => (worker.onmessage = event => resolve(event.data)));

  const bytes = new Uint8Array(1 << 16).fill(1);
  for (let i = 0; i < 2000; i++) sum(bytes);
  console.log("before:", sum(bytes), bytes.length, bytes.byteLength, bytes.buffer.byteLength);
  let answer = next();
  worker.postMessage({ bytes }, [bytes.buffer]);
  console.log("behind the move:", sum(bytes), bytes.length, bytes.byteLength, bytes.byteOffset, bytes.buffer.byteLength, bytes.buffer.detached, bytes[0]);
  attempt("a store into it", () => ((bytes[0] = 5), bytes[0]));
  attempt("fill", () => bytes.fill(1).length);
  attempt("subarray", () => bytes.subarray(1).length);
  attempt("set", () => bytes.set([1]));
  attempt("a new view", () => new Uint8Array(bytes.buffer).length);
  attempt("a new view at 4", () => new Uint8Array(bytes.buffer, 4).length);
  attempt("slice of the buffer", () => bytes.buffer.slice(0).byteLength);
  attempt("DataView", () => new DataView(bytes.buffer).byteLength);
  let back = await answer;
  console.log("there:", back.sum, "and back:", sum(back.bytes), back.bytes.length);

  const doubles = new Float64Array(1024).fill(0.5);
  const view = new DataView(doubles.buffer, 8, 16);
  answer = next();
  worker.postMessage({ doubles, view }, { transfer: [doubles.buffer] });
  attempt("a walk over the doubles behind the move", () => sumOfDoubles(doubles));
  console.log("their length:", doubles.length);
  attempt("the DataView's length", () => view.byteLength);
  attempt("the DataView's read", () => view.getFloat64(0));
  back = await answer;
  console.log("there:", back.sum, back.sameBuffer, back.view);

  const a = new ArrayBuffer(8), b = new ArrayBuffer(8);
  attempt("twice in one list", () => worker.postMessage(a, [a, a]));
  console.log("a is whole:", a.byteLength, a.detached);
  attempt("a function beside a buffer", () => worker.postMessage({ a, f() {} }, [a]));
  console.log("a is whole:", a.byteLength, a.detached);
  attempt("what cannot be moved", () => worker.postMessage(1, [{} as any]));
  attempt("a view in the list", () => worker.postMessage(1, [new Uint8Array(1) as any]));
  attempt("shared memory in the list", () => worker.postMessage(1, [new SharedArrayBuffer(1) as any]));
  attempt("null in the list", () => worker.postMessage(1, [null as any]));
  attempt("a list that is no list", () => worker.postMessage(1, 5 as any));
  attempt("moved by structuredClone", () => structuredClone(b, { transfer: [b] }).byteLength);
  attempt("moved again", () => structuredClone(b, { transfer: [b] }).byteLength);
  attempt("posted when detached", () => worker.postMessage(b, [b]));
  attempt("moved and not named in the message", () => { const c = new ArrayBuffer(4); const r = structuredClone(1, { transfer: [c] }); return [r, c.byteLength]; });
  attempt("transfer()", () => { const c = new ArrayBuffer(4); const d = c.transfer(16); return [c.detached, d.byteLength]; });
  attempt("a resizable one", () => { const c = new ArrayBuffer(4, { maxByteLength: 16 }); const v = new Uint8Array(c); const d = structuredClone(c, { transfer: [c] }); d.resize(12); return [v.length, d.byteLength, d.resizable, d.maxByteLength]; });
  attempt("an iterable as the list", () => { const c = new ArrayBuffer(4); structuredClone(c, { transfer: new Set([c]) as any }); return c.byteLength; });
  attempt("a getter that detaches in the middle", () => { const c = new ArrayBuffer(4); return (structuredClone({ get first() { c.transfer(); return 1; }, c }) as any).c.byteLength; });

  const { port1, port2 } = new MessageChannel();
  answer = next();
  worker.postMessage({ port: port2 }, [port2]);
  attempt("the same port again", () => worker.postMessage({ port: port2 }, [port2]));
  attempt("a port not in the list", () => worker.postMessage({ port: port1 }));
  attempt("a port through itself", () => port1.postMessage(port1, [port1]));
  console.log(await answer);
  const overPort = new Promise<any>(resolve => (port1.onmessage = event => resolve(event.data)));
  const moved = new Uint8Array(100).fill(2);
  port1.postMessage(moved, [moved.buffer]);
  console.log("over the port:", await overPort, moved.length);
  port1.close();

  let total = 0;
  for (let round = 0; round < 300; round++) {
    const chunk = new Uint8Array(4096).fill(round & 3);
    answer = next();
    worker.postMessage({ bytes: chunk }, [chunk.buffer]);
    total += sum(chunk) + (await answer).sum;
  }
  console.log("three hundred moves:", total);
  worker.terminate();
} else {
  addEventListener("message", (event: MessageEvent<any>) => {
    const data = event.data;
    if (data.bytes) postMessage({ sum: sum(data.bytes), bytes: data.bytes }, [data.bytes.buffer]);
    else if (data.doubles) postMessage({ sum: sumOfDoubles(data.doubles), sameBuffer: data.doubles.buffer === data.view.buffer, view: data.view.getFloat64(0) });
    else if (data.port) {
      data.port.onmessage = (message: MessageEvent<Uint8Array>) => data.port.postMessage(sum(message.data));
      postMessage("has the port");
    }
  });
}
