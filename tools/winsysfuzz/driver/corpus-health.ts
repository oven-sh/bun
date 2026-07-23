// Corpus health: how much of the test tree is ALIVE on this box, unfaulted?
// Runs every test file once with the plain binary (no injection) and records
// exit code, wall time, and the runner's pass/fail/skip counts. A corpus
// where most files die in the first second on missing infrastructure means
// the fuzzer is exercising test-runner startup, not bun - the coverage
// question no schedule tuning can answer.
//
//   bun driver/corpus-health.ts --bun <bun.exe> --root C:\bun\test
//     [--jobs 40] [--timeout 60] [--out C:\wsfqueue\corpus-health.json]

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const bun = flag("--bun");
const root = flag("--root", "C:\\bun\\test") as string;
const jobs = Math.max(1, +(flag("--jobs", "40") as string));
const timeoutMs = 1000 * +(flag("--timeout", "60") as string);
const outPath = flag("--out", "C:\\wsfqueue\\corpus-health.json") as string;
if (!bun) {
  console.error("usage: corpus-health.ts --bun <bun.exe> [--root dir]");
  process.exit(2);
}

const files: string[] = [];
const walk = (dir: string) => {
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
      if (!/^(node_modules|fixtures|__snapshots__)$/i.test(e)) walk(p);
    } else if (/\.test\.(ts|tsx|js|mjs|cjs)$/.test(e)) files.push(p);
  }
};
walk(root);
console.log(`corpus-health: ${files.length} test file(s), ${jobs} parallel, ${timeoutMs / 1000}s ceiling`);

type Row = {
  file: string;
  exit: number | null;
  ms: number;
  pass: number;
  fail: number;
  skip: number;
  timedOut: boolean;
  note: string;
};
const rows: Row[] = [];
let next = 0;
const counts = (out: string) => ({
  pass: +(/(\d+) pass/.exec(out)?.[1] ?? 0),
  fail: +(/(\d+) fail/.exec(out)?.[1] ?? 0),
  skip: +(/(\d+) (skip|todo)/.exec(out)?.[1] ?? 0),
});

async function one(file: string): Promise<Row> {
  const t0 = performance.now();
  const proc = Bun.spawn([bun!, "test", file], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
    cwd: root,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {}
  }, timeoutMs);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exit = await proc.exited;
  clearTimeout(timer);
  const ms = Math.round(performance.now() - t0);
  const out = stdout + "\n" + stderr;
  const c = counts(out);
  // A one-line reason for a fast death: the first error-ish line.
  const note = exit === 0 || c.pass + c.fail > 0 ? "" : (out.split("\n").find(l => /error|cannot|not found|ENOENT|failed|missing|skip/i.test(l)) ?? "").slice(0, 120);
  return { file, exit, ms, ...c, timedOut, note };
}

const worker = async () => {
  for (;;) {
    const i = next++;
    if (i >= files.length) return;
    try {
      rows.push(await one(files[i]));
    } catch (e) {
      rows.push({ file: files[i], exit: null, ms: 0, pass: 0, fail: 0, skip: 0, timedOut: false, note: `driver: ${String(e).slice(0, 100)}` });
    }
    if ((rows.length & 63) === 0) console.log(`  ${rows.length}/${files.length}`);
  }
};
await Promise.all(Array.from({ length: jobs }, worker));

// --- summary: the coverage question in numbers ------------------------------
const n = rows.length;
const ran = rows.filter(r => r.pass + r.fail > 0); // executed at least one test
const dead = rows.filter(r => r.pass + r.fail === 0); // nothing actually ran
const fastDead = dead.filter(r => r.ms < 2000);
const allSkip = rows.filter(r => r.pass === 0 && r.fail === 0 && r.skip > 0);
const clean = rows.filter(r => r.exit === 0);
const timedOut = rows.filter(r => r.timedOut);
const pct = (k: number) => `${Math.round((100 * k) / Math.max(1, n))}%`;
const median = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 0);
const summary = {
  files: n,
  executedTests: `${ran.length} (${pct(ran.length)})`,
  nothingRan: `${dead.length} (${pct(dead.length)})`,
  diedFast_lt2s: `${fastDead.length} (${pct(fastDead.length)})`,
  onlySkipped: `${allSkip.length} (${pct(allSkip.length)})`,
  cleanExit: `${clean.length} (${pct(clean.length)})`,
  timedOut: `${timedOut.length} (${pct(timedOut.length)})`,
  medianMs_all: median(rows.map(r => r.ms)),
  medianMs_executed: median(ran.map(r => r.ms)),
};
console.log("\n=== CORPUS HEALTH ===");
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(20)} ${v}`);
// Top reasons the dead files died (grouped note prefix).
const reasons = new Map<string, number>();
for (const r of dead) {
  const key = (r.note || (r.timedOut ? "timed out" : `exit ${r.exit}, no tests, no message`)).slice(0, 70);
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}
console.log("\n--- why the dead files died (top 20) ---");
for (const [k, v] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(v).padStart(4)}x  ${k}`);
// Per top-level directory: alive share.
const byDir = new Map<string, { n: number; ran: number }>();
for (const r of rows) {
  const rel = r.file.slice(root.length + 1);
  const dir = rel.split(/[\\/]/).slice(0, 2).join("/");
  const d = byDir.get(dir) ?? { n: 0, ran: 0 };
  d.n++;
  if (r.pass + r.fail > 0) d.ran++;
  byDir.set(dir, d);
}
console.log("\n--- alive share by directory (>=10 files) ---");
for (const [dir, d] of [...byDir].filter(([, d]) => d.n >= 10).sort((a, b) => a[1].ran / a[1].n - b[1].ran / b[1].n))
  console.log(`  ${String(Math.round((100 * d.ran) / d.n)).padStart(3)}% alive  ${dir} (${d.ran}/${d.n})`);
await Bun.write(outPath, JSON.stringify({ summary, rows }, null, 1));
console.log(`\nfull table -> ${outPath}`);
