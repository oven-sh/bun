import { describe, expect, test } from "bun:test";
import { Worker as WebWorker } from "worker_threads";

const CONFIG = {
  WARMUP_ITERATIONS: 5,
  TEST_ITERATIONS: 20,
  BATCH_SIZE: 10,
  MEMORY_THRESHOLD_MB: 20,
  GC_SETTLE_TIME: 200,
  TEST_TIMEOUT_MS: 30000,
};

interface MemorySnapshot {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

function takeMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    external: Math.round(mem.external / 1024 / 1024),
  };
}

async function forceGCAndSettle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await Bun.sleep(CONFIG.GC_SETTLE_TIME);
  }
}

function logMemoryDiff(before: MemorySnapshot, after: MemorySnapshot, label: string) {
  const rssDiff = after.rss - before.rss;
  const heapDiff = after.heapUsed - before.heapUsed;
  console.log(`${label}:`, {
    rss: `${before.rss}MB -> ${after.rss}MB (${rssDiff >= 0 ? "+" : ""}${rssDiff}MB)`,
    heap: `${before.heapUsed}MB -> ${after.heapUsed}MB (${heapDiff >= 0 ? "+" : ""}${heapDiff}MB)`,
  });

  if (rssDiff > 50) {
    console.warn(`⚠️  Large memory increase detected: +${rssDiff}MB RSS`);
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, description: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${description} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
}

async function runWorkerBatch(workerCode: string, batchSize: number = CONFIG.BATCH_SIZE): Promise<void> {
  const workers: WebWorker[] = [];

  for (let i = 0; i < batchSize; i++) {
    const worker = new WebWorker(workerCode, { eval: true });
    workers.push(worker);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.removeAllListeners();
        reject(new Error(`Worker ${i} failed to respond within timeout`));
      }, 5000);

      worker.once("message", msg => {
        clearTimeout(timeout);
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve();
        }
      });
    });
  }

  await Promise.all(workers.map(worker => worker.terminate()));
  await forceGCAndSettle();
}

describe("Worker Memory Leak Tests", () => {
  test(
    "workers should not leak memory with basic create/terminate cycles",
    async () => {
      const workerCode = `
        const { parentPort } = require('worker_threads');
        parentPort.postMessage('ready');
      `;

      console.log(`Running ${CONFIG.WARMUP_ITERATIONS} warmup iterations...`);

      // warmup
      for (let i = 0; i < CONFIG.WARMUP_ITERATIONS; i++) {
        await runWorkerBatch(workerCode);
        console.log(`Warmup ${i + 1}/${CONFIG.WARMUP_ITERATIONS} completed`);
      }

      const baselineMemory = takeMemorySnapshot();
      console.log("Baseline memory after warmup:", baselineMemory);

      console.log(`Running ${CONFIG.TEST_ITERATIONS} test iterations...`);
      for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
        await runWorkerBatch(workerCode);

        if ((i + 1) % 5 === 0) {
          const currentMemory = takeMemorySnapshot();
          console.log(`Test iteration ${i + 1}/${CONFIG.TEST_ITERATIONS} - RSS: ${currentMemory.rss}MB`);
        }
      }

      const finalMemory = takeMemorySnapshot();
      logMemoryDiff(baselineMemory, finalMemory, "Basic create/terminate test");

      const memoryIncrease = finalMemory.rss - baselineMemory.rss;
      expect(memoryIncrease).toBeLessThan(CONFIG.MEMORY_THRESHOLD_MB);
    },
    CONFIG.TEST_TIMEOUT_MS,
  );

  test(
    "workers with HTTP activity should not leak memory",
    async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("OK");
        },
      });

      const workerCode = `
        const { parentPort } = require('worker_threads');
        
        async function doWork() {
          try {
            const response = await fetch('http://localhost:${server.port}');
            await response.text();
            parentPort.postMessage('done');
          } catch (err) {
            parentPort.postMessage({ error: err.message });
          }
        }
        
        doWork();
      `;

      console.log(`Running ${CONFIG.WARMUP_ITERATIONS} HTTP warmup iterations...`);

      // warmup
      for (let i = 0; i < CONFIG.WARMUP_ITERATIONS; i++) {
        await runWorkerBatch(workerCode);
        console.log(`HTTP warmup ${i + 1}/${CONFIG.WARMUP_ITERATIONS} completed`);
      }

      const baselineMemory = takeMemorySnapshot();
      console.log("HTTP baseline memory after warmup:", baselineMemory);

      console.log(`Running ${CONFIG.TEST_ITERATIONS} HTTP test iterations...`);
      for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
        await runWorkerBatch(workerCode);

        if ((i + 1) % 5 === 0) {
          const currentMemory = takeMemorySnapshot();
          console.log(`HTTP test iteration ${i + 1}/${CONFIG.TEST_ITERATIONS} - RSS: ${currentMemory.rss}MB`);
        }
      }

      const finalMemory = takeMemorySnapshot();
      logMemoryDiff(baselineMemory, finalMemory, "HTTP activity test");

      const memoryIncrease = finalMemory.rss - baselineMemory.rss;
      expect(memoryIncrease).toBeLessThan(CONFIG.MEMORY_THRESHOLD_MB);
    },
    CONFIG.TEST_TIMEOUT_MS,
  );

  test(
    "workers with message passing should not leak memory",
    async () => {
      const workerCode = `
        const { parentPort } = require('worker_threads');
        
        parentPort.on('message', (msg) => {
          if (msg === 'start') {
            for (let j = 0; j < 10; j++) {
              parentPort.postMessage({ count: j, data: 'x'.repeat(1000) });
            }
            parentPort.postMessage('done');
          }
        });
      `;

      async function runMessagePassingBatch(): Promise<void> {
        const workers: WebWorker[] = [];

        for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
          const worker = new WebWorker(workerCode, { eval: true });
          workers.push(worker);

          await new Promise<void>(resolve => {
            worker.on("message", msg => {
              if (msg === "done") {
                resolve();
              }
            });
            worker.postMessage("start");
          });
        }

        await Promise.all(workers.map(worker => worker.terminate()));
        await forceGCAndSettle();
      }

      console.log(`Running ${CONFIG.WARMUP_ITERATIONS} message passing warmup iterations...`);

      // warmup
      for (let i = 0; i < CONFIG.WARMUP_ITERATIONS; i++) {
        await runMessagePassingBatch();
        console.log(`Message passing warmup ${i + 1}/${CONFIG.WARMUP_ITERATIONS} completed`);
      }

      const baselineMemory = takeMemorySnapshot();
      console.log("Message passing baseline memory after warmup:", baselineMemory);

      console.log(`Running ${CONFIG.TEST_ITERATIONS} message passing test iterations...`);
      for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
        await runMessagePassingBatch();

        if ((i + 1) % 5 === 0) {
          const currentMemory = takeMemorySnapshot();
          console.log(
            `Message passing test iteration ${i + 1}/${CONFIG.TEST_ITERATIONS} - RSS: ${currentMemory.rss}MB`,
          );
        }
      }

      const finalMemory = takeMemorySnapshot();
      logMemoryDiff(baselineMemory, finalMemory, "Message passing test");

      const memoryIncrease = finalMemory.rss - baselineMemory.rss;
      expect(memoryIncrease).toBeLessThan(CONFIG.MEMORY_THRESHOLD_MB);
    },
    CONFIG.TEST_TIMEOUT_MS,
  );

  test(
    "workers with timers should not leak memory",
    async () => {
      const workerCode = `
        const { parentPort } = require('worker_threads');
        
        const timers = [];
        for (let i = 0; i < 5; i++) {
          timers.push(setTimeout(() => {}, 10000)); 
          timers.push(setInterval(() => {}, 1000)); 
        }
        
        parentPort.postMessage('ready');
      `;

      console.log(`Running ${CONFIG.WARMUP_ITERATIONS} timer warmup iterations...`);

      // warmup
      for (let i = 0; i < CONFIG.WARMUP_ITERATIONS; i++) {
        await runWorkerBatch(workerCode);
        console.log(`Timer warmup ${i + 1}/${CONFIG.WARMUP_ITERATIONS} completed`);
      }

      const baselineMemory = takeMemorySnapshot();
      console.log("Timer baseline memory after warmup:", baselineMemory);

      console.log(`Running ${CONFIG.TEST_ITERATIONS} timer test iterations...`);
      for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
        await runWorkerBatch(workerCode);

        if ((i + 1) % 5 === 0) {
          const currentMemory = takeMemorySnapshot();
          console.log(`Timer test iteration ${i + 1}/${CONFIG.TEST_ITERATIONS} - RSS: ${currentMemory.rss}MB`);
        }
      }

      const finalMemory = takeMemorySnapshot();
      logMemoryDiff(baselineMemory, finalMemory, "Timer cleanup test");

      const memoryIncrease = finalMemory.rss - baselineMemory.rss;
      expect(memoryIncrease).toBeLessThan(CONFIG.MEMORY_THRESHOLD_MB);
    },
    CONFIG.TEST_TIMEOUT_MS,
  );
});
