// ESLint's `sourceCode.getNodeByRangeIndex(i).type` for every offset of each case, compared with `bun-lint utils-core types-at`.
//
//   ESLINT_DIR=<eslint checkout> TYPESCRIPT_ESLINT_DIR=<typescript-eslint checkout, built> bun types-at.ts cases.jsonl actual.jsonl [--limit=<n>] [--only=<want>/<ours>]
//
// Only cases in ASCII are compared, so that an index is an offset in bytes.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const eslintDir = process.env.ESLINT_DIR;
const typescriptEslintDir = process.env.TYPESCRIPT_ESLINT_DIR;
if (!eslintDir || !typescriptEslintDir) throw new Error("set ESLINT_DIR and TYPESCRIPT_ESLINT_DIR");
const fromEslint = createRequire(join(eslintDir, "package.json"));
const { Linter } = fromEslint("./lib/api.js");
const typescriptParser = fromEslint(join(typescriptEslintDir, "packages/parser/dist/index.js"));
const [casesPath, actualPath, ...flags] = process.argv.slice(2);
const limit = Number(flags.find(it => it.startsWith("--limit="))?.slice(8) ?? 2);
const only = flags.find(it => it.startsWith("--only="))?.slice(7);

let types: string[] = [];
const rule = {
  create(context: any) {
    return {
      "Program:exit"() {
        const sourceCode = context.sourceCode;
        types = Array.from(sourceCode.text, (_, i) => sourceCode.getNodeByRangeIndex(i)?.type ?? "Program");
      },
    };
  },
};
const actual = new Map(
  readFileSync(actualPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .map(it => [it.id, it]),
);
const linter = new Linter({ configType: "flat" });
const tally = new Map<string, { count: number; examples: string[] }>();
let same = 0;
let compared = 0;
for (const line of readFileSync(casesPath, "utf8").split("\n")) {
  if (!line) continue;
  const it = JSON.parse(line);
  const ours = actual.get(it.id);
  if (!ours || ours.error) continue;
  const isJavaScript = /\.[cm]?jsx?$/.test(it.filename);
  types = [];
  const messages = linter.verify(
    it.code,
    [
      {
        files: ["**/*", "**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.jsx", "**/*.d.ts"],
        linterOptions: { reportUnusedDisableDirectives: "off", noInlineConfig: true },
        languageOptions: {
          sourceType: it.sourceType ?? "module",
          ...(isJavaScript ? { ecmaVersion: it.ecmaVersion ?? "latest" } : { parser: typescriptParser }),
          parserOptions: { ecmaFeatures: { jsx: it.jsx || /x$/.test(it.filename), globalReturn: it.globalReturn } },
        },
        plugins: { oracle: { rules: { dump: rule } } },
        rules: { "oracle/dump": "error" },
      },
    ],
    { filename: it.filename.replace(/^.*\//, "") },
  );
  if (messages.some((message: any) => message.fatal || message.ruleId === null)) continue;
  compared++;
  let at = 0;
  for (const run of ours.runs.split(",")) {
    const [name, count] = run.split(" ");
    for (let i = 0; i < Number(count); i++, at++) {
      if (types[at] === name) same++;
      else {
        const key = `${types[at]}/${name}`;
        let entry = tally.get(key);
        if (!entry) tally.set(key, (entry = { count: 0, examples: [] }));
        entry.count++;
        const example = `#${it.id} ${it.filename} @${at} ${JSON.stringify(it.code.slice(Math.max(0, at - 30), at))} >>> ${JSON.stringify(it.code.slice(at, at + 30))}`;
        if (entry.examples.length < limit && !entry.examples.some(e => e.startsWith(`#${it.id} `))) entry.examples.push(example);
      }
    }
  }
}
console.log(`${compared} cases, ${same} offsets the same`);
for (const [key, entry] of [...tally].sort((a, b) => b[1].count - a[1].count)) {
  if (only && key !== only) continue;
  console.log(`${entry.count} want/ours ${key}`);
  for (const example of entry.examples) console.log(`    ${example}`);
}
