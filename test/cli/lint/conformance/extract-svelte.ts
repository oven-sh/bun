// Records eslint-plugin-svelte's rule tests into `<out>/svelte/<rule>.json`, in README.md's format, with what the
// published plugin reports under real ESLint.
//
//   node extract-svelte.ts --tests <eslint-plugin-svelte at the package's tag>/packages/eslint-plugin-svelte
//        --packages <node_modules with eslint, eslint-plugin-svelte, svelte-eslint-parser, svelte, @typescript-eslint/parser,
//        typescript, globals, semver and yaml> --out <directory> <rule>..
//   ESLINT_PLUGIN_SVELTE_DIR=<the checkout> bun sync.ts --svelte <directory>
//
// The test files are loaded with their `RuleTester` replaced by a recording one, and with the plugin's sources replaced
// by the published ones. Each case is linted from the plugin's `tests/`, the way upstream lints it: as `filename`, with
// the `svelte.config.js` and `package.json` above it. A case is a component, linted the way `bun lint` lints one with
// svelte-eslint-parser. Its `filename` is relative to the plugin, its `languageOptions.parser` is
// `"svelte-eslint-parser"`, and `globals` are written out. `parserOptions.project` is left out, so the cases are linted
// without types. Besides `messages`, a case has `suppressed`, the messages that comments suppress, and `output` is the
// code after all `--fix` passes, or `null`. Each message has its `severity`. A rule goes into the bundle when the
// native rule passes all its cases.
//
// `<out>/svelte-project/` is the plugin's directory as the rules see it: an `eslint-plugin-svelte` `package.json`,
// which SvelteKit's rules treat as SvelteKit 2, each case as a file, and the `svelte.config.js` files next to them. The
// cases are linted as its files, where the runner has projects.

import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareWithUpstream, jsonPart, toFixtureMeta, writeJson, type RuleModule } from "./shared.ts";

type Config = Record<string, any>;

let out = "";
let tests = "";
let packages = "";
const rules: string[] = [];
for (let argv = process.argv.slice(2), i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") out = resolve(argv[++i]);
  else if (argv[i] === "--tests") tests = realpathSync(argv[++i]);
  else if (argv[i] === "--packages") packages = realpathSync(argv[++i]);
  else rules.push(argv[i]);
}
if (!out || !tests || !packages || !rules.length) {
  console.error("see the first lines of this file");
  process.exit(1);
}

const requireFromPackages = createRequire(join(packages, "x.js"));
const { Linter } = requireFromPackages("eslint");
const { interpolate } = requireFromPackages(join(packages, "eslint/lib/linter/interpolate.js"));
const lib = dirname(requireFromPackages.resolve("eslint-plugin-svelte"));
const published = (await import(pathToFileURL(join(lib, "index.js")).href)).default;

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

// The tests import the plugin's sources, which aren't what's published, ESLint's `RuleTester`, and a formatter that writes
// missing expectations. Redirect all three. Their imports name `.js` files that are `.ts` files, or no extension at all.
(globalThis as any).__recordingSvelte = { RuleTester: RecordingRuleTester };
const stub = (exports: string) => `data:text/javascript,${encodeURIComponent(exports)}`;
const testsUrl = pathToFileURL(tests).href;
registerHooks({
  resolve(specifier, context, next) {
    if (/\/utils\/eslint-compat(\.js)?$/.test(specifier)) {
      return { url: stub("export const { RuleTester } = globalThis.__recordingSvelte;"), shortCircuit: true };
    }
    if (/\/tools\/lib\/write(\.js)?$/.test(specifier)) {
      return { url: stub("export function writeAndFormat() {}"), shortCircuit: true };
    }
    const source = /^(?:\.\.\/)+src\/(.*?)(?:\.js)?$/.exec(specifier);
    if (source && context.parentURL?.startsWith(testsUrl)) {
      return { url: pathToFileURL(join(lib, `${source[1]}.js`)).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith(testsUrl)) {
      const base = fileURLToPath(new URL(specifier, context.parentURL)).replace(/\.js$/, "");
      if (existsSync(`${base}.ts`)) return { url: pathToFileURL(`${base}.ts`).href, shortCircuit: true };
    }
    // The packages the tests import, including through a `createRequire`'s `require`, are the ones in `packages`.
    if (!/^[./]|^node:|^data:|^file:/.test(specifier) && !context.parentURL?.startsWith(pathToFileURL(packages).href)) {
      if (context.conditions?.includes("require")) {
        return { url: pathToFileURL(requireFromPackages.resolve(specifier)).href, shortCircuit: true };
      }
      return next(specifier, { ...context, parentURL: pathToFileURL(join(packages, "x.js")).href });
    }
    return next(specifier, context);
  },
});

/** The config value as JSON, with a parser by name. */
function written(value: any): any {
  if (Array.isArray(value)) return value.map(written);
  if (!value || typeof value !== "object") return value;
  if (typeof value.parseForESLint === "function") return value.meta?.name ?? "other";
  return Object.fromEntries(Object.entries(value).map(([key, it]) => [key, written(it)]));
}

/** `code` with only `fix` applied. ESLint's ranges are in UTF-16 code units, without a byte order mark. */
function applied(code: string, fix: { range: [number, number]; text: string }) {
  const bom = code.startsWith("﻿") ? "﻿" : "";
  const rest = code.slice(bom.length);
  return bom + rest.slice(0, fix.range[0]) + fix.text + rest.slice(fix.range[1]);
}

function message(it: any, ruleId: string, code: string) {
  return {
    ...(it.ruleId === ruleId ? {} : { ruleId: it.ruleId }),
    severity: it.severity,
    messageId: it.messageId ?? null,
    message: it.message,
    line: it.line,
    column: it.column,
    endLine: it.endLine ?? null,
    endColumn: it.endColumn ?? null,
    fix: it.fix ?? null,
    suggestions: (it.suggestions ?? []).map((suggestion: any) => ({
      messageId: suggestion.messageId ?? null,
      desc: suggestion.desc,
      fix: suggestion.fix,
      output: applied(code, suggestion.fix),
    })),
    ...(it.suppressions ? { suppressions: it.suppressions } : {}),
  };
}

// The rules that compile the component with the project's `svelte/compiler`, whose warnings the cases were recorded
// with. `--svelte-plugin=<eslint-plugin-svelte module>` runs them with the plugin's compiler.
const COMPILES = new Set(["no-unused-svelte-ignore", "valid-compile"]);

const root = join(tests, "../..");
mkdirSync(join(out, "svelte"), { recursive: true });
mkdirSync(join(out, "svelte-project"), { recursive: true });
writeFileSync(
  join(out, "svelte-project/package.json"),
  JSON.stringify({ name: "eslint-plugin-svelte", private: true }, null, 2) + "\n",
);
// `svelteConfig` names SvelteKit's route directories relative to the plugin, where upstream runs its tests.
process.chdir(tests);
let disagreements = 0;
for (const rule of rules) {
  const ruleId = `svelte/${rule}`;
  const module: RuleModule = published.rules[rule];
  if (!module) throw new Error(`eslint-plugin-svelte has no rule ${rule}`);
  runs.length = 0;
  await import(pathToFileURL(join(tests, "tests/src/rules", `${rule}.ts`)).href);
  const cases = [];
  for (const valid of [true, false]) {
    for (const run of runs) {
      for (const item of (valid ? run.valid : run.invalid).map(it => (typeof it === "string" ? { code: it } : it))) {
        const { code, filename, options = [], settings } = item;
        const languageOptions = { ...item.languageOptions };
        for (const [key, value] of Object.entries(run.config.languageOptions ?? {}))
          if (!(key in languageOptions)) languageOptions[key] = value;
        const { project: _, ...parserOptions } = languageOptions.parserOptions ?? {};
        languageOptions.parserOptions = parserOptions;
        const config = {
          files: ["**"],
          plugins: { svelte: published },
          languageOptions,
          ...(settings ? { settings } : {}),
          linterOptions: { reportUnusedDisableDirectives: "off" },
          rules: { [ruleId]: ["error", ...options] },
        };
        const linter = new Linter({ configType: "flat", cwd: tests });
        let [messages, suppressed, fixed, thrown] = [[], [], { fixed: false, output: code }, null as string | null];
        try {
          messages = linter.verify(code, [config], filename);
          suppressed = linter.getSuppressedMessages();
          fixed = new Linter({ configType: "flat", cwd: tests }).verifyAndFix(code, [config], { filename });
        } catch (error) {
          // A plugin rule ESLint can't run: it uses a `SourceCode` API that ESLint 10 removed.
          thrown = `ESLint throws: ${(error as Error).message.split("\n")[0]}`;
        }
        const inProject = relative(tests, filename);
        mkdirSync(join(out, "svelte-project", dirname(inProject)), { recursive: true });
        writeFileSync(join(out, "svelte-project", inProject), code);
        for (const name of readdirSync(dirname(filename)).filter(it => it === "svelte.config.js"))
          copyFileSync(join(dirname(filename), name), join(out, "svelte-project", dirname(inProject), name));
        const dropped: string[] = [];
        const recorded = {
          valid,
          name: relative(root, filename),
          code,
          filename: inProject,
          options: jsonPart(options, dropped, "options"),
          languageOptions: jsonPart(written(languageOptions), dropped, "languageOptions"),
          settings: settings ? jsonPart(settings, dropped, "settings") : null,
          typeAware: false,
          tsconfig: null,
          skip:
            thrown ??
            (dropped.length > 0
              ? `not JSON-serializable: ${dropped.join(", ")}`
              : COMPILES.has(rule) && filename.endsWith(".svelte")
                ? "svelte/compiler"
                : null),
          messages: messages.map((it: any) => message(it, ruleId, code)),
          suppressed: suppressed.map((it: any) => message(it, ruleId, code)),
          output: fixed.fixed ? fixed.output : null,
        };
        // Upstream's cases have the output of all passes, as here.
        const upstream = { ...item, output: item.output ?? null };
        const pass = { messages: recorded.messages, output: recorded.output };
        for (const problem of thrown
          ? [thrown]
          : compareWithUpstream(upstream, valid, pass as any, module, interpolate)) {
          disagreements++;
          console.error(`${ruleId} ${recorded.name}: ${problem}`);
        }
        cases.push(recorded);
      }
    }
  }
  if (!cases.length) throw new Error(`no case of ${ruleId}`);
  const file = join(out, "svelte", `${rule}.json`);
  writeJson(file, { plugin: "svelte", rule, meta: toFixtureMeta(module), cases });
  console.log(`${file}: ${cases.length} cases`);
}
console.error(`${disagreements} disagreements with what upstream expects`);
