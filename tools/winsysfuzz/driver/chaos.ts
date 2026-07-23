// The randomized planner: FUZZ THE CHOICE of what to inject. The interceptor,
// schedule format, oracles and replay machinery are the sweeper's - only
// the plan is random. Each iteration draws a multi-rule schedule (random
// call sites, random hit indices, random modes/statuses, several rules per
// run, delays mixed in for timing), runs the program under it, and keeps
// anything that crashes/hangs/stalls. The saved schedule.txt IS the replay.
// A finding is re-verified and then MINIMIZED: rules are greedily dropped
// while the finding still reproduces, and the surviving minimal rule set is
// what gets queued. This is the engine that never exhausts - every draw is
// new - so it is the one to run continuously.
//
//   bun driver/chaos.ts --bun <bun.exe> --program <file.js> [args...]
//     [--timeout 60] [--rules 3] [--jobs 4] [--iterations N] [--seed S]
//     [--work C:\wsfchaos] [--queue C:\wsfqueue]

import { appendFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALPC_OK, faultsFor, isCurated } from "./faults";
import {
  detectCrash,
  digestStacks,
  ensureDir,
  nameOf,
  readTraceDir,
  replayCoordinate,
  runOnce,
  stamp,
  symbolize,
  type ReplayResult,
} from "./lib";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const bun = flag("--bun");
const progIdx = argv.indexOf("--program");
if (!bun || progIdx < 0) {
  console.error("usage: chaos.ts --bun <bun.exe> --program <file.js> [args...] [options]");
  process.exit(2);
}
const progArgs: string[] = [];
for (let i = progIdx + 1; i < argv.length && !argv[i].startsWith("--"); i++) progArgs.push(argv[i]);
const timeoutMs = 1000 * +(flag("--timeout", "60") as string);
const meanRules = Math.max(1, +(flag("--rules", "3") as string));
const jobs = Math.max(1, +(flag("--jobs", "4") as string));
const iterations = +(flag("--iterations", "0") as string) || Infinity;
const workRoot = join(flag("--work", "C:\\wsfchaos") as string, stamp);
const queueDir = flag("--queue", "C:\\wsfqueue") as string;
ensureDir(workRoot);
ensureDir(queueDir);

// Seeded PRNG (xorshift32): the generator is reproducible from --seed, but
// the real replay artifact is each run's schedule.txt.
let seed = +(flag("--seed", String((Math.random() * 2 ** 31) | 0)) as string) >>> 0 || 88172645;
const rnd = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
};
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
console.log(`chaos: seed=${seed} rules~${meanRules} jobs=${jobs} timeout=${timeoutMs / 1000}s`);

// --- baseline: the coordinate space we draw from --------------------------
const runsDir = join(workRoot, "runs");
ensureDir(runsDir);
console.log(`baseline: ${bun} ${progArgs.join(" ")}`);
const base = await runOnce({ bun, args: progArgs, workDir: join(runsDir, "baseline"), timeoutMs });
console.log(`  outcome=${base.outcome} exit=${base.exitCode} ${base.ms}ms`);
if (base.outcome !== "exit") {
  console.error("baseline did not exit cleanly; refusing to fuzz a hanging baseline");
  process.exit(1);
}
const baseTrace = await readTraceDir(base.dir);
if (!baseTrace) {
  console.error("no baseline trace");
  process.exit(1);
}
type Coord = { sysName: string; key: string; hits: number; first: number; last: number };
const coordMap = new Map<string, Coord>();
baseTrace.recs.forEach((r, i) => {
  if (r.entryOnly) return;
  const sysName = nameOf(r.sys);
  if (!faultsFor(sysName)) return; // universal surface: every faultable syscall
  const id = `${r.sys}:${r.key}`;
  const c = coordMap.get(id);
  if (c) {
    c.hits++;
    c.last = i;
  } else coordMap.set(id, { sysName, key: r.key, hits: 1, first: i, last: i });
});

// Startup mask: coordinates an EMPTY/init-only program produces are process
// startup infrastructure - uniform draws would land there almost every time
// (they dominate the space), reproducing the same init fatals. Mask them out
// of the draw entirely so chaos spends itself on the program's own I/O.
const MASK_PROGRAMS: string[][] = [
  ["-e", "0"],
  ["-e", "require('net').createConnection({port:1,host:'127.0.0.1'}).on('error',()=>{})"],
  ["-e", "Bun.spawnSync(['cmd','/c','rem'])"],
  ["-e", "new Intl.DateTimeFormat().format()"],
];
// A test-file target incurs the TEST RUNNER's bring-up (harness preload,
// runner machinery) - heavier than a plain process. Mask it too, or draws
// land in bun test's own init and read as the program's code.
if (progArgs[0] === "test") {
  const trivial = join(runsDir, "wsf-trivial.test.ts");
  await Bun.write(trivial, `import { test, expect } from "bun:test";\ntest("wsf-trivial", () => { expect(1).toBe(1); });\n`);
  MASK_PROGRAMS.push(["test", trivial]);
}
const masked = new Set<string>();
for (let i = 0; i < MASK_PROGRAMS.length; i++) {
  const m = await runOnce({ bun, args: MASK_PROGRAMS[i], workDir: join(runsDir, `startup-mask${i}`), timeoutMs });
  const t = await readTraceDir(m.dir);
  for (const r of t?.recs ?? []) if (!r.entryOnly) masked.add(`${r.sys}:${r.key}`);
}
const allCoords = [...coordMap.entries()];
// A call issued from INSIDE another module ('o:' key) is that module's own
// machinery - failing it fails system plumbing, lying about it fabricates an
// impossible world, delaying it is that module's scheduling. Such coordinates
// are excluded from the drawable pool entirely (not merely refused at draw
// time), so the fault surface is exactly the boundary bun crosses and the
// picker never comes up empty retrying on them. The sweeper drops the same.
const otherModule = (c: Coord) => c.key.startsWith("o:") && !ALPC_OK.has(c.sysName);
const coords = allCoords.filter(([id, c]) => !masked.has(id) && !otherModule(c)).map(([, c]) => c);
console.log(
  `  ${coordMap.size} injectable coordinate(s), ${coords.length} after startup mask, ` +
    `${baseTrace.recCount} records`,
);
// Depth weighting: draw call sites in proportion to how deep into the program
// they live (their LAST occurrence), so faults land in the meat, and pick
// hits biased toward the deep end of each site's lifetime.
const totalRecs = baseTrace.recs.length;
// Depth weight, boosted for curated (preferred-realistic) syscalls; generic
// surface calls still draw, at lower weight - never zero.
const weights = coords.map(c => (1 + (9 * c.last) / totalRecs) * (isCurated(c.sysName) ? 1 : 0.35));
const weightSum = weights.reduce((a, b) => a + b, 0);
const pickCoord = (): Coord => {
  let t = rnd() * weightSum;
  for (let i = 0; i < coords.length; i++) if ((t -= weights[i]) <= 0) return coords[i];
  return coords[coords.length - 1];
};
if (!coords.length) {
  console.error("no injectable coordinates in baseline");
  process.exit(1);
}
const slowMs = Math.max(8000, base.ms * 2);
const timedOutTests = (s: string) => (s.match(/timed out after \d+ms|\btimed out\b.*\bafter\b/gi) ?? []).length;
const baseTimeouts = timedOutTests(base.stdout + base.stderr);

// --- schedule generation ---------------------------------------------------
// Rules per run: at least 1, up to ~2x the mean (uniform), so density varies.
// Each rule: a random coordinate, a random hit within its lifetime (deep
// hits included), a random fault from that syscall's menu.
function drawSchedule(): string[] {
  const n = 1 + Math.floor(rnd() * (meanRules * 2 - 1 + 0.999));
  const rules = new Set<string>();
  let guard = 0;
  while (rules.size < n && guard++ < n * 8) {
    const c = pickCoord();
    const f = pick(faultsFor(c.sysName)!);
    // hit biased deep: sqrt of a uniform skews toward the late end
    let hit = Math.min(c.hits, 1 + Math.floor(Math.sqrt(rnd()) * c.hits));
    // The first event/semaphore creations are WTF/JSC threading primitives
    // made at init - failing them parks the process by design, not a bun
    // logic bug. Never fault their hit 1 (draw deeper, or skip if no depth).
    if ((c.sysName === "NtCreateEvent" || c.sysName === "NtCreateSemaphore") && hit === 1) {
      if (c.hits < 2) continue;
      hit = 2;
    }
    rules.add(`${c.sysName} ${c.key} ${hit} ${f.mode} ${f.status}`);
  }
  return [...rules];
}

// --- classification, shared with the sweeper's semantics --------------------
function classify(rr: ReplayResult): string {
  if (rr.outcome === "HANG") return "HANG";
  // Crash-on-OOM is by design (only oom-large - an absurd request - is a
  // real bug); a system-DLL top frame is sabotaged system code, not bun.
  if (rr.outcome === "CRASH") {
    if (rr.crashSig?.kind === "oom" || rr.crashSig?.kind === "debug-only") return "expected-abort";
    return rr.crashSig?.boundary === "system-module" ? "system-crash" : "CRASH";
  }
  if (rr.fired === 0) return "no-fire";
  if (rr.ms >= slowMs) return timedOutTests(rr.stdout + rr.stderr) > baseTimeouts ? "stalled" : "slow";
  if (rr.exitCode !== base.exitCode) return "error-exit";
  return "clean";
}
const isFinding = (o: string) => o === "CRASH" || o === "HANG" || o === "stalled";

// --- verify + minimize --------------------------------------------------------
// Captured on the first verify replay: where a HANG is stuck / a crash's
// stack. Without this a chaos HANG reaches the queue unreadable.
let capturedStacks: string[] = [];
async function reproduces(schedule: string[], dir: string, capture = false): Promise<boolean> {
  const rr = await replayCoordinate({ bun, args: progArgs, schedule: schedule.join("\n"), dir, timeoutMs, capture });
  if (capture) {
    const raw = rr.hangStacks ?? rr.crashDump ?? "";
    capturedStacks = raw ? digestStacks(raw) : [];
  }
  const ok = isFinding(classify(rr));
  // Per-trial retention (minimization can spawn dozens of multi-process
  // runs whose traces are GBs live at once): a trial that did NOT reproduce
  // is a pure negative - delete it whole; one that DID keeps only its small
  // text (the schedule IS the replay) - strip its raw traces immediately
  // rather than waiting for the whole minimize to finish.
  try {
    if (!ok) rmSync(dir, { recursive: true, force: true });
    else
      for (const f of readdirSync(dir))
        if (f.startsWith("wsf-") && f.endsWith(".log")) rmSync(join(dir, f), { force: true });
  } catch {}
  return ok;
}
// Greedy delta over rules: drop each rule if the finding still reproduces
// without it. What survives is the minimal (locally) reproducing schedule.
async function minimize(schedule: string[], dir: string): Promise<string[]> {
  let cur = [...schedule];
  for (let i = 0; i < cur.length && cur.length > 1; ) {
    const trial = cur.filter((_, k) => k !== i);
    if (await reproduces(trial, join(dir, `min${cur.length}_${i}`))) cur = trial;
    else i++;
  }
  return cur;
}

// --- known signatures: skip what triage already knows ------------------------
const knownKeys = new Set<string>();
for (const f of ["triaged.jsonl", "queue.jsonl"]) {
  const path = join(queueDir, f);
  if (!(await Bun.file(path).exists())) continue;
  for (const line of (await Bun.file(path).text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.dedupeKey) {
        knownKeys.add(e.dedupeKey);
        // Seed the primary-coordinate key too, so an already-triaged hang
        // absorbs its multi-rule variants immediately.
        if (e.dedupeKey.startsWith("chaos ")) {
          const site = e.dedupeKey.replace(/^chaos (HANG|stalled) /, "chaos ").split(" + ")[0];
          knownKeys.add(site);
        }
      }
    } catch {}
  }
}

// --- the loop -------------------------------------------------------------------
let iter = 0;
let findings = 0;
const qfile = join(queueDir, "queue.jsonl");
async function worker(w: number) {
  while (iter < iterations) {
    const n = ++iter;
    const schedule = drawSchedule();
    const dir = join(runsDir, `it${String(n).padStart(6, "0")}`);
    const rr = await replayCoordinate({ bun, args: progArgs, schedule: schedule.join("\n"), dir, timeoutMs, capture: false });
    const outcome = classify(rr);
    const mark = isFinding(outcome) ? "!!" : "  ";
    // The drawn coordinates ride along on every line: draws must be
    // auditable from the console alone (a name grep once proved nothing
    // because the schedule was never printed).
    console.log(
      `${mark} [${n}] ${outcome.padEnd(9)} rules=${schedule.length} fired=${rr.fired} ${rr.ms}ms  ` +
        schedule.map(r => r.split(" ").slice(0, 2).join(" ")).join(" ; "),
    );
    if (!isFinding(outcome)) {
      // not a case: nothing worth keeping
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      continue;
    }
    // A crash whose signature triage already knows: no verify, no
    // minimization, no queue - the answer is already recorded.
    if (rr.crashSig && knownKeys.has(`crash: ${rr.crashSig.signature}`)) {
      console.log(`   [${n}] known signature - skipping (${rr.crashSig.signature.slice(0, 50)})`);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      continue;
    }
    // Verify: replay the same schedule; two of three (including the
    // original) reproducing = confirmed. Then minimize.
    let bad = 1;
    capturedStacks = [];
    for (let v = 1; v <= 2; v++) if (await reproduces(schedule, join(dir, `verify${v}`), v === 1)) bad++;
    const stacks = [...capturedStacks];
    if (bad < 2) {
      console.log(`   [${n}] not reproduced on verify - discarding`);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      continue;
    }
    // A confirmed STALL (more tests timed out) ends at the runner's own
    // ceiling, before hang-capture engages - so it arrives without stacks
    // and cannot be told from load-slowness. Decide it here: one more
    // replay at 3x the timeout WITH capture. If it wedges past even that, it
    // is a real hang and its stuck stacks ride onto the finding; if it
    // completes, it was slowness under fault, not queued.
    let stallStacks: string[] = [];
    if (outcome === "stalled") {
      const long = await replayCoordinate({
        bun,
        args: progArgs,
        schedule: schedule.join("\n"),
        dir: join(dir, "stall-capture"),
        timeoutMs: timeoutMs * 3,
        capture: true,
      });
      const wedged = long.outcome === "HANG";
      stallStacks = wedged ? digestStacks(long.hangStacks ?? long.crashDump ?? "") : [];
      try {
        for (const f of readdirSync(join(dir, "stall-capture")))
          if (f.startsWith("wsf-") && f.endsWith(".log")) rmSync(join(dir, "stall-capture", f), { force: true });
      } catch {}
      if (!wedged) {
        console.log(`   [${n}] stall completed at 3x timeout (${long.ms}ms) - load slowness, not queued`);
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
        continue;
      }
      console.log(`   [${n}] stall WEDGED at 3x timeout - real hang, stacks captured`);
    }
    const minimal = await minimize(schedule, dir);
    findings++;
    await Bun.write(join(dir, "minimal-schedule.txt"), minimal.join("\n") + "\n");
    // Retention: the minimal schedule IS the replay; the raw traces of the
    // original run, its verify replays and the minimization trials are
    // scratch. Strip them, keep the small text (schedules, stdout/stderr).
    const stripTraces = (d: string) => {
      let ents: string[] = [];
      try {
        ents = readdirSync(d);
      } catch {
        return;
      }
      for (const f of ents) {
        const p = join(d, f);
        try {
          const st = statSync(p);
          if (st.isDirectory()) stripTraces(p);
          else if (f.startsWith("wsf-") && f.endsWith(".log")) rmSync(p, { force: true });
        } catch {}
      }
    };
    stripTraces(dir);
    console.log(`   [${n}] CONFIRMED ${outcome} - minimized ${schedule.length} -> ${minimal.length} rule(s)`);
    // Symbolize any bun-frame keys in the minimal schedule for the queue entry.
    const bunRvas = minimal.map(r => r.split(" ")[1]).filter(k => k.startsWith("b:")).map(k => k.slice(2));
    const syms = bunRvas.length ? await symbolize(bun, bunRvas) : new Map();
    const where = minimal
      .map(r => {
        const [sys, key] = r.split(" ");
        const s = key.startsWith("b:") ? syms.get(key.slice(2))?.sym : undefined;
        return s ? `${sys}@${s.replace(/\+0x[0-9a-f]+$/, "")}` : `${sys}@${key}`;
      })
      .join(" + ");
    const crash = rr.crashSig ?? (rr.stdout || rr.stderr ? detectCrash(rr.stdout, rr.stderr) : null);
    const dedupeKey = crash ? `crash: ${crash.signature}` : `chaos ${outcome} @ ${where}`;
    // A HANG's variants (same primary fault with different rider rules
    // surviving minimization) mint different full keys but are the same
    // bug: also dedupe on the PRIMARY coordinate - the first minimized
    // rule's site - so a reported one-rule hang absorbs its multi-rule twins.
    // Outcome-agnostic: HANG and stalled variants of one primary site are
    // the same bug ("chaos hang-class @ <site>"), so both collapse together.
    const primaryKey = crash ? "" : `chaos @ ${where.split(" + ")[0]}`;
    if (knownKeys.has(dedupeKey) || (primaryKey && knownKeys.has(primaryKey))) {
      console.log(`   [${n}] finding matches known ${dedupeKey.slice(0, 50)} - not re-queued`);
      continue;
    }
    if (primaryKey) knownKeys.add(primaryKey);
    knownKeys.add(dedupeKey);
    const entry = {
      queuedAt: stamp,
      dedupeKey,
      verdict: "confirmed",
      outcome,
      boundary: crash?.boundary ?? null,
      crashKind: crash?.kind ?? null,
      crashDetail: crash?.detail ?? null,
      expect: "must-handle",
      target: progArgs.join(" "),
      schedule: minimal.join(" ; "),
      symbol: where,
      module: "chaos",
      standalone: [`verified ${bad}/3`],
      lastStage: null,
      termChain: null,
      stacks: stacks.length ? stacks.slice(0, 12) : stallStacks.length ? stallStacks.slice(0, 12) : null,
      findings: join(dir, "minimal-schedule.txt"),
      workDir: dir,
    };
    // Atomic append - never read-modify-write (see the queue-clobber fix).
    appendFileSync(qfile, JSON.stringify(entry) + "\n");
  }
}
await Promise.all(Array.from({ length: jobs }, (_, w) => worker(w)));
console.log(`\nchaos done: ${iter} iteration(s), ${findings} confirmed finding(s)`);
