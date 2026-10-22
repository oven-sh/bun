// Records what oxlint's React Compiler rules report for every input in a directory of fixtures.
//
//   bun oxlint.ts <fixtures> <out.jsonl> --oxlint=<path> [--threads=4] [--again] [--alone=50] [--single=50]
//
// Writes one line per file (a `FileRecord` from shared.ts), sorted by path. The config is written next to the output,
// as `<out>.config.json`. The fixtures are never modified, but pass a copy anyway. `--oxlint` is an absolute path, or a
// command that takes oxlint's arguments: --oxlint="/path/to/tool subcommand".
//
//   --again      runs a second time on one thread and checks that every line is the same
//   --alone=N    runs each rule by itself on N files with diagnostics, to check that no rule depends on the others
//   --single=N   runs N files in one process each and checks the exit code against the record

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  byFile,
  chunks,
  configOf,
  type Diagnostic,
  type FileRecord,
  inputsByDirectory,
  JsonlWriter,
  options,
  oxlint,
  oxlintBinary,
  RULE_NAMES,
  table,
} from "./shared.ts";

const { flags, rest } = options(process.argv.slice(2));
if (rest.length !== 2) throw new Error("usage: bun oxlint.ts <fixtures> <out.jsonl> --oxlint=<path>");
const fixtures = resolve(rest[0]);
const out = resolve(rest[1]);
const binary = oxlintBinary(flags);
const threads = flags.get("threads") ?? "4";

const config = `${out}.config.json`;
writeFileSync(config, JSON.stringify(configOf(RULE_NAMES), null, 2) + "\n");
// This config reports every non-empty file that oxlint parses. oxlint silently skips a file with `@flow` that it can't
// parse.
const probe = `${out}.probe.json`;
writeFileSync(
  probe,
  JSON.stringify({ plugins: [], categories: { correctness: "off" }, rules: { "max-lines": ["error", { max: 0 }] } }),
);

const directories = inputsByDirectory(fixtures);
const batches: string[][] = [];
for (const files of directories.values()) batches.push(...chunks(files, 400));

function run(configPath: string, files: readonly string[], threadCount: string) {
  return oxlint(binary, fixtures, ["-c", configPath, "--no-ignore", `--threads=${threadCount}`, ...files]);
}

const isRule = (diagnostic: Diagnostic) => diagnostic.rule !== null && RULE_NAMES.includes(diagnostic.rule);

function record(path: string, found: readonly Diagnostic[], parsed: boolean): FileRecord {
  // A syntax error has no code, or one like `TS(8016)`.
  const syntax = found.filter(diagnostic => !isRule(diagnostic));
  const diagnostics = found.filter(isRule);
  return {
    path,
    exit: found.some(diagnostic => diagnostic.severity === "error") ? 1 : 0,
    parse: syntax.length > 0 ? "error" : parsed ? "ok" : "silent",
    syntax: syntax.length > 0 ? syntax : undefined,
    diagnostics,
  };
}

function* all(threadCount: string): Generator<FileRecord> {
  for (const files of batches) {
    const main = run(config, files, threadCount);
    if (main.report.number_of_files !== files.length) {
      throw new Error(`${files.length} files were given, ${main.report.number_of_files} were read: ${files[0]} ..`);
    }
    const found = byFile(main.report);
    const parsed = byFile(run(probe, files, threadCount).report);
    for (const path of files) {
      yield record(path, found.get(path) ?? [], parsed.get(path)?.some(d => d.rule === "max-lines") ?? false);
    }
  }
}

const counts = { files: 0, ok: 0, error: 0, silent: 0, withDiagnostics: 0, diagnostics: 0 };
const byRule = new Map<string, { files: number; diagnostics: number; labels: number }>(
  RULE_NAMES.map(rule => [rule, { files: 0, diagnostics: 0, labels: 0 }]),
);
const lines = new Map<string, string>();
const rulesOf = new Map<string, Set<string>>();
const writer = new JsonlWriter(out);
for (const file of all(threads)) {
  writer.write(file);
  lines.set(file.path, Bun.hash(JSON.stringify(file)).toString(36));
  counts.files++;
  counts[file.parse]++;
  if (file.diagnostics.length > 0) counts.withDiagnostics++;
  counts.diagnostics += file.diagnostics.length;
  const seen = new Set<string>();
  for (const diagnostic of file.diagnostics) {
    const entry = byRule.get(diagnostic.rule!)!;
    entry.diagnostics++;
    entry.labels += diagnostic.labels.length;
    if (!seen.has(diagnostic.rule!)) entry.files++;
    seen.add(diagnostic.rule!);
  }
  if (seen.size > 0) rulesOf.set(file.path, seen);
}
writer.close();

console.log(
  table(
    ["Files", "Parsed", "Syntax errors", "Skipped in silence", "With diagnostics", "Diagnostics"],
    [[counts.files, counts.ok, counts.error, counts.silent, counts.withDiagnostics, counts.diagnostics]],
  ),
);
console.log();
console.log(
  table(
    ["Rule", "Files", "Diagnostics", "Labels"],
    [...byRule].map(([rule, entry]) => [rule, entry.files, entry.diagnostics, entry.labels]),
  ),
);

if (flags.has("again")) {
  let different = 0;
  for (const file of all("1")) {
    if (lines.get(file.path) !== Bun.hash(JSON.stringify(file)).toString(36)) {
      different++;
      if (different <= 10) console.log(`not the same on one thread: ${file.path}`);
    }
  }
  console.log();
  console.log(table(["Run again on one thread", "Files", "Different"], [["", counts.files, different]]));
}

/** Picks `count` files with diagnostics: first three per rule, then the files with the most rules. */
function sample(count: number): string[] {
  const picked = new Set<string>();
  for (const rule of RULE_NAMES) {
    let taken = 0;
    for (const [path, rules] of rulesOf) {
      if (taken === 3 || picked.size === count) break;
      if (rules.has(rule) && !picked.has(path)) {
        picked.add(path);
        taken++;
      }
    }
  }
  for (const [path] of [...rulesOf].sort((a, b) => b[1].size - a[1].size)) {
    if (picked.size >= count) break;
    picked.add(path);
  }
  return [...picked].sort();
}

if (flags.has("alone")) {
  const files = sample(Number(flags.get("alone") || 50));
  const together = byFile(run(config, files, threads).report);
  const one = `${out}.alone.json`;
  const rows: (string | number)[][] = [];
  for (const rule of RULE_NAMES) {
    writeFileSync(one, JSON.stringify(configOf([rule])));
    const isolated = byFile(run(one, files, threads).report);
    let diagnostics = 0;
    let different = 0;
    for (const path of files) {
      const expected = (together.get(path) ?? []).filter(diagnostic => diagnostic.rule === rule);
      const actual = (isolated.get(path) ?? []).filter(isRule);
      diagnostics += expected.length;
      if (JSON.stringify(expected) !== JSON.stringify(actual)) different++;
    }
    rows.push([rule, files.length, diagnostics, different]);
  }
  console.log();
  console.log(table(["Rule alone", "Files", "Diagnostics with all rules on", "Files that differ"], rows));
}

if (flags.has("single")) {
  const files = sample(Number(flags.get("single") || 50));
  let different = 0;
  for (const path of files) {
    const single = run(config, [path], "1");
    const parsed = byFile(run(probe, [path], "1").report);
    const file = record(path, byFile(single.report).get(path) ?? [], parsed.has(path));
    if (file.exit !== single.exit || lines.get(path) !== Bun.hash(JSON.stringify(file)).toString(36)) {
      different++;
      console.log(`not the same in a process of its own: ${path} (exit ${single.exit})`);
    }
  }
  console.log();
  console.log(table(["Each in a process of its own", "Files", "Different"], [["", files.length, different]]));
}
