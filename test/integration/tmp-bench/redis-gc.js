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
if (process.argv[3] && clients.length) {
  const { dlopen, ptr, toArrayBuffer } = require("bun:ffi");
  const k = dlopen("kernel32.dll", { GetCurrentThreadStackLimits: { args: ["ptr", "ptr"], returns: "void" }, RtlCaptureContext: { args: ["ptr"], returns: "void" } }).symbols;
  const limits = new BigUint64Array(2), raw = new Uint8Array(2048), shift = (16 - (ptr(raw) % 16)) % 16;
  k.GetCurrentThreadStackLimits(ptr(limits), ptr(limits, 8));
  k.RtlCaptureContext(ptr(raw, shift));
  const top = Number(limits[1]), sp = Number(new DataView(raw.buffer).getBigUint64(shift + 0x98, true));
  const words = new BigUint64Array(toArrayBuffer(sp, 0, top - sp).slice(0));
  // Everything that leads to the clients, none of which has a root.
  const sources = new Map(), cells = new Map(), closure = new Set(clients);
  for (let at = 0; at < edges.length; at += 4) sources.getOrInsert(edges[at + 1], []).push(edges[at]);
  for (const id of closure) for (const source of sources.get(id) ?? []) closure.add(source);
  for (let at = 0; at < nodes.length; at += 7) if (closure.has(nodes[at])) cells.set(BigInt(nodes[at + 5]), names.get(nodes[at]));
  console.log("closure", [...cells].map(([a, n]) => n + "@" + a.toString(16)).join(" "), "rooted in it:", [...closure].filter(id => from.has(id)).length, "depth", top - sp);
  const d = dlopen("dbghelp.dll", { SymSetOptions: { args: ["u32"], returns: "u32" }, SymInitializeW: { args: ["i64", "ptr", "i32"], returns: "i32" }, SymFromAddrW: { args: ["i64", "u64", "ptr", "ptr"], returns: "i32" } }).symbols;
  d.SymSetOptions(0x6);
  console.log("symbols", d.SymInitializeW(-1n, Buffer.from(require("path").dirname(process.execPath) + "\0", "utf16le"), 1));
  const info = Buffer.alloc(88 + 1024), displacement = new BigUint64Array(1), lines = [];
  words.forEach((word, i) => {
    const depth = top - sp - i * 8, cell = [...cells].find(([a]) => word >= a - 8n && word < a + 64n);
    if (cell) return lines.push(`${depth} HIT ${cell[1]} ${word.toString(16)}`);
    if (word < 0x7ff000000000n || word > 0x7fffffffffffn) return;
    info.fill(0), info.writeUInt32LE(88, 0), info.writeUInt32LE(500, 80);
    if (d.SymFromAddrW(-1n, word, displacement, info) && info.readUInt32LE(72) === 5 && displacement[0])
      lines.push(`${depth} ${info.toString("utf16le", 84, 84 + 2 * info.readUInt32LE(76)).slice(0, 110)}+0x${displacement[0].toString(16)}`);
  });
  console.log(lines.join("\n"));
}
server.stop(true);
