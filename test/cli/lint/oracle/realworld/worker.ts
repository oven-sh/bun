// A worker of `run.ts`: lints batches of files with real ESLint, in this process, and with `bun lint`, and compares every
// message. Reads one `Batch` per line from standard input, writes one `BatchResult` per line to standard output.
//
// What is reported about a confidential corpus is reduced to numbers per rule in here, before anything leaves the process:
// no path, no message, no code, no error text, no id of a rule that the code names and the plan does not have. Nothing of it
// is written to a file either: `bun lint` reads the files where they are, and its report comes through a pipe.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Script } from "node:vm";
import {
  LINTER,
  NOT_IN_A_PROJECT,
  PARSE_ERROR,
  PSEUDO_RULES,
  RESULT_MARKER,
  UNKNOWN_RULE,
  configObjects,
  type Plan,
} from "./plans.ts";

export interface Batch {
  id: number;
  /** The working directory of both linters. */
  root: string;
  /** Relative to `root`. */
  files: string[];
  plan: Plan;
  /** The `eslint.config.mjs` for `bun lint`. */
  config: string;
  confidential: boolean;
  threads: number;
}

export interface Counts {
  eslint: number;
  ours: number;
  onlyEslint: number;
  onlyOurs: number;
  /** The same message at the same place, with another fix or other suggestions. */
  fixDiffers: number;
}

export interface Message {
  ruleId: string | null;
  severity: number;
  message: string;
  messageId?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  fatal?: boolean;
  fix?: { range: [number, number]; text: string };
  suggestions?: { messageId?: string; desc: string; fix: { range: [number, number]; text: string } }[];
}

export interface Example {
  rule: string;
  kind: "onlyEslint" | "onlyOurs" | "fixDiffers";
  file: string;
  eslint?: Message;
  ours?: Message;
}

export interface BatchResult {
  id: number;
  files: number;
  /** Files on which everything agrees. */
  equalFiles: number;
  rules: Record<string, Counts>;
  /** Never of a confidential corpus. */
  examples: Example[];
  /** What went wrong, by kind. The values are the files, or only their number for a confidential corpus. */
  trouble: Record<string, string[] | number>;
  seconds: { eslint: number; ours: number };
}

const EXAMPLES_PER_RULE_AND_BATCH = 4;
const ESLINT_SECONDS_PER_FILE = 120;

const bunLint = resolve(process.env.BUN_LINT!);
const pluginDir = join(resolve(process.env.TYPESCRIPT_ESLINT_DIR!), "packages/eslint-plugin");
const require = createRequire(join(pluginDir, "package.json"));
const typescriptParser = require("@typescript-eslint/parser");
const { Linter } = require(join(dirname(require.resolve("eslint/package.json")), "lib/linter"));
const typescriptPlugin = { rules: require("./dist/rules/index.js") };

// ---------------------------------------------------------------------------
// ESLint
// ---------------------------------------------------------------------------

let pending: () => Message[];
Object.assign(globalThis, { __realworldLint: () => pending() });
const watched = new Script("__realworldLint()");

const linters = new Map<string, any>();

/** What ESLint reports, and the rules that threw and were turned off. `null`: it did not finish, or keeps throwing. */
function eslint(batch: Batch, file: string, code: string): { messages: Message[]; crashed: string[] } | null {
  let linter = linters.get(batch.root);
  if (!linter) linters.set(batch.root, (linter = new Linter({ configType: "flat", cwd: batch.root })));
  const config = configObjects(batch.plan, typescriptPlugin, typescriptParser);
  if (batch.plan.typed) {
    (config[1].languageOptions as any).parserOptions.tsconfigRootDir = batch.root;
  }
  const crashed: string[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      pending = () => linter.verify(code, config, { filename: join(batch.root, file) });
      return { messages: watched.runInThisContext({ timeout: ESLINT_SECONDS_PER_FILE * 1000 }), crashed };
    } catch (error) {
      const loading = /^Error while loading rule '([^']+)'/.exec(String((error as Error)?.message));
      const ruleId = (error as { ruleId?: string }).ruleId ?? loading?.[1];
      if (!ruleId) return null;
      crashed.push(ruleId);
      config.push({ rules: { [ruleId]: "off" } });
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// bun lint
// ---------------------------------------------------------------------------

interface FileReport {
  filePath: string;
  messages: Message[];
}

function runOurs(batch: Batch, files: string[]): Promise<FileReport[] | null> {
  return new Promise(done => {
    const args = ["cli", "--cwd", batch.root, "-c", batch.config, "-f", "json", "--threads", String(batch.threads)];
    const child = spawn(bunLint, [...args, "--no-warn-ignored", ...files], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), Math.min(60_000 + 20_000 * files.length, 600_000));
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.on("error", () => done(null));
    child.on("close", () => {
      clearTimeout(timer);
      try {
        done(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        done(null);
      }
    });
  });
}

/** By file. A file that makes `bun lint` crash or hang has no entry: it is found by halving. */
async function ours(batch: Batch, files: string[], into: Map<string, Message[]>): Promise<void> {
  const reports = await runOurs(batch, files);
  if (reports) {
    for (const report of reports) into.set(report.filePath, report.messages);
  } else if (files.length > 1) {
    const middle = files.length >> 1;
    await ours(batch, files.slice(0, middle), into);
    await ours(batch, files.slice(middle), into);
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** That a rule does not exist is said by the linter, in the name of the rule. */
const idOf = (message: Message) =>
  message.ruleId === null || message.ruleId === undefined
    ? message.fatal
      ? PARSE_ERROR
      : LINTER
    : message.messageId === undefined && message.message.startsWith("Definition for rule '")
      ? LINTER
      : message.ruleId;

const placeKey = (m: Message) =>
  JSON.stringify([m.ruleId, m.severity, m.line, m.column, m.endLine, m.endColumn, m.messageId, m.message]);

const fixKey = (m: Message) =>
  JSON.stringify([
    m.fix ? [m.fix.range, m.fix.text] : null,
    (m.suggestions ?? []).map(s => [s.messageId, s.desc, s.fix.range, s.fix.text]),
  ]);

function compare(
  file: string,
  expected: Message[],
  actual: Message[],
  result: BatchResult,
  perRule: Map<string, number>,
) {
  const counts = (rule: string) =>
    (result.rules[rule] ??= { eslint: 0, ours: 0, onlyEslint: 0, onlyOurs: 0, fixDiffers: 0 });
  const example = (made: Example) => {
    const n = perRule.get(made.rule) ?? 0;
    perRule.set(made.rule, n + 1);
    if (n < EXAMPLES_PER_RULE_AND_BATCH) result.examples.push(made);
  };

  // A file that one of them cannot parse says nothing about the rules.
  const fatalExpected = expected.find(m => m.fatal);
  const fatalActual = actual.find(m => m.fatal);
  if (fatalExpected || fatalActual) {
    // typescript-eslint refuses a file that no tsconfig.json includes. That is not about its syntax.
    const isOutside = fatalExpected?.message.includes("was not found by the project service") ?? false;
    const id = isOutside ? NOT_IN_A_PROJECT : PARSE_ERROR;
    const it = counts(id);
    if (fatalExpected) it.eslint++;
    if (fatalActual) it.ours++;
    if (fatalExpected && fatalActual) return true;
    if (fatalExpected) it.onlyEslint++;
    else it.onlyOurs++;
    example({
      rule: id,
      kind: fatalExpected ? "onlyEslint" : "onlyOurs",
      file,
      eslint: fatalExpected,
      ours: fatalActual,
    });
    return false;
  }

  for (const m of expected) counts(idOf(m)).eslint++;
  for (const m of actual) counts(idOf(m)).ours++;

  const byPlace = new Map<string, Message[]>();
  for (const m of actual) {
    const key = placeKey(m);
    const list = byPlace.get(key);
    if (list) list.push(m);
    else byPlace.set(key, [m]);
  }
  let equal = true;
  for (const m of expected) {
    const list = byPlace.get(placeKey(m));
    if (!list || list.length === 0) {
      equal = false;
      counts(idOf(m)).onlyEslint++;
      example({ rule: idOf(m), kind: "onlyEslint", file, eslint: m });
      continue;
    }
    const wanted = fixKey(m);
    const same = list.findIndex(it => fixKey(it) === wanted);
    const [other] = list.splice(Math.max(same, 0), 1);
    if (same < 0) {
      equal = false;
      counts(idOf(m)).fixDiffers++;
      example({ rule: idOf(m), kind: "fixDiffers", file, eslint: m, ours: other });
    }
  }
  for (const list of byPlace.values()) {
    for (const m of list) {
      equal = false;
      counts(idOf(m)).onlyOurs++;
      example({ rule: idOf(m), kind: "onlyOurs", file, ours: m });
    }
  }
  return equal;
}

async function run(batch: Batch): Promise<BatchResult> {
  const result: BatchResult = {
    id: batch.id,
    files: batch.files.length,
    equalFiles: 0,
    rules: {},
    examples: [],
    trouble: {},
    seconds: { eslint: 0, ours: 0 },
  };
  const trouble = (kind: string, file: string) => ((result.trouble[kind] ??= []) as string[]).push(file);
  const started = performance.now();
  const actual = new Map<string, Message[]>();
  const oursDone = ours(batch, batch.files, actual).then(() => {
    result.seconds.ours = (performance.now() - started) / 1000;
  });

  const expected = new Map<string, { messages: Message[]; crashed: string[] } | null>();
  for (const file of batch.files) {
    let code: string;
    try {
      code = readFileSync(join(batch.root, file), "utf8");
    } catch {
      continue;
    }
    // `bun lint` obeys them, ESLint does not know them.
    if (/\boxlint-(?:disable|enable)/.test(code)) trouble("skipped: has oxlint-disable comments", file);
    else expected.set(file, eslint(batch, file, code));
  }
  result.seconds.eslint = (performance.now() - started) / 1000;
  await oursDone;

  const perRule = new Map<string, number>();
  for (const [file, report] of expected) {
    const mine = actual.get(join(batch.root, file));
    if (!mine) trouble("bun lint crashed or hung", file);
    if (!report) trouble("eslint threw or did not finish", file);
    if (!mine || !report) continue;
    for (const rule of report.crashed) trouble(`eslint: ${rule} threw`, file);
    const off = new Set(report.crashed);
    const comparable = off.size > 0 ? mine.filter(m => !off.has(m.ruleId!)) : mine;
    if (compare(file, report.messages, comparable, result, perRule)) result.equalFiles++;
  }

  if (batch.confidential) {
    result.examples = [];
    // The id of a rule that is not ours is from a comment in the code.
    const known: Record<string, Counts> = {};
    for (const [rule, counts] of Object.entries(result.rules)) {
      const id = rule in batch.plan.rules || PSEUDO_RULES.includes(rule) ? rule : UNKNOWN_RULE;
      const sum = (known[id] ??= { eslint: 0, ours: 0, onlyEslint: 0, onlyOurs: 0, fixDiffers: 0 });
      for (const key of Object.keys(sum) as (keyof Counts)[]) sum[key] += counts[key];
    }
    result.rules = known;
    const kinds: Record<string, string[]> = {};
    for (const [kind, files] of Object.entries(result.trouble)) {
      const rule = /^eslint: (.*) threw$/.exec(kind)?.[1];
      const safe = rule === undefined || rule in batch.plan.rules ? kind : `eslint: ${UNKNOWN_RULE} threw`;
      (kinds[safe] ??= []).push(...(files as string[]));
    }
    result.trouble = kinds;
    for (const kind of Object.keys(result.trouble)) result.trouble[kind] = (result.trouble[kind] as string[]).length;
  }
  return result;
}

for await (const line of createInterface({ input: process.stdin })) {
  const batch: Batch = JSON.parse(line);
  let result: BatchResult;
  try {
    result = await run(batch);
  } catch (error) {
    const files = batch.files.length;
    const why = batch.confidential ? "the batch failed" : `the batch failed: ${String(error).slice(0, 300)}`;
    const trouble = { [why]: batch.confidential ? files : batch.files };
    result = { id: batch.id, files, equalFiles: 0, rules: {}, examples: [], trouble, seconds: { eslint: 0, ours: 0 } };
  }
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`);
}
process.exit();
