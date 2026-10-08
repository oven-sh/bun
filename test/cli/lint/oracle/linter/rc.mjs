// `.eslintrc.json` as @eslint/eslintrc reads it (`overrides`, `ignorePatterns`, `env`, how rules merge)
// against `Config::from_rc_json` with `RcFlavor::Eslint`.

import { execFileSync } from "node:child_process";
import { bunLint, random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { Legacy } = requireFromEslint("@eslint/eslintrc");
const environments = requireFromEslint("globals");
const implemented = JSON.parse(execFileSync(bunLint, ["linter", "rules"]).toString()).filter(id => !id.includes("/"));

const rng = random(8);
const basePath = "/root/project";
const dirs = ["src", "lib", "test", "dist", "node_modules", "packages", "a", "b", ".hidden", "build"];
const names = ["index.js", "a.js", "b.mjs", "c.cjs", "d.ts", "e.tsx", "f.test.js", ".eslintrc.js", "i.d.ts", "j.jsx"];
const path = () => [...Array.from({ length: rng.int(4) }, () => rng.pick(dirs)), rng.pick(names)].join("/");
const list = (make, max) => Array.from({ length: 1 + rng.int(max) }, make);
const glob = () => rng.pick(["*.js", "*.ts", "*.{js,ts}", "**/*.js", "src/**", "src/**/*.js", "src/*.js", "test/**/*.js", "*.test.js", "**/a/**", "./src/a.js", "lib/*", "packages/*/src/**", "*.d.ts", "index.js", "a/b/*.js"]);
const ignorePattern = () => rng.pick(["dist", "dist/", "/dist", "build/**", "*.test.js", "**/a/*.js", "!dist/a.js", "!src", "/src/a.js", "lib/*.js", ".hidden", "!.hidden", "packages/*/dist", "a", "!a/b", "*.d.ts", "!node_modules/", "/a/"]);
const severity = () => rng.pick([0, 1, 2, "off", "warn", "error"]);
const ruleValue = () => rng.pick([severity(), severity(), [severity()], [severity(), "always"], [severity(), "smart"], [severity(), { max: rng.int(4) }]]);
const rules = () => Object.fromEntries(list(() => [rng.pick(implemented), ruleValue()], 4));
const env = () => Object.fromEntries(list(() => [rng.pick(["browser", "node", "es6", "es2021", "mocha", "jest", "commonjs", "worker"]), rng.int(4) !== 0], 3));
const globals = () => Object.fromEntries(list(() => [rng.pick(["a", "b", "window", "process", "describe"]), rng.pick([true, false, "readonly", "writable", "off", "readable", "writeable"])], 3));
const part = () => ({
  ...(rng.int(2) ? { rules: rules() } : {}),
  ...(rng.int(3) === 0 ? { env: env() } : {}),
  ...(rng.int(3) === 0 ? { globals: globals() } : {}),
  ...(rng.int(4) === 0 ? { settings: { s: rng.pick([1, "x", { a: 1 }, { b: 2 }, [1]]) } } : {}),
  ...(rng.int(4) === 0 ? { parserOptions: { ...(rng.int(2) ? { sourceType: rng.pick(["module", "script"]) } : {}), ...(rng.int(2) ? { ecmaFeatures: { jsx: true } } : {}) } } : {}),
});

const setting = value => (value === "off" ? "off" : [true, "true", "writable", "writeable"].includes(value) ? "writable" : "readonly");
const number = value => ({ off: 0, warn: 1, error: 2 })[value] ?? value;

const cases = [], expected = [];
for (let i = 0; i < 3000; i++) {
  const config = {
    ...part(),
    ...(rng.int(3) === 0 ? { ignorePatterns: rng.int(5) === 0 ? ignorePattern() : list(ignorePattern, 4) } : {}),
    ...(rng.int(5) === 0 ? { noInlineConfig: rng.int(2) === 0 } : {}),
    ...(rng.int(5) === 0 ? { reportUnusedDisableDirectives: rng.int(2) === 0 } : {}),
    overrides: Array.from({ length: rng.int(4) }, () => ({
      files: rng.int(5) === 0 ? glob() : list(glob, 2),
      ...(rng.int(3) === 0 ? { excludedFiles: rng.int(3) === 0 ? glob() : list(glob, 2) } : {}),
      ...part(),
    })),
  };
  const files = list(() => `${basePath}/${path()}`, 10);
  const factory = new Legacy.ConfigArrayFactory({ cwd: basePath, builtInRules: new Map() });
  const array = factory.create(structuredClone(config), { filePath: `${basePath}/.eslintrc.json`, name: "test" });
  cases.push({ basePath, flavor: "eslintrc", config, files, directories: [] });
  expected.push(files.map(file => {
    const extracted = array.extractConfig(file);
    if (extracted.ignores(file)) return { status: "ignored" };
    // The globals of the environments, overridden by `globals`.
    const all = {};
    for (const [name, enabled] of Object.entries(extracted.env)) {
      if (enabled) Object.assign(all, environments[name === "es6" ? "es2015" : name]);
    }
    Object.assign(all, extracted.globals);
    return {
      status: "matched",
      rules: Object.entries(extracted.rules).map(([id, value]) => [id, [number(value[0]), ...value.slice(1)]]).sort(),
      globals: Object.entries(all).map(([name, value]) => [name, setting(value)]).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
      sourceType: extracted.parserOptions.sourceType ?? "module",
      parserOptions: Object.keys(extracted.parserOptions).length > 0 ? extracted.parserOptions : null,
      settings: Object.keys(extracted.settings).length > 0 ? extracted.settings : null,
      noInlineConfig: extracted.noInlineConfig ?? false,
      reportUnusedDisableDirectives: extracted.reportUnusedDisableDirectives ? 1 : 0,
    };
  }));
}
const actual = runBunLint("config", cases).map(it => it.files?.map(({ ecmaVersion, reportUnusedInlineConfigs, rules, ...rest }) =>
  (rules ? { ...rest, rules: rules.sort() } : rest)) ?? it);
// One case for each file, so that what differs can be read.
const flat = { cases: [], expected: [], actual: [] };
cases.forEach(({ files, config }, i) => files.forEach((file, j) => {
  flat.cases.push({ file, config });
  flat.expected.push(expected[i][j]);
  flat.actual.push(actual[i][j] ?? actual[i]);
}));
report("eslintrc", flat.cases, flat.expected, flat.actual, 5);
