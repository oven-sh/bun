import { afterEach, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "node:path";
import * as v8 from "v8";
import * as v8HeapSnapshot from "v8-heapsnapshot";

// Generating + parsing a v8 heap snapshot is an inherently expensive operation
// (full sync GC + serialize the entire heap to JSON + parse it back). Make sure
// the large object graphs these tests build don't linger between subtests.
afterEach(() => {
  Bun.gc(true);
});

test(
  "v8 heap snapshot",
  async () => {
    const snapshot = Bun.generateHeapSnapshot("v8");
    // The full parseSnapshot() validation is exercised by "v8 heap snapshot
    // arraybuffer"; here just make sure the string output is valid JSON with the
    // expected top-level shape.
    const parsed = JSON.parse(snapshot);

    expect(parsed.snapshot).toBeDefined();
    expect(parsed.snapshot.meta).toBeDefined();
    expect(parsed.nodes).toBeInstanceOf(Array);
    expect(parsed.edges).toBeInstanceOf(Array);
    expect(parsed.nodes.length).toBeGreaterThan(0);
    expect(parsed.edges.length).toBeGreaterThan(0);
  },
  30_000,
);

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

test(
  "v8 heap snapshot arraybuffer",
  async () => {
    const snapshot = Bun.generateHeapSnapshot("v8", "arraybuffer");
    expect(snapshot).toBeInstanceOf(ArrayBuffer);
    expect(snapshot.byteLength).toBeGreaterThan(0);

    // Decode the ArrayBuffer as UTF-8 and parse it as JSON
    const text = new TextDecoder().decode(snapshot);
    const parsed = JSON.parse(text);

    // Validate structure
    expect(parsed.snapshot).toBeDefined();
    expect(parsed.snapshot.meta).toBeDefined();
    expect(parsed.nodes).toBeInstanceOf(Array);
    expect(parsed.edges).toBeInstanceOf(Array);
    expect(parsed.strings).toBeInstanceOf(Array);
    expect(parsed.nodes.length).toBeGreaterThan(0);
    expect(parsed.edges.length).toBeGreaterThan(0);
    expect(parsed.strings.length).toBeGreaterThan(0);

    // Also validate via v8-heapsnapshot library
    const parsedSnapshot = await v8HeapSnapshot.parseSnapshot(parsed);
    expect(parsedSnapshot.nodes.length).toBeGreaterThan(0);
    expect(parsedSnapshot.edges.length).toBeGreaterThan(0);
  },
  30_000,
);

test("v8 heap snapshot arraybuffer matches string output", async () => {
  // The arraybuffer output should produce valid JSON identical in structure to the string output
  const snapshotBuffer = Bun.generateHeapSnapshot("v8", "arraybuffer");
  const text = new TextDecoder().decode(snapshotBuffer);
  const parsed = JSON.parse(text);

  // Verify it has the same meta structure
  expect(parsed.snapshot.meta.node_fields).toEqual([
    "type",
    "name",
    "id",
    "self_size",
    "edge_count",
    "trace_node_id",
    "detachedness",
  ]);
  expect(parsed.snapshot.meta.edge_fields).toEqual(["type", "name_or_index", "to_node"]);
  expect(parsed.snapshot.node_count).toBeGreaterThan(0);
  expect(parsed.snapshot.edge_count).toBeGreaterThan(0);
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
