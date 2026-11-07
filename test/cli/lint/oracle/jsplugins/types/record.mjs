// Records expected.txt: what the rule in ask.cjs reports under ESLint for each node of the files in cases.mjs.
//
//   bun record.mjs --eslint=<directory of eslint 10.12.0> --parser=<directory of @typescript-eslint/parser 8.72.0>
//
// The parser has to find typescript 5.9.3.
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { cases, linted } from "./cases.mjs";

const option = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const require = createRequire(import.meta.url);
const { ESLint } = require(path.join(option("eslint"), "lib/api.js"));
const parser = require(path.join(option("parser"), "dist/index.js"));

const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "types-")));
for (const [file, text] of Object.entries(cases)) fs.writeFileSync(path.join(cwd, file), text);
const eslint = new ESLint({
  cwd,
  overrideConfigFile: true,
  overrideConfig: {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { ask: require("./ask.cjs") },
    languageOptions: { parser, parserOptions: { projectService: true } },
    rules: { "ask/all": "error" },
  },
});
const lines = [];
for (const { filePath, messages } of await eslint.lintFiles(linted)) {
  for (const { ruleId, line, column, endLine, endColumn, message } of messages) {
    if (ruleId !== "ask/all") throw new Error(`${filePath}: ${message}`);
    lines.push(`${path.basename(filePath)} ${line}:${column}-${endLine}:${endColumn} ${message}\n`);
  }
}
fs.writeFileSync(path.join(import.meta.dirname, "expected.txt"), lines.join(""));
fs.rmSync(cwd, { recursive: true });
