// The WIDE pass: breadth of code exercised per hour, not depth per target.
// Walk a whole tree of test files and run each one ONCE under a single
// random fault schedule of callsite-agnostic rules ("<syscall> * <hit>
// <mode> <status>" - '*' matches any callsite, so no per-file baseline is
// needed and each file costs exactly one run). Keep only files where the
// fault fired AND something happened (crash / hang / leak / corruption
// signature); everything else is discarded on the spot. A pass over the
// entire test suite touches vastly more distinct bun code than hundreds of
// iterations on a few targets - the point when the goal is to trip over
// as many different bugs as fast as possible.
//
//   bun driver/wide.ts --bun <bun.exe> --root C:\bun\test\js [--root ...]
//     [--timeout 45] [--jobs 8] [--rules 3] [--passes N] [--seed S]
//     [--work C:\wsfwide] [--queue C:\wsfqueue]

import { readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { FAULTS } from "./faults";
import { detectCrash, digestStacks, ensureDir, readTraceDir, replayCoordinate, stamp } from "./lib";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const flags = (n: string) => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));
const bun = flag("--bun");
const roots = flags("--root");
if (!bun || !roots.length) {
  console.error("usage: wide.ts --bun <bun.exe> --root <test-dir> [--root ...] [options]");
  process.exit(2);
}
const timeoutMs = 1000 * +(flag("--timeout", "45") as string);
const jobs = Math.max(1, +(flag("--jobs", "8") as string));
const nRules = Math.max(1, +(flag("--rules", "3") as string));
const passes = +(flag("--passes", "0") as string) || Infinity;
const workRoot = join(flag("--work", "C:\\wsfwide") as string, stamp);
const queueDir = flag("--queue", "C:\\wsfqueue") as string;
ensureDir(workRoot);
ensureDir(queueDir);

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

// --- the file frontier ------------------------------------------------------
// Every test file under the roots (leak/stress/soak excluded - they run
// near their own timeouts by design and read every perturbation as a stall).
const walk = (dir: string, out: string[]) => {
  let ents: string[] = [];
  try {
    ents = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of ents) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!/^(node_modules|fixtures|__snapshots__)$/i.test(e)) walk(p, out);
    } else if (/\.test\.(ts|tsx|js|mjs|cjs)$/.test(e) && !/leak|stress|soak|bench|fuzz/i.test(e)) out.push(p);
  }
};
const files: string[] = [];
for (const r of roots) walk(r, files);
if (!files.length) {
  console.error("no test files found under the given roots");
  process.exit(1);
}
console.log(`wide: ${files.length} test file(s) across ${roots.length} root(s), ${jobs} parallel, ${nRules} rule(s)/file`);

// --- callsite-agnostic schedules --------------------------------------------
// "<syscall> * <hit> <mode> <status>": any callsite of that syscall, the
// Nth (or every) occurrence. Hits are drawn low-to-mid (short tests have
// few of any given call) with a chance of '*' = every occurrence.
const menu = Object.entries(FAULTS);
function drawSchedule(): string[] {
  const rules = new Set<string>();
  let guard = 0;
  while (rules.size < nRules && guard++ < nRules * 6) {
    const [sysName, faults] = pick(menu);
    const f = pick(faults);
    const r = rnd();
    let hit: string | number = r < 0.15 ? "*" : 1 + Math.floor(rnd() * (r < 0.6 ? 4 : 24));
    // The first event/semaphore creations and the first closes are process
    // init (JSC/WTF primitives, loader) - by-design init fatals, not bugs.
    // With no baseline there is no mask, so floor the hit index instead.
    if (/^(NtCreateEvent|NtCreateSemaphore|NtClose|NtCreateSection|NtMapViewOfSection)$/.test(sysName)) {
      if (hit === "*" || (typeof hit === "number" && hit < 3)) hit = 3 + Math.floor(rnd() * 20);
    }
    rules.add(`${sysName} * ${hit} ${f.mode} ${f.status}`);
  }
  return [...rules];
}

// --- known signatures: never re-report a triaged/queued finding ------------
const knownKeys = new Set<string>();
for (const f of ["triaged.jsonl", "queue.jsonl"]) {
  const path = join(queueDir, f);
  if (!(await Bun.file(path).exists())) continue;
  for (const line of (await Bun.file(path).text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.dedupeKey) knownKeys.add(e.dedupeKey);
    } catch {}
  }
}

// Leak-set diff needs a per-file baseline we don't take (one run per file
// is the whole point) - so the wide pass detects leaks by an ABSOLUTE rule:
// more than a handful of leaked named workload-I/O handles is worth a look.
const harnessPath = /\\runs\\|\\cwd\b|\\wsf-\d+\.log|\\(stdout|stderr)\.txt|\bwsfwide\b/i;
const notWorkloadIo = /(Local\\|Global\\|BaseNamedObjects|WilError|\\SM0:|\.mui\b|\.dll\b|\.nls\b|\.(ts|tsx|js|mjs|cjs|mts|cts|jsx)$)/i;
const workloadLeaks = (leaks: string[]) =>
  leaks
    .map(l => l.trim().replace(/(\\pipe\\uv\\\d+)-\d+/i, "$1-<pid>"))
    .filter(l => !harnessPath.test(l) && !notWorkloadIo.test(l));

// --- one file, one schedule -------------------------------------------------
type Hit = { file: string; schedule: string[]; outcome: string; key: string; detail: string; stacks: string[] };
async function runFile(file: string, idx: number): Promise<Hit | null> {
  const schedule = drawSchedule();
  const dir = join(workRoot, "runs", `w${String(idx).padStart(5, "0")}`);
  const rr = await replayCoordinate({
    bun: bun!,
    args: ["test", file],
    schedule: schedule.join("\n"),
    dir,
    timeoutMs,
    capture: true,
  });
  // Did any rule actually fire? (a file that never issues the syscall is a
  // clean pass by construction - not a finding, not even a coverage claim)
  let outcome: string | null = null;
  let detail = "";
  if (rr.outcome === "hang") {
    outcome = "HANG";
    detail = "no exit before timeout";
  } else {
    const crash = rr.crashSig ?? (rr.stdout || rr.stderr ? detectCrash(rr.stdout, rr.stderr) : null);
    if (crash && !/oom|debug-only/.test(crash.kind) && crash.boundary !== "system-module") {
      outcome = "CRASH";
      detail = crash.signature;
    } else {
      const t = await readTraceDir(dir, { faultsOnly: true }).catch(() => null);
      const leaks = t ? workloadLeaks(t.leaks) : [];
      if (leaks.length >= 3) {
        outcome = "leak";
        detail = leaks.slice(0, 6).join(", ");
      }
    }
  }
  if (!outcome || rr.fired === 0) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
    return null;
  }
  // Retention: the schedule is the replay; strip the raw trace.
  try {
    for (const f of readdirSync(dir)) if (f.startsWith("wsf-") && f.endsWith(".log")) rmSync(join(dir, f), { force: true });
  } catch {}
  const stacks = rr.hangStacks || rr.crashDump ? digestStacks(rr.hangStacks ?? rr.crashDump ?? "") : [];
  const key = outcome === "CRASH" ? `crash: ${detail}` : `wide ${outcome} @ ${basename(file)}: ${detail.slice(0, 80)}`;
  return { file, schedule, outcome, key, detail, stacks };
}

// --- the pass -----------------------------------------------------------------
let pass = 0;
while (pass++ < passes) {
  // Shuffle the frontier each pass: different files first, and each file
  // gets a freshly drawn schedule per pass.
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }
  console.log(`\n=== wide pass ${pass}: ${files.length} file(s) ===`);
  let next = 0;
  let hits = 0;
  let queued = 0;
  const t0 = Date.now();
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const file = files[i];
      let h: Hit | null = null;
      try {
        h = await runFile(file, (pass - 1) * files.length + i);
      } catch (e) {
        console.log(`  ! ${basename(file)}: ${String(e).slice(0, 80)}`);
      }
      if (!h) continue;
      hits++;
      console.log(`  [${h.outcome}] ${basename(h.file)}  <-  ${h.schedule.join(" ; ")}`);
      if (knownKeys.has(h.key)) continue;
      knownKeys.add(h.key);
      const entry = {
        queuedAt: stamp,
        dedupeKey: h.key,
        verdict: "wide-single", // one occurrence, unverified: the triager replays first
        outcome: h.outcome,
        boundary: null,
        crashKind: null,
        crashDetail: h.detail || null,
        expect: "must-handle",
        target: `test ${h.file}`,
        schedule: h.schedule.join(" ; "),
        symbol: h.detail.slice(0, 60),
        module: "wide",
        standalone: null,
        lastStage: null,
        termChain: null,
        stacks: h.stacks.slice(0, 12),
        findings: join(workRoot, "runs"),
        workDir: workRoot,
      };
      const qfile = join(queueDir, "queue.jsonl");
      const prev = (await Bun.file(qfile).exists()) ? await Bun.file(qfile).text() : "";
      await Bun.write(qfile, prev + JSON.stringify(entry) + "\n");
      queued++;
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  const min = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`pass ${pass} done in ${min}m: ${files.length} file(s), ${hits} hit(s), ${queued} new queued`);
}
