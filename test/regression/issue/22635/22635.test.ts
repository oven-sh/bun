import { expect, test } from "bun:test";
import { MessageChannel, Worker } from "worker_threads";

test("issue #22635 - MessagePort communication fails after transfer to worker", async () => {
  // Create a MessageChannel
  const { port1, port2 } = new MessageChannel();

  // Create a simple worker that receives a port
  const workerCode = `
    const { parentPort } = require('worker_threads');

    parentPort.on('message', (msg) => {
      if (msg.ports && msg.ports[0]) {
        const port = msg.ports[0];

        // Listen for messages on the transferred port
        port.on('message', (data) => {
          // Reply back through the same port
          port.postMessage({ reply: 'Got: ' + data.text });
        });

        // Notify that we're ready
        parentPort.postMessage({ ready: true });
      }
    });
  `;

  // Create worker with the code
  const worker = new Worker(workerCode, { eval: true });

  // Wait for worker to be ready
  const readyPromise = new Promise<void>(resolve => {
    worker.once("message", msg => {
      if (msg.ready) {
        resolve();
      }
    });
  });

  // Transfer port2 to the worker
  worker.postMessage({ ports: [port2] }, [port2]);

  // Wait for worker to be ready
  await readyPromise;

  // Test communication through the transferred port
  const responsePromise = new Promise<void>(resolve => {
    port1.on("message", msg => {
      expect(msg.reply).toBe("Got: Hello from main");
      resolve();
    });
  });

  // Send message through port1
  port1.postMessage({ text: "Hello from main" });

  // Wait for response
  await responsePromise;

  // Clean up
  worker.terminate();
}, 10000);
