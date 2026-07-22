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

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { FAULTS } from "./faults";
import {
  detectCrash,
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
  if (!(sysName in FAULTS)) return;
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
const masked = new Set<string>();
for (let i = 0; i < MASK_PROGRAMS.length; i++) {
  const m = await runOnce({ bun, args: MASK_PROGRAMS[i], workDir: join(runsDir, `startup-mask${i}`), timeoutMs });
  const t = await readTraceDir(m.dir);
  for (const r of t?.recs ?? []) if (!r.entryOnly) masked.add(`${r.sys}:${r.key}`);
}
const allCoords = [...coordMap.entries()];
// Also exclude completion-dequeue calls (NtRemoveIoCompletion[Ex]) made
// from another module's private worker loop ('o:' key): faulting a system
// DLL's own dequeue thread sabotages system code, not bun - such findings
// are never bun-attributable.
const privateDequeue = (c: Coord) => c.key.startsWith("o:") && c.sysName.startsWith("NtRemoveIoCompletion");
const coords = allCoords.filter(([id, c]) => !masked.has(id) && !privateDequeue(c)).map(([, c]) => c);
console.log(
  `  ${coordMap.size} injectable coordinate(s), ${coords.length} after startup mask, ` +
    `${baseTrace.recCount} records`,
);
// Depth weighting: draw call sites in proportion to how deep into the program
// they live (their LAST occurrence), so faults land in the meat, and pick
// hits biased toward the deep end of each site's lifetime.
const totalRecs = baseTrace.recs.length;
const weights = coords.map(c => 1 + (9 * c.last) / totalRecs); // 1..10 by depth
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
    const f = pick(FAULTS[c.sysName]);
    // hit biased deep: sqrt of a uniform skews toward the late end
    const hit = Math.min(c.hits, 1 + Math.floor(Math.sqrt(rnd()) * c.hits));
    rules.add(`${c.sysName} ${c.key} ${hit} ${f.mode} ${f.status}`);
  }
  return [...rules];
}

// --- classification, shared with the sweeper's semantics --------------------
function classify(rr: ReplayResult): string {
  if (rr.outcome === "HANG") return "HANG";
  if (rr.outcome === "CRASH") return rr.crashSig?.boundary === "system-module" ? "system-crash" : "CRASH";
  if (rr.fired === 0) return "no-fire";
  if (rr.ms >= slowMs) return timedOutTests(rr.stdout + rr.stderr) > baseTimeouts ? "stalled" : "slow";
  if (rr.exitCode !== base.exitCode) return "error-exit";
  return "clean";
}
const isFinding = (o: string) => o === "CRASH" || o === "HANG" || o === "stalled";

// --- verify + minimize --------------------------------------------------------
async function reproduces(schedule: string[], dir: string): Promise<boolean> {
  const rr = await replayCoordinate({ bun, args: progArgs, schedule: schedule.join("\n"), dir, timeoutMs, capture: false });
  return isFinding(classify(rr));
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
    console.log(`${mark} [${n}] ${outcome.padEnd(9)} rules=${schedule.length} fired=${rr.fired} ${rr.ms}ms`);
    if (!isFinding(outcome)) {
      // not a case: nothing worth keeping
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      continue;
    }
    // Verify: replay the same schedule; two of three (including the
    // original) reproducing = confirmed. Then minimize.
    let bad = 1;
    for (let v = 1; v <= 2; v++) if (await reproduces(schedule, join(dir, `verify${v}`))) bad++;
    if (bad < 2) {
      console.log(`   [${n}] not reproduced on verify - discarding`);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      continue;
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
    const entry = {
      queuedAt: stamp,
      dedupeKey: crash ? `crash: ${crash.signature}` : `chaos ${outcome} @ ${where}`,
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
      stacks: null,
      findings: join(dir, "minimal-schedule.txt"),
      workDir: dir,
    };
    const prev = (await Bun.file(qfile).exists()) ? await Bun.file(qfile).text() : "";
    await Bun.write(qfile, prev + JSON.stringify(entry) + "\n");
  }
}
await Promise.all(Array.from({ length: jobs }, (_, w) => worker(w)));
console.log(`\nchaos done: ${iter} iteration(s), ${findings} confirmed finding(s)`);
