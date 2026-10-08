// What typescript-estree makes of each input, as JSONL: {"id", "ast"} or {"id", "error"}.
//
//   bun expected.ts <typescript-estree> <inputs.jsonl> <expected.jsonl>
//
// <typescript-estree>: the directory of the built package @typescript-eslint/typescript-estree.
import { createWriteStream, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [estree, inputs, output] = process.argv.slice(2);
const { parse } = require(join(resolve(estree), "dist/index.js"));

// Drops what is not compared, and makes the rest JSON.
function normalize(value: any): any {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint" || value instanceof RegExp) return null;
  if (value === null || typeof value !== "object") return value;
  const result: any = {};
  for (const key of Object.keys(value)) {
    if (key === "loc" || key === "parent" || key === "tokens" || key === "comments") continue;
    if (value[key] !== undefined) result[key] = normalize(value[key]);
  }
  return result;
}

const out = createWriteStream(output);
let rejected = 0;
const lines = readFileSync(inputs, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  const { id, filename, code } = JSON.parse(line);
  let result: any;
  try {
    const ast = parse(code, {
      range: true,
      loc: false,
      comment: false,
      tokens: false,
      jsx: /x$/.test(filename),
      filePath: filename,
      suppressDeprecatedPropertyWarnings: true,
    });
    result = { id, ast: normalize(ast) };
  } catch (error: any) {
    rejected++;
    result = { id, error: String(error?.message ?? error) };
  }
  out.write(JSON.stringify(result) + "\n");
}
out.end();
console.log(`${lines.length} inputs, ${rejected} rejected`);
