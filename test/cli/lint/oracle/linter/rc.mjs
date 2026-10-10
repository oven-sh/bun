// `.eslintrc.json` as ESLint 8 reads it against `Config::from_legacy`: `ConfigArrayFactory` and `extractConfig` of @eslint/eslintrc
// (`overrides`, `ignorePatterns`, `env`, how rules merge), `ConfigValidator` with the rules of ESLint 8, and what `Linter` makes of
// `env` and `parserOptions` before it parses. `ESLINT8_DIR`: the package eslint 8.57.1, installed.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bunLint, random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const requireFromEslint8 = createRequire(join(resolve(process.env.ESLINT8_DIR ?? "eslint8"), "package.json"));
const { Legacy } = requireFromEslint8("@eslint/eslintrc");
const builtInRules = requireFromEslint8("./lib/rules");
// A DIFFERENCE THAT IS KNOWN, AND COUNTED: the names that `env` defines. ESLint 8.57.1 has those of the package globals 13.24
// (`Legacy.environments`). `bun lint` has one table for each environment, that of today.
const today = requireFromEslint("globals");
// `Linter` turns this one on for every file: the names of ES5. They are not among the `globals` of `bun lint`.
const builtin = Legacy.environments.get("builtin").globals;
const withoutBuiltin = globals => globals.filter(([name, value]) => !(name in builtin && value === "readonly"));
// NOT JUDGED HERE: six rules whose default options have changed since ESLint 8. `bun lint` has the rules of today, and makes them
// do what those of ESLint 8 do by a setting `off` for each that carries the old default options, which a setting that is only a
// severity keeps: so its `rules` have six entries, and options, that `extractConfig` does not have. What they REPORT is judged with
// the real ESLint 8.57.1: driver/eslintrc-cli.mjs, the rows "presets: the default options of 8 ..".
const changed = ["no-constant-condition", "no-implicit-coercion", "no-inner-declarations", "no-shadow-restricted-names", "no-unused-vars", "no-useless-computed-key"];
const implemented = JSON.parse(execFileSync(bunLint, ["linter", "rules"]).toString()).filter(
  id => !id.includes("/") && builtInRules.has(id) && !changed.includes(id),
);

const rng = random(8);
const basePath = "/work/project";
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

// `lodash.merge`, for objects.
function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value === "object" && target[key] !== null && typeof target[key] === "object") merge(target[key], value);
    else target[key] = structuredClone(value);
  }
}
const setting = value => (value === "off" ? "off" : [true, "true", "writable", "writeable"].includes(value) ? "writable" : "readonly");
const number = value => ({ off: 0, warn: 1, error: 2 })[value] ?? value;

const cases = [], expected = [], expectedWithTheNamesOfToday = [];
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
  const factory = new Legacy.ConfigArrayFactory({ cwd: basePath, builtInRules });
  const array = new Legacy.ConfigArray(
    ...factory.create({ ignorePatterns: Legacy.IgnorePattern.DefaultPatterns }, { filePath: `${basePath}/default`, name: "default" }),
    ...factory.create(structuredClone(config), { filePath: `${basePath}/.eslintrc.json`, name: ".eslintrc.json" }),
  );
  cases.push({ basePath, flavor: "eslintrc", config, files, directories: [] });
  // `CascadingConfigArrayFactory._finalizeConfigArray`
  try {
    new Legacy.ConfigValidator({ builtInRules }).validateConfigArray(array);
  } catch (error) {
    expected.push(files.map(() => ({ error: error.message })));
    expectedWithTheNamesOfToday.push(expected.at(-1));
    continue;
  }
  const expect = namesOf => file => {
    const extracted = array.extractConfig(file);
    if (extracted.ignores(file)) return { status: "ignored" };
    // `resolveParserOptions`
    const parserOptions = {};
    for (const [name, enabled] of Object.entries(extracted.env)) {
      if (enabled) merge(parserOptions, Legacy.environments.get(name).parserOptions ?? {});
    }
    merge(parserOptions, extracted.parserOptions);
    if (parserOptions.sourceType === "module") parserOptions.ecmaFeatures = { ...parserOptions.ecmaFeatures, globalReturn: false };
    // The globals of the environments, overridden by `globals`.
    const all = {};
    for (const [name, enabled] of Object.entries(extracted.env)) {
      if (enabled) Object.assign(all, namesOf(name));
    }
    Object.assign(all, extracted.globals);
    return {
      status: "matched",
      rules: Object.entries(extracted.rules).map(([id, value]) => [id, [number(value[0]), ...value.slice(1)]]).sort(),
      globals: withoutBuiltin(Object.entries(all).map(([name, value]) => [name, setting(value)]).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))),
      sourceType: parserOptions.sourceType ?? "script",
      parserOptions: Object.keys(parserOptions).length > 0 ? parserOptions : null,
      settings: Object.keys(extracted.settings).length > 0 ? extracted.settings : null,
      noInlineConfig: extracted.noInlineConfig ?? false,
      reportUnusedDisableDirectives: extracted.reportUnusedDisableDirectives ? 1 : 0,
    };
  };
  expected.push(files.map(expect(name => Legacy.environments.get(name).globals)));
  expectedWithTheNamesOfToday.push(files.map(expect(name => today[name === "es6" ? "es2015" : name])));
}
const emptyAsNull = value => (value && Object.keys(value).length === 0 ? null : value);
const actual = runBunLint("config", cases).map(it => it.files?.map(({ ecmaVersion, reportUnusedInlineConfigs, language, processor, rules, ...rest }) =>
  (rules ? { ...rest, globals: withoutBuiltin(rest.globals), rules: rules.filter(it => !changed.includes(it[0])).sort(), parserOptions: emptyAsNull(rest.parserOptions), settings: emptyAsNull(rest.settings) } : rest)) ?? it);
// One case for each file, so that what differs can be read.
const flat = { cases: [], expected: [], actual: [] };
let differInTheNamesOnly = 0;
cases.forEach(({ files, config }, i) => files.forEach((file, j) => {
  const got = actual[i][j] ?? actual[i];
  if (!isDeepStrictEqual(expected[i][j], got) && isDeepStrictEqual(expectedWithTheNamesOfToday[i][j], got)) {
    differInTheNamesOnly++;
    return;
  }
  flat.cases.push({ file, config });
  flat.expected.push(expected[i][j]);
  flat.actual.push(got);
}));
console.log(`eslintrc: ${differInTheNamesOnly} more differ in nothing but the names that \`env\` defines, which are those of today`);
report("eslintrc", flat.cases, flat.expected, flat.actual, 5);
