// Scenario coverage census: run every workload under trace and report what
// each contributes to the fault space, and what the suite as a whole can't
// reach yet.
//
//   bun driver/coverage.ts --bun <bun.exe> [--workloads dir] [--timeout 60]
//
// Per scenario: baseline health under interception (a nonzero exit or hang
// here is an INTERCEPTOR or workload problem, not a bun bug), record and
// thread counts, distinct syscalls, module reach, and its distinct
// injectable (syscall, callsite) coordinates. Then the union: which
// injectable syscalls the suite covers, and which none of it reaches — the
// gap list that says what scenario to add next.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { moduleOf, nameOf, readTrace, runOnce, stamp, symbolize } from "./lib";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const bun = flag("--bun");
if (!bun) {
  console.error("usage: coverage.ts --bun <bun.exe> [--workloads dir] [--timeout 60]");
  process.exit(2);
}
const workloadsDir = flag("--workloads", join(import.meta.dir, "..", "workloads")) as string;
const timeoutMs = 1000 * +(flag("--timeout", "60") as string);
const workRoot = join(flag("--work", "C:\\wsfcov") as string, stamp); // never-reused root; nothing deleted

// Keep this list in sync with the FAULTS table in sweep.ts: it defines
// which syscalls are fault sites, i.e. what "coverage" means.
const INJECTABLE = new Set([
  "NtCreateFile", "NtOpenFile", "NtReadFile", "NtWriteFile", "NtQueryInformationFile", "NtSetInformationFile",
  "NtQueryDirectoryFile", "NtQueryDirectoryFileEx", "NtQueryVolumeInformationFile", "NtQueryAttributesFile",
  "NtQueryFullAttributesFile", "NtDeleteFile", "NtFsControlFile", "NtCreateNamedPipeFile", "NtDeviceIoControlFile",
  "NtCreateEvent", "NtCreateSection", "NtMapViewOfSection", "NtCreateThreadEx", "NtCreateUserProcess",
  "NtCreateJobObject", "NtAssignProcessToJobObject", "NtCreateIoCompletion", "NtRemoveIoCompletion",
  "NtRemoveIoCompletionEx", "NtAssociateWaitCompletionPacket", "NtQueryValueKey", "NtOpenKeyEx", "NtClose",
  "NtDuplicateObject", "NtAllocateVirtualMemory", "NtAllocateVirtualMemoryEx",
]);

const files = readdirSync(workloadsDir).filter(f => f.endsWith(".js")).sort();
if (!files.length) {
  console.error(`no workloads in ${workloadsDir}`);
  process.exit(1);
}
console.log(`coverage census: ${files.length} scenarios, bun=${bun}\n`);

interface Row {
  scenario: string;
  health: string;
  ms: number;
  records: number;
  threads: number;
  syscalls: Set<string>;
  modules: Map<string, number>;
  coords: Set<string>; // "SysName:rva"
}
const rows: Row[] = [];

for (const f of files) {
  const scenario = f.replace(/\.js$/, "");
  const rr = await runOnce({
    bun,
    args: [join(workloadsDir, f)],
    workDir: join(workRoot, scenario),
    timeoutMs,
  });
  const trace = await readTrace(rr.logPath);
  let health = "ok";
  if (rr.outcome === "hang") health = "BASELINE-HANG";
  else if (rr.crash) health = "BASELINE-CRASH";
  else if (rr.exitCode !== 0) health = `exit=${rr.exitCode}`;
  if (!trace) health += " NO-TRACE";
  const row: Row = {
    scenario,
    health,
    ms: rr.ms,
    records: trace?.recs.length ?? 0,
    threads: new Set(trace?.recs.map(r => r.tid) ?? []).size,
    syscalls: new Set(),
    modules: new Map(),
    coords: new Set(),
  };
  if (trace) {
    const rvas = trace.recs.flatMap(r => r.rvas);
    const syms = await symbolize(bun, rvas);
    for (const r of trace.recs) {
      const name = nameOf(r.sys);
      row.syscalls.add(name);
      if (r.rva !== "0") {
        const m = moduleOf(r, syms);
        row.modules.set(m, (row.modules.get(m) ?? 0) + 1);
        if (INJECTABLE.has(name)) row.coords.add(`${name}:${r.rva}`);
      }
    }
  }
  rows.push(row);
  const stdoutTail = rr.stdout.trim().split("\n").pop()?.slice(0, 100) ?? "";
  console.log(
    `${scenario.padEnd(20)} ${health.padEnd(16)} ${String(rr.ms).padStart(6)}ms ` +
      `${String(row.records).padStart(6)} rec ${String(row.threads).padStart(2)} thr ` +
      `${String(row.syscalls.size).padStart(3)} syscalls ${String(row.coords.size).padStart(4)} coords`,
  );
  console.log(`    ${stdoutTail}`);
  const mods = [...row.modules.entries()].sort((a, b) => b[1] - a[1]).map(([m, c]) => `${m}=${c}`);
  console.log(`    modules: ${mods.join(" ")}`);
}

// --- suite-wide union ------------------------------------------------------------
const covered = new Map<string, Set<string>>(); // injectable syscall -> scenarios
for (const row of rows)
  for (const coord of row.coords) {
    const name = coord.split(":")[0];
    if (!covered.has(name)) covered.set(name, new Set());
    covered.get(name)!.add(row.scenario);
  }
const totalCoords = new Set(rows.flatMap(r => [...r.coords])).size;
console.log(`\n=== suite fault-space: ${totalCoords} distinct injectable coordinates ===`);
console.log(`covered injectable syscalls (${covered.size}/${INJECTABLE.size}):`);
for (const [name, scenarios] of [...covered.entries()].sort((a, b) => b[1].size - a[1].size))
  console.log(`  ${name.padEnd(30)} <- ${[...scenarios].join(", ")}`);

const uncovered = [...INJECTABLE].filter(n => !covered.has(n));
console.log(`\nNOT reached by any scenario (${uncovered.length}) — the gap list:`);
for (const n of uncovered) console.log(`  ${n}`);

const unhealthy = rows.filter(r => r.health !== "ok");
if (unhealthy.length) {
  console.log(`\nBASELINE ISSUES (interceptor or workload defects — fix before hunting):`);
  for (const r of unhealthy) console.log(`  ${r.scenario}: ${r.health}`);
}
process.exit(unhealthy.some(r => r.health.startsWith("BASELINE")) ? 1 : 0);
