// A real `eslint.config.js`, that of ESLint itself, through `serialize-eslint-config.mjs` and
// `Config::from_flat_json`, against ESLint: for every file of the repository, whether it is linted, and
// with which settings of the rules that are implemented.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { serializeConfig } from "../../../../../src/lint/linter/config/serialize-eslint-config.mjs";
import { bunLint, eslintDir, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { FlatConfigArray } = requireFromEslint("./lib/config/flat-config-array");
const { ConfigArraySymbol } = requireFromEslint("@eslint/config-array");
const implemented = new Set(JSON.parse(execFileSync(bunLint, ["linter", "rules"]).toString()));

class Merging extends FlatConfigArray {
  [ConfigArraySymbol.finalizeConfig](config) {
    return config;
  }
}

const config = requireFromEslint("./eslint.config.js");
const files = [], directories = [];
(function walk(directory, depth) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (!entry.isDirectory()) files.push(path);
    else if (depth < 6 && !(entry.name === "node_modules" && depth > 0)) {
      directories.push(path);
      if (entry.name !== "node_modules" && entry.name !== ".git") walk(path, depth + 1);
    }
  }
})(eslintDir, 0);

const configs = new Merging(config, { basePath: eslintDir });
configs.normalizeSync();
const expected = files.map(file => {
  const { status, config } = configs.getConfigWithStatus(file);
  if (!config) return { status };
  return {
    status,
    rules: Object.entries(config.rules ?? {}).filter(([id]) => implemented.has(id)),
    sourceType: config.languageOptions?.sourceType ?? "module",
    language: config.language,
    processor: typeof config.processor === "string" ? config.processor : config.processor?.meta?.name ?? null,
  };
});
const [answer] = runBunLint("config", [{ basePath: eslintDir, config: serializeConfig(config), files, directories }]);
const actual = answer.files.map(({ status, rules, sourceType, language, processor }) => (rules ? { status, rules, sourceType, language, processor } : { status }));
report("files", files, expected, actual, 10);
report("directories", directories, directories.map(it => configs.isDirectoryIgnored(it)), answer.directories, 10);
