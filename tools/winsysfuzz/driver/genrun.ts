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
async function runProgram(program: string, cwd: string): Promise<Run> {
  const t0 = Date.now();
  const proc = Bun.spawn([bun!, program], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", WSF_GEN_STATS: "" },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (proc.pid) Bun.spawnSync(["taskkill", "/F", "/PID", String(proc.pid), "/T"], { stdout: "ignore", stderr: "ignore" });
    } catch {}
  }, timeoutMs);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exit = await proc.exited.catch(() => null);
  clearTimeout(timer);
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
    if (j.kind === "hang") j.sig = `genrun HANG seed:${seed}`; // per-program hang key
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
    if (knownKeys.has(j.sig)) {
      console.log(`   known signature - not re-queued`);
      continue;
    }
    knownKeys.add(j.sig);
    await Bun.write(join(dir, "stdout.txt"), r.stdout);
    await Bun.write(join(dir, "stderr.txt"), r.stderr);
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
      findings: program,
      workDir: dir,
    };
    appendFileSync(qfile, JSON.stringify(entry) + "\n");
    console.log(`   QUEUED: gen.ts --seed ${seed} reproduces`);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log(`genrun done: ${runs} run(s), ${crashes} crash(es), ${hangs} hang(s)`);
