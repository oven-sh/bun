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
  if (r.timedOut) return { kind: "hang", sig: "genrun HANG", detail: "generated program did not exit" };
  return { kind: null, sig: "", detail: "" };
}

let iter = 0;
let crashes = 0;
let hangs = 0;
let runs = 0;
const t0 = Date.now();
const qfile = join(queueDir, "queue.jsonl");
async function worker(w: number) {
  while (iter < iterations) {
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
    // Verify by re-running the SAME program (deterministic replay).
    const r2 = await runProgram(program, dir);
    const j2 = judge(r2);
    const verified = j2.kind === j.kind && (j.kind !== "crash" || j2.sig === j.sig);
    if (j.kind === "crash") crashes++;
    else hangs++;
    console.log(`!! [seed ${seed}] ${j.kind} ${verified ? "VERIFIED" : "unverified"}: ${j.detail.slice(0, 90)}`);
    if (!verified) continue; // keep the dir for inspection, don't queue
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
