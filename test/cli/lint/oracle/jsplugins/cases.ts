// Collects cases for `run-eslint.ts` and `bun-lint js_plugin batch`, one JSON object a line:
// `{ id, filename, code, languageOptions, settings }`.
//
//   bun cases.ts --fixtures <test/cli/lint/conformance/fixtures> > cases.jsonl   the `code` of every conformance case
//   bun cases.ts --files <directory or file>.. > cases.jsonl                     source files
//
// The same code with the same options is listed once.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const seen = new Set<string>();
let count = 0;
function emit(it: Record<string, unknown>) {
  const key = JSON.stringify(it);
  if (seen.has(key)) return;
  seen.add(key);
  console.log(JSON.stringify({ id: count++, ...it }));
}

function* walk(path: string): Generator<string> {
  if (!existsSync(path)) return;
  if (!statSync(path).isDirectory()) return yield path;
  for (const name of readdirSync(path).sort()) {
    if (name !== "node_modules" && name !== ".git") yield* walk(join(path, name));
  }
}

const [mode, ...paths] = process.argv.slice(2);
if (mode === "--fixtures") {
  for (const file of walk(paths[0])) {
    if (!file.endsWith(".json") || file.includes("-project")) continue;
    for (const it of JSON.parse(readFileSync(file, "utf8")).cases ?? []) {
      const parser = it.languageOptions?.parser;
      if (it.skip || (parser !== "espree" && parser !== "typescript")) continue;
      // Without types.
      const { project, projectService, tsconfigRootDir, ...parserOptions } = it.languageOptions.parserOptions ?? {};
      emit({
        filename: it.filename.replace(/^.*\//, ""),
        code: it.code,
        languageOptions: { ...it.languageOptions, parserOptions },
      });
    }
  }
} else {
  for (const root of paths) {
    for (const file of walk(root)) {
      if (!/\.[cm]?[jt]sx?$/.test(file) || statSync(file).size > 2_000_000) continue;
      const isJavaScript = /\.[cm]?jsx?$/.test(file);
      emit({
        filename: file.replace(/^.*\//, ""),
        name: file,
        code: readFileSync(file, "utf8"),
        languageOptions: {
          parser: isJavaScript ? "espree" : "typescript",
          sourceType: file.endsWith(".cjs") ? "commonjs" : "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
      });
    }
  }
}
