import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// This test specifically focuses on the pipeTo abort scenario from issue 18228
test("pipeTo should handle aborted response gracefully", async () => {
  const dir = tempDirWithFiles("issue-18228", {
    "server.js": `
// Simulate the solid-js streaming scenario
async function* slowGenerator() {
  yield "<div>Start</div>";
  await new Promise(r => setTimeout(r, 50));
  yield "<div>Middle</div>";
  await new Promise(r => setTimeout(r, 50));
  yield "<div>End</div>";
}

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const { readable, writable } = new TransformStream();
    
    // Convert async generator to ReadableStream
    const source = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of slowGenerator()) {
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      }
    });
    
    // This is the key part - pipeTo without awaiting
    source.pipeTo(writable).catch(err => {
      // Log errors but don't crash
      if (err.message !== "The operation was aborted") {
        console.error("pipeTo error:", err.message);
      }
    });
    
    return new Response(readable);
  }
});

// Send URL via IPC
process.send({ url: server.url.href });
`,
  });

  // Wait for server URL via IPC
  const { promise, resolve } = Promise.withResolvers<string>();
  
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: dir,
    ipc(message) {
      if (message.url) {
        resolve(message.url);
      }
    },
    stderr: "pipe",
  });
  
  const url = await promise;

  // Make requests and abort them
  const abortedRequests: Promise<void>[] = [];

  for (let i = 0; i < 10; i++) {
    const controller = new AbortController();

    const requestPromise = fetch(url, { signal: controller.signal })
      .then(res => res.text())
      .catch(err => {
        // Abort errors are expected
        if (err.name !== "AbortError") {
          throw err;
        }
      });

    // Abort at different times to test various scenarios
    if (i < 3) {
      // Abort immediately
      controller.abort();
    } else if (i < 6) {
      // Abort after 25ms
      setTimeout(() => controller.abort(), 25);
    } else {
      // Abort after 75ms
      setTimeout(() => controller.abort(), 75);
    }

    abortedRequests.push(requestPromise);
  }

  // Wait for all requests to complete/abort
  await Promise.all(abortedRequests);

  // Kill server and wait for exit
  proc.kill();
  await proc.exited;

  // Check stderr after process exits
  const stderrOutput = await new Response(proc.stderr).text();

  // The key assertion - no "Cannot close a writable stream" errors
  expect(stderrOutput).not.toContain("Cannot close a writable stream that is closed or errored");
  expect(stderrOutput).not.toContain("Segmentation fault");
});

test("pipeTo to closed writable stream should fail gracefully", async () => {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue("chunk1");
      controller.enqueue("chunk2");
      controller.close();
    },
  });

  const { readable, writable } = new TransformStream();

  // Close the writable side prematurely
  await writable.close();

  // pipeTo should handle this gracefully
  try {
    await source.pipeTo(writable);
    expect(true).toBe(false); // Should not reach here
  } catch (err: any) {
    // pipeTo should detect the closed stream and fail appropriately
    expect(err.message).toContain("closing is propagated backward");
  }
});
