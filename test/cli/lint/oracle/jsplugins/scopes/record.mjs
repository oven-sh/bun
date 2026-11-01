// Records expected.json.zst, which maps the file of each case in cases.mjs to the message that its rule in dump.cjs reports under
// ESLint. TypeScript cases are parsed by typescript-eslint's parser, which brings its scope manager.
//
//   bun record.mjs --eslint=<directory of eslint 10.12.0> --parser=<directory of @typescript-eslint/parser 8.71.1>
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cases, fileOf, globals, isTypeScript } from "./cases.mjs";

const option = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const require = createRequire(import.meta.url);
const scopes = require("./dump.cjs");
const { Linter } = require(path.join(option("eslint"), "lib/api.js"));
const parser = require(path.join(option("parser"), "dist/index.js"));

const linter = new Linter();
const expected = {};
for (const it of cases) {
  const languageOptions = isTypeScript(it)
    ? { parser, globals }
    : { sourceType: it.sourceType ?? "module", parserOptions: { ecmaFeatures: { jsx: true } }, globals };
  const rule = it.referencesFirst ? "scopes/references-first" : "scopes/all";
  const config = { files: ["**"], plugins: { scopes }, rules: { [rule]: "error" }, languageOptions };
  const messages = linter.verify(it.code, [config], { filename: fileOf(it) });
  if (messages.length !== 1 || messages[0].ruleId !== rule)
    throw new Error(`${fileOf(it)}: ${JSON.stringify(messages)}`);
  expected[fileOf(it)] = messages[0].message;
}
fs.writeFileSync(
  path.join(import.meta.dirname, "expected.json.zst"),
  Bun.zstdCompressSync(JSON.stringify(expected), { level: 19 }),
);
