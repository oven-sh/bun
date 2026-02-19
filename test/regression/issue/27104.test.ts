import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that Bun.serve() propagates backpressure from a slow WritableStream
// consumer back to the HTTP socket, preventing unbounded memory growth.
// Uses separate processes to ensure independent sender/server event loops.
// The server tracks peak RSS from within the process (cross-platform).
test("Bun.serve request body backpressure limits memory growth", async () => {
  // Use 512MB payload to clearly distinguish backpressure from no-backpressure.
  // With backpressure: RSS bounded by kernel TCP buffers (~10MB) + stream overhead.
  // Without: server buffers the full payload.
  const PAYLOAD_SIZE = 512 * 1024 * 1024;
  const PAYLOAD_MB = PAYLOAD_SIZE / (1024 * 1024);

  using dir = tempDir("backpressure-test", {
    "server.ts": `
let initialRss = 0;
let peakRss = 0;

function trackMemory() {
  const rss = process.memoryUsage().rss;
  if (rss > peakRss) peakRss = rss;
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 255,
  async fetch(req) {
    initialRss = process.memoryUsage().rss;
    peakRss = initialRss;
    let totalReceived = 0;

    const memInterval = setInterval(trackMemory, 25);

    const writeStream = new WritableStream({
      async write(value) {
        totalReceived += value.length;
        trackMemory();
        // Simulate a slow consumer - 5ms per chunk is enough to create
        // backpressure with a fast sender.
        await new Promise(res => setTimeout(res, 5));
        trackMemory();
      },
    }, { highWaterMark: 1 });

    await req.body!.pipeTo(writeStream).catch((e) => {
      console.error("pipeTo error:", e);
    });

    clearInterval(memInterval);
    trackMemory();

    const rssGrowthMB = (peakRss - initialRss) / (1024 * 1024);
    return new Response(JSON.stringify({
      totalReceived,
      rssGrowthMB: +rssGrowthMB.toFixed(1),
    }));
  },
});

console.log("READY:" + server.port);
`,
    "sender.ts": `
const port = process.argv[2];
const PAYLOAD_SIZE = ${PAYLOAD_SIZE};

const chunkSize = 256 * 1024; // 256KB chunks for fast sending
const totalChunks = PAYLOAD_SIZE / chunkSize;
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

const response = await fetch("http://127.0.0.1:" + port, {
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

  // Start sender
  await using senderProc = Bun.spawn({
    cmd: [bunExe(), "run", "sender.ts", port],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [senderStdout, senderStderr, senderExitCode] = await Promise.all([
    senderProc.stdout.text(),
    senderProc.stderr.text(),
    senderProc.exited,
  ]);

  if (senderStderr) console.log("sender stderr:", senderStderr);

  // Verify the sender got a successful response
  expect(senderStdout).toContain("RESULT:");
  const resultMatch = senderStdout.match(/RESULT:(.+)/);
  const result = JSON.parse(resultMatch![1]);

  console.log(`Server RSS growth: ${result.rssGrowthMB}MB (payload: ${PAYLOAD_MB}MB)`);

  expect(result.totalReceived).toBe(PAYLOAD_SIZE);

  // With backpressure: RSS growth bounded regardless of payload size (~80-120MB
  // from kernel TCP buffers, stream overhead, and GC not immediately releasing pages).
  // Without backpressure: RSS growth approaches or exceeds the payload size (512MB+).
  // Threshold of 200MB catches the no-backpressure case while accommodating the
  // fixed overhead from TCP buffers + debug build + CI variability.
  expect(result.rssGrowthMB).toBeLessThan(200);

  expect(senderExitCode).toBe(0);

  // Clean up server
  serverProc.kill();
}, 120_000);
