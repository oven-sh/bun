// The fuzzer's main loop: deterministic fault-schedule sweep.
//
//   bun driver/sweep.ts --bun <bun.exe> --program <file.js> [args...]
//     [--timeout 30] [--jobs 6] [--hits 1] [--modules a,b] [--syscalls a,b]
//     [--work C:\wsfsweep] [--out sweep-report.json]
//
// 1. Baseline: run the program under trace. Every distinct
//    (syscall, callsite) coordinate it produces is a fault site.
// 2. For each injectable coordinate x realistic failure status x hit
//    index, re-run the program with exactly that fault scheduled.
// 3. Classify each outcome against the baseline: identical / diverged /
//    error-exit / CRASH / HANG, and confirm the fault actually fired.
//
// CRASH and HANG are the bugs. Everything is deterministic: the coordinate
// (syscall + callsite RVA + hit) plus the program replays the finding.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { classifySym, moduleOf, nameOf, parseTrace, readTrace, replayCoordinate, runOnce, statusName, symbolize } from "./lib";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const bun = flag("--bun");
const progIdx = argv.indexOf("--program");
if (!bun || progIdx < 0) {
  console.error("usage: sweep.ts --bun <bun.exe> --program <file.js> [args...] [options]");
  process.exit(2);
}
// program args = everything after --program up to the next --flag
const progArgs: string[] = [];
for (let i = progIdx + 1; i < argv.length && !argv[i].startsWith("--"); i++) progArgs.push(argv[i]);
const timeoutMs = 1000 * +(flag("--timeout", "30") as string);
const jobs = Math.max(1, +(flag("--jobs", "6") as string));
const maxHits = Math.max(1, +(flag("--hits", "1") as string));
const modFilter = flag("--modules")?.split(",");
const sysFilter = flag("--syscalls")?.split(",");
const workRoot = flag("--work", "C:\\wsfsweep") as string;
const outPath = flag("--out", join(workRoot, "sweep-report.json")) as string;
const planOnly = argv.includes("--plan-only"); // baseline + estimate, then stop

// Injectable syscalls with realistic failure statuses. Being IN this table is
// what makes a syscall a fault site — waits/scheduling/query-loops are
// deliberately absent. mode 'post' = the call succeeds but reports failure.
//
// expect = the severity model for a CRASH under this fault:
//   must-handle    — I/O the app must survive (fs/net/pipe/spawn); a crash
//                    or hang here is a real bug candidate. Sorts first.
//   abort-expected — allocator failure; crash-on-OOM is by design (WebKit
//                    CRASH(), Rust alloc abort). A crash here is expected.
//   judgment       — lying-API (post-mode) / edge cases where "correct"
//                    behavior is a human call.
type Mode = "pre" | "post" | "mangle:short" | "mangle:zero";
type Fault = { status: string; mode: Mode; expect?: "must-handle" | "abort-expected" | "judgment" };
const F = (status: string, mode: Mode = "pre", expect: Fault["expect"] = "must-handle"): Fault => ({
  status,
  mode,
  expect,
});
// mangle:* faults model the misbehaving filter driver: the syscall really
// succeeds but its IO_STATUS_BLOCK.Information is perturbed (short / zero
// bytes). bun must honor the count it is handed, so these are must-handle.
const FAULTS: Record<string, Fault[]> = {
  NtCreateFile: [F("C0000034"), F("C0000022"), F("C0000043")],
  NtOpenFile: [F("C0000034"), F("C0000022")],
  NtReadFile: [F("C0000185"), F("C0000185", "post", "judgment"), F("0", "mangle:short"), F("0", "mangle:zero")],
  NtWriteFile: [F("C000007F"), F("C000007F", "post", "judgment"), F("0", "mangle:short")],
  NtQueryInformationFile: [F("C0000185")],
  NtSetInformationFile: [F("C0000022")],
  NtQueryDirectoryFile: [F("C0000185"), F("0", "mangle:short")],
  NtQueryDirectoryFileEx: [F("C0000185"), F("0", "mangle:short")],
  NtQueryVolumeInformationFile: [F("C0000185")],
  NtQueryAttributesFile: [F("C0000034")],
  NtQueryFullAttributesFile: [F("C0000034")],
  NtDeleteFile: [F("C0000022")],
  NtFsControlFile: [F("C000009A")],
  NtCreateNamedPipeFile: [F("C000009A")],
  NtDeviceIoControlFile: [F("C000009A"), F("C000009A", "post", "judgment"), F("0", "mangle:short")],
  NtCreateEvent: [F("C000009A")],
  NtCreateSection: [F("C000009A")],
  NtMapViewOfSection: [F("C000009A")],
  NtCreateThreadEx: [F("C000009A")],
  NtCreateUserProcess: [F("C0000022")],
  NtCreateJobObject: [F("C000009A")],
  NtAssignProcessToJobObject: [F("C0000022")],
  NtCreateIoCompletion: [F("C000009A")],
  NtRemoveIoCompletion: [F("C0000185", "post", "judgment")],
  NtRemoveIoCompletionEx: [F("C0000185", "post", "judgment")],
  NtAssociateWaitCompletionPacket: [F("C000009A")],
  NtQueryValueKey: [F("C0000034")],
  NtOpenKeyEx: [F("C0000034")],
  NtClose: [F("C0000008", "post", "judgment")],
  NtDuplicateObject: [F("C000009A")],
  NtAllocateVirtualMemory: [F("C0000017", "pre", "abort-expected")],
  NtAllocateVirtualMemoryEx: [F("C0000017", "pre", "abort-expected")],
};

const runsDir = join(workRoot, "runs");
mkdirSync(runsDir, { recursive: true });

// --- baseline -----------------------------------------------------------------
console.log(`baseline: ${bun} ${progArgs.join(" ")}`);
const base = await runOnce({
  bun,
  args: progArgs,
  workDir: join(runsDir, "baseline"),
  timeoutMs,
});
console.log(`  outcome=${base.outcome} exit=${base.exitCode} ${base.ms}ms`);
if (base.outcome !== "exit") {
  console.error("baseline did not exit cleanly; refusing to sweep a hanging baseline");
  process.exit(1);
}
const baseTrace = await readTrace(base.logPath);
if (!baseTrace) {
  console.error("no baseline trace produced");
  process.exit(1);
}

// --- coordinates --------------------------------------------------------------
interface Coord {
  key: string;
  sys: number;
  sysName: string;
  rva: string;
  hits: number;
  repRvas: string[];
}
const coords = new Map<string, Coord>();
for (const r of baseTrace.recs) {
  if (r.entryOnly || r.rva === "0") continue;
  const sysName = nameOf(r.sys);
  if (!(sysName in FAULTS)) continue;
  if (sysFilter && !sysFilter.includes(sysName)) continue;
  const key = `${r.sys}:${r.rva}`;
  const c = coords.get(key);
  if (c) c.hits++;
  else coords.set(key, { key, sys: r.sys, sysName, rva: r.rva, hits: 1, repRvas: r.rvas });
}

const syms = await symbolize(bun, [...coords.values()].flatMap(c => c.repRvas));
const coordModule = (c: Coord) => moduleOf({ rvas: c.repRvas } as any, syms);
const symText = (rva: string) => syms.get(rva)?.sym ?? "?";

let candidates = [...coords.values()];
if (modFilter) candidates = candidates.filter(c => modFilter.includes(coordModule(c)));

// Plan: coordinate x statuses x hit indexes.
interface Job {
  id: number;
  coord: Coord;
  status: string;
  mode: Mode;
  expect: NonNullable<Fault["expect"]>;
  hit: number;
}
const plan: Job[] = [];
for (const c of candidates)
  for (const f of FAULTS[c.sysName])
    for (let hit = 1; hit <= Math.min(c.hits, maxHits); hit++)
      plan.push({ id: plan.length, coord: c, status: f.status, mode: f.mode, expect: f.expect ?? "must-handle", hit });

const estSec = Math.round(((plan.length * base.ms) / jobs / 1000) * 1.3);
console.log(
  `\n${coords.size} injectable coordinates from ${baseTrace.recs.length} baseline records; ` +
    `${plan.length} injection runs planned across ${jobs} workers (~${estSec}s est).\n`,
);
if (planOnly) {
  const byMod = new Map<string, number>();
  for (const c of candidates) byMod.set(coordModule(c), (byMod.get(coordModule(c)) ?? 0) + 1);
  console.log("coordinates by module: " + [...byMod.entries()].map(([m, n]) => `${m}=${n}`).join(" "));
  console.log("(--plan-only: not sweeping)");
  process.exit(0);
}
if (plan.length === 0) process.exit(0);

// --- execute -------------------------------------------------------------------
interface Result {
  job: Job;
  outcome: string; // clean | diverged | error-exit | CRASH | HANG | no-fire
  exitCode: number | null;
  fired: number;
  ms: number;
  stdoutDiffers: boolean;
}
const results: Result[] = [];
let next = 0;
// Append each result the moment it lands so a long sweep is watchable
// (tail the file) and survives an interrupt with everything so far.
const liveLog = join(workRoot, "sweep-progress.jsonl");
await Bun.write(liveLog, "");
const liveWriter = Bun.file(liveLog).writer();

async function worker(w: number) {
  while (true) {
    const idx = next++;
    if (idx >= plan.length) return;
    const job = plan[idx];
    const dir = join(runsDir, `w${w}`);
    const sched = join(runsDir, `sched-w${w}.txt`);
    await Bun.write(sched, `${job.coord.sysName} ${job.coord.rva} ${job.hit} ${job.mode} ${job.status}\n`);
    const rr = await runOnce({ bun, args: progArgs, workDir: dir, timeoutMs, schedule: sched });
    const tr = await readTrace(rr.logPath);
    const fired = tr ? tr.recs.filter(r => r.fault).length : 0;

    let outcome: string;
    if (rr.outcome === "hang") outcome = "HANG";
    else if (rr.crash) outcome = job.expect === "abort-expected" ? "expected-abort" : "CRASH";
    else if (fired === 0) outcome = "no-fire";
    else if (rr.ms >= 8000) outcome = "slow";
    else if (rr.exitCode !== base.exitCode) outcome = "error-exit";
    else if (rr.stdout !== base.stdout) outcome = "diverged";
    else outcome = "clean";

    const res: Result = { job, outcome, exitCode: rr.exitCode, fired, ms: rr.ms, stdoutDiffers: rr.stdout !== base.stdout };
    results.push(res);
    liveWriter.write(
      JSON.stringify({
        n: results.length,
        of: plan.length,
        outcome,
        syscall: job.coord.sysName,
        rva: job.coord.rva,
        mode: job.mode,
        status: job.status,
        hit: job.hit,
        exit: rr.exitCode,
        fired,
        ms: rr.ms,
      }) + "\n",
    );
    liveWriter.flush();
    const mark = outcome === "CRASH" || outcome === "HANG" ? "!!" : "  ";
    console.log(
      `${mark} [${String(results.length).padStart(4)}/${plan.length}] ${outcome.padEnd(10)} ` +
        `${job.coord.sysName} ${job.mode} ${job.status} hit${job.hit} @${job.coord.rva} ` +
        `(${coordModule(job.coord)}) exit=${rr.exitCode} fired=${fired} ${rr.ms}ms`,
    );
  }
}
const t0 = performance.now();
await Promise.all(Array.from({ length: jobs }, (_, w) => worker(w)));
liveWriter.end();

// --- report ----------------------------------------------------------------------
const rank: Record<string, number> = {
  HANG: 0,
  CRASH: 1,
  slow: 2,
  "expected-abort": 3,
  "error-exit": 4,
  diverged: 5,
  "no-fire": 6,
  clean: 7,
};
results.sort((a, b) => rank[a.outcome] - rank[b.outcome]);
const counts = new Map<string, number>();
for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);

console.log(`\n=== sweep done in ${Math.round((performance.now() - t0) / 1000)}s: ${results.length} runs ===`);
for (const k of ["HANG", "CRASH", "slow", "expected-abort", "error-exit", "diverged", "no-fire", "clean"])
  if (counts.has(k)) console.log(`  ${k.padEnd(15)} ${counts.get(k)}`);

const findings = results.filter(r => r.outcome === "CRASH" || r.outcome === "HANG");

// --- auto-verify: no false positives ------------------------------------------
// A HANG or CRASH observed during the parallel sweep may be load-induced (a
// slow-but-correct path pushed past the watchdog by contention). Replay each
// finding STANDALONE, sequentially, at DOUBLE the timeout, before believing it:
//   confirmed       - reproduces standalone (a real, replayable finding)
//   slow            - finishes given more time: a real slowness symptom, but
//                     not the infinite hang the sweep's watchdog implied
//   load-dependent  - only bad under sweep load; may still be a timing bug,
//                     but it is NOT the deterministic finding it looked like
//   not-reproduced  - did not fire / recur; likely a nondeterministic callsite
type Verdict = "confirmed" | "slow" | "load-dependent" | "not-reproduced";
const verdicts = new Map<Result, { verdict: Verdict; outcomes: string[] }>();
if (findings.length) {
  console.log(`\n=== verifying ${findings.length} finding(s) standalone (x3, ${(2 * timeoutMs) / 1000}s timeout) ===`);
  for (const f of findings) {
    const sched = `${f.job.coord.sysName} ${f.job.coord.rva} ${f.job.hit} ${f.job.mode} ${f.job.status}`;
    const outcomes: string[] = [];
    for (let n = 1; n <= 3; n++) {
      const rr = await replayCoordinate({
        bun,
        args: progArgs,
        schedule: sched,
        dir: join(workRoot, "verify", `${f.job.coord.sys}-${f.job.coord.rva}-${n}`),
        timeoutMs: 2 * timeoutMs,
        capture: false,
      });
      outcomes.push(rr.outcome);
    }
    const bad = outcomes.filter(o => o === "CRASH" || o === "HANG").length;
    const slow = outcomes.filter(o => o === "slow").length;
    const fired = outcomes.filter(o => o !== "no-fire").length;
    const verdict: Verdict =
      bad >= 2 ? "confirmed" : bad === 0 && slow >= 2 ? "slow" : bad === 0 && fired > 0 ? "load-dependent" : "not-reproduced";
    verdicts.set(f, { verdict, outcomes });
    console.log(`  ${verdict.padEnd(15)} ${f.outcome} ${f.job.coord.sysName} @${f.job.coord.rva} standalone: ${outcomes.join(",")}`);
  }
}

if (findings.length) {
  console.log(`\nFINDINGS (${findings.length}):`);
  for (const r of findings) {
    const v = verdicts.get(r);
    console.log(
      `  [${v?.verdict ?? "?"}] ${r.outcome} ${r.job.coord.sysName} ${r.job.mode} ` +
        `${statusName(r.job.status.toLowerCase())} hit${r.job.hit} @${r.job.coord.rva} = ` +
        `${symText(r.job.coord.rva)} [${coordModule(r.job.coord)}] ` +
        `standalone=${v?.outcomes.join(",") ?? "-"}`,
    );
  }
}

await Bun.write(
  outPath,
  JSON.stringify(
    {
      bun,
      program: progArgs,
      baseline: { exit: base.exitCode, ms: base.ms },
      results: results.map(r => ({
        outcome: r.outcome,
        verdict: verdicts.get(r)?.verdict ?? null,
        standalone: verdicts.get(r)?.outcomes ?? null,
        expect: r.job.expect,
        syscall: r.job.coord.sysName,
        rva: r.job.coord.rva,
        symbol: symText(r.job.coord.rva),
        module: coordModule(r.job.coord),
        status: r.job.status,
        mode: r.job.mode,
        hit: r.job.hit,
        exit: r.exitCode,
        fired: r.fired,
        ms: r.ms,
        stdoutDiffers: r.stdoutDiffers,
        schedule: `${r.job.coord.sysName} ${r.job.coord.rva} ${r.job.hit} ${r.job.mode} ${r.job.status}`,
      })),
    },
    null,
    1,
  ),
);
console.log(`\nreport: ${outPath}`);
