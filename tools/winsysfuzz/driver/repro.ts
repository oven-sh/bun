// Replay + triage a single fault coordinate: the tool a finding is judged by.
//
//   bun driver/repro.ts --bun <bun.exe> --schedule "NtReadFile 661d9d9 1 pre C0000185"
//     --program <file.js> [args...] [--times 3] [--timeout 30] [--out C:\wsfrepro]
//
// Replays the coordinate N times and writes finding.md with: determinism
// (k/N), the callsite symbolized across all candidate frames (true owner),
// per-run stdout/stderr, live thread stacks for a HANG (captured before the
// kill), the faulting stack for a CRASH, and a copy-pasteable repro command.

import { join } from "node:path";
import {
  digestStacks,
  ensureDir,
  lastStage,
  moduleOf,
  replayCoordinate,
  runOnce,
  statusName,
  symbolize,
  wsfrun,
  stamp,
  type ReplayResult,
  type RunResult,
} from "./lib";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const bun = flag("--bun");
const schedule = flag("--schedule");
const progIdx = argv.indexOf("--program");
if (!bun || !schedule || progIdx < 0) {
  console.error('usage: repro.ts --bun <bun.exe> --schedule "<line>" --program <file.js> [args...] [--times N]');
  process.exit(2);
}
const progArgs: string[] = [];
for (let i = progIdx + 1; i < argv.length && !argv[i].startsWith("--"); i++) progArgs.push(argv[i]);
const times = Math.max(1, +(flag("--times", "3") as string));
// A fixed replay timeout manufactures fake HANGs on slow test files (a
// 50s file "hung" 3/3 at a 30s ceiling). Unless --timeout is given, run
// one unfaulted control of the program first and set the ceiling from it -
// the same relative-to-baseline notion of slow the sweeper uses.
let timeoutMs = 1000 * +(flag("--timeout", "0") as string);
if (!timeoutMs) {
  const ctlDir = join(flag("--out", "C:\\wsfrepro") as string, "control");
  const ctl = await runOnce({ bun: bun!, args: progArgs, workDir: ctlDir, timeoutMs: 300_000 }).catch(() => null);
  const base = ctl?.outcome === "exit" ? ctl.ms : 30_000;
  timeoutMs = Math.max(30_000, Math.round(base * 3));
  console.log(`  control run: ${ctl?.outcome ?? "n/a"} in ${ctl?.ms ?? "?"}ms -> replay timeout ${timeoutMs}ms`);
}
// --stress K [--rounds R]: the load re-verify for a load-dependent finding.
// Each round runs K faulted replays CONCURRENTLY plus one no-fault CONTROL
// of the same program. Faulted lanes bad while the control finishes clean
// => a real timing-sensitive lead (the fault, not the load, is doing it).
// Control also degrading => the box was saturated: the "finding" is an
// artifact. This is the distinction 'load-dependent' alone cannot make.
const stress = +(flag("--stress", "0") as string);
const rounds = Math.max(1, +(flag("--rounds", "2") as string));
// Never-reused timestamped root: nothing is ever deleted; old runs accumulate.
const outDir = join(flag("--out", "C:\\wsfrepro") as string, stamp);
ensureDir(outDir);

const parts = schedule.trim().split(/\s+/);
const [schedSys, schedRva, , schedMode, schedStatus] = parts;

console.log(`replaying x${times}: ${schedule}`);
const runs: (ReplayResult & { n: number })[] = [];
for (let n = 1; n <= times; n++) {
  const r = await replayCoordinate({
    bun,
    args: progArgs,
    schedule,
    dir: join(outDir, `run${n}`),
    timeoutMs,
  });
  runs.push({ ...r, n });
  console.log(`  run${n}: ${r.outcome} exit=${r.exitCode} fired=${r.fired} ${r.ms}ms`);
}

// --- minimize: greedy delta over the schedule's rules ----------------------
// A wide-pass hit carries a broad schedule (dozens of rules); the finding
// almost always hinges on one or two of them. --minimize drops rules one at
// a time and keeps any smaller schedule that still reproduces the finding
// class (a HANG or a CRASH - the same "bad" the sweeper verifies against),
// then prints the surviving minimal schedule and re-verifies it 3x.
const minimize = argv.includes("--minimize");
let minimalSchedule = "";
if (minimize) {
  if (!runs.some(r => r.outcome === "hang" || r.crash)) {
    console.log(`\nminimize: initial rounds did not reproduce a hang/crash - nothing to minimize`);
  } else {
    let cur = schedule
      .split(/\s*;\s*/)
      .map(s => s.trim())
      .filter(Boolean);
    console.log(`\nminimize: ${cur.length} rule(s) - dropping while it still reproduces...`);
    const reproduces = async (rules: string[], tag: string) => {
      const r = await replayCoordinate({
        bun,
        args: progArgs,
        schedule: rules.join(" ; "),
        dir: join(outDir, `min-${tag}`),
        timeoutMs,
      });
      const bad = r.outcome === "hang" || !!r.crash;
      console.log(`    [${tag}] ${rules.length} rule(s): ${bad ? "REPRODUCES" : "clean"} (${r.outcome === "hang" ? "HANG" : r.crash ? "CRASH" : `exit=${r.exitCode}`})`);
      return bad;
    };
    for (let i = 0; i < cur.length && cur.length > 1; ) {
      const trial = cur.filter((_, k) => k !== i);
      if (await reproduces(trial, `drop${i}`)) cur = trial;
      else i++;
    }
    minimalSchedule = cur.join(" ; ");
    console.log(`\nminimal schedule (${cur.length} rule(s)):\n  ${minimalSchedule}`);
    let ok = 0;
    for (let v = 1; v <= 3; v++) if (await reproduces(cur, `verify${v}`)) ok++;
    console.log(`minimal reproduces ${ok}/3`);
  }
}

// --- stress: concurrent replays with a control lane -------------------------
interface StressRound {
  r: number;
  control: RunResult;
  lanes: ReplayResult[];
}
const stressRounds: StressRound[] = [];
let stressVerdict = "";
if (stress > 0) {
  console.log(`\nstress: ${rounds} round(s) x ${stress} faulted lane(s) + 1 no-fault control lane`);
  for (let r = 1; r <= rounds; r++) {
    // Launch everything at once: faulted lanes contend with each other
    // exactly as they did in the sweep, while the control tells us whether
    // the box itself was healthy under that load.
    const lanes = Array.from({ length: stress }, (_, k) =>
      replayCoordinate({
        bun,
        args: progArgs,
        schedule,
        dir: join(outDir, `stress${r}`, `lane${k + 1}`),
        timeoutMs,
        capture: false,
      }),
    );
    const control = runOnce({ bun, args: progArgs, workDir: join(outDir, `stress${r}`, "control"), timeoutMs });
    const [ctl, ...res] = await Promise.all([control, ...lanes]);
    stressRounds.push({ r, control: ctl as RunResult, lanes: res as ReplayResult[] });
    const laneOut = (res as ReplayResult[]).map(l => l.outcome).join(",");
    const c = ctl as RunResult;
    console.log(
      `  round ${r}: lanes=[${laneOut}] control=${c.outcome === "hang" ? "HANG" : `exit=${c.exitCode}`} ${c.ms}ms`,
    );
  }
  // Control healthy = exited AND not itself near the watchdog.
  const healthy = (c: RunResult) => c.outcome === "exit" && c.ms < timeoutMs * 0.7;
  const badWhileHealthy = stressRounds.some(
    s => healthy(s.control) && s.lanes.some(l => l.outcome === "HANG" || l.outcome === "CRASH"),
  );
  const badOnlyWhenSick = stressRounds.some(
    s => !healthy(s.control) && s.lanes.some(l => l.outcome === "HANG" || l.outcome === "CRASH"),
  );
  stressVerdict = badWhileHealthy
    ? "REAL timing-sensitive lead: faulted lanes fail while the no-fault control finishes clean under the same load."
    : badOnlyWhenSick
      ? "LOAD ARTIFACT: the unfaulted control degraded too - the box was saturated; discount this finding."
      : "not reproduced even under load: no faulted lane failed.";
  console.log(`  stress verdict: ${stressVerdict}`);
}

// Callsite: symbolize every DISTINCT candidate frame from a real fired
// record — the nearest frame keys the schedule, deeper frames name the owner.
const withFault = runs.find(r => r.faultRec);
// Fallback when no fault fired: a b:-tagged key is itself a bun frame; a
// k:/n: key (kernelbase/ntdll wrapper) has no bun frame to symbolize.
const keyBunRva = schedRva.startsWith("b:") ? schedRva.slice(2) : /^[0-9a-f]+$/i.test(schedRva) ? schedRva : null;
const candidates = [...new Set(withFault?.faultRec?.rvas ?? (keyBunRva ? [keyBunRva] : []))];
const syms = await symbolize(bun, candidates);
const owner = moduleOf({ rvas: candidates } as any, syms);
const frameLines = candidates.map((rva, i) => {
  const s = syms.get(rva);
  return `${i === 0 ? "key" : `#${i} `} bun+0x${rva}  ${s?.sym ?? "?"}${s && s.file !== "-" ? `\n        ${s.file}` : ""}`;
});

const tally = new Map<string, number>();
for (const r of runs) tally.set(r.outcome, (tally.get(r.outcome) ?? 0) + 1);
const [topOutcome, topCount] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];

// Copy-pasteable repro: the schedule file already exists at runs' schedule.txt.
const schedFile = join(outDir, "run1", "schedule.txt");
const reproCmd = [
  `$env:WSF_MODE = "inject"`,
  `$env:WSF_SCHEDULE = "${schedFile}"`,
  `& "${wsfrun}" -- "${bun}" ${progArgs.map(a => `"${a}"`).join(" ")}`,
].join("\n");

const md: string[] = [];
md.push(`# winsysfuzz finding: ${topOutcome} at ${schedSys}`);
md.push("");
md.push(`- **schedule**: \`${schedule}\``);
md.push(`- **fault**: ${schedSys} -> ${statusName(schedStatus?.toLowerCase() ?? "")} (${schedMode})`);
md.push(`- **owner module**: ${owner}`);
md.push(
  `- **determinism**: ${topOutcome} in ${topCount}/${runs.length} replays` +
    (tally.size > 1
      ? ` (also: ${[...tally.entries()]
          .filter(([o]) => o !== topOutcome)
          .map(([o, c]) => `${o}x${c}`)
          .join(", ")})`
      : ""),
);
md.push(`- **program**: \`${progArgs.join(" ")}\``);
md.push("");
md.push("## Callsite (distinct candidate frames, nearest first)");
md.push("```");
md.push(...frameLines);
md.push("```");
md.push("");
md.push("## Repro (PowerShell)");
md.push("```");
md.push(reproCmd);
md.push("```");
if (stressRounds.length) {
  md.push("");
  md.push(`## Stress: ${stress} concurrent faulted lanes + no-fault control, ${rounds} round(s)`);
  md.push(`**${stressVerdict}**`);
  md.push("");
  for (const s of stressRounds) {
    const c = s.control;
    md.push(
      `- round ${s.r}: lanes = ${s.lanes.map(l => `${l.outcome}(${l.ms}ms)`).join(", ")} ; ` +
        `control = ${c.outcome === "hang" ? "HANG" : `exit ${c.exitCode}`} in ${c.ms}ms`,
    );
  }
}
for (const r of runs) {
  md.push("");
  md.push(`## Run ${r.n}: ${r.outcome} (exit=${r.exitCode}, ${r.ms}ms, fault fired ${r.fired}x)`);
  const so = r.stdout.trim();
  const se = r.stderr.trim();
  if (so) {
    md.push("stdout:");
    md.push("```");
    md.push(so.slice(-1200));
    md.push("```");
  }
  if (se) {
    md.push("stderr (tail):");
    md.push("```");
    md.push(se.slice(-1500));
    md.push("```");
  }
  const stage = lastStage(r.stdout);
  if (stage) md.push(`- last stage reached: \`${stage}\` (hung/died after this)`);
  if (r.hangStacks) {
    md.push("### where each thread is (digest)");
    for (const line of digestStacks(r.hangStacks)) md.push(`- ${line}`);
    md.push("### full thread stacks captured at hang (before kill)");
    md.push("```");
    md.push(r.hangStacks.slice(0, 12000));
    md.push("```");
  }
  if (r.crashDump) {
    const i = r.crashDump.indexOf("===EXCEPTION===");
    md.push("### crash stack (debugger re-run)");
    md.push("```");
    md.push(i >= 0 ? r.crashDump.slice(i, i + 6000) : r.crashDump.slice(-4000));
    md.push("```");
  }
}
const mdPath = join(outDir, "finding.md");
await Bun.write(mdPath, md.join("\n") + "\n");
await Bun.write(
  join(outDir, "finding.json"),
  JSON.stringify(
    {
      schedule,
      owner,
      tally: Object.fromEntries(tally),
      frames: frameLines,
      runs: runs.map(r => ({ n: r.n, outcome: r.outcome, exit: r.exitCode, ms: r.ms, fired: r.fired, dir: r.dir })),
    },
    null,
    1,
  ),
);
console.log(`\n${topOutcome} ${topCount}/${runs.length} deterministic; owner=${owner}`);
console.log(`report: ${mdPath}`);
