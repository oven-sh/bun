// Writes `fixtures/index.json` from the fixtures on disk and, with
// `--summary <file.md>`, a human-readable report that also covers what the
// extractors left in `.report/` (disagreements with upstream, omitted cases).
//
//   bun summarize.ts [--summary <file.md>]

import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson, type Disagreement, type Fixture, type RuleReport } from "./shared.ts";

const here = import.meta.dirname;
const summaryFlag = process.argv.indexOf("--summary");
const summaryFile = summaryFlag === -1 ? null : process.argv[summaryFlag + 1];

interface IndexEntry {
  plugin: Fixture["plugin"];
  rule: string;
  cases: number;
  skipped: number;
  typeAware: number;
}

const index: IndexEntry[] = [];
const sections: string[] = [];

const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const byCount = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const oneLine = (code: string) => JSON.stringify(code.length > 100 ? code.slice(0, 100) + "…" : code);

for (const plugin of ["eslint", "typescript-eslint"] as const) {
  const dir = join(here, "fixtures", plugin);
  if (!existsSync(dir)) continue;

  const entries: IndexEntry[] = [];
  const skipReasons = new Map<string, number>();
  const parsers = new Map<string, number>();
  const tsconfigs = new Map<string, number>();
  const empty: string[] = [];
  const invalidWithoutMessages: string[] = [];
  const foreignMessages: string[] = [];
  let bytes = 0;
  let valid = 0;
  let messages = 0;
  let fixes = 0;
  let suggestions = 0;
  let deprecated = 0;

  for (const file of readdirSync(dir).sort()) {
    bytes += statSync(join(dir, file)).size;
    const fixture = readJson<Fixture>(join(dir, file));
    const { rule, cases } = fixture;
    if (cases.length === 0) empty.push(rule);
    if (fixture.meta.deprecated) deprecated++;
    cases.forEach((c, i) => {
      if (c.valid) valid++;
      // "parser: tests/fixtures/parsers/foo.js" -> "parser"
      if (c.skip) count(skipReasons, c.skip.replace(/:.*/s, ""));
      if (c.tsconfig) count(tsconfigs, c.tsconfig);
      count(parsers, c.languageOptions.parser);
      messages += c.messages.length;
      fixes += c.messages.filter(m => m.fix).length;
      suggestions += c.messages.reduce((n, m) => n + m.suggestions.length, 0);
      if (!c.valid && c.messages.length === 0) invalidWithoutMessages.push(`${rule}#${i} (skip: ${c.skip})`);
      if (!c.skip && c.messages.some(m => "ruleId" in m)) foreignMessages.push(`${rule}#${i}`);
    });
    entries.push({
      plugin,
      rule,
      cases: cases.length,
      skipped: cases.filter(c => c.skip).length,
      typeAware: cases.filter(c => c.typeAware).length,
    });
  }
  index.push(...entries);

  const disagreements: Disagreement[] = [];
  const notes: string[] = [];
  const reportDir = join(here, ".report", plugin);
  for (const file of existsSync(reportDir) ? readdirSync(reportDir).sort() : []) {
    const report = readJson<RuleReport>(join(reportDir, file));
    disagreements.push(...report.disagreements);
    notes.push(...report.notes.map(note => `${report.rule}: ${note}`));
  }

  const total = entries.reduce((n, e) => n + e.cases, 0);
  const list = (items: string[]) => (items.length > 0 ? items.map(item => `- ${item}`).join("\n") : "- none");
  const typeAware = entries.filter(e => e.typeAware > 0);
  sections.push(`## ${plugin}

- rules: ${entries.length} (${deprecated} deprecated)
- cases: ${total} (${valid} valid, ${total - valid} invalid)
- messages: ${messages} (${fixes} with a fix, ${suggestions} suggestions)
- parser: ${byCount(parsers)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ")}
- type-aware cases: ${typeAware.reduce((n, e) => n + e.typeAware, 0)} in ${typeAware.length} rules
- size on disk: ${(bytes / 1e6).toFixed(1)} MB
- rules with 0 cases: ${empty.join(", ") || "none"}

### Skipped: ${entries.reduce((n, e) => n + e.skipped, 0)}

${list(byCount(skipReasons).map(([reason, n]) => `${reason}: ${n}`))}

### Disagreements with what upstream asserts: ${disagreements.length}

${list(disagreements.map(d => `\`${d.rule}#${d.index}\` ${oneLine(d.code)} (skip: ${d.skip}): ${d.problems.join("; ")}`))}

### Invalid cases without a message

${list(invalidWithoutMessages)}

### Cases (not skipped) that also report another rule, enabled by a comment in the code

${list(foreignMessages)}

### Notes from the extractor

${list(notes)}

### Most cases

${list(
  [...entries]
    .sort((a, b) => b.cases - a.cases)
    .slice(0, 20)
    .map(e => `${e.rule}: ${e.cases}`),
)}

### Rules with type-aware cases (type-aware/all)

${typeAware.map(e => `${e.rule} ${e.typeAware}/${e.cases}`).join(", ") || "none"}

### tsconfig of the type-aware cases

${list(byCount(tsconfigs).map(([file, n]) => `${file}: ${n}`))}
`);
}

writeJson(join(here, "fixtures/index.json"), index);
if (summaryFile) writeFileSync(summaryFile, `# Lint conformance fixtures\n\n${sections.join("\n")}`);
console.log(`${index.length} rules, ${index.reduce((n, e) => n + e.cases, 0)} cases`);
