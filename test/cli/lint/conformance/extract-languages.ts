// Converts the rule tests of a plugin that has its own language (`@eslint/markdown`, `@eslint/json`, `@eslint/css`)
// into `fixtures/<plugin>/<rule>.json`, in the format that README.md describes. Each case records what the published
// plugin reports under real ESLint.
//
//   node extract-languages.ts --plugin markdown --tests <eslint/markdown at the tag of the package>/tests/rules
//        --packages <node_modules with eslint, @eslint/markdown and dedent> [--out <fixtures>] [<rule>..]
//   node extract-languages.ts --plugin markdown --packages <node_modules> --cases <cases.json> --out <dir>
//
// `--cases` takes your own inputs: an array of `{ rule, code, options?, language?, languageOptions?, filename? }`.
//
// A case differs from a JavaScript case in two fields: `language` is the file's language (`markdown/gfm`), and
// `languageOptions` has that language's options, exactly as in the config.

import { mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  compareWithUpstream,
  jsonPart,
  nullIfEmpty,
  onePassOutput,
  toFixtureMessages,
  toFixtureMeta,
  writeJson,
  type RuleModule,
} from "./shared.ts";

type Config = Record<string, any>;

const EXTENSIONS: Record<string, string> = { markdown: "md", json: "json", css: "css" };

let out = join(import.meta.dirname, "fixtures");
let plugin = "";
let tests = "";
let packages = "";
let casesFile: string | undefined;
const wanted: string[] = [];
for (let argv = process.argv.slice(2), i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") out = resolve(argv[++i]);
  else if (argv[i] === "--plugin") plugin = argv[++i];
  else if (argv[i] === "--tests") tests = realpathSync(argv[++i]);
  else if (argv[i] === "--packages") packages = realpathSync(argv[++i]);
  else if (argv[i] === "--cases") casesFile = resolve(argv[++i]);
  else wanted.push(argv[i]);
}
if (!(plugin in EXTENSIONS) || !packages || (!tests && !casesFile)) {
  console.error("see the first lines of this file");
  process.exit(1);
}

const requireFromPackages = createRequire(join(packages, "x.js"));
const eslintDir = join(packages, "eslint");
const { Linter, SourceCodeFixer } = requireFromPackages(join(eslintDir, "lib/linter/index.js"));
const { interpolate } = requireFromPackages(join(eslintDir, "lib/linter/interpolate.js"));
const dist = join(packages, "@eslint", plugin, "dist");
const published = (await import(pathToFileURL(join(dist, "index.js")).href)).default;

interface Run {
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
  run(_: string, __: RuleModule, cases: { valid?: (string | Config)[]; invalid?: Config[] }) {
    runs.push({ config: this.config, valid: cases.valid ?? [], invalid: cases.invalid ?? [] });
  }
}

// The tests import the plugin's sources, which aren't what's published, and ESLint's `RuleTester`. Redirect both.
(globalThis as any).__recordingEslint = { RuleTester: RecordingRuleTester, Linter };
const stub = "data:text/javascript,export const { RuleTester, Linter } = globalThis.__recordingEslint;";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "eslint") return { url: stub, shortCircuit: true };
    const source = /^(?:\.\.\/)+src\/(.*)$/.exec(specifier);
    if (source) return { url: pathToFileURL(join(dist, source[1])).href, shortCircuit: true };
    if (!/^[./]|^node:|^data:|^file:/.test(specifier) && context.parentURL?.startsWith(pathToFileURL(tests).href)) {
      return next(specifier, { ...context, parentURL: pathToFileURL(join(packages, "x.js")).href });
    }
    return next(specifier, context);
  },
});
// The only tests outside a `RuleTester` are timing tests, so skip them.
Object.assign(globalThis, { describe: (_: string, body: () => void) => body(), it: () => {} });

interface Raw {
  valid: boolean;
  name: string | null;
  code: string;
  options: unknown[];
  filename?: string;
  language: string;
  languageOptions: Config;
  upstream?: Config;
}

async function casesOf(rule: string): Promise<Raw[]> {
  runs.length = 0;
  await import(pathToFileURL(join(tests, `${rule}.test.js`)).href);
  const cases: Raw[] = [];
  for (const valid of [true, false]) {
    for (const run of runs) {
      for (const written of valid ? run.valid : run.invalid) {
        const item: Config = typeof written === "string" ? { code: written } : written;
        cases.push({
          valid,
          name: item.name ?? null,
          code: item.code,
          options: item.options ?? [],
          filename: item.filename,
          language: item.language ?? run.config.language,
          languageOptions: { ...run.config.languageOptions, ...item.languageOptions },
          upstream: item,
        });
      }
    }
  }
  return cases;
}

function lint(rule: string, it: Raw) {
  const id = `${plugin}/${rule}`;
  const filename = it.filename ?? `file.${EXTENSIONS[plugin]}`;
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(
    it.code,
    [
      {
        files: ["**"],
        plugins: { [plugin]: published },
        language: it.language,
        languageOptions: it.languageOptions,
        linterOptions: { reportUnusedDisableDirectives: "off" },
        rules: { [id]: ["error", ...it.options] },
      },
    ],
    filename,
  );
  const fatal = messages.find((message: Config) => message.fatal);
  const dropped: string[] = [];
  return {
    valid: it.valid,
    name: it.name,
    code: it.code,
    filename,
    options: jsonPart(it.options, dropped, "options"),
    language: it.language,
    languageOptions: nullIfEmpty(jsonPart(it.languageOptions, dropped, "languageOptions") as Config),
    skip:
      dropped.length > 0
        ? `not JSON-serializable: ${dropped.join(", ")}`
        : it.code.isWellFormed()
          ? null
          : "half of a surrogate pair",
    fatal: fatal ? true : undefined,
    messages: toFixtureMessages(it.code, messages, id, SourceCodeFixer),
    output: onePassOutput(it.code, messages, SourceCodeFixer),
  };
}

const own: (Config & { rule: string })[] | null = casesFile ? JSON.parse(readFileSync(casesFile, "utf8")) : null;
const all = own
  ? [...new Set(own.map(it => it.rule))]
  : readdirSync(tests)
      .filter(name => name.endsWith(".test.js"))
      .map(name => basename(name, ".test.js"));
mkdirSync(join(out, plugin), { recursive: true });
let [count, disagreements] = [0, 0];
for (const rule of all.sort()) {
  if (wanted.length > 0 && !wanted.includes(rule)) continue;
  const module: RuleModule = published.rules[rule];
  const raw: Raw[] = own
    ? own
        .filter(it => it.rule === rule)
        .map(it => ({
          valid: false,
          name: it.name ?? null,
          code: it.code,
          options: it.options ?? [],
          filename: it.filename,
          language: it.language ?? Object.keys(published.languages).map(name => `${plugin}/${name}`)[0],
          languageOptions: it.languageOptions ?? {},
        }))
    : await casesOf(rule);
  const cases = raw.map((it, index) => {
    const result = lint(rule, it);
    if (own) result.valid = result.messages.length === 0;
    for (const problem of it.upstream
      ? compareWithUpstream(it.upstream as any, it.valid, result, module, interpolate)
      : []) {
      disagreements++;
      console.error(`${plugin}/${rule} #${index}: ${problem}`);
    }
    return result;
  });
  count += cases.length;
  writeJson(join(out, plugin, `${rule}.json`), { plugin, rule, meta: toFixtureMeta(module), cases });
}
console.error(`${count} cases, ${disagreements} that upstream expects something else of`);
