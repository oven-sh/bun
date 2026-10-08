// Compares `bun-lint regex parse` with the fixtures of @eslint-community/regexpp.
//
//   bun test/cli/lint/oracle/regex/parse.ts <bun-lint> <regexpp checkout> [--verbose]

import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { ask, hex } from "./common.ts";

const [binary, regexpp] = process.argv.slice(2);
const verbose = process.argv.includes("--verbose");

function* json(dir: string): Iterable<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) yield* json(join(dir, entry.name));
    else if (entry.name.endsWith(".json")) yield join(dir, entry.name);
  }
}

/** `parent`, `resolved` and `references` are absolute paths in the dump and relative ones in the fixtures. */
function relativize(node: any, path: string): any {
  if (Array.isArray(node)) return node.map((child, i) => relativize(child, `${path}/${i}`));
  if (typeof node !== "object" || node === null) return node;
  const relative = (to: unknown): unknown =>
    Array.isArray(to)
      ? to.map(relative)
      : typeof to === "string"
        ? `♻️${posix.relative(path || "/", to || "/").replace(/\/$/u, "")}`
        : to;
  const out: any = {};
  for (const key of Object.keys(node)) {
    out[key] =
      key === "parent" || key === "resolved" || key === "references"
        ? relative(node[key])
        : relativize(node[key], `${path}/${key}`);
  }
  return out;
}

type Case = { file: string; source: string; request: string[]; expected: unknown };
const cases: Case[] = [];

for (const file of json(join(regexpp, "test/fixtures/parser/literal"))) {
  const { options, patterns } = JSON.parse(readFileSync(file, "utf8"));
  for (const [source, expected] of Object.entries<any>(patterns)) {
    const head = [options.strict ? "1" : "0", String(options.ecmaVersion ?? 2025)];
    cases.push({ file, source, request: ["literal", ...head, hex(source)], expected });
  }
}
for (const file of json(join(regexpp, "test/fixtures/visitor"))) {
  const { options, patterns } = JSON.parse(readFileSync(file, "utf8"));
  for (const [source, expected] of Object.entries<any>(patterns)) {
    const head = [options.strict ? "1" : "0", String(options.ecmaVersion ?? 2025)];
    cases.push({ file, source, request: ["visit", ...head, hex(source)], expected });
  }
}

const answers = ask(
  binary,
  "parse",
  cases.map(c => c.request),
);
let failed = 0;
cases.forEach(({ file, source, expected }, i) => {
  const actual = answers[i]?.ast ? { ast: relativize(answers[i].ast, "") } : answers[i];
  if (Bun.deepEquals(actual, expected, true)) return;
  failed++;
  if (verbose || failed <= 20) {
    console.log(`${file.slice(regexpp.length)}: ${source}`);
    const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
    let at = 0;
    while (at < a.length && a[at] === e[at]) at++;
    console.log(`  actual   ..${a.slice(Math.max(0, at - 60), at + 100)}`);
    console.log(`  expected ..${e.slice(Math.max(0, at - 60), at + 100)}`);
  }
});
console.log(`${cases.length - failed} of ${cases.length} as regexpp`);
process.exit(failed ? 1 : 0);
