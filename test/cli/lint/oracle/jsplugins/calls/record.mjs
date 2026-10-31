// Records expected.json.zst, which maps each file in cases.mjs to the message that the rules in log.cjs report under ESLint.
//
//   bun record.mjs --eslint=<directory of eslint 10.12.0> --parser=<directory of @typescript-eslint/parser 8.71.1>
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cases } from "./cases.mjs";

const option = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const require = createRequire(import.meta.url);
const log = require("./log.cjs");
const { Linter } = require(path.join(option("eslint"), "lib/api.js"));
const parser = require(path.join(option("parser"), "dist/index.js"));

const linter = new Linter();
const expected = {};
for (const [file, code] of Object.entries(cases)) {
  const languageOptions = file.endsWith(".ts")
    ? { parser }
    : { sourceType: file.slice(0, -3), parserOptions: { ecmaFeatures: { jsx: true } } };
  const rules = { "log/a": "error", "log/b": "error", "log/c": "error" };
  const messages = linter.verify(code, [{ files: ["**"], plugins: { log }, rules, languageOptions }], {
    filename: file,
  });
  if (messages.length !== 1 || messages[0].ruleId !== "log/a") throw new Error(`${file}: ${JSON.stringify(messages)}`);
  expected[file] = messages[0].message;
}
fs.writeFileSync(
  path.join(import.meta.dirname, "expected.json.zst"),
  Bun.zstdCompressSync(JSON.stringify(expected), { level: 19 }),
);
