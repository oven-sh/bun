import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("issue 18228: pipeTo should handle aborted requests gracefully", async () => {
  // Create a test server that reproduces the issue
  const serverCode = `
// Mock solid-js/web behavior with async generator
async function* renderToStream() {
  // Simulate slow rendering
  yield "<div>Start</div>";
  await new Promise(r => setTimeout(r, 100));
  yield "<div>Middle</div>";
  await new Promise(r => setTimeout(r, 100));
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
          for await (const chunk of renderToStream()) {
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      }
    });
    
    // Start piping but don't await
    source.pipeTo(writable).catch(err => {
      // This error should be handled gracefully
      console.error("PipeTo error:", err.message);
    });
    
    return new Response(readable);
  }
});

// Use IPC to communicate the URL
process.send({ url: server.url.href });
`;

  // Wait for server URL via IPC
  const { promise, resolve } = Promise.withResolvers<string>();

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", serverCode],
    env: bunEnv,
    ipc(message) {
      if (message.url) {
        resolve(message.url);
      }
    },
    stderr: "pipe",
  });

  const url = await promise;

  // Make multiple requests and abort them immediately
  const errors: string[] = [];

  for (let i = 0; i < 5; i++) {
    const controller = new AbortController();

    // Start the request
    const fetchPromise = fetch(url, { signal: controller.signal }).catch(err => {
      // We expect abort errors, that's fine
      if (err.name !== "AbortError") {
        errors.push(err.message);
      }
    });

    // Abort immediately (before stream finishes)
    controller.abort();

    await fetchPromise;
  }

  // Kill the server and wait for it to exit
  proc.kill();
  await proc.exited;

  // Now read stderr after process has exited
  const stderrOutput = await new Response(proc.stderr).text();

  // Check that we didn't get the "Cannot close a writable stream" error
  expect(stderrOutput).not.toContain("Cannot close a writable stream that is closed or errored");
  expect(stderrOutput).not.toContain("Segmentation fault");
  expect(errors).toHaveLength(0);
});

test("WritableStream close should throw appropriate error on already closed stream", async () => {
  const { readable, writable } = new TransformStream();

  // Close the writable side
  await writable.close();

  // Try to close again - this should throw a more appropriate error message
  try {
    await writable.close();
    expect(true).toBe(false); // Should not reach here
  } catch (err: any) {
    // The error should have the proper code
    expect(err.code).toBe("ERR_WRITABLE_STREAM_ALREADY_CLOSED");
    expect(err.message).toBe("Cannot close a stream that has already been closed");
  }
});

test("WritableStream close should reject with stored error on errored stream", async () => {
  const testError = new Error("Test error");
  const writable = new WritableStream({
    start(controller) {
      controller.error(testError);
    },
  });

  // Try to close an errored stream
  try {
    await writable.close();
    expect(true).toBe(false); // Should not reach here
  } catch (err: any) {
    // Should reject with the stored error, not a generic error
    expect(err).toBe(testError);
  }
});

test("pipeTo should handle destination stream errors gracefully", async () => {
  // Create a readable stream
  let controller: ReadableStreamDefaultController;
  const readable = new ReadableStream({
    start(c) {
      controller = c;
      c.enqueue("chunk1");
      c.enqueue("chunk2");
    },
  });

  // Create a writable stream that errors
  const writable = new WritableStream({
    write() {
      throw new Error("Write error");
    },
  });

  // pipeTo should handle the error without crashing
  try {
    await readable.pipeTo(writable);
    expect(true).toBe(false); // Should not reach here
  } catch (err: any) {
    expect(err.message).toBe("Write error");
  }
});
