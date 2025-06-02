import { expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { MessageChannel } from "worker_threads";

test("MessagePort operations during spawnSync don't cause issues", async () => {
  const { port1, port2 } = new MessageChannel();

  const messages: string[] = [];
  let messageReceived = false;

  const { promise, resolve } = Promise.withResolvers<void>();

  port2.on("message", msg => {
    messages.push(msg);
    messageReceived = true;
    resolve();
  });

  port2.start();

  port1.postMessage("before-spawn");

  await promise;

  const result = spawnSync("echo", ["hello"], { encoding: "utf8" });

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("hello");
  expect(messageReceived).toBe(true);
  expect(messages).toContain("before-spawn");

  const { promise: promise2, resolve: resolve2 } = Promise.withResolvers<void>();

  port2.once("message", msg => {
    messages.push(msg);
    resolve2();
  });

  port1.postMessage("after-spawn");
  await promise2;

  expect(messages).toEqual(["before-spawn", "after-spawn"]);

  port1.close();
  port2.close();
});

test("immediate C++ tasks queue correctly during spawnSync", async () => {
  const { port1, port2 } = new MessageChannel();

  const executionOrder: string[] = [];
  let messagesReceived = 0;

  const { promise, resolve } = Promise.withResolvers<void>();

  port2.on("message", msg => {
    executionOrder.push(`received: ${msg}`);
    messagesReceived++;

    if (messagesReceived === 2) {
      resolve();
    }
  });

  port2.start();

  port1.postMessage("msg1");

  const startTime = Date.now();
  const result = spawnSync("sleep", ["0.1"], { encoding: "utf8" });
  const endTime = Date.now();

  port1.postMessage("msg2");

  queueMicrotask(() => {
    executionOrder.push("microtask-1");
  });

  queueMicrotask(() => {
    executionOrder.push("microtask-2");
  });

  await promise;

  await new Promise(resolve => setImmediate(resolve));

  expect(result.status).toBe(0);
  expect(endTime - startTime).toBeGreaterThan(50);

  expect(executionOrder).toContain("received: msg1");
  expect(executionOrder).toContain("received: msg2");
  expect(executionOrder).toContain("microtask-1");
  expect(executionOrder).toContain("microtask-2");

  port1.close();
  port2.close();
});

test("multiple MessagePorts work correctly during spawnSync", async () => {
  const { port1: p1a, port2: p1b } = new MessageChannel();
  const { port1: p2a, port2: p2b } = new MessageChannel();

  const channel1Messages: string[] = [];
  const channel2Messages: string[] = [];

  let totalMessages = 0;
  const { promise, resolve } = Promise.withResolvers<void>();

  p1b.on("message", msg => {
    channel1Messages.push(msg);
    totalMessages++;
    if (totalMessages === 4) resolve();
  });

  p2b.on("message", msg => {
    channel2Messages.push(msg);
    totalMessages++;
    if (totalMessages === 4) resolve();
  });

  p1b.start();
  p2b.start();

  p1a.postMessage("channel1-msg1");
  p2a.postMessage("channel2-msg1");

  const result = spawnSync("echo", ["spawn-test"], { encoding: "utf8" });

  p1a.postMessage("channel1-msg2");
  p2a.postMessage("channel2-msg2");

  await promise;

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("spawn-test");

  expect(channel1Messages).toEqual(["channel1-msg1", "channel1-msg2"]);
  expect(channel2Messages).toEqual(["channel2-msg1", "channel2-msg2"]);

  p1a.close();
  p1b.close();
  p2a.close();
  p2b.close();
});
