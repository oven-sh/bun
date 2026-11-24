// Lets streams fail, and prints what the heap has of them in the next turn of the event loop.
const { generateHeapSnapshotForDebugging } = require("bun:jsc");
const zlib = require("zlib");

const [count, holder] = [Number(process.argv[2]), process.argv[3]];
const kept = (globalThis.kept = { set: new Set() });
const keep = {
  nothing() {},
  property: stream => (kept.stream = stream),
  set: stream => kept.set.add(stream),
  stack: stream => (kept.forStack = stream._handle),
}[holder];

/** How many streams there are, and the way from a root to each that has one. */
function look() {
  const { nodes, nodeClassNames, edges, roots, labels } = generateHeapSnapshotForDebugging();
  const targets = new Map();
  for (let at = 0; at < edges.length; at += 4) targets.getOrInsert(edges[at], []).push(edges[at + 1]);
  const reachedFrom = new Map();
  for (let at = 0; at < roots.length; at += 3) reachedFrom.set(roots[at], labels[roots[at + 1]]);
  for (const from of reachedFrom.keys()) for (const to of targets.get(from) ?? []) reachedFrom.getOrInsert(to, from);

  const names = new Map();
  for (let at = 0; at < nodes.length; at += 7) names.set(nodes[at], nodeClassNames[nodes[at + 2]]);
  const wayTo = id => (names.has(id) ? `${wayTo(reachedFrom.get(id))} > ${names.get(id)}` : id);
  const streams = [...names.keys()].filter(id => names.get(id) === "Inflate");
  return { left: streams.length, rooted: streams.filter(id => reachedFrom.has(id)).map(wayTo) };
}

const errors = [];
function report() {
  const onStack = kept.forStack;
  kept.forStack = undefined;
  console.log(JSON.stringify({ ...look(), errors, onStack: typeof onStack }));
}

let open = count;
for (let i = 0; i < count; i++) {
  keep(
    zlib
      .createInflate()
      .on("error", error => errors.push(error.code))
      .on("close", () => --open || setImmediate(report))
      .end(Buffer.from("foobar")),
  );
}
