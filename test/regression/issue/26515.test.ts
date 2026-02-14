import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26515
// ReadableStream's controller.desiredSize should be null on fetch() ConnectionRefused

// Helper to get an ephemeral port that's guaranteed to be closed
async function getClosedPort(): Promise<number> {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });
  return server.port;
}

test("ReadableStream body desiredSize is null on fetch connection error", async () => {
  const port = await getClosedPort();

  // Use a deferred promise pattern to avoid async executor
  let resolveResult: (value: { desiredSizes: (number | null)[]; fetchError: string | null }) => void;
  const resultPromise = new Promise<{
    desiredSizes: (number | null)[];
    fetchError: string | null;
  }>(resolve => {
    resolveResult = resolve;
  });

  // Promise to signal when fetch has failed
  let resolveFetchFailed: () => void;
  const fetchFailedPromise = new Promise<void>(resolve => {
    resolveFetchFailed = resolve;
  });

  const desiredSizes: (number | null)[] = [];
  let fetchError: string | null = null;

  const inputStream = new ReadableStream({
    start(controller) {
      // Record initial desiredSize
      desiredSizes.push(controller.desiredSize);
    },
    async pull(controller) {
      // Enqueue a chunk
      controller.enqueue(new Uint8Array(1024));
      desiredSizes.push(controller.desiredSize);

      // Wait for the fetch to actually fail
      await fetchFailedPromise;

      // Record desiredSize after connection error
      desiredSizes.push(controller.desiredSize);
      resolveResult({ desiredSizes, fetchError });
    },
  });

  // Start the fetch (don't await - let it run concurrently)
  fetch(`http://localhost:${port}`, {
    method: "POST",
    body: inputStream,
    duplex: "half",
  }).catch((err: Error) => {
    fetchError = err.message;
    resolveFetchFailed();
  });

  const result = await resultPromise;

  // Verify fetch failed with connection error
  expect(result.fetchError).toContain("Unable to connect");

  // Verify desiredSizes:
  // - First value (start): should be highWaterMark (default 1)
  // - Second value (after enqueue): should be 0 (queue is full)
  // - Third value (after error): should be null (stream errored)
  expect(result.desiredSizes[0]).toBe(1);
  expect(result.desiredSizes[1]).toBe(0);
  expect(result.desiredSizes[2]).toBe(null);
});

test("ReadableStream body enqueue throws after fetch connection error", async () => {
  const port = await getClosedPort();

  // Use a deferred promise pattern to avoid async executor
  let resolveResult: (value: { enqueueError: string | null; fetchError: string | null }) => void;
  const resultPromise = new Promise<{
    enqueueError: string | null;
    fetchError: string | null;
  }>(resolve => {
    resolveResult = resolve;
  });

  // Promise to signal when fetch has failed
  let resolveFetchFailed: () => void;
  const fetchFailedPromise = new Promise<void>(resolve => {
    resolveFetchFailed = resolve;
  });

  let enqueueError: string | null = null;
  let fetchError: string | null = null;

  const inputStream = new ReadableStream({
    async pull(controller) {
      controller.enqueue(new Uint8Array(1024));

      // Wait for the fetch to actually fail
      await fetchFailedPromise;

      // Try to enqueue after error - should throw
      try {
        controller.enqueue(new Uint8Array(1024));
      } catch (err: any) {
        enqueueError = err.message;
      }
      resolveResult({ enqueueError, fetchError });
    },
  });

  // Start the fetch (don't await - let it run concurrently)
  fetch(`http://localhost:${port}`, {
    method: "POST",
    body: inputStream,
    duplex: "half",
  }).catch((err: Error) => {
    fetchError = err.message;
    resolveFetchFailed();
  });

  const result = await resultPromise;

  expect(result.fetchError).toContain("Unable to connect");
  expect(result.enqueueError).toContain("Controller is already closed");
});
