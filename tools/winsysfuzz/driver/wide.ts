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
//     [--timeout 45] [--jobs 8] [--rules 30] [--passes N] [--seed S]
//     [--work C:\wsfwide] [--queue C:\wsfqueue]

import { appendFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { faultsFor, NEVER_FAULT } from "./faults";
import { coordKey, detectCrash, digestStacks, ensureDir, manifest, readTraceDir, replayCoordinate, stamp } from "./lib";
const manifestNames = manifest.map(m => m.name);

// Never exit silently: log the reason for any death to stdout (the pass
// log) - an uncaught error, a rejected promise, or an explicit exit code.
process.on("uncaughtException", e => { console.log(`WIDE-DEATH uncaughtException: ${String(e && (e as Error).stack || e).slice(0, 600)}`); process.exit(1); });
process.on("unhandledRejection", e => { console.log(`WIDE-DEATH unhandledRejection: ${String(e && (e as Error).stack || e).slice(0, 600)}`); process.exit(1); });
process.on("exit", code => { if (code !== 0) console.log(`WIDE-DEATH exit code=${code} (no message logged means an explicit exit or external kill)`); });
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
// A broad schedule: many callsites per file so whichever paths the file
// exercises are covered (see drawSchedule). Default breadth, not depth.
const nRules = Math.max(1, +(flag("--rules", "30") as string));
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
// Per-binary census cache: two passes on different binaries (debug and
// release) must not overwrite each other's site sets - the callsite RVAs
// differ per build. The binary tag names the cache file.
const censusBunTag = ((await Bun.file(bun!).exists()) ? String((await Bun.file(bun!).stat()).size) : "0") + "-" + basename(bun!);
const censusPath = join(queueDir, `wide-census-${censusBunTag.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
const startupKeys = new Set<string>();
const siteMap = new Map<string, Site>();
{
  const maskDir = join(workRoot, "runs", "census");
  ensureDir(maskDir);
  const bunTag = censusBunTag;
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
      for (const r of t?.recs ?? []) if (!r.entryOnly) startupKeys.add(`${manifestNames[r.sys]} ${coordKey(r)}`);
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
          const ck = coordKey(r);
          const id = `${sysName} ${ck}`;
          if (startupKeys.has(id)) continue;
          const s = siteMap.get(id);
          if (s) s.seen++;
          else siteMap.set(id, { sysName, key: ck, seen: 1 });
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
// child. A callsite key never drifts, so a hit replays. Drawn as a BROAD
// schedule (many distinct callsites per file, no repeats): a specific
// callsite only fires when the file exercises that path, and a random 3 of
// ~150 mostly missed (74% no-fire) - coverage across many callsites at once
// means a file firing on whichever paths it actually touches, while the
// per-file cost stays one run.
function drawSchedule(): string[] {
  const rules = new Set<string>();
  const used = new Set<string>(); // one rule per callsite
  let guard = 0;
  const want = Math.min(nRules, sites.length);
  while (used.size < want && guard++ < want * 8) {
    const site = pickSite();
    const id = `${site.sysName} ${site.key}`;
    if (used.has(id)) continue;
    const faults = faultsFor(site.sysName);
    if (!faults) continue;
    used.add(id);
    const f = pick(faults);
    const r = rnd();
    const hit = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    rules.add(`${site.sysName} ${site.key} ${hit} ${f.mode} ${f.status}`);
  }
  return [...rules];
}

// --- unverified recurrence: a race that fires 1-in-N never reproduces in
// two immediate replays, but its SIGNATURE recurring across independent
// runs IS the reproduction. Count prior drops per signature; a recurring
// signature is escalated to the queue instead of dropped again.
const unverifiedPath = join(queueDir, "wide-unverified.log");
const unverifiedCount = new Map<string, number>();
try {
  if (await Bun.file(unverifiedPath).exists()) {
    for (const line of (await Bun.file(unverifiedPath).text()).split("\n")) {
      const sig = line.split("\t")[3];
      if (sig) unverifiedCount.set(sig, (unverifiedCount.get(sig) ?? 0) + 1);
    }
  }
} catch {}
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
  }).catch(e => {
    // A spawn/IO failure under load must never abort the whole pass;
    // account it as a driver error for this one file and move on.
    console.error(`  [driver-error] ${basename(file)}: ${String(e).slice(0, 160)}`);
    return null;
  });
  if (!rr) {
    onFate(0, "driver-error", null);
    return null;
  }
  // Did any rule actually fire? (a file that never issues the syscall is a
  // clean pass by construction - not a finding, not even a coverage claim)
  let outcome: string | null = null;
  let detail = "";
  if (rr.outcome === "hang") {
    outcome = "HANG";
    detail = "no exit before timeout";
  } else {
    const crash = rr.crashSig ?? (rr.stdout || rr.stderr ? detectCrash(rr.stdout, rr.stderr) : null);
    if (crash && !/oom|debug-only|intentional-fatal/.test(crash.kind) && crash.boundary !== "system-module") {
      outcome = "CRASH";
      // Keep the UNFOLDED matched text (real index/size values are the
      // diagnosis); the folded signature is only the dedupe key below.
      detail = crash.detail;
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
  // The crash's identity and its captured stack, BEFORE verification: an
  // unverified one-shot must still leave its faulting stack behind (a
  // native segfault prints no frames of its own - the crash DUMP is the
  // only stack, and it lives in rr, not in the panic text).
  const crashSig = rr.crashSig ?? (rr.stdout || rr.stderr ? detectCrash(rr.stdout, rr.stderr) : null);
  const stacks =
    rr.hangStacks || rr.crashDump
      ? digestStacks(rr.hangStacks ?? rr.crashDump ?? "")
      : (crashSig?.frames ?? []).slice(0, 24);
  // In-pass verification: a single crash/hang under 8-way load often will
  // not replay solo later (timing-sensitive, or a false signature). Replay
  // the schedule twice NOW, under the same load that produced it, and queue
  // only what reproduces; the rest go to a lightweight ledger beside the
  // queue so a signature RECURRING across passes stays visible.
  if (outcome === "CRASH" || outcome === "HANG") {
    const sched = schedule.join("\n");
    const sig = outcome === "CRASH" ? (rr.crashSig ?? detectCrash(rr.stdout, rr.stderr))?.signature ?? "" : "HANG";
    let repro = 0;
    for (let v = 1; v <= 2; v++) {
      const vdir = join(dir, `verify${v}`);
      const vr = await replayCoordinate({ bun: bun!, args: ["test", file], schedule: sched, dir: vdir, timeoutMs, capture: false }).catch(
        () => null,
      );
      const vsig = vr ? (vr.crashSig ?? detectCrash(vr.stdout, vr.stderr))?.signature ?? "" : "";
      const bad = vr && (outcome === "CRASH" ? vsig === sig : vr.outcome === "hang");
      try {
        rmSync(vdir, { recursive: true, force: true });
      } catch {}
      if (bad) repro++;
    }
    if (repro === 0) {
      const key = (sig || detail).slice(0, 120);
      const prior = unverifiedCount.get(key) ?? 0;
      unverifiedCount.set(key, prior + 1);
      // The captured crash-dump stack (native crashes) or the panic's own
      // frames: the one thing that makes an unreproduced sighting worth
      // reading later. The run dir is KEPT (traces stripped) so the dump
      // and stdout/stderr survive alongside this ledger line.
      const frames = (stacks && stacks.length ? stacks : (crashSig?.frames ?? [])).slice(0, 12).join(" || ");
      try {
        appendFileSync(
          unverifiedPath,
          `${new Date().toISOString()}\t${outcome}\t${basename(file)}\t${key}\t${schedule.join(" ; ")}\t${frames}\t${dir}\n`,
        );
      } catch {}
      if (prior + 1 >= 2) {
        // Recurring signature: escalate as a finding (falls through to the
        // queue below with a verdict naming the recurrence count).
        console.log(`  [${outcome} RECURRING x${prior + 1} - escalating] ${basename(file)}: ${key.slice(0, 60)}`);
        detail = `${detail} [recurring x${prior + 1}, unreproduced in-pass]`;
      } else {
        console.log(`  [${outcome} unverified 0/2 - logged] ${basename(file)}: ${key.slice(0, 70)}`);
        // Keep this run dir: its crash dump / output is the only evidence
        // an unreproduced one-shot has. Strip the raw trace, retain the rest.
        try {
          for (const f of readdirSync(dir)) if (f.startsWith("wsf-") && f.endsWith(".log")) rmSync(join(dir, f), { force: true });
        } catch {}
        return null;
      }
    }
    detail = `${detail}${outcome === "CRASH" ? "" : ""}`; // (signature unchanged)
    console.log(`  [${outcome} verified ${repro}/2] ${basename(file)}`);
  }
  // Retention: the schedule is the replay; strip the raw trace.
  try {
    for (const f of readdirSync(dir)) if (f.startsWith("wsf-") && f.endsWith(".log")) rmSync(join(dir, f), { force: true });
  } catch {}

  const key =
    outcome === "CRASH"
      ? `crash: ${crashSig?.signature ?? detail}` // folded signature: stable dedupe
      : `wide ${outcome} @ ${basename(file)}: ${detail.slice(0, 80)}`;
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
      if (knownKeys.has(h.key)) {
        // A known signature reproduced AGAIN, in-pass: never waste it. Append
        // the fresh evidence (raw detail, captured stacks, schedule, file) to
        // a recurrence ledger - the newest reproduction of a known finding is
        // often the one that finally carries a usable stack.
        try {
          appendFileSync(
            join(queueDir, "wide-recurrence.log"),
            JSON.stringify({ at: new Date().toISOString(), key: h.key, file: h.file, detail: h.detail, stacks: h.stacks.slice(0, 12), schedule: h.schedule.join(" ; ") }) + "\n",
          );
        } catch {}
        console.log(`  [known signature reproduced - evidence appended] ${basename(h.file)}: ${h.key.slice(0, 60)}`);
        continue;
      }
      knownKeys.add(h.key);
      const entry = {
        queuedAt: stamp,
        dedupeKey: h.key,
        verdict: /recurring x/.test(h.detail) ? "wide-recurring" : "wide-verified", // in-pass repro, or signature recurrence across runs
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
