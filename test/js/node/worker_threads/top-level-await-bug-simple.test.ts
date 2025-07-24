import { describe, expect, test } from "bun:test";
import { Worker } from "worker_threads";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";

describe("Top-level await bug in worker threads", () => {
  const tempDir = join(import.meta.dir, "temp");
  
  function createTempWorker(content: string): string {
    const filename = join(tempDir, `worker-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    writeFileSync(filename, content);
    return filename;
  }

  function cleanupWorker(filename: string) {
    try {
      unlinkSync(filename);
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  test("worker with infinite top-level await should receive messages immediately", async () => {
    // This test reproduces the exact issue from the original bug report
    const workerCode = `
import { parentPort } from "node:worker_threads";

console.log("Worker starting...");
parentPort.onmessage = (e) => {
  console.log("Worker received message:", e.data);
  parentPort.postMessage("Worker processed: " + e.data);
};
console.log("Worker message handler set up");

await new Promise(() => {}); // This never resolves
console.log("This should never be reached");
`;

    const workerFile = createTempWorker(workerCode);
    
    try {
      const worker = new Worker(workerFile, { type: "module" });
      
      // Wait for worker to start
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Send a message - this should be received immediately
      worker.postMessage("hi");
      
      // Wait for response from worker
      const response = await Promise.race([
        new Promise(resolve => {
          worker.on("message", resolve);
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Timeout waiting for worker response")), 2000);
        })
      ]);
      
      expect(response).toBe("Worker processed: hi");
      
      await worker.terminate();
    } finally {
      cleanupWorker(workerFile);
    }
  }, 10000); // 10 second timeout

  test("worker with top-level await should emit online event immediately", async () => {
    const workerCode = `
import { parentPort } from "node:worker_threads";

console.log("Worker starting...");
parentPort.onmessage = (e) => console.log("Worker received:", e.data);
await new Promise(() => {}); // This never resolves
`;

    const workerFile = createTempWorker(workerCode);
    
    try {
      const worker = new Worker(workerFile, { type: "module" });
      
      // The online event should fire immediately
      const onlinePromise = new Promise(resolve => {
        worker.on("online", resolve);
      });
      
      // Wait for online event with timeout
      await Promise.race([
        onlinePromise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Timeout waiting for online event")), 2000);
        })
      ]);
      
      await worker.terminate();
    } finally {
      cleanupWorker(workerFile);
    }
  });
}); 