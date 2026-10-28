// src/aot/compile/removable.rs answers, on the tree of the ahead-of-time compiler, what the bundler's parser answers on its own: can a
// statement at the top level of a module be left out when nothing uses what it declares? Its table of programs,
// src/aot/compile/removable/rows.tsv, also says what the bundler does with each of them. This test holds those two columns against the
// bundler: every program is a module that the entry point imports for its side effects only, and the statement is gone from the output
// or it is not.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = { line: number; plain: string; minified: string; path: string; mark: string; source: string };

const table = readFileSync(join(import.meta.dir, "../../src/aot/compile/removable/rows.tsv"), "utf8");
const rows: Row[] = [];
table.split("\n").forEach((text, index) => {
  if (!text || text.startsWith("#")) return;
  const [, plain, minified, , configuration, extension, source] = text.split("\t");
  if (plain === ".") return;
  const line = index + 1;
  const folder = configuration === "legacy" ? "legacy/" : "";
  rows.push({ line, plain, minified, path: `${folder}row${line}.${extension}`, mark: `mark${line}_`, source });
});

const dependency = `export const value = "v"; export function fn() {} export class Base {} export enum Color { Red, Green } export default 1;`;
const jsxRuntime = `export function jsx() {} export function jsxs() {} export function jsxDEV() {} export const Fragment = "f";`;

function sources(): Record<string, string> {
  const files: Record<string, string> = {
    "entry.ts": rows.map(row => `import "./${row.path}";`).join("\n"),
    "dep.ts": dependency,
    "legacy/dep.ts": dependency,
    "tsconfig.json": `{ "compilerOptions": { "jsx": "react-jsx" } }`,
    "legacy/tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true, "jsx": "react-jsx" } }`,
    "node_modules/react/package.json": `{ "name": "react", "version": "1.0.0" }`,
    "node_modules/react/jsx-runtime.js": jsxRuntime,
    "node_modules/react/jsx-dev-runtime.js": jsxRuntime,
  };
  for (const row of rows) files[row.path] = row.source.replaceAll("MARK", row.mark);
  return files;
}

async function answers(syntax: boolean): Promise<string[]> {
  using directory = tempDir("removable-statements", sources());
  const result = await Bun.build({
    entrypoints: [join(String(directory), "entry.ts")],
    target: "bun",
    minify: { syntax },
  });
  expect(result.logs.filter(log => log.level === "error")).toEqual([]);
  const output = await result.outputs[0].text();
  return rows.map(row => `${row.line} ${output.includes(row.mark) ? "-" : "+"} ${row.source}`);
}

test("the table has rows", () => {
  expect(rows.length).toBeGreaterThan(150);
});

test("bun build removes what the table says", async () => {
  expect(await answers(false)).toEqual(rows.map(row => `${row.line} ${row.plain} ${row.source}`));
});

test("bun build --minify-syntax removes what the table says", async () => {
  expect(await answers(true)).toEqual(rows.map(row => `${row.line} ${row.minified} ${row.source}`));
});
