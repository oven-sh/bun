// Collects the cases for `dump.ts` and `bun-lint semantic dump --batch`, one JSON object a line.
//
//   bun cases.ts --fixtures <test/cli/lint/conformance/fixtures> > cases.jsonl     the `code` of every conformance case
//   bun cases.ts --files <directory or file>.. [--parser=typescript] > cases.jsonl source files
//   bun cases.ts --scope-manager <typescript-eslint/packages/scope-manager/tests/fixtures> > cases.jsonl
//   bun cases.ts --edge-cases > cases.jsonl                                        the snippets of edge-cases.ts
//
// The same code with the same options is listed once.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { javascript, tsx, typescript } from "./edge-cases.ts";

const seen = new Set<string>();
let count = 0;
function emit(it: Record<string, unknown>) {
  const key = JSON.stringify(it);
  if (seen.has(key)) return;
  seen.add(key);
  console.log(JSON.stringify({ id: count++, ...it }));
}

function* walk(path: string): Generator<string> {
  // A link to nowhere.
  if (!existsSync(path)) return;
  if (!statSync(path).isDirectory()) return yield path;
  for (const name of readdirSync(path).sort()) {
    if (name !== "node_modules" && name !== ".git") yield* walk(join(path, name));
  }
}

const [mode, ...rest] = process.argv.slice(2);
const paths = rest.filter(it => !it.startsWith("--"));
// JavaScript files as `@typescript-eslint/parser` sees them.
const parser = rest.includes("--parser=typescript") ? "typescript" : undefined;
if (mode === "--fixtures") {
  for (const file of walk(paths[0])) {
    if (!file.endsWith(".json") || file.includes("typescript-eslint-project")) continue;
    const fixture = JSON.parse(readFileSync(file, "utf8"));
    for (const it of fixture.cases ?? []) {
      const language = it.languageOptions ?? {};
      if (it.skip || (language.parser !== "espree" && language.parser !== "typescript")) continue;
      const options = language.parserOptions ?? {};
      const features = options.ecmaFeatures ?? {};
      emit({
        filename: it.filename.replace(/^.*\//, ""),
        code: it.code,
        sourceType: language.sourceType,
        ecmaVersion: language.parser === "espree" ? language.ecmaVersion : undefined,
        jsx: features.jsx || undefined,
        globalReturn: features.globalReturn || undefined,
        impliedStrict: (language.parser === "espree" && features.impliedStrict) || undefined,
        jsxPragma: options.jsxPragma,
        jsxFragmentName: options.jsxFragmentName,
      });
    }
  }
} else if (mode === "--scope-manager") {
  for (const file of walk(paths[0])) {
    if (!/\.tsx?$/.test(file)) continue;
    const code = readFileSync(file, "utf8");
    // `//// @sourceType = module`
    const options: Record<string, unknown> = {};
    for (const [, key, value] of code.matchAll(/^\/\/\/\/ @(\w+) = (.*)$/gm)) {
      options[key] = /^(true|false|null)$/.test(value) ? JSON.parse(value) : value.replace(/^'|'$/g, "");
    }
    emit({
      filename: file.endsWith("x") ? "file.tsx" : "file.ts",
      name: file.slice(paths[0].length + 1),
      code,
      sourceType: options.sourceType ?? "script",
      globalReturn: options.globalReturn || undefined,
      jsxPragma: options.jsxPragma,
      jsxFragmentName: options.jsxFragmentName,
    });
  }
} else if (mode === "--files") {
  for (const root of paths) {
    for (const file of walk(root)) {
      if (!/\.[cm]?[jt]sx?$/.test(file) || statSync(file).size > 2_000_000) continue;
      emit({
        filename: file,
        code: readFileSync(file, "utf8"),
        sourceType: /\.c[jt]s$/.test(file) ? "commonjs" : "module",
        parser,
        jsx: (parser && /\.jsx?$/.test(file)) || undefined,
      });
    }
  }
} else if (mode === "--edge-cases") {
  for (const sourceType of ["script", "module", "commonjs"]) {
    for (const code of javascript) {
      for (const ecmaVersion of [5, 2015, "latest"]) emit({ filename: "file.jsx", code, sourceType, ecmaVersion, jsx: true });
      emit({ filename: "file.jsx", code, sourceType, parser: "typescript", jsx: true });
      emit({ filename: "file.tsx", code, sourceType });
    }
    for (const code of typescript) {
      for (const filename of ["file.ts", "file.d.ts"]) emit({ filename, code, sourceType });
    }
    for (const code of tsx) {
      emit({ filename: "file.tsx", code, sourceType });
      emit({ filename: "file.tsx", code, sourceType, jsxPragma: "h", jsxFragmentName: "Fragment" });
      emit({ filename: "file.tsx", code, sourceType, jsxPragma: null });
    }
  }
} else {
  throw new Error("usage: bun cases.ts --fixtures <dir> | --scope-manager <dir> | --files <path>.. | --edge-cases");
}
