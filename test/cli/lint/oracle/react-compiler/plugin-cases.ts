// The test cases of eslint-plugin-react-hooks for its rules of the React Compiler as files, for eslint.ts.
//
//   bun plugin-cases.ts <react>/packages/eslint-plugin-react-hooks/__tests__ <out directory>
//
// Of `ReactCompilerRule*-test.ts`: each `filename: '..'` with the `code:` that follows it, which is a template without
// substitutions, after `normalizeIndent` or not. What comes after `invalid: [` is not valid. Nothing of the files is run. Writes
// <Flow|Typescript>/<number>.<valid|invalid>.<extension of the filename>. The cases with Flow's `component` and `hook` are for
// hermes-eslint: espree refuses them.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { options } from "./shared.ts";

/** What the tag of that name in the test files does: it removes the indentation of the second line from all lines. */
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
