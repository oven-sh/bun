// Turns the results of `run.ts` into something to read.
//
//   node report.ts --out <dir>
//
// Reads `<dir>/results/<plan>/<corpus>.json`. Writes `<dir>/SUMMARY.md`: the passes, the rules by number of differences, what
// crashed; and `<dir>/examples/<plugin>/<rule>.txt`: up to 20 differences of the rule, each with the lines around it.
//
// Of a confidential corpus the results have only numbers, and only numbers are printed, in a section of their own. Its files
// are not opened.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PassResult } from "./run.ts";
import type { Counts, Example, Message } from "./worker.ts";

const EXAMPLES_PER_RULE = 20;
const LINES_AROUND = 7;

let out = "";
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!out) throw new Error("usage: node report.ts --out <dir>");
}

const passes: PassResult[] = [];
for (const plan of readdirSync(join(out, "results")).sort()) {
  for (const file of readdirSync(join(out, "results", plan)).sort()) {
    passes.push(JSON.parse(readFileSync(join(out, "results", plan, file), "utf8")));
  }
}

const differencesOf = (it: Counts) => it.onlyEslint + it.onlyOurs + it.fixDiffers;
const sumOf = (rules: Record<string, Counts>, field: (it: Counts) => number) =>
  Object.values(rules).reduce((sum, it) => sum + field(it), 0);

function merge(list: PassResult[]): Record<string, Counts> {
  const rules: Record<string, Counts> = {};
  for (const pass of list) {
    for (const [rule, counts] of Object.entries(pass.rules)) {
      const sum = (rules[rule] ??= { eslint: 0, ours: 0, onlyEslint: 0, onlyOurs: 0, fixDiffers: 0 });
      for (const key of Object.keys(sum) as (keyof Counts)[]) sum[key] += counts[key];
    }
  }
  return rules;
}

/** `eslint/eqeqeq`, `typescript-eslint/no-explicit-any`, `linter/parse-error`. */
function pathOf(rule: string): string {
  if (rule.startsWith("(")) return `linter/${rule.slice(1, -1).replaceAll(" ", "-")}`;
  return rule.startsWith("@typescript-eslint/") ? rule.slice(1) : `eslint/${rule}`;
}

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

const sources = new Map<string, string[]>();

function linesOf(pass: PassResult, file: string): string[] {
  if (pass.confidential || pass.root === null) throw new Error("the files of a confidential corpus are not opened");
  const path = join(pass.root, file);
  if (!sources.has(path)) sources.set(path, readFileSync(path, "utf8").split(/\r\n|[\r\n\u2028\u2029]/));
  return sources.get(path)!;
}

function describeMessage(m: Message): string[] {
  const end = m.endLine === undefined ? "" : `-${m.endLine}:${m.endColumn}`;
  const lines = [`${m.line}:${m.column}${end} [${m.messageId ?? ""}] ${m.message}`];
  if (m.fix) lines.push(`    fix ${JSON.stringify(m.fix.range)} ${JSON.stringify(m.fix.text)}`);
  for (const s of m.suggestions ?? []) {
    lines.push(`    suggestion [${s.messageId ?? ""}] ${JSON.stringify(s.fix.range)} ${JSON.stringify(s.fix.text)}`);
  }
  return lines;
}

function describeExample(pass: PassResult, example: Example, options: unknown[]): string {
  const at = example.eslint ?? example.ours!;
  const lines = [`──── ${pass.corpus}/${example.file}:${at.line ?? 1}:${at.column ?? 1} (plan ${pass.plan})`];
  if (options.length > 0) lines.push(`  options: ${JSON.stringify(options)}`);
  if (example.eslint) lines.push(...describeMessage(example.eslint).map(it => `  - ${it}`));
  if (example.ours) lines.push(...describeMessage(example.ours).map(it => `  + ${it}`));
  const source = linesOf(pass, example.file);
  const line = at.line ?? 1;
  const from = Math.max(1, line - LINES_AROUND);
  const to = Math.min(source.length, line + LINES_AROUND);
  for (let i = from; i <= to; i++) {
    lines.push(`  ${i === line ? ">" : " "}${String(i).padStart(6)} | ${source[i - 1].slice(0, 200)}`);
  }
  return lines.join("\n") + "\n";
}

const open = passes.filter(it => !it.confidential);
const plans: Record<string, { rules: Record<string, unknown[]> }> = {};
rmSync(join(out, "examples"), { recursive: true, force: true });
{
  const byRule = new Map<string, [PassResult, Example][]>();
  for (const pass of open) {
    for (const example of pass.examples) {
      if (!byRule.has(example.rule)) byRule.set(example.rule, []);
      byRule.get(example.rule)!.push([pass, example]);
    }
  }
  for (const [rule, all] of byRule) {
    // One of each kind of message and pass first, so that twenty of the same do not hide the others.
    const seen = new Map<string, number>();
    const ranked = all
      .map(([pass, example], index) => {
        const key = `${pass.plan} ${example.kind} ${(example.eslint ?? example.ours)!.messageId ?? (example.eslint ?? example.ours)!.message}`;
        const rank = seen.get(key) ?? 0;
        seen.set(key, rank + 1);
        return { pass, example, rank, index };
      })
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, EXAMPLES_PER_RULE);
    const texts = ranked.map(({ pass, example }) => {
      plans[pass.plan] ??= planOf(pass.plan);
      return describeExample(pass, example, (plans[pass.plan].rules[rule] ?? []).slice(1));
    });
    const file = join(out, "examples", `${pathOf(rule)}.txt`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `"-" is what only ESLint reports, "+" what only bun lint reports.\n\n${texts.join("\n")}`);
  }
}

/** The rules of a plan, from the configuration that `run.ts` has written for it. */
function planOf(name: string): { rules: Record<string, unknown[]> } {
  const text = readFileSync(join(out, "configs", `${name}.mjs`), "utf8");
  const json = text.slice(text.indexOf("export default ") + 15, text.lastIndexOf(";"));
  const objects = JSON.parse(json.replace(/: (plugin|parser)\b/g, ': "$1"'));
  return { rules: Object.assign({}, ...objects.map((it: { rules?: object }) => it.rules ?? {})) };
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

const text: string[] = ["# Real ESLint against `bun lint` on real code\n"];
text.push(
  "Every rule enabled at once; every message compared (file, rule, severity, line, column, endLine, endColumn, messageId, message, " +
    "fix range and text, suggestions). *only ESLint*: we miss it or have it elsewhere. *only ours*: ESLint does not report it (there). " +
    "*fix differs*: the same message at the same place, another fix or other suggestions. A message that is misplaced counts twice.\n",
);

{
  const all = merge(passes);
  const differing = Object.values(all).filter(it => differencesOf(it) > 0).length;
  text.push(
    `**${sumOf(all, it => it.eslint)} messages of ESLint compared in ${passes.length} passes, ${sumOf(all, differencesOf)} differences, ` +
      `in ${differing} of ${Object.keys(all).length} rules that report anything.**\n`,
  );
}

text.push("## Passes\n");
text.push("| plan | corpus | files | equal files | messages ESLint | messages ours | differences | rules that differ |");
text.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const pass of passes) {
  const differing = Object.values(pass.rules).filter(it => differencesOf(it) > 0).length;
  text.push(
    `| ${pass.plan} | ${pass.corpus} | ${pass.files} | ${pass.equalFiles} | ${sumOf(pass.rules, it => it.eslint)} | ` +
      `${sumOf(pass.rules, it => it.ours)} | ${sumOf(pass.rules, differencesOf)} | ${differing} |`,
  );
}

function table(list: PassResult[], withLinks: boolean) {
  const rules = merge(list);
  text.push(`| rule | ESLint | ours | only ESLint | only ours | fix differs | differences |${withLinks ? " mostly in |" : ""}`);
  text.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |${withLinks ? " --- |" : ""}`);
  const rows = Object.entries(rules)
    .filter(([, it]) => differencesOf(it) > 0)
    .sort((a, b) => differencesOf(b[1]) - differencesOf(a[1]) || (a[0] < b[0] ? -1 : 1));
  for (const [rule, it] of rows) {
    const name = withLinks ? `[${rule}](examples/${pathOf(rule)}.txt)` : rule;
    const where = list
      .map(pass => [`${pass.plan} ${pass.corpus}`, pass.rules[rule] ? differencesOf(pass.rules[rule]) : 0] as const)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    const mostly = where.slice(0, 2).map(([pass, n]) => `${pass}: ${n}`);
    if (where.length > 2) mostly.push(`${where.length - 2} more`);
    text.push(
      `| ${name} | ${it.eslint} | ${it.ours} | ${it.onlyEslint} | ${it.onlyOurs} | ${it.fixDiffers} | ${differencesOf(it)} |` +
        (withLinks ? ` ${mostly.join(", ")} |` : ""),
    );
  }
  if (rows.length === 0) text.push("| none | | | | | | |");
}

const merged = merge(open);
const agreeing = Object.entries(merged).filter(([, it]) => differencesOf(it) === 0);
text.push("\n## Rules by number of differences (all passes, without the confidential corpus)\n");
table(open, true);
text.push(
  `\n${agreeing.length} rules report something and agree everywhere ` +
    `(${agreeing.reduce((sum, [, it]) => sum + it.eslint, 0)} messages).\n`,
);

text.push("## Trouble\n");
let hasTrouble = false;
for (const pass of open) {
  for (const [kind, files] of Object.entries(pass.trouble)) {
    hasTrouble = true;
    const list = files as string[];
    text.push(`- ${pass.plan}, ${pass.corpus}: **${kind}**: ${list.length} file(s): ${list.slice(0, 10).join(", ")}`);
  }
}
if (!hasTrouble) text.push("None.");

const closed = passes.filter(it => it.confidential);
if (closed.length > 0) {
  text.push("\n## The confidential corpus: numbers only\n");
  table(closed, false);
  for (const pass of closed) {
    for (const [kind, count] of Object.entries(pass.trouble)) {
      if (typeof count !== "number") throw new Error("names of files of a confidential corpus");
      text.push(`- ${pass.plan}: ${kind}: ${count} file(s)`);
    }
  }
}

writeFileSync(join(out, "SUMMARY.md"), text.join("\n") + "\n");
console.log(text.slice(2, 40).join("\n"));
