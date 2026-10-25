// Records expected.json.zst, which maps each case in cases.mjs to the message that the `trace/all` rule in trace.cjs reports
// under ESLint. TypeScript cases are parsed by typescript-eslint's parser.
//
//   bun record.mjs --eslint=<directory of eslint 10.12.0> --parser=<directory of @typescript-eslint/parser 8.71.1>
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cases, fileOf, isTypeScript } from "./cases.mjs";

const option = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const require = createRequire(import.meta.url);
const trace = require("./trace.cjs");
const { Linter } = require(path.join(option("eslint"), "lib/api.js"));
const parser = require(path.join(option("parser"), "dist/index.js"));

const linter = new Linter();
const expected = {};
for (const it of cases) {
  const languageOptions = isTypeScript(it)
    ? { parser }
    : { sourceType: it.sourceType ?? "module", parserOptions: { ecmaFeatures: { jsx: true } } };
  const config = { files: ["**"], plugins: { trace }, rules: { "trace/all": "error" }, languageOptions };
  const messages = linter.verify(it.code, [config], { filename: fileOf(it) });
  if (messages.length !== 1 || messages[0].ruleId !== "trace/all")
    throw new Error(`${it.name}: ${JSON.stringify(messages)}`);
  expected[it.name] = messages[0].message;
}
fs.writeFileSync(
  path.join(import.meta.dirname, "expected.json.zst"),
  Bun.zstdCompressSync(JSON.stringify(expected), { level: 19 }),
);
