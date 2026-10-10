// Which files are refused, and with which message: ESLint against `Linter::lint`, on the files of directories.
//
//   TYPESCRIPT_ESLINT_DIR=<built checkout> node parse-errors-files.mjs [--show <n>] [--json <file>] [--test262] <directory> ..
//
// Each file is parsed as ESLint parses it by default: `.ts`, `.mts`, `.cts` and `.tsx` by @typescript-eslint/parser, the others by
// espree, `.jsx` with `ecmaFeatures.jsx`. The JavaScript files are parsed once more by @typescript-eslint/parser.
// `--json`: writes the differences there.
// `--test262`: the files are tests of test262. What they say of themselves counts: a module or a script, strict or not.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, relative, resolve } from "node:path";
import { requireFromEslint, runBunLint } from "./shared.mjs";

const { Linter } = requireFromEslint("./lib/linter");
const requireTs = createRequire(
  join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin/package.json"),
);
const parser = requireTs("@typescript-eslint/parser");

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : undefined);
const show = Number(option("--show") ?? 10);
const json = option("--json");
const isTest262 = args.includes("--test262") && args.splice(args.indexOf("--test262"), 1).length > 0;

const TYPESCRIPT = new Set([".ts", ".mts", ".cts", ".tsx"]);
const JAVASCRIPT = new Set([".js", ".mjs", ".cjs", ".jsx"]);

function* filesOf(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") yield* filesOf(path);
    } else if (entry.isFile() && (TYPESCRIPT.has(extname(path)) || JAVASCRIPT.has(extname(path)))) yield path;
  }
}

const cases = [];
for (const root of args.map(it => resolve(it))) {
  for (const path of filesOf(root)) {
    const code = readFileSync(path, "utf8");
    // Both get the text as a string: a file that is not UTF-8 would differ before it is parsed.
    if (code.includes("�") || code.length > 2_000_000) continue;
    const filename = relative(root, path);
    const isTypescript = TYPESCRIPT.has(extname(path));
    const languageOptions = extname(path) === ".jsx" ? { parserOptions: { ecmaFeatures: { jsx: true } } } : {};
    if (isTest262) {
      const flags = /^flags:\s*\[(.*)\]/m.exec(code)?.[1] ?? "";
      languageOptions.sourceType = flags.includes("module") ? "module" : "script";
      if (flags.includes("onlyStrict")) languageOptions.parserOptions = { ecmaFeatures: { impliedStrict: true } };
    }
    cases.push({ path, code, filename, typescript: isTypescript, languageOptions });
    if (!isTypescript) cases.push({ path, code, filename, typescript: true, languageOptions });
  }
}

const brief = messages =>
  messages.filter(it => it.fatal).map(({ message, line, column }) => ({ message, line, column }));
const linter = new Linter({ configType: "flat" });
const differences = [];
const byMessage = new Map();
let refused = 0;
for (let start = 0; start < cases.length; start += 1000) {
  const batch = cases.slice(start, start + 1000);
  const actual = runBunLint(
    "verify",
    batch.map(({ code, filename, typescript, languageOptions }) => ({
      code,
      filename,
      config: { rules: {}, languageOptions: { ...languageOptions, ...(typescript ? { parser: "typescript" } : {}) } },
      options: {},
    })),
  );
  batch.forEach((it, i) => {
    const languageOptions = { ...it.languageOptions, ...(it.typescript ? { parser } : {}) };
    const expected = brief(linter.verify(it.code, { files: ["**"], languageOptions }, it.filename));
    const ours = brief(actual[i].messages);
    if (expected.length > 0) refused++;
    if (JSON.stringify(expected) === JSON.stringify(ours)) return;
    differences.push({ path: it.path, parser: it.typescript ? "typescript" : "espree", expected, ours });
    const key = `${it.typescript ? "typescript" : "espree"}: ${expected[0]?.message ?? "(accepted)"} / ${ours[0]?.message ?? "(accepted)"}`;
    byMessage.set(key, (byMessage.get(key) ?? 0) + 1);
  });
}
for (const [key, count] of [...byMessage].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(6), key);
for (const it of differences.slice(0, show)) {
  console.log(
    `──── ${it.path} (${it.parser})\nexpected: ${JSON.stringify(it.expected)}\nactual:   ${JSON.stringify(it.ours)}`,
  );
}
if (json) writeFileSync(json, JSON.stringify(differences, null, 1));
console.log(
  `parse errors of files: ESLint refuses ${refused}; ${cases.length - differences.length} of ${cases.length} agree`,
);
if (differences.length > 0) process.exitCode = 1;
