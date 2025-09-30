// Regression test for https://github.com/TanStack/router/issues/5289
// Memory inefficiency when creating a new Response with another Response's body
import { test, expect } from "bun:test";
import { heapStats } from "bun:jsc";

test("Response body ReadableStream creates duplicate Strong references (known issue)", () => {
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
    // This pattern creates duplicate Strong references (inefficiency, not a true leak)
    new Response(originalResponse.body);
  }

  const afterCreateStats = heapStats();
  const streamsAfterCreate = afterCreateStats.protectedObjectTypeCounts.ReadableStream || 0;
  const createdStreams = streamsAfterCreate - baselineStreams;

  // Currently creates 200 Strong references (2 per stream) - this is inefficient but not a leak
  // TODO: Optimize to create only ~100 Strong references (1 per stream)
  expect(createdStreams).toBeGreaterThanOrEqual(190);  // Verify the issue exists
  expect(createdStreams).toBeLessThanOrEqual(210);     // Allow some margin

  // Now force GC and verify streams ARE cleaned up (proving it's not a leak)
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
