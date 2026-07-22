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

import { appendFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { faultsFor, NEVER_FAULT } from "./faults";
import { detectCrash, digestStacks, ensureDir, manifest, readTraceDir, replayCoordinate, stamp } from "./lib";
const manifestNames = manifest.map(m => m.name);

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

// --- the callsite census ----------------------------------------------------
// Targeting by occurrence COUNT ("<sys> * <hit-past-startup>") tested
// nothing on short programs: startup issues hundreds of the hot syscalls,
// a short test's own code (or a spawned child) never reaches occurrence
// N-hundred, and 55% of runs never fired - and a count-keyed hit doesn't
// even land on the same occurrence twice, so hits didn't replay. Target by
// CALLSITE instead: bun's syscall callsites are fixed RVAs in the binary,
// the same in every program. Trace a broad sample of test files once
// unfaulted (the census), union every (syscall, callsite-key) seen, and
// subtract every key the startup probes touch - what remains is the
// universe of PROGRAM callsites, drawable at hit 1..3 like the sweeper's
// mask, but shared across the whole pass. Persisted beside the queue so a
// later pass reuses it (a fresh census also runs when the binary changed).
type Site = { sysName: string; key: string; seen: number };
const censusPath = join(queueDir, "wide-census.json");
const startupKeys = new Set<string>();
const siteMap = new Map<string, Site>();
{
  const maskDir = join(workRoot, "runs", "census");
  ensureDir(maskDir);
  const bunTag = await Bun.file(bun!).exists() ? String((await Bun.file(bun!).stat()).size) + ":" + basename(bun!) : basename(bun!);
  let cached: { bunTag?: string; startup?: string[]; sites?: Site[] } | null = null;
  try {
    cached = await Bun.file(censusPath).json();
  } catch {}
  if (cached && cached.bunTag === bunTag && cached.sites?.length) {
    for (const k of cached.startup ?? []) startupKeys.add(k);
    for (const s of cached.sites ?? []) siteMap.set(`${s.sysName} ${s.key}`, s);
    console.log(`  census (cached, ${bunTag}): ${siteMap.size} program callsite(s), ${startupKeys.size} startup key(s)`);
  } else {
    // Startup keys: the test runner on a trivial test + a plain child.
    const trivial = join(maskDir, "wsf-trivial.test.ts");
    await Bun.write(trivial, `import { test, expect } from "bun:test";\ntest("wsf-trivial", () => { expect(1).toBe(1); });\n`);
    for (const [i, args] of ([
      ["test", trivial],
      ["-e", "0"],
    ] as string[][]).entries()) {
      const d = join(maskDir, `startup${i}`);
      await replayCoordinate({ bun: bun!, args, schedule: "", dir: d, timeoutMs, capture: false }).catch(() => null);
      const t = await readTraceDir(d).catch(() => null);
      for (const r of t?.recs ?? []) if (!r.entryOnly) startupKeys.add(`${manifestNames[r.sys]} ${r.key}`);
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    // The census: a diverse unfaulted sample of the frontier itself.
    const shuffled = [...files];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const sample = shuffled.slice(0, 40);
    console.log(`  census: tracing ${sample.length} sample file(s) unfaulted...`);
    let done = 0;
    let ci = 0;
    const censusWorker = async () => {
      for (;;) {
        const i = ci++;
        if (i >= sample.length) return;
        const d = join(maskDir, `c${i}`);
        await replayCoordinate({ bun: bun!, args: ["test", sample[i]], schedule: "", dir: d, timeoutMs, capture: false }).catch(
          () => null,
        );
        // Full trace (NOT faultsOnly - that flag skips the ordinary records
        // the census exists to count).
        const t = await readTraceDir(d).catch(() => null);
        for (const r of t?.recs ?? []) {
          if (r.entryOnly) continue;
          const sysName = manifestNames[r.sys];
          if (!sysName || NEVER_FAULT.has(sysName) || !faultsFor(sysName)) continue;
          // 'o:'-keyed calls are another module's own machinery - not bun's
          // boundary; never a fault site (same rule as the sweeper).
          if (r.key.startsWith("o:")) continue;
          const id = `${sysName} ${r.key}`;
          if (startupKeys.has(id)) continue;
          const s = siteMap.get(id);
          if (s) s.seen++;
          else siteMap.set(id, { sysName, key: r.key, seen: 1 });
        }
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {}
        if (++done % 10 === 0) console.log(`  census: ${done}/${sample.length} traced, ${siteMap.size} program callsite(s)`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(jobs, 6) }, censusWorker));
    await Bun.write(
      censusPath,
      JSON.stringify({ bunTag, startup: [...startupKeys], sites: [...siteMap.values()] }, null, 0),
    );
    console.log(`  census: ${siteMap.size} program callsite(s), ${startupKeys.size} startup key(s) excluded`);
  }
}
const sites = [...siteMap.values()];
if (!sites.length) {
  console.error("census found no program callsites - cannot target");
  process.exit(1);
}
// Weight callsites by how many census files exercised them (broadly-used
// call paths draw more) but keep every site drawable.
const siteWeights = sites.map(s => 1 + Math.log2(1 + s.seen));
const siteWeightSum = siteWeights.reduce((a, b) => a + b, 0);
const pickSite = (): Site => {
  let t = rnd() * siteWeightSum;
  for (let i = 0; i < sites.length; i++) if ((t -= siteWeights[i]) <= 0) return sites[i];
  return sites[sites.length - 1];
};
// "<syscall> <key> <hit> <mode> <status>": a specific program callsite at a
// LOW hit index - the test's first/second call through that path, however
// much startup traffic preceded it, and equally reachable in a spawned
// child. A callsite key never drifts, so a hit replays.
function drawSchedule(): string[] {
  const rules = new Set<string>();
  let guard = 0;
  while (rules.size < nRules && guard++ < nRules * 6) {
    const site = pickSite();
    const faults = faultsFor(site.sysName);
    if (!faults) continue;
    const f = pick(faults);
    const r = rnd();
    const hit = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    rules.add(`${site.sysName} ${site.key} ${hit} ${f.mode} ${f.status}`);
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

// Leak judgment needs a baseline of STANDING handles: every bun test process
// holds the crypto devices (KsecDD/CNG), COM/OLE and winsock-catalog
// registry keys and the test-tree directory handles at exit by design - an
// absolute count fires on all of them. One unfaulted probe run supplies the
// standing set for the whole wide pass; only surpluses over it can leak.
const harnessPath = /\\runs\\|\\cwd\b|\\wsf-\d+\.log|\\(stdout|stderr)\.txt|\bwsfwide\b/i;
const notWorkloadIo = /(Local\\|Global\\|BaseNamedObjects|WilError|\\SM0:|\.mui\b|\.dll\b|\.nls\b|\.(ts|tsx|js|mjs|cjs|mts|cts|jsx)$)/i;
const normLeak = (l: string) =>
  l
    .trim()
    .replace(/(\\pipe\\uv\\\d+)-\d+/i, "$1-<pid>")
    .replace(/^([fpks]) .*\\(test|node_modules)\\.*$/i, "$1 <tree-dir>"); // any dir under the test tree
const workloadLeaks = (leaks: string[]) =>
  leaks.map(normLeak).filter(l => !harnessPath.test(l) && !notWorkloadIo.test(l));
const countKinds = (leaks: string[]) => {
  const m = new Map<string, number>();
  for (const l of workloadLeaks(leaks)) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
};
// The standing set: one clean run of the first file, no schedule.
const probeDir = join(workRoot, "runs", "standing-probe");
await replayCoordinate({ bun, args: ["test", files[0]], schedule: "", dir: probeDir, timeoutMs, capture: false }).catch(
  () => null,
);
const standingTrace = await readTraceDir(probeDir, { faultsOnly: true }).catch(() => null);
// Standing set = max per-process counts across the probe's processes.
const standing = new Map<string, number>();
for (const proc of standingTrace?.leaksByProc ?? [standingTrace?.leaks ?? []])
  for (const [k, n] of countKinds(proc)) standing.set(k, Math.max(standing.get(k) ?? 0, n));
console.log(`  standing handle kinds at exit (from probe): ${standing.size}`);
// Per-PROCESS judgment: a test spawning N children has N standing sets;
// only a process whose OWN handles exceed the standing counts leaks.
const leakSurplus = (leaksByProc: string[][]): string[] => {
  const worst = new Map<string, number>();
  for (const proc of leaksByProc)
    for (const [k, n] of countKinds(proc)) {
      const over = n - (standing.get(k) ?? 0);
      if (over > 0) worst.set(k, Math.max(worst.get(k) ?? 0, over));
    }
  return [...worst].map(([k, over]) => (over > 1 ? `${k} x${over}` : k));
};

// --- one file, one schedule -------------------------------------------------
type Hit = { file: string; schedule: string[]; outcome: string; key: string; detail: string; stacks: string[] };
// Set by the pass loop: receives (fired, outcome) for every completed run.
let onFate: (fired: number, outcome: string, exitCode: number | null) => void = () => {};
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
    }
    // No leak oracle in the wide pass: bun fast-exits without closing
    // handles by design, so "named handle open at exit" is only meaningful
    // against what the SAME program normally holds at exit - the sweeper
    // and chaos have that baseline; a callsite-agnostic wide pass has no
    // per-program baseline, and no standing set can cover every program's
    // legitimate exit-time handles. Crash and hang stand alone here.
  }
  onFate(rr.fired, outcome ?? (rr.outcome === "hang" ? "HANG" : "exit"), rr.exitCode);
  // A test whose OWN PURPOSE is to crash (crash-handler tests deliberately
  // segfault - one uses 0xDEADBEEF as its poison address) produces this
  // signature by design. With no per-file baseline the pass can't know that
  // in advance, so on a crash hit run the file once UNFAULTED: if the
  // control crashes with the same signature, the crash is the test's
  // intent, not a finding. One extra run per (rare) hit, none per file.
  if (outcome === "CRASH") {
    const ctrlDir = join(dir, "control");
    const ctrl = await replayCoordinate({ bun: bun!, args: ["test", file], schedule: "", dir: ctrlDir, timeoutMs, capture: false }).catch(
      () => null,
    );
    const ctrlCrash = ctrl ? (ctrl.crashSig ?? detectCrash(ctrl.stdout, ctrl.stderr)) : null;
    try {
      rmSync(ctrlDir, { recursive: true, force: true });
    } catch {}
    if (ctrlCrash && ctrlCrash.signature === (rr.crashSig ?? detectCrash(rr.stdout, rr.stderr))?.signature) {
      outcome = null; // the test crashes on purpose: its baseline IS this crash
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
  // Fate of every run: a pass is only worth what actually FIRED. no-fire
  // = no rule ever matched (the fault never reached the program); baseline
  // states (clean/error-exit without a hit) show the oracles saw a real run.
  const fate: Record<string, number> = { fired: 0, noFire: 0, hang: 0, crash: 0, errorExit: 0, driverError: 0 };
  const reportFate = () => {
    const n = fate.fired + fate.noFire + fate.driverError;
    if (!n) return;
    const pct = (k: number) => `${Math.round((100 * k) / n)}%`;
    console.log(
      `  -- ${n} run(s): fired ${fate.fired} (${pct(fate.fired)}), NO-FIRE ${fate.noFire} (${pct(fate.noFire)}), ` +
        `crash ${fate.crash}, hang ${fate.hang}, error-exit ${fate.errorExit}, driver-error ${fate.driverError}`,
    );
  };
  const t0 = Date.now();
  onFate = (firedN, outcome, exitCode) => {
    if (firedN === 0) fate.noFire++;
    else fate.fired++;
    if (outcome === "CRASH") fate.crash++;
    else if (outcome === "HANG") fate.hang++;
    else if (exitCode !== 0 && exitCode !== null) fate.errorExit++;
  };
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const file = files[i];
      let h: Hit | null = null;
      try {
        h = await runFile(file, (pass - 1) * files.length + i);
      } catch (e) {
        fate.driverError++;
        console.log(`  ! ${basename(file)}: ${String(e).slice(0, 80)}`);
      }
      if ((i + 1) % 25 === 0) reportFate();
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
      // Atomic append (never read-modify-write): eight concurrent workers
      // rewriting the whole file interleaved a truncated read and clobbered
      // the queue. A single small O_APPEND-style write is atomic.
      appendFileSync(join(queueDir, "queue.jsonl"), JSON.stringify(entry) + "\n");
      queued++;
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  const min = ((Date.now() - t0) / 60000).toFixed(1);
  reportFate();
  console.log(`pass ${pass} done in ${min}m: ${files.length} file(s), ${hits} hit(s), ${queued} new queued`);
}
