import { dlopen, ptr } from "bun:ffi";
import { describe, generateHeapSnapshotForDebugging } from "bun:jsc";
import { readFileSync } from "node:fs";

const windows = process.platform === "win32";
const context = new BigUint64Array(256);
let low, high, base, copy, getContext, move;
if (windows) {
  const { symbols: k } = dlopen("kernel32.dll", {
    GetCurrentThreadStackLimits: { args: ["ptr", "ptr"], returns: "void" },
    VirtualQuery: { args: ["ptr", "ptr", "u64"], returns: "u64" },
    GetModuleHandleW: { args: ["ptr"], returns: "ptr" },
  });
  const { symbols: n } = dlopen("ntdll.dll", {
    RtlCaptureContext: { args: ["ptr"], returns: "void" },
    memmove: { args: ["ptr", "ptr", "u64"], returns: "ptr" },
  });
  const limits = new BigUint64Array(2);
  k.GetCurrentThreadStackLimits(ptr(limits), ptr(limits, 8));
  high = Number(limits[1]);
  low = high;
  const info = new Uint32Array(12);
  while (high - low < 1024 * 1024) {
    k.VirtualQuery(low - 4096, ptr(info), 48);
    if (info[8] !== 0x1000 || info[9] & 0x101) break;
    low -= 4096;
  }
  base = Number(k.GetModuleHandleW(null));
  getContext = n.RtlCaptureContext;
  move = n.memmove;
} else {
  const { symbols: c } = dlopen("libc.so.6", {
    getcontext: { args: ["ptr"], returns: "int" },
    memmove: { args: ["ptr", "ptr", "u64"], returns: "ptr" },
  });
  const [from, to] = /^(\w+)-(\w+) .*\[stack\]/m.exec(readFileSync("/proc/self/maps", "utf8")).slice(1);
  high = parseInt(to, 16);
  low = Math.max(parseInt(from, 16), high - 1024 * 1024);
  base = 0;
  getContext = c.getcontext;
  move = c.memmove;
}
copy = new BigUint64Array((high - low) / 8);
const contextAt = (ptr(context) + 15) & ~15 ? ptr(context) + ((16 - (ptr(context) % 16)) % 16) : ptr(context);
const shift = (contextAt - ptr(context)) / 8;
const copyAt = ptr(copy);
const size = high - low;

export function capture() {
  move(copyAt, low, size);
  getContext(contextAt);
}
capture();

let snapshot;
export function takeSnapshot() {
  snapshot = generateHeapSnapshotForDebugging();
}

export function report(watched) {
  const held = watched.map(weak => weak.deref()).filter(Boolean);
  if (!held.length) return;
  const wasTakenBefore = snapshot !== undefined;
  snapshot ??= generateHeapSnapshotForDebugging();
  const hex = value => "0x" + value.toString(16);
  const register = index => context[shift + index];
  const [fp, sp] = (windows ? [register(30), register(32)] : [register(15), register(20)]).map(Number);
  const word = address => copy[(address - low) / 8];
  let frames = [];
  for (let start = Math.max(low, sp - 0x100); start < sp + 0x800; start += 8) {
    const chain = [];
    for (let at = start; at >= low && at < high - 8 && at % 8 === 0 && chain.length < 200;) {
      chain.push({ fp: at, lr: Number(word(at + 8)) });
      const next = Number(word(at));
      if (next <= at) break;
      at = next;
    }
    if (chain.length > frames.length) frames = chain;
  }
  const nodes = new Map();
  const byAddress = new Map();
  for (let i = 0; i < snapshot.nodes.length; i += 7) {
    const [id, bytes, name, , label, address] = snapshot.nodes.slice(i, i + 7);
    const node = {
      id,
      bytes,
      name: snapshot.nodeClassNames[name],
      label: snapshot.labels[label],
      address: parseInt(address, 16),
      from: [],
      roots: [],
    };
    nodes.set(id, node);
    byAddress.set(node.address, node);
  }
  for (let i = 0; i < snapshot.edges.length; i += 4) {
    const type = snapshot.edgeTypes[snapshot.edges[i + 2]];
    const data = snapshot.edges[i + 3];
    nodes
      .get(snapshot.edges[i + 1])
      ?.from.push([
        snapshot.edges[i],
        type,
        type === "Property" || type === "Variable" ? snapshot.edgeNames[data] : data,
      ]);
  }
  for (let i = 0; i < snapshot.roots.length; i += 3)
    nodes
      .get(snapshot.roots[i])
      ?.roots.push(snapshot.labels[snapshot.roots[i + 1]] + "/" + snapshot.labels[snapshot.roots[i + 2]]);
  const found = [];
  for (const object of held) {
    const address = parseInt(/Object: (\w+)/.exec(describe(object))[1], 16);
    const cells = [];
    const seen = new Set();
    const walk = (node, depth) => {
      if (!node || seen.has(node) || depth > 3 || cells.length > 24) return;
      seen.add(node);
      cells.push(node);
      if (!node.roots.length) for (const [id] of node.from) walk(nodes.get(id), depth + 1);
    };
    walk(byAddress.get(address) ?? { id: -1, bytes: 48, name: "not in the snapshot", address, from: [], roots: [] }, 0);
    found.push({
      name: object.name,
      cells: cells.map(cell => {
        const [first, last] = [BigInt(cell.address), BigInt(cell.address + Math.min(cell.bytes, 256))];
        const words = [];
        for (let i = 0; i < copy.length; i++)
          if (copy[i] >= first && copy[i] <= last + 8n) words.push({ at: low + i * 8, into: Number(copy[i] - first) });
        const registers = [];
        for (let i = 0; i < 100; i++) if (register(i) >= first && register(i) <= last + 8n) registers.push(i);
        return {
          ...cell,
          address: hex(cell.address),
          from: cell.from
            .slice(0, 8)
            .map(([id, ...rest]) => [nodes.get(id)?.name, nodes.get(id)?.label, id, ...rest].join(" ")),
          words,
          registers,
        };
      }),
    });
  }
  const around = {};
  for (const { words } of found.map(({ cells }) => cells[0]))
    for (const { at } of words.slice(0, 8))
      around[at] = Array.from({ length: 49 }, (_, i) => at + (i - 24) * 8)
        .filter(a => a >= low && a < high)
        .map(a => [a, word(a).toString(16)]);
  console.error("DIAG " + JSON.stringify({ wasTakenBefore, base, low, high, sp, fp, frames, found, around }));
}
