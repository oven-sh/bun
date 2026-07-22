// One-command hunt: sweep every target and roll all findings into one file.
//
//   bun driver/hunt.ts --bun <bun.exe>
//     [--workloads dir | --programs a.js,b.js | --tests dir [--filter s] [--limit N]]
//     [--parallel 2] [--timeout 30] [--jobs 6] [--out C:\wsfhunt]
//
// Targets: the workload suite (default), explicit programs, or - the killer
// mode - bun's own test suite: --tests <dir> turns every *.test.* file into
// a `bun test <file>` target, so the corpus is huge and every run carries
// the test's own assertions and timeouts as the oracle.
//
// Runs driver/sweep.ts once per target (up to --parallel sweeps concurrently -
// each sweep is independent and parallel-safe), then writes a single
// roll-up: per-target outcome tallies followed by every finding card,
// confirmed first. The agent entry point: run one command, read one file
// (hunt-findings.md).

import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { ensureDir, here, stamp } from "./lib";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const bun = flag("--bun");
if (!bun) {
  console.error("usage: hunt.ts --bun <bun.exe> [--workloads dir | --programs a.js,b.js] [--parallel N] [--timeout S] [--jobs J]");
  process.exit(2);
}
const timeout = flag("--timeout", "30")!;
const jobs = flag("--jobs", "6")!;
const parallel = Math.max(1, +(flag("--parallel", "2") as string));
const outRoot = join(flag("--out", "C:\\wsfhunt") as string, stamp);
ensureDir(outRoot);

// Build the target list. Each target is the argv passed to sweep --program.
interface Scenario {
  name: string;
  progArgs: string[]; // what follows `--program`
  workDir: string; // sweep --work root for this scenario
  ok: boolean;
  console: string;
}
const targetName = (file: string) => basename(file).replace(/\.(test|spec)\.(ts|tsx|js|mjs|cjs)$|\.(ts|js)$/, "");
let targets: string[][] = [];
if (flag("--tests")) {
  // bun's test suite as the corpus: each test file is `bun test <file>`.
  // --tests takes a comma list of directories (a whole hunting circuit).
  const dirs = flag("--tests")!.split(",").filter(Boolean);
  const filter = flag("--filter");
  const limit = +(flag("--limit", "0") as string) || Infinity;
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(join(d, e.name)) : /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(e.name) ? [join(d, e.name)] : [],
    );
  let files = dirs.flatMap(d => walk(d)).sort();
  if (filter) files = files.filter(f => f.includes(filter));
  files = files.slice(0, limit);
  targets = files.map(f => ["test", f]);
} else if (flag("--programs")) targets = flag("--programs")!.split(",").map(p => [p]);
else {
  const dir = flag("--workloads", join(here, "..", "workloads")) as string;
  targets = readdirSync(dir).filter(f => f.endsWith(".js")).sort().map(f => [join(dir, f)]);
}
if (!targets.length) {
  console.error("no targets to hunt");
  process.exit(1);
}
const scenarios: Scenario[] = targets.map(t => {
  const name = targetName(t[t.length - 1]);
  return { name, progArgs: t, workDir: join(outRoot, name), ok: false, console: "" };
});

console.log(`hunt: ${scenarios.length} target(s), ${parallel} sweep(s) at a time -> ${outRoot}\n`);
const sweepScript = join(here, "sweep.ts");

// Run one scenario's sweep as a child process (its own console log).
async function sweep(s: Scenario) {
  const t0 = performance.now();
  console.log(`  start  ${s.name}`);
  const proc = Bun.spawn(
    ["bun", sweepScript, "--bun", bun, "--program", ...s.progArgs, "--timeout", timeout, "--jobs", jobs, "--work", s.workDir],
    { stdout: Bun.file(join(outRoot, `${s.name}.console.log`)), stderr: Bun.file(join(outRoot, `${s.name}.err.log`)) },
  );
  await proc.exited;
  s.ok = proc.exitCode === 0;
  console.log(`  done   ${s.name} (${Math.round((performance.now() - t0) / 1000)}s, exit=${proc.exitCode})`);
}

// Bounded-parallel over scenarios. With --loop the circuit repeats forever
// (the continuous feeder): every pass re-sweeps every target and each
// sweep appends its verified findings to the global triage queue, so the
// triager can drain it while the fuzzer keeps producing. Each pass writes
// its own roll-up. Stop it by killing the process.
const loop = argv.includes("--loop");
let pass = 0;
do {
  pass++;
  if (loop) console.log(`\n=== pass ${pass} (continuous mode) ===`);
  let next = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < scenarios.length) await sweep(scenarios[next++]);
    }),
  );
  if (!loop) break;
} while (true);

// --- roll-up ------------------------------------------------------------------
// Each sweep wrote <workDir>\<stamp>\findings.md and sweep-report.json;
// collect the newest of each and merge into one document.
const md: string[] = [];
md.push(`# winsysfuzz hunt roll-up`);
md.push("");
md.push(`- ${scenarios.length} target(s); bun=\`${bun}\``);
md.push("");
const cards: { scenario: string; verdict: string; sig: string; card: string[] }[] = [];
const summary: string[] = [];
for (const s of scenarios) {
  const runs = readdirSync(s.workDir).sort();
  const latest = runs.length ? join(s.workDir, runs[runs.length - 1]) : null;
  const findingsPath = latest ? join(latest, "findings.md") : null;
  let tally = "(no report)";
  try {
    const rep = await Bun.file(join(latest!, "sweep-report.json")).json();
    const counts = new Map<string, number>();
    for (const r of rep.results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
    tally = [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(" ");
  } catch {}
  let loadLine = "";
  try {
    const text = findingsPath ? await Bun.file(findingsPath).text() : "";
    // Carry the sweep's own load-health measurement into the roll-up so
    // every verdict in it can be weighed against the box's condition.
    loadLine = text.split("\n").find(l => l.startsWith("- **load health**")) ?? "";
    // Split into cards on '## [' headers; keep verdict + a signature
    // (syscall + owning function, offset stripped) for cross-target dedupe.
    const parts = text.split(/\n(?=## \[)/).slice(1);
    for (const part of parts) {
      const v = /^## \[([a-z-]+)\]/.exec(part)?.[1] ?? "unknown";
      const sys = /^## \[[a-z-]+\] \S+ - (\w+)/.exec(part)?.[1] ?? "?";
      const where = /\*\*where the fault fired\*\*: `([^`(]+?)(\+0x[0-9a-f]+)? /.exec(part)?.[1] ?? "?";
      // A crash's own signature is the sharpest dedupe key across targets
      // ("Segmentation fault at address 0x24" is one bug in five test files).
      const csig = /\*\*crash signature\*\*: `([^`]+)`/.exec(part)?.[1];
      cards.push({
        scenario: s.name,
        verdict: v,
        sig: csig ? `crash: ${csig}` : `${sys} @ ${where.trim()}`,
        card: [`### ${s.name}`, part.trim().replace(/^## /, "**").replace(/\n/, "**\n")],
      });
    }
  } catch {}
  summary.push(`- **${s.name}** (${s.ok ? "ok" : "sweep error"}): ${tally}` + (loadLine ? `\n  ${loadLine.replace(/^- /, "")}` : ""));
}
md.push("## per-scenario outcome tallies");
md.push(...summary);
md.push("");

// --- recurring findings across targets ------------------------------------------
// The same (syscall, owning function) firing in several UNRELATED programs
// is the strongest signal a hunt produces - chase these first.
const bySig = new Map<string, { scenarios: Set<string>; verdicts: Set<string> }>();
for (const c of cards) {
  const e = bySig.get(c.sig) ?? { scenarios: new Set(), verdicts: new Set() };
  e.scenarios.add(c.scenario);
  e.verdicts.add(c.verdict);
  bySig.set(c.sig, e);
}
const recurring = [...bySig.entries()].filter(([, e]) => e.scenarios.size >= 2);
if (recurring.length) {
  md.push(`## recurring across targets (${recurring.length}) - chase these first`);
  for (const [sig, e] of recurring.sort((a, b) => b[1].scenarios.size - a[1].scenarios.size))
    md.push(
      `- \`${sig}\` in **${e.scenarios.size}** targets (${[...e.scenarios].join(", ")}); ` +
        `verdicts: ${[...e.verdicts].join(", ")}`,
    );
  md.push("");
}
const rank: Record<string, number> = { confirmed: 0, slow: 1, "load-dependent": 2, "not-reproduced": 3 };
cards.sort((a, b) => (rank[a.verdict] ?? 9) - (rank[b.verdict] ?? 9));
md.push(`## findings (${cards.length}) - confirmed first`);
md.push("");
if (!cards.length) md.push("No CRASH/HANG findings across the suite.");
for (const c of cards) {
  md.push(...c.card);
  md.push("");
}
const rollup = join(outRoot, "hunt-findings.md");
await Bun.write(rollup, md.join("\n") + "\n");
console.log(`\n${cards.length} finding card(s) across ${scenarios.length} target(s)`);
console.log(`roll-up: ${rollup}`);
