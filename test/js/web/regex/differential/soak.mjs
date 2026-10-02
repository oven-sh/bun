// Long-running differential soak orchestrator: for each seed in a range, run
// the case stream under the oracle engine (node) and the engine under test
// (bun), compare, and record every divergent case plus any per-seed timeout
// (which usually means one engine hit a backtracking cliff -- itself worth
// a report). Designed to be left running for hours.
//
//   node soak.mjs --from 1 --to 200 --count 1000 --out ./soak-results
//
// The engine under test defaults to `bun`; override with --bun /path/to/bun.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "run.mjs");

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const from = Number(arg("--from", "1"));
const to = Number(arg("--to", "20"));
const count = Number(arg("--count", "1000"));
const outDir = arg("--out", "./soak-results");
const bunBin = arg("--bun", "bun");
const perSeedTimeoutMs = Number(arg("--timeout-ms", "240000"));
mkdirSync(outDir, { recursive: true });

const summary = { from, to, count, seeds: [] };

for (let seed = from; seed <= to; seed++) {
  const record = { seed, status: "identical", divergent: [] };
  const oracleFile = join(outDir, `oracle-${seed}.jsonl`);
  const underFile = join(outDir, `under-${seed}.jsonl`);
  let oracleOut;
  let underOut;
  try {
    execFileSync(process.execPath, [runner, "--seed", String(seed), "--count", String(count), "--out", oracleFile], {
      timeout: perSeedTimeoutMs,
      stdio: "ignore",
    });
    oracleOut = readFileSync(oracleFile, "utf8");
  } catch (e) {
    record.status = "oracle-timeout-or-error";
    record.detail = String(e && e.message ? e.message : e).slice(0, 200);
    summary.seeds.push(record);
    console.log(`seed ${seed}: ORACLE ${record.status}`);
    continue;
  }
  const header = oracleOut.slice(0, oracleOut.indexOf("\n"));
  try {
    execFileSync(
      bunBin,
      [runner, "--seed", String(seed), "--count", String(count), "--capabilities", header, "--out", underFile],
      { timeout: perSeedTimeoutMs, stdio: "ignore" },
    );
    underOut = readFileSync(underFile, "utf8");
  } catch (e) {
    record.status = "under-test-timeout-or-error";
    record.detail = String(e && e.message ? e.message : e).slice(0, 200);
    summary.seeds.push(record);
    console.log(`seed ${seed}: UNDER-TEST ${record.status}`);
    continue;
  }
  if (oracleOut === underOut) {
    console.log(`seed ${seed}: identical`);
    summary.seeds.push(record);
    unlinkSync(oracleFile);
    unlinkSync(underFile);
    continue;
  }
  const oLines = oracleOut.trim().split("\n");
  const uLines = underOut.trim().split("\n");
  for (let i = 1; i < Math.min(oLines.length, uLines.length); i++) {
    if (oLines[i] !== uLines[i]) {
      let parsed = null;
      try {
        parsed = JSON.parse(oLines[i]);
      } catch {}
      record.divergent.push({
        index: parsed ? parsed.index : i - 1,
        source: parsed ? parsed.record.source : null,
        flags: parsed ? parsed.record.flags : null,
        oracle: oLines[i],
        under: uLines[i],
      });
    }
  }
  record.status = `divergent(${record.divergent.length})`;
  console.log(`seed ${seed}: ${record.status}`);
  writeFileSync(join(outDir, `divergent-seed-${seed}.json`), JSON.stringify(record, null, 1));
  summary.seeds.push({ seed, status: record.status, count: record.divergent.length });
}
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 1));
const div = summary.seeds.filter(s => String(s.status).startsWith("divergent")).length;
console.log(`\nsoak complete: ${summary.seeds.length} seeds, ${div} with divergences`);
