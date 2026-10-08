// The conformance fixtures of a plugin as cases for `bun-lint js_plugin batch`, and what ESLint reports for them, which is
// recorded there.
//
//   bun conformance.ts <test/cli/lint/conformance/fixtures/eslint> <prefix of the rule ids> cases.jsonl expected.jsonl [--rule=name]

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [directory, prefix, casesPath, expectedPath] = process.argv.slice(2).filter(it => !it.startsWith("--"));
const only = process.argv.find(it => it.startsWith("--rule="))?.slice(7);
const cases: string[] = [];
const expected: string[] = [];
for (const file of readdirSync(directory).sort()) {
  const fixture = JSON.parse(readFileSync(join(directory, file), "utf8"));
  if (only && fixture.rule !== only) continue;
  fixture.cases.forEach((it: any, index: number) => {
    const parser = it.languageOptions?.parser;
    if (it.skip || it.typeAware || (parser !== "espree" && parser !== "typescript")) return;
    const id = `${fixture.rule}#${index}`;
    // `deepMergeArrays(meta.defaultOptions, options)` is the business of the configuration.
    cases.push(
      JSON.stringify({
        id,
        filename: it.filename,
        code: it.code,
        languageOptions: it.languageOptions,
        settings: it.settings,
        rules: { [fixture.rule]: merge(fixture.meta.defaultOptions ?? [], it.options ?? []) },
      }),
    );
    const messages = it.messages.map(({ ruleId, suggestions, ...message }: any) => ({
      ruleId: ruleId === undefined ? `${prefix}/${fixture.rule}` : ruleId,
      ...message,
      ...(suggestions?.length ? { suggestions: suggestions.map(({ output, data, ...suggestion }: any) => suggestion) } : {}),
    }));
    expected.push(JSON.stringify({ id, messages }, (_, value) => (value === null ? undefined : value)));
  });
}
writeFileSync(casesPath, cases.join("\n") + "\n");
writeFileSync(expectedPath, expected.join("\n") + "\n");

function mergeObjects(first: any, second: any): any {
  const isObject = (it: any) => typeof it === "object" && it !== null && !Array.isArray(it);
  if (second === undefined) return first;
  if (!isObject(first) || !isObject(second)) return second;
  const result = { ...first, ...second };
  for (const key of Object.keys(second)) {
    if (Object.hasOwn(first, key)) result[key] = mergeObjects(first[key], second[key]);
  }
  return result;
}

function merge(first: any[], second: any[]) {
  return [...first.map((it, i) => mergeObjects(it, second[i])), ...second.slice(first.length)];
}
