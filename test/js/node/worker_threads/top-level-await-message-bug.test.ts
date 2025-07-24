import { describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "worker_threads";

describe("Worker threads with top-level await", () => {
  const tempDir = join(import.meta.dir, "temp");

  // Helper to create temporary worker files
  function createTempWorker(content: string): string {
    const filename = join(tempDir, `worker-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    writeFileSync(filename, content);
    return filename;
  }

  // Cleanup helper
  function cleanupWorker(filename: string) {
    try {
      unlinkSync(filename);
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  test("worker with top-level await should receive messages immediately", async () => {
    const workerCode = `
import { parentPort } from "node:worker_threads";

// Set up message handler immediately
parentPort.onmessage = (e) => {
  console.log("Worker received message:", e.data);
  parentPort.postMessage("Worker processed: " + e.data);
};

// This top-level await should NOT prevent message processing
await new Promise(resolve => {
  // Simulate some async work that takes time
  setTimeout(resolve, 1000);
});

console.log("Worker top-level await resolved");
`;

    const workerFile = createTempWorker(workerCode);

    try {
      const worker = new Worker(workerFile, { type: "module" });

      // Wait a bit for worker to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send a message - this should be received immediately
      worker.postMessage("test message");

      // Wait for response with timeout
      const response = await Promise.race([
        new Promise(resolve => {
          worker.on("message", resolve);
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Timeout waiting for worker response")), 2000);
        }),
      ]);

      expect(response).toBe("Worker processed: test message");

      await worker.terminate();
    } finally {
      cleanupWorker(workerFile);
    }
  });

  test("worker with infinite top-level await should still receive messages", async () => {
    const workerCode = `
import { parentPort } from "node:worker_threads";

// Set up message handler immediately
parentPort.onmessage = (e) => {
  console.log("Worker received message:", e.data);
  parentPort.postMessage("Worker processed: " + e.data);
};

// This top-level await never resolves - but messages should still work
await new Promise(() => {
  // This promise never resolves
});

console.log("This should never be reached");
`;

    const workerFile = createTempWorker(workerCode);

    try {
      const worker = new Worker(workerFile, { type: "module" });

      // Wait a bit for worker to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send a message - this should be received immediately
      worker.postMessage("test message");

      // Wait for response with timeout
      const response = await Promise.race([
        new Promise(resolve => {
          worker.on("message", resolve);
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Timeout waiting for worker response")), 2000);
        }),
      ]);

      expect(response).toBe("Worker processed: test message");

      await worker.terminate();
    } finally {
      cleanupWorker(workerFile);
    }
  });

  test("worker with top-level await that rejects should still receive messages", async () => {
    const workerCode = `
import { parentPort } from "node:worker_threads";

// Set up message handler immediately
parentPort.onmessage = (e) => {
  console.log("Worker received message:", e.data);
  parentPort.postMessage("Worker processed: " + e.data);
};

// This top-level await rejects after a delay
await new Promise((resolve, reject) => {
  setTimeout(() => reject(new Error("Top-level await rejected")), 500);
});

console.log("This should never be reached");
`;

    const workerFile = createTempWorker(workerCode);

    try {
      const worker = new Worker(workerFile, { type: "module" });

      // Wait a bit for worker to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send a message - this should be received immediately
      worker.postMessage("test message");

      // Wait for response with timeout
      const response = await Promise.race([
        new Promise(resolve => {
          worker.on("message", resolve);
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Timeout waiting for worker response")), 2000);
        }),
      ]);

      expect(response).toBe("Worker processed: test message");

      // Wait for the top-level await to reject
      await new Promise(resolve => setTimeout(resolve, 600));

      await worker.terminate();
    } finally {
      cleanupWorker(workerFile);
    }
  });

  test("worker with top-level await should handle multiple messages", async () => {
    const workerCode = `
import { parentPort } from "node:worker_threads";

let messageCount = 0;

// Set up message handler immediately
parentPort.onmessage = (e) => {
  messageCount++;
  console.log("Worker received message", messageCount, ":", e.data);
  parentPort.postMessage("Message " + messageCount + " processed: " + e.data);
};

// This top-level await takes time
await new Promise(resolve => {
  setTimeout(resolve, 1000);
});

console.log("Worker top-level await resolved");
`;

    const workerFile = createTempWorker(workerCode);

    try {
      const worker = new Worker(workerFile, { type: "module" });

      // Wait a bit for worker to start
      await new Promise(resolve => setTimeout(resolve, 100));

      const responses: string[] = [];

      // Set up message listener
      worker.on("message", msg => {
        responses.push(msg);
      });

      // Send multiple messages
      worker.postMessage("first message");
      worker.postMessage("second message");
      worker.postMessage("third message");

      // Wait for all responses
      await new Promise(resolve => {
        const checkResponses = () => {
          if (responses.length >= 3) {
            resolve(undefined);
          } else {
            setTimeout(checkResponses, 100);
          }
        };
        checkResponses();
      });

      expect(responses).toHaveLength(3);
      expect(responses[0]).toBe("Message 1 processed: first message");
      expect(responses[1]).toBe("Message 2 processed: second message");
      expect(responses[2]).toBe("Message 3 processed: third message");

      await worker.terminate();
    } finally {
      cleanupWorker(workerFile);
    }
  });

  test("worker with top-level await should emit online event immediately", async () => {
    const workerCode = `
import { parentPort } from "node:worker_threads";

// Set up message handler immediately
parentPort.onmessage = (e) => {
  console.log("Worker received message:", e.data);
  parentPort.postMessage("Worker processed: " + e.data);
};

// This top-level await takes time
await new Promise(resolve => {
  setTimeout(resolve, 1000);
});

console.log("Worker top-level await resolved");
`;

    const workerFile = createTempWorker(workerCode);

    try {
      const worker = new Worker(workerFile, { type: "module" });

      // The online event should fire immediately, not after the top-level await resolves
      const onlinePromise = new Promise(resolve => {
        worker.on("online", resolve);
      });

      // Wait for online event with timeout
      await Promise.race([
        onlinePromise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Timeout waiting for online event")), 2000);
        }),
      ]);

      // Send a message to verify it works
      worker.postMessage("test message");

      const response = await Promise.race([
        new Promise(resolve => {
          worker.on("message", resolve);
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Timeout waiting for worker response")), 2000);
        }),
      ]);

      expect(response).toBe("Worker processed: test message");

      await worker.terminate();
    } finally {
      cleanupWorker(workerFile);
    }
  });
});
