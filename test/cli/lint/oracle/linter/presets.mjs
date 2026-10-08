// The configurations that @eslint/js and typescript-eslint publish against the copies that `extends` finds by
// name (`src/lint/linter/config/presets.rs`).
//
//   TYPESCRIPT_ESLINT_DIR=<built checkout> node presets.mjs

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { bunLint, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { FlatConfigArray } = requireFromEslint("./lib/config/flat-config-array");
const { ConfigArraySymbol } = requireFromEslint("@eslint/config-array");
const pluginDir = join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin");
const requireTs = createRequire(join(pluginDir, "package.json"));
const implemented = new Set(JSON.parse(execFileSync(bunLint, ["linter", "rules"]).toString()));

class Merging extends FlatConfigArray {
  [ConfigArraySymbol.finalizeConfig](config) {
    return config;
  }
}

const js = requireFromEslint("./packages/js");
const plugin = requireTs("./dist/index.js"), parser = requireTs("@typescript-eslint/parser");
const camelCase = name => name.replace(/-(.)/g, (_, letter) => letter.toUpperCase());
const presets = [
  [["eslint:recommended", "js/recommended", "@eslint/js/recommended"], [js.configs.recommended]],
  [["eslint:all", "js/all"], [js.configs.all]],
];
for (const file of readdirSync(join(pluginDir, "dist/configs/flat")).filter(file => file.endsWith(".js"))) {
  const name = file.slice(0, -3);
  presets.push([
    [`typescript-eslint/${name}`, `@typescript-eslint/${name}`, `plugin:@typescript-eslint/${name}`, `tseslint/${camelCase(name)}`],
    [requireTs(`./dist/configs/flat/${file}`).default(plugin, parser)].flat(),
  ]);
}

const basePath = "/project", files = ["/project/a.js", "/project/a.ts", "/project/b.tsx", "/project/c.mts", "/project/d.cjs"];
const everything = { files: ["**/*.{js,cjs,ts,tsx,mts}"] };
const cases = [], expected = [];
for (const [names, objects] of presets) {
  const configs = new Merging([everything, ...objects], { basePath });
  configs.normalizeSync();
  const answers = files.map(file => configs.getConfig(file));
  const enabled = new Set(answers.flatMap(it => Object.entries(it.rules ?? {}).filter(([, value]) => value[0] !== 0).map(([id]) => id)));
  for (const name of names) {
    cases.push({ basePath, flavor: "flat", config: [everything, { extends: [name] }], files, directories: [] });
    expected.push({
      files: answers.map(it => ({
        rules: Object.entries(it.rules ?? {}).filter(([id]) => implemented.has(id)),
        sourceType: it.languageOptions?.sourceType ?? "module",
        parserOptions: it.languageOptions?.parserOptions ?? null,
      })),
      unknownRules: [...enabled].filter(id => !implemented.has(id)).sort(),
    });
  }
}
const actual = runBunLint("config", cases).map(it => (it.error ? it : {
  files: it.files.map(({ rules, sourceType, parserOptions }) => ({ rules, sourceType, parserOptions })),
  unknownRules: it.unknownRules.sort(),
}));
report("presets", cases.map(it => it.config[1].extends[0]), expected, actual, 5);
