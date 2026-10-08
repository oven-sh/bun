// Real ESLint against `bun lint` on real code, with every rule enabled at once. Every message is compared: file, rule, severity,
// place, text, fix, suggestions.
//
//   ESLINT_DIR=.. TYPESCRIPT_ESLINT_DIR=.. BUN_LINT=<bun-lint> node run.ts --out <dir> --fixtures <conformance/fixtures>
//       --corpus <name>=<directory> .. [--confidential <name>=<directory> ..]
//       [--plans default,options-1,typed] [--option-sets 3] [--workers 16] [--limit <files per corpus>] [--only <substring of path>]
//
// A plan (see `plans.ts`) is one pass with one configuration. Each (plan, corpus) leaves `<dir>/results/<plan>/<corpus>.json`;
// `report.ts` turns all of them into `SUMMARY.md` and examples. Passes that are there already are run again and replaced.
//
// `bun lint` is `$BUN_LINT cli`, which wants `BUN_SEMA_TS_LIB` for the plans with types.
//
// Of a `--confidential` corpus only numbers per rule are kept: see `worker.ts`. The corpora are only read.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  EXTENSIONS,
  PSEUDO_RULES,
  RESULT_MARKER,
  addCounts,
  buildPlans,
  configModule,
  differencesOf,
  type Counts,
  type Plan,
} from "./plans.ts";
import type { Batch, BatchResult, Example } from "./worker.ts";

interface Corpus {
  name: string;
  root: string;
  confidential: boolean;
}

export interface PassResult {
  plan: string;
  corpus: string;
  confidential: boolean;
  root: string | null;
  files: number;
  equalFiles: number;
  rules: Record<string, Counts>;
  examples: Example[];
  trouble: Record<string, string[] | number>;
  /** CPU seconds in the workers, not wall time. */
  seconds: { eslint: number; ours: number };
}

const MAX_FILE_BYTES = 1_000_000;
const BATCH_BYTES = 300_000;
const BATCH_FILES = 40;
const TYPED_BATCH_FILES = 400;
const EXAMPLES_PER_RULE = 60;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage", "out", "_ts4.3"]);

const corpora: Corpus[] = [];
let out = "";
let fixtures = "";
let wanted: string[] | null = null;
let optionSets = 3;
let workers = 16;
let limit = Infinity;
let only = "";
{
  const argv = process.argv.slice(2);
  const corpus = (text: string, confidential: boolean) => {
    const [name, root] = text.split("=");
    corpora.push({ name, root: resolve(root), confidential });
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out = resolve(argv[++i]);
    else if (arg === "--fixtures") fixtures = resolve(argv[++i]);
    else if (arg === "--corpus") corpus(argv[++i], false);
    else if (arg === "--confidential") corpus(argv[++i], true);
    else if (arg === "--plans") wanted = argv[++i].split(",");
    else if (arg === "--option-sets") optionSets = Number(argv[++i]);
    else if (arg === "--workers") workers = Number(argv[++i]);
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--only") only = argv[++i];
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!out || !fixtures || corpora.length === 0 || !process.env.BUN_LINT) {
    console.error("usage: see the head of run.ts");
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Files and batches
// ---------------------------------------------------------------------------

interface SourceFile {
  path: string;
  bytes: number;
}

function filesOf(root: string, language: "typescript" | "javascript" | "both"): SourceFile[] {
  const found: SourceFile[] = [];
  const walk = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name), `${path}/`);
        continue;
      }
      const extension = entry.name.slice(entry.name.lastIndexOf(".") + 1);
      if (!entry.isFile() || !EXTENSIONS.includes(extension)) continue;
      if (language !== "both" && (language === "typescript") !== extension.includes("ts")) continue;
      if (only && !path.includes(only)) continue;
      const bytes = statSync(join(directory, entry.name)).size;
      if (bytes <= MAX_FILE_BYTES) found.push({ path, bytes });
    }
  };
  walk(root, "");
  if (found.length <= limit) return found;
  // Evenly spread over the corpus.
  const step = found.length / limit;
  return Array.from({ length: limit }, (_, i) => found[Math.floor(i * step)]);
}

/** Without types: about as many bytes each, the large files first. */
function plainBatches(files: SourceFile[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const file of [...files].sort((a, b) => b.bytes - a.bytes)) {
    current.push(file.path);
    bytes += file.bytes;
    if (bytes >= BATCH_BYTES || current.length >= BATCH_FILES) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** With types: the files that have the same closest `tsconfig.json` together, because a program is made for each batch. */
function typedBatches(root: string, files: SourceFile[]): string[][] {
  const closest = new Map<string, string | null>();
  const configOf = (directory: string): string | null => {
    if (closest.has(directory)) return closest.get(directory)!;
    const found = existsSync(join(root, directory, "tsconfig.json"))
      ? directory
      : directory === "." || directory === ""
        ? null
        : configOf(dirname(directory));
    closest.set(directory, found);
    return found;
  };
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const config = configOf(dirname(file.path));
    if (config === null) continue;
    if (!groups.has(config)) groups.set(config, []);
    groups.get(config)!.push(file.path);
  }
  const batches: string[][] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += TYPED_BATCH_FILES) batches.push(group.slice(i, i + TYPED_BATCH_FILES));
  }
  return batches.sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

function runBatches(batches: Batch[], onResult: (result: BatchResult) => void): Promise<void> {
  const queue = [...batches];
  const one = () =>
    new Promise<void>(done => {
      if (queue.length === 0) return done();
      // Standard error is dropped: a stack trace or a warning can quote the code.
      const child = spawn(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", "--max-old-space-size=8192", join(import.meta.dirname, "worker.ts")],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      let current: Batch | undefined;
      const next = () => {
        current = queue.shift();
        if (current) child.stdin.write(JSON.stringify(current) + "\n");
        else child.stdin.end();
      };
      createInterface({ input: child.stdout }).on("line", line => {
        if (!line.startsWith(RESULT_MARKER)) return;
        onResult(JSON.parse(line.slice(RESULT_MARKER.length)));
        next();
      });
      child.on("exit", () => {
        if (!current) return done();
        // The worker died, out of memory for example. The batch is lost, the rest goes on in a new worker.
        const files = current.files.length;
        onResult({
          id: current.id,
          files,
          equalFiles: 0,
          rules: {},
          examples: [],
          trouble: { "the worker died": current.confidential ? files : current.files },
          seconds: { eslint: 0, ours: 0 },
        });
        one().then(done);
      });
      next();
    });
  return Promise.all(Array.from({ length: Math.min(workers, batches.length) }, one)).then(() => {});
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

const implemented = new Set<string>(
  JSON.parse(spawnSync(process.env.BUN_LINT!, ["linter", "rules"], { encoding: "utf8" }).stdout),
);
const plans = buildPlans(fixtures, implemented, optionSets).filter(plan => !wanted || wanted.includes(plan.name));
if (plans.length === 0) throw new Error("no such plan");

async function pass(plan: Plan, corpus: Corpus): Promise<void> {
  const files = filesOf(corpus.root, plan.typed ? "typescript" : plan.javascriptAsTypescript ? "javascript" : "both");
  const lists = plan.typed ? typedBatches(corpus.root, files) : plainBatches(files);
  if (lists.length === 0) return;
  const config = join(out, "configs", `${plan.name}.mjs`);
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, configModule(plan));

  const total: PassResult = {
    plan: plan.name,
    corpus: corpus.name,
    confidential: corpus.confidential,
    root: corpus.confidential ? null : corpus.root,
    files: 0,
    equalFiles: 0,
    rules: {},
    examples: [],
    trouble: {},
    seconds: { eslint: 0, ours: 0 },
  };
  const examplesOf = new Map<string, number>();
  const started = Date.now();
  let done = 0;
  const batches = lists.map((list, id): Batch => {
    const { root, confidential } = corpus;
    return { id, root, files: list, plan, config, confidential, threads: plan.typed ? 4 : 1 };
  });
  await runBatches(batches, result => {
    total.files += result.files;
    total.equalFiles += result.equalFiles;
    total.seconds.eslint += result.seconds.eslint;
    total.seconds.ours += result.seconds.ours;
    for (const [rule, counts] of Object.entries(result.rules)) {
      addCounts(total.rules, rule, counts);
    }
    if (corpus.confidential && result.examples.length > 0) throw new Error("an example of a confidential corpus");
    if (corpus.confidential && Object.keys(result.rules).some(id => !(id in plan.rules) && !PSEUDO_RULES.includes(id))) {
      throw new Error("the id of a rule that is not in the plan, of a confidential corpus");
    }
    for (const example of result.examples) {
      const n = examplesOf.get(example.rule) ?? 0;
      examplesOf.set(example.rule, n + 1);
      if (n < EXAMPLES_PER_RULE) total.examples.push(example);
    }
    for (const [kind, what] of Object.entries(result.trouble)) {
      if (typeof what === "number") total.trouble[kind] = ((total.trouble[kind] as number) ?? 0) + what;
      else ((total.trouble[kind] ??= []) as string[]).push(...what);
    }
    if (++done % 20 === 0 || done === batches.length) {
      process.stderr.write(`\r${plan.name} ${corpus.name}: ${done}/${batches.length} batches, ${total.files} files `);
    }
  });
  const differences = Object.values(total.rules).reduce((n, it) => n + differencesOf(it), 0);
  const messages = Object.values(total.rules).reduce((n, it) => n + it.eslint, 0);
  console.error(
    `\n${plan.name} ${corpus.name}: ${total.files} files, ${total.equalFiles} equal, ${messages} messages of ESLint, ` +
      `${differences} differences, ${Math.round((Date.now() - started) / 1000)} s`,
  );
  const file = join(out, "results", plan.name, `${corpus.name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(total, null, 1));
}

for (const plan of plans) {
  for (const corpus of corpora) await pass(plan, corpus);
}
