// Retroactive retention: apply the sweep's own rule to sweeps already on
// disk. A run that found nothing is not a test case and is deleted; any
// run whose output shows a crash (bun panic / segfault / assertion) is
// kept in full for triage, as are baselines, startup-mask runs, verify
// replays and each sweep's report files.
//
//   bun driver/prune.ts C:\wsffeed [C:\wsfhunt ...]   [--dry-run]
//
// Walks every runs\ directory under the given roots. Prints what it keeps
// and frees.

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { detectCrash } from "./lib";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const roots = argv.filter(a => !a.startsWith("--"));
if (!roots.length) {
  console.error("usage: prune.ts <root> [more roots] [--dry-run]");
  process.exit(2);
}

const dirSize = (d: string): number => {
  let n = 0;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    try {
      n += e.isDirectory() ? dirSize(p) : statSync(p).size;
    } catch {}
  }
  return n;
};

// Keep directories that are cases or infrastructure, never plain jobs.
const infra = /^(baseline|startup-mask|verify|control\d*)$/i;

let kept = 0;
let deleted = 0;
let freed = 0;

function pruneRunsDir(runsDir: string) {
  for (const e of readdirSync(runsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join(runsDir, e.name);
    if (infra.test(e.name)) {
      kept++;
      continue;
    }
    // A job dir: keep it only if its output confesses a crash.
    let out = "";
    let err = "";
    try {
      out = readFileSync(join(dir, "stdout.txt"), "utf8");
    } catch {}
    try {
      err = readFileSync(join(dir, "stderr.txt"), "utf8");
    } catch {}
    const crash = detectCrash(out, err);
    const hasCapture = existsSync(join(dir, "hang-stacks.txt")) || existsSync(join(dir, "crash-stack.txt"));
    if (crash || hasCapture) {
      kept++;
      continue;
    }
    const size = dirSize(dir);
    freed += size;
    deleted++;
    if (!dryRun) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (x) {
        console.log(`  ! could not delete ${dir}: ${String(x).slice(0, 80)}`);
      }
    }
  }
}

// Find every runs\ directory under a root, however deeply nested.
function walk(dir: string, depth = 0) {
  if (depth > 5) return;
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name);
    if (e.name === "runs") pruneRunsDir(p);
    else walk(p, depth + 1);
  }
}

for (const root of roots) {
  if (!existsSync(root)) {
    console.log(`skip (missing): ${root}`);
    continue;
  }
  console.log(`pruning ${root} ...`);
  walk(root);
}
console.log(
  `\n${dryRun ? "[dry-run] would delete" : "deleted"} ${deleted} non-finding run dir(s), ` +
    `kept ${kept} case/infra dir(s), ${(freed / 1024 ** 3).toFixed(1)} GB ${dryRun ? "reclaimable" : "reclaimed"}`,
);
