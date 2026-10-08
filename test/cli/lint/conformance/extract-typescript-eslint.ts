// Turns typescript-eslint's rule tests (`packages/eslint-plugin/tests/rules`)
// into `fixtures/typescript-eslint/<rule>.json`, and copies the project the
// type-aware tests are linted in to `fixtures/typescript-eslint-project/`.
// See README.md for the format.
//
//   TYPESCRIPT_ESLINT_DIR=<checkout> bun extract-typescript-eslint.ts [--jobs N] [rule...]
//
// The checkout has to be prepared by `prepare-checkouts.ts` first.
//
// Same scheme as `extract-eslint.ts`: the test files are loaded with
// `@typescript-eslint/rule-tester` replaced by a stub that records, the real
// `Linter` is then run on every recorded case with the config the real
// RuleTester would have built, and what upstream asserts is a cross-check.

import { cpSync, existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, normalize, parse as parsePath, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_CODE_LENGTH,
  compareWithUpstream,
  jsonPart,
  nullIfEmpty,
  onePassOutput,
  parseArgs,
  requiredEnv,
  runWorkers,
  toFixtureMessages,
  toFixtureMeta,
  writeJson,
  type Fixture,
  type FixtureCase,
  type LintMessage,
  type RuleModule,
  type RuleReport,
} from "./shared.ts";

const script = fileURLToPath(import.meta.url);
const args = parseArgs("typescript-eslint", join(script, ".."));
const pluginDir = join(realpathSync(requiredEnv("TYPESCRIPT_ESLINT_DIR")), "packages/eslint-plugin");
const testsDir = join(pluginDir, "tests/rules");
/** `getFixturesRootDir()` upstream: the `tsconfigRootDir` of the type-aware tests. */
const projectDir = join(pluginDir, "tests/fixtures");

const require = createRequire(join(pluginDir, "package.json"));

if (!args.worker) {
  const allRules = Object.keys(require("./dist/rules/index.js")).sort();
  if (args.rules.length === 0) {
    const copy = join(args.out, "../typescript-eslint-project");
    rmSync(copy, { recursive: true, force: true });
    cpSync(projectDir, copy, { recursive: true });
  }
  await runWorkers(script, args.rules.length > 0 ? args.rules : allRules, args);
  process.exit();
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

// `{ from: "file" }` type specifiers in rule options are resolved against the
// working directory, and some tests compute their `path` from it. Upstream runs
// in `packages/eslint-plugin`; running in the fixture project instead gives
// fixtures that only mention paths inside of it.
process.chdir(projectDir);

// The tests and the rules they import are TypeScript that Node.js cannot strip
// (extensionless imports, enums); the repo's own `tsx` compiles them on require().
require("tsx/cjs/api").register();

const requireFromRuleTester = createRequire(require.resolve("@typescript-eslint/rule-tester/package.json"));
const merge: (...objects: unknown[]) => any = requireFromRuleTester("lodash.merge");
const { deepMerge } = require("@typescript-eslint/utils/eslint-utils");
const { satisfiesAllDependencyConstraints } = requireFromRuleTester("./dist/utils/dependencyConstraints.js");
const typescriptParser = require("@typescript-eslint/parser");

const eslintDir = dirname(require.resolve("eslint/package.json"));
const { Linter, SourceCodeFixer } = require(join(eslintDir, "lib/linter"));
const { interpolate } = require(join(eslintDir, "lib/linter/interpolate"));

type Config = Record<string, any>;

interface Run {
  rule: RuleModule;
  /** `#testerConfig` upstream. */
  testerConfig: Config;
  /** `defineRule()`d helpers, by name. */
  helperRules: Record<string, RuleModule>;
  valid: (string | Config)[];
  invalid: Config[];
}

const runs: Run[] = [];

const testerDefaultConfig: Config = {
  defaultFilenames: { ts: "file.ts", tsx: "react.tsx" },
  languageOptions: { parser: typescriptParser },
  rules: {},
};
let defaultConfig: Config = deepMerge({}, testerDefaultConfig);

/** Same public surface as `@typescript-eslint/rule-tester`'s; runs nothing. */
class RecordingRuleTester {
  testerConfig: Config;
  helperRules: Record<string, RuleModule> = {};
  constructor(testerConfig?: Config) {
    this.testerConfig = merge({}, defaultConfig, testerConfig);
  }
  static setDefaultConfig(config: Config) {
    defaultConfig = deepMerge(defaultConfig, config);
  }
  static getDefaultConfig() {
    return defaultConfig;
  }
  static resetDefaultConfig() {
    defaultConfig = merge({}, testerDefaultConfig);
  }
  static only(item: string | Config) {
    return typeof item === "string" ? { code: item, only: true } : { ...item, only: true };
  }
  static afterAll: unknown;
  static describe: unknown;
  static describeSkip: unknown;
  static it: unknown;
  static itOnly: unknown;
  static itSkip: unknown;
  defineRule(name: string, rule: RuleModule) {
    this.helperRules[name] = rule;
  }
  run(_name: string, rule: RuleModule, tests: { valid: (string | Config)[]; invalid: Config[] }) {
    const { testerConfig, helperRules } = this;
    runs.push({ rule, testerConfig, helperRules: { ...helperRules }, valid: tests.valid, invalid: tests.invalid });
  }
}

function stubModule(specifier: string, exports: unknown) {
  const file = require.resolve(specifier);
  require.cache[file] = { id: file, filename: file, loaded: true, exports } as any;
}

// Some files wrap `ruleTester.run()` in `describe()`, and have plain unit tests
// next to it. The former has to run, the latter must not.
const forEach =
  <T>(table: readonly T[]) =>
  (_name: string, body: (row: T) => void) =>
    table.forEach(row => body(row));
const describe = Object.assign((_name: string, body: () => void) => body(), { skip() {}, each: forEach, for: forEach });
const it = Object.assign(() => {}, { skip() {}, only() {}, each: () => () => {}, for: () => () => {} });
Object.assign(globalThis, { describe, it, test: it, beforeAll() {}, afterAll() {}, beforeEach() {}, afterEach() {} });
stubModule("vitest", { describe, it, test: it });
stubModule("@typescript-eslint/rule-tester", {
  RuleTester: RecordingRuleTester,
  noFormat: (raw: TemplateStringsArray, ...keys: string[]) => String.raw({ raw }, ...keys),
});

/** Test case properties that are not ESLint config (`RULE_TESTER_PARAMETERS` upstream). */
const notConfig = [
  "after",
  "before",
  "code",
  "defaultFilenames",
  "dependencyConstraints",
  "errors",
  "filename",
  "name",
  "only",
  "options",
  "output",
  "skip",
];

const toPosix = (path: string) => path.split(sep).join("/");

/** Absolute paths into the upstream fixture project become relative to it, everywhere. */
function relativeToProject<T>(value: T): T {
  if (typeof value === "string") {
    if (value !== projectDir && !value.startsWith(projectDir + sep)) return value;
    return (toPosix(relative(projectDir, value)) || ".") as T;
  }
  if (Array.isArray(value)) return value.map(relativeToProject) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, relativeToProject(v)])) as T;
  }
  return value;
}

/** The tsconfig a type-aware case is checked with, relative to the fixture project. */
function findTsconfig(parserOptions: Config, filename: string): string | null {
  const root: string = parserOptions.tsconfigRootDir ?? process.cwd();
  const project = Array.isArray(parserOptions.project) ? parserOptions.project[0] : parserOptions.project;
  if (typeof project === "string") return toPosix(relative(projectDir, resolve(root, project)));
  // `project: true` and `projectService`: the closest tsconfig.json.
  for (let dir = dirname(resolve(root, filename)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "tsconfig.json"))) return toPosix(relative(projectDir, join(dir, "tsconfig.json")));
    if (dir === dirname(dir)) return null;
  }
}

const linters = new Map<string | undefined, InstanceType<typeof Linter>>();

/** `#getLinterForFilename()` upstream. */
function linterFor(testerConfig: Config, filename: string) {
  let basePath: string | undefined = testerConfig.languageOptions.parserOptions?.tsconfigRootDir;
  if (isAbsolute(filename) || normalize(filename).startsWith("..")) {
    basePath = parsePath(resolve(basePath ?? process.cwd(), filename)).root;
  }
  let linter = linters.get(basePath);
  if (!linter) linters.set(basePath, (linter = new Linter({ configType: "flat", cwd: basePath })));
  return linter;
}

function runCase(
  ruleName: string,
  run: Run,
  rawItem: string | Config,
  valid: boolean,
  report: RuleReport,
  index: number,
) {
  const ruleId = `@typescript-eslint/${ruleName}`;
  // The real RuleTester registers the rule as `@rule-tester/<name>`.
  const useRealRuleId = <T>(text: T): T =>
    (typeof text === "string" ? text.replaceAll(`@rule-tester/${ruleName}`, ruleId) : text) as T;

  const item: Config = typeof rawItem === "string" ? { code: rawItem } : { ...rawItem };
  item.code = useRealRuleId(item.code);
  item.output = Array.isArray(item.output) ? item.output.map(useRealRuleId) : useRealRuleId(item.output);
  const code: string = item.code;
  const options: unknown[] = item.options ?? [];
  const { testerConfig } = run;

  // `normalizeTest()` upstream.
  const resolvedParserOptions = deepMerge(
    testerConfig.languageOptions.parserOptions,
    item.languageOptions?.parserOptions,
  );
  let filename: string =
    item.filename ?? testerConfig.defaultFilenames[resolvedParserOptions.ecmaFeatures?.jsx ? "tsx" : "ts"];
  if (resolvedParserOptions.project) filename = join(resolvedParserOptions.tsconfigRootDir ?? process.cwd(), filename);
  item.languageOptions = {
    ...item.languageOptions,
    parserOptions: { disallowAutomaticSingleRunInference: true, ...item.languageOptions?.parserOptions },
  };

  // `runRuleForItem()` upstream, minus the AST-validation helpers, and with the
  // rule under its real id.
  let config: Config = merge({}, testerConfig, {
    files: ["**"],
    plugins: {
      "@typescript-eslint": { rules: { [ruleName]: run.rule } },
      "@rule-tester": { rules: run.helperRules },
    },
  });
  config.languageOptions.parser = item.languageOptions.parser ?? testerConfig.languageOptions.parser;
  const itemConfig = { ...item };
  for (const key of notConfig) delete itemConfig[key];
  config = merge(config, itemConfig);
  config.rules[ruleId] = ["error", ...options];
  delete config.defaultFilenames;
  delete config.dependencyConstraints;
  config = merge(config, {
    languageOptions: {
      ...config.languageOptions,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ...config.languageOptions.parserOptions },
    },
    linterOptions: { reportUnusedDisableDirectives: 1, ...config.linterOptions },
  });

  const { parser } = config.languageOptions;
  // Not an identity check: `merge()` above cloned the parser module.
  const parserKind = parser.meta?.name === typescriptParser.meta.name ? "typescript" : "other";
  const helpers = Object.keys(run.helperRules).filter(name => code.includes(`@rule-tester/${name}`));
  const constraints = [testerConfig.dependencyConstraints, item.dependencyConstraints];

  let skip: string | null = null;
  if (parserKind === "other") skip = "parser: custom";
  else if (helpers.length > 0) skip = `test-only rule: ${helpers.join(", ")}`;
  else if (item.skip) skip = "skipped upstream";
  else if (!constraints.every(satisfiesAllDependencyConstraints)) skip = "dependencyConstraints not satisfied";
  else if (item.before || item.after) skip = "before/after hook";

  item.before?.();
  let lintMessages: LintMessage[];
  try {
    lintMessages = linterFor(testerConfig, filename).verify(code, config, filename);
  } finally {
    item.after?.();
  }
  const fatal = lintMessages.find(m => m.fatal);
  if (fatal) skip ??= `fatal: ${fatal.message.replaceAll(projectDir, ".")}`;

  const dropped: string[] = [];
  const allParserOptions: Config = config.languageOptions.parserOptions;
  const parserOptions = jsonPart(allParserOptions, dropped, "parserOptions") as Config;
  const jsonOptions = jsonPart(options, dropped, "options") as unknown[];
  const settings = jsonPart(config.settings, dropped, "settings") as Config | undefined;
  if (dropped.length > 0) skip ??= `not JSON-serializable: ${dropped.join(", ")}`;

  // ESLint's own idea of these two. The parser is given `parserOptions`' when
  // they are set there too, which the RuleTester always does; they are only
  // worth recording when the two differ.
  let ecmaVersion: number | "latest" = config.languageOptions.ecmaVersion ?? "latest";
  if (typeof ecmaVersion === "number" && ecmaVersion >= 6 && ecmaVersion < 2015) ecmaVersion += 2009;
  const sourceType = config.languageOptions.sourceType ?? (/\.cjs$/.test(filename) ? "commonjs" : "module");
  if (parserOptions.ecmaVersion === ecmaVersion) delete parserOptions.ecmaVersion;
  if (parserOptions.sourceType === sourceType) delete parserOptions.sourceType;
  delete parserOptions.disallowAutomaticSingleRunInference;

  const typeAware = Boolean(allParserOptions.project || allParserOptions.projectService || allParserOptions.programs);

  const result: FixtureCase = {
    valid,
    name: item.name ?? null,
    code,
    // The parser resolves a relative name against `tsconfigRootDir`.
    filename: relativeToProject(typeAware ? resolve(allParserOptions.tsconfigRootDir ?? ".", filename) : filename),
    options: relativeToProject(jsonOptions),
    languageOptions: {
      parser: parserKind,
      ecmaVersion,
      sourceType,
      globals: nullIfEmpty(config.languageOptions.globals),
      parserOptions: nullIfEmpty(relativeToProject(parserOptions)),
    },
    settings: nullIfEmpty(settings),
    typeAware,
    tsconfig: typeAware ? findTsconfig(allParserOptions, filename) : null,
    skip,
    messages: toFixtureMessages(code, lintMessages, ruleId, SourceCodeFixer),
    output: onePassOutput(code, lintMessages, SourceCodeFixer),
  };

  const problems = compareWithUpstream(item as any, valid, result, run.rule, interpolate);
  if (problems.length > 0) report.disagreements.push({ rule: ruleName, index, code, skip, problems });
  return result;
}

/** `<rule>.test.ts` and everything under `<rule>/`, in a stable order. */
function testFiles(ruleName: string): string[] {
  const files = existsSync(join(testsDir, `${ruleName}.test.ts`)) ? [join(testsDir, `${ruleName}.test.ts`)] : [];
  if (existsSync(join(testsDir, ruleName))) {
    const nested = readdirSync(join(testsDir, ruleName), { recursive: true }) as string[];
    files.push(
      ...nested
        .filter(file => file.endsWith(".test.ts"))
        .sort()
        .map(file => join(testsDir, ruleName, file)),
    );
  }
  return files;
}

const rules: Record<string, RuleModule> = require("./src/rules/index.ts");

for (const ruleName of args.rules) {
  runs.length = 0;
  const report: RuleReport = { rule: ruleName, disagreements: [], notes: [] };
  for (const file of testFiles(ruleName)) require(file);

  const rule = rules[ruleName];
  for (const run of runs) {
    if (run.rule !== rule) report.notes.push("a run() call was given a rule object other than the plugin's");
  }

  const cases: FixtureCase[] = [];
  for (const valid of [true, false]) {
    for (const run of runs) {
      for (const item of valid ? run.valid : run.invalid) {
        const size = (typeof item === "string" ? item : item.code).length;
        if (size > MAX_CODE_LENGTH) report.notes.push(`omitted a case with ${size} characters of code`);
        else cases.push(runCase(ruleName, run, item, valid, report, cases.length));
      }
    }
  }

  const fixture: Fixture = { plugin: "typescript-eslint", rule: ruleName, meta: toFixtureMeta(rule), cases };
  writeJson(join(args.out, `${ruleName}.json`), fixture);
  writeJson(join(args.report, `${ruleName}.json`), report);
}

// The TypeScript watch programs would keep the process alive.
process.exit();
