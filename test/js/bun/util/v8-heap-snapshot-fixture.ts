// Spawned by v8-heap-snapshot.test.ts, one mode per process.
// v8HeapSnapshot.parseSnapshot() materializes a JS object per node and per edge,
// and that graph lands inside the next snapshot taken from the same heap, so
// every mode gets a fresh process with a small heap. For the same reason each
// mode loads only the modules it needs, and only once it needs them.

// Reports what the snapshot says about itself. The node and edge arrays are
// flat, so a short one means the snapshot was truncated.
function describeSnapshot(json: any) {
  const { meta, node_count, edge_count } = json.snapshot;
  return {
    nodeFields: meta.node_fields,
    edgeFields: meta.edge_fields,
    nodeCount: node_count > 0,
    edgeCount: edge_count > 0,
    nodesComplete: json.nodes.length === node_count * meta.node_fields.length,
    edgesComplete: json.edges.length === edge_count * meta.edge_fields.length,
    strings: json.strings.length > 0,
  };
}

// Runs the snapshot through a third-party parser, then walks every node and edge.
async function parseAndWalk(json: object) {
  const v8HeapSnapshot: typeof import("v8-heapsnapshot") = require("v8-heapsnapshot");
  const parsed = await v8HeapSnapshot.parseSnapshot(json);

  let edgesMissingTo = 0;
  for (const edge of parsed.edges) {
    if (!edge.to) edgesMissingTo++;
  }
  let undefinedNodes = 0;
  for (const node of parsed.nodes) {
    if (!node) undefinedNodes++;
  }

  return {
    parsedNodes: parsed.nodes.length > 0,
    parsedEdges: parsed.edges.length > 0,
    edgesMissingTo,
    undefinedNodes,
  };
}

const [mode, pathArg] = process.argv.slice(2);

let result: Record<string, unknown>;
switch (mode) {
  case "generate-string": {
    const snapshot = Bun.generateHeapSnapshot("v8");
    const json = JSON.parse(snapshot);
    result = { type: typeof snapshot, ...describeSnapshot(json), ...(await parseAndWalk(json)) };
    break;
  }

  case "generate-arraybuffer": {
    const snapshot = Bun.generateHeapSnapshot("v8", "arraybuffer");
    const json = JSON.parse(new TextDecoder().decode(snapshot));
    result = {
      isArrayBuffer: snapshot instanceof ArrayBuffer,
      hasBytes: snapshot.byteLength > 0,
      ...describeSnapshot(json),
      ...(await parseAndWalk(json)),
    };
    break;
  }

  case "compare-formats": {
    const fromString = JSON.parse(Bun.generateHeapSnapshot("v8"));
    const fromArrayBuffer = JSON.parse(new TextDecoder().decode(Bun.generateHeapSnapshot("v8", "arraybuffer")));
    result = { stringMeta: fromString.snapshot.meta, arrayBufferMeta: fromArrayBuffer.snapshot.meta };
    break;
  }

  // The three modes below all hand back the same `Bun.generateHeapSnapshot("v8")`
  // string the modes above already ran through the parser, so they only check
  // that what came out the other side is a complete snapshot.
  case "get-heap-snapshot": {
    const chunks: Buffer[] = [];
    let emptyChunks = 0;
    for await (const chunk of require("node:v8").getHeapSnapshot()) {
      if (chunk.byteLength === 0) emptyChunks++;
      chunks.push(chunk);
    }
    result = {
      chunks: chunks.length > 0,
      emptyChunks,
      ...describeSnapshot(JSON.parse(Buffer.concat(chunks).toString("utf-8"))),
    };
    break;
  }

  case "write-default": {
    const path = require("node:v8").writeHeapSnapshot();
    const json = await Bun.file(path).json();
    require("node:fs").rmSync(path);
    result = { filename: require("node:path").basename(path), ...describeSnapshot(json) };
    break;
  }

  case "write-path": {
    const returnedPath = require("node:v8").writeHeapSnapshot(pathArg);
    result = { returnedPath, ...describeSnapshot(await Bun.file(pathArg).json()) };
    break;
  }

  // The names `v8.writeHeapSnapshot()` gives when it gets no path. This mode is
  // about the names, so every snapshot is "{}" and a call costs only its file.
  case "default-names": {
    const v8 = require("node:v8");
    const { Worker } = require("node:worker_threads");
    Object.assign(Bun, { generateHeapSnapshot: () => "{}" });

    // Twice on the main thread, twice in a Worker, once more on the main thread.
    const names: string[] = [v8.writeHeapSnapshot(), v8.writeHeapSnapshot()];
    const worker = new Worker(
      `Bun.generateHeapSnapshot = () => "{}";
       const v8 = require("node:v8");
       require("node:worker_threads").parentPort.postMessage([v8.writeHeapSnapshot(), v8.writeHeapSnapshot()]);`,
      { eval: true },
    );
    const fromWorker = Promise.withResolvers<string[]>();
    worker.once("message", fromWorker.resolve);
    worker.once("error", fromWorker.reject);
    worker.once("exit", code => fromWorker.reject(new Error(`the worker exited with code ${code} and no message`)));
    names.push(...(await fromWorker.promise), v8.writeHeapSnapshot());
    await worker.terminate();

    // Each of the next two names is taken between two readings of the real clock.
    const underMockedClock = { before: Date.now(), name: "", after: 0 };
    const { setSystemTime } = Bun.jest(import.meta.path);
    setSystemTime(new Date("2000-01-01T00:00:00Z"));
    underMockedClock.name = v8.writeHeapSnapshot();
    setSystemTime();
    underMockedClock.after = Date.now();

    process.env.TZ = "Pacific/Kiritimati";
    const inKiritimati = { before: Date.now(), name: v8.writeHeapSnapshot(), after: 0 };
    inKiritimati.after = Date.now();

    const files = require("node:fs").readdirSync(".").sort();
    result = { names, underMockedClock, inKiritimati, files };
    break;
  }

  case "stream-edges": {
    // Build a graph touching the main Web Streams cell classes and keep every
    // handle live across the snapshot so analyzeHeap can see the edges.
    const rs = new ReadableStream({ start() {} });
    const reader = rs.getReader();
    const ws = new WritableStream({ write() {} });
    const writer = ws.getWriter();
    const ts = new TransformStream({ transform() {} });
    const pipePromise = ts.readable
      .pipeTo(new WritableStream({ write() {} }))
      .catch(() => {});

    const json = JSON.parse(Bun.generateHeapSnapshot("v8"));
    // Referenced after the snapshot so nothing above is dead before it runs.
    void (rs as unknown, reader, ws, writer, ts, pipePromise);

    const meta = json.snapshot.meta;
    const nodeStride = meta.node_fields.length;
    const edgeStride = meta.edge_fields.length;
    const nameIdx = meta.node_fields.indexOf("name");
    const edgeCountIdx = meta.node_fields.indexOf("edge_count");
    const edgeTypeIdx = meta.edge_fields.indexOf("type");
    const edgeNameIdx = meta.edge_fields.indexOf("name_or_index");
    const propertyType = meta.edge_types[edgeTypeIdx].indexOf("property");

    const wanted = new Set([
      "ReadableStream",
      "WritableStream",
      "TransformStream",
      "ReadableStreamDefaultController",
      "ReadableStreamDefaultReader",
      "WritableStreamDefaultController",
      "WritableStreamDefaultWriter",
      "TransformStreamDefaultController",
      "StreamPipeToOperation",
    ]);
    const edgesByClass: Record<string, string[]> = {};
    for (const name of wanted) edgesByClass[name] = [];

    let e = 0;
    for (let n = 0; n < json.nodes.length; n += nodeStride) {
      const className = json.strings[json.nodes[n + nameIdx]];
      const edgeCount = json.nodes[n + edgeCountIdx];
      if (wanted.has(className)) {
        for (let k = 0; k < edgeCount; k++) {
          const base = e + k * edgeStride;
          if (json.edges[base + edgeTypeIdx] === propertyType) {
            const edgeName = json.strings[json.edges[base + edgeNameIdx]];
            if (!edgesByClass[className].includes(edgeName)) {
              edgesByClass[className].push(edgeName);
            }
          }
        }
      }
      e += edgeCount * edgeStride;
    }
    for (const name of wanted) edgesByClass[name].sort();
    result = edgesByClass;
    break;
  }

  default:
    throw new Error(`Unknown mode: ${mode}`);
}

console.log(JSON.stringify(result));
