// Records what real ESLint reports for test cases that are not upstream's, in the format of `fixtures/`, and optionally
// compares that with what `bun-lint` reports.
//
//   ESLINT_DIR=.. TYPESCRIPT_ESLINT_DIR=.. node extra-cases.ts --out <dir> [--judge <bun-lint>] [--jobs N] [--quiet]
//       [--diff <dir>] [--verdicts <file>] <plugin>/<rule> <cases.json> [<plugin>/<rule> <cases.json> ...]
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
//   turns that off.
// - A case that names neither a file nor a parser and that does not parse is tried again with JSX, then as `file.ts`,
//   then as `file.tsx`. What is recorded says which it was.
//
// `skip` is set on what cannot be compared: a fatal parse error, options that ESLint rejects, a rule that throws or that
// does not finish in `--timeout` seconds (20).
//
// `--out <dir>` gets `<dir>/<plugin>/<rule>.json` and a link to the fixture project. With `--judge`, `bun-lint conformance`
// and `bun-lint types conformance` run on `<dir>`, and each case that differs is printed (and written to
// `<diff>/<plugin>/<rule>.txt`). The last line is `N cases, M differ, K skipped`. `--verdicts` gets, as JSON, the indices of
// the cases that differ, by `<plugin>/<rule>`.
//
// Needs Node.js >= 23.6, as the extractors do.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  type FixtureMessage,
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
let judge = "";
let diffDir = "";
let verdicts = "";
let typesJobs = 4;
let quiet = false;
/** Seconds that ESLint has for one case. */
let timeout = 20;
let upstream = join(scriptDir, "fixtures");
{
  const argv = process.argv.slice(2);
  const plain: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out = resolve(argv[++i]);
    else if (arg === "--judge") judge = resolve(argv[++i]);
    else if (arg === "--diff") diffDir = resolve(argv[++i]);
    else if (arg === "--verdicts") verdicts = resolve(argv[++i]);
    else if (arg === "--fixtures") upstream = resolve(argv[++i]);
    else if (arg === "--jobs") typesJobs = Number(argv[++i]);
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--timeout") timeout = Number(argv[++i]);
    else if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}`);
    else plain.push(arg);
  }
  if (!out || plain.length === 0 || plain.length % 2 !== 0) {
    console.error("usage: node extra-cases.ts --out <dir> [--judge <bun-lint>] <plugin>/<rule> <cases.json> ...");
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
      plugins: { "@typescript-eslint": { rules: { [ruleName]: rules[ruleName] } } },
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
const written: Fixture[] = [];

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
  written.push(fixture);
}

if (!existsSync(join(out, "typescript-eslint-project"))) {
  try {
    symlinkSync(join(upstream, "typescript-eslint-project"), join(out, "typescript-eslint-project"));
  } catch {
    // Someone else was faster.
  }
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

/** Reads what `{:#?}` of Rust prints: structs and tuples become arrays or objects, `None` is `null`, `Some(x)` is `x`. */
function parseRustDebug(text: string): unknown {
  let at = 0;
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) at++;
  };
  function list(close: string): unknown[] {
    const items: unknown[] = [];
    for (space(); text[at] !== close && at < text.length; space()) {
      items.push(value());
      space();
      if (text[at] === ",") at++;
    }
    at++;
    return items;
  }
  function string(): string {
    let result = "";
    for (at++; at < text.length && text[at] !== '"'; at++) {
      if (text[at] !== "\\") {
        result += text[at];
        continue;
      }
      const escape = text[++at];
      if (escape === "u") {
        const end = text.indexOf("}", at);
        result += String.fromCodePoint(parseInt(text.slice(at + 2, end), 16));
        at = end;
      } else result += ({ n: "\n", r: "\r", t: "\t", "0": "\0" } as Record<string, string>)[escape] ?? escape;
    }
    at++;
    return result;
  }
  function value(): unknown {
    space();
    const c = text[at];
    if (c === '"') return string();
    if (c === "[") return (at++, list("]"));
    if (c === "(") return (at++, list(")"));
    const word = /^[\w.-]+/.exec(text.slice(at, at + 64))?.[0] ?? "";
    at += word.length || 1;
    if (/^-?\d/.test(word)) return Number(word);
    space();
    if (text[at] === "(") {
      at++;
      const items = list(")");
      return word === "Some" ? items[0] : items;
    }
    if (text[at] === "{") {
      at++;
      const object: Record<string, unknown> = {};
      for (space(); text[at] !== "}" && at < text.length; space()) {
        const key = /^\w+/.exec(text.slice(at, at + 64))?.[0] ?? "";
        at += key.length + 1;
        object[key] = value();
        space();
        if (text[at] === ",") at++;
      }
      at++;
      return object;
    }
    return word === "None" ? null : word;
  }
  return value();
}

interface Line {
  text: string;
  more: string[];
}

const show = (text: string) => JSON.stringify(text);

interface Edit {
  range: [number, number];
  text: string;
}

const edit = (fix: Edit) => `[${fix.range[0]},${fix.range[1]}] ${show(fix.text)}`;

function lineOf(
  ruleId: string | null | undefined,
  messageId: string | null,
  message: string,
  start: [number, number],
  end: [number | null, number | null] | null,
  fix: Edit | null | undefined,
  suggestions: { id: string | null; desc: string; fix: Edit | null | undefined; output: string }[],
): Line {
  const where = `${start[0]}:${start[1]}` + (end && end[0] !== null ? `-${end[0]}:${end[1]}` : "");
  const from = ruleId === undefined || ruleId === null ? "" : ` <${ruleId || "linter"}>`;
  return {
    text: `${where}${from} [${messageId || ""}] ${message}`,
    more: [
      ...(fix ? [`    fix ${edit(fix)}`] : []),
      ...suggestions.map(
        it => `    suggestion [${it.id || ""}] ${it.desc}${it.fix ? ` ${edit(it.fix)}` : ""} -> ${show(it.output)}`,
      ),
    ],
  };
}

const expectedLines = (messages: FixtureMessage[]) =>
  messages.map(m =>
    lineOf(
      "ruleId" in m ? (m.ruleId ?? "") : undefined,
      m.messageId,
      m.message,
      [m.line, m.column],
      [m.endLine, m.endColumn],
      m.fix,
      m.suggestions.map(s => ({ id: s.messageId, desc: s.desc, fix: s.fix, output: s.output })),
    ),
  );

const actualLines = (reported: any[]) =>
  reported.map(m =>
    lineOf(
      m.rule_id,
      m.message_id,
      m.message,
      [m.line, m.column],
      m.end,
      m.fix,
      (m.suggestions ?? []).map((s: any) => ({ id: s.message_id, desc: s.desc, fix: s.fix, output: s.output })),
    ),
  );

/** `-` is what only ESLint reports, `+` what only we report. */
function diffLines(expected: Line[], actual: Line[]): string[] {
  const key = (line: Line) => [line.text, ...line.more].join("\n");
  const left = new Map<string, number>();
  for (const line of actual) left.set(key(line), (left.get(key(line)) ?? 0) + 1);
  const result: string[] = [];
  let same = 0;
  const onlyExpected: Line[] = [];
  for (const line of expected) {
    const n = left.get(key(line)) ?? 0;
    if (n > 0) (left.set(key(line), n - 1), same++);
    else onlyExpected.push(line);
  }
  for (const line of onlyExpected) result.push(`  - ${line.text}`, ...line.more.map(it => `  - ${it}`));
  for (const line of actual) {
    const n = left.get(key(line)) ?? 0;
    if (n === 0) continue;
    left.set(key(line), n - 1);
    result.push(`  + ${line.text}`, ...line.more.map(it => `  + ${it}`));
  }
  if (same > 0) result.push(`    (${same} more message(s) are equal)`);
  return result;
}

function describe(fixture: Fixture, index: number, problem: string): string {
  const it = fixture.cases[index];
  const language = it.languageOptions;
  const notes = [
    it.filename,
    language.parser,
    language.ecmaVersion !== "latest" && `ecmaVersion ${language.ecmaVersion}`,
    language.sourceType !== "module" && language.sourceType,
    it.tsconfig,
    language.globals && `globals ${JSON.stringify(language.globals)}`,
    it.settings && `settings ${JSON.stringify(it.settings)}`,
  ].filter(Boolean);
  const lines = [
    `──── ${fixture.plugin}/${fixture.rule} #${index}${it.name ? ` ${it.name}` : ""} (${notes.join(", ")})`,
  ];
  if (it.options.length > 0) lines.push(`  options: ${JSON.stringify(it.options)}`);
  lines.push(...it.code.split("\n").map(line => `  | ${line}`));
  const parts = /^(messages|output) differ(?:s)?\n  expected: ([^]*?)\n  actual: ([^]*)$/.exec(problem);
  if (!parts)
    lines.push(
      `  ours: ${problem}`,
      ...expectedLines(it.messages).flatMap(l => [`  - ${l.text}`, ...l.more.map(m => `  - ${m}`)]),
    );
  else if (parts[1] === "messages")
    lines.push(...diffLines(expectedLines(it.messages), actualLines(parseRustDebug(parts[3]) as any[])));
  else {
    const actual = parseRustDebug(parts[3]) as string | null;
    lines.push(`  the messages are equal, the output of the fixes is not:`);
    lines.push(
      `  - ${it.output === null ? "no fix" : show(it.output)}`,
      `  + ${actual === null ? "no fix" : show(actual)}`,
    );
  }
  return lines.join("\n") + "\n";
}

/** The failures in what `bun-lint [types] conformance --verbose` prints, by rule and index of the case. */
function failuresOf(stdout: string): Map<string, Map<number, string>> {
  const failures = new Map<string, Map<number, string>>();
  let current: Map<number, string> | undefined;
  const sections = stdout.split(/^(?=(?:ok  |FAIL) (?:eslint|typescript-eslint)\/[\w-]+: \d+ passed)/m);
  for (const section of sections) {
    const id = /^(?:ok  |FAIL) ([\w-]+\/[\w-]+): /.exec(section)?.[1];
    if (!id) continue;
    failures.set(id, (current = failures.get(id) ?? new Map()));
    for (const block of section.split(/^(?=──── case \d+ \((?:in)?valid\) )/m)) {
      const index = /^──── case (\d+) /.exec(block)?.[1];
      if (index === undefined) continue;
      const starts = [
        "messages differ\n",
        "output differs\n",
        "panicked\n",
        "the parser rejects the code\n",
        "the file is not part of the program\n",
      ];
      const start = Math.max(...starts.map(it => block.lastIndexOf("\n" + it)));
      // What follows the last block of the last rule is the summary.
      const problem = block.slice(start + 1).replace(/\n\n\d+ rules[^]*$/, "");
      current.set(Number(index), start < 0 ? "differs" : problem.trimEnd());
    }
  }
  return failures;
}

if (judge) {
  const only = written.length === 1 ? [`--rule=${written[0].rule}`] : [];
  const run = (args: string[]) => {
    const total = written.reduce((sum, it) => sum + it.cases.length, 0);
    const spawnOptions = { encoding: "utf8", maxBuffer: 1 << 30, timeout: 60_000 + 500 * total } as const;
    let result = spawnSync(judge, args, spawnOptions);
    // The binary is being replaced by a newer one.
    for (let i = 0; i < 20 && (result.error as { code?: string } | undefined)?.code === "ETXTBSY"; i++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      result = spawnSync(judge, args, spawnOptions);
    }
    if ((result.error as { code?: string } | undefined)?.code === "ETIMEDOUT") {
      console.log(`bun-lint ${args[0]} DID NOT FINISH: it hangs on one of the cases. Halve the file to find which.`);
      process.exitCode = 2;
    } else if (result.status !== 0)
      console.error(`${judge} ${args.join(" ")}: exit ${result.status ?? result.signal}\n${result.stderr}`);
    return failuresOf(result.stdout ?? "");
  };
  const comparable = (typed: boolean) => written.some(f => f.cases.some(c => !c.skip && c.typeAware === typed));
  const plain = comparable(false) ? run(["conformance", out, "--verbose", ...only]) : new Map();
  const typed = comparable(true)
    ? run(["types", "conformance", out, "--verbose", `--jobs=${typesJobs}`, ...only])
    : new Map();

  let cases = 0;
  let differ = 0;
  let skipped = 0;
  const differing: Record<string, number[]> = {};
  for (const fixture of written) {
    const id = `${fixture.plugin}/${fixture.rule}`;
    const ran = plain.has(id) || typed.has(id);
    const failures = new Map<number, string>([...(plain.get(id) ?? []), ...(typed.get(id) ?? [])]);
    const skips = fixture.cases.flatMap((c, i) =>
      c.skip ? [`  skipped #${i}: ${c.skip}: ${show(c.code.slice(0, 100))}`] : [],
    );
    const texts = [...failures]
      .sort((a, b) => a[0] - b[0])
      .map(([index, problem]) => describe(fixture, index, problem));
    cases += fixture.cases.length;
    skipped += skips.length;
    differ += failures.size;
    differing[id] = [...failures.keys()].sort((a, b) => a - b);
    if (!ran && skips.length < fixture.cases.length) {
      console.log(`${id}: bun-lint does not have the rule, or did not run`);
      process.exitCode = 2;
    }
    if (!quiet) {
      for (const text of texts) console.log(text);
      for (const skip of skips) console.log(skip);
    }
    if (written.length > 1)
      console.log(`${id}: ${fixture.cases.length} cases, ${failures.size} differ, ${skips.length} skipped`);
    if (diffDir) {
      const file = join(diffDir, fixture.plugin, `${fixture.rule}.txt`);
      if (texts.length === 0) rmSync(file, { force: true });
      else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, texts.join("\n"));
      }
    }
  }
  if (verdicts) writeFileSync(verdicts, JSON.stringify(differing));
  console.log(`${cases} cases, ${differ} differ, ${skipped} skipped`);
  if (differ > 0 && !process.exitCode) process.exitCode = 1;
}

// The TypeScript watch programs would keep the process alive.
process.exit();
