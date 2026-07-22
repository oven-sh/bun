// The triage queue: the fuzzer appends verified findings to queue.jsonl as it
// runs; this drains it. Findings dedupe on dedupeKey (a crash signature, else
// syscall@owning-symbol) so one bug shows once however many targets hit it,
// and are ranked by how likely they are to be a real, user-facing bun bug.
//
//   bun driver/queue.ts                       # ranked untriaged queue
//   bun driver/queue.ts --all                 # include already-triaged
//   bun driver/queue.ts --show 3              # full detail for entry #3
//   bun driver/queue.ts --done 3 --verdict reported --note "<report ref>"
//     verdicts: reported | not-real | not-user-facing | not-bun | dup | needs-work
//
// Nothing is deleted: queue.jsonl and triaged.jsonl are append-only.

import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const queueDir = flag("--queue", "C:\\wsfqueue") as string;
const qfile = join(queueDir, "queue.jsonl");
const tfile = join(queueDir, "triaged.jsonl");

type Entry = {
  queuedAt: string;
  dedupeKey: string;
  verdict: string; // sweep verdict: confirmed | slow | load-dependent | not-reproduced
  outcome: string;
  boundary: string | null;
  crashKind: string | null;
  crashDetail: string | null;
  expect: string;
  target: string;
  schedule: string;
  symbol: string;
  module: string;
  standalone: string[] | null;
  lastStage: string | null;
  termChain: string[] | null;
  stacks: string[] | null;
  findings: string;
  workDir: string;
};

async function readJsonl<T>(path: string): Promise<T[]> {
  const f = Bun.file(path);
  if (!(await f.exists())) return [];
  return (await f.text())
    .split("\n")
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as T);
}

const entries = await readJsonl<Entry>(qfile);
const triaged = await readJsonl<{ dedupeKey: string; verdict: string; note?: string; at: string }>(tfile);
const triagedKeys = new Map(triaged.map(t => [t.dedupeKey, t]));

// Group all sightings under one dedupeKey; the group is the unit of triage.
type Group = { key: string; entries: Entry[]; targets: Set<string>; best: Entry };
const groups = new Map<string, Group>();
for (const e of entries) {
  let g = groups.get(e.dedupeKey);
  if (!g) groups.set(e.dedupeKey, (g = { key: e.dedupeKey, entries: [], targets: new Set(), best: e }));
  g.entries.push(e);
  g.targets.add(e.target);
  if (rankOf(e) < rankOf(g.best)) g.best = e;
}

// Lower = triage sooner. Real-bug likelihood: a bun-code crash beats a hang,
// which beats a slow crawl; system-module crashes and allocator aborts are
// almost never bun bugs and sink to the bottom.
function rankOf(e: Entry): number {
  const notBun = e.boundary === "system-module" || e.expect === "abort-expected";
  // A deliberate panic (an explicit message = bun CHOSE to abort) and a
  // crash still inside process initialization (fatal chain has JSCInitialize
  // / the runtime's start-up, no JS ran) are usually intentional fatals in an
  // environment too broken to run - real but rarely fix-worthy. Sink them
  // below silent crashes (segfaults, uninitialized state) in live subsystems.
  const chain = (e.termChain ?? []).join(" ");
  const startup = /JSCInitialize|cli::command::start|bun_rust::main/.test(chain);
  const deliberate = e.crashKind === "rust-panic";
  const soft = startup || deliberate ? 1 : 0;
  if (e.outcome === "CRASH" && e.verdict === "confirmed" && !notBun) return 0 + soft * 3;
  if (e.outcome === "CRASH" && !notBun) return 1 + soft * 3;
  if (e.outcome === "HANG" && e.verdict === "confirmed" && e.expect === "must-handle") return 2;
  if (e.outcome === "HANG" && e.verdict === "confirmed") return 3;
  if (e.verdict === "slow") return 5;
  if (e.verdict === "load-dependent") return 6;
  if (notBun) return 8;
  return 7;
}
const groupRank = (g: Group) => rankOf(g.best);

const showAll = argv.includes("--all");
const showIdx = flag("--show");
const doneIdx = flag("--done");

const ordered = [...groups.values()].sort(
  (a, b) => groupRank(a) - groupRank(b) || b.targets.size - a.targets.size,
);
const pending = ordered.filter(g => showAll || !triagedKeys.has(g.key));

if (doneIdx !== undefined) {
  // Record a triage verdict for entry #N (index into the pending list).
  const g = pending[+doneIdx];
  if (!g) {
    console.error(`no pending entry #${doneIdx}`);
    process.exit(2);
  }
  const verdict = flag("--verdict", "reported") as string;
  const note = flag("--note", "") as string;
  const line = JSON.stringify({ dedupeKey: g.key, verdict, note, at: new Date().toISOString() });
  const prev = (await Bun.file(tfile).exists()) ? await Bun.file(tfile).text() : "";
  await Bun.write(tfile, prev + line + "\n");
  console.log(`triaged #${doneIdx}: ${g.key} -> ${verdict}${note ? ` (${note})` : ""}`);
  process.exit(0);
}

if (showIdx !== undefined) {
  // Full detail for one entry: everything the triager needs before source-diving.
  const g = pending[+showIdx];
  if (!g) {
    console.error(`no pending entry #${showIdx}`);
    process.exit(2);
  }
  const e = g.best;
  console.log(`#${showIdx}  ${g.key}`);
  console.log(`  sightings: ${g.entries.length} across ${g.targets.size} target(s)`);
  for (const t of g.targets) console.log(`    - ${t}`);
  console.log(`  best: ${e.outcome} [${e.verdict}] expect=${e.expect} boundary=${e.boundary ?? "-"}`);
  console.log(`  fault: ${e.schedule}`);
  console.log(`  at: ${e.symbol} [${e.module}]`);
  if (e.crashDetail) console.log(`  crash: ${e.crashDetail}`);
  if (e.termChain?.length) console.log(`  fatal chain: ${e.termChain.slice(0, 8).join(" <- ")}`);
  if (e.lastStage) console.log(`  last stage: ${e.lastStage}`);
  if (e.standalone) console.log(`  standalone: ${e.standalone.join(", ")}`);
  if (e.stacks?.length) {
    console.log(`  stacks:`);
    for (const s of e.stacks) console.log(`    ${s}`);
  }
  console.log(`  findings: ${e.findings}`);
  console.log(`  workDir:  ${e.workDir}`);
  console.log(`  replay:   bun driver\\repro.ts --bun <bun> --schedule "${e.schedule}" --program ${e.target}`);
  process.exit(0);
}

console.log(`queue: ${entries.length} sighting(s), ${groups.size} unique, ${pending.length} pending triage\n`);
pending.forEach((g, i) => {
  const e = g.best;
  const done = triagedKeys.get(g.key);
  const tag = done ? ` [triaged: ${done.verdict}]` : "";
  console.log(
    `#${i} r${groupRank(g)} ${e.outcome} [${e.verdict}] x${g.targets.size} target(s) ${e.expect}` +
      `${e.boundary ? " boundary=" + e.boundary : ""}${tag}`,
  );
  console.log(`     ${g.key}`);
  console.log(`     at ${e.symbol} [${e.module}]${e.termChain?.length ? "  chain: " + e.termChain.slice(0, 4).join(" <- ") : ""}`);
});
