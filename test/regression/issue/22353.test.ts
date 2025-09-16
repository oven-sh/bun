import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #22353 - server should handle oversized request without crashing", async () => {
  // This test reproduces a crash that occurs in debug builds when the server
  // handles a request after rejecting an oversized request

  using dir = tempDir("oversized-request", {
    "server.ts": `
      const server = Bun.serve({
        port: 0,
        maxRequestBodySize: 1024, // 1KB limit
        async fetch(req) {
          const body = await req.text();
          return new Response(JSON.stringify({
            received: true,
            size: body.length
          }), {
            headers: { "Content-Type": "application/json" }
          });
        }
      });

      console.log(JSON.stringify({ port: server.port }));

      // Process stays alive for tests
      setTimeout(() => {}, 10000);
    `,
  });

  // Start server
  const proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Read port from initial output
  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  const decoder = new TextDecoder();
  const portLine = decoder.decode(value);
  const { port } = JSON.parse(portLine.trim());
  reader.releaseLock();

  expect(port).toBeGreaterThan(0);

  // Send request larger than limit (2KB) - this triggers the 413 error
  const largeBody = "x".repeat(2048);

  const largeResponse = await fetch(`http://localhost:${port}`, {
    method: "POST",
    body: largeBody,
  });

  // Server should reject with 413
  expect(largeResponse.status).toBe(413);

  // Important: await the response body to ensure the request is fully processed
  await largeResponse.text();

  // Send normal request - on buggy version this causes crash/ECONNRESET in debug builds
  const normalResponse = await fetch(`http://localhost:${port}`, {
    method: "POST",
    body: JSON.stringify({ test: "normal" }),
  });

  expect(normalResponse.ok).toBe(true);
  const json = await normalResponse.json();
  expect(json.received).toBe(true);
  expect(json.size).toBe(17);

  // Clean up - kill and wait for process
  proc.kill();
  const exitCode = await proc.exited;

  // Collect any stderr output
  let stderrOutput = "";
  try {
    const stderrReader = proc.stderr.getReader();
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderrOutput += decoder.decode(value);
    }
    stderrReader.releaseLock();
  } catch {}

  // Should not have panic message
  expect(stderrOutput).not.toContain("panic");
  expect(stderrOutput).not.toContain("reached unreachable code");
}, 10000);
