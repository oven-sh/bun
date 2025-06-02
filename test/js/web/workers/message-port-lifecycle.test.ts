import assert from "node:assert";
import { test } from "node:test";
import { MessageChannel, receiveMessageOnPort, Worker } from "worker_threads";

test("MessagePort postMessage uses immediate C++ tasks correctly", async () => {
  const { port1, port2 } = new MessageChannel();

  const messages: string[] = [];
  let messageCount = 0;

  const { promise, resolve } = Promise.withResolvers<void>();

  port2.on("message", msg => {
    messages.push(`received: ${msg}`);
    messageCount++;

    if (messageCount === 3) {
      resolve();
    }
  });

  port2.start();

  setImmediate(() => {
    messages.push("setImmediate 1");
    port1.postMessage("message1");
  });

  setImmediate(() => {
    messages.push("setImmediate 2");
    port1.postMessage("message2");
  });

  setImmediate(() => {
    messages.push("setImmediate 3");
    port1.postMessage("message3");
  });

  await promise;

  assert.deepStrictEqual(messages, [
    "setImmediate 1",
    "setImmediate 2",
    "setImmediate 3",
    "received: message1",
    "received: message2",
    "received: message3",
  ]);

  port1.close();
  port2.close();
});

test("MessagePort messages execute after process.nextTick (Node.js compatibility)", async () => {
  const { port1, port2 } = new MessageChannel();

  const executionOrder: string[] = [];
  let messageReceived = false;

  const { promise, resolve } = Promise.withResolvers<void>();

  port2.on("message", () => {
    executionOrder.push("message received");
    messageReceived = true;
    resolve();
  });

  port2.start();

  port1.postMessage("test");

  process.nextTick(() => {
    executionOrder.push("nextTick 1");
  });

  process.nextTick(() => {
    executionOrder.push("nextTick 2");
  });

  await promise;

  await new Promise(resolve => setImmediate(resolve));

  assert.strictEqual(messageReceived, true);
  assert.strictEqual(executionOrder[0], "nextTick 1");
  assert.strictEqual(executionOrder[1], "nextTick 2");
  assert.strictEqual(executionOrder[2], "message received");

  port1.close();
  port2.close();
});

test("MessagePort immediate C++ tasks work with workers", async () => {
  const worker = new Worker(
    `
    const { parentPort, MessageChannel } = require('worker_threads');
    
    parentPort.on('message', ({ port }) => {
      let count = 0;
      
      port.on('message', (msg) => {
        count++;
        
        port.postMessage(\`echo-\${count}: \${msg}\`);
        
        if (count >= 3) {
          port.close();
          parentPort.postMessage('done');
        }
      });
      
      port.start();
      parentPort.postMessage('ready');
    });
    `,
    { eval: true },
  );

  const { port1, port2 } = new MessageChannel();

  const messages: string[] = [];
  let readyReceived = false;
  let doneReceived = false;

  const { promise, resolve } = Promise.withResolvers<void>();

  worker.on("message", msg => {
    if (msg === "ready") {
      readyReceived = true;

      port1.postMessage("hello1");
      port1.postMessage("hello2");
      port1.postMessage("hello3");
    } else if (msg === "done") {
      doneReceived = true;
      resolve();
    }
  });

  port1.on("message", msg => {
    messages.push(msg);
  });

  worker.postMessage({ port: port2 }, [port2]);

  await promise;

  assert.strictEqual(readyReceived, true);
  assert.strictEqual(doneReceived, true);
  assert.strictEqual(messages.length, 3);
  assert.deepStrictEqual(messages, ["echo-1: hello1", "echo-2: hello2", "echo-3: hello3"]);

  port1.close();
  worker.terminate();
});

test("immediate C++ tasks don't starve microtasks", async () => {
  const { port1, port2 } = new MessageChannel();

  const executionOrder: string[] = [];
  let messageCount = 0;

  const { promise, resolve } = Promise.withResolvers<void>();

  port2.on("message", () => {
    messageCount++;
    executionOrder.push(`message-${messageCount}`);

    if (messageCount === 3) {
      resolve();
    }
  });

  port2.start();

  queueMicrotask(() => {
    executionOrder.push("microtask-1");
  });

  port1.postMessage("msg1");

  queueMicrotask(() => {
    executionOrder.push("microtask-2");
  });

  port1.postMessage("msg2");

  queueMicrotask(() => {
    executionOrder.push("microtask-3");
  });

  port1.postMessage("msg3");

  await promise;

  assert(executionOrder.includes("microtask-1"));
  assert(executionOrder.includes("microtask-2"));
  assert(executionOrder.includes("microtask-3"));
  assert(executionOrder.includes("message-1"));
  assert(executionOrder.includes("message-2"));
  assert(executionOrder.includes("message-3"));

  port1.close();
  port2.close();
});

test("high volume MessagePort operations maintain order", async () => {
  const { port1, port2 } = new MessageChannel();

  const TOTAL_MESSAGES = 100;
  const receivedMessages: number[] = [];

  const { promise, resolve } = Promise.withResolvers<void>();

  port2.on("message", msg => {
    receivedMessages.push(msg);

    if (receivedMessages.length === TOTAL_MESSAGES) {
      resolve();
    }
  });

  port2.start();

  for (let i = 0; i < TOTAL_MESSAGES; i++) {
    port1.postMessage(i);
  }

  await promise;

  assert.strictEqual(receivedMessages.length, TOTAL_MESSAGES);
  for (let i = 0; i < TOTAL_MESSAGES; i++) {
    assert.strictEqual(receivedMessages[i], i);
  }

  port1.close();
  port2.close();
});

test("MessagePort close behavior with immediate C++ tasks", async () => {
  const { port1, port2 } = new MessageChannel();

  let messageReceived = false;
  let errorThrown = false;

  const { promise, resolve } = Promise.withResolvers<void>();

  port2.on("message", () => {
    messageReceived = true;

    port2.close();

    try {
      port1.postMessage("after-close");
    } catch (e) {
      errorThrown = true;
    }

    setTimeout(resolve, 10);
  });

  port2.start();
  port1.postMessage("test");

  await promise;

  assert.strictEqual(messageReceived, true);

  assert.strictEqual(errorThrown, false);

  port1.close();
});

test("receiveMessageOnPort works with immediate C++ tasks", () => {
  const { port1, port2 } = new MessageChannel();

  port1.postMessage("msg1");
  port1.postMessage("msg2");
  port1.postMessage("msg3");

  const result1 = receiveMessageOnPort(port2);
  const result2 = receiveMessageOnPort(port2);
  const result3 = receiveMessageOnPort(port2);
  const result4 = receiveMessageOnPort(port2);

  assert.strictEqual(result1?.message, "msg1");
  assert.strictEqual(result2?.message, "msg2");
  assert.strictEqual(result3?.message, "msg3");
  assert.strictEqual(result4, undefined);

  port1.close();
  port2.close();
});
