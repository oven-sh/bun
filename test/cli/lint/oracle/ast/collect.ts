// Collects source texts into one JSONL file, a line being {"id", "filename", "code", "sourceType", "parser"}.
//
//   bun collect.ts --out inputs.jsonl [--fixtures <conformance/fixtures>] [--files <dir> <glob>]..
//
// --fixtures: the `code` and `output` of every case of the conformance fixtures, under its `filename`.
// --files: the files of a directory that match a glob.
import { Glob } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const inputs: string[] = [];
const seen = new Set<string>();
let out = "inputs.jsonl";
let maxBytes = 2_000_000;

function add(id: string, filename: string, code: string, sourceType?: string, parser?: string) {
  // What is not well-formed does not survive the trip to UTF-8.
  if (!code.isWellFormed()) return;
  sourceType ??= /\.m[jt]s$/.test(filename) || /^\s*(import|export)\b/m.test(code) ? "module" : "commonjs";
  const key = filename.slice(filename.lastIndexOf(".")) + "\0" + sourceType + "\0" + code;
  if (seen.has(key) || code.length > maxBytes) return;
  seen.add(key);
  inputs.push(JSON.stringify({ id, filename, code, sourceType, parser }));
}

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--out":
      out = args[++i];
      break;
    case "--max-bytes":
      maxBytes = Number(args[++i]);
      break;
    case "--fixtures": {
      const root = args[++i];
      for (const path of [...new Glob("*/*.json").scanSync(root)].sort()) {
        const fixture = JSON.parse(readFileSync(join(root, path), "utf8"));
        (fixture.cases ?? []).forEach((it: any, index: number) => {
          const id = `${path.replace(/\.json$/, "")}#${index}`;
          const { sourceType, parser } = it.languageOptions ?? {};
          add(id, it.filename ?? "file.js", it.code, sourceType, parser);
          if (typeof it.output === "string") add(`${id}:output`, it.filename ?? "file.js", it.output, sourceType, parser);
        });
      }
      break;
    }
    case "--files": {
      const root = args[++i];
      const glob = new Glob(args[++i]);
      for (const path of [...glob.scanSync(root)].sort()) {
        if (path.includes("node_modules/")) continue;
        const bytes = readFileSync(join(root, path));
        const code = bytes.toString("utf8");
        // Text that is not UTF-8 does not survive the trip through JSON.
        if (Buffer.from(code, "utf8").equals(bytes)) add(join(root, path), path, code);
      }
      break;
    }
    default:
      throw new Error(`unknown argument ${args[i]}`);
  }
}
writeFileSync(out, inputs.join("\n") + "\n");
console.log(`${inputs.length} inputs in ${out}`);
