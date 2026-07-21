// Hostile-argument fuzzing: drive bun's fs APIs with Windows-specific
// poison and use argument decoding (WSF_ARGS=1) to see what actually
// reached the kernel.
//
//   bun driver/hostile.ts --bun <bun.exe> [--timeout 30] [--out C:\wsfhostile]
//
// For each poison × API pair the report shows three things side by side:
//   JS outcome  — what bun told the program (ok / error code / thrown)
//   kernel path — the NT path handed to NtCreateFile & co. (decoded from
//                 the trace's A records), or "not-reached" if bun rejected
//                 or short-circuited it in userland
//   transform   — whether bun normalized the poison (e.g. added \??\,
//                 stripped a trailing dot, rejected the string)
// A crash or hang anywhere is a finding. So is a poison that reaches the
// kernel unchanged where bun ought to have validated it, or a silent
// normalization that changes which file gets touched.

import { join } from "node:path";
import { ensureDir, nameOf, readTraceDir, runOnce, stamp } from "./lib";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const bun = flag("--bun");
if (!bun) {
  console.error("usage: hostile.ts --bun <bun.exe> [--timeout 30] [--out C:\\wsfhostile]");
  process.exit(2);
}
// Per-poison isolation: each poison runs in its OWN bun process with its
// own timeout, so a poison that blocks (reading the CON console device
// waits for input forever) is a measured 'blocked' outcome for that one
// poison instead of freezing every poison after it.
const timeoutMs = 1000 * +(flag("--timeout", "12") as string);
// Never-reused timestamped root: nothing is ever deleted; old runs accumulate.
const outDir = join(flag("--out", "C:\\wsfhostile") as string, stamp);
ensureDir(outDir);

// --- the poison catalog ---------------------------------------------------------
// Each entry is a path/name string plus a signature: a substring we look for
// in the decoded kernel path to decide whether the poison reached the syscall.
interface Poison {
  id: string;
  path: string; // as passed to the JS API
  sig: string; // substring to find in the kernel-side path
  note: string;
}
const long = (n: number, ch = "a") => ch.repeat(n);
// Containment by construction: absolute / verbatim / UNC poisons target the
// tool's own tree (outDir), never C:\ root, and traversal poisons run from a
// cwd nested deep enough that their ../ chains land inside outDir too. The
// poison semantics (verbatim prefix, UNC form, traversal) are unchanged.
const inTree = (rel: string) => `${outDir}\\${rel}`;
const POISONS: Poison[] = [
  { id: "reserved-con", path: "CON", sig: "CON", note: "reserved device name" },
  { id: "reserved-nul-ext", path: "NUL.txt", sig: "NUL", note: "reserved device name with extension" },
  { id: "reserved-com1", path: "COM1", sig: "COM1", note: "reserved serial device" },
  { id: "trailing-dot", path: "trailing.", sig: "trailing", note: "trailing dot (Win32 strips it)" },
  { id: "trailing-space", path: "trailing ", sig: "trailing", note: "trailing space (Win32 strips it)" },
  { id: "ads-stream", path: "host.txt:hidden", sig: ":hidden", note: "alternate data stream" },
  { id: "ads-dollar-data", path: "host2.txt::$DATA", sig: "$DATA", note: "explicit ::$DATA stream" },
  { id: "long-260", path: long(260), sig: long(200), note: "exceeds MAX_PATH single component" },
  { id: "long-32k", path: long(3000), sig: long(200), note: "very long component" },
  { id: "verbatim-long", path: "\\\\?\\" + inTree("wsf-verbatim-" + long(300)), sig: "verbatim", note: "\\\\?\\ prefix long path" },
  { id: "lone-surrogate", path: "sur\uD800rogate.txt", sig: "sur", note: "lone UTF-16 surrogate" },
  { id: "embedded-nul", path: "nul\u0000byte.txt", sig: "nul", note: "embedded NUL in string" },
  { id: "control-chars", path: "c\u0001t\u001Bl.txt", sig: "l.txt", note: "control characters" },
  {
    id: "unc-localhost",
    path: "\\\\localhost\\" + inTree("wsf-unc-probe").replace(/^([A-Za-z]):/, "$1$"),
    sig: "wsf-unc-probe",
    note: "UNC via localhost admin share (of our own tree)",
  },
  {
    id: "unc-verbatim",
    path: "\\\\?\\UNC\\localhost\\" + inTree("wsf-uncv").replace(/^([A-Za-z]):/, "$1$"),
    sig: "wsf-uncv",
    note: "verbatim UNC",
  },
  { id: "device-pipe", path: "\\\\.\\pipe\\wsf-nonexistent", sig: "pipe", note: "named pipe namespace" },
  // Run from a 6-deep cwd (see runDeep below), so 5 x '..' still lands in-tree.
  { id: "dotdot-escape", path: "a\\..\\..\\..\\..\\..\\wsf-dotdot", sig: "wsf-dotdot", note: "traversal (contained by deep cwd)" },
  { id: "mixed-slash", path: "mix/ed\\slash/es.txt", sig: "slash", note: "mixed separators" },
  { id: "double-sep", path: "dou\\\\ble\\\\sep.txt", sig: "sep", note: "doubled separators" },
  { id: "trailing-sep", path: "trailsep\\", sig: "trailsep", note: "trailing separator on a file" },
  { id: "drive-relative", path: "C:driverel.txt", sig: "driverel", note: "drive-relative (no root)" },
  { id: "colon-mid", path: "co:lon.txt", sig: "lon", note: "colon in filename" },
  { id: "wildcard-star", path: "wild*card.txt", sig: "wild", note: "wildcard char in name" },
  { id: "wildcard-q", path: "wild?card2.txt", sig: "wild", note: "single-char wildcard" },
  { id: "pipe-lt-gt", path: "bad<pipe>|.txt", sig: "bad", note: "reserved punctuation" },
  { id: "unicode-nfd", path: "café.txt", sig: "cafe", note: "combining accent (NFD)" },
  { id: "rtl-override", path: "rtl\u202Etxt.exe", sig: "rtl", note: "RTL override (spoofing char)" },
  { id: "case-collide", path: "CaseCollide.TXT", sig: "CaseCollide", note: "case variance (case-insensitive fs)" },
];

// --- the per-poison driver program ---------------------------------------------
// A generic script that receives ONE poison via env, runs it through every
// API, and prints one JSON line per API. Kept generic so a fresh bun
// process per poison stays cheap and isolated.
const OPS = ["open-r", "open-w", "readFile", "stat", "mkdir", "unlink"] as const;
const program = `
const fs = require("fs");
const p = JSON.parse(process.env.WSF_POISON);
const ops = ${JSON.stringify(OPS)};
function attempt(fn) {
  try { const v = fn(); return { ok: true, val: typeof v === "number" ? v : (v && v.length !== undefined ? "len" + v.length : "ok") }; }
  catch (e) { return { ok: false, code: e.code || e.name || String(e).slice(0, 60) }; }
}
for (const op of ops) {
  let r;
  switch (op) {
    case "open-r": r = attempt(() => { const fd = fs.openSync(p.path, "r"); fs.closeSync(fd); return fd; }); break;
    case "open-w": r = attempt(() => { const fd = fs.openSync(p.path, "w"); fs.closeSync(fd); return fd; }); break;
    case "readFile": r = attempt(() => fs.readFileSync(p.path)); break;
    case "stat": r = attempt(() => fs.statSync(p.path).size); break;
    case "mkdir": r = attempt(() => fs.mkdirSync(p.path)); break;
    case "unlink": r = attempt(() => fs.unlinkSync(p.path)); break;
  }
  console.log(JSON.stringify({ id: p.id, op, ...r }));
}
console.log("POISON-DONE");
`;
const progPath = join(outDir, "hostile-driver.js");
await Bun.write(progPath, program);

// --- run each poison in isolation, under trace with argument decoding -------
console.log(`running ${POISONS.length} poisons x ${OPS.length} apis, one process per poison (WSF_ARGS=1)...`);
interface PoisonResult {
  poison: Poison;
  outcome: string; // completed | blocked | CRASH | error-exit
  exitCode: number | null;
  ms: number;
  jsOut: Map<string, string>; // op -> outcome
  kernelPaths: { sys: string; path: string; status: string }[];
  lastOp: string | null; // last op attempted before a block/crash
}
const results: PoisonResult[] = [];
for (const [pi, poison] of POISONS.entries()) {
  // Run dirs are numbered, never named after the poison (a decoded kernel path
  // containing the poison's own id would fake a "reached" match), and nested
  // six levels deep so the traversal poison's ../ chain resolves inside outDir.
  const rr = await runOnce({
    bun,
    args: [progPath],
    workDir: join(outDir, "runs", "d1", "d2", "d3", "d4", "d5", `p${String(pi + 1).padStart(2, "0")}`),
    timeoutMs,
    env: { WSF_ARGS: "1", WSF_POISON: JSON.stringify({ id: poison.id, path: poison.path }) },
  });
  const jsOut = new Map<string, string>();
  let lastOp: string | null = null;
  for (const line of rr.stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const o = JSON.parse(line);
      jsOut.set(o.op, o.ok ? `ok:${o.val}` : `err:${o.code}`);
      lastOp = o.op;
    } catch {}
  }
  const done = rr.stdout.includes("POISON-DONE");
  const trace = await readTraceDir(rr.dir);
  const kernelPaths: { sys: string; path: string; status: string }[] = [];
  for (const r of trace?.recs ?? [])
    if (r.path) kernelPaths.push({ sys: nameOf(r.sys), path: r.path, status: r.status });
  // The next op after the last one printed is the one that blocked/crashed.
  const nextOp = lastOp === null ? OPS[0] : OPS[OPS.indexOf(lastOp as (typeof OPS)[number]) + 1] ?? null;
  const outcome = rr.outcome === "hang" ? "blocked" : rr.crash ? "CRASH" : done ? "completed" : "error-exit";
  results.push({ poison, outcome, exitCode: rr.exitCode, ms: rr.ms, jsOut, kernelPaths, lastOp: outcome === "completed" ? null : nextOp });
  const flagged = outcome === "blocked" || outcome === "CRASH" ? "!!" : "  ";
  console.log(
    `${flagged} ${poison.id.padEnd(18)} ${outcome.padEnd(10)} ${String(rr.ms).padStart(6)}ms ` +
      (outcome === "completed" ? "" : `stopped-at=${nextOp} `) +
      `kernelPaths=${kernelPaths.length}`,
  );
}

// --- sandbox escapes: successful writes outside the run dirs -------------------
// A poison that canonicalizes to a location outside its run dir (traversal
// beyond root, drive-relative, verbatim absolute) can really CREATE files
// elsewhere. That is real behavior worth reporting - and litter to remove.
const outDirLc = outDir.toLowerCase().replace(/\//g, "\\");
const escapes: { poison: string; path: string }[] = [];
for (const r of results)
  for (const k of r.kernelPaths) {
    if (k.status !== "0" || k.sys !== "NtCreateFile") continue;
    const p = k.path.replace(/^\\\?\?\\/, "").toLowerCase();
    if (!/^[a-z]:\\/.test(p)) continue; // fully-qualified disk paths only (not \??\CONOUT$ etc.)
    if (p.startsWith(outDirLc)) continue; // inside the sandbox: fine
    // Tie it to the POISON: an escape carries the poison's signature. bun's
    // own opens (its js builtins, bunfig probes up the tree) do not.
    if (!p.includes(r.poison.sig.toLowerCase())) continue;
    escapes.push({ poison: r.poison.id, path: k.path });
  }
// NOTE: no cleanup / deletion of any kind. The suite is contained BY
// CONSTRUCTION: absolute and UNC poisons target this tool's own tree, and
// traversal poisons run from a cwd nested deep enough that their ../ chains
// resolve inside outDir. An escape is still detected and REPORTED (that is
// the canonicalization behavior worth seeing) - it just cannot leave our
// tree, and outDir is wiped fresh on the next run. Deleting files based on
// inferred trace output is never something a fuzzer driver should do.

// --- report ---------------------------------------------------------------------
const lines: string[] = [];
lines.push(`# winsysfuzz hostile-argument report`);
lines.push("");
lines.push(`- ${POISONS.length} poisons x ${OPS.length} APIs, one bun process per poison (isolation)`);
lines.push(`- outcomes: ${["completed", "blocked", "CRASH", "error-exit"].map(o => `${o}=${results.filter(r => r.outcome === o).length}`).join(" ")}`);
lines.push("");
lines.push("Legend - **reached**: the poison's signature appears in a kernel-side NT path (bun passed it");
lines.push("through); **not-reached**: bun rejected or short-circuited it in userland; **blocked**: the");
lines.push("API call never returned (which op is named); **CRASH**: bun died (a finding).");
lines.push("");
if (escapes.length) {
  lines.push(`## sandbox escapes: ${escapes.length} successful write(s) OUTSIDE the run dirs`);
  lines.push("A poison canonicalized outside its run directory and the create SUCCEEDED there.");
  lines.push("Real behavior (canonicalization decides what gets written), and worth a look:");
  for (const e of escapes) lines.push(`- \`${e.poison}\` -> \`${e.path}\``);
  lines.push("(Contained inside the tool's tree by construction; nothing is deleted.)");
  lines.push("");
}

// Sort: CRASH, blocked first — those are the findings.
const rank: Record<string, number> = { CRASH: 0, blocked: 1, "error-exit": 2, completed: 3 };
results.sort((a, b) => rank[a.outcome] - rank[b.outcome]);

let reachedCount = 0;
for (const r of results) {
  const p = r.poison;
  const hits = r.kernelPaths.filter(k => k.path.includes(p.sig));
  const reached = hits.length > 0;
  if (reached) reachedCount++;
  const badge = r.outcome === "CRASH" || r.outcome === "blocked" ? ` **[${r.outcome.toUpperCase()}]**` : "";
  lines.push(`## ${p.id} - ${p.note}${badge}`);
  lines.push(`- JS input: \`${JSON.stringify(p.path)}\`  (${r.ms}ms, exit=${r.exitCode ?? "killed"})`);
  lines.push(
    `- JS outcomes: ${
      r.jsOut.size
        ? [...r.jsOut.entries()].map(([op, o]) => `${op}=${o}`).join(" ")
        : "(none - died before first op)"
    }`,
  );
  if (r.lastOp) lines.push(`- **${r.outcome} at op \`${r.lastOp}\`** - that call never returned / killed the process`);
  if (reached) {
    const uniq = [...new Set(hits.map(h => `${h.sys} -> ${h.path} => ${h.status}`))].slice(0, 4);
    lines.push(`- **reached kernel** (${hits.length} path-bearing syscall(s)):`);
    for (const u of uniq) lines.push(`  - \`${u}\``);
  } else {
    lines.push(`- **not-reached**: no path-bearing syscall carried "${p.sig}"`);
  }
  lines.push("");
}
lines.push(`## summary`);
lines.push(`${reachedCount}/${POISONS.length} poisons reached the kernel; ` +
  `${POISONS.length - reachedCount} handled/rejected in userland; ` +
  `${results.filter(r => r.outcome === "blocked").length} blocked; ` +
  `${results.filter(r => r.outcome === "CRASH").length} crashed.`);

const mdPath = join(outDir, "hostile-report.md");
await Bun.write(mdPath, lines.join("\n") + "\n");
console.log(
  `\n${reachedCount}/${POISONS.length} reached kernel; ` +
    `blocked=${results.filter(r => r.outcome === "blocked").length} crash=${results.filter(r => r.outcome === "CRASH").length}`,
);
console.log(`report: ${mdPath}`);
