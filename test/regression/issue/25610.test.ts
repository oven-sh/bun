import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test for GitHub issue #25610: Segfault and DataCloneError when using worker threads with MessageChannel
// This tests thread-safety of MessagePortChannelRegistry

test("MessageChannel between multiple workers should not crash", async () => {
  using dir = tempDir("25610", {
    "worker.js": `
const { parentPort, workerData } = require('worker_threads');
const { port } = workerData;

// Simulate some work
let result = 0;
for (let i = 0; i < 1000; i++) {
  result += i;
}

// Send result through the port
port.postMessage({ result, workerId: workerData.id });
port.close();
parentPort.postMessage('done');
`,
    "main.js": `
const { Worker, MessageChannel } = require('worker_threads');
const path = require('path');

async function createWorker(id) {
  const { port1, port2 } = new MessageChannel();

  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { port: port2, id },
      transferList: [port2]
    });

    let result = null;

    port1.on('message', (msg) => {
      result = msg;
    });

    worker.on('message', () => {
      port1.close();
      resolve(result);
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0 && !result) {
        reject(new Error(\`Worker \${id} exited with code \${code}\`));
      }
    });
  });
}

async function main() {
  const numWorkers = 10;
  const promises = [];

  // Create multiple workers concurrently to stress test MessageChannel registry
  for (let i = 0; i < numWorkers; i++) {
    promises.push(createWorker(i));
  }

  try {
    const results = await Promise.all(promises);
    console.log(JSON.stringify({ success: true, workerCount: results.length }));
  } catch (error) {
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exit(1);
  }
}

main();
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The process should not crash
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");

  const result = JSON.parse(stdout.trim());
  expect(result.success).toBe(true);
  expect(result.workerCount).toBe(10);

  expect(exitCode).toBe(0);
});

test("MessageChannel with many concurrent workers should not crash", async () => {
  // This tests the thread-safety of MessagePortChannelRegistry by spawning many workers
  // with MessageChannel simultaneously
  using dir = tempDir("25610-concurrent", {
    "worker.js": `
const { parentPort, workerData } = require('worker_threads');
const { port } = workerData;

// Signal we're ready via the port
port.postMessage({ ready: true, id: workerData.id });

// Wait for parent to signal completion
parentPort.on('message', (msg) => {
  if (msg === 'done') {
    port.close();
    process.exit(0);
  }
});
`,
    "main.js": `
const { Worker, MessageChannel } = require('worker_threads');
const path = require('path');

async function main() {
  const numWorkers = 20;
  const workers = [];
  const channels = [];

  // Create all workers and channels concurrently
  for (let i = 0; i < numWorkers; i++) {
    const { port1, port2 } = new MessageChannel();
    channels.push({ port1, port2 });

    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { port: port2, id: i },
      transferList: [port2]
    });
    workers.push(worker);
  }

  // Wait for all workers to signal ready
  const readyPromises = channels.map((ch, i) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Worker ' + i + ' timed out'));
    }, 5000);

    ch.port1.on('message', (msg) => {
      clearTimeout(timeout);
      if (msg.ready) {
        resolve(msg);
      }
    });
  }));

  await Promise.all(readyPromises);

  // Close all ports and terminate workers
  for (let i = 0; i < numWorkers; i++) {
    channels[i].port1.close();
    workers[i].postMessage('done');
  }

  // Wait for all workers to exit
  await Promise.all(workers.map(w => new Promise(resolve => w.on('exit', resolve))));

  console.log(JSON.stringify({ success: true, workerCount: numWorkers }));
}

main().catch(err => {
  console.log(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The process should not crash
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");

  const result = JSON.parse(stdout.trim());
  expect(result.success).toBe(true);
  expect(result.workerCount).toBe(20);

  expect(exitCode).toBe(0);
});
