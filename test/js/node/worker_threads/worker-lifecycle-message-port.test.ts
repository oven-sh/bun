import assert from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isMainThread, MessageChannel, MessagePort, parentPort, Worker } from "node:worker_threads";

interface StartupMessage {
  port: MessagePort;
}

if (parentPort) {
  parentPort.on("message", (message: StartupMessage) => {
    console.log("Worker received startup message");

    message.port.postMessage("hello");
    message.port.close();
  });
} else {
  test("worker lifecycle message port", async () => {
    const worker = new Worker(fileURLToPath(import.meta.url));

    const { port1, port2 } = new MessageChannel();

    const { promise, resolve, reject } = Promise.withResolvers<string>();

    port1.on("message", (message: string) => {
      console.log("Received message:", message);
      assert.equal(message, "hello");
      worker.terminate();
      resolve(message);
    });

    worker.on("online", () => {
      console.log("Worker is online");
      const startupMessage: StartupMessage = { port: port2 };
      worker.postMessage(startupMessage, [port2]);
    });

    worker.on("exit", () => {
      console.log("Worker exited");
      reject();
    });

    worker.on("error", err => {
      reject(err);
    });

    assert.equal(await promise, "hello");
  });
}
