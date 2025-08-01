//! This is a decently effecient heap profiler reader.

export interface HeapSnapshotData {
  nodes: Float64Array;
  edges: Float64Array;
  nodeClassNames: string[];
  edgeNames: string[];
  edgeTypes: string[];
  type: "Inspector" | "GCDebugging";
}

const enum NodeLayout {
  ID = 0,
  SIZE = 1,
  CLASS_NAME_IDX = 2,
  FLAGS = 3,
  LABEL_IDX = 4,
  CELL_ADDR = 5,
  WRAPPED_ADDR = 6,
  STRIDE_GCDEBUGGING = 7,
  STRIDE_INSPECTOR = 4,
}

const enum EdgeLayout {
  FROM_NODE = 0,
  TO_NODE = 1,
  TYPE = 2,
  NAME_OR_INDEX = 3,
  STRIDE = 4,
}

const enum TypeStatsLayout {
  NAME = 0,
  SIZE = 1,
  COUNT = 2,
  RETAINED_SIZE = 3,
  STRIDE = 4,
}

export class TypeStats {
  constructor(private stats: Array<string | number>) {}

  [Symbol.iterator]() {
    const stats = this.stats;
    let i = 0;
    var iterator: IterableIterator<{
      name: string;
      size: number;
      count: number;
      retainedSize: number;
    }> = {
      [Symbol.iterator]() {
        return iterator;
      },
      next() {
        if (i >= stats.length) {
          return { done: true, value: undefined };
        }
        const name = stats[i++] as string;
        const size = stats[i++] as number;
        const count = stats[i++] as number;
        const retainedSize = stats[i++] as number;
        return {
          done: false,
          value: { name, size, count, retainedSize },
        };
      },
    };
    return iterator;
  }
}

export function parseHeapSnapshot(data: {
  nodes: number[];
  edges: number[];
  nodeClassNames: string[];
  edgeNames: string[];
  edgeTypes: string[];
  type: "Inspector" | "GCDebugging";
}): HeapSnapshotData {
  return {
    nodes: new Float64Array(data.nodes),
    edges: new Float64Array(data.edges),
    nodeClassNames: data.nodeClassNames,
    edgeNames: data.edgeNames,
    edgeTypes: data.edgeTypes,
    type: data.type,
  };
}

function getNodeStride(data: HeapSnapshotData): number {
  return data.type === "GCDebugging" ? NodeLayout.STRIDE_GCDEBUGGING : NodeLayout.STRIDE_INSPECTOR;
}

export function summarizeByType(data: HeapSnapshotData): TypeStats {
  const nodeStride = getNodeStride(data);
  const statsArray = new Array(data.nodeClassNames.length * TypeStatsLayout.STRIDE);

  // Initialize the stats array
  for (let i = 0, nameIdx = 0; nameIdx < data.nodeClassNames.length; nameIdx++) {
    statsArray[i++] = data.nodeClassNames[nameIdx];
    statsArray[i++] = 0; // size
    statsArray[i++] = 0; // count
    statsArray[i++] = 0; // retained size
  }

  // Calculate retained sizes
  const retainedSizes = computeRetainedSizes(data);

  // Accumulate stats
  for (let i = 0, nodeIndex = 0, nodes = data.nodes; i < nodes.length; i += nodeStride, nodeIndex++) {
    const classNameIdx = nodes[i + NodeLayout.CLASS_NAME_IDX];
    const size = nodes[i + NodeLayout.SIZE];

    const statsOffset = classNameIdx * TypeStatsLayout.STRIDE;
    statsArray[statsOffset + 1] += size; // Add to size
    statsArray[statsOffset + 2] += 1; // Increment count
    statsArray[statsOffset + 3] += retainedSizes[nodeIndex]; // Add retained size
  }

  return new TypeStats(statsArray);
}

// TODO: this is wrong.
function computeRetainedSizes(data: HeapSnapshotData): Float64Array {
  const nodeStride = getNodeStride(data);
  const nodeCount = Math.floor(data.nodes.length / nodeStride);

  // Initialize arrays
  const retainedSizes = new Float64Array(nodeCount);
  const processedNodes = new Uint8Array(nodeCount);
  const incomingEdgeCount = new Uint32Array(nodeCount);
  const isRoot = new Uint8Array(nodeCount);

  // Initialize with shallow sizes
  for (let i = 0; i < nodeCount; i++) {
    const offset = i * nodeStride;
    retainedSizes[i] = data.nodes[offset + NodeLayout.SIZE] || 0;
  }

  // Mark node 0 as root
  isRoot[0] = 1;

  // Build outgoing edges list and count incoming edges
  const outgoingEdges = new Array<number[]>(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    outgoingEdges[i] = [];
  }

  // First pass - count incoming edges
  for (let i = 0; i < data.edges.length; i += EdgeLayout.STRIDE) {
    const fromNode = data.edges[i + EdgeLayout.FROM_NODE];
    const toNode = data.edges[i + EdgeLayout.TO_NODE];

    if (fromNode >= 0 && fromNode < nodeCount && toNode >= 0 && toNode < nodeCount && fromNode !== toNode) {
      incomingEdgeCount[toNode]++;
      outgoingEdges[fromNode].push(toNode);
    }
  }

  // Find roots - nodes with no incoming edges
  for (let i = 1; i < nodeCount; i++) {
    if (incomingEdgeCount[i] === 0) {
      isRoot[i] = 1;
    }
  }

  function computeRetainedSize(nodeIndex: number): number {
    if (processedNodes[nodeIndex]) return retainedSizes[nodeIndex];
    processedNodes[nodeIndex] = 1;

    let size = retainedSizes[nodeIndex];

    // If we're a root, include everything we retain
    if (isRoot[nodeIndex]) {
      const outgoing = outgoingEdges[nodeIndex];
      for (let i = 0; i < outgoing.length; i++) {
        const childIndex = outgoing[i];
        if (childIndex !== nodeIndex) {
          size += computeRetainedSize(childIndex);
        }
      }
    } else {
      // For non-roots, only include uniquely retained children
      const outgoing = outgoingEdges[nodeIndex];
      for (let i = 0; i < outgoing.length; i++) {
        const childIndex = outgoing[i];
        if (childIndex !== nodeIndex && incomingEdgeCount[childIndex] === 1) {
          size += computeRetainedSize(childIndex);
        }
      }
    }

    retainedSizes[nodeIndex] = size;
    return size;
  }

  // Process roots first
  for (let i = 0; i < nodeCount; i++) {
    if (isRoot[i]) {
      computeRetainedSize(i);
    }
  }

  // Process remaining nodes
  for (let i = 0; i < nodeCount; i++) {
    if (!processedNodes[i]) {
      computeRetainedSize(i);
    }
  }

  return retainedSizes;
}

if (import.meta.main) {
  let json = JSON.parse(require("fs").readFileSync(process.argv[2], "utf-8"));
  if (json?.snapshot) {
    json = json.snapshot;
  }

  const snapshot = parseHeapSnapshot(json);

  const classNames = summarizeByType(snapshot);
  const numberFormatter = new Intl.NumberFormat();
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) {
      return `${bytes} bytes`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  let results = Array.from(classNames).sort((a, b) => b.retainedSize - a.retainedSize);
  for (const { name, size, count, retainedSize } of results) {
    console.log(
      `${name}: ${numberFormatter.format(count)} instances, ${formatBytes(
        size,
      )} size, ${formatBytes(retainedSize)} retained`,
    );
  }
}
