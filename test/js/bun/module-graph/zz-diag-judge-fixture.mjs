// Diagnostic only, not for merging: the new disposed-while-building-pages.mjs, but with the host's sockets closing
// over the server as they do on main, so that its judgement by roots runs where a socket is kept.
import { generateHeapSnapshotForDebugging, heapStats } from "bun:jsc";
const [fixtures] = process.argv.slice(2);
const until = async condition => {
  while (!condition()) await new Promise(resolve => setImmediate(resolve));
};
const servers = () => {
  Bun.gc(true);
  const counts = heapStats().objectTypeCounts;
  return (counts.HTTPServer ?? 0) + (counts.DebugHTTPServer ?? 0);
};
const use = async () => {
  const graph = new Bun.ModuleGraph();
  const app = await graph.import(fixtures + "/serves-html-routes.mjs");
  const server = graph.run(() => app.serve());
  const answered = new Set();
  for (const path of app.paths)
    Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        open: socket => void socket.write("GET " + path + " HTTP/1.1\r\nHost: x\r\n\r\n"),
        data() {
          answered.add(path);
        },
        close() {},
        error() {},
      },
    }).catch(() => {});
  await until(() => server.pendingRequests >= 1 || answered.size === app.paths.length);
  const building = server.pendingRequests >= 1;
  graph.dispose();
  if (!building) console.error("every build was done before a turn saw one");
  return building;
};
const none = (() => {
  const one = Bun.serve({ port: 0, hostname: "127.0.0.1", development: false, fetch: () => new Response() });
  const others = servers() - 1;
  one.stop(true);
  return others;
})();
for (let i = 0; i < 3; ) if (await use()) i++;
let kept = [],
  look = 500,
  turns = 0,
  looks = [];
const start = performance.now();
await until(() => {
  turns++;
  if (servers() <= none) return true;
  if (performance.now() - start < look) return false;
  const before = performance.now();
  const reached = serversARootReaches();
  looks.push([turns, Math.round(before - start), Math.round(performance.now() - before), reached.length]);
  if (reached.length > 0 && (look *= 2) <= 16_000) return false;
  kept = reached;
  return true;
});
console.error(
  `DIAG judge: floor ${none}, count ${servers()}, ${turns} turns in ${(performance.now() - start).toFixed(0)} ms; looks [turn, at ms, took ms, servers a root reaches] ${JSON.stringify(looks)}`,
);
console.log(kept.length === 0 ? "collected" : "kept " + kept.length + ": " + kept.join("; "));
process.exit(0);
function serversARootReaches() {
  const { nodes, nodeClassNames, edges, edgeTypes, edgeNames, roots, labels } = generateHeapSnapshotForDebugging();
  const classOf = new Map(),
    outgoing = new Map(),
    from = new Map(),
    queue = [],
    instances = [];
  for (let i = 0; i < nodes.length; i += 7) {
    const kind = nodeClassNames[nodes[i + 2]];
    classOf.set(nodes[i], kind);
    if ((kind === "HTTPServer" || kind === "DebugHTTPServer") && Number(nodes[i + 6]) !== 0) instances.push(nodes[i]);
  }
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
  for (let i = 0; i < roots.length; i += 3) {
    const why = String(labels[roots[i + 1]]);
    if (!from.has(roots[i]) && !why.includes("DOMGCOutput"))
      (from.set(roots[i], [null, "{root: " + why + "}"]), queue.push(roots[i]));
  }
  for (let at = 0; at < queue.length; at++)
    for (const [to, via] of outgoing.get(queue[at]) ?? [])
      if (!from.has(to)) (from.set(to, [queue[at], via]), queue.push(to));
  return instances
    .filter(id => from.has(id))
    .map(id => {
      const hops = [];
      for (let at = id; at !== null; at = from.get(at)[0]) hops.unshift(from.get(at)[1] + " " + classOf.get(at));
      return hops.slice(0, 16).join(" -> ");
    });
}
