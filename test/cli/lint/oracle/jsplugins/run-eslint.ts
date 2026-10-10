// What real ESLint reports for each case with the rules of a plugin, in the format of `bun-lint js_plugin batch`.
//
//   ESLINT_DIR=<eslint checkout> TYPESCRIPT_ESLINT_DIR=<typescript-eslint checkout, built> \
//     bun run-eslint.ts --plugin=<file or package> [--alias=<prefix>] [--rules=<{ "rule": [options] }>] cases.jsonl > expected.jsonl
//
// With `--list-rules` instead of cases: prints the rules of the plugin that run without types, as a value for `--rules`.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const eslintDir = process.env.ESLINT_DIR;
const typescriptEslintDir = process.env.TYPESCRIPT_ESLINT_DIR;
if (!eslintDir || !typescriptEslintDir) throw new Error("set ESLINT_DIR and TYPESCRIPT_ESLINT_DIR");
const fromEslint = createRequire(join(eslintDir, "package.json"));
const { Linter } = fromEslint(eslintDir);
const typescriptParser = fromEslint(join(typescriptEslintDir, "packages/parser/dist/index.js"));

const flag = (name: string) => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const specifier = flag("plugin")!;
const module = await import(
  /^[./]/.test(specifier) ? resolve(specifier) : createRequire(join(process.cwd(), "noop.js")).resolve(specifier),
);
const plugin = module.default ?? module;
const name = flag("alias") ?? plugin.meta.name.replace(/^eslint-plugin-/, "");
const forAll = flag("rules") ? JSON.parse(flag("rules")!) : Object.fromEntries(Object.keys(plugin.rules).map(it => [it, []]));
const casesPath = process.argv.slice(2).find(it => !it.startsWith("--"))!;
const linter = new Linter({ configType: "flat", cwd: process.cwd() });

if (process.argv.includes("--list-rules")) {
  const runs = (rule: string) => {
    try {
      for (const [filename, parser] of [["a.js", undefined], ["a.ts", typescriptParser]] as const) {
        const config = { files: ["**"], plugins: { [name]: plugin }, languageOptions: parser ? { parser } : {}, rules: { [`${name}/${rule}`]: "error" } };
        const code = "import a from 'a'; export function f(b) { return a(b?.c, `d${b}`, /e/u, class {}); }";
        if (linter.verify(code, [config], { filename: join(process.cwd(), filename) }).some((it: any) => it.fatal)) return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  console.log(JSON.stringify(Object.fromEntries(Object.keys(plugin.rules).filter(runs).map(it => [it, []]))));
  process.exit(0);
}

for (const line of readFileSync(casesPath, "utf8").split("\n")) {
  if (!line) continue;
  const it = JSON.parse(line);
  const { parser, ...language } = it.languageOptions ?? {};
  for (const key of Object.keys(language)) if (language[key] === null) delete language[key];
  if (parser === "typescript") language.parser = typescriptParser;
  const rules = Object.entries(it.rules ?? forAll).map(([rule, options]) => [`${name}/${rule}`, ["error", ...(options as unknown[])]]);
  let result: object;
  try {
    const messages = linter.verify(
      it.code,
      [{ files: ["**"], plugins: { [name]: plugin }, languageOptions: language, settings: it.settings ?? {}, rules: Object.fromEntries(rules), linterOptions: { reportUnusedDisableDirectives: "off" } }],
      { filename: join(process.cwd(), it.filename ?? "file.js"), allowInlineConfig: it.allowInlineConfig ?? true },
    );
    const fatal = messages.find((message: any) => message.fatal);
    // The `data` of a suggestion is text on the other side, and one without entries is none.
    const suggestion = ({ data, ...rest }: any) =>
      data && Object.keys(data).length > 0
        ? { ...rest, data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])) }
        : rest;
    const cleaned = ({ severity, nodeType, suggestions, ...message }: any) =>
      suggestions ? { ...message, suggestions: suggestions.map(suggestion) } : message;
    result = fatal ? { failure: fatal.message } : { messages: messages.map(cleaned) };
  } catch (error) {
    result = { failure: String((error as Error).message).split("\n")[0] };
  }
  console.log(JSON.stringify({ id: it.id, ...result }));
}
