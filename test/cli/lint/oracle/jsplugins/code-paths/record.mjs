// Records expected.json.zst, which maps each case in cases.mjs to the message that the `trace/all` rule in trace.cjs reports.
//
//   bun record.mjs --eslint=<directory of the eslint 10.12.0 package> --bun=<bun> --scratch=<empty directory>
//
// ESLint itself lints the JavaScript cases. ESLint needs typescript-eslint's parser for TypeScript, so for those cases
// `bun lint` provides the tree and the `trace/with-eslint-analyzer` rule runs ESLint's own analyzer over it.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cases, isTypeScript } from "./cases.mjs";

const here = import.meta.dirname;
const option = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const [eslint, bun, scratch] = ["eslint", "bun", "scratch"].map(option);
const require = createRequire(import.meta.url);
const trace = require("./trace.cjs");

const expected = {};
const { Linter } = require(path.join(eslint, "lib/api.js"));
const linter = new Linter();
for (const it of cases.filter(it => !isTypeScript(it))) {
  const languageOptions = { sourceType: it.sourceType ?? "module", parserOptions: { ecmaFeatures: { jsx: true } } };
  const messages = linter.verify(it.code, [{ plugins: { trace }, rules: { "trace/all": "error" }, languageOptions }]);
  if (messages.length !== 1 || messages[0].ruleId !== "trace/all")
    throw new Error(`${it.name}: ${JSON.stringify(messages)}`);
  expected[it.name] = messages[0].message;
}

fs.copyFileSync(path.join(here, "trace.cjs"), path.join(scratch, "trace.cjs"));
const rules = { "trace/with-eslint-analyzer": ["error", eslint] };
fs.writeFileSync(
  path.join(scratch, ".oxlintrc.json"),
  JSON.stringify({
    categories: { correctness: "off" },
    ignorePatterns: ["trace.cjs"],
    jsPlugins: ["./trace.cjs"],
    rules,
  }),
);
for (const it of cases.filter(isTypeScript)) fs.writeFileSync(path.join(scratch, it.name), it.code);
const { stdout } = spawnSync(bun, ["lint", "-f", "json"], { cwd: scratch, encoding: "utf8", maxBuffer: 1 << 30 });
for (const it of JSON.parse(stdout).diagnostics) expected[it.filename] = it.message;
for (const it of cases) if (expected[it.name] === undefined) throw new Error(`Nothing was recorded for ${it.name}`);

fs.writeFileSync(path.join(here, "expected.json.zst"), Bun.zstdCompressSync(JSON.stringify(expected), { level: 19 }));
