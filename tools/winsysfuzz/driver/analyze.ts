// Reads a wsf trace log and prints a human summary: syscalls by name with
// counts and status breakdown, distinct callsites, injected faults.
//
//   bun driver/analyze.ts <log> [--callsites] [--status]
//
// The (syscall, callsite, hit-index) census this produces is the input the
// fault scheduler enumerates.

import { dirname, join } from "node:path";

const here = dirname(import.meta.path);
const manifest: { id: number; name: string; category: string }[] = await Bun.file(
  join(here, "generated", "syscalls.gen.json"),
).json();
const nameOf = (id: number) => manifest[id]?.name ?? `sys#${id}`;

const args = process.argv.slice(2);
const logPath = args.find(a => !a.startsWith("--"));
if (!logPath) {
  console.error("usage: analyze.ts <log> [--callsites] [--status]");
  process.exit(2);
}
const showCallsites = args.includes("--callsites");
const showStatus = args.includes("--status");

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
  rva: string;
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
    recs.push({
      seq: +p[1],
      tid: +p[2],
      sys: +p[3],
      status: p[4],
      rva: p[5],
      frame0: p[6],
      fault: p[7] === "!P" ? "P" : p[7] === "!Q" ? "Q" : "",
      entryOnly: false,
    });
  } else if (p[0] === "E") {
    recs.push({ seq: +p[1], tid: +p[2], sys: +p[3], status: "", rva: p[4], frame0: p[5], fault: "", entryOnly: true });
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
