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

// The `yyyymmdd` a default snapshot filename is supposed to carry: local time,
// 1-based calendar month, the way node writes it.
function calendarDate(date: Date) {
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${date.getFullYear()}${mm}${dd}`;
}

// Runs the snapshot through a third-party parser, then walks every node and edge.
async function parseAndWalk(json: unknown) {
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
    // Bracket the call so the caller still knows which date to expect if this
    // process happens to cross midnight while the snapshot is being written.
    const dateBefore = calendarDate(new Date());
    const path = require("node:v8").writeHeapSnapshot();
    const dateAfter = calendarDate(new Date());
    const json = await Bun.file(path).json();
    require("node:fs").rmSync(path);
    result = { filename: require("node:path").basename(path), dateBefore, dateAfter, ...describeSnapshot(json) };
    break;
  }

  case "write-path": {
    const returnedPath = require("node:v8").writeHeapSnapshot(pathArg);
    result = { returnedPath, ...describeSnapshot(await Bun.file(pathArg).json()) };
    break;
  }

  default:
    throw new Error(`Unknown mode: ${mode}`);
}

console.log(JSON.stringify(result));
