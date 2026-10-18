// Records expected.json.zst: for each case in cases.mjs the message that the `tokens/all` rule in dump.cjs reports.
// `eslint`: under ESLint. TypeScript cases are parsed by typescript-eslint's parser.
// `oxlint`: under oxlint, which has its own classes for tokens and comments. Only the sections about those are kept.
//
//   bun record.mjs --eslint=<directory of eslint 10.12.0> --parser=<directory of @typescript-eslint/parser 8.71.1> --oxlint=<bin/oxlint of oxlint 1.87.0>
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { cases, fileOf, isTypeScript } from "./cases.mjs";

const option = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const require = createRequire(import.meta.url);
const tokens = require("./dump.cjs");
const { Linter } = require(path.join(option("eslint"), "lib/api.js"));
const parser = require(path.join(option("parser"), "dist/index.js"));

const linter = new Linter();
const expected = { eslint: {}, oxlint: {} };
for (const it of cases) {
  const languageOptions = isTypeScript(it)
    ? { parser }
    : { sourceType: it.sourceType ?? "module", parserOptions: { ecmaFeatures: { jsx: true } } };
  const config = { files: ["**"], plugins: { tokens }, rules: { "tokens/all": "error" }, languageOptions };
  const messages = linter.verify(it.code, [config], { filename: fileOf(it) });
  if (messages.length !== 1 || messages[0].ruleId !== "tokens/all")
    throw new Error(`${it.name}: ${JSON.stringify(messages)}`);
  expected.eslint[it.name] = messages[0].message;
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tokens-"));
for (const it of cases) {
  fs.mkdirSync(path.dirname(path.join(directory, fileOf(it))), { recursive: true });
  fs.writeFileSync(path.join(directory, fileOf(it)), it.code);
}
fs.copyFileSync(path.join(import.meta.dirname, "dump.cjs"), path.join(directory, "dump.cjs"));
fs.writeFileSync(
  path.join(directory, ".oxlintrc.json"),
  JSON.stringify({ ignorePatterns: ["dump.cjs"], jsPlugins: ["./dump.cjs"], rules: { "tokens/all": "error" } }),
);
const { stdout } = Bun.spawnSync([option("oxlint"), "-A", "all", "-D", "tokens/all", "-f", "json"], { cwd: directory });
const { diagnostics } = JSON.parse(stdout.toString());
for (const it of cases) {
  const found = diagnostics.filter(diagnostic => diagnostic.filename === fileOf(it));
  if (found.length !== 1) throw new Error(`${it.name}: ${JSON.stringify(found)}`);
  expected.oxlint[it.name] = found[0].message
    .split("\n")
    .filter(line => /^L:(?:program|shape|parts|lists) /.test(line))
    .join("\n");
}
fs.rmSync(directory, { recursive: true });

fs.writeFileSync(
  path.join(import.meta.dirname, "expected.json.zst"),
  Bun.zstdCompressSync(JSON.stringify(expected), { level: 19 }),
);
