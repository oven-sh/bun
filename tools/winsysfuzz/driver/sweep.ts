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

import { appendFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { ALPC_OK, DELAY_MS, F, FAULTS, faultsFor, type Fault, type Mode } from "./faults";
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
  symbolizePanicBacktrace,
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

// Known signatures: everything already triaged or already queued. A crash
// whose signature is in here is KNOWN - re-verifying and re-queueing it
// is pure waste (the queue would dedupe it anyway, an hour later). Loaded
// once per sweep from the queue directory's ledgers.
const queueDirEarly = flag("--queue", "C:\\wsfqueue") as string;
const knownKeys = new Set<string>();
for (const f of ["triaged.jsonl", "queue.jsonl"]) {
  const path = join(queueDirEarly, f);
  if (!existsSync(path)) continue;
  try {
    for (const line of (await Bun.file(path).text()).split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.dedupeKey) knownKeys.add(e.dedupeKey);
        if (e.crashDetail) knownKeys.add(`detail: ${e.crashDetail}`);
      } catch {}
    }
  } catch {}
}
const isKnownCrash = (sig: { signature: string; detail: string } | null | undefined) =>
  !!sig && (knownKeys.has(`crash: ${sig.signature}`) || knownKeys.has(`detail: ${sig.detail}`));

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

// Baseline leak set: named handles the program legitimately holds to exit.
// A run's leaks are only interesting where they EXCEED this set. Normalize
// away the volatile handle value (name+kind is the identity), and drop
// harness-owned paths outright: every run gets its own uniquely-named work
// directory (cwd, log dir, stdout/stderr files) - a handle on those (a
// process holding its own cwd is normal) is our artifact, not a bun leak,
// and the unique name defeats a plain baseline diff.
const harnessPath = /\\runs\\|\\cwd\b|\\wsf-\d+\.log|\\(stdout|stderr)\.txt|\bwsffeed\b|\bwsfchaos\b|\bwsfsweep\b/i;
// Not a workload I/O leak: OS-owned named objects (WER/WIL and other
// Local\ / Global\ / BaseNamedObjects sections the system creates in-
// process on demand), loader resource files (.mui/.dll/.nls sections), and
// bun's own module sources (a source file it keeps open/mapped for the
// module's lifetime). Only handles bun opened for the workload's own I/O
// (data files, pipes, sockets, keys) can be a leak worth reporting.
// Also by design: sourcemap files (opened lazily and held for stack-trace
// symbolication - a run that errored under a fault symbolicates where the
// baseline did not) and the debug build's source-override temp cache.
const notWorkloadIo = /(Local\\|Global\\|BaseNamedObjects|WilError|\\SM0:|\.mui\b|\.dll\b|\.nls\b|\.map$|bun-debug-src|\.(ts|tsx|js|mjs|cjs|mts|cts|jsx)$)/i;
// Normalize per-instance name components so the baseline diff compares
// KINDS of handle, not instances: libuv names child-stdio pipes
// "\pipe\uv\<sentinel>-<pid>" - the pid differs per child, so identity
// per child defeats the diff (a fault that merely runs a different child
// "leaks" a fresh name). Collapse the pid; a genuine surplus of stdio
// pipes over baseline (count) still registers.
const normalizeLeak = (l: string) => l.trim().replace(/(\\pipe\\uv\\\d+)-\d+/i, "$1-<pid>");
const cleanLeaks = (leaks: string[]) =>
  leaks.map(normalizeLeak).filter(l => !harnessPath.test(l) && !notWorkloadIo.test(l));
// Leaks are a per-PROCESS property: a test that spawns N children has N
// standing-handle sets, so a merged multiset shows an Nx "surplus" that is
// only process count. Judge each traced process on its own: the standing
// counts are the max per-process counts across the baseline's processes,
// and a run leaks when SOME process's own counts exceed them.
const countKinds = (leaks: string[]) => {
  const m = new Map<string, number>();
  for (const l of cleanLeaks(leaks)) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
};
const baseLeakCounts = new Map<string, number>();
for (const proc of baseTrace.leaksByProc ?? [baseTrace.leaks ?? []])
  for (const [k, n] of countKinds(proc)) baseLeakCounts.set(k, Math.max(baseLeakCounts.get(k) ?? 0, n));
const newLeaks = (leaksByProc: string[][]): string[] => {
  const worst = new Map<string, number>(); // largest surplus of each kind in any one process
  for (const proc of leaksByProc)
    for (const [k, n] of countKinds(proc)) {
      const over = n - (baseLeakCounts.get(k) ?? 0);
      if (over > 0) worst.set(k, Math.max(worst.get(k) ?? 0, over));
    }
  return [...worst].map(([k, over]) => (over > 1 ? `${k} x${over}` : k));
};

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
  if (!faultsFor(sysName)) continue; // universal surface: every faultable syscall
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
// When the target IS a test file, its startup is the TEST RUNNER's bring-up
// (heavier than a plain process: harness preload, snapshot/coverage init,
// the runner's own machinery) - mask that too, or the sweep spends itself
// faulting bun test's init and calls it the program's code.
if (progArgs[0] === "test") {
  const trivial = join(runsDir, "wsf-trivial.test.ts");
  await Bun.write(trivial, `import { test, expect } from "bun:test";\ntest("wsf-trivial", () => { expect(1).toBe(1); });\n`);
  MASK_PROGRAMS.push(["test", trivial]);
}
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
    const f = faultsFor(c.sysName)![0];
    plan.push({ id: plan.length, coord: c, status: f.status, mode: f.mode, expect: f.expect ?? "must-handle", hit: 1 });
    continue;
  }
  for (const f of faultsFor(c.sysName)!)
    for (const hit of spreadHits(c.hits, maxHits)) {
      // A delayed CLOSE at hit 1 is always a process-startup close: the
      // pause only slows startup and yields marginal timeout-grazing
      // "stalls" on slow targets. Delay closes deeper in, never the first.
      if (c.sysName === "NtClose" && f.mode === "delay" && hit === 1) continue;
      // The first event/semaphore creations are WTF/JSC threading
      // primitives created at init: failing them parks the main thread
      // forever (a by-design init fatal), never a bun logic bug.
      if ((c.sysName === "NtCreateEvent" || c.sysName === "NtCreateSemaphore") && hit === 1) continue;
      plan.push({ id: plan.length, coord: c, status: f.status, mode: f.mode, expect: f.expect ?? "must-handle", hit });
    }
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
  leaked: string[]; // named handles leaked beyond the baseline set ('leak' outcome)
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
    let leaked: string[] = [];
    try {
      rr = await runOnce({ bun, args: progArgs, workDir: dir, timeoutMs, schedule: sched });
      // faultsOnly: injection runs need "did it fire and where", not every
      // record of a possibly-huge trace materialized.
      const tr = await readTraceDir(rr.dir, { faultsOnly: true });
      fired = tr ? tr.recs.filter(r => r.fault).length : 0;
      if (rr.crash && isKnownCrash(rr.crashSig)) outcome = "known-crash";
      else if (rr.outcome === "hang") outcome = "HANG";
      else if (rr.crash) {
        // A crash. Sort out what is NOT a bun bug before reporting: an
        // allocator-failure abort is by design, and a fault whose every
        // backtrace frame is a system DLL means we sabotaged system code
        // from inside its own machinery (mswsock's private threads etc.).
        if (job.expect === "abort-expected") outcome = "expected-abort";
        // Crash-on-OOM is by design; only an absurdly LARGE allocation
        // (oom-large: unvalidated size / runaway growth) is a real bug.
        else if (rr.crashSig?.kind === "oom") outcome = "expected-abort";
        // A debug-only asset load (source-tree file) is not user-facing.
        else if (rr.crashSig?.kind === "debug-only") outcome = "expected-abort";
        else if (rr.crashSig?.boundary === "system-module") outcome = "system-crash";
        else outcome = "CRASH";
      } else if (fired === 0) outcome = "no-fire";
      // NOTE: exit-time handle leaks are RECORDED (leaked, below - the L
      // records ride on the trace as context) but are not an outcome: bun
      // fast-exits without cleanup by design, so the set of handles open at
      // exit tracks where/when the process stopped, not correctness. Six
      // classes of "leak" card were all that fact in different masks
      // (interrupted operations, exit racing async closes, lazy sourcemaps).
      // A real handle-leak oracle must watch growth DURING a run, not the
      // exit set.
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

    const res: Result = { job, outcome, exitCode: rr.exitCode, fired, ms: rr.ms, stdoutDiffers: rr.stdout !== base.stdout, crashSig: rr.crashSig ?? null, leaked };
    results.push(res);
    // Retention: a run that found nothing is not a test case. Its outcome
    // and the fired count are already recorded in the report, so the run
    // directory (multi-MB trace + output) is deleted. Every finding -
    // CRASH, HANG, slow, system-crash, expected-abort, driver-error - keeps
    // its complete directory for triage and replay, as do baselines and
    // the verify replays. --keep-all-runs opts out. Without this,
    // continuous fuzzing fills the disk within hours.
    if (!keepAllRuns && ["clean", "no-fire", "diverged", "error-exit", "known-crash"].includes(outcome)) {
      try {
        rmSync(rr.dir, { recursive: true, force: true });
      } catch {}
    } else if (!keepAllTraces && outcome !== "CRASH" && outcome !== "HANG" && outcome !== "stalled") {
      // A kept sighting that is not a hard finding: its fired-count is
      // recorded, drop the multi-MB raw trace NOW rather than at end-of-sweep
      // so a long sweep's in-flight disk footprint stays flat.
      try {
        for (const f of readdirSync(rr.dir))
          if (f.startsWith("wsf-") && f.endsWith(".log")) rmSync(join(rr.dir, f), { force: true });
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
  leak: 2.5, // named-handle leak beyond baseline: a quiet real bug
  "known-crash": 4, // signature already triaged/queued: nothing new to learn
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
const rawFindings = results.filter(r => r.outcome === "CRASH" || r.outcome === "HANG" || r.outcome === "stalled");
// Verification budget with clustering: 46 near-identical HANGs must not
// cost 46 x 3 replays. Cluster findings by (outcome, syscall, mode, crash
// signature) and verify one REPRESENTATIVE per cluster - crashes first,
// then stalls, then hangs - up to VERIFY_BUDGET. Cluster mates inherit the
// representative's verdict (logged as such). This is what keeps a heavy
// sweep from spending an hour re-confirming the same thing.
const VERIFY_BUDGET = 12;
const clusterKey = (r: Result) =>
  `${r.outcome}|${r.job.coord.sysName}|${r.job.mode}|${r.crashSig?.signature ?? ""}`;
const byCluster = new Map<string, Result[]>();
for (const r of rawFindings) {
  const k = clusterKey(r);
  const arr = byCluster.get(k) ?? [];
  arr.push(r);
  byCluster.set(k, arr);
}
const classPri: Record<string, number> = { CRASH: 0, leak: 1, stalled: 2, HANG: 3 };
const reps = [...byCluster.values()]
  .map(g => g[0])
  .sort((a, b) => (classPri[a.outcome] ?? 9) - (classPri[b.outcome] ?? 9))
  .slice(0, VERIFY_BUDGET);
const findings = reps; // representatives are what get verified/reported
if (rawFindings.length > reps.length)
  console.log(
    `\n${rawFindings.length} finding sighting(s) in ${byCluster.size} cluster(s); verifying ` +
      `${reps.length} representative(s) (budget ${VERIFY_BUDGET})`,
  );

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
  panicChain: string[]; // rust panic backtrace, symbolized via cdb (panic site first)
}
const verdicts = new Map<Result, Verify>();
const queueDir = flag("--queue", "C:\\wsfqueue") as string;
ensureDir(queueDir);
let queuedCount = 0;
// Stream one verified finding into the triage queue, applying the
// admission rules (artifact classes stay in the roll-up only) and the
// known-signature dedupe (already-triaged/queued signatures are silent).
async function queueFinding(r: Result, v: Verify) {
  // A load-dependent verdict means, by definition, NO standalone replay
  // showed anything bad (clean or graceful error-exits): the sweep-time
  // symptom was contention. Roll-up only, never queued.
  if (v.verdict === "load-dependent") return;
  if (r.job.expect === "abort-expected" && v.outcomes.every(o => o !== "HANG" && o !== "CRASH")) return;
  if (r.job.mode.startsWith("mangle") && v.verdict === "slow") return;
  if (v.verdict === "not-reproduced") return;
  if (v.verdict === "slow" && r.outcome !== "stalled") return;
  // A post-fault (the op SUCCEEDED, then we report failure) whose immediate
  // caller is another module ('o:' key) fabricates an impossible world: a
  // completed operation does not retroactively report failure inside system
  // machinery. Repeatedly triaged not-real; suppressed as a class.
  // ...a pre-failure on an o: key fails system plumbing mid-operation, and
  // a delay there is that module's own loop scheduling - bun only ever sees
  // the API boundary. All o:-keyed fault modes drop as one class.
  if (r.job.coord.key.startsWith("o:") && !ALPC_OK.has(r.job.coord.sysName)) return;
  // A stall whose fault sits INSIDE ntdll ('n:' key = loader/heap-internal
  // machinery, mostly hit-1 startup) is a system-side slowdown, not bun's
  // code path - repeatedly triaged not-bun on slow test targets.
  if ((r.outcome === "stalled" || r.outcome === "slow") && r.job.coord.key.startsWith("n:")) return;
  const dedupeKey = r.crashSig
    ? `crash: ${r.crashSig.signature}`
    : r.outcome === "leak"
      ? `leak ${[...r.leaked].sort().join(",")}`
      : `${r.job.coord.sysName} @ ${ownerFrame(r.job.coord).replace(/\+0x[0-9a-f]+/g, "")}`;
  if (knownKeys.has(dedupeKey)) return; // already triaged or already queued
  knownKeys.add(dedupeKey);
  const line = JSON.stringify({
    queuedAt: stamp,
    dedupeKey,
    verdict: v.verdict,
    outcome: r.outcome,
    boundary: r.crashSig?.boundary ?? null,
    crashKind: r.crashSig?.kind ?? null,
    crashDetail: r.crashSig?.detail ?? null,
    // A leak card is a lead to judge, never a must-handle: the oracle names
    // handles, and only a human/robobun reading the error path can say
    // whether the program leaked or merely stopped elsewhere.
    expect: r.outcome === "leak" ? "judgment" : r.job.expect,
    target: progArgs.join(" "),
    schedule: `${r.job.coord.sysName} ${r.job.coord.key} ${r.job.hit} ${r.job.mode} ${r.job.status}`,
    symbol: ownerFrame(r.job.coord),
    module: coordModule(r.job.coord),
    standalone: v.outcomes,
    lastStage: v.stage,
    termChain: v.termChain,
    panicChain: v.panicChain,
    stacks: v.stacks.slice(0, 12),
    leaked: r.leaked.slice(0, 20),
    findings: findingsPath,
    workDir: workRoot,
  });
  // Atomic append - never read-modify-write (concurrent sweeps + the wide
  // pass share this file; a rewrite raced a truncation and lost history).
  appendFileSync(join(queueDir, "queue.jsonl"), line + "\n");
  queuedCount++;
  console.log(`  -> queued: ${dedupeKey}`);
}
if (findings.length) {
  console.log(`\n=== verifying ${findings.length} finding(s) standalone (x3, ${(2 * timeoutMs) / 1000}s timeout) ===`);
  for (const f of findings) {
    const sched = `${f.job.coord.sysName} ${f.job.coord.key} ${f.job.hit} ${f.job.mode} ${f.job.status}`;
    const outcomes: string[] = [];
    let stage: string | null = null;
    let termChain: string[] = [];
    let panicChain: string[] = [];
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
      // A leak finding's replay reproduces when it, too, leaks named
      // handles beyond the baseline set (the replay tool has no baseline
      // to know that, so the verdict is computed here from its trace).
      if (f.outcome === "leak") {
        const vt = await readTraceDir(rr.dir, { faultsOnly: true }).catch(() => null);
        outcomes.push(newLeaks(vt?.leaksByProc ?? []).length ? "leak" : rr.outcome === "exit" ? "clean" : rr.outcome);
      } else outcomes.push(rr.outcome);
      if (n === 1) {
        stage = lastStage(rr.stdout);
        const raw = rr.hangStacks ?? rr.crashDump ?? "";
        stacks = raw ? digestStacks(raw) : [];
        // In-process terminating stacks ('T' records) - the abort/crash
        // chain with no debugger. Every traced process (parent + injected
        // children) leaves one; symbolize each and keep the fatal-looking one.
        // Only a CRASH leaves a meaningful terminating stack; on normal exits
        // the exit-time scrape is unrelated leftovers (symbol soup).
        // A rust panic prints its own raw-address backtrace; resolve it via
        // cdb -z so the queue card carries the panic site, not "0x7ff7...".
        if (rr.crashSig && /panic/.test(rr.crashSig.kind) && rr.stderr) {
          const t0 = await readTraceDir(rr.dir, { faultsOnly: true }).catch(() => null);
          if (t0?.bunBase) panicChain = await symbolizePanicBacktrace(bun, rr.stderr, t0.bunBase).catch(() => []);
        }
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
    // A leak replay counts as bad when it leaks named handles the
    // baseline does not (the verify replays log 'leak' via the same rule).
    const bad = outcomes.filter(
      o => o === "CRASH" || o === "HANG" || o === "leak" || (f.outcome === "stalled" && o === "slow"),
    ).length;
    const slow = outcomes.filter(o => o === "slow").length;
    const fired = outcomes.filter(o => o !== "no-fire").length;
    // "crawls twice, hangs once" is bad EVERY time (borderline on the
    // watchdog), so slow counts toward confirmation once any replay hangs -
    // but for a STALLED finding slow already IS the bad outcome, so don't
    // double-count it: one slow replay must not confirm itself. Stalled
    // needs a genuine majority of stall replays.
    const verdict: Verdict =
      bad >= 2 || (f.outcome !== "stalled" && bad >= 1 && bad + slow >= 2)
        ? "confirmed"
        : bad === 0 && slow >= 2
          ? "slow"
          : bad === 0 && fired > 0
            ? "load-dependent"
            : "not-reproduced";
    verdicts.set(f, { verdict, outcomes, stage, stacks, termChain, panicChain });
    await queueFinding(f, { verdict, outcomes, stage, stacks, termChain, panicChain });
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
    if (v?.panicChain.length) {
      md.push(`- **panic backtrace** (panic site first): \`${v.panicChain.slice(0, 10).join(" <- ")}\``);
    }
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
// The fuzzer runs continuously and the triager drains this file. A finding
// is appended THE MOMENT its verification completes (streamed from inside
// the verify loop above via queueFinding) - not at end-of-sweep - so a new
// crash reaches the triager in minutes, not after an hour of hang
// verification. dedupeKey (crash signature, else syscall@owning-symbol) is
// stable; anything already in the ledgers is not re-queued. Append-only.
if (queuedCount) console.log(`\nqueued ${queuedCount} new verified finding(s) -> ${join(queueDir, "queue.jsonl")}`);
