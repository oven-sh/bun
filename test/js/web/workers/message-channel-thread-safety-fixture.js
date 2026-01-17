/**
 * Fixture script to test MessageChannel thread safety between workers.
 *
 * This script reproduces the crash scenario from issue #25805 where
 * rapid message passing between workers via MessageChannel caused
 * segmentation faults due to race conditions.
 *
 * Uses a tight loop to reliably trigger the race condition.
 *
 * @see https://github.com/oven-sh/bun/issues/25805
 */
const { Worker, isMainThread, parentPort } = require("worker_threads");

if (isMainThread) {
  const worker1 = new Worker(__filename);
  const worker2 = new Worker(__filename);

  const { port1, port2 } = new MessageChannel();
  worker1.postMessage(port1, [port1]);
  worker2.postMessage(port2, [port2]);

  const startTime = Date.now();
  const duration = 500;
  // Spam messages in a tight loop - this reliably triggers the crash
  while (Date.now() - startTime < duration) {
    worker1.postMessage("PING");
    worker2.postMessage("PING");
  }

  // If we get here without crashing, the fix works
  console.log("SUCCESS");
  worker1.terminate();
  worker2.terminate();
  process.exit(0);
} else {
  let port = null;

  parentPort.on("message", msg => {
    if (msg instanceof MessagePort) {
      msg.addEventListener("message", () => {
        // Just receive the message
      });
      msg.start();
      port = msg;
      return;
    }

    if (msg === "PING" && port) {
      port.postMessage("PONG");
    }
  });
}
