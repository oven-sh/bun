// The API-surface engine: generate a program (gen.ts) -> run it against
// the target binary under the crash/hang oracles -> verify a crash by
// re-running the SAME program -> queue it with its seed. The seed IS the
// replay: `gen.ts --seed S` regenerates the byte-identical program.
//
// No fault injection here - the fuzzed thing is bun's own API handling of
// generated argument values and call sequences (paths, buffers, object
// lifecycles). Pair with page heap / ASAN so silent heap corruption
// faults deterministically.
//
//   bun driver/genrun.ts --bun <bun.exe> [--jobs 24] [--iterations 0]
//     [--statements 40] [--timeout 30] [--work C:\wsfgenrun]
//     [--queue C:\wsfqueue] [--seed-base N]

import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { detectCrash, ensureDir, stamp } from "./lib";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const bun = flag("--bun");
if (!bun) {
  console.error("usage: genrun.ts --bun <bun.exe> [options]");
  process.exit(2);
}
const jobs = Math.max(1, +(flag("--jobs", "24") as string));
const iterations = +(flag("--iterations", "0") as string) || Infinity;
const statements = flag("--statements", "40") as string;
const timeoutMs = 1000 * +(flag("--timeout", "30") as string);
const workRoot = join(flag("--work", "C:\\wsfgenrun") as string, stamp);
const queueDir = flag("--queue", "C:\\wsfqueue") as string;
let seedNext = +(flag("--seed-base", String((Date.now() % 1e9) | 0)) as string);
ensureDir(workRoot);
ensureDir(queueDir);
const here = import.meta.dir;
const genScript = join(here, "gen.ts");
console.log(`genrun: bun=${bun} jobs=${jobs} timeout=${timeoutMs / 1000}s seed-base=${seedNext}`);

// Known signatures: never re-queue what triage already knows.
const knownKeys = new Set<string>();
for (const f of ["triaged.jsonl", "queue.jsonl"]) {
  const p = join(queueDir, f);
  if (!(await Bun.file(p).exists())) continue;
  for (const line of (await Bun.file(p).text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.dedupeKey) knownKeys.add(e.dedupeKey);
    } catch {}
  }
}

type Run = { exit: number | null; timedOut: boolean; stdout: string; stderr: string; ms: number };
async function generate(seed: number, outFile: string): Promise<boolean> {
  const p = Bun.spawn([process.execPath, genScript, "--seed", String(seed), "--statements", statements, "--out", outFile], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await p.exited) === 0;
}
async function runProgram(program: string, cwd: string, limitMs: number = timeoutMs): Promise<Run> {
  const t0 = Date.now();
  const outFile = join(cwd, `out-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`);
  const errFile = join(cwd, `err-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`);
  // Write child output to FILES, not pipes: a grandchild that inherits a
  // pipe end keeps it open after the child exits, and awaiting the pipe
  // then hangs forever with no process running (0% load, engine stalled).
  const proc = Bun.spawn([bun!, program], {
    cwd,
    stdout: Bun.file(outFile),
    stderr: Bun.file(errFile),
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", WSF_GEN_STATS: "" },
  });
  let timedOut = false;
  const exited = proc.exited.catch(() => null);
  const timer = new Promise<null>(res =>
    setTimeout(() => {
      timedOut = true;
      try {
        if (proc.pid) Bun.spawnSync(["taskkill", "/F", "/PID", String(proc.pid), "/T"], { stdout: "ignore", stderr: "ignore" });
      } catch {}
      res(null);
    }, limitMs),
  );
  // Always resolves: either the child exits or the timer fires and kills it.
  const exit = (await Promise.race([exited, timer])) as number | null;
  // Grace for the killed child to release its output files.
  if (timedOut) await Promise.race([exited, new Promise(r => setTimeout(r, 1500))]);
  const stdout = await Bun.file(outFile).text().catch(() => "");
  const stderr = await Bun.file(errFile).text().catch(() => "");
  return { exit, timedOut, stdout, stderr, ms: Date.now() - t0 };
}

// A run is a finding if bun CRASHED (its own handler printed a report -
// exit codes are unreliable) or the program HUNG past the generator's own
// deterministic exit. A generated program always ends in process.exit(0)
// and prints GEN-STATS; anything else with no crash text is a JS error
// in generated code, not a bun bug.
function judge(r: Run): { kind: "crash" | "hang" | null; sig: string; detail: string } {
  const crash = detectCrash(r.stdout, r.stderr);
  if (crash && !/oom/.test(crash.kind)) return { kind: "crash", sig: `crash: ${crash.signature}`, detail: crash.detail };
  // A hang carries no crash text to fingerprint - one shared "HANG" key made
  // every hang after the first fold away. Return a placeholder; the caller
  // keys hangs by seed (each distinct hanging program is its own finding
  // until triage merges them).
  if (r.timedOut) return { kind: "hang", sig: "genrun HANG", detail: "generated program did not exit" };
  return { kind: null, sig: "", detail: "" };
}


// --- inline minimization + call-set fingerprint --------------------------
// A heap-address segfault has no stable stack fingerprint, so distinct bugs
// share one crash-class key. The CAUSE fingerprint is the minimal program:
// delta-minimize the crashing program, then key it by the sorted set of
// its surviving $step labels (the API calls the crash actually needs).
async function crashesText(text: string, dir: string): Promise<boolean> {
  const f = join(dir, "min-cand.js");
  await Bun.write(f, text);
  // A reduction candidate either crashes fast or not at all: a candidate
  // that runs past a few seconds is a broken/hanging slice, never the crash.
  for (let k = 0; k < 2; k++) {
    const r = await runProgram(f, dir, 8000);
    if (judge(r).kind === "crash") return true;
    if (r.timedOut) return false; // hanging slice - not the crash we're isolating
  }
  return false;
}
// One minimization at a time across ALL workers (a reduction runs the
// target hundreds of times; concurrent reductions and 24 sibling workers
// would fight it). Independent of the verify lock so verify remains cheap.
let minimizeBusy = false;
const acquireMinimize = async () => {
  while (minimizeBusy) await Bun.sleep(500);
  minimizeBusy = true;
};
async function minimizeProgram(text: string, dir: string): Promise<string> {
  let cur = text.split("\n");
  let n = 2;
  let iters = 0;
  const deadline = Date.now() + 15 * 60 * 1000; // 15-minute budget: never stall the engine
  while (cur.length >= 2 && iters++ < 400 && Date.now() < deadline) {
    const chunk = Math.ceil(cur.length / n);
    let reduced = false;
    for (let start = 0; start < cur.length; start += chunk) {
      const trial = [...cur.slice(0, start), ...cur.slice(start + chunk)];
      if (trial.length && (await crashesText(trial.join("\n"), dir))) {
        cur = trial;
        n = Math.max(2, n - 1);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (n >= cur.length) break;
      n = Math.min(cur.length, n * 2);
    }
  }
  return cur.join("\n");
}
const callSetOf = (prog: string): string =>
  [...new Set([...prog.matchAll(/\$step\("([A-Za-z0-9_.:() -]+)"/g)].map(m => m[1]))].sort().join(" ; ");

let iter = 0;
let crashes = 0;
let hangs = 0;
let runs = 0;
// While one worker verifies, the rest pause between runs so the replay
// executes SOLO: these crashes reproduce 6/6 alone and 0/6 under 24-way
// sibling load (they need a resource concurrent runs occupy).
let verifying = 0;
const waitQuiet = async () => {
  while (verifying > 0) await Bun.sleep(200);
};
const t0 = Date.now();
const qfile = join(queueDir, "queue.jsonl");
async function worker(w: number) {
  while (iter < iterations) {
    await waitQuiet();
    const n = ++iter;
    const seed = seedNext++;
    const dir = join(workRoot, `s${seed}`);
    mkdirSync(dir, { recursive: true });
    const program = join(dir, "program.js");
    if (!(await generate(seed, program))) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      continue;
    }
    const r = await runProgram(program, dir);
    runs++;
    const j = judge(r);
    if (!j.kind) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      if (runs % 200 === 0) {
        const min = ((Date.now() - t0) / 60000).toFixed(1);
        console.log(`  -- ${runs} run(s) in ${min}m: ${crashes} crash(es), ${hangs} hang(s)`);
      }
      continue;
    }
    // Verify with a FRESH run identity: the first run's own teardown
    // (scratch dir removal, server port release) races an immediate
    // re-run in the same dir. Regenerate the byte-identical program into a
    // clean subdirectory, let the first process fully exit, then re-run.
    const vdir = join(dir, "verify");
    mkdirSync(vdir, { recursive: true });
    const vprogram = join(vdir, "program.js");
    await Bun.write(vprogram, await Bun.file(program).text());
    await Bun.sleep(300);
    // Race/lifecycle crashes recur intermittently: the seed is an exact
    // reproducer, so a crash that recurs in ANY of a few attempts is
    // verified. (Requiring the very next run to crash discarded ~all of
    // the intermittent - i.e. concurrency - findings.)
    let verified = false;
    verifying++;
    try {
      // let in-flight sibling runs drain so the replay is truly solo
      await Bun.sleep(1500);
      for (let a = 0; a < 4 && !verified; a++) {
        const r2 = await runProgram(vprogram, vdir);
        const j2 = judge(r2);
        // A crash replaying as a crash of the SAME address class verifies
        // it - exact token/address equality is ASLR noise.
        verified = j2.kind === j.kind && (j.kind !== "crash" || j2.sig === j.sig);
        if (!verified) {
          console.log(
            `   verify#${a}: exit=${r2.exit} timedOut=${r2.timedOut} kind=${j2.kind ?? "none"} sig=${(j2.sig || "-").slice(0, 60)} ` +
              `out=${JSON.stringify((r2.stdout + r2.stderr).slice(0, 120))}`,
          );
        }
      }
    } finally {
      verifying--;
    }
    if (j.kind === "crash") crashes++;
    else hangs++;
    if (j.kind === "hang") {
      j.sig = `genrun HANG seed:${seed}`; // per-program hang key
      // Load control: a trivial program must exit within the ceiling right
      // now. If it cannot, the box is starved (not the program hanging) -
      // discard rather than queue a scheduler artifact.
      const ctlDir = join(dir, "ctl");
      mkdirSync(ctlDir, { recursive: true });
      const ctlProg = join(ctlDir, "ctl.js");
      await Bun.write(ctlProg, `await Bun.sleep(10); process.exit(0);\n`);
      const ctl = await runProgram(ctlProg, ctlDir);
      if (ctl.timedOut || ctl.exit !== 0) {
        console.log(`   [seed ${seed}] control program failed to exit - box starved, hang discarded`);
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
        continue;
      }
    }
    console.log(`!! [seed ${seed}] ${j.kind} ${verified ? "VERIFIED" : "unverified"}: ${j.detail.slice(0, 90)}`);
    if (!verified) {
      // A seed IS a complete reproducer - never drop a first-run crash.
      // Ledger it (once per signature) for a later, slower re-check.
      if (!knownKeys.has("unv:" + j.sig)) {
        knownKeys.add("unv:" + j.sig);
        try {
          appendFileSync(
            join(queueDir, "gen-unverified.log"),
            JSON.stringify({ at: new Date().toISOString(), seed, statements, sig: j.sig, detail: j.detail }) + "\n",
          );
        } catch {}
      }
      continue;
    }
    // For a crash, the class key (0xHEAP...) is not identity: minimize the
    // program and key by its call set, so distinct causes queue separately
    // and one bug queues once however it faults.
    let minimalText = "";
    if (j.kind === "crash") {
      // Minimize SOLO (hold the verify lock: siblings pause) - a reduction
      // runs the target hundreds of times and must not compete with 24
      // workers, nor should crashes race under it.
      await acquireMinimize();
      verifying++;
      try {
        console.log(`   minimizing seed ${seed}...`);
        minimalText = await minimizeProgram(await Bun.file(program).text(), dir);
      } finally {
        verifying--;
        minimizeBusy = false;
      }
      const cs = callSetOf(minimalText);
      j.sig = `gencrash{${cs || j.sig}}`;
      console.log(`   minimal call set: ${cs || "(none)"} (${minimalText.split("\n").length} lines)`);
    }
    if (knownKeys.has(j.sig)) {
      console.log(`   known cause - not re-queued (${j.sig.slice(0, 70)})`);
      continue;
    }
    knownKeys.add(j.sig);
    await Bun.write(join(dir, "stdout.txt"), r.stdout);
    await Bun.write(join(dir, "stderr.txt"), r.stderr);
    // The PROGRAM TEXT is the reproducer, not the seed: a generator change
    // shifts every random draw, so a seed only regenerates the crashing
    // program under the exact generator build that produced it. Preserve
    // the program itself with the finding.
    const programCopy = join(queueDir, "programs");
    ensureDir(programCopy);
    const savedProgram = join(programCopy, `gen-${seed}.js`);
    const savedMinimal = join(programCopy, `gen-${seed}.min.js`);
    try {
      await Bun.write(savedProgram, await Bun.file(program).text());
      if (minimalText) await Bun.write(savedMinimal, minimalText);
    } catch {}
    const entry = {
      queuedAt: stamp,
      dedupeKey: j.sig,
      verdict: "gen-verified",
      outcome: j.kind === "crash" ? "CRASH" : "HANG",
      boundary: null,
      crashKind: null,
      crashDetail: j.detail,
      expect: "must-handle",
      target: `gen seed ${seed}`,
      schedule: `gen.ts --seed ${seed} --statements ${statements}`,
      symbol: j.detail.slice(0, 60),
      module: "genrun",
      standalone: ["verified 2/2 (deterministic replay)"],
      lastStage: null,
      termChain: null,
      stacks: null,
      findings: minimalText ? savedMinimal : savedProgram,
      workDir: dir,
    };
    appendFileSync(qfile, JSON.stringify(entry) + "\n");
    console.log(`   QUEUED: gen.ts --seed ${seed} reproduces`);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log(`genrun done: ${runs} run(s), ${crashes} crash(es), ${hangs} hang(s)`);
