import { expect, test } from "bun:test";
import { ChildProcess, spawn } from "child_process";
import { bunEnv, bunExe, isBroken, isMacOS } from "harness";
import { join } from "path";

const REQUESTS_COUNT = 50000;
const BATCH_SIZE = 50;

interface ServerInfo {
  host: string;
  port: number;
}

async function spawnServer(): Promise<{ child: ChildProcess; serverInfo: ServerInfo }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bunExe(), [join(import.meta.dir, "express-memory-leak-fixture.mjs")], {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      env: bunEnv,

      serialization: "json",
    });

    console.log("Spawned", child.pid);

    child.on("message", (message: any) => {
      if (message.type === "listening") {
        resolve({
          child,
          serverInfo: {
            host: message.host,
            port: message.port,
          },
        });
      }
    });

    child.on("error", err => {
      reject(err);
    });

    child.on("exit", code => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Server process exited with code ${code}`));
      }
    });
  });
}

async function runMemoryTest(endpoint: string, options: RequestInit = {}) {
  // Start the fixture server in a separate process
  const { child, serverInfo } = await spawnServer();

  try {
    // Run first batch of requests
    await runRequestBatch(serverInfo, endpoint, REQUESTS_COUNT, BATCH_SIZE, options);

    // Check memory after first batch
    const rss1 = await getMemoryUsage(serverInfo);
    console.log(rss1.objects);
    console.log(`After ${REQUESTS_COUNT} requests: RSS = ${formatBytes(rss1.rss)}`);

    // Run second batch of requests
    await runRequestBatch(serverInfo, endpoint, REQUESTS_COUNT, BATCH_SIZE, options);

    // Check memory after second batch
    const rss2 = await getMemoryUsage(serverInfo);
    console.log(rss2.objects);
    console.log(`After ${REQUESTS_COUNT * 2} requests: RSS = ${formatBytes(rss2.rss)}`);

    // Analyze memory growth
    const ratio = rss2.rss / rss1.rss;
    console.log(`Memory growth ratio: ${ratio.toFixed(2)}x`);

    // A memory leak would show a significant increase
    // We use 1.5x as a threshold - in practice you might need to tune this
    expect(ratio).toBeLessThan(1.5);
  } finally {
    // Shutdown the server
    if (child.connected) {
      child.send({ type: "shutdown" });
    } else {
      child.kill();
    }

    // Wait for the process to exit
    await new Promise<void>(resolve => {
      child.on("exit", () => resolve());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1000).unref();
    });
  }
}

async function runRequestBatch(
  serverInfo: ServerInfo,
  endpoint: string,
  total: number,
  batchSize: number,
  options: RequestInit = {},
) {
  const url = `http://${serverInfo.host}:${serverInfo.port}${endpoint}`;

  for (let i = 0; i < total; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < total; j++) {
      batch.push(
        fetch(url, options)
          .then(r => r.blob())
          .catch(e => {
            if (url.endsWith("/aborted")) {
              return;
            }

            throw e;
          }),
      );
    }
    await Promise.all(batch);

    // Log progress every 10% complete
    if (i % (total / 10) < batchSize) {
      console.log(`Completed ${i + batchSize} / ${total} requests`);
    }
  }
}

async function getMemoryUsage(serverInfo: ServerInfo): Promise<{ rss: number; objects: Record<string, number> }> {
  const url = `http://${serverInfo.host}:${serverInfo.port}/rss`;
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

const body = new Blob([Buffer.alloc(1024 * 512, "X")]);

test(
  "memory leak check - empty response",
  async () => {
    await runMemoryTest("/empty");
  },
  1000 * 20,
);

test(
  "memory leak check - request body",
  async () => {
    const body = JSON.stringify({ data: "X".repeat(10 * 1024) }); // 10KB JSON
    await runMemoryTest("/request-body", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
  },
  1000 * 20,
);

test(
  "memory leak check - response body",
  async () => {
    await runMemoryTest("/response-body");
  },
  1000 * 20,
);

async function createAbortedRequestBatch(serverInfo: ServerInfo): Promise<void> {
  const url = `http://${serverInfo.host}:${serverInfo.port}/aborted`;
  let signal = new AbortController();

  let batch = new Array(BATCH_SIZE);
  for (let i = 0; i < BATCH_SIZE; i++) {
    batch[i] = fetch(url, {
      method: "POST",
      body,
      signal: signal.signal,
    })
      .then(r => r.blob())
      .catch(e => {});
  }

  await Bun.sleep(1);
  signal.abort();
  await Promise.allSettled(batch);
}

test.skipIf(isBroken && isMacOS)(
  "memory leak check - aborted requests",
  async () => {
    // Start the fixture server in a separate process
    const { child, serverInfo } = await spawnServer();

    try {
      // Run first batch of aborted requests
      for (let i = 0; i < REQUESTS_COUNT; i += BATCH_SIZE) {
        await createAbortedRequestBatch(serverInfo);

        // Log progress every 10% complete
        if (i % (REQUESTS_COUNT / 10) < BATCH_SIZE) {
          console.log(`Completed ${i + BATCH_SIZE} / ${REQUESTS_COUNT} aborted requests`);
        }
      }

      // Check memory after first batch
      const rss1 = await getMemoryUsage(serverInfo);
      console.log(rss1.objects);
      console.log(`After ${REQUESTS_COUNT} aborted requests: RSS = ${formatBytes(rss1.rss)}`);

      // Run garbage collection if available
      if (typeof Bun !== "undefined") {
        Bun.gc(true);
      }

      // Run second batch of aborted requests
      for (let i = 0; i < REQUESTS_COUNT; i += BATCH_SIZE) {
        await createAbortedRequestBatch(serverInfo);

        // Log progress every 10% complete
        if (i % (REQUESTS_COUNT / 10) < BATCH_SIZE) {
          console.log(`Completed ${REQUESTS_COUNT + i + BATCH_SIZE} / ${REQUESTS_COUNT * 2} aborted requests`);
        }
      }

      // Check memory after second batch
      const rss2 = await getMemoryUsage(serverInfo);
      console.log(rss1.objects);
      console.log(`After ${REQUESTS_COUNT * 2} aborted requests: RSS = ${formatBytes(rss2.rss)}`);

      // Analyze memory growth
      const ratio = rss2.rss / rss1.rss;
      console.log(`Memory growth ratio: ${ratio.toFixed(2)}x`);

      // A memory leak would show a significant increase
      expect(ratio).toBeLessThan(1.5);
    } finally {
      // Shutdown the server
      if (child.connected) {
        child.send({ type: "shutdown" });
      } else {
        child.kill();
      }

      // Wait for the process to exit
      await new Promise<void>(resolve => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 1000).unref();
      });
    }
  },
  40000,
);
