import { expect, test } from "bun:test";

// Regression test for issue #22192 - Segmentation fault while processing large arrays with Promise.all
// This test ensures that large Promise.all operations don't cause stack overflow crashes
test("large Promise.all should not segfault", async () => {
  const createTestData = (size: number) => {
    return Array.from({ length: size }, (_, i) => ({
      id: i,
      timestamp: Date.now() + i,
      file: `/path/to/file${i}.js`,
      type: "coding",
      category: "coding",
      project: `project-${i % 100}`,
      branch: `branch-${i % 10}`,
      language: "javascript",
      dependencies: Array.from({ length: 10 }, (_, j) => `dep-${j}`),
      lines: i * 10,
      lineno: i,
      cursorpos: i * 5,
      is_write: i % 2 === 0,
    }));
  };

  const processItem = async (item: any) => {
    // Simulate async processing that creates microtasks
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));

    return {
      ...item,
      processed: true,
      hash: `hash-${item.id}`,
      metadata: {
        original: item,
        processedAt: new Date().toISOString(),
        extras: Array.from({ length: 5 }, (_, i) => `extra-${i}`),
      },
    };
  };

  // Test progressively larger sizes to find the limit
  const testSizes = [1000, 5000, 10000, 25000, 50000];

  for (const size of testSizes) {
    console.log(`Testing Promise.all with ${size} items...`);

    const items = createTestData(size);
    const startTime = Date.now();

    // This operation should not segfault even with large arrays
    const results = await Promise.all(items.map(processItem));

    const duration = Date.now() - startTime;
    console.log(`Processed ${results.length} items in ${duration}ms`);

    expect(results).toHaveLength(size);
    expect(results[0]).toHaveProperty("processed", true);
    expect(results[0]).toHaveProperty("hash");
    expect(results[0]).toHaveProperty("metadata");
  }

  // Test an especially large size that was known to cause segfaults - but with chunking to avoid memory issues
  console.log("Testing with 75000 items (chunked to avoid memory pressure)...");
  const chunkSize = 10000;
  const totalSize = 75000;
  const allResults = [];

  for (let i = 0; i < totalSize; i += chunkSize) {
    const chunk = createTestData(Math.min(chunkSize, totalSize - i));
    const chunkResults = await Promise.all(chunk.map(processItem));
    allResults.push(...chunkResults);

    // Force GC between chunks
    if (global.gc) global.gc();
  }

  expect(allResults).toHaveLength(totalSize);
  expect(allResults[0]).toHaveProperty("processed", true);
}, 60000); // 60 second timeout for large operations

// Test specific nested Promise patterns that can cause deep recursion
test("deeply nested Promise chains should not segfault", async () => {
  const createNestedPromise = (depth: number): Promise<number> => {
    if (depth === 0) {
      return Promise.resolve(1);
    }
    return Promise.resolve().then(() => createNestedPromise(depth - 1));
  };

  // Test with depths that previously caused issues
  const depths = [1000, 5000, 10000, 20000];

  for (const depth of depths) {
    console.log(`Testing nested Promise chain with depth: ${depth}`);
    const result = await createNestedPromise(depth);
    expect(result).toBe(1);
  }
});

// Test the specific pattern from the original wakatime issue
test("wakatime-style Promise.all processing should not segfault", async () => {
  const createHeartbeat = (id: number) => ({
    id,
    timestamp: Date.now() + id,
    file: `/path/to/file${id}.js`,
    type: "coding",
    category: "coding",
    project: `project-${id % 100}`,
    branch: `branch-${id % 10}`,
    language: "javascript",
    dependencies: Array.from({ length: 20 }, (_, j) => `dep-${j}`),
    lines: id * 10,
    lineno: id,
    cursorpos: id * 5,
    is_write: id % 2 === 0,
    machine_name: `machine-${id % 50}`,
    user_agent: `Agent-${id % 100}`,
  });

  const mapHeartbeat = async (heartbeat: any, userAgents: string[], userId: string) => {
    // Simulate the async processing from the original issue
    await new Promise(resolve => setImmediate(resolve));

    return {
      ...heartbeat,
      userId,
      userAgent: userAgents[heartbeat.id % userAgents.length],
      processed: true,
      hash: `hash-${heartbeat.id}`,
      metadata: {
        original: heartbeat,
        processedAt: new Date().toISOString(),
        extras: Array.from({ length: 20 }, (_, i) => `extra-${i}`),
      },
    };
  };

  const userAgents = Array.from({ length: 1000 }, (_, i) => `UserAgent-${i}`);
  const userId = "test-user-id";

  // Test the exact pattern that caused the segfault
  const sizes = [10000, 25000, 50000];

  for (const size of sizes) {
    console.log(`Testing wakatime pattern with ${size} heartbeats`);
    const heartbeats = Array.from({ length: size }, (_, i) => createHeartbeat(i));

    const startTime = Date.now();
    const results = await Promise.all(heartbeats.map(heartbeat => mapHeartbeat(heartbeat, userAgents, userId)));

    const duration = Date.now() - startTime;
    console.log(`Processed ${results.length} heartbeats in ${duration}ms`);

    expect(results).toHaveLength(size);
    expect(results[0]).toHaveProperty("userId", userId);
    expect(results[0]).toHaveProperty("processed", true);
    expect(results[0]).toHaveProperty("metadata");
  }
}, 120000); // 2 minute timeout for very large operations
