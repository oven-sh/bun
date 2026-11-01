// Records expected.json.zst: for each file in cases.mjs the message that a rule in dump.cjs reports.
// `eslint`: `dump/tree` under ESLint. `oxlint`: `dump/shapes` under oxlint, for TypeScript.
//
//   bun record.mjs --eslint=<directory of eslint 10.12.0> --parser=<directory of @typescript-eslint/parser 8.71.1> --oxlint=<bin/oxlint of oxlint 1.87.0>
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { cases } from "./cases.mjs";

const option = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const require = createRequire(import.meta.url);
const dump = require("./dump.cjs");
const { Linter } = require(path.join(option("eslint"), "lib/api.js"));
const parser = require(path.join(option("parser"), "dist/index.js"));

const linter = new Linter();
const expected = { eslint: {}, oxlint: {} };
for (const [file, code] of Object.entries(cases)) {
  const languageOptions = file.endsWith(".js")
    ? { sourceType: file.split(/[-.]/)[0], parserOptions: { ecmaFeatures: { jsx: true } } }
    : { parser };
  const config = [{ files: ["**"], plugins: { dump }, rules: { "dump/tree": "error" }, languageOptions }];
  const messages = linter.verify(code, config, { filename: file });
  if (messages.length !== 1 || messages[0].ruleId !== "dump/tree")
    throw new Error(`${file}: ${JSON.stringify(messages)}`);
  expected.eslint[file] = messages[0].message;
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trees-"));
const typescript = Object.keys(cases).filter(file => !file.endsWith(".js"));
for (const file of typescript) fs.writeFileSync(path.join(directory, file), cases[file]);
fs.copyFileSync(path.join(import.meta.dirname, "dump.cjs"), path.join(directory, "dump.cjs"));
fs.writeFileSync(
  path.join(directory, ".oxlintrc.json"),
  JSON.stringify({ ignorePatterns: ["dump.cjs"], jsPlugins: ["./dump.cjs"], rules: { "dump/shapes": "error" } }),
);
const { stdout } = Bun.spawnSync([option("oxlint"), "-A", "all", "-D", "dump/shapes", "-f", "json"], {
  cwd: directory,
});
const { diagnostics } = JSON.parse(stdout.toString());
for (const file of typescript) {
  const found = diagnostics.filter(diagnostic => diagnostic.filename === file);
  if (found.length !== 1 || found[0].code !== "dump(shapes)") throw new Error(`${file}: ${JSON.stringify(found)}`);
  expected.oxlint[file] = found[0].message;
}
fs.rmSync(directory, { recursive: true });
fs.writeFileSync(
  path.join(import.meta.dirname, "expected.json.zst"),
  Bun.zstdCompressSync(JSON.stringify(expected), { level: 19 }),
);
