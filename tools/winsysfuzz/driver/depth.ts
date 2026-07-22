// Injection-depth check: HOW FAR into the program do our faults land?
// The default plan faults hit #1 of each (syscall, callsite) coordinate;
// if most first-hits sit inside process startup, the sweep spends its
// budget making bun exit early instead of faulting the program's meat.
//
//   bun driver/depth.ts <baseline-run-dir>
//
// For every injectable coordinate: the position (percentile of the whole
// syscall trace) of its FIRST hit vs its LAST hit. First-hit-early +
// last-hit-late = a call site alive throughout (deep hits available);
// first==last==early = pure startup infrastructure.

import { nameOf, readTraceDir } from "./lib";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: depth.ts <run-dir with wsf-*.log>");
  process.exit(2);
}
const trace = await readTraceDir(dir);
if (!trace || !trace.recs.length) {
  console.error("no records");
  process.exit(1);
}
const recs = trace.recs.filter(r => !r.entryOnly);
const total = recs.length;

// The same table sweep.ts injects (keep in sync with FAULTS keys).
const injectable = new Set([
  "NtCreateFile", "NtOpenFile", "NtReadFile", "NtWriteFile", "NtQueryInformationFile",
  "NtSetInformationFile", "NtQueryDirectoryFile", "NtQueryDirectoryFileEx",
  "NtQueryVolumeInformationFile", "NtQueryAttributesFile", "NtQueryFullAttributesFile",
  "NtDeleteFile", "NtFsControlFile", "NtCreateNamedPipeFile", "NtDeviceIoControlFile",
  "NtCreateEvent", "NtCreateSection", "NtMapViewOfSection", "NtCreateThreadEx",
  "NtCreateUserProcess", "NtCreateJobObject", "NtAssignProcessToJobObject",
  "NtCreateIoCompletion", "NtRemoveIoCompletion", "NtRemoveIoCompletionEx",
  "NtAssociateWaitCompletionPacket", "NtQueryValueKey", "NtOpenKeyEx", "NtClose",
  "NtDuplicateObject", "NtAllocateVirtualMemory", "NtAllocateVirtualMemoryEx",
]);

type C = { first: number; last: number; hits: number; sys: string };
const coords = new Map<string, C>();
recs.forEach((r, i) => {
  const sys = nameOf(r.sys);
  if (!injectable.has(sys)) return;
  const id = `${sys}:${r.key}`;
  const c = coords.get(id);
  if (!c) coords.set(id, { first: i, last: i, hits: 1, sys });
  else {
    c.last = i;
    c.hits++;
  }
});

const pct = (i: number) => Math.round((100 * i) / total);
const bucket = (p: number) => (p < 5 ? "0-5%" : p < 20 ? "5-20%" : p < 50 ? "20-50%" : "50-100%");
const firstDist = new Map<string, number>();
let deepAvailable = 0; // coords whose LAST hit is past 20% (deep hits exist)
let startupOnly = 0; // coords entirely inside first 5%
for (const c of coords.values()) {
  const b = bucket(pct(c.first));
  firstDist.set(b, (firstDist.get(b) ?? 0) + 1);
  if (pct(c.last) >= 20) deepAvailable++;
  if (pct(c.last) < 5) startupOnly++;
}

console.log(`${total} syscall records, ${coords.size} injectable coordinates\n`);
console.log("where does hit #1 land (fraction of the trace)?");
for (const b of ["0-5%", "5-20%", "20-50%", "50-100%"])
  console.log(`  ${b.padEnd(8)} ${String(firstDist.get(b) ?? 0).padStart(4)} coords`);
console.log(`\ncoords whose EVERY hit is in the first 5% (pure startup): ${startupOnly}`);
console.log(`coords with hits past the 20% mark (deep hits available):    ${deepAvailable}`);
