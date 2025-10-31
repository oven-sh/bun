import { expect, test } from "bun:test";
import path from "path";
import { MessageChannel, Worker } from "worker_threads";

test("MessagePort can be transferred to worker and used for bidirectional communication", async () => {
  // Create a simple worker that receives a port and sends a message through it
  const workerCode = `
const { parentPort } = require('worker_threads');

parentPort.on('message', (msg) => {
  if (msg.type === 'port') {
    const port = msg.port;

    // Send a message through the received port
    port.postMessage({ from: 'worker', data: 'hello from worker' });

    // Listen for response
    port.on('message', (data) => {
      parentPort.postMessage({ type: 'received', data });
    });
  }
});
`;

  const workerPath = path.join(import.meta.dir, "worker-port-test.js");
  await Bun.write(workerPath, workerCode);

  try {
    // Create a MessageChannel
    const channel = new MessageChannel();

    // Create promise to track communication
    const messageReceived = new Promise(resolve => {
      channel.port1.on("message", msg => {
        // Send response back
        channel.port1.postMessage({ from: "main", data: "hello back from main" });
        resolve(msg);
      });
    });

    // Create worker
    const worker = new Worker(workerPath);

    // Create promise to track worker receiving response
    const workerReceivedResponse = new Promise(resolve => {
      worker.on("message", msg => {
        if (msg.type === "received") {
          resolve(msg.data);
        }
      });
    });

    // Send port2 to worker
    worker.postMessage({ type: "port", port: channel.port2 }, [channel.port2]);

    // Wait for the message from worker through the port
    const messageFromWorker = await messageReceived;
    expect(messageFromWorker).toEqual({ from: "worker", data: "hello from worker" });

    // Wait for worker to receive the response
    const responseData = await workerReceivedResponse;
    expect(responseData).toEqual({ from: "main", data: "hello back from main" });

    await worker.terminate();
  } finally {
    // Clean up
    try {
      await Bun.$`rm -f ${workerPath}`;
    } catch {}
  }
});

test("Multiple MessagePorts can be transferred to multiple workers", async () => {
  // Create worker scripts
  const workerCode = (workerId: number) => `
const { parentPort } = require('worker_threads');

parentPort.on('message', (msg) => {
  if (msg.type === 'port') {
    const port = msg.port;

    port.on('message', (data) => {
      // Echo back with worker ID
      port.postMessage({
        workerId: ${workerId},
        received: data
      });
    });

    // Notify ready
    parentPort.postMessage({ type: 'ready' });
  }
});
`;

  const worker1Path = path.join(import.meta.dir, "worker1-port-test.js");
  const worker2Path = path.join(import.meta.dir, "worker2-port-test.js");

  await Bun.write(worker1Path, workerCode(1));
  await Bun.write(worker2Path, workerCode(2));

  try {
    // Create two MessageChannels
    const channel1 = new MessageChannel();
    const channel2 = new MessageChannel();

    // Create workers
    const worker1 = new Worker(worker1Path);
    const worker2 = new Worker(worker2Path);

    // Wait for workers to be ready
    const ready1 = new Promise(resolve => {
      worker1.once("message", msg => {
        if (msg.type === "ready") resolve(true);
      });
    });

    const ready2 = new Promise(resolve => {
      worker2.once("message", msg => {
        if (msg.type === "ready") resolve(true);
      });
    });

    // Transfer ports to workers
    worker1.postMessage({ type: "port", port: channel1.port2 }, [channel1.port2]);
    worker2.postMessage({ type: "port", port: channel2.port2 }, [channel2.port2]);

    // Wait for both workers to be ready
    await Promise.all([ready1, ready2]);

    // Set up response promises
    const response1 = new Promise(resolve => {
      channel1.port1.once("message", resolve);
    });

    const response2 = new Promise(resolve => {
      channel2.port1.once("message", resolve);
    });

    // Send messages through the channels
    channel1.port1.postMessage("test1");
    channel2.port1.postMessage("test2");

    // Wait for responses
    const [msg1, msg2] = await Promise.all([response1, response2]);

    expect(msg1).toEqual({ workerId: 1, received: "test1" });
    expect(msg2).toEqual({ workerId: 2, received: "test2" });

    await Promise.all([worker1.terminate(), worker2.terminate()]);
  } finally {
    // Clean up
    try {
      await Bun.$`rm -f ${worker1Path} ${worker2Path}`;
    } catch {}
  }
});

test("MessagePort transferred between workers (worker to worker communication)", async () => {
  const coordinatorCode = `
const { parentPort } = require('worker_threads');

let port;

parentPort.on('message', (msg) => {
  if (msg.type === 'port') {
    port = msg.port;

    // Listen for messages and forward to parent
    port.on('message', (data) => {
      parentPort.postMessage({ type: 'received', data });
    });

    parentPort.postMessage({ type: 'ready' });
  }
});
`;

  const senderCode = `
const { parentPort } = require('worker_threads');

parentPort.on('message', (msg) => {
  if (msg.type === 'port') {
    const port = msg.port;

    // Send a message through the port
    port.postMessage('hello from sender worker');

    parentPort.postMessage({ type: 'sent' });
  }
});
`;

  const coordinatorPath = path.join(import.meta.dir, "coordinator-worker.js");
  const senderPath = path.join(import.meta.dir, "sender-worker.js");

  await Bun.write(coordinatorPath, coordinatorCode);
  await Bun.write(senderPath, senderCode);

  try {
    // Create a MessageChannel for worker-to-worker communication
    const channel = new MessageChannel();

    // Create both workers
    const coordinator = new Worker(coordinatorPath);
    const sender = new Worker(senderPath);

    // Wait for coordinator to be ready
    const coordinatorReady = new Promise(resolve => {
      coordinator.once("message", msg => {
        if (msg.type === "ready") resolve(true);
      });
    });

    // Wait for message to be received
    const messageReceived = new Promise(resolve => {
      coordinator.on("message", msg => {
        if (msg.type === "received") resolve(msg.data);
      });
    });

    // Send port1 to coordinator
    coordinator.postMessage({ type: "port", port: channel.port1 }, [channel.port1]);
    await coordinatorReady;

    // Send port2 to sender
    sender.postMessage({ type: "port", port: channel.port2 }, [channel.port2]);

    // Wait for the message to be relayed
    const message = await messageReceived;
    expect(message).toBe("hello from sender worker");

    await Promise.all([coordinator.terminate(), sender.terminate()]);
  } finally {
    // Clean up
    try {
      await Bun.$`rm -f ${coordinatorPath} ${senderPath}`;
    } catch {}
  }
});
