import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test for GitHub issue #25805: MessageChannel between Workers causes crash
// due to thread-safety issue in MessagePortChannelRegistry
test("MessageChannel between workers should not crash", async () => {
  using dir = tempDir("issue-25805", {
    "index.ts": `
import { Worker } from "worker_threads";

// Create multiple worker pairs to increase thread contention
const NUM_PAIRS = 4;
const workers: Worker[] = [];

for (let i = 0; i < NUM_PAIRS; i++) {
  const worker1 = new Worker(new URL('./worker.ts', import.meta.url), {
    env: { WORKER_NAME: 'Worker ' + (i * 2 + 1) },
  });

  const worker2 = new Worker(new URL('./worker.ts', import.meta.url), {
    env: { WORKER_NAME: 'Worker ' + (i * 2 + 2) },
  });

  workers.push(worker1, worker2);

  const { port1, port2 } = new MessageChannel();
  worker1.postMessage(port1, [port1]);
  worker2.postMessage(port2, [port2]);
}

const ready = workers.map((worker) => {
  return new Promise((resolve) => {
    worker.addListener('message', (message) => {
      if (message === 'READY') {
        resolve(true);
      }
    });
  });
});

await Promise.all(ready);
console.log('All workers are ready');

// Track acknowledgements from workers
let ackCount = 0;
const targetMessages = 500;
let sentCount = 0;

const done = new Promise<void>((resolve) => {
  // Set up ack listeners on all workers
  for (const worker of workers) {
    worker.addListener('message', (message) => {
      if (message === 'ACK') {
        ackCount++;
        if (ackCount >= targetMessages) {
          for (const w of workers) {
            w.terminate();
          }
          console.log('SUCCESS: Completed ' + ackCount + ' acknowledged messages without crash');
          resolve();
        }
      }
    });
  }

  // Send messages rapidly
  const sendBatch = () => {
    for (const worker of workers) {
      if (sentCount < targetMessages) {
        worker.postMessage('SEND_MESSAGE');
        sentCount++;
      }
    }
    if (sentCount < targetMessages) {
      queueMicrotask(sendBatch);
    }
  };
  sendBatch();
});

await done;
`,
    "worker.ts": `
import { parentPort } from "worker_threads";

const name = process.env.WORKER_NAME;
let port: MessagePort | null = null;

parentPort?.addEventListener("message", (event) => {
  if (event.data instanceof MessagePort) {
    event.data.start();
    event.data.addEventListener("message", (event) => {
      // Acknowledge receipt of message through the port
      parentPort?.postMessage('ACK');
    });
    port = event.data;
    parentPort?.postMessage('READY');
    return;
  }

  if (event.data === 'SEND_MESSAGE') {
    port?.postMessage(\`Hello from \${name}\`);
  }
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify output
  expect(stdout).toContain("All workers are ready");
  expect(stdout).toContain("SUCCESS");

  // Verify no crashes or errors
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
