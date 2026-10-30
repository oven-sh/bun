// realmsARootReaches() lists every GlobalObject but the one running now that a root reaches, each with the shortest path from that
// root. The snapshot does not list what the scan of the machine stack found: a realm that only the stack keeps is not in the list.
// A root that an output constraint adds (the listeners of an emitter that is already marked) follows from whatever marked the
// emitter, so it is not one.
const { generateHeapSnapshotForDebugging } = require("bun:jsc");

function realmsARootReaches() {
  const { nodes, nodeClassNames, edges, edgeTypes, edgeNames, roots, labels } = generateHeapSnapshotForDebugging();
  const classOf = new Map(),
    labelOf = new Map(),
    outgoing = new Map(),
    rootsOf = new Map();
  for (let i = 0; i < nodes.length; i += 7)
    (classOf.set(nodes[i], nodeClassNames[nodes[i + 2]]), labelOf.set(nodes[i], labels?.[nodes[i + 4]] ?? ""));
  for (let i = 0; i < (roots?.length ?? 0); i += 3)
    rootsOf.set(roots[i], [labels?.[roots[i + 1]], labels?.[roots[i + 2]]].filter(Boolean).join("/") || "root");
  for (let e = 0; e < edges.length; e += 4) {
    const type = edgeTypes[edges[e + 2]];
    const via =
      type === "Property" || type === "Variable"
        ? "." + edgeNames[edges[e + 3]]
        : type === "Index"
          ? "[" + edges[e + 3] + "]"
          : "";
    (outgoing.get(edges[e]) ?? outgoing.set(edges[e], []).get(edges[e])).push([edges[e + 1], via]);
  }
  const name = id =>
    classOf.get(id) +
    (labelOf.get(id) ? ' "' + String(labelOf.get(id)).slice(0, 30) + '"' : "") +
    (rootsOf.has(id) ? " {root: " + rootsOf.get(id) + "}" : "");
  const globals = [...classOf].filter(([, kind]) => kind === "GlobalObject").map(([id]) => id);
  const current = globals.find(id => rootsOf.has(id));
  // One search from every root at once, never through the realm running now.
  const from = new Map(),
    queue = [];
  for (const [id, why] of rootsOf)
    if (id !== current && !why.includes("DOMGCOutput")) (from.set(id, null), queue.push(id));
  for (let at = 0; at < queue.length; at++)
    for (const [to, via] of outgoing.get(queue[at]) ?? [])
      if (!from.has(to) && to !== current) (from.set(to, [queue[at], via]), queue.push(to));
  return globals
    .filter(id => id !== current && from.has(id))
    .map(id => {
      const hops = [];
      for (let at = id; at !== null; at = from.get(at)?.[0] ?? null)
        hops.unshift((from.get(at)?.[1] ?? "") + " " + name(at));
      return hops.slice(0, 16).join(" ->").trim();
    });
}

module.exports = { realmsARootReaches };
