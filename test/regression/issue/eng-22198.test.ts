import { expect, test } from "bun:test";

// Regression test for ENG-22198: heap-use-after-free in analyzeHeap
// The bug was that Identifier::fromString created temporary atom strings
// that could be freed before HeapSnapshotBuilder::json() used them.

test("generateHeapSnapshot does not crash with RedisClient in scope", () => {
  // Create a RedisClient - this will fail to connect but that's OK
  // The important thing is that the JSRedisClient object exists
  const client = Bun.RedisClient();

  // Call a method that returns a promise (will eventually reject)
  client.zintercard();

  // Generate heap snapshot - this used to cause use-after-free
  // because analyzeHeap created temporary Identifier objects
  const snapshot = Bun.generateHeapSnapshot();

  // Verify snapshot is valid
  expect(snapshot).toBeDefined();
  expect(typeof snapshot.version).toBe("number");
  expect(Array.isArray(snapshot.nodes)).toBe(true);
  expect(Array.isArray(snapshot.edges)).toBe(true);
});

test("generateHeapSnapshot does not crash with SHA1 in scope", () => {
  const hasher = Bun.SHA1();
  hasher.digest();

  const snapshot = Bun.generateHeapSnapshot();
  expect(snapshot).toBeDefined();
  expect(typeof snapshot.version).toBe("number");
});

test("generateHeapSnapshot followed by gc does not crash", () => {
  const client = Bun.RedisClient();
  client.zintercard();

  Bun.generateHeapSnapshot(-8.145247636185089e307);
  Bun.gc(true);

  // If we get here without crashing, the test passes
  expect(true).toBe(true);
});
