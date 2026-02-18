import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that Bun.serve() propagates backpressure from a slow WritableStream
// consumer back to the HTTP socket, preventing unbounded memory growth.
// Uses separate processes: a server that pipes req.body to a slow WritableStream,
// and a sender that streams a large body. We measure server RSS.
test("Bun.serve request body backpressure limits memory growth", async () => {
  using dir = tempDir("backpressure-test", {
    "server.ts": `
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 255,
  async fetch(req) {
    let totalReceived = 0;
    let writeCount = 0;

    const writeStream = new WritableStream(
      {
        async write(value) {
          writeCount++;
          totalReceived += value.length;
          // Simulate a slow consumer - block for 500ms per chunk
          await new Promise(res => setTimeout(res, 500));
        },
      },
      { highWaterMark: 1 },
    );

    await req.body!.pipeTo(writeStream).catch(() => {});
    return new Response(JSON.stringify({ totalReceived, writeCount }));
  },
});

// Signal readiness with port
console.log("READY:" + server.port);
`,
    "sender.ts": `
const port = process.argv[2];
const url = "http://127.0.0.1:" + port;

const chunkSize = 64 * 1024; // 64KB
const totalSize = 200 * 1024 * 1024; // 200MB total
const totalChunks = totalSize / chunkSize;
let chunksSent = 0;

const body = new ReadableStream({
  pull(controller) {
    if (chunksSent >= totalChunks) {
      controller.close();
      return;
    }
    controller.enqueue(new Uint8Array(chunkSize));
    chunksSent++;
  },
});

const response = await fetch(url, {
  method: "POST",
  body,
  // @ts-ignore
  duplex: "half",
});

const result = await response.json();
console.log("RESULT:" + JSON.stringify(result));
`,
  });

  // Start server
  await using serverProc = Bun.spawn({
    cmd: [bunExe(), "run", "server.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for server to be ready and get port
  const reader = serverProc.stdout.getReader();
  let port: string = "";
  let accumulated = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    accumulated += new TextDecoder().decode(value);
    const match = accumulated.match(/READY:(\d+)/);
    if (match) {
      port = match[1];
      break;
    }
  }
  reader.releaseLock();

  expect(port).not.toBe("");

  // Get initial RSS of the server
  const initialRss = getRss(serverProc.pid);

  // Start sender
  await using senderProc = Bun.spawn({
    cmd: [bunExe(), "run", "sender.ts", port],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Poll server RSS during the transfer
  let peakRss = initialRss;
  const pollInterval = setInterval(() => {
    try {
      const rss = getRss(serverProc.pid);
      if (rss > peakRss) peakRss = rss;
    } catch {
      // Process may have exited
    }
  }, 200);

  const [senderStdout, senderStderr, senderExitCode] = await Promise.all([
    senderProc.stdout.text(),
    senderProc.stderr.text(),
    senderProc.exited,
  ]);

  clearInterval(pollInterval);

  // One final RSS check
  try {
    const finalRss = getRss(serverProc.pid);
    if (finalRss > peakRss) peakRss = finalRss;
  } catch {
    // Process may have exited
  }

  expect(senderExitCode).toBe(0);

  // Verify the sender got a successful response
  const resultMatch = senderStdout.match(/RESULT:(.+)/);
  expect(resultMatch).not.toBeNull();
  const result = JSON.parse(resultMatch![1]);
  expect(result.totalReceived).toBe(200 * 1024 * 1024);

  // Check that memory growth was bounded.
  // Without backpressure: the server buffers all 200MB -> RSS grows by ~200MB+
  // With backpressure: RSS growth should be bounded by TCP kernel buffers
  // (typically ~6-10MB) plus some overhead.
  const rssGrowthMB = (peakRss - initialRss) / (1024 * 1024);
  console.log(
    `RSS: initial=${(initialRss / 1024 / 1024).toFixed(1)}MB peak=${(peakRss / 1024 / 1024).toFixed(1)}MB growth=${rssGrowthMB.toFixed(1)}MB`,
  );

  // With backpressure, RSS growth should be well under the 200MB payload.
  // We use 120MB as the threshold - generous enough for TCP kernel buffers
  // (~10MB), debug build overhead, and CI variability, but will catch the
  // no-fix case where all 200MB gets buffered (which causes ~200MB+ growth).
  expect(rssGrowthMB).toBeLessThan(120);

  // Clean up server
  serverProc.kill();
}, 120_000);

function getRss(pid: number): number {
  try {
    const statm = require("fs").readFileSync(`/proc/${pid}/statm`, "utf-8");
    // statm format: size resident shared text lib data dt (in pages)
    const resident = parseInt(statm.split(" ")[1], 10);
    const pageSize = 4096; // typical Linux page size
    return resident * pageSize;
  } catch {
    return 0;
  }
}
