import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/26300
// SSE connections using TransformStream should trigger onClosed/writer.closed when client disconnects
test("TransformStream readable side should be cancelled when client disconnects", async () => {
  const { promise: cleanupPromise, resolve: resolveCleanup } = Promise.withResolvers<string>();
  const { promise: serverReady, resolve: serverReadyResolve } = Promise.withResolvers<void>();
  const { promise: dataSent, resolve: resolveDataSent } = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      const stream = new TransformStream();
      const writer = stream.writable.getWriter();

      // This should be called when the client disconnects
      writer.closed
        .then(() => {
          resolveCleanup("closed-normally");
        })
        .catch(e => {
          // AbortError is expected when client disconnects
          resolveCleanup(`closed-with-error:${e?.name ?? "unknown"}`);
        });

      // Send initial data to ensure connection is fully established
      writer.write(new TextEncoder().encode("data: connected\n\n")).then(() => {
        resolveDataSent();
      });

      serverReadyResolve();

      return new Response(stream.readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    },
  });

  // Use a subprocess to make a request that we can kill to simulate socket close
  await using proc = Bun.spawn({
    cmd: ["curl", "-s", "-N", `http://localhost:${server.port}`],
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for server to receive the request
  await serverReady;

  // Wait for data to be sent, ensuring connection is fully established
  await dataSent;

  // Kill the curl process to simulate client disconnect
  proc.kill();

  // Wait for the cleanup to happen - test runner timeout will fail the test if this never resolves
  // Without the fix, this would hang forever as writer.closed never resolves/rejects
  const result = await cleanupPromise;

  // The writer.closed promise should resolve or reject with an error
  expect(result).toMatch(/^closed-(normally|with-error:)/);
});

test("ReadableStream from TransformStream should propagate cancellation to writable side", async () => {
  const { promise: closedPromise, resolve: resolveClosedPromise } = Promise.withResolvers<void>();

  const transformStream = new TransformStream();
  const writer = transformStream.writable.getWriter();

  writer.closed.then(() => resolveClosedPromise()).catch(() => resolveClosedPromise());

  // Cancel the readable side directly
  await transformStream.readable.cancel(new Error("test cancellation"));

  // Wait for writer.closed to resolve/reject - test runner timeout will fail if this never happens
  await closedPromise;
});
