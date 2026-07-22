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

import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { DELAY_MS, F, FAULTS, type Fault, type Mode } from "./faults";
import {
  classifySym,
  digestStacks,
  ensureDir,
  keyName,
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
// Points sampled across each coordinate's lifetime (first, deep-mid..., last).
const maxHits = Math.max(1, +(flag("--hits", "3") as string));
const modFilter = flag("--modules")?.split(",");
const sysFilter = flag("--syscalls")?.split(",");
// Timestamped, never-reused root. Runs that find nothing are pruned as the
// sweep goes; every finding keeps its full directory. Old sweeps accumulate.
const workRoot = join(flag("--work", "C:\\wsfsweep") as string, stamp);
const outPath = flag("--out", join(workRoot, "sweep-report.json")) as string;
const planOnly = argv.includes("--plan-only"); // baseline + estimate, then stop
// Keep run directories that found nothing (default: only findings, baselines
// and verify replays are kept - a clean run is not a test case).
const keepAllRuns = argv.includes("--keep-all-runs");
// Keep raw syscall traces even where only replay text is needed.
const keepAllTraces = argv.includes("--keep-all-traces");

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
// "slow" is relative to what the program normally takes: an absolute
// floor for fast programs, else 2x baseline (a 29s test suite is not slow at
// 30s). And a baseline that already exits non-zero weakens error-exit as an
// oracle - say so in the report rather than silently pretending otherwise.
const slowMs = Math.max(8000, base.ms * 2);
// Test-runner timeouts: bun test marks a timed-out test in its output. A
// fault that makes MORE tests time out than the baseline stalled an awaited
// operation - the hang class, bounded by the runner. Count occurrences.
const timedOutTests = (out: string): number => (out.match(/timed out after \d+ms|\btimed out\b.*\bafter\b/gi) ?? []).length;
const baseTimeouts = timedOutTests(base.stdout + base.stderr);
const baseTrace = await readTraceDir(base.dir);
if (!baseTrace) {
  console.error("no baseline trace produced");
  process.exit(1);
}

// --- coordinates --------------------------------------------------------------
// A coordinate = (syscall, key). The KEY is the syscall's immediate return
// address, module-tagged ("b:rva" bun / "k:rva" kernelbase / "n:rva"
// ntdll): deterministic per calling instruction, never a stack leftover.
// repRvas are the scraped bun.exe candidate frames - attribution and
// display only. A "b:" key IS a real bun frame, so it leads the candidates.
interface Coord {
  id: string; // sys + ":" + key
  sys: number;
  sysName: string;
  key: string; // "<tag>:<hexrva>" - the schedule identity
  hits: number;
  repRvas: string[];
}
const bunRvaOfKey = (k: string) => (k.startsWith("b:") ? k.slice(2) : null);
const coords = new Map<string, Coord>();
for (const r of baseTrace.recs) {
  if (r.entryOnly) continue;
  const sysName = nameOf(r.sys);
  if (!(sysName in FAULTS)) continue;
  if (sysFilter && !sysFilter.includes(sysName)) continue;
  const id = `${r.sys}:${r.key}`;
  const c = coords.get(id);
  if (c) c.hits++;
  else {
    const kb = bunRvaOfKey(r.key);
    const repRvas = kb ? [kb, ...r.rvas.filter(x => x !== kb)] : r.rvas;
    coords.set(id, { id, sys: r.sys, sysName, key: r.key, hits: 1, repRvas });
  }
}

// Startup mask: the coordinates an EMPTY program produces are process
// startup infrastructure (loader, JSC init, event-loop bring-up). They get
// exactly one injection each - they can hide real bugs, so not zero - but
// no more, so the budget goes to what THIS program does.
// The mask is the UNION of a few micro-programs: an empty program (loader,
// JSC init, event loop) plus one-liners that touch each subsystem's
// one-time init (winsock, spawn/pipe machinery, ICU) - so those init
// sites count as startup infrastructure too, not program-specific code.
const MASK_PROGRAMS: string[][] = [
  ["-e", "0"],
  ["-e", "require('net').createConnection({port:1,host:'127.0.0.1'}).on('error',()=>{})"],
  ["-e", "Bun.spawnSync(['cmd','/c','rem'])"],
  ["-e", "new Intl.DateTimeFormat().format()"],
];
const startupMask = new Set<string>();
for (let i = 0; i < MASK_PROGRAMS.length; i++) {
  const m = await runOnce({ bun, args: MASK_PROGRAMS[i], workDir: join(runsDir, `startup-mask${i}`), timeoutMs });
  const t = await readTraceDir(m.dir);
  for (const r of t?.recs ?? []) if (!r.entryOnly) startupMask.add(`${r.sys}:${r.key}`);
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
  const first = c.repRvas[0];
  if (first) return `${symText(first)} (bun+0x${first})`;
  // No bun frame at all: name the module the key's caller lives in
  // (kernelbase / ntdll wrapper, or an o:-key resolved through the map).
  return keyName(baseTrace!, c.key);
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
// Depth sampling: hit #1 of most call sites lands in process startup, so
// faulting only first hits makes bun exit before the program's meat runs.
// Instead sample each coordinate ACROSS ITS LIFETIME - up to --hits points
// spread first..last (1, then a geometric mid-spread, always the last hit,
// which is the deepest occurrence). Hit indices are still deterministic
// coordinates, so every deep injection replays exactly.
const spreadHits = (n: number, k: number): number[] => {
  if (n <= 1 || k <= 1) return [1];
  const out = new Set<number>([1, n]);
  // geometric interior points: bias toward deep hits (where the meat is)
  for (let i = 1; i < k - 1 && out.size < k; i++) {
    const frac = 1 - Math.pow(0.5, i); // 0.5, 0.75, 0.875, ...
    out.add(Math.max(1, Math.min(n, Math.round(1 + frac * (n - 1)))));
  }
  return [...out].sort((a, b) => a - b);
};
const plan: Job[] = [];
let startupCoords = 0;
for (const c of candidates) {
  if (startupMask.has(c.id)) {
    // startup infrastructure: one representative injection, no more
    startupCoords++;
    const f = FAULTS[c.sysName][0];
    plan.push({ id: plan.length, coord: c, status: f.status, mode: f.mode, expect: f.expect ?? "must-handle", hit: 1 });
    continue;
  }
  for (const f of FAULTS[c.sysName])
    for (const hit of spreadHits(c.hits, maxHits))
      plan.push({ id: plan.length, coord: c, status: f.status, mode: f.mode, expect: f.expect ?? "must-handle", hit });
}

const estSec = Math.round(((plan.length * base.ms) / jobs / 1000) * 1.3);
console.log(
  `\n${coords.size} injectable coordinates from ${baseTrace.recs.length} baseline records ` +
    `(${startupCoords} startup-masked to one injection each); ` +
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
  crashSig: import("./lib").CrashSig | null;
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
    await Bun.write(sched, `${job.coord.sysName} ${job.coord.key} ${job.hit} ${job.mode} ${job.status}\n`);
    // A job's own failure (an unreadable trace, a spawn hiccup) degrades to
    // a 'driver-error' outcome; it must never take the sweep down with it.
    let rr: Awaited<ReturnType<typeof runOnce>>;
    let fired = 0;
    let outcome: string;
    try {
      rr = await runOnce({ bun, args: progArgs, workDir: dir, timeoutMs, schedule: sched });
      // faultsOnly: injection runs need "did it fire and where", not every
      // record of a possibly-huge trace materialized.
      const tr = await readTraceDir(rr.dir, { faultsOnly: true });
      fired = tr ? tr.recs.filter(r => r.fault).length : 0;
      if (rr.outcome === "hang") outcome = "HANG";
      else if (rr.crash) {
        // A crash. Sort out what is NOT a bun bug before reporting: an
        // allocator-failure abort is by design, and a fault whose every
        // backtrace frame is a system DLL means we sabotaged system code
        // from inside its own machinery (mswsock's private threads etc.).
        if (job.expect === "abort-expected") outcome = "expected-abort";
        else if (rr.crashSig?.boundary === "system-module") outcome = "system-crash";
        else outcome = "CRASH";
      } else if (fired === 0) outcome = "no-fire";
      // A run that got slow because a test TIMED OUT is the hang class in
      // disguise: some awaited operation never completed and the runner's
      // per-test timeout rescued it. That is a finding ('stalled'). A run
      // that is merely slower with no timeout is latency (retries/backoff) -
      // 'slow', roll-up only, never queued.
      else if (rr.ms >= slowMs) outcome = timedOutTests(rr.stdout + rr.stderr) > baseTimeouts ? "stalled" : "slow";
      else if (rr.exitCode !== base.exitCode) outcome = "error-exit";
      else if (rr.stdout !== base.stdout) outcome = "diverged";
      else outcome = "clean";
    } catch (err) {
      outcome = "driver-error";
      rr = { outcome: "exit", exitCode: null, ms: 0, stdout: "", stderr: String(err), logPath: null, dir, crash: false, crashSig: null };
      console.log(`  !! driver-error on job ${job.id}: ${String(err).slice(0, 120)}`);
    }

    const res: Result = { job, outcome, exitCode: rr.exitCode, fired, ms: rr.ms, stdoutDiffers: rr.stdout !== base.stdout, crashSig: rr.crashSig ?? null };
    results.push(res);
    // Retention: a run that found nothing is not a test case. Its outcome
    // and the fired count are already recorded in the report, so the run
    // directory (multi-MB trace + output) is deleted. Every finding -
    // CRASH, HANG, slow, system-crash, expected-abort, driver-error - keeps
    // its complete directory for triage and replay, as do baselines and
    // the verify replays. --keep-all-runs opts out. Without this,
    // continuous fuzzing fills the disk within hours.
    if (!keepAllRuns && ["clean", "no-fire", "diverged", "error-exit"].includes(outcome)) {
      try {
        rmSync(rr.dir, { recursive: true, force: true });
      } catch {}
    }
    liveWriter.write(
      JSON.stringify({
        n: results.length,
        of: plan.length,
        outcome,
        syscall: job.coord.sysName,
        key: job.coord.key,
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
        `${job.coord.sysName} ${job.mode} ${job.status} hit${job.hit} @${job.coord.key} ` +
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
  stalled: 2, // an awaited op never completed (a test timed out) - hang class
  slow: 3,
  "expected-abort": 4,
  "error-exit": 5,
  diverged: 6,
  "no-fire": 7,
  clean: 8,
  "system-crash": 8, // fault crashed a system DLL's own machinery: not a bun bug
  "driver-error": 9,
};
results.sort((a, b) => rank[a.outcome] - rank[b.outcome]);
const counts = new Map<string, number>();
for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);

console.log(`\n=== sweep done in ${Math.round((performance.now() - t0) / 1000)}s: ${results.length} runs ===`);
for (const k of ["HANG", "CRASH", "slow", "expected-abort", "error-exit", "diverged", "no-fire", "clean"])
  if (counts.has(k)) console.log(`  ${k.padEnd(15)} ${counts.get(k)}`);

const findingsPath = join(workRoot, "findings.md");
const findings = results.filter(r => r.outcome === "CRASH" || r.outcome === "HANG" || r.outcome === "stalled");

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
  termChain: string[]; // in-process terminating stack, symbolized (abort/crash chain)
}
const verdicts = new Map<Result, Verify>();
if (findings.length) {
  console.log(`\n=== verifying ${findings.length} finding(s) standalone (x3, ${(2 * timeoutMs) / 1000}s timeout) ===`);
  for (const f of findings) {
    const sched = `${f.job.coord.sysName} ${f.job.coord.key} ${f.job.hit} ${f.job.mode} ${f.job.status}`;
    const outcomes: string[] = [];
    let stage: string | null = null;
    let termChain: string[] = [];
    let stacks: string[] = [];
    for (let n = 1; n <= 3; n++) {
      const rr = await replayCoordinate({
        bun,
        args: progArgs,
        schedule: sched,
        dir: join(workRoot, "verify", `${f.job.coord.sys}-${f.job.coord.key.replace(':', '_')}-${n}`),
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
        // In-process terminating stacks ('T' records) - the abort/crash
        // chain with no debugger. Every traced process (parent + injected
        // children) leaves one; symbolize each and keep the fatal-looking one.
        // Only a CRASH leaves a meaningful terminating stack; on normal exits
        // the exit-time scrape is unrelated leftovers (symbol soup).
        const trace = rr.outcome === "CRASH" || rr.crashSig ? await readTraceDir(rr.dir, { faultsOnly: true }) : null;
        const cands = trace?.termStacks ?? [];
        if (cands.length) {
          const allSyms = await symbolize(bun, cands.flat());
          const rendered = cands.map(ts =>
            ts.map(r => (allSyms.get(r)?.sym ?? `bun+0x${r}`).replace(/\+0x[0-9a-f]+$/, "")),
          );
          const fatal = /wassert|abort|panic|crash|CRASH|fastfail|__scrt_common|raise/i;
          termChain = rendered.find(rs => rs.some(x => fatal.test(x))) ?? rendered[0] ?? [];
        }
      }
    }
    // For a stalled finding, stalling again standalone (a slow replay =
    // the test timed out again) IS the reproduction.
    const bad = outcomes.filter(o => o === "CRASH" || o === "HANG" || (f.outcome === "stalled" && o === "slow")).length;
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
    verdicts.set(f, { verdict, outcomes, stage, stacks, termChain });
    console.log(
      `  ${verdict.padEnd(15)} ${f.outcome} ${f.job.coord.sysName} @${f.job.coord.key} ` +
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
        `${statusName(r.job.status.toLowerCase())} hit${r.job.hit} @${r.job.coord.key} = ` +
        `${ownerFrame(r.job.coord)} [${coordModule(r.job.coord)}] ` +
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
  md.push(`- baseline exit=${base.exitCode} in ${base.ms}ms; watchdog ${timeoutMs / 1000}s (verify at ${(2 * timeoutMs) / 1000}s); slow threshold ${slowMs}ms`);
  if (base.exitCode !== 0)
    md.push(
      "- **weakened oracle**: the baseline already exits non-zero (pre-existing failures), so `error-exit` " +
        "vs baseline is muted here - trust CRASH/HANG cards, discount error-exit tallies",
    );
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
    if (!f.job.coord.key.startsWith("b:"))
      md.push(`- **immediate caller** (key ${f.job.coord.key}): \`${keyName(baseTrace!, f.job.coord.key)}\``);
    if (f.crashSig) {
      md.push(`- **crash signature**: \`${f.crashSig.signature}\` (${f.crashSig.kind}, boundary: ${f.crashSig.boundary})`);
      if (f.crashSig.frames.length) {
        md.push("- **its own backtrace** (as printed by the crashing process):");
        md.push("```");
        for (const fr of f.crashSig.frames.slice(0, 10)) md.push(fr);
        md.push("```");
      }
    }
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
      r => r.job.coord.id === f.job.coord.id && r !== f && r.outcome !== "no-fire",
    );
    if (siblings.length)
      md.push(
        `- **same callsite, other faults**: ` +
          siblings.map(s => `${s.job.mode} ${s.job.status} -> ${s.outcome} (${Math.round(s.ms / 100) / 10}s)`).join("; "),
      );
    if (v?.stage) md.push(`- **last stage reached**: \`${v.stage}\` (the program hung/died after this)`);
    if (v?.termChain.length) {
      // The crash's why, straight from the dying process: read top-down.
      md.push(`- **fatal chain** (terminating thread, nearest first): \`${v.termChain.slice(0, 8).join(" <- ")}\``);
    }
    if (v?.stacks.length) {
      md.push(`- **where the process is** (top frames per thread at capture):`);
      for (const line of v.stacks.slice(0, 10)) md.push(`  - ${line}`);
    }
    md.push("- **replay**:");
    md.push("```powershell");
    md.push(
      `bun driver\\repro.ts --bun "${bun}" --schedule "${f.job.coord.sysName} ${f.job.coord.key} ${f.job.hit} ${f.job.mode} ${f.job.status}" --program ${progArgs.join(" ")}`,
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
        termChain: verdicts.get(r)?.termChain ?? null,
        expect: r.job.expect,
        syscall: r.job.coord.sysName,
        key: r.job.coord.key,
        symbol: ownerFrame(r.job.coord),
        module: coordModule(r.job.coord),
        status: r.job.status,
        mode: r.job.mode,
        hit: r.job.hit,
        exit: r.exitCode,
        fired: r.fired,
        ms: r.ms,
        stdoutDiffers: r.stdoutDiffers,
        schedule: `${r.job.coord.sysName} ${r.job.coord.key} ${r.job.hit} ${r.job.mode} ${r.job.status}`,
      })),
    },
    null,
    1,
  ),
);
console.log(`\nreport: ${outPath}`);

// --- retention pass: keep replay material, not raw traces ---------------------
// After classification+verification the multi-MB raw syscall traces have
// done their job (fired-count, coordinates, fatal chain). What earns disk
// is what REPLAYS a finding: its schedule, its small stdout/stderr, its
// captured stacks. So: strip wsf-*.log traces from controls, the baseline
// and startup-mask runs, verify replays of findings that did NOT confirm,
// and kept sightings that are not confirmed - directories stay (tiny text)
// so nothing loses its record. Confirmed/stalled findings and their verify
// replays keep everything. --keep-all-traces opts out.
if (!keepAllTraces) {
  const stripTraces = (d: string) => {
    for (const f of readdirSync(d)) {
      if (f.startsWith("wsf-") && f.endsWith(".log")) {
        try {
          rmSync(join(d, f), { force: true });
        } catch {}
      }
    }
  };
  const confirmedIds = new Set(
    findings.filter(f => verdicts.get(f)?.verdict === "confirmed").map(f => `${f.job.coord.sys}-${f.job.coord.key.replace(":", "_")}`),
  );
  for (const d of readdirSync(runsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (/^(baseline|startup-mask\d*|control\d*)$/.test(d.name)) {
      stripTraces(join(runsDir, d.name)); // enumeration/health scratch
      continue;
    }
  }
  const verifyRoot = join(workRoot, "verify");
  if (existsSync(verifyRoot)) {
    for (const d of readdirSync(verifyRoot, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      // verify dir name = "<sysId>-<key_>-<n>": keep confirmed findings' replays
      const stem = d.name.replace(/-\d+$/, "");
      if (!confirmedIds.has(stem)) stripTraces(join(verifyRoot, d.name));
    }
  }
  // Sightings kept in runs/ that did not confirm: keep the record, drop the trace.
  for (const r of results) {
    if (!["CRASH", "HANG", "slow", "stalled", "system-crash", "expected-abort"].includes(r.outcome)) continue;
    const v = verdicts.get(r);
    if (v?.verdict === "confirmed") continue; // full case kept
    const dir = join(runsDir, `job${String(r.job.id).padStart(4, "0")}`);
    if (existsSync(dir)) stripTraces(dir);
  }
}

// --- the queue: global append-only feed of verified findings ---------------
// The fuzzer runs continuously and the triager drains this file, so every
// verified finding lands here as one JSON line with a stable dedupeKey (a
// crash signature, else syscall@owning-symbol) - one bug appears once no
// matter how many targets/hunts hit it. Append-only, never deleted; the
// triager's verdicts live in the sibling triaged.jsonl.
const queueDir = flag("--queue", "C:\\wsfqueue") as string;
ensureDir(queueDir);
const queueLines: string[] = [];
for (const r of results) {
  const v = verdicts.get(r);
  if (!v) continue; // only verified findings enter the queue
  // Admission: a HANG whose every standalone replay came back clean is a
  // sweep-load artifact, not something worth a human look - it stays in
  // the roll-up but does not enter the triage queue.
  if (v.verdict === "load-dependent" && v.outcomes.every(o => o === "clean")) continue;
  // An allocator-failure fault whose replays exit with an error is
  // crash-on-OOM by design, not a finding worth a human look.
  if (r.job.expect === "abort-expected" && v.outcomes.every(o => o !== "HANG" && o !== "CRASH")) continue;
  // A short/mangled transfer that only makes the program SLOW is a
  // correct retry loop paying its retry cost - expected, not a bug.
  if (r.job.mode.startsWith("mangle") && v.verdict === "slow") continue;
  // Nothing to look at when no replay reproduced anything.
  if (v.verdict === "not-reproduced") continue;
  // Plain slowness (no test timed out) is latency, not a bug - roll-up only.
  // The interesting subset (a stalled operation) is its own outcome.
  if (v.verdict === "slow" && r.outcome !== "stalled") continue;
  const dedupeKey = r.crashSig ? `crash: ${r.crashSig.signature}` : `${r.job.coord.sysName} @ ${ownerFrame(r.job.coord).replace(/\+0x[0-9a-f]+/g, "")}`;
  queueLines.push(
    JSON.stringify({
      queuedAt: stamp,
      dedupeKey,
      verdict: v.verdict,
      outcome: r.outcome,
      boundary: r.crashSig?.boundary ?? null,
      crashKind: r.crashSig?.kind ?? null,
      crashDetail: r.crashSig?.detail ?? null,
      expect: r.job.expect,
      target: progArgs.join(" "),
      schedule: `${r.job.coord.sysName} ${r.job.coord.key} ${r.job.hit} ${r.job.mode} ${r.job.status}`,
      symbol: ownerFrame(r.job.coord),
      module: coordModule(r.job.coord),
      standalone: v.outcomes,
      lastStage: v.stage,
      termChain: v.termChain,
      stacks: v.stacks.slice(0, 12),
      findings: findingsPath,
      workDir: workRoot,
    }),
  );
}
if (queueLines.length) {
  const qfile = join(queueDir, "queue.jsonl");
  const prev = (await Bun.file(qfile).exists()) ? await Bun.file(qfile).text() : "";
  await Bun.write(qfile, prev + queueLines.join("\n") + "\n");
  console.log(`queued ${queueLines.length} verified finding(s) -> ${qfile}`);
}
