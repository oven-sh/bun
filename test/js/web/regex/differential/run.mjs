// Differential regex runner: generates `count` cases from `seed`, executes each
// case, and prints one canonical JSON line per case. Identical output between
// two engines means they agree on every observable behaviour of every case.
//
//   node run.mjs --seed 1 --count 500 --out oracle.jsonl
//   bun  run.mjs --seed 1 --count 500 --capabilities "$(head -1 oracle.jsonl)" --out bun.jsonl
//   cmp oracle.jsonl bun.jsonl
//
// The first output line is a header pinning the capability set the cases were
// generated for; pass it back with --capabilities to regenerate the identical
// stream in another engine (see capabilities.mjs). --out writes to a file
// (via node:fs) instead of stdout. Use --case '<source>' --flags '<flags>' to
// run one explicit case, or --index N to reproduce the Nth generated case.

import { writeFileSync } from "node:fs";
import { probeCapabilities } from "./capabilities.mjs";
import { canonicalJson, executeCase } from "./execute.mjs";
import { generateCases } from "./generator.mjs";

function parseArgs(argv) {
  const args = { seed: 1, count: 200 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    switch (key) {
      case "--seed":
        args.seed = Number(value);
        i++;
        break;
      case "--count":
        args.count = Number(value);
        i++;
        break;
      case "--max-depth":
        args.maxDepth = Number(value);
        i++;
        break;
      case "--term-budget":
        args.termBudget = Number(value);
        i++;
        break;
      case "--index":
        args.index = Number(value);
        i++;
        break;
      case "--case":
        args.caseSource = value;
        i++;
        break;
      case "--flags":
        args.caseFlags = value;
        i++;
        break;
      case "--capabilities": {
        // Accepts either the raw capability object or a full header line.
        const parsed = JSON.parse(value);
        args.capabilities = parsed.capabilities || parsed;
        i++;
        break;
      }
      case "--no-header":
        args.noHeader = true;
        break;
      case "--out":
        args.outPath = value;
        i++;
        break;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// Collect all lines and emit them with a single write. `--out <file>`
// writes through node:fs instead of stdout, which keeps a multi-megabyte
// result stream out of the stdout pipe entirely (soak runs use it).
const lines = [];
if (args.caseSource !== undefined) {
  lines.push(
    canonicalJson(
      executeCase({ source: args.caseSource, flags: args.caseFlags || "", inputs: ["", "a", "abc", "aXbXc"] }),
    ),
  );
} else {
  const capabilities = args.capabilities || probeCapabilities();
  if (!args.noHeader) lines.push(canonicalJson({ capabilities, seed: args.seed, count: args.count }));
  const cases = generateCases(args.seed, args.count, {
    maxDepth: args.maxDepth,
    termBudget: args.termBudget,
    capabilities,
  });
  const start = args.index !== undefined ? args.index : 0;
  const end = args.index !== undefined ? args.index + 1 : cases.length;
  for (let i = start; i < end; i++) {
    lines.push(canonicalJson({ index: i, record: executeCase(cases[i]) }));
  }
}
const payload = lines.join("\n") + "\n";
if (args.outPath) {
  writeFileSync(args.outPath, payload);
} else {
  process.stdout.write(payload);
}
