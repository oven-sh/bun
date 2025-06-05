import { beforeAll, describe, expect, test } from "bun:test";
import { Worker as WebWorker } from "worker_threads";

const CONFIG = {
  SMALL_BATCH_SIZE: 5,
  LARGE_BATCH_SIZE: 50,
  STRESS_ITERATIONS: 3,
  MEMORY_THRESHOLD_MB: 200,
  GC_SETTLE_TIME: 200,
  TEST_TIMEOUT_MS: 10000,
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

  if (rssDiff > 100) {
    console.warn(`⚠️  Large memory increase detected: +${rssDiff}MB RSS`);
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, description: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${description} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
}

describe("Worker Memory Leak Tests", () => {
  let initialMemory: MemorySnapshot;

  beforeAll(async () => {
    await forceGCAndSettle();
    initialMemory = takeMemorySnapshot();
    console.log("Initial memory:", initialMemory);
  });

  test(
    "workers should not leak memory with basic create/terminate cycles",
    async () => {
      const beforeTest = takeMemorySnapshot();

      const testPromise = (async () => {
        for (let iteration = 0; iteration < CONFIG.STRESS_ITERATIONS; iteration++) {
          const workers: WebWorker[] = [];

          for (let i = 0; i < CONFIG.SMALL_BATCH_SIZE; i++) {
            const worker = new WebWorker(
              `
            const { parentPort } = require('worker_threads');
            parentPort.postMessage('ready');
          `,
              { eval: true },
            );

            workers.push(worker);

            await new Promise<void>(resolve => {
              worker.once("message", () => resolve());
            });
          }

          await Promise.all(workers.map(worker => worker.terminate()));
          await forceGCAndSettle();

          const currentMemory = takeMemorySnapshot();
          console.log(`Iteration ${iteration + 1}/${CONFIG.STRESS_ITERATIONS} - RSS: ${currentMemory.rss}MB`);
        }
      })();

      await withTimeout(testPromise, CONFIG.TEST_TIMEOUT_MS, "Basic worker test");

      const afterTest = takeMemorySnapshot();
      logMemoryDiff(beforeTest, afterTest, "Basic create/terminate test");

      const memoryIncrease = afterTest.rss - beforeTest.rss;
      expect(memoryIncrease).toBeLessThan(CONFIG.MEMORY_THRESHOLD_MB);
    },
    CONFIG.TEST_TIMEOUT_MS,
  );

  test(
    "workers with HTTP activity should not leak memory",
    async () => {
      const beforeTest = takeMemorySnapshot();

      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("OK");
        },
      });

      try {
        const testPromise = (async () => {
          for (let iteration = 0; iteration < CONFIG.STRESS_ITERATIONS; iteration++) {
            const workers: WebWorker[] = [];

            for (let i = 0; i < CONFIG.SMALL_BATCH_SIZE; i++) {
              const worker = new WebWorker(
                `
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
            `,
                { eval: true },
              );

              workers.push(worker);

              await new Promise<void>((resolve, reject) => {
                worker.once("message", msg => {
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

            const currentMemory = takeMemorySnapshot();
            console.log(`HTTP iteration ${iteration + 1}/${CONFIG.STRESS_ITERATIONS} - RSS: ${currentMemory.rss}MB`);
          }
        })();

        await withTimeout(testPromise, CONFIG.TEST_TIMEOUT_MS, "HTTP worker test");
      } finally {
        server.stop(true);
      }

      const afterTest = takeMemorySnapshot();
      logMemoryDiff(beforeTest, afterTest, "HTTP activity test");

      const memoryIncrease = afterTest.rss - beforeTest.rss;
      expect(memoryIncrease).toBeLessThan(CONFIG.MEMORY_THRESHOLD_MB);
    },
    CONFIG.TEST_TIMEOUT_MS,
  );

  test(
    "workers with simple message passing should not leak memory",
    async () => {
      const beforeTest = takeMemorySnapshot();

      const testPromise = (async () => {
        for (let iteration = 0; iteration < CONFIG.STRESS_ITERATIONS; iteration++) {
          const workers: WebWorker[] = [];

          for (let i = 0; i < CONFIG.SMALL_BATCH_SIZE; i++) {
            const worker = new WebWorker(
              `
            const { parentPort } = require('worker_threads');
            
            parentPort.on('message', (msg) => {
              if (msg === 'start') {
                for (let j = 0; j < 5; j++) {
                  parentPort.postMessage({ count: j, data: 'x'.repeat(100) });
                }
                parentPort.postMessage('done');
              }
            });
          `,
              { eval: true },
            );

            workers.push(worker);

            await new Promise<void>(resolve => {
              let messageCount = 0;
              worker.on("message", msg => {
                if (msg === "done") {
                  resolve();
                } else {
                  messageCount++;
                }
              });
              worker.postMessage("start");
            });
          }

          await Promise.all(workers.map(worker => worker.terminate()));
          await forceGCAndSettle();

          const currentMemory = takeMemorySnapshot();
          console.log(
            `Message passing iteration ${iteration + 1}/${CONFIG.STRESS_ITERATIONS} - RSS: ${currentMemory.rss}MB`,
          );
        }
      })();

      await withTimeout(testPromise, CONFIG.TEST_TIMEOUT_MS, "Message passing test");

      const afterTest = takeMemorySnapshot();
      logMemoryDiff(beforeTest, afterTest, "Message passing test");

      const memoryIncrease = afterTest.rss - beforeTest.rss;
      expect(memoryIncrease).toBeLessThan(CONFIG.MEMORY_THRESHOLD_MB);
    },
    CONFIG.TEST_TIMEOUT_MS,
  );

  test(
    "workers with timers should not leak memory",
    async () => {
      const beforeTest = takeMemorySnapshot();

      const testPromise = (async () => {
        for (let iteration = 0; iteration < CONFIG.STRESS_ITERATIONS; iteration++) {
          const workers: WebWorker[] = [];

          for (let i = 0; i < CONFIG.SMALL_BATCH_SIZE; i++) {
            const worker = new WebWorker(
              `
            const { parentPort } = require('worker_threads');
            
            const timers = [];
            for (let i = 0; i < 3; i++) {
              timers.push(setTimeout(() => {}, 10000)); 
              timers.push(setInterval(() => {}, 1000)); 
            }
            
            parentPort.postMessage('ready');
          `,
              { eval: true },
            );

            workers.push(worker);

            await new Promise<void>(resolve => {
              worker.once("message", () => resolve());
            });
          }

          await Promise.all(workers.map(worker => worker.terminate()));
          await forceGCAndSettle();

          const currentMemory = takeMemorySnapshot();
          console.log(`Timer iteration ${iteration + 1}/${CONFIG.STRESS_ITERATIONS} - RSS: ${currentMemory.rss}MB`);
        }
      })();

      await withTimeout(testPromise, CONFIG.TEST_TIMEOUT_MS, "Timer test");

      const afterTest = takeMemorySnapshot();
      logMemoryDiff(beforeTest, afterTest, "Timer cleanup test");

      const memoryIncrease = afterTest.rss - beforeTest.rss;
      expect(memoryIncrease).toBeLessThan(CONFIG.MEMORY_THRESHOLD_MB);
    },
    CONFIG.TEST_TIMEOUT_MS,
  );

  test("memory leak detection summary", async () => {
    await forceGCAndSettle();

    const finalMemory = takeMemorySnapshot();
    logMemoryDiff(initialMemory, finalMemory, "Overall test suite");

    const totalIncrease = finalMemory.rss - initialMemory.rss;
    console.log(`Total memory increase from start: ${totalIncrease}MB`);

    if (totalIncrease > 500) {
      console.error(`🚨 MAJOR MEMORY LEAK DETECTED: +${totalIncrease}MB`);
      console.error("This indicates workers are not properly cleaning up resources");
    } else if (totalIncrease > 100) {
      console.warn(`⚠️  Moderate memory increase: +${totalIncrease}MB`);
    } else {
      console.log(`✅ Memory usage looks reasonable: +${totalIncrease}MB`);
    }

    expect(totalIncrease).toBeLessThan(3000);
  }, 15000);
});
