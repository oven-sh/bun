import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26321
// Memory leak when streaming large files with Bun.file().stream()
test("memory should not leak when streaming files via Bun.file().stream()", async () => {
  using dir = tempDir("issue-26321", {
    // Create a moderately sized file (1MB) to stream multiple times
    "testfile.bin": Buffer.alloc(1024 * 1024, "x"),
    "server.ts": `
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/file") {
            return new Response(Bun.file("./testfile.bin").stream());
          }
          if (url.pathname === "/memory") {
            Bun.gc(true);
            return Response.json(process.memoryUsage());
          }
          return new Response("Not found", { status: 404 });
        },
      });
      console.log(server.port);
    `,
  });

  // Start the server
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Read the port from stdout, accumulating chunks until we get a complete line
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let portString = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    portString += decoder.decode(value, { stream: true });
    if (portString.includes("\n")) break;
  }
  reader.releaseLock();
  const port = parseInt(portString.trim(), 10);
  expect(port).toBeGreaterThan(0);

  // Get initial memory usage
  const initialMemory = await fetch(`http://localhost:${port}/memory`).then(r => r.json());
  const initialRss = initialMemory.rss;

  // Stream the file multiple times to trigger the leak
  for (let i = 0; i < 10; i++) {
    const response = await fetch(`http://localhost:${port}/file`);
    // Consume the entire response to ensure streaming completes
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBe(1024 * 1024);
  }

  // Poll memory until it stabilizes (stops decreasing significantly)
  let previousRss = Infinity;
  let stableCount = 0;
  let finalRss = 0;
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++) {
    await Bun.sleep(50);
    const memory = await fetch(`http://localhost:${port}/memory`).then(r => r.json());
    finalRss = memory.rss;

    // Consider stable if RSS hasn't decreased by more than 1MB
    if (previousRss - finalRss < 1024 * 1024) {
      stableCount++;
      if (stableCount >= 3) break;
    } else {
      stableCount = 0;
    }
    previousRss = finalRss;
  }

  // Memory growth should be bounded - allow up to 50MB growth for reasonable overhead
  // The bug would cause unbounded growth (10MB per request = 100MB+ growth)
  const memoryGrowth = finalRss - initialRss;
  const maxAllowedGrowth = 50 * 1024 * 1024; // 50MB

  expect(memoryGrowth).toBeLessThan(maxAllowedGrowth);
});
