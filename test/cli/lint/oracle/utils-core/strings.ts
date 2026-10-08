// Every string of each case as ESLint has it (`Literal` with a string value, `TemplateLiteral` without substitutions, `TemplateElement` of
// a template literal type), compared with `bun-lint utils-core strings`.
//
//   TYPESCRIPT_ESLINT_DIR=<typescript-eslint checkout, built> bun strings.ts cases.jsonl actual.jsonl

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const typescriptEslintDir = process.env.TYPESCRIPT_ESLINT_DIR;
if (!typescriptEslintDir) throw new Error("set TYPESCRIPT_ESLINT_DIR");
const parser = createRequire(import.meta.url)(join(typescriptEslintDir, "packages/parser/dist/index.js"));
const [casesPath, actualPath] = process.argv.slice(2);
const actual = new Map(
  readFileSync(actualPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .map(it => [it.id, it]),
);
let same = 0;
let shown = 0;
const different = new Map<string, number>();
for (const line of readFileSync(casesPath, "utf8").split("\n")) {
  if (!line) continue;
  const it = JSON.parse(line);
  const ours = actual.get(it.id);
  if (!ours || ours.error) continue;
  let parsed;
  try {
    parsed = parser.parseForESLint(it.code, { filePath: it.filename, sourceType: it.sourceType, ecmaFeatures: { jsx: it.jsx || /x$/.test(it.filename), globalReturn: true } });
  } catch {
    continue;
  }
  const want = new Map<string, string>();
  const visit = (node: any, parent: any) => {
    const isString =
      (node.type === "Literal" && typeof node.value === "string" && parent.type !== "JSXAttribute") ||
      (node.type === "TemplateLiteral" && node.expressions.length === 0) ||
      (node.type === "TemplateElement" && parent.type === "TSTemplateLiteralType");
    if (isString) want.set(`${node.range[0]}-${node.range[1]}`, `${node.type} ${parent.type}`);
    for (const key of parsed.visitorKeys[node.type] ?? []) {
      for (const child of [node[key]].flat()) if (child && typeof child.type === "string") visit(child, node);
    }
  };
  visit(parsed.ast, null);
  const found = new Map<string, string>(
    ours.strings
      .split(",")
      .filter(Boolean)
      .map((entry: string) => [entry.slice(0, entry.indexOf(" ")), entry.slice(entry.indexOf(" ") + 1)]),
  );
  for (const [range, value] of found) {
    if (value.startsWith("Literal -") && !want.has(range)) continue; // The value of a JSX attribute.
    const wanted = want.get(range);
    if (wanted === value || (value.endsWith(" -") && wanted?.startsWith(value.slice(0, -1)))) same++;
    else {
      different.set(`ours ${value} / want ${wanted}`, (different.get(`ours ${value} / want ${wanted}`) ?? 0) + 1);
      if (shown++ < 15) console.log(`#${it.id} ${range} ours ${value} want ${wanted} ${JSON.stringify(it.code).slice(0, 150)}`);
    }
  }
  for (const [range, value] of want) {
    if (found.has(range)) continue;
    different.set(`missing ${value}`, (different.get(`missing ${value}`) ?? 0) + 1);
    if (shown++ < 15) console.log(`#${it.id} ${range} missing ${value} ${JSON.stringify(it.code).slice(0, 150)}`);
  }
}
console.log(`${same} the same`);
for (const [key, count] of [...different].sort((a, b) => b[1] - a[1])) console.log(`${count} ${key}`);
