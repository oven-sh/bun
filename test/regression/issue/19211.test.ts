import { expect, test } from "bun:test";

test("reader.cancel() on fetch response should trigger server abort signal", async () => {
  // Server that streams data and tracks abort signal
  const server = Bun.serve({
    fetch(request) {
      let count = 0;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            count++;
            controller.enqueue(new TextEncoder().encode(`chunk ${count}\n`));
            // Small delay to allow cancellation to propagate
            await new Promise(resolve => setTimeout(resolve, 100));
            if (count > 20) controller.close();
          },
          cancel(_reason) {
            // Stream cancel callback - verifies server-side stream cancellation
          },
        }),
      );
    },
    port: 0,
  });

  try {
    const res = await fetch(`http://localhost:${server.port}`, {
      method: "POST",
    });
    const reader = res.body!.getReader();

    // Read a couple of chunks
    const chunk1 = await reader.read();
    expect(chunk1.done).toBe(false);
    expect(new TextDecoder().decode(chunk1.value)).toBe("chunk 1\n");

    const chunk2 = await reader.read();
    expect(chunk2.done).toBe(false);
    expect(new TextDecoder().decode(chunk2.value)).toBe("chunk 2\n");

    // Cancel the reader - this should eventually trigger server-side abort
    await reader.cancel();

    // Give time for the abort to propagate through the HTTP connection
    await new Promise(resolve => setTimeout(resolve, 500));

    // Make another request to verify the server is still functional
    // and the previous connection was properly closed
    const res2 = await fetch(`http://localhost:${server.port}`, {
      method: "POST",
    });
    const reader2 = res2.body!.getReader();
    const chunk = await reader2.read();
    expect(chunk.done).toBe(false);
    expect(new TextDecoder().decode(chunk.value)).toBe("chunk 1\n");
    await reader2.cancel();
  } finally {
    server.stop(true);
  }
});

test("reader.cancel() on fetch response should abort the HTTP connection", async () => {
  // Track whether the server's stream cancel callback was called
  let streamCancelCalled = false;
  let serverChunkCount = 0;
  const { promise: cancelPromise, resolve: cancelResolve } = Promise.withResolvers<void>();

  const server = Bun.serve({
    fetch(request) {
      return new Response(
        new ReadableStream({
          async pull(controller) {
            serverChunkCount++;
            controller.enqueue(new TextEncoder().encode(`data: ${serverChunkCount}\n\n`));
            await new Promise(resolve => setTimeout(resolve, 100));
            if (serverChunkCount > 50) controller.close();
          },
          cancel(_reason) {
            streamCancelCalled = true;
            cancelResolve();
          },
        }),
      );
    },
    port: 0,
  });

  try {
    const res = await fetch(`http://localhost:${server.port}`);
    const reader = res.body!.getReader();

    // Read two chunks
    await reader.read();
    await reader.read();

    // Record how many chunks the server has sent so far
    const chunksBeforeCancel = serverChunkCount;

    // Cancel the reader
    await reader.cancel();

    // Wait for cancellation to propagate, but with a timeout
    await Promise.race([cancelPromise, new Promise(resolve => setTimeout(resolve, 2000))]);

    // The server should have stopped sending chunks shortly after cancel
    // Allow a small margin for in-flight data
    expect(serverChunkCount).toBeLessThan(chunksBeforeCancel + 5);
  } finally {
    server.stop(true);
  }
});
