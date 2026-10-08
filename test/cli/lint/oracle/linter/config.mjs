// `FlatConfigArray` of ESLint (@eslint/config-array, `defineConfig`, the merging of `flat-config-schema.js`)
// against `linter::Config`: which files are ignored, which objects match, what they merge to.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { bunLint, random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { FlatConfigArray } = requireFromEslint("./lib/config/flat-config-array");
const { ConfigArraySymbol } = requireFromEslint("@eslint/config-array");
const { defineConfig } = requireFromEslint("@eslint/config-helpers");
const implemented = JSON.parse(execFileSync(bunLint, ["linter", "rules"]).toString()).filter(id => !id.includes("/"));

/** Merges, and leaves out what the constructor of `Config` does: it would want every rule to exist. */
class Merging extends FlatConfigArray {
  [ConfigArraySymbol.finalizeConfig](config) {
    return config;
  }
}

const rng = random(6);
const dirs = ["src", "lib", "test", "dist", "node_modules", ".git", "packages", "a", "b", ".hidden", "build"];
const files = ["index.js", "a.js", "b.mjs", "c.cjs", "d.ts", "e.tsx", "f.test.js", "g.json", ".eslintrc.js", "h", "i.d.ts", "j.jsx"];
const path = () => [...Array.from({ length: rng.int(4) }, () => rng.pick(dirs)), rng.pick(files)].join("/");
const glob = () => rng.pick([
  "**/*.js", "**/*.ts", "**/*.{js,ts}", "*.js", "**/*.test.js", "src/**", "src/**/*.js", "lib/", "dist/", "dist/**", "**/dist/", "test/**/*.js", "**", "*", "**/*", "src/*", "a/b/**",
  "packages/*/src/**", "./src/**/*.js", "**/.hidden/**", "**/*.d.ts", "**/index.js", "build", "**/build/**", "a/", "**/a/", "src/a.js", "**/*.cjs", "**/*.[jt]s", "**/!(*.test).js",
]);
const ignore = () => rng.pick([glob(), glob(), `!${glob()}`, "!./src/**", "node_modules/", "!**/node_modules/", "!.git/"]);
const list = (make, max) => Array.from({ length: 1 + rng.int(max) }, make);
const severity = () => rng.pick([0, 1, 2, "off", "warn", "error"]);
const ruleValue = () => rng.pick([severity(), severity(), [severity()], [severity(), "always"], [severity(), "smart"], [severity(), { max: rng.int(4) }], [severity(), "always", { null: "ignore" }]]);
const rules = () => Object.fromEntries(list(() => [rng.pick(implemented), ruleValue()], 4));
const value = depth => rng.pick([1, "x", true, null, [1, 2], ["y"], ...(depth < 2 ? [{ a: value(depth + 1) }, { b: value(depth + 1), c: value(depth + 1) }] : [])]);
const languageOptions = () => {
  const out = {};
  if (rng.int(3) === 0) out.ecmaVersion = rng.pick([3, 5, 6, 2015, 2020, 2026, "latest", 13]);
  if (rng.int(3) === 0) out.sourceType = rng.pick(["module", "script", "commonjs"]);
  if (rng.int(2) === 0) out.globals = Object.fromEntries(list(() => [rng.pick(["a", "b", "c", "window"]), rng.pick([true, false, "readonly", "writable", "off", null, "readable"])], 3));
  if (rng.int(2) === 0) out.parserOptions = { ...(rng.int(2) ? { ecmaFeatures: { jsx: rng.int(2) === 0, ...(rng.int(2) ? { globalReturn: true } : {}) } } : {}), ...(rng.int(2) ? { x: value(0) } : {}) };
  return out;
};
const object = canExtend => {
  const out = {};
  if (rng.int(6) === 0) out.name = rng.pick(["one", "two"]);
  if (rng.int(10) === 0) out.basePath = rng.pick(["src", "packages/a", "/root/project/lib", "."]);
  if (rng.int(2) === 0) out.files = list(() => (rng.int(6) === 0 ? list(glob, 2) : glob()), 3);
  if (rng.int(3) === 0) out.ignores = list(ignore, 3);
  if (rng.int(5) !== 0 || Object.keys(out).length === 0) {
    if (rng.int(2) === 0) out.rules = rules();
    if (rng.int(3) === 0) out.languageOptions = languageOptions();
    if (rng.int(4) === 0) out.settings = { s: value(0), ...(rng.int(2) ? { t: value(0) } : {}) };
    if (rng.int(4) === 0) out.linterOptions = Object.fromEntries(list(() => rng.pick([
      ["noInlineConfig", rng.int(2) === 0], ["reportUnusedDisableDirectives", rng.pick([true, false, 0, 1, 2, "off", "warn", "error"])],
      ["reportUnusedInlineConfigs", severity()]]), 2));
  }
  if (canExtend && rng.int(6) === 0) {
    out.extends = list(() => { const { basePath, ...it } = object(false); return rng.int(5) === 0 ? [it, (({ basePath, ...it }) => it)(object(false))] : it; }, 2);
  }
  return out;
};

const basePath = "/root/project";
const setting = value => (value === "off" ? "off" : [true, "true", "writable", "writeable"].includes(value) ? "writable" : "readonly");
const number = value => ({ off: 0, warn: 1, error: 2 })[value] ?? value;
const ecmaVersion = value => (value === undefined || value === "latest" ? 2026 : value === 3 || value === 5 || value >= 2015 ? value : value + 2009);

function describe(config) {
  const { languageOptions = {}, linterOptions = {}, rules = {}, settings } = config;
  const unused = linterOptions.reportUnusedDisableDirectives;
  return {
    rules: Object.entries(rules),
    ecmaVersion: ecmaVersion(languageOptions.ecmaVersion),
    sourceType: languageOptions.sourceType ?? "module",
    globals: Object.entries(languageOptions.globals ?? {}).map(([name, value]) => [name, setting(value)]).sort(),
    parserOptions: languageOptions.parserOptions ?? null,
    settings: settings ?? null,
    noInlineConfig: linterOptions.noInlineConfig ?? false,
    reportUnusedDisableDirectives: unused === undefined ? 0 : number(unused),
    reportUnusedInlineConfigs: number(linterOptions.reportUnusedInlineConfigs ?? 0),
  };
}

const cases = [], expected = [];
let invalid = 0;
for (let i = 0; i < 3000; i++) {
  const config = list(() => object(true), 6);
  const it = {
    basePath,
    config,
    files: list(() => rng.pick([`${basePath}/`, `${basePath}/`, `${basePath}/`, "/root/other/", `${basePath}/../project/`]) + path(), 12),
    directories: list(() => `${basePath}/${list(() => rng.pick(dirs), 3).join("/")}`, 4),
  };
  try {
    const configs = new Merging(defineConfig(structuredClone(config)), { basePath });
    configs.normalizeSync();
    expected.push({
      files: it.files.map(file => {
        const { status, config } = configs.getConfigWithStatus(file);
        return config ? { status, ...describe(config) } : { status };
      }),
      directories: it.directories.map(directory => configs.isDirectoryIgnored(directory)),
    });
    cases.push(it);
  } catch (error) {
    invalid++;
  }
}
if (invalid > 0) console.log(`config: ${invalid} cases left out, ESLint throws`);
report("config", cases, expected, runBunLint("config", cases), 6);
