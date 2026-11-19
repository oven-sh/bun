const peer = process.argv[2], jsc = require("bun:jsc");
const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open: socket => peer === "drops" && socket.end(), data() {}, error() {} } });
let closed = 0;
(() => {
  for (let i = 0; i < 20; i++) {
    const client = new Bun.RedisClient("redis://127.0.0.1:" + server.port, peer === "drops" ? { maxRetries: 2 } : { connectionTimeout: 100 });
    client.onclose = () => closed++;
    client.get("k").catch(() => {});
  }
})();
while (closed < 20) Bun.gc(true), await new Promise(setImmediate);
Bun.gc(true);
const left = jsc.heapStats().objectTypeCounts.RedisClient ?? 0;
const { nodes, nodeClassNames, edges, roots, labels } = jsc.generateHeapSnapshotForDebugging();
const targets = new Map(), from = new Map(), names = new Map();
for (let at = 0; at < edges.length; at += 4) targets.getOrInsert(edges[at], []).push(edges[at + 1]);
for (let at = 0; at < roots.length; at += 3) from.set(roots[at], labels[roots[at + 1]]);
for (const id of from.keys()) for (const to of targets.get(id) ?? []) from.getOrInsert(to, id);
for (let at = 0; at < nodes.length; at += 7) names.set(nodes[at], nodeClassNames[nodes[at + 2]]);
const way = id => (names.has(id) ? `${way(from.get(id))} > ${names.get(id)}` : id);
const clients = [...names.keys()].filter(id => names.get(id) === "RedisClient");
console.log(left, "left,", clients.length, "in snapshot, rooted:", clients.filter(id => from.has(id)).map(way).join(";"));
server.stop(true);
