// Temporary: finds what keeps the last RedisClient alive.
const fs = require("fs");
const { releaseWeakRefs, generateHeapSnapshotForDebugging } = require("bun:jsc");
const { dlopen, ptr } = require("bun:ffi");
const out = (...a) => fs.writeSync(1, a.join(" ") + "\n");
const hex = n => "0x" + n.toString(16);
const c = dlopen("libc.so.6", {
  memcpy: { args: ["u64", "u64", "u64"], returns: "void" },
  getcontext: { args: ["u64"], returns: "i32" },
}).symbols;
const buf = size => {
  const bytes = new ArrayBuffer(size + 16);
  const start = BigInt(ptr(bytes));
  const pad = (16n - (start % 16n)) % 16n;
  return { at: start + pad, view: new DataView(bytes, Number(pad), size), bytes, pad: Number(pad) };
};
const ctx = buf(8192), copy = buf(1 << 20), zero = buf(8);
const maps = fs.readFileSync("/proc/self/maps", "utf8").split("\n");
let [low, high] = maps.find(l => l.endsWith("[stack]")).split(" ")[0].split("-").map(x => BigInt("0x" + x));
if (high - low > 1n << 19n) low = high - (1n << 19n);
const exe = fs.realpathSync("/proc/self/exe");
const mine = maps.filter(l => l.endsWith(exe)).map(l => l.split(" ")[0].split("-").map(x => BigInt("0x" + x)));
const header = Buffer.alloc(18);
fs.readSync(fs.openSync(exe, "r"), header, 0, 18, 0);
const bias = header.readUInt16LE(16) === 3 ? mine[0][0] : 0n;
c.memcpy(copy.at, low, high - low);
c.getcontext(ctx.at);

function snapshot() {
  releaseWeakRefs();
  const s = generateHeapSnapshotForDebugging();
  const nodes = new Map();
  for (let i = 0; i < s.nodes.length; i += 7) {
    const [id, size, cls, , , cell] = s.nodes.slice(i, i + 7);
    nodes.set(id, { id, size, cls: s.nodeClassNames[cls], cell, from: [], to: [] });
  }
  for (let i = 0; i < s.edges.length; i += 4) {
    const [a, b, type, extra] = s.edges.slice(i, i + 4);
    const name = s.edgeTypes[type] === "Property" || s.edgeTypes[type] === "Variable" ? s.edgeNames[extra] : "";
    nodes.get(a)?.to.push([b, name]);
    nodes.get(b)?.from.push([a, name]);
  }
  for (let i = 0; i < s.roots.length; i += 3) if (nodes.has(s.roots[i])) nodes.get(s.roots[i]).root = s.labels[s.roots[i + 1]];
  return [...nodes.values()].filter(n => n.cls === "RedisClient" && !n.to.some(e => e[1] === "constructor"));
}

globalThis.diagnoseNow = () => {
  c.memcpy(copy.at, low, high - low);
  c.getcontext(ctx.at);
  const arm = process.arch === "arm64";
  const sp = ctx.view.getBigUint64(arm ? 432 : 160, true);
  const left = snapshot();
  for (const n of left) out("left", n.cls, n.cell, "incoming edges", n.from.length, "root", n.root ?? "none");
  const words = new BigUint64Array(copy.bytes, copy.pad, Number((high - low) / 8n));
  const word = at => words[Number((at - low) / 8n)];
  const hits = [];
  for (let at = sp; at < high; at += 8n)
    for (const n of left) if (word(at) >= BigInt(n.cell) && word(at) < BigInt(n.cell) + 80n) hits.push(at);
  const inExe = w => mine.some(([a, b]) => w >= a && w < b);
  let frames = [], best = 0;
  for (let start = sp; start < sp + 0x1000n; start += 8n) {
    const chain = [];
    for (let at = start; chain.length < 80 && at % 8n === 0n && at < high - 16n; at = word(at)) {
      chain.push([at, word(at + 8n) & 0xffffffffffffn]);
      if (word(at) <= at) break;
    }
    const score = chain.every(f => inExe(f[1]) || f === chain.at(-1) || f === chain.at(-2) || f === chain.at(-3)) ? chain.length : 0;
    if (score > best) (best = score), (frames = chain);
  }
  const tool = ["llvm-symbolizer", "addr2line"].map(x => Bun.which(x)).find(Boolean);
  const names = !tool ? [] : Bun.spawnSync(tool.includes("llvm") ? [tool, "--obj=" + exe, "--no-inlines", "--output-style=GNU", "-f", "-C", ...frames.map(f => hex(f[1] - bias - 1n))] : [tool, "-f", "-C", "-e", exe, ...frames.map(f => hex(f[1] - bias - 1n))]).stdout.toString().split("\n");
  out("sp high-" + hex(high - sp), "hits above sp:", hits.map(at => "high-" + hex(high - at)).join(" "), "tool", tool);
  frames.forEach(([at, ret], i) => {
    out("  record high-" + hex(high - at), "returns into", hex(ret - bias), (names[2 * i] ?? "").slice(0, 110), (names[2 * i + 1] ?? "").split("/").slice(-1)[0]);
    const next = frames[i + 1]?.[0] ?? high;
    for (const hit of hits) if (hit >= at && hit < next) out("      HOLDS record+" + hex(hit - at), "next record-" + hex(next - hit));
  });
  if (process.env.DIAG_MODE === "zero") {
    for (const at of hits) c.memcpy(at, zero.at, 8n);
    const count = hits.length;
    left.length = hits.length = 0;
    out("zeroed", count, "words, left now:", snapshot().length);
  }
  process.reallyExit(0);
};
