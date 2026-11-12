// For three RegExps: how a V8 heap snapshot names them, and how large it says the engine's RegExp
// cell is. Once before anything read `source`, and once after two of the three were read.
const clean = new RegExp("heap-snapshot-clean-name");
const escaped = new RegExp("heap/snapshot-escaped-nam");
const unread = new RegExp("heap/snapshot-unread-name");
const names = ["/heap-snapshot-clean-name/", "/heap\\/snapshot-escaped-nam/", "/heap\\/snapshot-unread-name/"];

// For each name: how many `regexp` nodes have it, and the self size of the RegExp cell that such a node points to.
function look(): { count: number; size: number }[] {
  const snapshot = JSON.parse(Bun.generateHeapSnapshot("v8"));
  const { node_fields, edge_fields, node_types } = snapshot.snapshot.meta;
  const [type, name, selfSize, edgeCount] = ["type", "name", "self_size", "edge_count"].map(field =>
    node_fields.indexOf(field),
  );
  const toNode = edge_fields.indexOf("to_node");
  const { nodes, edges, strings } = snapshot;
  const found = names.map(() => ({ count: 0, size: -1 }));
  let edge = 0;
  for (let node = 0; node < nodes.length; node += node_fields.length) {
    const at = node_types[0][nodes[node + type]] === "regexp" ? names.indexOf(strings[nodes[node + name]]) : -1;
    if (at >= 0) found[at].count++;
    for (let i = 0; i < nodes[node + edgeCount]; i++, edge += edge_fields.length) {
      if (at < 0) continue;
      const to = edges[edge + toNode];
      if (strings[nodes[to + name]] === "RegExp") found[at].size = nodes[to + selfSize];
    }
  }
  return found;
}

const before = look();
const sources = [clean.source, escaped.source];
const after = look();
console.log(JSON.stringify({ before, sources, after, lastIndex: unread.lastIndex }));
