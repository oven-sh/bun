// Regression test for https://github.com/TanStack/router/issues/5289
// Memory leak when creating a new Response with another Response's body
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";

test("Response body ReadableStream should not create duplicate Strong references", () => {
  // Get baseline stream count
  Bun.gc(true);
  const baselineStats = heapStats();
  const baselineStreams = baselineStats.protectedObjectTypeCounts.ReadableStream || 0;

  // Create Response pairs using the problematic pattern
  for (let i = 0; i < 100; i++) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data${i}`));
        controller.close();
      },
    });

    const originalResponse = new Response(stream);
    // This pattern was causing a memory leak - creating duplicate Strong references
    new Response(originalResponse.body);
  }

  const afterCreateStats = heapStats();
  const streamsAfterCreate = afterCreateStats.protectedObjectTypeCounts.ReadableStream || 0;
  const createdStreams = streamsAfterCreate - baselineStreams;

  // Before the fix: would create 200 Strong references (2 per stream)
  // After the fix: should create ~100 Strong references (1 per stream, as r1 releases its ref)
  // We allow some margin for GC timing, but it should be closer to 100 than 200
  expect(createdStreams).toBeLessThan(150);
  expect(createdStreams).toBeGreaterThan(50);

  // Now force GC and verify streams are cleaned up
  Bun.gc(true);
  const afterGCStats = heapStats();
  const streamsAfterGC = afterGCStats.protectedObjectTypeCounts.ReadableStream || 0;

  // After GC, should have very few streams left (close to baseline)
  expect(streamsAfterGC - baselineStreams).toBeLessThan(10);
});

test("Bun.serve with Response body reuse should not leak", async () => {
  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      requestCount++;

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      });

      const originalResponse = new Response(stream);

      // This pattern in serve handlers was causing the leak
      return new Response(originalResponse.body, {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers: originalResponse.headers,
      });
    },
  });

  try {
    // Get baseline
    Bun.gc(true);
    const baselineStats = heapStats();
    const baselineStreams = baselineStats.protectedObjectTypeCounts.ReadableStream || 0;

    // Make many requests
    for (let i = 0; i < 50; i++) {
      await fetch(`http://localhost:${server.port}`);
    }

    expect(requestCount).toBe(50);

    // Force GC and check for leaks
    Bun.gc(true);
    const stats = heapStats();
    const streamCount = stats.protectedObjectTypeCounts.ReadableStream || 0;

    // Should be very few protected streams (close to baseline)
    expect(streamCount - baselineStreams).toBeLessThan(5);
  } finally {
    server.stop();
  }
});
