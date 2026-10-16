// Records what real ESLint reports for test cases that are not upstream's, in the format of `fixtures/`.
//
//   ESLINT_DIR=.. TYPESCRIPT_ESLINT_DIR=.. node extra-cases.ts --out <dir> <plugin>/<rule> <cases.json> [<plugin>/<rule> <cases.json> ...]
//
// `<plugin>` is `eslint` or `typescript-eslint`. `cases.json` is an array of
//
//   { "code": "..", "options"?: [..], "filename"?: "..", "languageOptions"?: {..}, "settings"?: {..}, "name"?: "..",
//     "typeAware"?: false }
//
// (a plain string is `{ code }`), `languageOptions` as in the fixtures: `parser` is `"espree"` or `"typescript"`, and in
// `parserOptions`, `project` and `tsconfigRootDir` are relative to `fixtures/typescript-eslint-project`. A case of a
// fixture is a valid input.
//
// The configuration is layered as the RuleTester of the plugin does it (see `extract-*.ts`), with these defaults:
//
// - eslint: espree, `ecmaVersion: "latest"`, `sourceType: "module"`; the TypeScript parser when `filename` ends in
//   `.ts`, `.tsx`, `.mts` or `.cts`; JSX when it ends in `.jsx`.
// - typescript-eslint: its parser. A rule that requires types gets the `parserOptions` that most of its upstream cases
//   have, and the code is `file.ts` (`react.tsx` with `ecmaFeatures.jsx`) of the fixture project. `typeAware: false`
//   turns that off. Unlike in the RuleTester, all the rules of the plugin are defined, and only the one is enabled.
// - A case that names neither a file nor a parser and that does not parse is tried again with JSX, then as `file.ts`,
//   then as `file.tsx`. What is recorded says which it was.
//
// `skip` is set on what cannot be compared: a fatal parse error, options that ESLint rejects, a rule that throws or that
// does not finish in `--timeout` seconds (20).
//
// `--out <dir>` gets `<dir>/<plugin>/<rule>.json` and a link to the fixture project.
//
// Needs Node.js >= 23.6, as the extractors do.

import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, normalize, parse as parsePath, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import {
  jsonPart,
  nullIfEmpty,
  onePassOutput,
  readJson,
  requiredEnv,
  toFixtureMessages,
  toFixtureMeta,
  writeJson,
  type Fixture,
  type FixtureCase,
  type LintMessage,
  type RuleModule,
} from "./shared.ts";

type Config = Record<string, any>;
type Plugin = Fixture["plugin"];

export interface ExtraCase {
  code: string;
  name?: string | null;
  options?: unknown[];
  filename?: string | null;
  languageOptions?: Config | null;
  settings?: Config | null;
  /** `false`: without types, also for a rule that requires them. */
  typeAware?: boolean;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

const jobsOfRule: { plugin: Plugin; rule: string; file: string }[] = [];
let out = "";
/** Seconds that ESLint has for one case. */
let timeout = 20;
let upstream = join(scriptDir, "fixtures");
{
  const argv = process.argv.slice(2);
  const plain: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out = resolve(argv[++i]);
    else if (arg === "--fixtures") upstream = resolve(argv[++i]);
    else if (arg === "--timeout") timeout = Number(argv[++i]);
    else if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}`);
    else plain.push(arg);
  }
  if (!out || plain.length === 0 || plain.length % 2 !== 0) {
    console.error("usage: node extra-cases.ts --out <dir> <plugin>/<rule> <cases.json> ...");
    process.exit(2);
  }
  for (let i = 0; i < plain.length; i += 2) {
    const id = plain[i].replace(/^@typescript-eslint\//, "typescript-eslint/");
    const [plugin, rule] = id.includes("/") ? id.split("/") : ["eslint", id];
    if (plugin !== "eslint" && plugin !== "typescript-eslint") throw new Error(`unknown plugin ${plugin}`);
    jobsOfRule.push({ plugin, rule, file: resolve(plain[i + 1]) });
  }
}

// ---------------------------------------------------------------------------
// What both plugins share
// ---------------------------------------------------------------------------

const withoutNulls = (object: Config | null | undefined): Config =>
  Object.fromEntries(Object.entries(object ?? {}).filter(([, value]) => value !== null && value !== undefined));

let pending: () => LintMessage[];
Object.assign(globalThis, { __extraCasesLint: () => pending() });
const watched = new Script("__extraCasesLint()");

/** Lints, and says why the result cannot be compared if it cannot. */
function verify(lint: () => LintMessage[]): { messages: LintMessage[]; skip: string | null; fatal: boolean } {
  let messages: LintMessage[];
  try {
    // Some rules take exponential time on some types. The watchdog of `vm` also stops code that the script calls.
    pending = lint;
    messages = watched.runInThisContext({ timeout: timeout * 1000 });
  } catch (error) {
    if ((error as { code?: string })?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      return { messages: [], skip: `eslint did not finish in ${timeout} s`, fatal: false };
    }
    const message = String((error as Error)?.message ?? error).split("\n");
    const isConfig = /Configuration for rule|Key "/.test(message[0]) || /Unexpected|should|must/.test(message[1] ?? "");
    return {
      messages: [],
      skip: `${isConfig ? "invalid config" : "eslint threw"}: ${message.slice(0, 3).join(" ")}`,
      fatal: false,
    };
  }
  const fatal = messages.find(m => m.fatal);
  return { messages, skip: fatal ? `fatal: ${fatal.message}` : null, fatal: Boolean(fatal) };
}

interface Recorder {
  meta(rule: string): RuleModule | undefined;
  record(rule: string, item: ExtraCase, defaults: Config | null): FixtureCase;
}

// ---------------------------------------------------------------------------
// eslint: `runCase()` of extract-eslint.ts
// ---------------------------------------------------------------------------

function eslintRecorder(): Recorder {
  const eslintDir = realpathSync(requiredEnv("ESLINT_DIR"));
  const require = createRequire(join(eslintDir, "package.json"));
  const { Linter, SourceCodeFixer } = require("./lib/linter");
  const { FlatConfigArray } = require("./lib/config/flat-config-array");
  const { defaultConfig, defaultRuleTesterConfig } = require("./lib/config/default-config");
  const builtinRules: Map<string, RuleModule> = require("./lib/rules");
  const espree = require("espree");
  const typescriptParser = require("@typescript-eslint/parser");
  const linter = new Linter({ configType: "flat" });

  function attempt(ruleName: string, item: ExtraCase, parser: "espree" | "typescript", filename: string, jsx: boolean) {
    const { code } = item;
    const options = item.options ?? [];
    const languageOptions = withoutNulls(item.languageOptions);
    languageOptions.parser = parser === "espree" ? espree : typescriptParser;
    if (jsx) {
      const parserOptions = languageOptions.parserOptions ?? {};
      languageOptions.parserOptions = { ...parserOptions, ecmaFeatures: { ...parserOptions.ecmaFeatures, jsx: true } };
    }
    const itemConfig: Config = { languageOptions };
    if (item.settings) itemConfig.settings = item.settings;

    let effective: Config | undefined;
    const result = verify(() => {
      const configs = new FlatConfigArray([{ rules: {} }, {}], {
        baseConfig: [
          { plugins: { "@": defaultConfig[0].plugins["@"] }, language: defaultConfig[0].language },
          ...defaultRuleTesterConfig,
        ],
        basePath: parsePath(filename).root || undefined,
      });
      configs.push(itemConfig);
      configs.push({ rules: { [ruleName]: ["error", ...options] } });
      configs.normalizeSync();
      effective = configs.getConfig(filename);
      return linter.verify(code, configs, filename);
    });

    const dropped: string[] = [];
    const effectiveOptions: Config = effective?.languageOptions ?? languageOptions;
    const parserOptions = jsonPart(effectiveOptions.parserOptions ?? {}, dropped, "parserOptions") as Config;
    if (parser === "espree") delete parserOptions.sourceType;
    const requestedVersion = languageOptions.ecmaVersion ?? "latest";
    const recorded: FixtureCase = {
      valid: result.messages.length === 0,
      name: item.name ?? null,
      code,
      filename,
      options: jsonPart(options, dropped, "options") as unknown[],
      languageOptions: {
        parser,
        ecmaVersion: requestedVersion === "latest" ? "latest" : (effectiveOptions.ecmaVersion ?? requestedVersion),
        sourceType: effectiveOptions.sourceType ?? "module",
        globals: nullIfEmpty(effectiveOptions.globals),
        parserOptions: nullIfEmpty(parserOptions),
      },
      settings: nullIfEmpty(jsonPart(effective?.settings ?? item.settings ?? {}, dropped, "settings") as Config),
      typeAware: false,
      tsconfig: null,
      skip: result.skip,
      messages: toFixtureMessages(code, result.messages, ruleName, SourceCodeFixer),
      output: onePassOutput(code, result.messages, SourceCodeFixer),
    };
    return { recorded, fatal: result.fatal };
  }

  return {
    meta: rule => builtinRules.get(rule),
    record(ruleName, item) {
      const given = item.languageOptions?.parser;
      const named: "espree" | "typescript" | undefined = given === "espree" || given === "typescript" ? given : undefined;
      const wantsJsx = Boolean(item.languageOptions?.parserOptions?.ecmaFeatures?.jsx);
      if (item.filename || named) {
        const parser = named ?? (/\.[cm]?tsx?$/.test(item.filename!) ? "typescript" : "espree");
        const filename = item.filename ?? `file.${parser === "typescript" ? "ts" : "js"}${wantsJsx ? "x" : ""}`;
        const only = attempt(ruleName, item, parser, filename, parser === "espree" && filename.endsWith(".jsx"));
        if (!only.fatal || item.filename || parser === "espree" || wantsJsx) return only.recorded;
        const second = attempt(ruleName, item, parser, "file.tsx", true);
        return second.fatal ? only.recorded : second.recorded;
      }
      const first = attempt(ruleName, item, "espree", wantsJsx ? "file.jsx" : "file.js", false);
      if (!first.fatal) return first.recorded;
      for (const [parser, filename, jsx] of [
        ["espree", "file.jsx", true],
        ["typescript", "file.ts", false],
        ["typescript", "file.tsx", true],
      ] as const) {
        const next = attempt(ruleName, item, parser, filename, jsx);
        if (!next.fatal) return next.recorded;
      }
      return first.recorded;
    },
  };
}

// ---------------------------------------------------------------------------
// typescript-eslint: `runCase()` of extract-typescript-eslint.ts
// ---------------------------------------------------------------------------

function typescriptRecorder(): Recorder {
  const pluginDir = join(realpathSync(requiredEnv("TYPESCRIPT_ESLINT_DIR")), "packages/eslint-plugin");
  const projectDir = join(pluginDir, "tests/fixtures");
  const require = createRequire(join(pluginDir, "package.json"));
  process.chdir(projectDir);

  const requireFromRuleTester = createRequire(require.resolve("@typescript-eslint/rule-tester/package.json"));
  const merge: (...objects: unknown[]) => any = requireFromRuleTester("lodash.merge");
  const typescriptParser = require("@typescript-eslint/parser");
  const eslintDir = dirname(require.resolve("eslint/package.json"));
  const { Linter, SourceCodeFixer } = require(join(eslintDir, "lib/linter"));
  const rules: Record<string, RuleModule> = require("./dist/rules/index.js");

  const toPosix = (path: string) => path.split(sep).join("/");
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
  function findTsconfig(parserOptions: Config, filename: string): string | null {
    const root: string = parserOptions.tsconfigRootDir ?? process.cwd();
    const project = Array.isArray(parserOptions.project) ? parserOptions.project[0] : parserOptions.project;
    if (typeof project === "string") return toPosix(relative(projectDir, resolve(root, project)));
    for (let dir = dirname(resolve(root, filename)); ; dir = dirname(dir)) {
      if (existsSync(join(dir, "tsconfig.json"))) return toPosix(relative(projectDir, join(dir, "tsconfig.json")));
      if (dir === dirname(dir)) return null;
    }
  }
  const linters = new Map<string | undefined, any>();
  function linterFor(basePath: string | undefined, filename: string) {
    if (isAbsolute(filename) || normalize(filename).startsWith("..")) {
      basePath = parsePath(resolve(basePath ?? process.cwd(), filename)).root;
    }
    let linter = linters.get(basePath);
    if (!linter) linters.set(basePath, (linter = new Linter({ configType: "flat", cwd: basePath })));
    return linter;
  }

  /** Gives the file of the last type-aware case the text that it has on disk. */
  let restore: { path: string; run: () => void } | null = null;

  function attempt(ruleName: string, item: ExtraCase, defaults: Config | null, jsx: boolean) {
    const ruleId = `@typescript-eslint/${ruleName}`;
    const { code } = item;
    const options = item.options ?? [];
    const languageOptions = withoutNulls(item.languageOptions);
    delete languageOptions.parser;

    const given: Config = { ...languageOptions.parserOptions };
    // A case that chooses a project does not also want the project service of the defaults, and the other way around.
    const inherited: Config = { ...defaults };
    if (given.project !== undefined && given.projectService === undefined) delete inherited.projectService;
    if (given.projectService && given.project === undefined) delete inherited.project;
    const parserOptions: Config = merge({}, inherited, given, jsx ? { ecmaFeatures: { jsx: true } } : {});
    const typeAware = Boolean(parserOptions.project || parserOptions.projectService);
    if (typeAware || parserOptions.tsconfigRootDir !== undefined) {
      parserOptions.tsconfigRootDir = resolve(projectDir, parserOptions.tsconfigRootDir ?? ".");
    }

    let filename: string = item.filename ?? (parserOptions.ecmaFeatures?.jsx ? "react.tsx" : "file.ts");
    // As in the fixtures, the name of a type-aware case is relative to the project.
    if (typeAware && item.filename) filename = resolve(projectDir, filename);
    else if (parserOptions.project) filename = join(parserOptions.tsconfigRootDir ?? process.cwd(), filename);

    const config: Config = {
      files: ["**"],
      // All the rules, as in a project: a comment that disables another rule of the plugin is about a rule that is defined.
      plugins: { "@typescript-eslint": { rules } },
      languageOptions: {
        ...languageOptions,
        parser: typescriptParser,
        parserOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          disallowAutomaticSingleRunInference: true,
          ...parserOptions,
        },
      },
      linterOptions: { reportUnusedDisableDirectives: 1 },
      rules: { [ruleId]: ["error", ...options] },
    };
    if (item.settings) config.settings = item.settings;

    // The programs of typescript-estree remember the text that a file was linted with. The declarations of a case that was
    // `react.tsx` would be visible to the next one that is `file.ts`: both are scripts of one program.
    const path = resolve(parserOptions.tsconfigRootDir ?? ".", filename);
    if (restore && restore.path !== path) {
      restore.run();
      restore = null;
    }
    const linter = linterFor(parserOptions.tsconfigRootDir, filename);
    const result = verify(() => linter.verify(code, config, filename));
    if (typeAware && existsSync(path)) {
      restore = { path, run: () => verify(() => linter.verify(readFileSync(path, "utf8"), { ...config, rules: {} }, filename)) };
    }
    if (result.skip) result.skip = result.skip.replaceAll(projectDir, ".");

    const dropped: string[] = [];
    const recordedOptions = jsonPart(config.languageOptions.parserOptions, dropped, "parserOptions") as Config;
    let ecmaVersion: number | "latest" = languageOptions.ecmaVersion ?? "latest";
    if (typeof ecmaVersion === "number" && ecmaVersion >= 6 && ecmaVersion < 2015) ecmaVersion += 2009;
    const sourceType = languageOptions.sourceType ?? (/\.cjs$/.test(filename) ? "commonjs" : "module");
    if (recordedOptions.ecmaVersion === ecmaVersion) delete recordedOptions.ecmaVersion;
    if (recordedOptions.sourceType === sourceType) delete recordedOptions.sourceType;
    delete recordedOptions.disallowAutomaticSingleRunInference;

    const recorded: FixtureCase = {
      valid: result.messages.length === 0,
      name: item.name ?? null,
      code,
      filename: relativeToProject(typeAware ? resolve(parserOptions.tsconfigRootDir ?? ".", filename) : filename),
      options: relativeToProject(jsonPart(options, dropped, "options") as unknown[]),
      languageOptions: {
        parser: "typescript",
        ecmaVersion,
        sourceType,
        globals: nullIfEmpty(languageOptions.globals),
        parserOptions: nullIfEmpty(relativeToProject(recordedOptions)),
      },
      settings: nullIfEmpty(item.settings),
      typeAware,
      tsconfig: typeAware ? findTsconfig(parserOptions, filename) : null,
      skip: result.skip,
      messages: toFixtureMessages(code, result.messages, ruleId, SourceCodeFixer),
      output: onePassOutput(code, result.messages, SourceCodeFixer),
    };
    return { recorded, fatal: result.fatal };
  }

  return {
    meta: rule => rules[rule],
    record(ruleName, item, defaults) {
      const first = attempt(ruleName, item, defaults, false);
      if (!first.fatal || item.filename || item.languageOptions?.parserOptions?.ecmaFeatures?.jsx)
        return first.recorded;
      const second = attempt(ruleName, item, defaults, true);
      return second.fatal ? first.recorded : second.recorded;
    },
  };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * The `parserOptions` that most of the type-aware upstream cases of a rule that requires types have. `null` for a rule
 * that is mostly tested without types (`naming-convention`).
 */
function typeAwareDefaults(fixture: Fixture | null): Config | null {
  if (!fixture?.meta.requiresTypeChecking) return null;
  if (fixture.cases.filter(it => it.typeAware).length * 2 < fixture.cases.length) return null;
  const counts = new Map<string, number>();
  for (const { typeAware, languageOptions } of fixture.cases) {
    if (!typeAware) continue;
    const { ecmaFeatures: _, ...rest } = languageOptions.parserOptions ?? {};
    const key = JSON.stringify(rest);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [most] = [...counts].sort((a, b) => b[1] - a[1]);
  return most ? JSON.parse(most[0]) : { projectService: true, tsconfigRootDir: "." };
}

const recorders: Partial<Record<Plugin, Recorder>> = {};

for (const { plugin, rule, file } of jobsOfRule) {
  const recorder = (recorders[plugin] ??= plugin === "eslint" ? eslintRecorder() : typescriptRecorder());
  const module = recorder.meta(rule);
  if (!module) {
    console.error(`${plugin} has no rule ${rule}`);
    process.exitCode = 2;
    continue;
  }
  const upstreamFile = join(upstream, plugin, `${rule}.json`);
  const upstreamFixture = existsSync(upstreamFile) ? readJson<Fixture>(upstreamFile) : null;
  const defaults = typeAwareDefaults(upstreamFixture);
  const input = readJson<(string | ExtraCase)[] | { cases: ExtraCase[] }>(file);
  const items = (Array.isArray(input) ? input : input.cases).map(it => (typeof it === "string" ? { code: it } : it));
  const fixture: Fixture = {
    plugin,
    rule,
    meta: upstreamFixture?.meta ?? toFixtureMeta(module),
    cases: items.map(item => recorder.record(rule, item, item.typeAware === false ? null : defaults)),
  };
  mkdirSync(join(out, plugin), { recursive: true });
  writeJson(join(out, plugin, `${rule}.json`), fixture);
}

if (!existsSync(join(out, "typescript-eslint-project"))) {
  try {
    symlinkSync(join(upstream, "typescript-eslint-project"), join(out, "typescript-eslint-project"));
  } catch {
    // Someone else was faster.
  }
}

// The TypeScript watch programs would keep the process alive.
process.exit();
