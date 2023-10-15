import wt from "worker_threads";
import {
  getEnvironmentData,
  isMainThread,
  markAsUntransferable,
  moveMessagePortToContext,
  parentPort,
  receiveMessageOnPort,
  resourceLimits,
  setEnvironmentData,
  SHARE_ENV,
  threadId,
  workerData,
  BroadcastChannel,
  MessageChannel,
  MessagePort,
  Worker,
} from "worker_threads";
test("all worker_threads module properties are present", () => {
  expect(wt).toHaveProperty("getEnvironmentData");
  expect(wt).toHaveProperty("isMainThread");
  expect(wt).toHaveProperty("markAsUntransferable");
  expect(wt).toHaveProperty("moveMessagePortToContext");
  expect(wt).toHaveProperty("parentPort");
  expect(wt).toHaveProperty("receiveMessageOnPort");
  expect(wt).toHaveProperty("resourceLimits");
  expect(wt).toHaveProperty("SHARE_ENV");
  expect(wt).toHaveProperty("setEnvironmentData");
  expect(wt).toHaveProperty("threadId");
  expect(wt).toHaveProperty("workerData");
  expect(wt).toHaveProperty("BroadcastChannel");
  expect(wt).toHaveProperty("MessageChannel");
  expect(wt).toHaveProperty("MessagePort");
  expect(wt).toHaveProperty("Worker");

  expect(getEnvironmentData).toBeDefined();
  expect(isMainThread).toBeDefined();
  expect(markAsUntransferable).toBeDefined();
  expect(moveMessagePortToContext).toBeDefined();
  expect(parentPort).toBeDefined();
  expect(receiveMessageOnPort).toBeDefined();
  expect(resourceLimits).toBeDefined();
  expect(SHARE_ENV).toBeDefined();
  expect(setEnvironmentData).toBeDefined();
  expect(threadId).toBeDefined();
  expect(workerData).toBeUndefined();
  expect(BroadcastChannel).toBeDefined();
  expect(MessageChannel).toBeDefined();
  expect(MessagePort).toBeDefined();
  expect(Worker).toBeDefined();

  expect(() => {
    // @ts-expect-error no args
    wt.markAsUntransferable();
  }).toThrow("not yet implemented");

  expect(() => {
    // @ts-expect-error no args
    wt.moveMessagePortToContext();
  }).toThrow("not yet implemented");
});

test("all worker_threads worker instance properties are present", () => {
  const worker = new Worker(new URL("./worker.js", import.meta.url).href);
  expect(worker).toHaveProperty("threadId");
  expect(worker).toHaveProperty("ref");
  expect(worker).toHaveProperty("unref");
  expect(worker).toHaveProperty("stdin");
  expect(worker).toHaveProperty("stdout");
  expect(worker).toHaveProperty("stderr");
  expect(worker).toHaveProperty("performance");
  expect(worker).toHaveProperty("terminate");
  expect(worker).toHaveProperty("postMessage");
  expect(worker).toHaveProperty("getHeapSnapshot");
  expect(worker).toHaveProperty("setMaxListeners");
  expect(worker).toHaveProperty("getMaxListeners");
  expect(worker).toHaveProperty("emit");
  expect(worker).toHaveProperty("addListener");
  expect(worker).toHaveProperty("on");
  expect(worker).toHaveProperty("prependListener");
  expect(worker).toHaveProperty("once");
  expect(worker).toHaveProperty("prependOnceListener");
  expect(worker).toHaveProperty("removeListener");
  expect(worker).toHaveProperty("off");
  expect(worker).toHaveProperty("removeAllListeners");
  expect(worker).toHaveProperty("listeners");
  expect(worker).toHaveProperty("rawListeners");
  expect(worker).toHaveProperty("listenerCount");
  expect(worker).toHaveProperty("eventNames");
});

test("receiveMessageOnPort works across threads", () => {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL("./worker.js", import.meta.url).href, {
    workerData: port2,
    transferList: [port2],
  });
  let sharedBuffer = new SharedArrayBuffer(8);
  let sharedBufferView = new Int32Array(sharedBuffer);
  let msg = { sharedBuffer };
  worker.postMessage(msg);
  Atomics.wait(sharedBufferView, 0, 0);
  const message = receiveMessageOnPort(port1);
  expect(message).toBeDefined();
  expect(message!.message).toBe("done!");
});

test("receiveMessageOnPort works with FIFO", () => {
  const { port1, port2 } = new MessageChannel();

  const message1 = { hello: "world" };
  const message2 = { foo: "bar" };

  // Make sure receiveMessageOnPort() works in a FIFO way, the same way it does
  // when we’re using events.
  expect(receiveMessageOnPort(port2)).toBe(undefined);
  port1.postMessage(message1);
  port1.postMessage(message2);
  expect(receiveMessageOnPort(port2)).toStrictEqual({ message: message1 });
  expect(receiveMessageOnPort(port2)).toStrictEqual({ message: message2 });
  expect(receiveMessageOnPort(port2)).toBe(undefined);
  expect(receiveMessageOnPort(port2)).toBe(undefined);

  // Make sure message handlers aren’t called.
  port2.on("message", () => {
    expect().fail("message handler must not be called");
  });
  port1.postMessage(message1);
  expect(receiveMessageOnPort(port2)).toStrictEqual({ message: message1 });
  port1.close();

  for (const value of [null, 0, -1, {}, []]) {
    expect(() => {
      // @ts-ignore
      receiveMessageOnPort(value);
    }).toThrow();
  }
});
