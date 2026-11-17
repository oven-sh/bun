// Temporary: finds what keeps the request of test-http-client-leaky-with-double-response.js alive.
const fs = require("fs");
const path = require("path");
const { onGCSweepSync } = require("../test/common/gc");
const { releaseWeakRefs, generateHeapSnapshotForDebugging } = require("bun:jsc");
const mode = process.env.DIAG_MODE;
const out = (...a) => fs.writeSync(1, a.join(" ") + "\n");
const hex = n => "0x" + n.toString(16);
const win = process.platform === "win32" && process.arch === "x64";

let k, d, buf, ctx, copy, scratch, zero, high, low, rsp;
if (win) {
  const { dlopen, ptr } = require("bun:ffi");
  const u = n => Array(n).fill("u64");
  k = dlopen("kernel32.dll", {
    RtlCaptureContext: { args: u(1), returns: "void" },
    RtlMoveMemory: { args: u(3), returns: "void" },
    ReadProcessMemory: { args: u(5), returns: "i32" },
    GetCurrentThreadStackLimits: { args: u(2), returns: "void" },
    VirtualQuery: { args: u(3), returns: "u64" },
    GetModuleHandleW: { args: u(1), returns: "u64" },
    RtlLookupFunctionEntry: { args: u(3), returns: "u64" },
    RtlVirtualUnwind: { args: u(8), returns: "u64" },
  }).symbols;
  d = dlopen("dbghelp.dll", {
    SymSetOptions: { args: ["u32"], returns: "u32" },
    SymInitialize: { args: ["u64", "u64", "i32"], returns: "i32" },
    SymFromAddr: { args: u(4), returns: "i32" },
    SymGetLineFromAddr64: { args: u(4), returns: "i32" },
  }).symbols;
  buf = size => {
    const bytes = new ArrayBuffer(size + 16);
    const start = BigInt(ptr(bytes));
    const pad = (16n - (start % 16n)) % 16n;
    return { at: start + pad, view: new DataView(bytes, Number(pad), size), bytes, pad: Number(pad) };
  };
  ctx = buf(1232);
  copy = buf(1 << 20);
  scratch = buf(4096);
  zero = buf(8);
  k.GetCurrentThreadStackLimits(scratch.at, scratch.at + 8n);
  high = scratch.view.getBigUint64(8, true);
  let at = scratch.view.getBigUint64(0, true);
  low = high;
  while (at < high) {
    k.VirtualQuery(at, scratch.at, 48n);
    const size = scratch.view.getBigUint64(24, true);
    if (scratch.view.getUint32(32, true) === 0x1000 && !(scratch.view.getUint32(36, true) & 0x100)) {
      low = at;
      break;
    }
    at += size;
  }
  if (high - low > 1n << 19n) low = high - (1n << 19n);
  k.RtlMoveMemory(copy.at, low, high - low);
  k.RtlCaptureContext(ctx.at);
}

let round = 0;
globalThis.gc = () => {
  if (++round === 6) {
    releaseWeakRefs();
    Bun.gc(true);
    if (win) {
      k.RtlMoveMemory(copy.at, low, high - low);
      k.RtlCaptureContext(ctx.at);
    }
    try {
      diagnose();
    } catch (e) {
      out("diagnose threw", e?.stack ?? e);
    }
    process.reallyExit(0);
  }
  if (mode === "log") out("round", round);
  Bun.gc(true);
  onGCSweepSync(releaseWeakRefs, Bun.gc);
};
process.on("exit", code => out("exit", code, "after round", round));

function snapshot() {
  releaseWeakRefs();
  const s = generateHeapSnapshotForDebugging();
  const nodes = new Map();
  for (let i = 0; i < s.nodes.length; i += 7) {
    const [id, size, cls, , label, cell] = s.nodes.slice(i, i + 7);
    nodes.set(id, { id, size, cls: s.nodeClassNames[cls], label: s.labels[label], cell, from: [], to: [] });
  }
  for (let i = 0; i < s.edges.length; i += 4) {
    const [a, b, type, extra] = s.edges.slice(i, i + 4);
    const kind = s.edgeTypes[type];
    const name = kind === "Internal" ? "" : kind === "Index" ? `[${extra}]` : s.edgeNames[extra];
    nodes.get(a)?.to.push([b, name]);
    nodes.get(b)?.from.push([a, name]);
  }
  for (let i = 0; i < s.roots.length; i += 3) {
    const node = nodes.get(s.roots[i]);
    if (node) node.root = `${s.labels[s.roots[i + 1]]}|${s.labels[s.roots[i + 2]]}`;
  }
  return nodes;
}
const show = n => `${n.cls}${n.label ? `(${n.label.slice(0, 50)})` : ""}#${n.id}@${n.cell}/${n.size}${n.root ? ` ROOT ${n.root}` : ""}`;

function scanProcess(candidates) {
  const wanted = new Map();
  for (const n of candidates) {
    const digits = n.cell.slice(2).padStart(16, "0");
    wanted.set(parseInt(digits.slice(8), 16), [parseInt(digits.slice(0, 8), 16), n]);
  }
  const chunk = buf(1 << 20);
  const halves = new Uint32Array(chunk.bytes, chunk.pad, 1 << 18);
  const found = [];
  let scanned = 0;
  for (let at = 0x10000n; at < 0x7ffffffe0000n; ) {
    if (!k.VirtualQuery(at, scratch.at, 48n)) break;
    const v = scratch.view;
    const allocation = v.getBigUint64(8, true), size = v.getBigUint64(24, true);
    const state = v.getUint32(32, true), protect = v.getUint32(36, true), type = v.getUint32(40, true);
    if (state === 0x1000 && !(protect & 0x100) && protect & 0xcc) {
      for (let o = 0n; o < size; o += 1n << 20n) {
        const from = at + o, length = size - o < 1n << 20n ? size - o : 1n << 20n;
        if (from < chunk.at + (1n << 20n) && chunk.at < from + length) continue;
        k.ReadProcessMemory(0xffffffffffffffffn, from, chunk.at, length, scratch.at + 64n);
        const count = Number(scratch.view.getBigUint64(64, true)) / 4;
        scanned += count * 4;
        for (let i = 0; i < count; i += 2) {
          const entry = wanted.get(halves[i]);
          if (entry !== undefined && entry[0] === halves[i + 1]) found.push([from + BigInt(i * 4), entry[1], allocation, size, type]);
        }
      }
    }
    at += size;
  }
  out("scanned", scanned, "bytes, found", found.length);
  return found;
}

function diagnose() {
  out("round 6 reached: not collected");
  const nodes = snapshot();
  const targets = [...nodes.values()].filter(n => n.cls === "ClientRequest" && !n.to.some(e => e[1] === "constructor"));
  out("nodes", nodes.size, "requests", targets.map(show).join(", "));
  const parent = new Map([[0, null]]);
  const queue = [0];
  for (const n of nodes.values()) if (n.root && !parent.has(n.id)) parent.set(n.id, [0, "root"]), queue.push(n.id);
  for (let i = 0; i < queue.length; i++)
    for (const [b, name] of nodes.get(queue[i]).to) if (!parent.has(b)) parent.set(b, [queue[i], name]), queue.push(b);
  for (const t of targets) {
    out("reachable from a reported root:", parent.has(t.id));
    for (let id = t.id; parent.get(id); id = parent.get(id)[0]) out("   ", show(nodes.get(id)), "<-", parent.get(id)[1]);
  }
  const reach = new Map(targets.map(t => [t.id, null]));
  const back = targets.map(t => t.id);
  for (let i = 0; i < back.length; i++)
    for (const [a, name] of nodes.get(back[i]).from)
      if (a && !parent.has(a) && !reach.has(a)) reach.set(a, [back[i], name]), back.push(a);
  const candidates = back.map(id => nodes.get(id)).filter(n => !parent.has(n.id));
  out("unrooted cells that reach the request:", candidates.length);
  for (const n of candidates) if (!n.from.length) out("    no incoming edge:", show(n));
  for (const n of candidates.slice(0, 60)) out("    ", show(n), "in:", n.from.length);
  if (!win) return;

  const found = scanProcess(candidates);
  rsp = ctx.view.getBigUint64(0x98, true);
  out("stack", hex(low), hex(high), "rsp", hex(rsp), "depth", hex(high - rsp));
  const words = new BigUint64Array(copy.bytes, copy.pad, Number((high - low) / 8n));
  const cells = candidates.map(n => [BigInt(n.cell), BigInt(Math.min(n.size, 512)), n]);
  const hits = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w < 0x10000n || w > 0x7fffffffffffn) continue;
    for (const [at, size, n] of cells) if (w >= at && w < at + (n.cls === "Timeout" ? 80n : size)) hits.push([low + BigInt(i) * 8n, w - at, n]);
  }
  const chain = n => {
    let s = "";
    for (let id = n.id; reach.get(id); id = reach.get(id)[0]) s += ` .${reach.get(id)[1] || "(internal)"}>${nodes.get(reach.get(id)[0]).cls}`;
    return s;
  };
  for (const [at, off, n] of hits)
    out("HIT", hex(at), "high-" + hex(high - at), at >= rsp ? "ABOVE rsp" : "below rsp-" + hex(rsp - at), "+" + off, show(n), chain(n));

  out("beside the exe:", fs.readdirSync(path.dirname(process.execPath)).join(" "));
  const search = buf(1024);
  Buffer.from(search.bytes, search.pad, 1024).write(path.dirname(fs.realpathSync(process.execPath)) + "\0");
  d.SymSetOptions(0x2 | 0x4 | 0x10);
  const me = 0xffffffffffffffffn;
  out("SymInitialize", d.SymInitialize(me, search.at, 1));
  const base = k.GetModuleHandleW(0n);
  const peek = (at, size) => (k.RtlMoveMemory(scratch.at, at, BigInt(size)), scratch.view);
  const imageSize = BigInt(peek(base + BigInt(peek(base + 0x3cn, 4).getUint32(0, true)) + 80n, 4).getUint32(0, true));
  const info = buf(88 + 600), line = buf(40), disp = buf(8);
  const symbol = at => {
    info.view.setUint32(0, 88, true);
    info.view.setUint32(80, 512, true);
    let s = at >= base && at < base + imageSize ? "rva " + hex(at - base) : hex(at);
    if (d.SymFromAddr(me, at, disp.at, info.at)) {
      const len = Math.min(info.view.getUint32(76, true), 200);
      s += " " + Buffer.from(info.bytes, info.pad + 84, len).toString("latin1") + "+" + hex(disp.view.getBigUint64(0, true));
    }
    line.view.setUint32(0, 40, true);
    if (d.SymGetLineFromAddr64(me, at - 1n, disp.at, line.at)) {
      const number = line.view.getUint32(16, true);
      const file = String(new (require("bun:ffi").CString)(Number(line.view.getBigUint64(24, true))));
      s += ` ${file.split(/[\\/]/).slice(-2).join("/")}:${number}`;
    }
    return s;
  };
  const imageBase = buf(8), handler = buf(16);
  const entryOf = at => k.RtlLookupFunctionEntry(at, imageBase.at, 0n);
  const isCode = w => w > base && w < base + imageSize && entryOf(w) !== 0n;
  const index = at => Number((at - low) / 8n);

  const read = (at, count) => {
    k.ReadProcessMemory(me, at, scratch.at, BigInt(count * 8), scratch.at + 4000n);
    return Array.from({ length: count }, (_, i) => scratch.view.getBigUint64(i * 8, true));
  };
  const sorted = [...nodes.values()].filter(n => n.id).map(n => [BigInt(n.cell), n]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const butterflies = sorted.map(([at, n]) => [read(at + 8n, 1)[0], n]).filter(([b]) => b > 0x10000n).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const below = (list, at) => {
    let a = 0, b = list.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (list[m][0] <= at) a = m + 1;
      else b = m;
    }
    return a - 1;
  };
  const pathTo = n => {
    let s = "";
    for (let id = n.id, i = 0; parent.get(id) && i < 14; id = parent.get(id)[0], i++) {
      const p = nodes.get(id);
      s += `${p.cls}${p.label ? `(${p.label.slice(0, 40)})` : ""}${p.root ? " ROOT " + p.root : ""} <-${parent.get(id)[1]}- `;
    }
    return s || "(not reachable from a reported root, in: " + n.from.length + ")";
  };
  out("--- every word of the process that holds one of them");
  let shown = 0;
  for (const [at, n, allocation, size, type] of found) {
    const [cell, owner] = sorted[below(sorted, at)] ?? [];
    const i = below(butterflies, at);
    const near = [butterflies[i], butterflies[i + 1]].filter(b => b && (b[0] > at ? b[0] - at : at - b[0]) < 0x400n);
    const inCell = owner && at < cell + BigInt(owner.size);
    if (inCell && reach.has(owner.id)) continue;
    if (!inCell && near.some(b => reach.has(b[1].id))) continue;
    if (++shown > 120) break;
    out("WORD", hex(at), "->", n.cls, n.label.slice(0, 20), "#" + n.id, "region", hex(allocation), hex(size), hex(type));
    if (inCell) out("       in", show(owner), "+" + (at - cell), pathTo(owner));
    else for (const [b, o] of near) out("       butterfly", at - b, "of", show(o), pathTo(o));
    if (at >= base && at < base + imageSize) out("       static", symbol(at));
    if (!inCell) out("       around", read(at - 48n, 13).map(w => (w > base && w < base + imageSize ? `<${symbol(w).slice(0, 90)}>` : hex(w))).join(" "));
  }
  out("--- cells that nothing reported reaches, without an incoming edge");
  for (const n of nodes.values()) if (n.id && !parent.has(n.id) && !n.from.length) out("    ", show(n), "out:", n.to.length);

  const c = buf(1232);
  const reg = (n, v) => (v === undefined ? c.view.getBigUint64(0x78 + 8 * n, true) : c.view.setBigUint64(0x78 + 8 * n, v, true));
  const unwind = slot => {
    for (let n = 0; n < 16; n++) reg(n, 0n);
    c.view.setUint32(0x30, 0x10000b, true);
    reg(4, slot + 8n), reg(5, words[index(slot) - 1]), reg(16, words[index(slot)]);
    const frames = [];
    while (reg(16)) {
      const rip = reg(16), sp = reg(4), entry = entryOf(rip);
      if (!entry || sp >= high || frames.length > 80) return;
      const image = imageBase.view.getBigUint64(0, true);
      const e = peek(entry, 12);
      const begin = e.getUint32(0, true), data = e.getUint32(8, true);
      if (data & 1) return;
      const frameRegister = peek(image + BigInt(data), 4).getUint8(3) & 15;
      if (frameRegister && (reg(frameRegister) < sp || reg(frameRegister) >= high)) return;
      k.RtlVirtualUnwind(0n, image, rip, entry, c.at, handler.at, handler.at + 8n, 0n);
      if (reg(4) <= sp || reg(4) > high) return;
      frames.push({ rip, sp, end: reg(4), begin: image + BigInt(begin) });
    }
    return frames.length > 5 ? frames : undefined;
  };
  let frames;
  for (let i = index(rsp) + 1; i < words.length && !frames; i++) {
    const at = low + BigInt(i) * 8n;
    if (isCode(words[i])) frames = unwind(at);
  }
  out("--- live native frames", frames?.length);
  for (const f of frames ?? []) {
    out("   sp high-" + hex(high - f.sp), "size", hex(f.end - f.sp), symbol(f.rip));
    const mine = hits.filter(([at]) => at >= f.sp && at < f.end);
    for (const [at, off, n] of mine) out("        HOLDS sp+" + hex(at - f.sp), show(n), "+" + off);
    if (mine.length) {
      for (let at = f.sp; at < f.end && at < f.sp + 0x400n; at += 8n) out("          sp+" + hex(at - f.sp), hex(words[index(at)]));
      const size = Number(f.rip - f.begin) + 64;
      for (let o = 0; o < Math.min(size, 6000); o += 1000) {
        peek(f.begin + BigInt(o), 1000);
        out("          code", hex(f.begin - base + BigInt(o)), Buffer.from(scratch.bytes, scratch.pad, 1000).toString("hex"));
      }
    }
  }
  for (const [at] of hits.filter(([at]) => at < rsp).slice(-12)) {
    out("--- around high-" + hex(high - at));
    for (let i = Math.max(0, index(at) - 40); i < index(at) + 40; i++)
      if (isCode(words[i])) out("     ", (i - index(at)) * 8, symbol(words[i]));
  }

  if (mode !== "zero" || !frames) return;
  const native = hits.filter(([at]) => at >= frames[0].sp);
  out("--- zeroing", native.length, "words in live native frames");
  for (const [at] of native) k.RtlMoveMemory(at, zero.at, 8n);
  hits.length = cells.length = 0;
  const after = [...snapshot().values()].filter(n => n.cls === "ClientRequest" && !n.to.some(e => e[1] === "constructor"));
  out("requests after zeroing:", after.length);
}
