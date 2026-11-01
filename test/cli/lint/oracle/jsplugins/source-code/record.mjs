// Records expected.json: for each of `texts` in plugin.cjs the message of its rule under ESLint.
//
//   bun record.mjs --eslint=<directory of eslint 10.12.0> --parser=<directory of @typescript-eslint/parser 8.71.1>
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const option = name => process.argv.find(it => it.startsWith(`--${name}=`)).slice(name.length + 3);
const { Linter } = require(path.join(option("eslint"), "lib/api.js"));
const parser = require(path.join(option("parser"), "dist/index.js"));
const demo = require("./plugin.cjs");

const config = [
  { files: ["**"], plugins: { demo }, rules: { "demo/all": "error" } },
  { files: ["**/*.ts"], languageOptions: { parser } },
];
const expected = {};
for (const [filename, text] of Object.entries(demo.texts)) {
  const messages = new Linter().verify(text, config, { filename });
  expected[filename] = JSON.parse(messages.find(it => it.ruleId === "demo/all").message);
}
fs.writeFileSync(path.join(import.meta.dirname, "expected.json"), `${JSON.stringify(expected)}\n`);
