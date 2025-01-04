import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "node:path";
import * as v8 from "v8";
import * as v8HeapSnapshot from "v8-heapsnapshot";

test("v8 heap snapshot", async () => {
  const snapshot = Bun.generateHeapSnapshot("v8");
  // Sanity check: run the validations from this library
  const parsed = await v8HeapSnapshot.parseSnapshot(JSON.parse(snapshot));

  // Loop over all edges and nodes as another sanity check.
  for (const edge of parsed.edges) {
    if (!edge.to) {
      throw new Error("Edge has no 'to' property");
    }
  }
  for (const node of parsed.nodes) {
    if (!node) {
      throw new Error("Node is undefined");
    }
  }

  expect(parsed.nodes.length).toBeGreaterThan(0);
  expect(parsed.edges.length).toBeGreaterThan(0);
});

test("v8.getHeapSnapshot()", async () => {
  const snapshot = v8.getHeapSnapshot();
  let chunks = [];
  for await (const chunk of snapshot) {
    expect(chunk.byteLength).toBeGreaterThan(0);
    chunks.push(chunk);
  }
  expect(chunks.length).toBeGreaterThan(0);
});

test("v8.writeHeapSnapshot()", async () => {
  const path = v8.writeHeapSnapshot();
  expect(path).toBeDefined();
  expect(path).toContain("Heap-");

  const snapshot = await Bun.file(path).json();
  expect(await v8HeapSnapshot.parseSnapshot(snapshot)).toBeDefined();
});

test("v8.writeHeapSnapshot() with path", async () => {
  const dir = tempDirWithFiles("v8-heap-snapshot", {
    "test.heapsnapshot": "",
  });

  const path = join(dir, "test.heapsnapshot");
  v8.writeHeapSnapshot(path);

  const snapshot = await Bun.file(path).json();
  expect(await v8HeapSnapshot.parseSnapshot(snapshot)).toBeDefined();
});
