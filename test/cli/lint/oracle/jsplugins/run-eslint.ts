// What real ESLint reports for each case with the rules of a plugin, in the format of `bun-lint js_plugin batch`.
//
//   ESLINT_DIR=<eslint checkout> TYPESCRIPT_ESLINT_DIR=<typescript-eslint checkout, built> \
//     bun run-eslint.ts --plugin=<file> [--rules=<{ "rule": [options] }>] cases.jsonl > expected.jsonl

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
const module = await import(resolve(flag("plugin")!));
const plugin = module.default ?? module;
const name = flag("alias") ?? plugin.meta.name.replace(/^eslint-plugin-/, "");
const forAll = flag("rules") ? JSON.parse(flag("rules")!) : Object.fromEntries(Object.keys(plugin.rules).map(it => [it, []]));
const casesPath = process.argv.slice(2).find(it => !it.startsWith("--"))!;
const linter = new Linter({ configType: "flat", cwd: process.cwd() });

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
    result = fatal ? { failure: fatal.message } : { messages: messages.map(({ severity, nodeType, ...message }: any) => message) };
  } catch (error) {
    result = { failure: String((error as Error).message).split("\n")[0] };
  }
  console.log(JSON.stringify({ id: it.id, ...result }));
}
