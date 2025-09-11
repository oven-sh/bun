import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/16037
test("fs.createReadStream should not emit 'end' prematurely when piped to HTTP response", async () => {
  using dir = tempDir("issue-16037", {
    "test-file.bin": Buffer.alloc(1024 * 1024 * 5), // 5MB file
    "server.js": `
      import * as fs from "node:fs";
      import { createServer } from "node:http";
      
      const server = createServer((req, res) => {
        if (req.method === "POST") {
          const startTime = Date.now();
          
          const fileStream = fs.createReadStream('./test-file.bin');
          
          // Track when stream emits 'end'
          fileStream.on('end', () => {
            const elapsed = Date.now() - startTime;
            console.log(\`STREAM_END:\${elapsed}\`);
          });
          
          // Track when response finishes
          res.on('finish', () => {
            const elapsed = Date.now() - startTime;
            console.log(\`RESPONSE_FINISH:\${elapsed}\`);
          });
          
          // Pipe the file to the response
          fileStream.pipe(res);
        }
      });
      
      server.listen(0, () => {
        const port = server.address().port;
        console.log(\`PORT:\${port}\`);
      });
    `,
  });

  // Start server
  await using serverProc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Get port from server output
  let port = 0;
  const reader = serverProc.stdout.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = new TextDecoder().decode(value);
    const match = text.match(/PORT:(\d+)/);
    if (match) {
      port = parseInt(match[1]);
      reader.releaseLock();
      break;
    }
  }

  expect(port).toBeGreaterThan(0);

  // Make request with simulated slow network
  const response = await fetch(`http://localhost:${port}`, {
    method: "POST",
  });

  // Read response slowly to simulate network transfer
  const reader2 = response.body!.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader2.read();
    if (done) break;
    total += value.length;
    // Add small delay to simulate slower network
    await Bun.sleep(1);
  }

  expect(total).toBe(1024 * 1024 * 5);

  // Wait for server to log events
  await Bun.sleep(50);

  // Kill server and get output
  serverProc.kill();
  const [stdout] = await Promise.all([
    serverProc.stdout.text(),
    serverProc.exited,
  ]);

  // Parse timings from output
  const streamEndMatch = stdout.match(/STREAM_END:(\d+)/);
  const responseFinishMatch = stdout.match(/RESPONSE_FINISH:(\d+)/);

  expect(streamEndMatch).toBeTruthy();
  expect(responseFinishMatch).toBeTruthy();

  const streamEndTime = parseInt(streamEndMatch![1]);
  const responseFinishTime = parseInt(responseFinishMatch![1]);

  // The bug would manifest as stream ending very quickly (< 100ms)
  // while response takes much longer
  // After the fix, both should take a reasonable amount of time
  expect(streamEndTime).toBeGreaterThan(100); // Should take more than 100ms for 5MB
  
  // Stream end and response finish should be relatively close to each other
  const timeDiff = Math.abs(responseFinishTime - streamEndTime);
  expect(timeDiff).toBeLessThan(responseFinishTime * 0.5); // Within 50% of each other
});