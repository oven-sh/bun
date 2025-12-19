import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// This test verifies that the server doesn't leak memory when handling many requests
// The memory leak was caused by ref() calls that weren't matched with deref() when
// promise.then() failed or when async operations failed to start.

test("server should not leak memory on many async response requests", async () => {
  using dir = tempDir("server-promise-memory-leak", {
    "server.ts": `
const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  async fetch(req: Request) {
    const url = new URL(req.url);

    if (url.pathname === "/report") {
      Bun.gc(true);
      await Bun.sleep(10);
      return new Response(JSON.stringify(process.memoryUsage.rss()), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/async") {
      // Return an async response to test promise handling
      return new Promise((resolve) => {
        setImmediate(() => resolve(new Response("ok")));
      });
    }

    if (url.pathname === "/stream") {
      // Return a streaming response
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      });
      return new Response(stream);
    }

    return new Response("ok");
  },
});

process?.send?.(server.url.href);
`,
  });

  let defer = Promise.withResolvers<string>();
  await using proc = Bun.spawn([bunExe(), "--smol", "server.ts"], {
    env: bunEnv,
    cwd: String(dir),
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
    ipc(message) {
      defer.resolve(message);
    },
  });

  const url = new URL(await defer.promise);
  proc.unref();

  // Warmup
  for (let i = 0; i < 500; i++) {
    await fetch(`${url.origin}/async`);
    await fetch(`${url.origin}/stream`);
  }

  const getMemoryUsage = async (): Promise<number> => {
    return (await fetch(`${url.origin}/report`).then(res => res.json())) as number;
  };

  const startMemory = await getMemoryUsage();

  // Make many async requests to trigger the potential memory leak
  const requestCount = 5000;
  const batchSize = 50;

  for (let i = 0; i < requestCount; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize; j++) {
      // Alternate between async and streaming responses
      if ((i + j) % 2 === 0) {
        batch.push(fetch(`${url.origin}/async`).then(r => r.text()));
      } else {
        batch.push(fetch(`${url.origin}/stream`).then(r => r.text()));
      }
    }
    await Promise.all(batch);
  }

  const endMemory = await getMemoryUsage();
  const memoryGrowthMB = (endMemory - startMemory) / 1024 / 1024;

  console.log(`Start memory: ${(startMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log(`End memory: ${(endMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Growth: ${memoryGrowthMB.toFixed(2)} MB`);

  // Memory growth should be minimal (less than 50MB for 5000 requests)
  // If there's a memory leak, growth would be much higher
  expect(memoryGrowthMB).toBeLessThan(50);

  // End memory should be less than 2x start memory (allow for debug build overhead)
  expect(endMemory).toBeLessThan(startMemory * 2);
}, 90_000);
