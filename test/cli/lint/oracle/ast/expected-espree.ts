// What espree makes of each input, as JSONL: {"id", "ast"} or {"id", "error"}.
//
//   bun expected-espree.ts <espree> <inputs.jsonl> <expected.jsonl>
//
// <espree>: the directory of the package espree. Inputs that are not JavaScript, or that the fixtures parse with
// another parser, are {"id", "error": "skipped"}.
import { createWriteStream, readFileSync } from "node:fs";
import { resolve } from "node:path";

const [espreePath, inputs, output] = process.argv.slice(2);
const espree = require(resolve(espreePath));

function normalize(value: any): any {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint" || value instanceof RegExp) return null;
  if (value === null || typeof value !== "object") return value;
  const result: any = {};
  for (const key of Object.keys(value)) {
    if (key === "loc" || key === "start" || key === "end" || key === "tokens" || key === "comments") continue;
    if (value[key] !== undefined) result[key] = normalize(value[key]);
  }
  return result;
}

const out = createWriteStream(output);
let rejected = 0, skipped = 0;
const lines = readFileSync(inputs, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  const { id, filename, code, sourceType, parser } = JSON.parse(line);
  let result: any;
  if (!/\.[cm]?jsx?$/.test(filename) || (parser && parser !== "espree")) {
    skipped++;
    result = { id, error: "skipped" };
  } else {
    try {
      const ast = espree.parse(code, { range: true, ecmaVersion: "latest", sourceType, ecmaFeatures: { jsx: true } });
      result = { id, ast: normalize(ast) };
    } catch (error: any) {
      rejected++;
      result = { id, error: String(error?.message ?? error) };
    }
  }
  out.write(JSON.stringify(result) + "\n");
}
out.end();
console.log(`${lines.length} inputs, ${skipped} skipped, ${rejected} rejected`);
