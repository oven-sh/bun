// Temporary diagnostics, loaded with --preload. It never changes run.ts.
//
// PROBE=snap    : no FFI. After the fixture reports that the server was not collected: heap snapshot, then other
//                 ways to ask for a collection.
// PROBE=late    : snap, and the stack and the registers are copied first.
// PROBE=lateref : late, and a second server gives the cell header to look for in that copy (before the snapshot).
// PROBE=early   : late, and FinalizationRegistry.prototype.register, fetch, setTimeout and
//                 AbortController.prototype.abort are wrapped to copy the stack at those points. register also
//                 gives the address of the server.
// PROBE=early2  : early, and Promise.prototype.then and the resolve of Promise.withResolvers() are wrapped too.
// PROBE=gcwrap  : early, and Bun.gc is wrapped so that the stack is copied from the frame that called the collection.
import { fullGC, gcAndSweep, generateHeapSnapshotForDebugging, heapStats, jscDescribe } from "bun:jsc";

const variant = process.env.PROBE ?? "late";
const out: any = { variant, platform: process.platform, arch: process.arch, errors: [] as string[] };
const hex = (v: bigint | number) => "0x" + BigInt(v).toString(16);
const err = (where: string, e: any) => out.errors.push(where + ": " + String(e?.stack ?? e).slice(0, 600));
const origLog = console.log;
const origSetTimeout = globalThis.setTimeout;
const origGc = Bun.gc;

// ---- native layer -------------------------------------------------------------------------------------------------

type Native = {
  stackBase: number;
  stackReserveLow: number;
  image: { base: number; size: number };
  regNames: [string, number][]; // name, offset into a captured context
  spOffset: number;
  alloc(bytes: number): number;
  captureContext(at: number): void;
  copy(dst: number, src: number, bytes: number): void;
  committedLow(): number;
  readable(addr: bigint): boolean;
  read: typeof import("bun:ffi").read;
  toArrayBuffer: typeof import("bun:ffi").toArrayBuffer;
};

function makeWindows(): Native {
  const { dlopen, ptr, read, toArrayBuffer } = require("bun:ffi") as typeof import("bun:ffi");
  const k32 = dlopen("kernel32.dll", {
    GetCurrentThreadStackLimits: { args: ["ptr", "ptr"], returns: "void" },
    RtlCaptureContext: { args: ["ptr"], returns: "void" },
    VirtualQuery: { args: ["ptr", "ptr", "u64"], returns: "u64" },
    VirtualAlloc: { args: ["ptr", "u64", "u32", "u32"], returns: "ptr" },
    GetModuleHandleW: { args: ["ptr"], returns: "ptr" },
  }).symbols;
  let copy: (dst: number, src: number, bytes: number) => void;
  try {
    const ntdll = dlopen("ntdll.dll", { memcpy: { args: ["ptr", "ptr", "u64"], returns: "ptr" } }).symbols;
    copy = (dst, src, bytes) => void ntdll.memcpy(dst as any, src as any, bytes);
  } catch (e) {
    err("ntdll memcpy", e);
    const alt = dlopen("kernel32.dll", { RtlMoveMemory: { args: ["ptr", "ptr", "u64"], returns: "void" } }).symbols;
    copy = (dst, src, bytes) => void alt.RtlMoveMemory(dst as any, src as any, bytes);
  }
  const limits = new BigUint64Array(2);
  k32.GetCurrentThreadStackLimits(ptr(limits), ptr(limits, 8));
  const stackReserveLow = Number(limits[0]);
  const stackBase = Number(limits[1]);

  const mbi = new BigUint64Array(8);
  const mbiPtr = ptr(mbi);
  const mbi32 = new Uint32Array(mbi.buffer);
  const query = (addr: number) => {
    const n = Number(k32.VirtualQuery(addr as any, mbiPtr, 48));
    if (n === 0) return null;
    // BaseAddress 0, AllocationBase 8, AllocationProtect 16, RegionSize 24, State 32, Protect 36, Type 40
    return { base: Number(mbi[0]), size: Number(mbi[3]), state: mbi32[8], protect: mbi32[9] };
  };
  const MEM_COMMIT = 0x1000;
  const PAGE_GUARD = 0x100;
  const PAGE_NOACCESS = 0x01;
  const isReadable = (q: { state: number; protect: number } | null) =>
    !!q && q.state === MEM_COMMIT && !(q.protect & (PAGE_GUARD | PAGE_NOACCESS)) && q.protect !== 0;

  let image = { base: 0, size: 0 };
  try {
    const base = Number(k32.GetModuleHandleW(null));
    const lfanew = read.u32(base as any, 0x3c);
    image = { base, size: read.u32(base as any, lfanew + 0x50) };
  } catch (e) {
    err("image", e);
  }

  const regNames: [string, number][] = [];
  let spOffset: number;
  if (process.arch === "x64") {
    const gpr = [
      "rax",
      "rcx",
      "rdx",
      "rbx",
      "rsp",
      "rbp",
      "rsi",
      "rdi",
      "r8",
      "r9",
      "r10",
      "r11",
      "r12",
      "r13",
      "r14",
      "r15",
      "rip",
    ];
    gpr.forEach((name, i) => regNames.push([name, 0x78 + i * 8]));
    for (let i = 0; i < 16; i++) {
      regNames.push(["xmm" + i + ".lo", 0x1a0 + i * 16]);
      regNames.push(["xmm" + i + ".hi", 0x1a8 + i * 16]);
    }
    spOffset = 0x98;
  } else {
    for (let i = 0; i <= 28; i++) regNames.push(["x" + i, 0x8 + i * 8]);
    regNames.push(["fp", 0xf0], ["lr", 0xf8], ["sp", 0x100], ["pc", 0x108]);
    for (let i = 0; i < 32; i++) {
      regNames.push(["v" + i + ".lo", 0x110 + i * 16]);
      regNames.push(["v" + i + ".hi", 0x118 + i * 16]);
    }
    spOffset = 0x100;
  }

  const regionCache: [number, number, boolean][] = [];
  return {
    stackBase,
    stackReserveLow,
    image,
    regNames,
    spOffset,
    read,
    toArrayBuffer,
    alloc(bytes) {
      // MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE. Page aligned, so a CONTEXT in it is 16-byte aligned, which
      // RtlCaptureContext needs (it stores the XMM registers with movaps).
      const p = Number(k32.VirtualAlloc(null, bytes, 0x3000, 0x04));
      if (!p) throw new Error("VirtualAlloc failed");
      return p;
    },
    captureContext(at) {
      k32.RtlCaptureContext(at as any);
    },
    copy,
    committedLow() {
      // The reservation is [reserve low, base): reserved pages, then guard pages, then the committed part.
      let addr = stackReserveLow;
      for (let i = 0; i < 64 && addr < stackBase; i++) {
        const q = query(addr);
        if (!q || q.size === 0) break;
        if (isReadable(q)) return addr;
        addr = q.base + q.size;
      }
      return 0;
    },
    readable(address) {
      const addr = Number(address);
      for (const [lo, hi, ok] of regionCache) if (addr >= lo && addr < hi) return ok;
      const q = query(addr);
      if (!q || q.size === 0) return false;
      const ok = isReadable(q);
      if (regionCache.length < 4096) regionCache.push([q.base, q.base + q.size, ok]);
      return ok;
    },
  };
}

function makeLinux(): Native {
  const { dlopen, read, toArrayBuffer } = require("bun:ffi") as typeof import("bun:ffi");
  const libc = dlopen("libc.so.6", {
    getcontext: { args: ["ptr"], returns: "i32" },
    memcpy: { args: ["ptr", "ptr", "u64"], returns: "ptr" },
    mmap: { args: ["ptr", "u64", "i32", "i32", "i32", "i64"], returns: "ptr" },
  }).symbols;
  const fs = require("node:fs");
  const maps = () =>
    (fs.readFileSync("/proc/self/maps", "utf8") as string)
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [range, perms, , , , ...rest] = line.split(/\s+/);
        const [lo, hi] = range.split("-").map(x => Number("0x" + x));
        return { lo, hi, perms, name: rest.join(" ") };
      });
  const all = maps();
  const stack = all.find(m => m.name === "[stack]")!;
  const exeName = all.find(x => x.name.startsWith("/"))!.name;
  const exe = all.filter(m => m.name === exeName);
  // ucontext_t: gregs at 40, in the order R8 R9 R10 R11 R12 R13 R14 R15 RDI RSI RBP RBX RDX RAX RCX RSP RIP
  const names = [
    "r8",
    "r9",
    "r10",
    "r11",
    "r12",
    "r13",
    "r14",
    "r15",
    "rdi",
    "rsi",
    "rbp",
    "rbx",
    "rdx",
    "rax",
    "rcx",
    "rsp",
    "rip",
  ];
  let cache: ReturnType<typeof maps> | undefined;
  return {
    stackBase: stack.hi,
    stackReserveLow: stack.lo,
    image: { base: exe[0].lo, size: exe[exe.length - 1].hi - exe[0].lo },
    regNames: names.map((name, i) => [name, 40 + i * 8] as [string, number]),
    spOffset: 40 + 15 * 8,
    read,
    toArrayBuffer,
    alloc(bytes) {
      return Number(libc.mmap(null, bytes, 3, 0x22, -1, 0));
    },
    captureContext(at) {
      libc.getcontext(at as any);
    },
    copy(dst, src, bytes) {
      libc.memcpy(dst as any, src as any, bytes);
    },
    committedLow() {
      return maps().find(m => m.name === "[stack]")!.lo;
    },
    readable(address) {
      const addr = Number(address);
      cache ??= maps();
      return cache.some(m => addr >= m.lo && addr < m.hi && m.perms[0] === "r");
    },
  };
}

// ---- stack copies -------------------------------------------------------------------------------------------------
// Everything is copied into memory that the JS heap does not know about, by native calls, so that a copy allocates
// nothing and reports no memory to the collector.
const STORE_BYTES = 96 * 1024 * 1024;
const MAX_COPIES = 256;
const BELOW_SP = 24 * 1024; // dead stack under the captured stack pointer that is kept
const ABOVE_SP = 256 * 1024;
const CTX_BYTES = 2048;
let native: Native | undefined;
let storeBase = 0;
let ctxBase = 0;
let storeUsed = 0;
let committedLow = 0;
let frozen = false; // set once the copies are being read
// per copy: tag, offset into the store, bytes, address of the first word, captured sp
const meta = new Float64Array(MAX_COPIES * 5);
let copies = 0;
const tagNames: string[] = [];
const tagId = (name: string) => {
  let i = tagNames.indexOf(name);
  if (i < 0) i = tagNames.push(name) - 1;
  return i;
};

if (variant !== "snap") {
  try {
    if (process.platform === "win32") native = makeWindows();
    else if (process.platform === "linux" && process.arch === "x64") native = makeLinux();
    if (native) {
      storeBase = native.alloc(STORE_BYTES);
      ctxBase = native.alloc(MAX_COPIES * CTX_BYTES);
      committedLow = native.committedLow();
    }
  } catch (e) {
    native = undefined;
    err("native init", e);
  }
}

function copyStack(tag: number): number {
  const n = native;
  if (!n || frozen || copies >= MAX_COPIES) return -1;
  const ctx = ctxBase + copies * CTX_BYTES;
  n.captureContext(ctx);
  const sp = n.read.u32(ctx as any, n.spOffset + 4) * 4294967296 + n.read.u32(ctx as any, n.spOffset);
  let lo = sp - BELOW_SP;
  if (lo < committedLow || committedLow === 0) {
    committedLow = n.committedLow();
    if (committedLow === 0) lo = sp - 2048;
    else if (lo < committedLow) lo = committedLow;
  }
  lo -= lo % 8;
  let hi = n.stackBase;
  if (hi - sp > ABOVE_SP) hi = sp + ABOVE_SP;
  hi -= hi % 8;
  const bytes = hi - lo;
  if (bytes <= 0 || storeUsed + bytes > STORE_BYTES) return -1;
  n.copy(storeBase + storeUsed, lo, bytes);
  const m = copies * 5;
  meta[m] = tag;
  meta[m + 1] = storeUsed;
  meta[m + 2] = bytes;
  meta[m + 3] = lo;
  meta[m + 4] = sp;
  storeUsed += bytes;
  return copies++;
}

// ---- wrappers ------------------------------------------------------------------------------------------------------

let targetDescription: string | undefined;
const early = variant === "early" || variant === "early2" || variant === "gcwrap";
if (early && native) {
  try {
    const TAG_REGISTER = tagId("register"),
      TAG_FETCH = tagId("fetch"),
      TAG_TIMEOUT = tagId("setTimeout"),
      TAG_ABORT = tagId("abort"),
      TAG_GC = tagId("afterGc");
    const origRegister = FinalizationRegistry.prototype.register;
    FinalizationRegistry.prototype.register = function (target: any, held: any, token?: any) {
      if (held === "server" && targetDescription === undefined) {
        targetDescription = jscDescribe(target);
        copyStack(TAG_REGISTER);
      }
      return origRegister.call(this, target, held, token);
    };
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = function (a: any, b: any) {
      copyStack(TAG_FETCH);
      return origFetch(a, b);
    };
    (globalThis as any).setTimeout = function (cb: any, ms: any) {
      copyStack(TAG_TIMEOUT);
      return origSetTimeout(cb, ms);
    };
    const origAbort = AbortController.prototype.abort;
    AbortController.prototype.abort = function (reason?: any) {
      copyStack(TAG_ABORT);
      return origAbort.call(this, reason);
    };
    if (variant === "early2") {
      // `stopped.then(...)` is the first call after stopWhileParked() returned, and `release.resolve()` is the last
      // one before the route is released.
      const TAG_THEN = tagId("then"),
        TAG_RESOLVE = tagId("resolve");
      const origThen = Promise.prototype.then;
      Promise.prototype.then = function (a: any, b: any) {
        copyStack(TAG_THEN);
        return origThen.call(this, a, b);
      } as any;
      const origWithResolvers = Promise.withResolvers;
      Promise.withResolvers = function () {
        const result: any = origWithResolvers.call(Promise);
        const resolve = result.resolve;
        result.resolve = function (value: any) {
          copyStack(TAG_RESOLVE);
          return resolve(value);
        };
        return result;
      } as any;
    }
    if (variant === "gcwrap") {
      (Bun as any).gc = function (force: any) {
        const result = origGc(force);
        copyStack(TAG_GC);
        return result;
      };
    }
  } catch (e) {
    err("early wrappers", e);
  }
}

// PROBE_GC=shift   : Bun.gc is called through one more JS frame, and nothing else changes.
// PROBE_GC=clobber : that frame first runs a deep recursion whose frames hold numbers only, so the collection that
//                    follows runs over a stack that holds no old pointer below that frame.
const gcMode = process.env.PROBE_GC;
if (gcMode === "shift") {
  (Bun as any).gc = function (force: any) {
    return origGc(force);
  };
} else if (gcMode === "clobber") {
  const fillA = function fillA(depth: number, x: number): number {
    let a = x + 1,
      b = x + 2,
      c = x + 3,
      d = x + 4,
      e = x + 5,
      f = x + 6,
      g = x + 7;
    if (depth > 0) a += fillB(depth - 1, b);
    return a + b + c + d + e + f + g;
  };
  const fillB = function fillB(depth: number, x: number): number {
    let a = x + 1,
      b = x + 2,
      c = x + 3,
      d = x + 4;
    if (depth > 0) a += fillA(depth - 1, c);
    return a + b + c + d;
  };
  (Bun as any).gc = function (force: any) {
    fillA(300, 1);
    fillB(301, 2);
    return origGc(force);
  };
}
out.gcMode = gcMode;

const always = !!process.env.PROBE_ALWAYS;
const TAG_LATE = tagId("late");
let lateCopy = -1;
console.log = function (...args: any[]) {
  const line = args[0];
  const isReport = typeof line === "string" && line.includes('"collectedAfterwards"');
  const failed = isReport && line.includes('"collectedAfterwards":false');
  // Before anything else runs on this stack, printing included.
  if ((failed || (isReport && always)) && native) lateCopy = copyStack(TAG_LATE);
  origLog.apply(console, args);
  if (!isReport) return;
  out.fixture = line;
  if (failed || always) {
    late()
      .catch(e => err("late", e))
      .finally(emit);
  } else emit();
};

function emit() {
  let payload: string;
  try {
    payload = Buffer.from(Bun.gzipSync(Buffer.from(JSON.stringify(out)))).toString("base64");
  } catch (e) {
    payload = Buffer.from(Bun.gzipSync(Buffer.from(JSON.stringify({ variant, emitError: String(e) })))).toString(
      "base64",
    );
  }
  origLog("@@PROBE@@" + payload);
}

// ---- after the fixture failed --------------------------------------------------------------------------------------

const serverClassNames = ["HTTPServer", "DebugHTTPServer", "HTTPSServer", "DebugHTTPSServer"];
const liveServers = () => {
  const counts = heapStats().objectTypeCounts as Record<string, number>;
  return serverClassNames.reduce((n, name) => n + (counts[name] ?? 0), 0);
};
const turn = () => new Promise<void>(r => origSetTimeout(r, 0));

// A cell that the scan of a stack copy looks for: a pointer to any of its first `bytes` bytes counts.
type Cell = { id: number; name: string; addr: number; bytes: number };

// The heap snapshot, reduced to the servers: for each one, the cells that reach it through edges (breadth first, so
// the first root found is the nearest), which of them are roots, and the edges among them.
function snapshotAnalysis() {
  const snap: any = generateHeapSnapshotForDebugging();
  const nodes: any[] = snap.nodes;
  const edges: number[] = snap.edges;
  const F = 7;
  const classIds = new Set<number>();
  (snap.nodeClassNames as string[]).forEach((name, i) => serverClassNames.includes(name) && classIds.add(i));
  const indexOfId = new Map<number, number>();
  for (let i = 0; i < nodes.length; i += F) indexOfId.set(nodes[i], i);
  const incoming = new Map<number, number[]>(); // to -> edge offsets
  for (let e = 0; e < edges.length; e += 4) {
    const list = incoming.get(edges[e + 1]);
    if (list) list.push(e);
    else incoming.set(edges[e + 1], [e]);
  }
  const rootReason = new Map<number, string>();
  const roots: number[] = snap.roots ?? [];
  for (let r = 0; r < roots.length; r += 3)
    rootReason.set(
      roots[r],
      (snap.labels[roots[r + 1]] ?? "?") + (roots[r + 2] ? " / " + snap.labels[roots[r + 2]] : ""),
    );
  const cellOf = (id: number): Cell & { label?: string; size: number } => {
    const i = indexOfId.get(id);
    if (i === undefined) return { id, name: "#" + id + " ?", addr: 0, bytes: 0, size: 0 };
    const cls = snap.nodeClassNames[nodes[i + 2]];
    const label = snap.labels?.[nodes[i + 4]] || undefined;
    const size = nodes[i + 1];
    return {
      id,
      name: "#" + id + " " + cls,
      label,
      addr: Number(nodes[i + 5]),
      bytes: Math.min(Math.max(size, 16), 256),
      size,
    };
  };
  const edgeText = (e: number) => {
    const type = snap.edgeTypes[edges[e + 2]];
    const data =
      type === "Property" || type === "Variable" ? snap.edgeNames[edges[e + 3]] : type === "Index" ? edges[e + 3] : "";
    return type + (data === "" ? "" : ":" + data);
  };
  const isRoot = (id: number) => {
    if (rootReason.has(id)) return rootReason.get(id)!;
    for (const e of incoming.get(id) ?? []) if (edges[e] === 0) return "an edge from <root>";
    return undefined;
  };
  const servers: any[] = [];
  const scan: Cell[] = [];
  for (let i = 0; i < nodes.length; i += F) {
    if (!classIds.has(nodes[i + 2])) continue;
    const id = nodes[i];
    const self = cellOf(id);
    // The prototype object has the same class name. It is small and a Structure refers to it.
    const isInstance = self.addr % 16 === 8 || self.size > 100;
    const entry: any = {
      cell: self.name,
      addr: hex(self.addr),
      size: self.size,
      isInstance,
      root: isRoot(id),
      incoming: (incoming.get(id) ?? []).length,
    };
    servers.push(entry);
    if (!isInstance) continue;
    const via = new Map<number, number | undefined>([[id, undefined]]);
    const order = [id];
    let rooted: number | undefined;
    for (let k = 0; k < order.length && order.length < 4000 && rooted === undefined; k++) {
      const to = order[k];
      if (isRoot(to) !== undefined) {
        rooted = to;
        break;
      }
      for (const e of incoming.get(to) ?? []) {
        const from = edges[e];
        if (from === 0 || via.has(from)) continue;
        via.set(from, e);
        order.push(from);
      }
    }
    entry.reachedBy = order.length - 1;
    if (rooted !== undefined) {
      const path: string[] = [];
      for (let at: number | undefined = rooted, guard = 0; at !== undefined && guard < 80; guard++) {
        const e = via.get(at);
        const cell = cellOf(at);
        path.push(
          cell.name +
            (cell.label ? " '" + cell.label + "'" : "") +
            (at === rooted ? " [root: " + isRoot(at) + "]" : "") +
            (e === undefined ? "" : " -" + edgeText(e) + "->"),
        );
        at = e === undefined ? undefined : edges[e + 1];
      }
      entry.pathFromRoot = path.join(" ");
      scan.push({ ...self });
    } else {
      // No root reaches it. Everything that reaches it is listed, with the edges among them: whatever keeps one of
      // these cells alive keeps the server alive.
      const inside = new Set(order);
      entry.unrooted = true;
      entry.cells = order.slice(0, 150).map(at => {
        const cell = cellOf(at);
        const all = incoming.get(at) ?? [];
        return (
          cell.name +
          (cell.label ? " '" + String(cell.label).slice(0, 40) + "'" : "") +
          " " +
          hex(cell.addr) +
          " size " +
          cell.size +
          " incoming " +
          all.length +
          (all.some(e => !inside.has(edges[e])) ? " (some from outside)" : "")
        );
      });
      const edgeLines: string[] = [];
      for (const at of order.slice(0, 150))
        for (const e of incoming.get(at) ?? [])
          if (edgeLines.length < 400) edgeLines.push("#" + edges[e] + " -" + edgeText(e) + "-> #" + at);
      entry.edges = edgeLines;
      for (const at of order) scan.push(cellOf(at));
    }
  }
  return { nodeCount: nodes.length / F, edgeCount: edges.length / 4, rootCount: roots.length / 3, servers, scan };
}

// ---- reading the stack copies --------------------------------------------------------------------------------------

let store32: Uint32Array | undefined;
let ctx32: Uint32Array | undefined;
const copyInfo = (i: number) => {
  const m = i * 5;
  return { tag: tagNames[meta[m]], first: meta[m + 1] / 8, words: meta[m + 2] / 8, lo: meta[m + 3], sp: meta[m + 4] };
};
const hex64 = (hi: number, lo: number) => (hi ? hi.toString(16) + lo.toString(16).padStart(8, "0") : lo.toString(16));

type Ranges = { cells: Cell[]; starts: Float64Array };
function makeRanges(cells: Cell[]): Ranges {
  const sorted = cells.filter(c => c.addr > 0x10000).sort((a, b) => a.addr - b.addr);
  return { cells: sorted, starts: Float64Array.from(sorted, c => c.addr) };
}
// The index of the cell that `v` points into, or -1.
function lookup(ranges: Ranges, v: number): number {
  const starts = ranges.starts;
  let lo = 0,
    hi = starts.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= v) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return -1;
  const cell = ranges.cells[found];
  return v <= cell.addr + cell.bytes ? found : -1;
}

// Where a word points, in a form that survives ASLR: T<id>+n (a cell that is looked for), I+rva (the executable),
// S+n (n bytes under the stack base), or the raw value.
function classify(hi: number, lo: number, ranges?: Ranges): string {
  if (hi === 0 && lo === 0) return "0";
  if (hi < 0x10000) {
    const v = hi * 4294967296 + lo;
    const n = native!;
    if (ranges) {
      const k = lookup(ranges, v);
      if (k >= 0) return "T" + ranges.cells[k].id + "+" + (v - ranges.cells[k].addr).toString(16);
    }
    if (v >= n.image.base && v < n.image.base + n.image.size) return "I+" + (v - n.image.base).toString(16);
    if (v >= n.stackReserveLow && v <= n.stackBase) return "S+" + (n.stackBase - v).toString(16);
  }
  return hex64(hi, lo);
}

const regsOf = (copy: number, ranges?: Ranges) =>
  native!.regNames.map(([name, off]) => {
    const at = (copy * CTX_BYTES + off) / 4;
    return [name, classify(ctx32![at + 1], ctx32![at], ranges)] as [string, string];
  });

// Every place in a stack copy, and every register, that holds a pointer into one of the cells.
function hitsIn(copy: number, ranges: Ranges) {
  const info = copyInfo(copy);
  const hits: { reg?: string; underBase?: number; aboveSp?: number; v: string }[] = [];
  for (const [name, text] of regsOf(copy, ranges)) if (text[0] === "T") hits.push({ reg: name, v: text });
  const s = store32!;
  for (let i = 0, at = info.first * 2; i < info.words; i++, at += 2) {
    const hi = s[at + 1];
    if (hi === 0 || hi >= 0x10000) continue;
    const k = lookup(ranges, hi * 4294967296 + s[at]);
    if (k < 0) continue;
    const addr = info.lo + i * 8;
    hits.push({
      underBase: native!.stackBase - addr,
      aboveSp: addr - info.sp,
      v: "T" + ranges.cells[k].id + "+" + (hi * 4294967296 + s[at] - ranges.cells[k].addr).toString(16),
    });
  }
  return hits;
}

// `count` words of a copy from `fromAddr` up, classified. Runs of zero are collapsed to z<n>.
function dump(copy: number, fromAddr: number, count: number, ranges?: Ranges) {
  const info = copyInfo(copy);
  let i = Math.max(0, Math.floor((fromAddr - info.lo) / 8));
  const end = Math.min(info.words, i + count);
  const parts: string[] = [];
  let zeros = 0;
  const first = native!.stackBase - (info.lo + i * 8);
  for (; i < end; i++) {
    const at = (info.first + i) * 2;
    const hi = store32![at + 1],
      lo = store32![at];
    if (hi === 0 && lo === 0) {
      zeros++;
      continue;
    }
    if (zeros) (parts.push("z" + zeros), (zeros = 0));
    parts.push(classify(hi, lo, ranges));
  }
  if (zeros) parts.push("z" + zeros);
  return { firstUnderBase: first, spUnderBase: native!.stackBase - info.sp, words: parts.join(" ") };
}

async function late() {
  frozen = true;
  const n = native;
  out.liveServersAtFailure = liveServers();
  if (n) {
    out.native = {
      stackBase: hex(n.stackBase),
      reserve: n.stackBase - n.stackReserveLow,
      image: { base: hex(n.image.base), size: n.image.size },
      copies,
      storeUsed,
    };
    store32 = new Uint32Array(n.toArrayBuffer(storeBase as any, 0, storeUsed));
    ctx32 = new Uint32Array(n.toArrayBuffer(ctxBase as any, 0, Math.max(copies, 1) * CTX_BYTES));
  }

  let serverCell: number | undefined;
  if (targetDescription) {
    out.targetDescription = targetDescription;
    const m = /0x[0-9a-f]+/i.exec(targetDescription);
    if (m) serverCell = Number(m[0]);
  }
  let refCell: number | undefined;
  if (n && variant === "lateref" && lateCopy >= 0) {
    // No early hook: look for a pointer to a cell with the header of a server. A second server gives the header.
    try {
      let ref: any = Bun.serve({ port: 0, development: false, fetch: () => new Response("ref") });
      const refDescription = jscDescribe(ref);
      refCell = Number(/0x[0-9a-f]+/i.exec(refDescription)![0]);
      // StructureID, indexing type, JSType and flags. Not the cell state, which the collector writes.
      const headerLo = n.read.u32(refCell as any, 0);
      const headerHi = n.read.u32(refCell as any, 4) & 0x00ffffff;
      ref.stop(true);
      ref = undefined;
      out.ref = { description: refDescription, header: hex64(headerHi, headerLo) };
      const info = copyInfo(lateCopy);
      const seen = new Map<number, number>();
      const rejected = new Set<number>();
      const consider = (hi: number, lo: number) => {
        if (hi === 0 || hi >= 0x10000 || lo % 8 !== 0) return;
        const v = hi * 4294967296 + lo;
        if (v === refCell || rejected.has(v)) return;
        if (v >= n.stackReserveLow && v <= n.stackBase) return;
        if (v >= n.image.base && v < n.image.base + n.image.size) return;
        if (seen.has(v)) return void seen.set(v, seen.get(v)! + 1);
        if (
          n.readable(BigInt(v)) &&
          n.readable(BigInt(v + 7)) &&
          n.read.u32(v as any, 0) === headerLo &&
          (n.read.u32(v as any, 4) & 0x00ffffff) === headerHi
        )
          seen.set(v, 1);
        else rejected.add(v);
      };
      for (let i = 0, at = info.first * 2; i < info.words; i++, at += 2) consider(store32![at + 1], store32![at]);
      for (const [, off] of n.regNames) {
        const at = (lateCopy * CTX_BYTES + off) / 4;
        consider(ctx32![at + 1], ctx32![at]);
      }
      out.headerCandidates = [...seen].map(([v, count]) => ({ cell: hex(v), count }));
      if (seen.size === 1) serverCell = [...seen.keys()][0];
    } catch (e) {
      err("header search", e);
    }
  }

  // What the collector's own analyzer says. This collection runs from another host function than Bun.gc.
  let scan: Cell[] = [];
  try {
    const analysis = snapshotAnalysis();
    scan = analysis.scan.filter(c => c.addr !== refCell);
    out.snapshot = {
      nodeCount: analysis.nodeCount,
      edgeCount: analysis.edgeCount,
      rootCount: analysis.rootCount,
      servers: analysis.servers,
    };
    const instances = analysis.servers.filter((s: any) => s.isInstance && Number(s.addr) !== refCell);
    if (serverCell === undefined && instances.length === 1) serverCell = Number(instances[0].addr);
  } catch (e) {
    err("snapshot", e);
  }
  out.liveServersAfterSnapshot = liveServers();

  if (n && lateCopy >= 0) {
    try {
      if (serverCell !== undefined) {
        out.serverCell = hex(serverCell);
        // What is in front of the cell (its PreciseAllocation, if it is one) and the cell itself, raw.
        const raw: string[] = [];
        for (let off = -0x80; off < 0x100; off += 8)
          raw.push(hex64(n.read.u32((serverCell + off) as any, 4), n.read.u32((serverCell + off) as any, 0)));
        out.cellMemoryFromMinus0x80 = raw.join(" ");
        // PreciseAllocation::m_cellSize, if the cell is a precise allocation (its address is 8 mod 16). The
        // conservative scan accepts a pointer to any byte of the cell and to the byte after it.
        const preciseCellSize = serverCell % 16 === 8 ? n.read.u32((serverCell - 0x58) as any, 0) : 0;
        const bytes = preciseCellSize >= 16 && preciseCellSize <= 4096 ? preciseCellSize : 0x100;
        out.serverCellBytes = bytes;
        const known = scan.find(c => c.addr === serverCell);
        if (known) known.bytes = bytes;
        else scan.push({ id: 0, name: "#0 server", addr: serverCell, bytes });
      }
      out.scanCells = scan.length;
      const ranges = makeRanges(scan);
      const info = copyInfo(lateCopy);
      out.lateSpUnderBase = n.stackBase - info.sp;
      out.lateHits = hitsIn(lateCopy, ranges);
      out.lateRegs = regsOf(lateCopy, ranges)
        .map(([name, text]) => name + "=" + text)
        .join(" ");
      // The stack from 6 KB under the captured stack pointer to 3 KB over it.
      out.lateStack = dump(lateCopy, info.sp - 6144, (6144 + 3072) / 8, ranges);

      // The slots that hold one of the cells in one of the last copies, through all copies.
      const slotSet = new Set<number>();
      const lastCopies: number[] = [];
      for (let c = copies - 1; c >= 0 && lastCopies.length < 4; c--) lastCopies.push(c);
      const hitsOfLast = new Map<number, ReturnType<typeof hitsIn>>();
      for (const c of lastCopies) {
        const hits = hitsIn(c, ranges);
        hitsOfLast.set(c, hits);
        for (const h of hits) if (h.underBase !== undefined) slotSet.add(h.underBase);
      }
      const slots = [...slotSet].sort((a, b) => a - b);
      out.slots = slots.map(s => s.toString(16));
      out.around = slots
        .slice(0, 10)
        .map(under => ({
          slot: under.toString(16),
          ...dump(copies - 1, n.stackBase - under - 16 * 8, 16 + 220, ranges),
        }));
      if (copies > 1) {
        const timeline: string[] = [];
        let last = "";
        for (let c = 0; c < copies; c++) {
          const ci = copyInfo(c);
          const row = slots
            .map(under => {
              const addr = n.stackBase - under;
              if (addr < ci.lo || addr >= ci.lo + ci.words * 8) return "?";
              const at = (ci.first + (addr - ci.lo) / 8) * 2;
              return classify(store32![at + 1], store32![at], ranges);
            })
            .join(",");
          const hits = hitsOfLast.get(c) ?? hitsIn(c, ranges);
          const regs = hits
            .filter(h => h.reg)
            .map(h => h.reg + "=" + h.v)
            .join("+");
          const all = hits
            .filter(h => h.underBase !== undefined)
            .slice(0, 40)
            .map(h => h.underBase!.toString(16) + (h.aboveSp! < 0 ? "d" : "") + "=" + h.v)
            .join(",");
          const text =
            "sp=" + (n.stackBase - ci.sp).toString(16) + " slots=[" + row + "] regs=[" + regs + "] all=[" + all + "]";
          if (text !== last || c === copies - 1) timeline.push(c + ":" + ci.tag + " " + text);
          last = text;
        }
        out.timeline = timeline;
        // For the gc wrapper: the stack right after a collection returned, seen from the frame that called it.
        let gcCopy = -1;
        for (let c = 0; c < copies; c++) if (copyInfo(c).tag === "afterGc") gcCopy = c;
        if (gcCopy >= 0) {
          const ci = copyInfo(gcCopy);
          out.afterGc = {
            copy: gcCopy,
            hits: hitsIn(gcCopy, ranges),
            regs: regsOf(gcCopy, ranges)
              .map(([name, text]) => name + "=" + text)
              .join(" "),
            stack: dump(gcCopy, ci.sp - 8192, (8192 + 3072) / 8, ranges),
          };
        }
        // The same for the last copy that a wrapped setTimeout made: it is inside the loop that fails.
        let timerCopy = -1;
        for (let c = 0; c < copies; c++) if (copyInfo(c).tag === "setTimeout") timerCopy = c;
        if (timerCopy >= 0) {
          const ci = copyInfo(timerCopy);
          out.lastTimer = {
            copy: timerCopy,
            hits: hitsIn(timerCopy, ranges),
            regs: regsOf(timerCopy, ranges)
              .map(([name, text]) => name + "=" + text)
              .join(" "),
            stack: dump(timerCopy, ci.sp - 8192, (8192 + 3072) / 8, ranges),
          };
        }
      }
    } catch (e) {
      err("hits", e);
    }
  }

  // Which way of asking for a collection frees it, if any.
  const steps: [string, () => void | Promise<void>][] = [
    ["turn", () => {}],
    ["Bun.gc(true)", () => void origGc(true)],
    ["fullGC()", () => void fullGC()],
    ["gcAndSweep()", () => void gcAndSweep()],
    [
      "Bun.gc(true) 40 frames deeper",
      () =>
        (function deeper(depth: number): void {
          if (depth) return deeper(depth - 1);
          origGc(true);
        })(40),
    ],
    ["Bun.gc(true) from a timer callback", () => new Promise<void>(r => origSetTimeout(() => (origGc(true), r()), 0))],
    ["Bun.gc(true) from a sync callback", () => void [1].forEach(() => void origGc(true))],
    [
      "Bun.gc(true) x5",
      async () => {
        for (let i = 0; i < 5; i++) (origGc(true), await turn());
      },
    ],
  ];
  out.steps = [];
  for (const [name, run] of steps) {
    try {
      await run();
      await turn();
      out.steps.push(name + " -> " + liveServers());
    } catch (e) {
      err("step " + name, e);
    }
  }
}
