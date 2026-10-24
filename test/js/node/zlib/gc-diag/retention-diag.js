"use strict";
// Diagnostic for "object survived gc()": prints who keeps `className` instances alive.
// Everything here runs only after the retention was observed, from the frame that observed it.

function analyzeSnapshot(snap, className) {
  const NODE = 7,
    EDGE = 4,
    ROOT = 3;
  const nodes = snap.nodes,
    edges = snap.edges,
    roots = snap.roots;
  const byId = new Map();
  for (let i = 0; i < nodes.length; i += NODE) {
    byId.set(nodes[i], {
      id: nodes[i],
      size: nodes[i + 1],
      cls: snap.nodeClassNames[nodes[i + 2]],
      label: snap.labels[nodes[i + 4]],
      addr: nodes[i + 5],
      incoming: [],
      roots: [],
    });
  }
  for (let i = 0; i < edges.length; i += EDGE) {
    const to = byId.get(edges[i + 1]);
    if (!to) continue;
    const type = snap.edgeTypes[edges[i + 2]];
    const data = edges[i + 3];
    const name =
      type === "Property" || type === "Variable" ? snap.edgeNames[data] : type === "Index" ? String(data) : "";
    to.incoming.push({ from: edges[i], type, name });
  }
  for (let i = 0; i < roots.length; i += ROOT) {
    const n = byId.get(roots[i]);
    if (n) n.roots.push(snap.labels[roots[i + 1]] + "/" + snap.labels[roots[i + 2]]);
  }
  const targets = [...byId.values()].filter(n => n.cls === className);
  // Everything that reaches a target. `via` remembers one path down to the target.
  const via = new Map();
  const queue = [];
  for (const target of targets) {
    via.set(target.id, null);
    queue.push(target);
  }
  const rooted = [];
  const ancestors = [];
  while (queue.length) {
    const n = queue.shift();
    ancestors.push(n);
    if (n.roots.length || n.incoming.some(e => e.from === 0)) rooted.push(n);
    for (const e of n.incoming) {
      if (e.from === 0 || via.has(e.from) || !byId.has(e.from)) continue;
      via.set(e.from, { child: n.id, type: e.type, name: e.name });
      queue.push(byId.get(e.from));
    }
  }
  const pathFrom = node => {
    const parts = [];
    let cur = node.id;
    for (let guard = 0; guard < 64; guard++) {
      const n = byId.get(cur);
      const step = via.get(cur);
      parts.push(`${n.cls}${n.label ? `<${n.label}>` : ""}@${n.addr}`);
      if (!step) break;
      parts.push(`--${step.type}${step.name ? `:${step.name}` : ""}-->`);
      cur = step.child;
    }
    return parts.join(" ");
  };
  return { targets, ancestors, rooted, pathFrom };
}

let compiled;
function native() {
  if (compiled) return compiled;
  const { cc, ptr } = require("bun:ffi");
  const source = `
typedef unsigned long long u64;
u64 frame_address(void) {
  return (u64)__builtin_frame_address(0);
}
int walk_frames(u64* out, int max, u64 limit) {
  u64* fp = (u64*)__builtin_frame_address(0);
  int n = 0;
  while (n < max) {
    u64 next = fp[0];
    out[2 * n] = (u64)fp;
    out[2 * n + 1] = fp[1];
    n++;
    if (next <= (u64)fp || (next & 7) || next - (u64)fp > (32ull << 20)) break;
    if (limit && next + 16 > limit) break;
    fp = (u64*)next;
  }
  return n;
}
void peek(u64 from, int words, u64* out) {
  u64* p = (u64*)from;
  for (int i = 0; i < words; i++) out[i] = p[i];
}
/* Zeroes the dead stack below the caller, 2 KB a frame. */
void scrub(int frames) {
  volatile u64 dead[256];
  for (int i = 0; i < 256; i++) dead[i] = 0;
  if (frames > 1) scrub(frames - 1);
}
`;
  const fs = require("fs"),
    os = require("os"),
    path = require("path");
  const file = path.join(os.tmpdir(), `retention-diag-${process.pid}.c`);
  fs.writeFileSync(file, source);
  const { symbols } = cc({
    source: file,
    symbols: {
      frame_address: { args: [], returns: "u64" },
      walk_frames: { args: ["ptr", "i32", "u64"], returns: "i32" },
      peek: { args: ["u64", "i32", "ptr"], returns: "void" },
      scrub: { args: ["i32"], returns: "void" },
    },
  });
  return (compiled = { symbols, ptr });
}

function stackScan(ancestors, pathFrom) {
  const { symbols, ptr } = native();
  const limit = stackEnd(BigInt(symbols.frame_address()));
  const frames = new BigUint64Array(2 * 512);
  const count = symbols.walk_frames(ptr(frames), 512, limit);
  const walked = [];
  for (let i = 0; i < count; i++) walked.push({ fp: frames[2 * i], ret: frames[2 * i + 1] });
  const lo = walked[0].fp;
  // The chain ends at the thread's first frame; everything the collector scans is below that.
  const hi = walked[walked.length - 1].fp + 16n;
  const words = Number((hi - lo) / 8n);
  const stack = new BigUint64Array(words);
  symbols.peek(lo, words, ptr(stack));

  const lines = [
    `frames walked: ${count}, stack 0x${lo.toString(16)}..0x${hi.toString(16)} (${words} words), stack end 0x${limit.toString(16)}`,
  ];
  for (let i = 0; i < walked.length; i++) {
    lines.push(`  #${i} fp=0x${walked[i].fp.toString(16)} ret=0x${walked[i].ret.toString(16)}`);
  }

  // A conservative root may point anywhere into a cell.
  const ranges = ancestors
    .map(n => ({ start: BigInt(n.addr), end: BigInt(n.addr) + BigInt(Math.max(n.size, 16)), node: n }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const find = value => {
    let a = 0,
      b = ranges.length - 1;
    while (a <= b) {
      const mid = (a + b) >> 1;
      if (value < ranges[mid].start) b = mid - 1;
      else if (value >= ranges[mid].end) a = mid + 1;
      else return ranges[mid];
    }
    return null;
  };
  let hits = 0;
  for (let w = 0; w < words; w++) {
    const range = find(stack[w]);
    if (!range) continue;
    hits++;
    if (hits > 48) continue;
    const slot = lo + BigInt(w * 8);
    // Frame k owns the words from above frame k-1's return address up to its own return address.
    const owner = walked.findIndex(f => slot < f.fp + 16n);
    const base = owner >= 0 ? walked[owner].fp : 0n;
    const code = owner >= 1 ? walked[owner - 1].ret : 0n;
    lines.push(
      `slot 0x${slot.toString(16)} = 0x${stack[w].toString(16)} -> ${range.node.cls}@${range.node.addr}` +
        `+${Number(stack[w] - range.start)} | frame #${owner} fp-0x${(base - slot).toString(16)} (code 0x${code.toString(16)})`,
    );
    lines.push(`    path: ${pathFrom(range.node)}`);
    const from = Math.max(0, w - 8),
      to = Math.min(words, w + 8);
    for (let k = from; k < to; k += 4) {
      lines.push(
        `    0x${(lo + BigInt(k * 8)).toString(16)}: ` +
          [0, 1, 2, 3].map(j => (k + j < words ? stack[k + j].toString(16).padStart(16, "0") : "")).join(" "),
      );
    }
  }
  lines.push(`stack words that point into a retaining cell: ${hits}`);
  return lines;
}

// The high end of the stack that holds `address`, or 0 when unknown. The frame walk must not read past it.
function stackEnd(address) {
  try {
    if (process.platform === "linux") {
      for (const line of require("fs").readFileSync("/proc/self/maps", "utf8").split("\n")) {
        const m = /^([0-9a-f]+)-([0-9a-f]+) /.exec(line);
        if (m && BigInt("0x" + m[1]) <= address && address < BigInt("0x" + m[2])) return BigInt("0x" + m[2]);
      }
    }
    if (process.platform === "win32") {
      const { dlopen, ptr } = require("bun:ffi");
      const k32 = dlopen("kernel32.dll", { VirtualQuery: { args: ["u64", "ptr", "u64"], returns: "u64" } });
      // MEMORY_BASIC_INFORMATION: BaseAddress at 0, RegionSize at 24.
      const info = new BigUint64Array(6);
      if (k32.symbols.VirtualQuery(address, ptr(info), 48n)) return info[0] + info[3];
    }
  } catch {}
  return 0n;
}

function modules() {
  // Load addresses, to turn return addresses into symbols offline.
  try {
    if (process.platform === "linux") {
      const maps = require("fs").readFileSync("/proc/self/maps", "utf8").split("\n");
      return maps.filter(l => / r-xp /.test(l) || /\[stack\]/.test(l)).slice(0, 12);
    }
    if (process.platform === "win32") {
      const { dlopen } = require("bun:ffi");
      const k32 = dlopen("kernel32.dll", { GetModuleHandleW: { args: ["ptr"], returns: "u64" } });
      return [`image base 0x${BigInt(k32.symbols.GetModuleHandleW(null)).toString(16)} ${process.execPath}`];
    }
  } catch (e) {
    return [`modules: ${e}`];
  }
  return [];
}

function report(className, print = console.log) {
  const jsc = require("bun:jsc");
  const lines = [`RETENTION-DIAG ${process.platform}-${process.arch} ${Bun.version} ${Bun.revision}`];
  // The collections so far left the addresses of what they marked in the dead stack below this
  // frame. Zero it, so that the snapshot's collection can only find words of the live frames.
  try {
    native().symbols.scrub(16);
  } catch (e) {
    lines.push(`no native helpers: ${e && e.stack}`);
  }
  let result;
  try {
    // A WeakRef that was read in this turn holds its target until the turn ends.
    jsc.releaseWeakRefs();
    result = analyzeSnapshot(jsc.generateHeapSnapshotForDebugging(), className);
  } catch (e) {
    print(lines.concat(`snapshot failed: ${e && e.stack}`).join("\n"));
    return;
  }
  lines.push(
    `${className} alive in the snapshot: ${result.targets.length}; cells that reach it: ${result.ancestors.length}; ` +
      `of those with a root entry: ${result.rooted.length}`,
  );
  for (const n of result.rooted.slice(0, 6)) lines.push(`root [${n.roots.join(", ")}]: ${result.pathFrom(n)}`);
  const noIncoming = result.ancestors.filter(n => !n.incoming.some(e => e.from !== 0));
  for (const n of noIncoming.slice(0, 6)) lines.push(`no incoming edge: ${result.pathFrom(n)}`);
  // Printed before the stack is read, in case that goes wrong.
  print(lines.join("\n"));
  lines.length = 0;
  if (result.ancestors.length) {
    lines.push(...modules());
    try {
      lines.push(...stackScan(result.ancestors, result.pathFrom));
    } catch (e) {
      lines.push(`stack scan failed: ${e && e.stack}`);
    }
  }
  lines.push("RETENTION-DIAG-END");
  print(lines.join("\n"));
}

module.exports = { report };
