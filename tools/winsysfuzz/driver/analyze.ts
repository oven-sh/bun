// Reads a wsf trace log and prints a human summary: syscalls by name with
// counts and status breakdown, distinct callsites, injected faults.
//
//   bun driver/analyze.ts <log> [--callsites] [--status]
//
// The (syscall, callsite, hit-index) census this produces is the input the
// fault scheduler enumerates.

// With --sym <bun.exe> every distinct callsite RVA is batch-symbolized
// through wsfsym.exe and classified into a calling MODULE by source path
// (libuv / WebKit-JSC-WTF / mimalloc / boringssl / c-ares / bun's Rust /
// ...). That per-module census is the "all locations" coverage matrix:
// which of bun's dependencies actually reach which syscalls.

import { dirname, join } from "node:path";

const here = dirname(import.meta.path);
const manifest: { id: number; name: string; category: string }[] = await Bun.file(
  join(here, "generated", "syscalls.gen.json"),
).json();
const nameOf = (id: number) => manifest[id]?.name ?? `sys#${id}`;

const args = process.argv.slice(2);
const flagVal = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const logPath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--sym" && args[i - 1] !== "--wsfsym");
if (!logPath) {
  console.error("usage: analyze.ts <log> [--callsites] [--status] [--sym <bun.exe>] [--wsfsym <path>]");
  process.exit(2);
}
const showCallsites = args.includes("--callsites");
const showStatus = args.includes("--status");
const symExe = flagVal("--sym");
const wsfsymPath = flagVal("--wsfsym") ?? join(here, "..", "build", "Release", "wsfsym.exe");

const KNOWN: Record<string, string> = {
  "0": "STATUS_SUCCESS",
  "103": "STATUS_PENDING",
  "80000005": "STATUS_BUFFER_OVERFLOW",
  "8000001a": "STATUS_NO_MORE_ENTRIES",
  "c0000005": "STATUS_ACCESS_VIOLATION",
  "c0000008": "STATUS_INVALID_HANDLE",
  "c000000d": "STATUS_INVALID_PARAMETER",
  "c0000022": "STATUS_ACCESS_DENIED",
  "c0000023": "STATUS_BUFFER_TOO_SMALL",
  "c0000034": "STATUS_OBJECT_NAME_NOT_FOUND",
  "c0000035": "STATUS_OBJECT_NAME_COLLISION",
  "c000003a": "STATUS_OBJECT_PATH_NOT_FOUND",
  "c0000043": "STATUS_SHARING_VIOLATION",
  "c000007c": "STATUS_NO_TOKEN",
  "c00000bb": "STATUS_NOT_SUPPORTED",
  "c0000102": "STATUS_TIMEOUT",
  "102": "STATUS_TIMEOUT(wait)",
};
const statusName = (h: string) => KNOWN[h] ?? h;

interface Rec {
  seq: number;
  tid: number;
  sys: number;
  status: string;
  rva: string; // primary callsite (schedule key) — first candidate
  rvas: string[]; // all candidate bun.exe frames, nearest first
  frame0: string;
  fault: "" | "P" | "Q";
  entryOnly: boolean;
}

const text = await Bun.file(logPath).text();
const recs: Rec[] = [];
const notes: string[] = [];
for (const line of text.split("\n")) {
  if (!line) continue;
  if (line.startsWith("#")) {
    notes.push(line);
    continue;
  }
  const p = line.split(" ");
  if (p[0] === "X") {
    const rvas = p[5] === "0" ? [] : p[5].split(",");
    recs.push({
      seq: +p[1],
      tid: +p[2],
      sys: +p[3],
      status: p[4],
      rva: rvas[0] ?? "0",
      rvas,
      frame0: p[6],
      fault: p[7] === "!P" ? "P" : p[7] === "!Q" ? "Q" : "",
      entryOnly: false,
    });
  } else if (p[0] === "E") {
    const rvas = p[4] === "0" ? [] : p[4].split(",");
    recs.push({ seq: +p[1], tid: +p[2], sys: +p[3], status: "", rva: rvas[0] ?? "0", rvas, frame0: p[5], fault: "", entryOnly: true });
  }
}

for (const n of notes) console.log(n);
console.log(`\n${recs.length} records, ${new Set(recs.map(r => r.tid)).size} threads\n`);

// --- by syscall -------------------------------------------------------------
type Agg = { count: number; statuses: Map<string, number>; callsites: Map<string, number>; faults: number };
const bySys = new Map<number, Agg>();
for (const r of recs) {
  let a = bySys.get(r.sys);
  if (!a) bySys.set(r.sys, (a = { count: 0, statuses: new Map(), callsites: new Map(), faults: 0 }));
  a.count++;
  if (!r.entryOnly) a.statuses.set(r.status, (a.statuses.get(r.status) ?? 0) + 1);
  if (r.rva !== "0") a.callsites.set(r.rva, (a.callsites.get(r.rva) ?? 0) + 1);
  if (r.fault) a.faults++;
}

const rows = [...bySys.entries()].sort((a, b) => b[1].count - a[1].count);
console.log("syscall".padEnd(34) + "count".padStart(7) + "  callsites  top-statuses");
for (const [sys, a] of rows) {
  const st = [...a.statuses.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([s, c]) => `${statusName(s)}:${c}`)
    .join(" ");
  const inj = a.faults ? `  [${a.faults} injected]` : "";
  console.log(
    nameOf(sys).padEnd(34) +
      String(a.count).padStart(7) +
      "  " +
      String(a.callsites.size).padStart(9) +
      "  " +
      (showStatus ? st : "") +
      inj,
  );
  if (showCallsites) {
    const cs = [...a.callsites.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    for (const [rva, c] of cs) console.log("    bun+0x" + rva.padEnd(10) + " x" + c);
  }
}

const injected = recs.filter(r => r.fault);
if (injected.length) {
  console.log(`\n${injected.length} injected faults:`);
  for (const r of injected)
    console.log(
      `  seq ${r.seq} tid ${r.tid} ${nameOf(r.sys)} -> ${statusName(r.status)} ` +
        `(${r.fault === "P" ? "pre" : "post"}) at bun+0x${r.rva}`,
    );
}

// --- module census -----------------------------------------------------------
if (symExe) {
  const rvas = [...new Set(recs.flatMap(r => r.rvas).filter(v => v && v !== "0"))];
  const proc = Bun.spawn([wsfsymPath, symExe, "-"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  proc.stdin.write(rvas.map(v => v + "\n").join(""));
  proc.stdin.end();
  const symOut = await new Response(proc.stdout).text();
  await proc.exited;

  // rva -> {sym, file}
  const symOf = new Map<string, { sym: string; file: string }>();
  for (const line of symOut.split("\n")) {
    const [rva, sym, file] = line.split("\t");
    if (rva) symOf.set(rva.trim(), { sym: sym ?? "?", file: file ?? "-" });
  }

  // Classify by source path first, then symbol namespace as a fallback.
  const classify = (rva: string): string => {
    const s = symOf.get(rva);
    if (!s) return "unresolved";
    const f = s.file.toLowerCase().replace(/\\/g, "/");
    const sym = s.sym;
    if (f.includes("/vendor/libuv/") || /^uv[_A-Z]/.test(sym)) return "libuv";
    if (f.includes("/vendor/webkit/") || /^(JSC|WTF|Inspector|bmalloc|Gigacage)::/.test(sym) || sym.startsWith("bmalloc"))
      return "webkit(jsc/wtf)";
    if (f.includes("/mimalloc/") || /^(mi_|_mi_)/.test(sym)) return "mimalloc";
    if (f.includes("/boringssl/") || /^(SSL_|CRYPTO_|EVP_|BN_|EC_|RSA_)/.test(sym)) return "boringssl";
    if (f.includes("/cares/") || sym.startsWith("ares_")) return "c-ares";
    if (f.includes("/lolhtml/")) return "lolhtml";
    if (f.includes("/zlib/") || f.includes("/brotli/") || f.includes("/zstd/") || f.includes("/libdeflate/"))
      return "compression";
    if (f.includes("/rust/") && (f.includes("/library/std/") || f.includes("/library/core/") || f.includes("/library/alloc/")))
      return "rust-std";
    if (f.includes("/.cargo/registry/")) return "rust-crates";
    if (f.includes("/bun/src/")) return "bun-rust(src)";
    if (sym === "?" || sym.startsWith("?(")) return "unresolved";
    return "other";
  };
  // Walk candidate frames, nearest first, to the first confidently-owned one;
  // an inlined std:: template (STL header path) can't name its owner, but the
  // frame behind it usually can.
  const weak = new Set(["other", "unresolved", "rust-std"]);
  const moduleOf = (r: Rec): string => {
    let fallback = "unresolved";
    for (const rva of r.rvas) {
      const m = classify(rva);
      if (!weak.has(m)) return m;
      if (fallback === "unresolved" && m !== "unresolved") fallback = m;
    }
    return fallback;
  };
  const primary = (r: Rec) => r.rva;

  type MAgg = { count: number; syscalls: Map<number, number>; callsites: Set<string>; syms: Map<string, number> };
  const byMod = new Map<string, MAgg>();
  for (const r of recs) {
    if (primary(r) === "0") continue;
    const mod = moduleOf(r);
    let a = byMod.get(mod);
    if (!a) byMod.set(mod, (a = { count: 0, syscalls: new Map(), callsites: new Set(), syms: new Map() }));
    a.count++;
    a.syscalls.set(r.sys, (a.syscalls.get(r.sys) ?? 0) + 1);
    a.callsites.add(primary(r));
    const s = symOf.get(primary(r))?.sym.replace(/\+0x[0-9a-f]+$/, "") ?? "?";
    a.syms.set(s, (a.syms.get(s) ?? 0) + 1);
  }
  const attributed = [...byMod.values()].reduce((n, a) => n + a.count, 0);
  console.log(
    `\n=== module census: ${attributed}/${recs.length} records attributed to a bun.exe callsite ===`,
  );
  const mods = [...byMod.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [mod, a] of mods) {
    const top = [...a.syscalls.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 6)
      .map(([s, c]) => `${nameOf(s)}:${c}`)
      .join(" ");
    console.log(`\n${mod.padEnd(16)} ${String(a.count).padStart(6)} records, ${a.callsites.size} callsites`);
    console.log(`    ${top}`);
    const topSyms = [...a.syms.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 4)
      .map(([s, c]) => `${s.length > 60 ? s.slice(0, 57) + "..." : s} x${c}`);
    for (const ts of topSyms) console.log(`      · ${ts}`);
  }
}
