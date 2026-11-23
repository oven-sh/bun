// Writes eslint-plugin-react-hooks's test cases for its React Compiler rules as files, for eslint.ts.
//
//   bun plugin-cases.ts <react>/packages/eslint-plugin-react-hooks/__tests__ <out directory>
//
// Scans `ReactCompilerRule*-test.ts` for each `filename: '..'` and the `code:` after it, which is a template without
// substitutions, optionally tagged with `normalizeIndent`. Cases after `invalid: [` are invalid. The test files are
// never executed. Writes <Flow|Typescript>/<number>.<valid|invalid>.<extension of the filename>. The cases with Flow's
// `component` and `hook` need hermes-eslint, because espree rejects them.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { options } from "./shared.ts";

/** Same as the tag with this name in the test files: removes the second line's indentation from every line. */
function normalizeIndent(text: string): string {
  const lines = text.split("\n");
  const padding = /\s+/.exec(lines[1] ?? "")?.[0] ?? "";
  return lines.map(line => line.slice(padding.length)).join("\n");
}

const { rest } = options(process.argv.slice(2));
if (rest.length !== 2) throw new Error("usage: bun plugin-cases.ts <__tests__> <out directory>");
const [tests, out] = rest.map(path => resolve(path));

let count = 0;
for (const name of readdirSync(tests).sort()) {
  const kind = /^ReactCompilerRule(\w+)-test\.ts$/.exec(name)?.[1];
  if (kind === undefined) continue;
  const text = readFileSync(join(tests, name), "utf8");
  const invalidFrom = text.indexOf("\n  invalid: [");
  mkdirSync(join(out, kind), { recursive: true });
  let number = 0;
  for (const match of text.matchAll(/\bfilename: '([^']+)',[^`]*?\bcode: (normalizeIndent)?`((?:[^`\\]|\\.)*)`/gs)) {
    const cooked = match[3].replace(/\\(.)/gs, "$1");
    const is = match.index < invalidFrom ? "valid" : "invalid";
    const file = `${String(++number).padStart(2, "0")}.${is}${extname(match[1])}`;
    writeFileSync(join(out, kind, file), match[2] === undefined ? cooked : normalizeIndent(cooked));
    count++;
  }
}
console.log(`${count} cases`);
