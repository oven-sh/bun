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

import { basename, join } from "node:path";
import {
  classifySym,
  digestStacks,
  ensureDir,
  lastStage,
  moduleOf,
  nameOf,
  parseTrace,
  readTraceDir,
  replayCoordinate,
  runOnce,
  stamp,
  statusName,
  symbolize,
} from "./lib";

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
// Never-reused timestamped root: nothing is ever deleted; old sweeps accumulate.
const workRoot = join(flag("--work", "C:\\wsfsweep") as string, stamp);
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
type Mode = "pre" | "post" | "mangle:short" | "mangle:zero" | "delay";
type Fault = { status: string; mode: Mode; expect?: "must-handle" | "abort-expected" | "judgment" };
const F = (status: string, mode: Mode = "pre", expect: Fault["expect"] = "must-handle"): Fault => ({
  status,
  mode,
  expect,
});
// mangle:* faults model the misbehaving filter driver: the syscall really
// succeeds but its IO_STATUS_BLOCK.Information is perturbed (short / zero
// bytes). bun must honor the count it is handed, so these are must-handle.
// delay faults keep the real status but pause first (status field = ms):
// a deterministic interleaving shift at one coordinate - completion
// dequeue vs. other threads, a widened race window. A HANG from a delay is
// a real timing bug; classed 'judgment' since the human decides plausibility.
const DELAY_MS = "250";
const FAULTS: Record<string, Fault[]> = {
  NtCreateFile: [F("C0000034"), F("C0000022"), F("C0000043")],
  NtOpenFile: [F("C0000034"), F("C0000022")],
  NtReadFile: [F("C0000185"), F("C0000185", "post", "judgment"), F("0", "mangle:short"), F("0", "mangle:zero")],
  NtWriteFile: [
    F("C000007F"),
    F("C000007F", "post", "judgment"),
    F("0", "mangle:short"),
    F(DELAY_MS, "delay", "judgment"),
  ],
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
  NtDeviceIoControlFile: [
    F("C000009A"),
    F("C000009A", "post", "judgment"),
    F("0", "mangle:short"),
    F(DELAY_MS, "delay", "judgment"),
  ],
  NtCreateEvent: [F("C000009A")],
  NtCreateSection: [F("C000009A")],
  NtMapViewOfSection: [F("C000009A")],
  NtCreateThreadEx: [F("C000009A")],
  NtCreateUserProcess: [F("C0000022")],
  NtCreateJobObject: [F("C000009A")],
  NtAssignProcessToJobObject: [F("C0000022")],
  NtCreateIoCompletion: [F("C000009A")],
  NtRemoveIoCompletion: [F("C0000185", "post", "judgment")],
  // Delaying the IOCP dequeue reorders completions against other threads:
  // the completion-side lever (completion-after-close, cancel racing
  // completion).
  NtRemoveIoCompletionEx: [F("C0000185", "post", "judgment"), F(DELAY_MS, "delay", "judgment")],
  NtAssociateWaitCompletionPacket: [F("C000009A")],
  NtQueryValueKey: [F("C0000034")],
  NtOpenKeyEx: [F("C0000034")],
  NtClose: [F("C0000008", "post", "judgment")],
  NtDuplicateObject: [F("C000009A")],
  NtAllocateVirtualMemory: [F("C0000017", "pre", "abort-expected")],
  NtAllocateVirtualMemoryEx: [F("C0000017", "pre", "abort-expected")],
};

const runsDir = join(workRoot, "runs");
ensureDir(runsDir);

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
const baseTrace = await readTraceDir(base.dir);
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
// The frame to NAME a fault site by: the first candidate frame belonging to
// the coordinate's owning module. The nearest scraped frame (the schedule
// key) can be an unrelated stack leftover (a mimalloc frame in front of a
// libuv call); the owner frame is stable and meaningful. Key kept for replay.
const ownerFrame = (c: Coord): string => {
  const mod = coordModule(c);
  for (const rva of c.repRvas) if (classifySym(syms.get(rva)) === mod) return `${symText(rva)} (bun+0x${rva})`;
  return `${symText(c.rva)} (bun+0x${c.rva})`;
};

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
// Load-health controls: every CONTROL_EVERY jobs a worker also runs the
// program with NO fault. If those unfaulted controls creep toward the
// watchdog, the box was saturated during the sweep and every HANG in that
// window is suspect - measured, not guessed after the fact.
const CONTROL_EVERY = 25;
const controls: { ms: number; outcome: string; exitCode: number | null }[] = [];
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
    if (idx > 0 && idx % CONTROL_EVERY === 0) {
      // Ambient-load probe: same program, no fault, under current contention.
      const ctlDir = join(runsDir, `control${String(idx).padStart(4, "0")}`);
      ensureDir(ctlDir);
      const ctl = await runOnce({ bun, args: progArgs, workDir: ctlDir, timeoutMs });
      controls.push({ ms: ctl.ms, outcome: ctl.outcome, exitCode: ctl.exitCode });
    }
    // Unique dir per job (never reused) - no stale trace can be misread.
    const dir = join(runsDir, `job${String(job.id).padStart(4, "0")}`);
    ensureDir(dir);
    const sched = join(dir, "schedule.txt");
    await Bun.write(sched, `${job.coord.sysName} ${job.coord.rva} ${job.hit} ${job.mode} ${job.status}\n`);
    const rr = await runOnce({ bun, args: progArgs, workDir: dir, timeoutMs, schedule: sched });
    const tr = await readTraceDir(rr.dir);
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
interface Verify {
  verdict: Verdict;
  outcomes: string[];
  stage: string | null; // last STAGE marker the program printed
  stacks: string[]; // digested thread stacks (hangs) or crash frames
}
const verdicts = new Map<Result, Verify>();
if (findings.length) {
  console.log(`\n=== verifying ${findings.length} finding(s) standalone (x3, ${(2 * timeoutMs) / 1000}s timeout) ===`);
  for (const f of findings) {
    const sched = `${f.job.coord.sysName} ${f.job.coord.rva} ${f.job.hit} ${f.job.mode} ${f.job.status}`;
    const outcomes: string[] = [];
    let stage: string | null = null;
    let stacks: string[] = [];
    for (let n = 1; n <= 3; n++) {
      const rr = await replayCoordinate({
        bun,
        args: progArgs,
        schedule: sched,
        dir: join(workRoot, "verify", `${f.job.coord.sys}-${f.job.coord.rva}-${n}`),
        timeoutMs: 2 * timeoutMs,
        // Capture WHERE it is stuck (hang stacks / crash stack) on the
        // first replay: the single most useful fact about a finding.
        capture: n === 1,
      });
      outcomes.push(rr.outcome);
      if (n === 1) {
        stage = lastStage(rr.stdout);
        const raw = rr.hangStacks ?? rr.crashDump ?? "";
        stacks = raw ? digestStacks(raw) : [];
      }
    }
    const bad = outcomes.filter(o => o === "CRASH" || o === "HANG").length;
    const slow = outcomes.filter(o => o === "slow").length;
    const fired = outcomes.filter(o => o !== "no-fire").length;
    // "crawls twice, hangs once" is bad EVERY time (borderline on the
    // watchdog), so slow counts toward confirmation once any replay hangs.
    const verdict: Verdict =
      bad >= 2 || (bad >= 1 && bad + slow >= 2)
        ? "confirmed"
        : bad === 0 && slow >= 2
          ? "slow"
          : bad === 0 && fired > 0
            ? "load-dependent"
            : "not-reproduced";
    verdicts.set(f, { verdict, outcomes, stage, stacks });
    console.log(
      `  ${verdict.padEnd(15)} ${f.outcome} ${f.job.coord.sysName} @${f.job.coord.rva} ` +
        `standalone: ${outcomes.join(",")}` +
        (stage ? ` | last stage: ${stage}` : ""),
    );
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

// --- findings.md: the one file a hunter opens ---------------------------------
// A card per finding, richest facts first: what fault, where the process is
// stuck (digested stacks), how far the program got (last stage), and how to
// replay it. Slow-near-watchdog runs get their own note: they usually share
// a cause with a sibling HANG (an internal ~timeout path).
{
  const md: string[] = [];
  const rel = (ms: number) => (ms >= timeoutMs * 0.8 ? " **(near watchdog: likely an internal timeout/retry path)**" : "");
  // Name the target by its file: for `test <file>` that's the file, not "test".
  const targetFile = progArgs[0] === "test" ? progArgs[progArgs.length - 1] : progArgs[0];
  md.push(`# winsysfuzz findings: ${basename(targetFile ?? "program")}`);
  md.push("");
  md.push(`- program: \`${progArgs.join(" ")}\``);
  md.push(`- ${results.length} runs; outcomes: ${[...counts.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  md.push(`- baseline exit=${base.exitCode} in ${base.ms}ms; watchdog ${timeoutMs / 1000}s (verify at ${(2 * timeoutMs) / 1000}s)`);
  // Load-health during the sweep, measured by the interleaved no-fault
  // controls. A degraded control means the box was saturated at some point:
  // HANGs are then suspect and every 'load-dependent' verdict doubly so.
  if (controls.length) {
    const worst = Math.max(...controls.map(c => c.ms));
    const degraded = controls.filter(c => c.outcome === "hang" || c.ms >= timeoutMs * 0.7).length;
    md.push(
      `- **load health**: ${controls.length} no-fault control run(s) during the sweep; worst ${worst}ms ` +
        `(baseline ${base.ms}ms), ${degraded} degraded` +
        (degraded
          ? ` -> **the box saturated during this sweep: treat HANG timings and load-dependent verdicts with suspicion**`
          : ` -> box stayed healthy; timings are trustworthy`),
    );
  }
  md.push("");
  if (!findings.length) md.push("No CRASH/HANG findings in this sweep.");
  // Cards ordered by what to chase first: confirmed, then slow, then the
  // load-dependent / not-reproduced tail.
  const vrank: Record<string, number> = { confirmed: 0, slow: 1, "load-dependent": 2, "not-reproduced": 3 };
  const sortedFindings = [...findings].sort(
    (a, b) => (vrank[verdicts.get(a)?.verdict ?? ""] ?? 9) - (vrank[verdicts.get(b)?.verdict ?? ""] ?? 9),
  );
  for (const f of sortedFindings) {
    const v = verdicts.get(f);
    md.push(`## [${v?.verdict ?? "?"}] ${f.outcome} - ${f.job.coord.sysName} (${f.job.mode} ${f.job.status}) [${f.job.expect}]`);
    md.push(`- **where the fault fired**: \`${ownerFrame(f.job.coord)}\` [${coordModule(f.job.coord)}]`);
    // The scraped nearest frame can be an unrelated stack leftover (a
    // mimalloc/CRT frame in front of a threadpool call), so show the
    // distinct candidate frames too rather than betting on one.
    const cands = [...new Set(f.job.coord.repRvas.map(r => symText(r)))].slice(0, 4);
    if (cands.length > 1) md.push(`- **candidate frames** (nearest first): ${cands.map(c => `\`${c}\``).join(" ; ")}`);
    md.push(`- **standalone replays**: ${v?.outcomes.join(", ") ?? "-"}`);
    // Status differential: how did OTHER faults at this same coordinate turn
    // out? "one status hangs while its siblings finish at ~30s" is the clue
    // that an error path exists but doesn't cover this status.
    const siblings = results.filter(
      r => r.job.coord.key === f.job.coord.key && r !== f && r.outcome !== "no-fire",
    );
    if (siblings.length)
      md.push(
        `- **same callsite, other faults**: ` +
          siblings.map(s => `${s.job.mode} ${s.job.status} -> ${s.outcome} (${Math.round(s.ms / 100) / 10}s)`).join("; "),
      );
    if (v?.stage) md.push(`- **last stage reached**: \`${v.stage}\` (the program hung/died after this)`);
    if (v?.stacks.length) {
      md.push(`- **where the process is** (top frames per thread at capture):`);
      for (const line of v.stacks.slice(0, 10)) md.push(`  - ${line}`);
    }
    md.push("- **replay**:");
    md.push("```powershell");
    md.push(
      `bun driver\\repro.ts --bun "${bun}" --schedule "${f.job.coord.sysName} ${f.job.coord.rva} ${f.job.hit} ${f.job.mode} ${f.job.status}" --program ${progArgs.join(" ")}`,
    );
    md.push("```");
    md.push("");
  }
  const slows = results.filter(r => r.outcome === "slow");
  if (slows.length) {
    md.push(`## slow runs (${slows.length}) - finished, but the fault made them crawl`);
    for (const r of slows)
      md.push(
        `- ${r.job.coord.sysName} ${r.job.mode} ${r.job.status} @\`${ownerFrame(r.job.coord)}\` ` +
          `[${coordModule(r.job.coord)}] took ${r.ms}ms${rel(r.ms)}`,
      );
    md.push("");
  }
  const findingsPath = join(workRoot, "findings.md");
  await Bun.write(findingsPath, md.join("\n") + "\n");
  console.log(`\nfindings: ${findingsPath}`);
}

await Bun.write(
  outPath,
  JSON.stringify(
    {
      bun,
      program: progArgs,
      baseline: { exit: base.exitCode, ms: base.ms },
      loadControls: controls,
      results: results.map(r => ({
        outcome: r.outcome,
        verdict: verdicts.get(r)?.verdict ?? null,
        standalone: verdicts.get(r)?.outcomes ?? null,
        lastStage: verdicts.get(r)?.stage ?? null,
        stacks: verdicts.get(r)?.stacks ?? null,
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
