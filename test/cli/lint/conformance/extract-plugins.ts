// Turns the tests of the rules of other plugins into `fixtures/<plugin>/<rule>.json`, in the format of README.md, with what the
// real plugin reports under the real ESLint.
//
//   export ESLINT_DIR=<eslint> TYPESCRIPT_ESLINT_DIR=<typescript-eslint, built> OXC_DIR=<oxc> OXLINT_BIN=<oxlint>
//   export REACT_DIR=<facebook/react> ESLINT_PLUGIN_IMPORT_DIR=<import-js/eslint-plugin-import, installed>
//   export ESLINT_PLUGIN_IMPORT_X_DIR=<un-ts/eslint-plugin-import-x> ESLINT_PLUGIN_N_DIR=<eslint-community/eslint-plugin-n, installed>
//   node extract-plugins.ts [--out <fixtures>] [<plugin>/<rule>..]
//   node extract-plugins.ts --cases <cases.json> --out <dir> <plugin>/<rule>     # your own inputs, see `extra-cases.ts`
//
// The cases of a rule, the valid ones first:
// 1. The tests of the plugin itself. Its `RuleTester` is replaced by one that records.
// 2. `import`: the tests that eslint-plugin-import-x has for the same rule.
// 3. The tests that oxlint has for its port of the rule (`name` says where a case is from). What oxlint expects is not used.
//
// There are two parsers here, espree and that of typescript-eslint. What upstream tests with a parser of Babel or with an old
// typescript-eslint is linted with espree, with JSX, and again as `file.tsx` with typescript-eslint, which is how most code that
// these rules see is parsed. What neither can parse (Flow) is skipped.
//
// `oxc/*` has no ESLint plugin: the oracle is the binary of oxlint. A message is at the primary label of its diagnostic, or at the
// first, which is also where oxlint looks for a comment that disables the rule.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  compareWithUpstream,
  jsonPart,
  nullIfEmpty,
  onePassOutput,
  requiredEnv,
  toFixtureMessages,
  toFixtureMeta,
  writeJson,
  type FixtureCase,
  type FixtureMeta,
  type LintMessage,
  type RuleModule,
} from "./shared.ts";

type Config = Record<string, any>;

/** A case before it is linted. */
interface Raw {
  valid: boolean;
  name: string | null;
  code: string;
  options?: unknown[];
  filename?: string;
  settings?: Config;
  /** `ecmaVersion`, `sourceType`, `globals`, `parserOptions`, and `parser`: "espree" or "typescript". */
  languageOptions?: Config;
  /** What upstream parses it with, if that is neither. */
  foreignParser?: string;
  /** The case as upstream has it, to compare with what it asserts. */
  upstream?: Config;
}

const ALL = [
  "react-hooks/rules-of-hooks",
  "react-hooks/exhaustive-deps",
  "oxc/no-accumulating-spread",
  "import/no-mutable-exports",
  "import/no-cycle",
  "n/no-unsupported-features/es-builtins",
  "n/no-unsupported-features/es-syntax",
  "n/no-unsupported-features/node-builtins",
];

let out = join(import.meta.dirname, "fixtures");
let casesFile: string | undefined;
const wanted: string[] = [];
for (let argv = process.argv.slice(2), i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") out = resolve(argv[++i]);
  else if (argv[i] === "--cases") casesFile = resolve(argv[++i]);
  else wanted.push(argv[i]);
}

const eslintDir = realpathSync(requiredEnv("ESLINT_DIR"));
const requireFromEslint = createRequire(join(eslintDir, "package.json"));
const { Linter, SourceCodeFixer } = requireFromEslint("./lib/linter");
const { interpolate } = requireFromEslint("./lib/linter/interpolate");
const espree = requireFromEslint("espree");
const typescriptParser = requireFromEslint("@typescript-eslint/parser");
const scratch = mkdtempSync(join(tmpdir(), "extract-plugins-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Loading upstream's tests
// ---------------------------------------------------------------------------

interface Run {
  title: string;
  rule: RuleModule;
  config: Config;
  valid: (string | Config)[];
  invalid: Config[];
}

const runs: Run[] = [];

class RecordingRuleTester {
  config: Config;
  constructor(config: Config = {}) {
    this.config = config;
  }
  static setDefaultConfig() {}
  static describe: unknown;
  static it: unknown;
  static itOnly: unknown;
  run(title: string, rule: RuleModule, tests: { valid: (string | Config)[]; invalid: Config[] }) {
    runs.push({ title, rule, config: this.config, valid: tests.valid ?? [], invalid: tests.invalid ?? [] });
  }
}

/** Loads the CommonJS module `file` with `stubs` in place of the modules of these names. */
function requireWithStubs(file: string, stubs: Record<string, unknown>, globals: Record<string, unknown> = {}): unknown {
  const module = Module as any;
  const [load, resolveFilename] = [module._load, module._resolveFilename];
  module._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request in stubs ? `stub:${request}` : resolveFilename.call(this, request, ...rest);
  };
  module._load = function (request: string, ...rest: unknown[]) {
    const name = request.replace(/^stub:/, "");
    return name in stubs ? stubs[name] : load.call(this, request, ...rest);
  };
  const run = (_: string, body: () => void) => body();
  Object.assign(globalThis, { describe: run, context: run, it: () => {}, before: () => {}, after: () => {}, ...globals });
  try {
    return createRequire(file)(file);
  } finally {
    module._load = load;
    module._resolveFilename = resolveFilename;
  }
}

/** Bundles a module, which may be TypeScript, into one CommonJS file. `directory`: where to, if it has to find packages. */
function bundleFile(entry: string, name: string, directory = scratch): string {
  const file = join(directory, `${name}.cjs`);
  const packages = directory === scratch ? ["--external=eslint"] : ["--packages=external"];
  execFileSync("bun", ["build", entry, "--target=node", "--format=cjs", `--outfile=${file}`, ...packages], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  return file;
}

function bundle(entry: string, name: string, directory?: string): any {
  const file = bundleFile(entry, name, directory);
  return createRequire(file)(file);
}

// ---------------------------------------------------------------------------
// react-hooks
// ---------------------------------------------------------------------------

function reactHooks(rule: string): { rule: RuleModule; cases: Raw[] } {
  const root = join(realpathSync(requiredEnv("REACT_DIR")), "packages/eslint-plugin-react-hooks");
  const [source, test] =
    rule === "rules-of-hooks" ? ["RulesOfHooks", "ESLintRulesOfHooks"] : ["ExhaustiveDeps", "ESLintRuleExhaustiveDeps"];
  const module: RuleModule = bundle(join(root, `src/rules/${source}.ts`), source).default;
  if (casesFile) return { rule: module, cases: [] };
  const parser = (name: string) => ({ foreignParser: name });
  runs.length = 0;
  requireWithStubs(
    join(root, `__tests__/${test}-test.js`),
    {
      "eslint-v7": { RuleTester: RecordingRuleTester },
      "eslint-v9": { RuleTester: RecordingRuleTester },
      "eslint-plugin-react-hooks": { default: { rules: { [rule]: module } } },
      "babel-eslint": parser("babel"),
      "@babel/eslint-parser": parser("babel"),
      "hermes-eslint": parser("hermes"),
      "@typescript-eslint/parser-v2": parser("typescript"),
      "@typescript-eslint/parser-v3": parser("typescript"),
      "@typescript-eslint/parser-v4": parser("typescript"),
      "@typescript-eslint/parser-v5": parser("typescript"),
    },
    { __EXPERIMENTAL__: true },
  );
  // The parsers that a case is tested with, by the object that it is.
  const parsers = new Map<Config, { valid: boolean; parsers: Set<string> }>();
  for (const run of runs) {
    const name: string | undefined = run.config.languageOptions?.parser?.foreignParser;
    // The runs with ESLint 7 have the same cases.
    if (!name) continue;
    for (const valid of [true, false]) {
      for (const item of valid ? run.valid : run.invalid) {
        if (typeof item === "string") throw new Error("a case that is a string");
        if (!parsers.has(item)) parsers.set(item, { valid, parsers: new Set() });
        parsers.get(item)!.parsers.add(name);
      }
    }
  }
  const cases: Raw[] = [];
  for (const [item, { valid, parsers: names }] of parsers) {
    const base = { valid, code: item.code, options: item.options, settings: item.settings, upstream: item };
    if (names.has("babel")) {
      cases.push({ ...base, name: item.name ?? null });
      cases.push({ ...base, name: "with the parser of typescript-eslint", languageOptions: { parser: "typescript" } });
    } else if (names.has("typescript")) {
      cases.push({ ...base, name: item.name ?? null, languageOptions: { parser: "typescript" } });
    } else {
      cases.push({ ...base, name: item.name ?? null, foreignParser: "hermes-eslint" });
    }
  }
  return { rule: module, cases };
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

/** What `flatConfigs.typescript` of the plugin sets, without which it does not look into TypeScript. */
const IMPORT_TYPESCRIPT_SETTINGS = {
  "import/extensions": [".ts", ".cts", ".mts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  "import/external-module-folders": ["node_modules", "node_modules/@types"],
  "import/parsers": { "@typescript-eslint/parser": [".ts", ".cts", ".mts", ".tsx"] },
  "import/resolver": { node: { extensions: [".ts", ".cts", ".mts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] } },
};

/** The files that the cases of `import/*` are, and that they import. */
function copyImportProject(): string {
  const project = join(out, "import-project");
  if (casesFile) return join(import.meta.dirname, "fixtures/import-project");
  const files = join(realpathSync(requiredEnv("ESLINT_PLUGIN_IMPORT_DIR")), "tests/files");
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  for (const name of ["cycles", "bar.js", "package.json"]) cpSync(join(files, name), join(project, name), { recursive: true });
  const ofOxlint = join(realpathSync(requiredEnv("OXC_DIR")), "crates/oxc_linter/fixtures/import/cycles");
  for (const name of ["typescript", "issue_21252"]) cpSync(join(ofOxlint, name), join(project, "cycles", name), { recursive: true });
  return project;
}

function importPlugin(rule: string): { rule: RuleModule; cases: Raw[]; cwd: string } {
  const root = realpathSync(requiredEnv("ESLINT_PLUGIN_IMPORT_DIR"));
  const built = join(root, "node_modules/.extract-plugins");
  mkdirSync(built, { recursive: true });
  const module: RuleModule = bundle(join(root, `src/rules/${rule}.js`), rule, built);
  const cwd = copyImportProject();
  if (casesFile) return { rule: module, cases: [], cwd };
  const parser = (name: string) => ({ foreignParser: name });
  runs.length = 0;
  const before = process.cwd();
  process.chdir(root);
  try {
    requireWithStubs(bundleFile(join(root, `tests/src/rules/${rule}.js`), `${rule}.test`, built), {
      // With a parser of Babel for every version: see `tests/src/utils.js`.
      "eslint/package.json": { version: "9.99.0" },
      eslint: { RuleTester: RecordingRuleTester },
      "typescript/package.json": { version: "5.9.0" },
      "@typescript-eslint/parser/package.json": { version: "8.71.1" },
      [`rules/${rule}`]: module,
      espree: parser("espree"),
      "babel-eslint": parser("babel"),
      "@babel/eslint-parser": parser("babel"),
      "@typescript-eslint/parser": parser("typescript"),
    });
  } finally {
    process.chdir(before);
  }
  const files = join(root, "tests/files");
  const cases: Raw[] = [];
  for (const run of runs) {
    for (const valid of [true, false]) {
      for (const item of valid ? run.valid : run.invalid) {
        if (typeof item === "string") throw new Error("a case that is a string");
        const { parser: used, ...languageOptions } = { ...run.config.languageOptions, ...item.languageOptions };
        const name: string = used?.foreignParser ?? "espree";
        // The options for Babel, and a version that only espree looks at.
        if (name === "babel") (delete languageOptions.parserOptions, delete languageOptions.ecmaVersion);
        cases.push({
          valid,
          name: item.name ?? null,
          code: item.code,
          options: item.options,
          filename: isAbsolute(item.filename) ? relative(files, item.filename) : item.filename,
          settings: item.settings,
          languageOptions: { ...languageOptions, parser: name === "typescript" ? "typescript" : "espree" },
          foreignParser: name === "babel" ? "babel-eslint" : undefined,
          upstream: item,
        });
      }
    }
  }
  return { rule: module, cases, cwd };
}

/** oxlint's `change_rule_path(..)`, by the line of the case. */
function importCasesOfOxlint(rule: string): Raw[] {
  const path = `import/${rule.replaceAll("-", "_")}.rs`;
  const source = readFileSync(join(realpathSync(requiredEnv("OXC_DIR")), "crates/oxc_linter/src/rules", path), "utf8");
  const paths = [...source.matchAll(/\.change_rule_path\("([^"]+)"\)/g)].map(it => ({
    line: source.slice(0, it.index).split("\n").length,
    path: it[1],
  }));
  // Nothing can judge what only oxlint can be told to do.
  const judged = oxlintCases(path).filter(it => (it.options?.[0] as Config | undefined)?.ignoreTypes !== false);
  return judged.map(it => {
    const line = Number(/:(\d+) /.exec(it.name!)![1]);
    return {
      ...it,
      filename: paths.find(it => it.line > line)?.path ?? "foo.js",
      settings: rule === "no-cycle" ? IMPORT_TYPESCRIPT_SETTINGS : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// n
// ---------------------------------------------------------------------------

/** The directories with a `package.json` that says which versions of Node.js are supported. */
function copyNodeProject(root: string): string {
  const project = join(out, "n-project");
  if (casesFile) return join(import.meta.dirname, "fixtures/n-project");
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  for (const name of ["no-unsupported-features--ecma", "no-unsupported-features"]) {
    cpSync(join(root, "tests/fixtures", name), join(project, name), { recursive: true });
  }
  return project;
}

function nodePlugin(rule: string): { rule: RuleModule; cases: Raw[]; cwd: string } {
  const root = realpathSync(requiredEnv("ESLINT_PLUGIN_N_DIR"));
  const cwd = copyNodeProject(root);
  // Next to the test, which looks for its fixtures from where it is.
  const directory = join(root, "tests/lib/rules", dirname(rule));
  const name = rule.slice(rule.indexOf("/") + 1);
  runs.length = 0;
  const globals = createRequire(join(root, "package.json"))("globals");
  /** `RuleTester` of `tests/test-helpers.js` */
  class NodeRuleTester extends RecordingRuleTester {
    constructor(config: Config = { languageOptions: {} }) {
      const { env, ...languageOptions } = config.languageOptions;
      if (env?.node === false) languageOptions.globals ??= {};
      const defaults = { ecmaVersion: 6, sourceType: "commonjs", globals: { ...globals.es2015, ...globals.node } };
      super({ ...config, languageOptions: { ...defaults, ...languageOptions } });
    }
    run(title: string, rule: RuleModule, tests: { valid: (string | Config)[]; invalid: Config[] }) {
      const isRun = (item: string | Config) => typeof item === "string" || !item.skip;
      super.run(title, rule, { valid: tests.valid.filter(isRun), invalid: tests.invalid.filter(isRun) });
    }
  }
  requireWithStubs(bundleFile(join(directory, `${name}.js`), `.extract-${name}`, directory), {
    "#test-helpers": { RuleTester: NodeRuleTester },
    // For a test that imports the file of the helpers.
    eslint: { RuleTester: RecordingRuleTester },
    "eslint/package.json": { version: requireFromEslint("./package.json").version },
    "eslint/use-at-your-own-risk": {},
    "@typescript-eslint/parser": { foreignParser: "typescript" },
  });
  const module = runs[0].rule;
  if (casesFile) return { rule: module, cases: [], cwd };
  const fixtures = join(root, "tests/fixtures");
  const cases: Raw[] = [];
  for (const run of runs) {
    for (const valid of [true, false]) {
      for (const given of valid ? run.valid : run.invalid) {
        const item = typeof given === "string" ? { code: given } : given;
        const { parser, ...languageOptions } = { ...run.config.languageOptions, ...item.languageOptions };
        cases.push({
          valid,
          name: item.name ?? null,
          code: item.code,
          options: item.options,
          filename: item.filename && isAbsolute(item.filename) ? relative(fixtures, item.filename) : item.filename,
          settings: item.settings,
          languageOptions: { ...languageOptions, parser: parser ? "typescript" : "espree" },
          upstream: item,
        });
      }
    }
  }
  return { rule: module, cases, cwd };
}

// ---------------------------------------------------------------------------
// The tests of oxlint
// ---------------------------------------------------------------------------

function oxlintCases(path: string): Raw[] {
  const root = join(realpathSync(requiredEnv("OXC_DIR")), "crates/oxc_linter/src/rules");
  // That module needs more of TypeScript than Node.js strips.
  const program = `
    import { casesOfFile } from ${JSON.stringify(join(import.meta.dirname, "extract-oxc.ts"))};
    const stats = { parsed: 0, unparsed: 0, upstream: 0, duplicates: 0, kept: 0 };
    const cases = casesOfFile(await Bun.file(process.argv[1]).text(), process.argv[2], {}, stats, false);
    console.log(JSON.stringify({ cases, stats }));`;
  const printed = execFileSync("bun", ["-e", program, join(root, path), path], { encoding: "utf8", maxBuffer: 1 << 28 });
  const { cases, stats }: { cases: Config[]; stats: { unparsed: number } } = JSON.parse(printed);
  if (stats.unparsed > 0) console.error(`${path}: ${stats.unparsed} cases cannot be read`);
  return cases.map(it => ({ ...it, code: it.code, name: it.name ?? null, valid: / pass$/.test(it.name ?? "") }));
}

// ---------------------------------------------------------------------------
// Linting
// ---------------------------------------------------------------------------

// From the root, so that a file is configured wherever it is.
const linter = new Linter({ configType: "flat", cwd: "/" });

interface Attempt {
  parser: "espree" | "typescript";
  filename: string;
  jsx: boolean;
}

function attempts(raw: Raw): Attempt[] {
  const parser = raw.languageOptions?.parser;
  const jsx = raw.languageOptions?.parserOptions?.ecmaFeatures?.jsx;
  if (raw.filename) {
    const isTypeScript = parser ? parser === "typescript" : /\.[cm]?tsx?$/.test(raw.filename);
    return [{ parser: isTypeScript ? "typescript" : "espree", filename: raw.filename, jsx: jsx ?? !isTypeScript }];
  }
  const typescript: Attempt[] = [
    { parser: "typescript", filename: "file.tsx", jsx: true },
    { parser: "typescript", filename: "file.ts", jsx: false },
  ];
  if (parser === "typescript") return typescript;
  const first: Attempt = { parser: "espree", filename: jsx === false ? "file.js" : "file.jsx", jsx: jsx ?? true };
  return parser === "espree" ? [first] : [first, ...typescript];
}

/** eslint-plugin-import loads the parsers in `import/parsers` by their names, from where it is. */
function settingsToLintWith(settings: Config): Config {
  const parsers = settings["import/parsers"];
  if (!parsers?.["@typescript-eslint/parser"]) return settings;
  const { "@typescript-eslint/parser": extensions, ...others } = parsers;
  return { ...settings, "import/parsers": { ...others, [requireFromEslint.resolve("@typescript-eslint/parser")]: extensions } };
}

/** `ignoreTypes` is an option of oxlint. What it turns on is what eslint-plugin-import always does. */
function optionsToLintWith(id: string, options: unknown[]): unknown[] {
  if (id !== "import/no-cycle" || (options[0] as Config | undefined)?.ignoreTypes !== true) return options;
  const { ignoreTypes: _, ...others } = options[0] as Config;
  return [others];
}

function record(id: string, rule: RuleModule, raw: Raw, cwd?: string): FixtureCase {
  const slash = id.indexOf("/");
  const [prefix, name] = [id.slice(0, slash), id.slice(slash + 1)];
  const options = raw.options ?? [];
  const given = raw.languageOptions ?? {};
  let last: { attempt: Attempt; messages: LintMessage[]; parserOptions: Config } | undefined;
  for (const attempt of attempts(raw)) {
    const parserOptions = { ...given.parserOptions, ecmaFeatures: { ...given.parserOptions?.ecmaFeatures, jsx: attempt.jsx } };
    const config = {
      files: ["**"],
      plugins: { [prefix]: { rules: { [name]: rule } } },
      languageOptions: {
        parser: attempt.parser === "espree" ? espree : typescriptParser,
        ecmaVersion: given.ecmaVersion ?? "latest",
        sourceType: given.sourceType ?? "module",
        globals: given.globals ?? {},
        parserOptions,
      },
      settings: settingsToLintWith(raw.settings ?? {}),
      linterOptions: { reportUnusedDisableDirectives: "off" },
      rules: { [id]: ["error", ...optionsToLintWith(id, options)] },
    };
    const filename = cwd && !attempt.filename.startsWith("<") ? resolve(cwd, attempt.filename) : attempt.filename;
    const messages: LintMessage[] = linter.verify(raw.code, [config], { filename });
    last = { attempt, messages, parserOptions };
    if (!messages.some(it => it.fatal)) break;
  }
  const { attempt, messages, parserOptions } = last!;
  const fatal = messages.find(it => it.fatal);
  let skip: string | null = null;
  if (fatal) skip = raw.foreignParser ? `parser: ${raw.foreignParser}` : `fatal: ${fatal.message}`;
  const resolver = raw.settings?.["import/resolver"];
  const isNode = resolver === undefined || resolver === "node" || (typeof resolver === "object" && Object.keys(resolver).join() === "node");
  if (!isNode) skip ??= `resolver: ${JSON.stringify(resolver)}`;
  const dropped: string[] = [];
  const jsonOptions = jsonPart(options, dropped, "options") as unknown[];
  const settings = jsonPart(raw.settings ?? {}, dropped, "settings") as Config;
  if (dropped.length > 0) skip ??= `not JSON-serializable: ${dropped.join(", ")}`;
  return {
    valid: raw.valid,
    name: raw.name,
    code: raw.code,
    filename: attempt.filename,
    options: jsonOptions,
    languageOptions: {
      parser: attempt.parser,
      ecmaVersion: given.ecmaVersion ?? "latest",
      sourceType: given.sourceType ?? "module",
      globals: nullIfEmpty(given.globals),
      parserOptions: nullIfEmpty(jsonPart(parserOptions) as Config),
    },
    settings: nullIfEmpty(settings),
    typeAware: false,
    tsconfig: null,
    skip,
    messages: toFixtureMessages(raw.code, messages, id, SourceCodeFixer),
    output: onePassOutput(raw.code, messages, SourceCodeFixer),
  };
}

// ---------------------------------------------------------------------------
// oxc: the binary of oxlint is the oracle
// ---------------------------------------------------------------------------

/** The id of a message, from the text that the functions in the source of the rule give their diagnostics. */
const OXC_MESSAGES: Record<string, Record<string, string>> = {
  "no-accumulating-spread": {
    reduceSpread: "Do not spread accumulators in Array.prototype.reduce()",
    loopSpread: "Do not spread accumulators in loops",
  },
};

function recordWithOxlint(rule: string, raws: Raw[]): FixtureCase[] {
  const bin = requiredEnv("OXLINT_BIN");
  const directory = join(scratch, "oxlint");
  mkdirSync(directory, { recursive: true });
  const config = join(directory, "oxlintrc.json");
  const ids = Object.entries(OXC_MESSAGES[rule]);
  return raws.map((raw, index) => {
    const filename = raw.filename ?? "file.tsx";
    const file = join(directory, `${index}-${filename}`);
    writeFileSync(file, raw.code);
    writeFileSync(
      config,
      JSON.stringify({ plugins: ["oxc"], categories: { correctness: "off" }, rules: { [`oxc/${rule}`]: ["error", ...(raw.options ?? [])] } }),
    );
    let text: string;
    try {
      text = execFileSync(bin, ["-c", config, "-f", "json", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch (error: any) {
      text = error.stdout;
    }
    const bytes = Buffer.from(raw.code);
    const position = (offset: number) => {
      const before = bytes.subarray(0, offset).toString("utf8");
      const lines = before.split(/\r\n|[\r\n\u2028\u2029]/);
      return { line: lines.length, column: lines.at(-1)!.length + 1 };
    };
    const diagnostics: any[] = JSON.parse(text).diagnostics;
    const fatal = diagnostics.find(it => !it.code?.startsWith("oxc("));
    const messages = diagnostics
      .filter(it => it.code?.startsWith("oxc("))
      .map(it => {
        const labels = it.labels.map((label: any) => {
          const [start, end] = [position(label.span.offset), position(label.span.offset + label.span.length)];
          return { line: start.line, column: start.column, endLine: end.line, endColumn: end.column, label: label.label ?? null };
        });
        const id = ids.find(([, message]) => message === it.message)?.[0];
        if (!id) throw new Error(`no id for: ${it.message}`);
        // The primary label, which the output does not mark.
        // Where oxlint prints it.
        const { label: _, ...at } = labels[0];
        return { messageId: id, message: it.message, ...at, fix: null, suggestions: [], oxlint: { labels, help: it.help ?? null } };
      })
      .sort((a, b) => a.line - b.line || a.column - b.column);
    return {
      valid: raw.valid,
      name: raw.name,
      code: raw.code,
      filename,
      options: raw.options ?? [],
      languageOptions: {
        parser: /\.[cm]?tsx?$/.test(filename) ? "typescript" : "espree",
        ecmaVersion: "latest",
        sourceType: "module",
        globals: null,
        parserOptions: /x$/.test(filename) ? { ecmaFeatures: { jsx: true } } : null,
      },
      settings: null,
      typeAware: false,
      tsconfig: null,
      skip: fatal ? `fatal: ${fatal.message}` : null,
      messages,
      output: null,
    } satisfies FixtureCase;
  });
}

// ---------------------------------------------------------------------------

function ownCases(): Raw[] {
  const given: (string | Config)[] | { cases: Config[] } = JSON.parse(readFileSync(casesFile!, "utf8"));
  return (Array.isArray(given) ? given : given.cases).map(it => {
    const item = typeof it === "string" ? { code: it } : it;
    const { code, options, filename, settings, languageOptions, name } = item;
    return { valid: true, name: name ?? null, code, options, filename, settings: settings ?? undefined, languageOptions: languageOptions ?? undefined };
  });
}

function unique(cases: Raw[]): Raw[] {
  const seen = new Set<string>();
  return cases.filter(it => {
    const key = JSON.stringify([it.code, it.options ?? [], it.filename, it.settings ?? {}, it.languageOptions ?? {}]);
    return !seen.has(key) && seen.add(key);
  });
}

for (const id of wanted.length > 0 ? wanted : ALL) {
  const slash = id.indexOf("/");
  const [plugin, name] = [id.slice(0, slash), id.slice(slash + 1)];
  let meta: FixtureMeta;
  let cases: FixtureCase[];
  const disagreements: string[] = [];
  if (plugin === "oxc") {
    const raws = casesFile ? ownCases() : oxlintCases(`oxc/${name.replaceAll("-", "_")}.rs`);
    cases = recordWithOxlint(name, unique(raws));
    meta = { ...toFixtureMeta({ create() {} }), type: "suggestion", messages: OXC_MESSAGES[name], schema: [] };
  } else {
    let loaded: { rule: RuleModule; cases: Raw[]; cwd?: string };
    if (plugin === "react-hooks") {
      loaded = reactHooks(name);
      if (!casesFile) loaded.cases.push(...oxlintCases(`react/${name.replaceAll("-", "_")}.rs`));
    } else if (plugin === "import") {
      loaded = importPlugin(name);
      if (!casesFile) loaded.cases.push(...importCasesOfOxlint(name));
    } else if (plugin === "n") {
      loaded = nodePlugin(name);
    } else {
      throw new Error(`unknown: ${id}`);
    }
    const raws = unique(casesFile ? ownCases() : loaded.cases);
    raws.sort((a, b) => Number(b.valid) - Number(a.valid));
    cases = raws.map((raw, index) => {
      const made = record(id, loaded.rule, raw, loaded.cwd);
      if (raw.upstream && !made.skip) {
        const problems = compareWithUpstream(raw.upstream as any, raw.valid, made, loaded.rule, interpolate);
        // The files that it imports are Flow.
        if (problems.length > 0 && raw.foreignParser) made.skip = `parser: ${raw.foreignParser}`;
        else if (problems.length > 0) disagreements.push(`#${index}: ${problems.join("; ")}`);
      }
      // ESLint is the judge of what oxlint tests.
      if (!raw.upstream) made.valid = made.messages.length === 0;
      return made;
    });
    if (!casesFile) cases.sort((a, b) => Number(b.valid) - Number(a.valid));
    meta = toFixtureMeta(loaded.rule);
  }
  const file = join(out, plugin, `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, { plugin, rule: name, meta, cases });
  const skipped = cases.filter(it => it.skip).length;
  console.log(`${id}: ${cases.length} cases, ${skipped} skipped, ${disagreements.length} disagree with what upstream asserts`);
  for (const line of disagreements) console.log(`  ${line}`);
}
