// Reads a wsf trace log and prints a human summary: syscalls by name with
// counts and status breakdown, distinct callsites, injected faults.
//
//   bun driver/analyze.ts <log> [--callsites] [--status] [--sym <bun.exe>]
//
// With --sym <bun.exe> every distinct callsite RVA is batch-symbolized
// through wsfsym.exe and classified into a calling MODULE by source path
// (libuv / WebKit-JSC-WTF / mimalloc / boringssl / c-ares / bun's Rust /
// ...). That per-module census is the "all locations" coverage matrix:
// which of bun's dependencies actually reach which syscalls.

import { moduleOf, nameOf, parseTrace, statusName, symbolize } from "./lib";

const args = process.argv.slice(2);
const flagVal = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const logPath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--sym");
if (!logPath) {
  console.error("usage: analyze.ts <log> [--callsites] [--status] [--sym <bun.exe>]");
  process.exit(2);
}
const showCallsites = args.includes("--callsites");
const showStatus = args.includes("--status");
const symExe = flagVal("--sym");

const trace = parseTrace(await Bun.file(logPath).text());
const recs = trace.recs;
for (const n of trace.notes) console.log(n);
console.log(`\n${recs.length} records, ${new Set(recs.map(r => r.tid)).size} threads\n`);

// --- by syscall -------------------------------------------------------------
type Agg = {
  count: number;
  statuses: Map<string, number>;
  callsites: Map<string, number>;
  faults: number;
  details: Map<string, number>; // decoded detail (target/ioctl) tally
};
const bySys = new Map<number, Agg>();
for (const r of recs) {
  let a = bySys.get(r.sys);
  if (!a)
    bySys.set(r.sys, (a = { count: 0, statuses: new Map(), callsites: new Map(), faults: 0, details: new Map() }));
  a.count++;
  if (!r.entryOnly) a.statuses.set(r.status, (a.statuses.get(r.status) ?? 0) + 1);
  if (r.rva !== "0") a.callsites.set(r.rva, (a.callsites.get(r.rva) ?? 0) + 1);
  if (r.fault) a.faults++;
  // Tally the typed detail with volatile numbers folded (xfer=/len= vary):
  // "ioctl=AFD_RECV on h=s:Afd" recurs, its byte counts don't.
  if (r.detail || r.path) {
    const d = (r.detail ?? "").replace(/\b(xfer|len)=\d+/g, "$1=#") + (r.path ? ` path=${r.path}` : "");
    a.details.set(d.trim(), (a.details.get(d.trim()) ?? 0) + 1);
  }
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
  // Decoded detail (WSF_ARGS=1): what was actually touched.
  if (a.details.size) {
    const ds = [...a.details.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
    for (const [d, c] of ds) console.log(`      | ${d} x${c}`);
  }
}

const injected = recs.filter(r => r.fault);
if (injected.length) {
  const modeName = { P: "pre", Q: "post", M: "mangle", D: "delay" } as const;
  console.log(`\n${injected.length} injected faults:`);
  for (const r of injected)
    console.log(
      `  seq ${r.seq} tid ${r.tid} ${nameOf(r.sys)} -> ${statusName(r.status)} ` +
        `(${modeName[r.fault as "P" | "Q" | "M" | "D"]}) at bun+0x${r.rva}`,
    );
}

// --- module census -----------------------------------------------------------
if (symExe) {
  const syms = await symbolize(symExe, recs.flatMap(r => r.rvas));
  type MAgg = { count: number; syscalls: Map<number, number>; callsites: Set<string>; syms: Map<string, number> };
  const byMod = new Map<string, MAgg>();
  for (const r of recs) {
    if (r.rva === "0") continue;
    const mod = moduleOf(r, syms);
    let a = byMod.get(mod);
    if (!a) byMod.set(mod, (a = { count: 0, syscalls: new Map(), callsites: new Set(), syms: new Map() }));
    a.count++;
    a.syscalls.set(r.sys, (a.syscalls.get(r.sys) ?? 0) + 1);
    a.callsites.add(r.rva);
    const s = syms.get(r.rva)?.sym.replace(/\+0x[0-9a-f]+$/, "") ?? "?";
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
