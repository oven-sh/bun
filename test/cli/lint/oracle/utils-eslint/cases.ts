// Collects the cases for `dump.ts` and `bun-lint utils-eslint dump`, one JSON object a line.
//
//   bun cases.ts --fixtures <test/cli/lint/conformance/fixtures> > cases.jsonl     the `code` of every conformance case
//   bun cases.ts --upstream <eslint-utils checkout>/test > cases.jsonl             the `code` of upstream's own tests
//   bun cases.ts --files <directory> > cases.jsonl                                 source files
//   bun cases.ts --lines <file> > cases.jsonl                                      each line of a file is a case
//
// A case is `{ id, filename, code, sourceType, ecmaVersion, jsx, names }`. `names` are the words of the code: they are the
// global variables that are configured, and the keys of the trace maps.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const seen = new Set<string>();
let count = 0;
function emit(it: Record<string, unknown> & { code: string }) {
  const key = JSON.stringify(it);
  if (seen.has(key)) return;
  seen.add(key);
  const words = new Set(["default"]);
  for (const [word] of it.code.matchAll(/[A-Za-z_$][\w$]*|(?<=["'])[\w./@-]+(?=["'])/g)) {
    if (words.size < 24) words.add(word);
  }
  console.log(JSON.stringify({ id: count++, ...it, names: [...words] }));
}

function* walk(path: string): Generator<string> {
  if (!statSync(path).isDirectory()) return yield path;
  for (const name of readdirSync(path).sort()) {
    if (name !== "node_modules" && name !== ".git") yield* walk(join(path, name));
  }
}

const [mode, path] = process.argv.slice(2);
if (mode === "--fixtures") {
  for (const file of walk(path)) {
    if (!file.endsWith(".json") || file.includes("typescript-eslint-project")) continue;
    const fixture = JSON.parse(readFileSync(file, "utf8"));
    for (const it of fixture.cases ?? []) {
      const language = it.languageOptions ?? {};
      if (it.skip || (language.parser !== "espree" && language.parser !== "typescript")) continue;
      emit({
        filename: it.filename.replace(/^.*\//, ""),
        code: it.code,
        sourceType: language.sourceType,
        ecmaVersion: language.parser === "espree" ? language.ecmaVersion : undefined,
        jsx: language.parserOptions?.ecmaFeatures?.jsx || undefined,
      });
    }
  }
} else if (mode === "--upstream") {
  for (const file of walk(path)) {
    const text = readFileSync(file, "utf8");
    // `code: "..."`, `code: '...'`, `` code: `...` ``, `code: ["...", "..."].join("\n")`, and bare strings in a list.
    const literal = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\$]|\\.|\$(?!\{))*`/g;
    for (const [list] of text.matchAll(/code:\s*\[[^\]]*\]\.join\("\\n"\)/g)) {
      emit({ filename: "file.js", code: (0, eval)(list.slice(5)), sourceType: "module" });
    }
    for (const [source] of text.matchAll(literal)) {
      let code;
      try {
        code = (0, eval)(source);
      } catch {
        continue;
      }
      for (const sourceType of ["module", "script"]) emit({ filename: "file.js", code, sourceType });
      emit({ filename: "file.ts", code, sourceType: "module" });
    }
  }
} else if (mode === "--files") {
  for (const file of walk(path)) {
    if (/\.[cm]?[jt]sx?$/.test(file)) emit({ filename: file.replace(/^.*\//, ""), code: readFileSync(file, "utf8"), sourceType: "module" });
  }
} else {
  for (const code of readFileSync(path, "utf8").split("\n")) {
    if (code && !code.startsWith("//#")) emit({ filename: /\bas\b|satisfies|!\.|<\w+>/.test(code) ? "file.ts" : "file.js", code, sourceType: "module" });
  }
}
