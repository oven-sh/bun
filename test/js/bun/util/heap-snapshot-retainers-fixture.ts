// Spawned by heap-snapshot.test.ts, one snapshot format per process.
// Prints, for each class below, whether the snapshot has a path from a root to an instance of it.
import * as jsc from "bun:jsc";

class ArrayElement {}
class MapKey {}
class MapValue {}
class SetMember {}
class BoundArgument {}
class TimerArgument {}
class ValueInReplacedTable {}
class ShadowedParameter {}
class DeletedValue {}
class ClearedMember {}

function createHolders() {
  // An iterator keeps the table it was created on until it is advanced. A Map that grew replaced
  // its table, and the replaced one still has the entries it had.
  const grown = new Map<unknown, unknown>([["key", new ValueInReplacedTable()]]);
  const iteratorOfReplacedTable = grown.values();
  for (let i = 0; i < 100; i++) grown.set(i, i);
  grown.delete("key");

  // A parameter that a function declaration of the same name shadows is in a slot of the scope
  // that has no name. The arguments object of a sloppy function reads it there.
  const shadowed = new Function(
    "a",
    "b",
    "function a() {} globalThis.closureOfShadowed = function () { return b; }; return arguments;",
  );

  // Entries that are gone, with no iterator: nothing holds them.
  const mapWithDeletedEntry = new Map<unknown, unknown>([["key", new DeletedValue()]]);
  mapWithDeletedEntry.delete("key");
  const clearedSet = new Set([new ClearedMember()]);
  clearedSet.clear();

  return {
    array: [new ArrayElement()],
    mapOfKeys: new Map([[new MapKey(), 1]]),
    mapOfValues: new Map([["key", new MapValue()]]),
    set: new Set([new SetMember()]),
    // A bound function has fields for three arguments, and a timer for one.
    bound: function () {}.bind(null, 1, 2, 3, new BoundArgument()),
    timer: setTimeout(() => {}, 2 ** 30, 1, new TimerArgument()),
    grown,
    iteratorOfReplacedTable,
    argumentsOfShadowed: shadowed(new ShadowedParameter(), 1),
    mapWithDeletedEntry,
    clearedSet,
  };
}

// "Inspector" and "GCDebugging": nodes are [id, size, classNameIndex, flags, ...], edges are
// [fromId, toId, typeIndex, data], and node 0 is the root.
function classNamesARootReachesInJSC(snapshot: any): Set<string> {
  const { nodes, edges, nodeClassNames, type } = snapshot;
  const nodeStride = type === "GCDebugging" ? 7 : 4;
  const outgoing = new Map<number, number[]>();
  for (let i = 0; i < edges.length; i += 4) {
    let list = outgoing.get(edges[i]);
    if (!list) outgoing.set(edges[i], (list = []));
    list.push(edges[i + 1]);
  }
  const reached = new Set([0]);
  for (const id of reached) for (const to of outgoing.get(id) ?? []) reached.add(to);
  const classNames = new Set<string>();
  for (let i = 0; i < nodes.length; i += nodeStride) {
    if (reached.has(nodes[i])) classNames.add(nodeClassNames[nodes[i + 2]]);
  }
  return classNames;
}

// "V8": a node's edges follow those of the node before it, `to_node` is an offset into `nodes`,
// and the node at offset 0 is the root.
function classNamesARootReachesInV8(snapshot: any): Set<string> {
  const { node_fields, node_types, edge_fields, edge_types } = snapshot.snapshot.meta;
  const { nodes, edges, strings } = snapshot;
  const nodeStride = node_fields.length;
  const edgeStride = edge_fields.length;
  const nodeTypeOffset = node_fields.indexOf("type");
  const object = node_types[nodeTypeOffset].indexOf("object");
  const nameOffset = node_fields.indexOf("name");
  const edgeCountOffset = node_fields.indexOf("edge_count");
  const edgeTypeOffset = edge_fields.indexOf("type");
  const toNodeOffset = edge_fields.indexOf("to_node");
  const weak = edge_types[edgeTypeOffset].indexOf("weak");

  const firstEdgeOf = new Map<number, number>();
  for (let node = 0, edge = 0; node < nodes.length; node += nodeStride) {
    firstEdgeOf.set(node, edge);
    edge += nodes[node + edgeCountOffset] * edgeStride;
  }
  const reached = new Set([0]);
  for (const node of reached) {
    const first = firstEdgeOf.get(node)!;
    for (let edge = first; edge < first + nodes[node + edgeCountOffset] * edgeStride; edge += edgeStride) {
      if (edges[edge + edgeTypeOffset] !== weak) reached.add(edges[edge + toNodeOffset]);
    }
  }
  // A class's constructor and structure have its name too: only nodes of type "object" are instances.
  const classNames = new Set<string>();
  for (const node of reached) {
    if (nodes[node + nodeTypeOffset] === object) classNames.add(strings[nodes[node + nameOffset]]);
  }
  return classNames;
}

// On the global object: a variable of this module that no closure captures is only in the frame
// of the code below, and a snapshot has no edge for what the stack holds.
(globalThis as any).holders = createHolders();

const [format] = process.argv.slice(2);
let reached: Set<string>;
switch (format) {
  case "Inspector":
    reached = classNamesARootReachesInJSC(Bun.generateHeapSnapshot());
    break;
  case "GCDebugging":
    // bun-types does not declare it.
    reached = classNamesARootReachesInJSC((jsc as any).generateHeapSnapshotForDebugging());
    break;
  case "V8":
    reached = classNamesARootReachesInV8(JSON.parse(Bun.generateHeapSnapshot("v8")));
    break;
  default:
    throw new Error(`Unknown format: ${format}`);
}

clearTimeout((globalThis as any).holders.timer);

const result: Record<string, boolean> = {};
for (const { name } of [
  ArrayElement,
  MapKey,
  MapValue,
  SetMember,
  BoundArgument,
  TimerArgument,
  ValueInReplacedTable,
  ShadowedParameter,
  DeletedValue,
  ClearedMember,
]) {
  result[name] = reached.has(name);
}
console.log(JSON.stringify(result));
