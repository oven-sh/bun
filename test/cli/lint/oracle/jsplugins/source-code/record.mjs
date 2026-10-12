// Records expected.json: for each of `texts` in plugin.cjs the message of its rule under ESLint.
//
//   bun record.mjs --eslint=<directory of eslint 10.12.0>
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const directory = process.argv.find(it => it.startsWith("--eslint=")).slice("--eslint=".length);
const { Linter } = require(path.join(directory, "lib/api.js"));
const demo = require("./plugin.cjs");

const config = [{ files: ["**"], plugins: { demo }, rules: { "demo/all": "error" } }];
const expected = {};
for (const [filename, text] of Object.entries(demo.texts)) {
  const messages = new Linter().verify(text, config, { filename });
  expected[filename] = JSON.parse(messages.find(it => it.ruleId === "demo/all").message);
}
fs.writeFileSync(path.join(import.meta.dirname, "expected.json"), `${JSON.stringify(expected)}\n`);
