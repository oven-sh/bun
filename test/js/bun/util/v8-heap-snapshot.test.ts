import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "v8-heap-snapshot-fixture.ts");
const namesFixture = join(import.meta.dir, "v8-heap-snapshot-names-fixture.ts");

const NODE_FIELDS = ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"];
const EDGE_FIELDS = ["type", "name_or_index", "to_node"];

// A heap snapshot contains everything that is live, so whatever a test allocates
// ends up inside the next snapshot taken in the same process. Parsing a snapshot
// with `v8-heapsnapshot` materializes an object per node and per edge, and two
// parses in a row grow the snapshot by ~10x, until the process is OOM-killed.
// Every snapshot therefore gets its own short-lived process.
async function runFixture(
  mode: string,
  { cwd = import.meta.dir, args = [], script = fixture }: { cwd?: string; args?: string[]; script?: string } = {},
) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), script, mode, ...args],
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

// `yyyymmdd.hhmmss` of every second from `before` to `after`, both in ms since
// the epoch, as a clock `utcOffsetHours` east of UTC shows it. A fixture starts
// in UTC: `bunEnv` sets TZ.
function timestamps({ before, after }: { before: number; after: number }, utcOffsetHours = 0) {
  const stamps: string[] = [];
  for (let second = Math.floor(before / 1000); second <= Math.floor(after / 1000); second++) {
    const iso = new Date((second + utcOffsetHours * 3600) * 1000).toISOString();
    stamps.push(iso.slice(0, 19).replace("T", ".").replace(/[-:]/g, ""));
  }
  return stamps;
}

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
  const before = Date.now();
  const { filename, ...rest } = await runFixture("write-default", { cwd: String(dir) });
  const after = Date.now();
  // The timestamp comes first and accepts any separator, so that a wrong date
  // fails here whatever the rest of the name looks like.
  const [, date, time] = filename.match(/^Heap\D(\d{8})\D(\d{6})\D/) ?? [];
  expect(timestamps({ before, after })).toContain(`${date}.${time}`);
  // node's DiagnosticFilename: Heap.<yyyymmdd>.<hhmmss>.<pid>.<thread id>.<sequence number>
  expect(filename).toMatch(/^Heap\.\d{8}\.\d{6}\.\d+\.0\.001\.heapsnapshot$/);
  expect(rest).toEqual(structure);
});

test("v8.writeHeapSnapshot() default names", async () => {
  using dir = tempDir("v8-heap-snapshot", {});
  const { names, underMockedClock, inKiritimati, files } = await runFixture("default-names", {
    cwd: String(dir),
    script: namesFixture,
  });

  // <thread id>.<sequence number> twice on the main thread, twice in a Worker,
  // then on the main thread: the process has one counter, as in node.
  const threadAndSequence = (name: string) => name.match(/\.(\d+\.\d{3})\.heapsnapshot$/)?.[1] ?? name;
  expect(names.map(threadAndSequence)).toEqual(["0.001", "0.002", "1.003", "1.004", "0.005"]);

  const timestamp = (name: string) => name.match(/^Heap\.(\d{8}\.\d{6})\./)?.[1] ?? name;
  // `setSystemTime` had moved `Date` to the year 2000. The name keeps the real clock.
  expect(underMockedClock.mockedNow).toBe(Date.UTC(2000, 0, 1));
  expect(timestamps(underMockedClock)).toContain(timestamp(underMockedClock.name));
  // `process.env.TZ` had become "Pacific/Kiritimati", which is UTC+14 all year.
  expect(timestamps(inKiritimati, 14)).toContain(timestamp(inKiritimati.name));

  // Every call wrote a file of its own.
  expect(files).toEqual([...names, underMockedClock.name, inKiritimati.name].sort());
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
