import { expect, test } from "bun:test";
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
