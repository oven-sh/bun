import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "v8-heap-snapshot-fixture.ts");

const NODE_FIELDS = ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"];
const EDGE_FIELDS = ["type", "name_or_index", "to_node"];

// A heap snapshot contains everything that is live, so whatever a test allocates
// ends up inside the next snapshot taken in the same process. Parsing a snapshot
// with `v8-heapsnapshot` materializes an object per node and per edge, and two
// parses in a row grow the snapshot by ~10x, until the process is OOM-killed.
// Every snapshot therefore gets its own short-lived process.
async function runFixture(mode: string, { cwd = import.meta.dir, args = [] }: { cwd?: string; args?: string[] } = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, mode, ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`"${mode}" fixture exited with code ${exitCode}\n${stdout}\n${stderr}`);
  }
  return JSON.parse(stdout);
}

// The snapshot is well-formed and complete: the flat node/edge arrays line up
// with the counts in its header.
const structure = {
  nodeFields: NODE_FIELDS,
  edgeFields: EDGE_FIELDS,
  nodeCount: true,
  edgeCount: true,
  nodesComplete: true,
  edgesComplete: true,
  strings: true,
};

// Every node is defined and every edge resolves to one.
const walked = {
  parsedNodes: true,
  parsedEdges: true,
  edgesMissingTo: 0,
  undefinedNodes: 0,
};

// Deliberately sequential rather than `test.concurrent`: each fixture is
// single-threaded, so fanning six snapshots out at once buys wall time this file
// does not need by multiplying the peak RSS this file exists to bound.
test("v8 heap snapshot", async () => {
  expect(await runFixture("generate-string")).toEqual({ type: "string", ...structure, ...walked });
});

test("v8 heap snapshot arraybuffer", async () => {
  expect(await runFixture("generate-arraybuffer")).toEqual({
    isArrayBuffer: true,
    hasBytes: true,
    ...structure,
    ...walked,
  });
});

test("v8 heap snapshot arraybuffer matches string output", async () => {
  const { stringMeta, arrayBufferMeta } = await runFixture("compare-formats");
  expect(arrayBufferMeta).toEqual(stringMeta);
  expect(arrayBufferMeta.node_fields).toEqual(NODE_FIELDS);
  expect(arrayBufferMeta.edge_fields).toEqual(EDGE_FIELDS);
});

test("v8.getHeapSnapshot()", async () => {
  expect(await runFixture("get-heap-snapshot")).toEqual({ chunks: true, emptyChunks: 0, ...structure });
});

test("v8.writeHeapSnapshot()", async () => {
  // Without a path the snapshot is written to the cwd, so give it one we own.
  using dir = tempDir("v8-heap-snapshot", {});
  const { filename, ...rest } = await runFixture("write-default", { cwd: String(dir) });
  expect(filename).toMatch(/^Heap-\d{8}-\d{6}-\d+-\d+\.heapsnapshot$/);
  expect(rest).toEqual(structure);
});

test("v8.writeHeapSnapshot() with path", async () => {
  using dir = tempDir("v8-heap-snapshot", {});
  const path = join(String(dir), "test.heapsnapshot");
  expect(await runFixture("write-path", { args: [path] })).toEqual({ returnedPath: path, ...structure });
});

test("v8 heap snapshot labels Web Streams internal edges", async () => {
  const edges = await runFixture("stream-edges");
  // Every WriteBarrier member reported by analyzeHeap shows up as a named
  // property edge in the snapshot, so retainer paths are readable.
  expect(edges.ReadableStream).toEqual(expect.arrayContaining(["controller", "reader"]));
  expect(edges.ReadableStreamDefaultController).toEqual(expect.arrayContaining(["stream", "underlyingSource"]));
  expect(edges.ReadableStreamDefaultReader).toEqual(expect.arrayContaining(["stream", "closedPromise"]));
  expect(edges.WritableStream).toEqual(expect.arrayContaining(["controller", "writer"]));
  expect(edges.WritableStreamDefaultController).toEqual(
    expect.arrayContaining(["stream", "underlyingSink", "writeAlgorithm", "abortController"]),
  );
  expect(edges.WritableStreamDefaultWriter).toEqual(
    expect.arrayContaining(["stream", "closedPromise", "readyPromise"]),
  );
  expect(edges.TransformStream).toEqual(expect.arrayContaining(["readable", "writable", "controller"]));
  expect(edges.TransformStreamDefaultController).toEqual(
    expect.arrayContaining(["stream", "transformer", "transformAlgorithm"]),
  );
  expect(edges.StreamPipeToOperation).toEqual(
    expect.arrayContaining(["source", "destination", "reader", "writer", "promise"]),
  );
});
