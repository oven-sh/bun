// oxlint's `no-unused-vars` is a rule of its own. With a configuration of oxlint, `bun lint` follows it where that has been asked for,
// and otherwise does what typescript-eslint does. This compares the two on the inputs of the tests of ESLint, typescript-eslint and
// oxc, by where they report, and says whether the differences are those that no-unused-vars.differences.json records.
//
//   BUN_LINT="<bun-lint> cli" OXLINT_BIN=<oxlint 1.87> OXC_DIR=<oxc at oxlint_v1.87.0> bun no-unused-vars.ts <conformance fixtures> [--record]

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { casesOfFile } from "../../../conformance/extract-oxc.ts";

interface Input {
  suite: string;
  code: string;
  options: unknown[];
  extension: string;
  globals: object;
}

const fixtures = process.argv[2];
const recordedPath = join(import.meta.dir, "no-unused-vars.differences.json");
const [ours, ...oursArgs] = (process.env.BUN_LINT ?? "bun lint").split(" ");
const inputs: Input[] = [];
for (const suite of ["eslint", "typescript-eslint"]) {
  for (const it of JSON.parse(readFileSync(join(fixtures, suite, "no-unused-vars.json"), "utf8")).cases) {
    if (it.skip || it.typeAware) continue;
    const extension = /\.(d\.ts|[cm]?[jt]sx?)$/.exec(it.filename)?.[1] ?? "js";
    const isScript = it.languageOptions?.sourceType === "script" && extension === "js";
    inputs.push({ suite, code: it.code, options: it.options ?? [], extension: isScript ? "cjs" : extension, globals: it.languageOptions?.globals ?? {} });
  }
}
const tests = join(process.env.OXC_DIR!, "crates/oxc_linter/src/rules/eslint/no_unused_vars/tests");
const seen = new Set<string>();
for (const file of readdirSync(tests).sort()) {
  for (const it of casesOfFile(readFileSync(join(tests, file), "utf8"), "no-unused-vars", {}, {}, false)) {
    const key = JSON.stringify([it.code, it.options]);
    if (seen.has(key)) continue;
    seen.add(key);
    inputs.push({ suite: "oxc", code: it.code, options: it.options ?? [], extension: /\.(d\.ts|[cm]?[jt]sx?)$/.exec(it.filename ?? "")?.[1] ?? "tsx", globals: {} });
  }
}

// A directory for each configuration.
const groups = new Map<string, number[]>();
inputs.forEach((it, index) => {
  const key = JSON.stringify([it.options, it.globals]);
  groups.set(key, [...(groups.get(key) ?? []), index]);
});
const root = mkdtempSync(join(tmpdir(), "no-unused-vars-"));
/** For each input the places, or `null` if the file or the configuration is refused. */
const found = { oxlint: [] as (string[] | null)[], ours: [] as (string[] | null)[] };
let directories = 0;
for (const [key, list] of groups) {
  const [options, globals] = JSON.parse(key);
  const cwd = join(root, String(directories++));
  mkdirSync(cwd);
  writeFileSync(join(cwd, ".oxlintrc.json"), JSON.stringify({ plugins: ["typescript", "react"], categories: { correctness: "off" }, globals, rules: { "no-unused-vars": ["error", ...options] } }));
  for (const index of list) writeFileSync(join(cwd, `c${index}.${inputs[index].extension}`), inputs[index].code);
  for (const [name, command, before] of [["oxlint", process.env.OXLINT_BIN!, []], ["ours", ours, oursArgs]] as const) {
    for (const index of list) found[name][index] = [];
    let diagnostics;
    try {
      ({ diagnostics } = JSON.parse(spawnSync(command, [...before, "-f", "json", "."], { cwd, encoding: "utf8", maxBuffer: 1 << 28 }).stdout));
    } catch {
      for (const index of list) found[name][index] = null;
      continue;
    }
    for (const it of diagnostics) {
      const index = Number(/c(\d+)\./.exec(it.filename)![1]);
      // `TS(1049)` is an error of oxc's semantic analysis: it has not looked at the file.
      if (!/^[a-z]/.test(it.code ?? "")) found[name][index] = null;
      else found[name][index]?.push(`${it.labels[0].span.line}:${it.labels[0].span.column}`);
    }
  }
}
rmSync(root, { recursive: true, force: true });

const totals: Record<string, { same: number; differ: number; refused: number }> = {};
const differences: object[] = [];
inputs.forEach((it, index) => {
  const total = (totals[it.suite] ??= { same: 0, differ: 0, refused: 0 });
  const [a, b] = [found.oxlint[index], found.ours[index]];
  if (!a || !b) return void total.refused++;
  if (a.sort().join() === b.sort().join()) return void total.same++;
  total.differ++;
  differences.push({ suite: it.suite, options: it.options, extension: it.extension, code: it.code, oxlint: a, ours: b });
});
console.log(totals);
const key = (it: any) => JSON.stringify([it.suite, it.options, it.extension, it.code, it.oxlint, it.ours]);
if (process.argv.includes("--record")) {
  // What is known of a difference is kept.
  let causes = new Map<string, string>();
  try {
    causes = new Map(JSON.parse(readFileSync(recordedPath, "utf8")).map((it: any) => [JSON.stringify([it.options, it.code]), it.cause]));
  } catch {}
  const rows = differences.map((it: any) => ({ cause: causes.get(JSON.stringify([it.options, it.code])) ?? "?", ...it }));
  writeFileSync(recordedPath, JSON.stringify(rows, null, 1) + "\n");
} else {
  const recorded = new Set(JSON.parse(readFileSync(recordedPath, "utf8")).map(key));
  const now = new Set(differences.map(key));
  const added = differences.filter(it => !recorded.has(key(it)));
  for (const it of added as any[]) console.log(`new: ${it.suite} ${JSON.stringify(it.options)}\n${it.code}\n  oxlint: ${it.oxlint}\n  ours:   ${it.ours}`);
  console.log(`${added.length} new differences, ${[...recorded].filter(it => !now.has(it as string)).length} that are gone`);
  process.exit(added.length > 0 ? 1 : 0);
}
