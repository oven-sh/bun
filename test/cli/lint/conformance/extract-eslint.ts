// Turns ESLint's own rule tests (`tests/lib/rules/*.js`) into
// `fixtures/eslint/<rule>.json`. See README.md for the format.
//
//   ESLINT_DIR=<eslint checkout> bun extract-eslint.ts [--jobs N] [rule...]
//
// Each test file is loaded with `lib/rule-tester/rule-tester.js` replaced by a
// stub that only records what it is given. Every recorded case is then linted
// by the checkout's real `Linter`, configured the way the real RuleTester
// configures it, and what the Linter reports is the ground truth that is
// written out. What the upstream test asserts is only used as a cross-check.

import { readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, parse as parsePath, relative, sep } from "node:path";
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
const args = parseArgs("eslint", join(script, ".."));
const eslintDir = realpathSync(requiredEnv("ESLINT_DIR"));

const allRules = readdirSync(join(eslintDir, "lib/rules"))
  .filter(file => file.endsWith(".js") && file !== "index.js")
  .map(file => basename(file, ".js"))
  .sort();

if (!args.worker) {
  await runWorkers(script, args.rules.length > 0 ? args.rules : allRules, args);
  process.exit();
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const require = createRequire(join(eslintDir, "package.json"));
const { Linter, SourceCodeFixer } = require("./lib/linter");
const { FlatConfigArray } = require("./lib/config/flat-config-array");
const { defaultConfig, defaultRuleTesterConfig } = require("./lib/config/default-config");
const { interpolate } = require("./lib/linter/interpolate");
const builtinRules: Map<string, RuleModule> = require("./lib/rules");
const espree = require("espree");
const typescriptParser = require("@typescript-eslint/parser");

type Config = Record<string, any>;

interface Run {
  rule: RuleModule;
  /** `[sharedDefaultConfig, constructor argument]`, as in the real RuleTester. */
  testerConfig: Config[];
  valid: (string | Config)[];
  invalid: Config[];
}

const runs: Run[] = [];
let sharedDefaultConfig: Config = { rules: {} };

/** Same public surface as `lib/rule-tester/rule-tester.js`; runs nothing. */
class RecordingRuleTester {
  testerConfig: Config[];
  constructor(testerConfig: Config = {}) {
    this.testerConfig = [sharedDefaultConfig, testerConfig];
  }
  static setDefaultConfig(config: Config) {
    sharedDefaultConfig = { rules: {}, ...config };
  }
  static getDefaultConfig() {
    return sharedDefaultConfig;
  }
  static resetDefaultConfig() {
    sharedDefaultConfig = { rules: {} };
  }
  static only(item: string | Config) {
    return typeof item === "string" ? { code: item, only: true } : { ...item, only: true };
  }
  static describe: unknown;
  static it: unknown;
  static itOnly: unknown;
  run(_name: string, rule: RuleModule, tests: { valid: (string | Config)[]; invalid: Config[] }) {
    runs.push({ rule, testerConfig: this.testerConfig, valid: tests.valid, invalid: tests.invalid });
  }
}

const ruleTesterPath = require.resolve("./lib/rule-tester/rule-tester");
require.cache[ruleTesterPath] = {
  id: ruleTesterPath,
  filename: ruleTesterPath,
  loaded: true,
  exports: RecordingRuleTester,
} as any;

/** Test case properties that are not ESLint config (`RuleTesterParameters` upstream). */
const notConfig = ["name", "code", "filename", "options", "before", "after", "errors", "output", "only"];

/**
 * The real RuleTester registers the rule as `rule-to-test/<name>`, and a few
 * tests spell that id in a directive comment. The fixtures use the real id.
 */
const useRealRuleId = <T>(text: T): T => (typeof text === "string" ? text.replaceAll("rule-to-test/", "") : text) as T;

function parserKind(parser: unknown): FixtureCase["languageOptions"]["parser"] {
  return parser === espree ? "espree" : parser === typescriptParser ? "typescript" : "other";
}

function defaultFilename(configs: Config[]): string {
  let parser: unknown = espree;
  let jsx = false;
  for (const { languageOptions } of configs) {
    parser = languageOptions?.parser ?? parser;
    jsx = languageOptions?.parserOptions?.ecmaFeatures?.jsx ?? jsx;
  }
  return `file.${parser === typescriptParser ? "ts" : "js"}${jsx ? "x" : ""}`;
}

const linter = new Linter({ configType: "flat" });

function runCase(
  ruleName: string,
  run: Run,
  rawItem: string | Config,
  valid: boolean,
  report: RuleReport,
  index: number,
  /** The parser to use instead of the one the test names. */
  realParser?: unknown,
) {
  const item: Config = typeof rawItem === "string" ? { code: rawItem } : { ...rawItem };
  item.code = useRealRuleId(item.code);
  item.output = useRealRuleId(item.output);
  const code: string = item.code;
  const options: unknown[] = item.options ?? [];

  const itemConfig = { ...item };
  for (const key of notConfig) delete itemConfig[key];
  if (realParser) itemConfig.languageOptions = { ...itemConfig.languageOptions, parser: realParser };
  const userConfigs = [...run.testerConfig, itemConfig];
  const filename: string = item.filename ?? defaultFilename(userConfigs);

  // Same layering as `runRuleForItem()` upstream, minus the AST-validation
  // helpers, and with the rule under its real id instead of `rule-to-test/*`.
  const configs = new FlatConfigArray(run.testerConfig, {
    baseConfig: [
      { plugins: { "@": defaultConfig[0].plugins["@"] }, language: defaultConfig[0].language },
      ...defaultRuleTesterConfig,
    ],
    basePath: parsePath(filename).root || undefined,
  });
  configs.push(itemConfig);
  configs.push({ rules: { [ruleName]: ["error", ...options] } });
  configs.normalizeSync();

  const effective = configs.getConfig(filename);
  const { languageOptions } = effective;
  const parser = parserKind(languageOptions.parser);

  let skip: string | null = null;
  const testOnlyPlugins = Object.keys(effective.plugins).filter(name => name !== "@" && code.includes(`${name}/`));
  if (parser === "other") {
    const file = Object.keys(require.cache).find(file => require.cache[file]?.exports === languageOptions.parser);
    skip = `parser: ${file ? relative(eslintDir, file).split(sep).join("/") : "custom"}`;
  } else if (testOnlyPlugins.length > 0) {
    skip = `test-only plugin: ${testOnlyPlugins.join(", ")}`;
  } else if (effective.processor) {
    skip = "processor";
  } else if (item.before || item.after) {
    skip = "before/after hook";
  }

  item.before?.();
  let lintMessages: LintMessage[];
  try {
    lintMessages = linter.verify(code, configs, filename);
  } finally {
    item.after?.();
  }
  const fatal = lintMessages.find(m => m.fatal);
  if (fatal) skip ??= `fatal: ${fatal.message}`;

  const dropped: string[] = [];
  const parserOptions = jsonPart(languageOptions.parserOptions, dropped, "parserOptions") as Record<string, unknown>;
  // ESLint copies `sourceType` in here for espree; it is not something the test set.
  if (parser === "espree") delete parserOptions.sourceType;
  const jsonOptions = jsonPart(options, dropped, "options") as unknown[];
  const settings = jsonPart(effective.settings, dropped, "settings") as Record<string, unknown>;
  if (dropped.length > 0) skip ??= `not JSON-serializable: ${dropped.join(", ")}`;

  // "latest" unless some config layer asked for a specific version, in which
  // case it is ESLint's normalized form (6 -> 2015).
  const requestedVersion = userConfigs.reduce((v, c) => c.languageOptions?.ecmaVersion ?? v, "latest");

  const result: FixtureCase = {
    valid,
    name: item.name ?? null,
    code,
    filename,
    options: jsonOptions,
    languageOptions: {
      parser,
      ecmaVersion: requestedVersion === "latest" ? "latest" : languageOptions.ecmaVersion,
      sourceType: languageOptions.sourceType,
      globals: nullIfEmpty(languageOptions.globals),
      parserOptions: nullIfEmpty(parserOptions),
    },
    settings: nullIfEmpty(settings),
    typeAware: false,
    tsconfig: null,
    skip,
    messages: toFixtureMessages(code, lintMessages, ruleName, SourceCodeFixer),
    output: onePassOutput(code, lintMessages, SourceCodeFixer),
  };

  const problems = compareWithUpstream(item as any, valid, result, run.rule, interpolate);
  if (problems.length > 0) report.disagreements.push({ rule: ruleName, index, code, skip, problems });
  return result;
}

/**
 * A "parser" of `tests/fixtures/parsers` returns a hard-coded AST of the code: TypeScript, Flow or
 * proposals as some parser once read them. Where a real parser reads the code today, and ESLint then
 * reports what the test asserts, that is the case. Code that both refuse (`declare var a = 1`, which
 * typescript-estree throws on) stays a case for the parser "other": TypeScript, read leniently.
 */
function runCaseWithRealParser(...[ruleName, run, item, valid, report, index]: Parameters<typeof runCase>) {
  const scratch: RuleReport = { rule: ruleName, disagreements: [], notes: [] };
  const recorded = runCase(ruleName, run, item, valid, scratch, index);
  if (recorded.skip?.startsWith("parser: tests/fixtures/parsers/")) {
    const upstreamParser = recorded.skip.slice("parser: ".length);
    let isParsed = false;
    for (const parser of [typescriptParser, espree]) {
      const attempt: RuleReport = { rule: ruleName, disagreements: [], notes: [] };
      const result = runCase(ruleName, run, item, valid, attempt, index, parser);
      isParsed ||= result.skip === null;
      if (result.skip === null && attempt.disagreements.length === 0) return { ...result, upstreamParser };
    }
    if (isParsed) recorded.skip += " (the tree of a real parser gives another result)";
    else Object.assign(recorded, { skip: null, filename: "file.ts", upstreamParser });
  }
  report.disagreements.push(...scratch.disagreements);
  return recorded;
}

for (const ruleName of args.rules) {
  runs.length = 0;
  sharedDefaultConfig = { rules: {} };
  const report: RuleReport = { rule: ruleName, disagreements: [], notes: [] };
  require(`./tests/lib/rules/${ruleName}.js`);

  const rule = builtinRules.get(ruleName)!;
  for (const run of runs) {
    if (run.rule !== rule) report.notes.push("a run() call was given a rule object other than the built-in one");
  }

  const cases: FixtureCase[] = [];
  for (const valid of [true, false]) {
    for (const run of runs) {
      for (const item of valid ? run.valid : run.invalid) {
        const size = (typeof item === "string" ? item : item.code).length;
        if (size > MAX_CODE_LENGTH) report.notes.push(`omitted a case with ${size} characters of code`);
        else cases.push(runCaseWithRealParser(ruleName, run, item, valid, report, cases.length));
      }
    }
  }

  const fixture: Fixture = { plugin: "eslint", rule: ruleName, meta: toFixtureMeta(rule), cases };
  writeJson(join(args.out, `${ruleName}.json`), fixture);
  writeJson(join(args.report, `${ruleName}.json`), report);
}
