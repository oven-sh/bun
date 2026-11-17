// Tests for `bun lint` in projects with no ESLint or oxlint config. Every built-in rule can be set in bunfig.toml's
// `[lint.rules]`, with `--rule`, and in comments, under any of its names. An unknown rule name is an error.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import { basename, join, sep } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// In a debug build, each `bun lint` takes at least 0.2 s to start, and seconds if it type-checks or starts a JavaScript VM.
// A test here starts up to 9 of them while 4 other tests run, so the default of 5 s isn't enough. CI never runs a debug
// build, and the runner passes its own --timeout on every lane, so this only affects `bun bd test`.
if (isDebug) setDefaultTimeout(120_000);

type Run = { stdout: string; stderr: string; exitCode: number };

/**
 * Runs `bun lint ...args` in a temp directory containing `files`, or in its subdirectory `cwd`. The temp directory is
 * replaced with `<dir>` in stdout, and the elapsed time is removed from the summary line on stderr.
 */
async function lint(files: Record<string, string>, args: string[] = [], cwd = "."): Promise<Run> {
  using dir = tempDir("bun-lint-native", files);
  await using proc = spawn({
    // These projects only have a few files, so one thread per core (the default) costs more to start than it saves.
    cmd: [bunExe(), "lint", "--threads", "2", ...args],
    env: bunEnv,
    cwd: join(String(dir), cwd),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: stdout.replaceAll(String(dir) + sep, "<dir>/"),
    stderr: stderr.replace(/ \[\d+(\.\d+)?m?s\]\n$/, "\n"),
    exitCode,
  };
}

type Setting = string | [string, ...unknown[]];

/** Serializes a value as TOML. Strings, numbers, booleans and arrays look the same as in JSON. */
const toml = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(toml).join(", ")}]`
    : value !== null && typeof value === "object"
      ? `{ ${Object.entries(value)
          .map(([key, value]) => `${JSON.stringify(key)} = ${toml(value)}`)
          .join(", ")} }`
      : JSON.stringify(value);

const bunfig = (rules: Record<string, Setting>) => ({
  "bunfig.toml": `[lint.rules]\n${Object.entries(rules)
    .map(([id, setting]) => `${JSON.stringify(id)} = ${toml(setting)}\n`)
    .join("")}`,
});

/** The expected output when line `line` of bunfig.toml is rejected: the line, a caret under `column`, and the error. */
const refused = (line: number, column: number, text: string, message: string): Run => ({
  stdout: "",
  stderr: `${line} | ${text}\n${Buffer.alloc(column + 3, " ").toString()}^\nerror: ${message}\n    at bunfig.toml:${line}:${column}\n`,
  exitCode: 2,
});

type Message = {
  line: number;
  ruleId: string | null;
  severity: number;
  message: string;
  fix?: { range: [number, number]; text: string };
  suggestions?: { desc: string }[];
};
type Result = { filePath: string; messages: Message[]; output?: string };

/** Everything on stderr before the summary, which is always the last line. */
const warningsOf = ({ stderr }: Run) => stderr.slice(0, stderr.lastIndexOf("\n", stderr.length - 2) + 1);

/**
 * Parses the output of a `-f json` run. Also checks that the run ended the way its results imply: stderr is `warnings`
 * followed by the summary line with the number of files, and the exit code is 1 only if an error was reported.
 */
function resultsOf({ stdout, stderr, exitCode }: Run, warnings = ""): Result[] {
  // A run that was rejected or crashed prints no results. Show its stderr instead of a JSON syntax error.
  if (exitCode !== 0 && exitCode !== 1) throw new Error(`bun lint exited with code ${exitCode}\n${stderr}`);
  const results: Result[] = JSON.parse(stdout);
  const found = results.flatMap(file => file.messages);
  const files = `${results.length} file${results.length === 1 ? "" : "s"}`;
  expect({ stderr, exitCode }).toEqual({
    stderr: `${warnings}${found.length > 0 ? "Linted" : "✓ No problems in"} ${files}\n`,
    exitCode: found.some(it => it.severity === 2) ? 1 : 0,
  });
  return results;
}

const inOrder = new Intl.Collator("en", { numeric: true }).compare;

/**
 * Returns every problem of a `-f json` run as `file:line rule`, sorted. Warnings end with ` (warning)`. Checks how the
 * run ended, like `resultsOf`.
 */
const problems = (run: Run, warnings = "") =>
  resultsOf(run, warnings)
    .flatMap(file =>
      file.messages.map(
        it => `${basename(file.filePath)}:${it.line} ${it.ruleId}${it.severity === 2 ? "" : " (warning)"}`,
      ),
    )
    .sort(inOrder);

/** The rule ID in one entry of `problems()`. */
const ruleOf = (problem: string) => problem.split(" ")[1];

/** The `rules` from `bun lint --print-config file`: each rule's severity followed by its options. */
async function configOf(files: Record<string, string>, file: string) {
  const { stdout, stderr, exitCode } = await lint(files, ["--print-config", file]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return (JSON.parse(stdout) as { rules: Record<string, [number, ...unknown[]]> }).rules;
}

/** Accepted prefixes for each plugin, keyed by the plugin's name in `--rules`. Reports use the first one. */
const spellings: Record<string, string[]> = {
  eslint: ["", "eslint/"],
  typescript: ["@typescript-eslint/", "typescript-eslint/", "typescript/"],
  react: ["react/"],
  "react-hooks": ["react-hooks/", "react_hooks/", "react/"],
  react_perf: ["react-perf/", "react_perf/"],
  jsx_a11y: ["jsx-a11y/", "jsx_a11y/"],
  nextjs: ["@next/next/", "nextjs/"],
  node: ["n/", "node/"],
  import: ["import/", "import-x/"],
  unicorn: ["unicorn/"],
  oxc: ["oxc/"],
  promise: ["promise/"],
  jest: ["jest/"],
  vitest: ["vitest/"],
  prettier: ["prettier/"],
  bun: ["bun/"],
  "bun:test": ["bun:test/"],
};

/** `import/enforce-node-protocol-usage` is the only rule that requires an option. */
const setting = (id: string, severity: string): Setting =>
  id.endsWith("enforce-node-protocol-usage") ? [severity, "always"] : severity;

type Listed = { id: string; scope: string; value: string; type_aware: boolean; modes: string[]; fix: string };

/** The output of `bun lint --rules -f json` without a config. One run is shared by every test that needs the list. */
let rulesListed: Promise<Listed[]> | undefined;
const everyRule = () =>
  (rulesListed ??= lint({}, ["--rules", "-f", "json"]).then(({ stdout, stderr, exitCode }) => {
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout) as Listed[];
  }));

async function listed() {
  // Rules for languages other than JavaScript only exist with an ESLint config.
  const rules = (await everyRule()).filter(it => it.modes.includes("native"));
  expect(rules.length).toBeGreaterThan(1000);
  expect([...new Set(rules.map(it => it.scope))].filter(it => !(it in spellings))).toEqual([]);
  return rules;
}

/** Lists every core rule that has a typescript-eslint version, and whether that version needs type information. */
function pairsOf(rules: Listed[]) {
  const eslintRuleNames = new Set(rules.filter(it => it.scope === "eslint").map(it => it.value));
  const base = (name: string) => (name === "only-throw-error" ? "no-throw-literal" : name);
  return rules
    .filter(it => it.scope === "typescript" && eslintRuleNames.has(base(it.value)))
    .map(it => ({
      base: base(it.value),
      extension: `@typescript-eslint/${it.value}`,
      typed: it.type_aware,
    }));
}

const isTypeScript = (file: string) => /\.[cm]?tsx?$/.test(file);

describe.concurrent("every built-in rule", () => {
  const sources = { "a.js": "", "b.jsx": "", "c.ts": "", "d.tsx": "" };

  /** For each pair, returns the rule that doesn't run on `file` when both names are set. */
  const resting = (rules: Listed[], file: string) =>
    new Set(pairsOf(rules).map(it => (isTypeScript(file) ? it.base : it.extension)));

  /** Returns the severity of every rule configured for `file`. */
  const configured = async (files: Record<string, string>, file: string) =>
    new Map(Object.entries(await configOf({ ...sources, ...files }, file)).map(([id, [severity]]) => [id, severity]));

  test("is accepted under all of its names and resolves to the same ID", async () => {
    const rules = await listed();
    // `--rules` lists eslint-plugin-react-hooks rules under `react`, like oxlint does.
    const asListed = await configured(
      bunfig(Object.fromEntries(rules.map(it => [`${it.scope}/${it.value}`, setting(it.value, "error")]))),
      "d.tsx",
    );
    const isHooksRule = (it: { scope: string; value: string }) =>
      it.scope === "react" && asListed.has(`react-hooks/${it.value}`);
    expect(rules.filter(isHooksRule).map(it => it.value)).toContain("rules-of-hooks");
    expect(rules.filter(isHooksRule).map(it => it.value)).toContain("exhaustive-deps");
    expect(rules.filter(isHooksRule).map(it => it.value)).not.toContain("jsx-key");
    const names = rules.map(it =>
      spellings[isHooksRule(it) ? "react-hooks" : it.scope].map(prefix => prefix + it.value),
    );
    const ids = names.map(it => it[0]).sort();
    const on = (found: Map<string, number>) =>
      [...found].flatMap(([id, severity]) => (severity === 2 ? [id] : [])).sort();
    const runningOn = (file: string) => {
      // `resting` walks every rule, so call it once per file, not once per ID.
      const rest = resting(rules, file);
      return ids.filter(id => !rest.has(id));
    };
    expect(on(asListed)).toEqual(runningOn("d.tsx"));
    await Promise.all(
      [0, 1, 2].map(async nth => {
        const chosenNames = names.map(it => it[Math.min(nth, it.length - 1)]);
        const found = await configured(
          bunfig(Object.fromEntries(chosenNames.map(id => [id, setting(id, "error")]))),
          "a.js",
        );
        expect(on(found)).toEqual(runningOn("a.js"));
      }),
    );
  });

  test("can be set to error in a project with .js, .jsx, .ts and .tsx files", async () => {
    const rules = await listed();
    const all = bunfig(Object.fromEntries(rules.map(it => [`${it.scope}/${it.value}`, setting(it.value, "error")])));
    const code = "export const value = 1;\n";
    const files = Object.fromEntries(Object.keys(sources).map(name => [name, code]));
    const [run, ...perFile] = await Promise.all([
      lint({ ...files, ...all }, ["-f", "json"]),
      ...Object.keys(sources).map(file => configured(all, file)),
    ]);
    const linted = resultsOf(run).map(it => basename(it.filePath));
    expect(linted.sort()).toEqual(Object.keys(sources));
    // Of all the rules, only these two report anything in a file with one named export.
    expect(problems(run)).toEqual(
      Object.keys(sources).flatMap(name => [
        `${name}:1 import/no-named-export`,
        `${name}:1 import/prefer-default-export`,
      ]),
    );
    for (const [nth, found] of perFile.entries()) {
      const off = [...found].flatMap(([id, severity]) => (severity !== 2 ? [id] : []));
      expect(off.sort()).toEqual([...resting(rules, Object.keys(sources)[nth])].sort());
      expect(found.size).toBe(rules.length);
    }
  });

  test("typescript-eslint rules run on JavaScript files", async () => {
    const run = await lint(
      {
        "a.js": "const self = this;\nexport { self };\n",
        ...bunfig({ "@typescript-eslint/no-this-alias": "error" }),
      },
      ["-f", "json"],
    );
    expect(problems(run)).toEqual(["a.js:1 @typescript-eslint/no-this-alias"]);
  });
});

// This suite is early in the file because the last test's ESLint run starts a JavaScript VM. Under LeakSanitizer that run
// takes several seconds longer to exit, so it should start while the rest of the file still has work to do.
describe.concurrent("[lint.settings]", () => {
  // Rule, code, settings table, lines reported without the settings, lines reported with them.
  const cases: [id: string, code: string, settings: string, without: number[], withIt: number[]][] = [
    [
      "react/no-deprecated",
      "export const A = React.createClass({});\n",
      `[lint.settings.react]\nversion = "15.0"`,
      [1],
      [],
    ],
    [
      "react-hooks/exhaustive-deps",
      "export function A({ a }) {\n  useMine(() => {\n    f(a);\n  }, []);\n}\n",
      `[lint.settings.react-hooks]\nadditionalEffectHooks = "useMine"`,
      [],
      [4],
    ],
    ["import/no-unresolved", `import "electron";\n`, `[lint.settings]\n"import/core-modules" = ["electron"]`, [1], []],
    [
      "jsx-a11y/alt-text",
      "export default <Picture />;\n",
      `[lint.settings."jsx-a11y".components]\nPicture = "img"`,
      [],
      [1],
    ],
    ["jest/no-deprecated-functions", `jest.genMockFromModule("a");\n`, `[lint.settings.jest]\nversion = 20`, [1], []],
  ];

  test.each(cases)("%s reads its settings", async (id, code, settings, without, withIt) => {
    const of = (run: Run) => problems(run).filter(it => ruleOf(it) === id);
    const rules = bunfig({ [id]: "error" })["bunfig.toml"];
    const [plain, set] = await Promise.all([
      lint({ "a.jsx": code, "bunfig.toml": rules }, ["-f", "json"]),
      lint({ "a.jsx": code, "bunfig.toml": `${rules}\n${settings}\n` }, ["-f", "json"]),
    ]);
    expect(of(plain)).toEqual(without.map(line => `a.jsx:${line} ${id}`));
    expect(of(set)).toEqual(withIt.map(line => `a.jsx:${line} ${id}`));
  });

  test("merge into the settings of an ESLint or oxlint config", async () => {
    const files = {
      "a.jsx": "export default <Picture />;\n",
      "bunfig.toml": `[lint.settings."jsx-a11y".components]\nPicture = "img"\n`,
    };
    const oxlint = {
      ".oxlintrc.json": `{ "plugins": ["jsx-a11y"], "rules": { "jsx-a11y/alt-text": "error" } }`,
    };
    const eslint = {
      "eslint.config.mjs": `const rule = { create: context => ({ Program: node => context.report({ node, message: JSON.stringify(context.settings) }) }) };
export default [{ files: ["**/*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, settings: { mine: 1 }, plugins: { p: { rules: { r: rule } } }, rules: { "p/r": "error" } }];\n`,
    };
    const [withOxlint, withESLint] = await Promise.all([
      lint({ ...files, ...oxlint }, ["-f", "unix"]),
      lint({ ...files, ...eslint }, ["-f", "unix"]),
    ]);
    expect(withOxlint).toEqual({
      stdout: "a.jsx:1:16: Missing `alt` attribute. [Error/jsx-a11y(alt-text)]\n\n1 problem\n",
      stderr: "",
      exitCode: 1,
    });
    expect(withESLint).toEqual({
      stdout: `<dir>/a.jsx:1:1: {"mine":1,"jsx-a11y":{"components":{"Picture":"img"}}} [Error/p/r]\n\n1 problem\n`,
      stderr: "Linted 2 files\n",
      exitCode: 1,
    });
  });
});

describe.concurrent("core rules and their typescript-eslint versions never both report", () => {
  // Core rule name, code with exactly one problem in both JavaScript and TypeScript, and the options needed to find it.
  const cases: [base: string, code: string, options?: unknown[]][] = [
    ["class-methods-use-this", "export class A {\n  m() {}\n}\n"],
    ["consistent-return", "export function f(a) {\n  if (a) return 1;\n}\n"],
    ["default-param-last", "export function f(a = 1, b) {\n  return [a, b];\n}\n"],
    ["dot-notation", `export const a = Math["PI"];\n`],
    ["init-declarations", "let a;\na = 1;\nexport { a };\n"],
    ["max-params", "export function f(a, b, c, d) {\n  return [a, b, c, d];\n}\n"],
    ["no-array-constructor", "export const a = new Array(1, 2);\n"],
    ["no-dupe-class-members", "export class A {\n  m() {}\n  m() {}\n}\n"],
    ["no-empty-function", "export function f() {}\n"],
    ["no-implied-eval", `setTimeout("a()", 1);\n`],
    ["no-invalid-this", "export function f() {\n  return this;\n}\n"],
    ["no-loop-func", "const all = [];\nfor (var i = 0; i < 1; i++) {\n  all.push(() => i);\n}\nexport { all };\n"],
    ["no-loss-of-precision", "export const a = 9007199254740993;\n"],
    ["no-magic-numbers", "export const a = Math.abs(42);\n"],
    ["no-redeclare", "var a = 1;\nvar a = 2;\nexport { a };\n"],
    ["no-restricted-imports", `import "fs";\n`, ["fs"]],
    ["no-shadow", "const a = 1;\nexport function f() {\n  const a = 2;\n  return a;\n}\nexport { a };\n"],
    ["no-throw-literal", "throw 1;\n"],
    ["no-unused-expressions", "Math.PI;\n"],
    ["no-unused-private-class-members", "export class A {\n  #a = 1;\n}\n"],
    ["no-unused-vars", "const a = 1;\nexport {};\n"],
    ["no-use-before-define", "console.log(a);\nvar a = 1;\n"],
    ["no-useless-constructor", "export class A {\n  constructor() {}\n}\n"],
    ["prefer-destructuring", "const o = { a: 1 };\nconst a = o.a;\nexport { a };\n"],
    ["prefer-promise-reject-errors", "Promise.reject(1);\n"],
    ["require-await", "export async function f() {\n  return 1;\n}\n"],
  ];
  const files = {
    ...Object.fromEntries(cases.flatMap(([base, code]) => [`${base}.js`, `${base}.ts`].map(name => [name, code]))),
    "tsconfig.json": `{ "compilerOptions": { "strict": false }, "include": ["*.ts"] }`,
  };
  type Pair = ReturnType<typeof pairsOf>[number];

  /**
   * Returns each file's reports from its own pair as `severity rule`, and what the run warned about. Also checks that no
   * pair reports twice in any file.
   */
  async function reports(pairs: Pair[], rules: Record<string, Setting>, args: string[] = []) {
    const run = await lint({ ...files, ...bunfig(rules) }, ["-f", "json", ...args]);
    const warnings = warningsOf(run);
    const results = resultsOf(run, warnings);
    for (const { filePath, messages } of results) {
      const ids = new Set(messages.map(it => it.ruleId));
      expect([basename(filePath), pairs.filter(it => ids.has(it.base) && ids.has(it.extension))]).toEqual([
        basename(filePath),
        [],
      ]);
    }
    const byFile = Object.fromEntries(
      results.map(({ filePath, messages }) => {
        const name = basename(filePath);
        const own = pairs.find(it => it.base === name.slice(0, -3))!;
        const pairMessages = messages.filter(it => it.ruleId === own.base || it.ruleId === own.extension);
        return [name, pairMessages.map(it => `${it.severity} ${it.ruleId}`)];
      }),
    );
    return { byFile, warnings };
  }

  /** One report per file. The core rule reports in .js files, the typescript-eslint version in .ts files if it can run. */
  const expected = (pairs: Pair[], hasTypes: boolean, [inJavaScript, inTypeScript]: [number, number]) =>
    Object.fromEntries(
      pairs.flatMap(it => [
        [`${it.base}.js`, [`${inJavaScript} ${it.base}`]],
        [`${it.base}.ts`, [`${inTypeScript} ${it.typed && !hasTypes ? it.base : it.extension}`]],
      ]),
    );

  const settings = (pairs: Pair[], name: (pair: Pair) => string, severity: string) =>
    Object.fromEntries(
      pairs.map(it => [name(it), [severity, ...(cases.find(([base]) => base === it.base)?.[2] ?? [])] as Setting]),
    );

  // Flags, whether core names alone get type information, and whether typescript-eslint names do.
  test.each([
    ["by default", [], false, true],
    ["with --type-aware", ["--type-aware"], true, true],
    ["with --no-type-aware", ["--no-type-aware"], false, false],
  ])("every pair reports once per problem %s", async (_, args, coreNamesGetTypes, typedNamesGetTypes) => {
    const pairs = pairsOf(await listed());
    expect(pairs.map(it => it.base).sort()).toEqual(cases.map(it => it[0]));
    expect(pairs.length).toBe(26);
    const typed = pairs.filter(it => it.typed).map(it => it.extension.slice("@typescript-eslint/".length));
    expect(typed).toEqual([
      "consistent-return",
      "dot-notation",
      "no-implied-eval",
      "only-throw-error",
      "prefer-destructuring",
      "prefer-promise-reject-errors",
      "require-await",
    ]);
    const [base, extension] = [(it: Pair) => it.base, (it: Pair) => it.extension];
    const [byBase, byExtension, byBoth, byBothReversed] = await Promise.all([
      reports(pairs, settings(pairs, base, "error"), args),
      reports(pairs, settings(pairs, extension, "error"), args),
      reports(pairs, { ...settings(pairs, base, "warn"), ...settings(pairs, extension, "error") }, args),
      reports(pairs, { ...settings(pairs, extension, "error"), ...settings(pairs, base, "warn") }, args),
    ]);
    expect(byBase.byFile).toEqual(expected(pairs, coreNamesGetTypes, [2, 2]));
    expect(byExtension.byFile).toEqual(expected(pairs, typedNamesGetTypes, [2, 2]));
    expect(byBoth.byFile).toEqual(expected(pairs, typedNamesGetTypes, [1, 2]));
    expect(byBothReversed.byFile).toEqual(expected(pairs, typedNamesGetTypes, [1, 2]));
    // The warning only counts typed rules the user asked for by name.
    const skipped = typedNamesGetTypes
      ? ""
      : `warn: Skipped ${typed.length} rules that need type information\n  Remove typeAware = false or --no-type-aware to run them.\n`;
    expect([byBase, byExtension, byBoth, byBothReversed].map(it => it.warnings)).toEqual([
      "",
      skipped,
      skipped,
      skipped,
    ]);
  });

  describe("pairs whose typescript-eslint version needs types", () => {
    // Only the typed rule knows that `g()` returns a promise, so it accepts `f`. The core rule reports it.
    const files = {
      "a.ts": "declare function g(): Promise<void>;\nexport async function f() {\n  return g();\n}\n",
      "tsconfig.json": `{ "include": ["*.ts"] }`,
    };
    const [core, typed] = ["require-await", "@typescript-eslint/require-await"];
    const coreReport = [`a.ts:2 ${core}`];
    const skipped =
      "warn: Skipped 1 rule that needs type information\n  Remove typeAware = false or --no-type-aware to run it.\n";
    /** Returns what a run reports, and what it warns about. */
    const run = async (bunfig: string, args: string[] = [], code = files["a.ts"]): Promise<[string[], string]> => {
      const ended = await lint({ ...files, "a.ts": code, "bunfig.toml": bunfig }, ["-f", "json", ...args]);
      return [problems(ended, warningsOf(ended)), warningsOf(ended)];
    };
    const rules = (...names: string[]) => `[lint.rules]\n${names.map(name => `"${name}" = "error"\n`).join("")}`;

    test("naming the typed rule starts a type check", async () => {
      expect(
        await Promise.all([
          run(rules(typed)),
          run("", ["--rule", `${typed}: error`]),
          run(`[[lint.overrides]]\nfiles = ["*.ts"]\nrules = { "${typed}" = "error" }\n`),
        ]),
      ).toEqual([
        [[], ""],
        [[], ""],
        [[], ""],
      ]);
    });

    test("naming the core rule doesn't start a type check", async () => {
      expect(
        await Promise.all([
          run(rules(core)),
          run("", ["--rule", `${core}: error`]),
          run(`[[lint.overrides]]\nfiles = ["*.ts"]\nrules = { "${core}" = "error" }\n`),
        ]),
      ).toEqual([
        [coreReport, ""],
        [coreReport, ""],
        [coreReport, ""],
      ]);
    });

    test("the core name uses the typed rule when the run has types anyway", async () => {
      expect(
        await Promise.all([
          run(rules(core), ["--type-aware"]),
          run(`[lint]\ntypeAware = true\n${rules(core)}`),
          run(rules(core, "@typescript-eslint/no-floating-promises")),
          // `pedantic` has both names, and other typed rules.
          run(`[lint.categories]\npedantic = "error"\n`).then(([found, warnings]) => [
            found.filter(it => ruleOf(it).endsWith("require-await")),
            warnings,
          ]),
        ]),
      ).toEqual([
        [[], ""],
        [[], ""],
        [[], ""],
        [[], ""],
      ]);
    });

    test("typeAware = false falls back to the core rule and warns about the typed rule", async () => {
      expect(
        await Promise.all([
          run(`[lint]\ntypeAware = false\n${rules(typed)}`),
          run(rules(typed), ["--no-type-aware"]),
          run(`[lint]\ntypeAware = false\n${rules(core)}`),
        ]),
      ).toEqual([
        [coreReport, skipped],
        [coreReport, skipped],
        [coreReport, ""],
      ]);
    });

    test("a comment can't start a type check, so it falls back to the core rule", async () => {
      const commented = (name: string) => `${files["a.ts"]}/* eslint ${name}: error */\n`;
      expect(
        await Promise.all([
          run("", [], commented(typed)),
          run("", [], commented(core)),
          run("", ["--type-aware"], commented(typed)),
          run("", ["--type-aware"], commented(core)),
        ]),
      ).toEqual([
        [coreReport, ""],
        [coreReport, ""],
        [[], ""],
        [[], ""],
      ]);
    });
  });

  const unused = {
    "a.js": "const a = 1;\nexport {};\n",
    "b.ts": "const a = 1;\nexport {};\n",
  };

  test("either name sets both rules, and setting both names configures each language separately", async () => {
    const run = async (rules: Record<string, Setting>) =>
      problems(await lint({ ...unused, ...bunfig(rules) }, ["-f", "json"]));
    const [extension, base] = ["@typescript-eslint/no-unused-vars", "no-unused-vars"];
    expect(
      await Promise.all([
        run({}),
        run({ [base]: "off" }),
        run({ [extension]: "off" }),
        run({ [base]: "off", [extension]: "error" }),
        run({ [extension]: "error", [base]: "off" }),
        run({ [base]: "error", "typescript/no-unused-vars": "off" }),
      ]),
    ).toEqual([
      // The defaults only warn about it.
      [`a.js:1 ${base} (warning)`, `b.ts:1 ${extension} (warning)`],
      [],
      [],
      [`b.ts:1 ${extension}`],
      [`b.ts:1 ${extension}`],
      [`a.js:1 ${base}`],
    ]);
  });

  test("--rule, [lint.categories] and [[lint.overrides]] set both rules too", async () => {
    const found = async (bunfig: string, args: string[] = []) =>
      problems(await lint({ ...unused, "bunfig.toml": bunfig }, ["-f", "json", ...args]));
    const both = ["a.js:1 no-unused-vars", "b.ts:1 @typescript-eslint/no-unused-vars"];
    // The file that an override leaves alone keeps the default severity.
    const byDefault = both.map(it => `${it} (warning)`);
    expect(
      await Promise.all([
        found("", ["--rule", "no-unused-vars: error"]),
        found("", ["--rule", "no-unused-vars: off"]),
        found(`[lint.rules]\n"no-unused-vars" = "off"\n`, ["--rule", "@typescript-eslint/no-unused-vars: error"]),
        found(`[lint.categories]\ncorrectness = "error"\n`),
        found(`[lint.categories]\ncorrectness = "off"\n`),
        found(`[[lint.overrides]]\nfiles = ["b.*"]\nrules = { "no-unused-vars" = "off" }\n`),
        found(`[[lint.overrides]]\nfiles = ["a.*"]\nrules = { "@typescript-eslint/no-unused-vars" = "off" }\n`),
      ]),
    ).toEqual([both, [], both.slice(1), both, [], byDefault.slice(0, 1), byDefault.slice(1)]);
  });

  test("typescript-eslint-only options are accepted under both names and ignored in JavaScript", async () => {
    const files = {
      "a.js": "const A = 1;\nexport function f(A) {\n  return A;\n}\nexport { A };\n",
      "b.ts": "type A = 1;\nexport function f(A: number) {\n  return A;\n}\nexport type { A };\n",
    };
    const run = async (rules: Record<string, Setting>) =>
      problems(await lint({ ...files, ...bunfig(rules) }, ["-f", "json"]));
    const inComment = async (name: string) => {
      const comment = `/* eslint ${name}: ["error", { "ignoreTypeValueShadow": false }] */\n`;
      const commented = Object.fromEntries(Object.entries(files).map(([file, code]) => [file, code + comment]));
      return problems(await lint(commented, ["-f", "json"]));
    };
    const [inJavaScript, inTypeScript] = ["a.js:2 no-shadow", "b.ts:2 @typescript-eslint/no-shadow"];
    expect(
      await Promise.all([
        run({ "no-shadow": "error" }),
        run({ "no-shadow": ["error", { ignoreTypeValueShadow: false }] }),
        run({
          "@typescript-eslint/no-shadow": ["error", { ignoreTypeValueShadow: false }],
        }),
        inComment("no-shadow"),
        inComment("@typescript-eslint/no-shadow"),
        lint({ ...files, ...bunfig({ "no-shadow": ["error", { ignoreTypeValueShado: 1 }] }) }),
      ]),
    ).toEqual([
      [inJavaScript],
      [inJavaScript, inTypeScript],
      [inJavaScript, inTypeScript],
      [inJavaScript, inTypeScript],
      [inJavaScript, inTypeScript],
      refused(
        2,
        27,
        `"no-shadow" = ["error", { "ignoreTypeValueShado" = 1 }]`,
        `Unknown option "ignoreTypeValueShado" for no-shadow\n  Did you mean "ignoreTypeValueShadow"?`,
      ),
    ]);
  });

  test("the core rule also runs on TypeScript when only it accepts the options", async () => {
    const code = "export function f(a, b, c) {\n  return [a, b, c];\n}\n";
    const run = async (rules: Record<string, Setting>, comment = "") => {
      const files = { "a.js": code + comment, "b.ts": code + comment };
      return problems(await lint({ ...files, ...bunfig(rules) }, ["-f", "json"]));
    };
    const baseRuleOnly = ["a.js:1 max-params", "b.ts:1 max-params"];
    expect(
      await Promise.all([
        run({ "max-params": ["error", { max: 2 }] }),
        run({ "max-params": ["error", 2] }),
        run({ "@typescript-eslint/max-params": ["error", 2] }),
        run({}, `/* eslint max-params: ["error", 2] */\n`),
        run({ "max-params": ["error", { max: 2 }] }, `/* eslint max-params: ["error", 2] */\n`),
      ]),
    ).toEqual([
      ["a.js:1 max-params", "b.ts:1 @typescript-eslint/max-params"],
      baseRuleOnly,
      baseRuleOnly,
      baseRuleOnly,
      baseRuleOnly,
    ]);
  });

  test("eslint-disable works with either name and isn't reported as unused", async () => {
    const disabled = (name: string) => `// eslint-disable-next-line ${name}\nconst a = 1;\nexport {};\n`;
    const names = ["no-unused-vars", "@typescript-eslint/no-unused-vars", "typescript/no-unused-vars"];
    const files = Object.fromEntries(
      names.flatMap((name, nth) => [`a${nth}.js`, `b${nth}.ts`].map(file => [file, disabled(name)])),
    );
    expect(problems(await lint(files, ["-f", "json", "--report-unused-disable-directives"]))).toEqual([]);
  });

  test("/* eslint rule: .. */ comments work with either name or both", async () => {
    const files = (comment: string) =>
      Object.fromEntries(Object.entries(unused).map(([file, code]) => [file, `/* eslint ${comment} */\n${code}`]));
    const found = async (comment: string) =>
      resultsOf(await lint(files(comment), ["-f", "json"])).flatMap(file =>
        file.messages.map(it => `${basename(file.filePath)} ${it.severity} ${it.ruleId}`),
      );
    const [base, extension] = ["no-unused-vars", "@typescript-eslint/no-unused-vars"];
    expect(
      await Promise.all([
        found(`${base}: error`),
        found(`${extension}: error`),
        found(`${base}: off`),
        found(`${extension}: off`),
        found(`${base}: off, ${extension}: error`),
        found(`${extension}: error, ${base}: off`),
      ]),
    ).toEqual([
      [`a.js 2 ${base}`, `b.ts 2 ${extension}`],
      [`a.js 2 ${base}`, `b.ts 2 ${extension}`],
      [],
      [],
      [`b.ts 2 ${extension}`],
      [`b.ts 2 ${extension}`],
    ]);
  });

  test("both rules still report with an ESLint config", async () => {
    const config = `export default [{ files: ["**/*.ts"], extends: ["typescript-eslint/recommended"], rules: { "no-unused-vars": "error" } }];\n`;
    const run = await lint({ "b.ts": unused["b.ts"], "eslint.config.mjs": config }, ["-f", "json", "b.ts"]);
    expect(problems(run)).toEqual(["b.ts:1 @typescript-eslint/no-unused-vars", "b.ts:1 no-unused-vars"]);
  });
});

describe.concurrent("rules from every plugin report problems", () => {
  const files = {
    "a.js": `import b from "./b.js";
import c from "./b.js";
import self from "./a.js";
var a = null;
[1].map(x => [x]).flat();
if (a) throw Error("a");
import late from "./late.js";
exports = {};
new require("a");
process.exit(1);
if (a < b < c) a();
[1].reduce((all, x) => [...all, x], []);
new Promise((ok, no) => ok(no));
new Promise.resolve();
export default [b, c, self, late];
`,
    "b.js": `import a from "./a.js";\nexport default a;\n`,
    "late.js": "export default 1;\n",
    "a.test.js": `import { test as t } from "node:test";
it.only("a", () => {});
it("b", () => {});
it("b", () => {});
t();
`,
    "view.tsx": `import { useEffect, useState } from "react";
export function A({ list, on }: { list: any[]; on: Object }) {
  if (on) {
    useState(0);
  }
  useEffect(() => {
    console.log(list);
  }, []);
  const now = Date.now();
  return (
    <div dangerouslySetInnerHTML={{ __html: "a" }} title={now}>
      {list.map(it => (
        <img src={it} />
      ))}
      <a>b</a>
      <script src="https://a.b/c.js"></script>
      <B list={[]} />
    </div>
  );
}
`,
  };
  // The name used in the config, and the expected reports.
  const rules: [written: string, reports: string[]][] = [
    ["unicorn/no-null", ["a.js:4 unicorn/no-null"]],
    ["unicorn/prefer-array-flat-map", ["a.js:5 unicorn/prefer-array-flat-map"]],
    ["unicorn/throw-new-error", ["a.js:6 unicorn/throw-new-error"]],
    ["import/no-self-import", ["a.js:3 import/no-self-import"]],
    ["import/no-duplicates", ["a.js:1 import/no-duplicates", "a.js:2 import/no-duplicates"]],
    ["import/no-cycle", ["a.js:1 import/no-cycle", "b.js:1 import/no-cycle"]],
    ["import-x/first", ["a.js:7 import/first"]],
    ["jest/no-focused-tests", ["a.test.js:2 jest/no-focused-tests"]],
    ["jest/no-identical-title", ["a.test.js:4 jest/no-identical-title"]],
    ["vitest/no-focused-tests", ["a.test.js:2 vitest/no-focused-tests"]],
    ["vitest/no-import-node-test", ["a.test.js:1 vitest/no-import-node-test"]],
    ["jsx-a11y/alt-text", ["view.tsx:13 jsx-a11y/alt-text"]],
    ["jsx_a11y/anchor-is-valid", ["view.tsx:15 jsx-a11y/anchor-is-valid"]],
    ["@next/next/no-img-element", ["view.tsx:13 @next/next/no-img-element"]],
    ["nextjs/no-sync-scripts", ["view.tsx:16 @next/next/no-sync-scripts"]],
    ["n/no-exports-assign", ["a.js:8 n/no-exports-assign"]],
    ["node/no-new-require", ["a.js:9 n/no-new-require"]],
    ["n/no-process-exit", ["a.js:10 n/no-process-exit"]],
    ["oxc/bad-comparison-sequence", ["a.js:11 oxc/bad-comparison-sequence"]],
    ["oxc/no-accumulating-spread", ["a.js:12 oxc/no-accumulating-spread"]],
    ["promise/param-names", ["a.js:13 promise/param-names", "a.js:13 promise/param-names"]],
    ["promise/no-new-statics", ["a.js:14 promise/no-new-statics"]],
    ["react/jsx-key", ["view.tsx:13 react/jsx-key"]],
    ["react/no-danger", ["view.tsx:11 react/no-danger"]],
    ["react/rules-of-hooks", ["view.tsx:4 react-hooks/rules-of-hooks"]],
    ["react-hooks/exhaustive-deps", ["view.tsx:8 react-hooks/exhaustive-deps"]],
    // eslint-plugin-react-hooks and oxlint both have this rule. The plugin's version wins.
    ["react/purity", ["view.tsx:9 react-hooks/purity"]],
    ["react-perf/jsx-no-new-object-as-prop", ["view.tsx:11 react-perf/jsx-no-new-object-as-prop"]],
    ["react_perf/jsx-no-new-array-as-prop", ["view.tsx:17 react-perf/jsx-no-new-array-as-prop"]],
    ["typescript/no-explicit-any", ["view.tsx:2 @typescript-eslint/no-explicit-any"]],
    // Only oxlint still has this rule.
    ["@typescript-eslint/ban-types", ["view.tsx:2 @typescript-eslint/ban-types"]],
    ["eslint/no-var", ["a.js:4 no-var"]],
  ];
  const expected = rules.flatMap(it => it[1]).sort(inOrder);
  const ids = new Set(expected.map(ruleOf));
  const relevantProblems = (run: Run) => problems(run).filter(it => ids.has(ruleOf(it)));

  test("when set in [lint.rules]", async () => {
    const run = await lint(
      {
        ...files,
        ...bunfig(Object.fromEntries(rules.map(it => [it[0], "error"]))),
      },
      ["-f", "json"],
    );
    expect(relevantProblems(run)).toEqual(expected);
  });

  test("when set with --rule", async () => {
    const run = await lint(files, [
      "-f",
      "json",
      "--rule",
      JSON.stringify(Object.fromEntries(rules.map(it => [it[0], "error"]))),
    ]);
    expect(relevantProblems(run)).toEqual(expected);
  });

  test("but are off by default", async () => {
    // no-explicit-any is on by default for TypeScript.
    expect(relevantProblems(await lint(files, ["-f", "json"]))).toEqual([
      "view.tsx:2 @typescript-eslint/no-explicit-any (warning)",
    ]);
  });

  test("prettier/prettier works without prettier installed", async () => {
    const run = await lint(
      {
        "a.js": "export   const a = 1\n",
        ...bunfig({ "prettier/prettier": "error" }),
      },
      ["-f", "unix"],
    );
    expect(run).toEqual({
      stdout: "<dir>/a.js:1:8: Replace `··const·a·=·1` with `const·a·=·1;` [Error/prettier/prettier]\n\n1 problem\n",
      stderr: "Linted 1 file\n",
      exitCode: 1,
    });
  });

  test("oxlint rules print their help text", async () => {
    const { stdout, stderr, exitCode } = await lint(
      {
        "a.js": "export default null;\n",
        ...bunfig({ "unicorn/no-null": "error" }),
      },
      ["-f", "pretty"],
    );
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "1 | export default null;
                         ^
      error: Do not use \`null\` literals  unicorn/no-null
          at a.js:1:16

      note: Replace \`null\` with \`undefined\`.

      1 problem (1 error, 0 warnings)"
    `);
    expect({ stderr, exitCode }).toEqual({ stderr: "Linted 1 file\n", exitCode: 1 });
  });
});

describe.concurrent("React Compiler rules", () => {
  const suggesting = ["exhaustive-effect-dependencies", "memo-dependencies", "syntax"].map(it => `react-hooks/${it}`);

  test("--rules only lists the ones that offer suggestions as fixable", async () => {
    const rules = (await everyRule()).filter(it => it.id.startsWith("react-hooks/"));
    expect(rules.length).toBe(29);
    const handWritten = ["react-hooks/exhaustive-deps", "react-hooks/rules-of-hooks"];
    const labels = Map.groupBy(
      rules.filter(it => !handWritten.includes(it.id)),
      it => it.fix,
    );
    expect([...labels.keys()].sort()).toEqual(["fixable_suggestion", "none"]);
    expect(labels.get("fixable_suggestion")!.map(it => it.id)).toEqual(suggesting);
  });

  test("the ones listed as fixable attach a suggestion and no fix", async () => {
    const files = {
      "effect.tsx": `import { useEffect } from "react";
export function Room({ roomId }) {
  useEffect(() => {
    connect(roomId);
  }, []);
}
`,
      "memo.tsx": `import { useMemo } from "react";
export function Results({ items, query }) {
  const visible = useMemo(() => items.filter(item => item.name.includes(query)), [items]);
  return <List items={visible} />;
}
`,
      "syntax.tsx": "export function Total({ items }) {\n  delete items;\n  return <i />;\n}\n",
    };
    const results = resultsOf(
      await lint({ ...files, ...bunfig(Object.fromEntries(suggesting.map(id => [id, "error"]))) }, ["-f", "json"]),
    );
    const found = results.flatMap(file =>
      file.messages
        .filter(it => it.ruleId !== null && suggesting.includes(it.ruleId))
        .map(it => [basename(file.filePath), it.ruleId, it.fix === undefined, it.suggestions?.map(it => it.desc)]),
    );
    expect(found).toEqual([
      ["effect.tsx", "react-hooks/exhaustive-effect-dependencies", true, ["Update dependencies"]],
      ["memo.tsx", "react-hooks/memo-dependencies", true, ["Update dependencies"]],
      ["syntax.tsx", "react-hooks/syntax", true, ["Remove this line"]],
    ]);
  });
});

describe.concurrent("rule options", () => {
  // These rules are ported from oxlint, so they take oxlint's options.
  const cases: [id: string, options: unknown[], code: string, lines: number[], withoutOptions: number[]][] = [
    ["jest/max-expects", [{ max: 1 }], `it("a", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n`, [3], []],
    [
      "promise/param-names",
      [{ resolvePattern: "^ok$" }],
      "new Promise(ok => ok());\nnew Promise(resolve => resolve());\n",
      [2],
      [1],
    ],
    ["unicorn/catch-error-name", [{ name: "oops" }], "try {\n} catch (error) {\n  f(error);\n}\n", [2], []],
    ["jsx-a11y/alt-text", [{ img: ["Picture"] }], "export default <Picture />;\n", [1], []],
    ["vitest/max-expects", [{ max: 1 }], `it("a", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n`, [3], []],
    ["n/no-process-env", [{ allowedVariables: ["A"] }], "process.env.A;\nprocess.env.B;\n", [2], [1, 2]],
  ];

  test.each(cases)(
    "%s takes options from bunfig.toml, --rule and comments",
    async (id, options, code, lines, withoutOptions) => {
      const of = (run: Run) => problems(run).filter(it => ruleOf(it) === id);
      const at = (lines: number[]) => lines.map(line => `a.jsx:${line} ${id}`);
      const [plain, inFile, byFlag, inComment] = await Promise.all([
        lint({ "a.jsx": code, ...bunfig({ [id]: "error" }) }, ["-f", "json"]),
        lint({ "a.jsx": code, ...bunfig({ [id]: ["error", ...options] }) }, ["-f", "json"]),
        lint({ "a.jsx": code }, ["-f", "json", "--rule", JSON.stringify({ [id]: ["error", ...options] })]),
        lint(
          {
            "a.jsx": `${code}/* eslint ${id}: ${JSON.stringify(["error", ...options])} */\n`,
          },
          ["-f", "json"],
        ),
      ]);
      expect(of(plain)).toEqual(at(withoutOptions));
      expect(of(inFile)).toEqual(at(lines));
      expect(of(byFlag)).toEqual(at(lines));
      expect(of(inComment)).toEqual(at(lines));
    },
  );

  test("rules ported from an ESLint plugin take that plugin's options", async () => {
    const code = "export default [1].map(it => <b>{it}</b>, <></>);\nexport const a = () => [<></>];\n";
    const [plain, checked] = await Promise.all([
      lint({ "a.jsx": code, ...bunfig({ "react/jsx-key": "error" }) }, ["-f", "json"]),
      lint(
        {
          "a.jsx": code,
          ...bunfig({
            "react/jsx-key": ["error", { checkFragmentShorthand: true }],
          }),
        },
        ["-f", "json"],
      ),
    ]);
    expect(problems(plain)).toEqual(["a.jsx:1 react/jsx-key"]);
    expect(problems(checked)).toEqual(["a.jsx:1 react/jsx-key", "a.jsx:2 react/jsx-key"]);
  });
});

describe.concurrent("react/jsx-newline", () => {
  const id = "react/jsx-newline";
  const component = (children: string) => `export const C = ({ time, now }) => (\n  <div>\n${children}\n  </div>\n);\n`;
  const onOneLine = component("    took {time} at {now}");

  test("only offers a fix when there's a line break to double", async () => {
    const files = { "a.jsx": onOneLine, "b.jsx": component("    {time}\n    {now}"), ...bunfig({ [id]: "error" }) };
    const results = resultsOf(await lint(files, ["-f", "json", "a.jsx", "b.jsx"]));
    expect(results.map(it => it.messages.filter(it => it.ruleId === id).map(it => [it.line, it.fix?.text]))).toEqual([
      [[3, undefined]],
      [[4, "\n\n    "]],
    ]);
  });

  test("--fix doesn't claim to have fixed two expressions on one line", async () => {
    const run = await lint({ "a.jsx": onOneLine, ...bunfig({ [id]: "error" }) }, ["--fix", "-f", "unix", "a.jsx"]);
    // No "Fixed 1 problem" and no warning about circular fixes.
    expect(run).toEqual({
      stdout: `<dir>/a.jsx:3:20: JSX element should start in a new line [Error/${id}]\n\n1 problem\n`,
      stderr: "Linted 1 file\n",
      exitCode: 1,
    });
  });
});

// oxlint renames in all of these cases, which merges two different variables into one.
describe.concurrent("unicorn/catch-error-name only renames when `error` isn't already in use", () => {
  const id = "unicorn/catch-error-name";

  /** Returns, for each report, `code` with its fix applied, or `null` if it has no fix. */
  async function renamed(code: string) {
    const run = await lint({ "a.mjs": code, ...bunfig({ [id]: "error" }) }, ["-f", "json", "a.mjs"]);
    const [{ messages }] = resultsOf(run);
    return messages
      .filter(it => it.ruleId === id)
      .map(({ fix }) => (fix ? code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1]) : null));
  }

  test.each([
    ["the block assigns to an outer `error`", "let error;\ntry {\n  f();\n} catch (e) {\n  error = e;\n}\ng(error);\n"],
    [
      "a function in the block does",
      "let error;\ntry {\n  f();\n} catch (e) {\n  g(() => (error = e));\n}\ng(error);\n",
    ],
    ["the function passed to .catch() does", "let error;\np.catch(e => {\n  error = e;\n});\ng(error);\n"],
    ["the second function passed to .then() reads it", "let error;\np.then(undefined, e => g(e, error));\n"],
    [
      "the block reads the enclosing function's `error` parameter",
      "function f(error) {\n  try {\n    g();\n  } catch (e) {\n    h(error, e);\n  }\n}\nf();\n",
    ],
    ["the block reads a global", "try {\n  f();\n} catch (e) {\n  g(e, error);\n}\n"],
    [
      "an inner block that uses the caught error declares `error`",
      "try {\n  f();\n} catch (e) {\n  {\n    const error = 1;\n    g(e, error);\n  }\n}\n",
    ],
    [
      "an inner function that uses the caught error has an `error` parameter",
      "try {\n  f();\n} catch (e) {\n  g(error => h(e, error));\n}\n",
    ],
    ["the catch block declares `error`", "try {\n  f();\n} catch (e) {\n  const error = 1;\n  g(error);\n}\n"],
    ["the function itself declares `error`", "p.catch(e => {\n  const error = g(e);\n  return error;\n});\n"],
  ])("no fix: %s", async (_, code) => {
    expect(await renamed(code)).toEqual([null]);
  });

  test.each([
    [
      "nothing else is named `error`",
      "try {\n  f();\n} catch (e) {\n  g(e);\n}\n",
      "try {\n  f();\n} catch (error) {\n  g(error);\n}\n",
    ],
    [
      "an outer `error` isn't used in the block",
      "function f(error) {\n  try {\n    g(error);\n  } catch (e) {\n    h(e);\n  }\n}\nf();\n",
      "function f(error) {\n  try {\n    g(error);\n  } catch (error) {\n    h(error);\n  }\n}\nf();\n",
    ],
    [
      "an inner `error` doesn't enclose a use of the caught error",
      "try {\n  f();\n} catch (e) {\n  g(e);\n  h(error => error);\n}\n",
      "try {\n  f();\n} catch (error) {\n  g(error);\n  h(error => error);\n}\n",
    ],
    ["`{ e }` keeps its key", "p.catch(e => g({ e }));\n", "p.catch(error => g({ e: error }));\n"],
  ])("a fix: %s", async (_, code, fixed) => {
    expect(await renamed(code)).toEqual([fixed]);
  });
});

describe.concurrent("comments", () => {
  const rules = bunfig({
    "unicorn/no-null": "error",
    "typescript/no-explicit-any": "error",
    "nextjs/no-img-element": "error",
    "jsx_a11y/alt-text": "error",
    "node/no-exports-assign": "error",
    "react/rules-of-hooks": "error",
  });

  // Both tools' comments work when the project has neither tool's config.
  test.each(["eslint", "oxlint"])("%s-disable works in every form", async tool => {
    const code = `// ${tool}-disable-next-line no-debugger
debugger;
debugger; // ${tool}-disable-line no-debugger
/* ${tool}-disable no-debugger */
debugger;
/* ${tool}-enable no-debugger */
debugger;
// ${tool}-disable-next-line
debugger;
// ${tool}-disable-next-line eslint/no-debugger -- with a reason
debugger;
// ${tool}-disable-next-line typescript/no-explicit-any
export const a: any = 1;
// ${tool}-disable-next-line unicorn/no-null
debugger;
`;
    // The last comment is for another rule, so it's unused.
    expect(problems(await lint({ "a.ts": code, ...rules }, ["-f", "json"]))).toEqual([
      "a.ts:7 no-debugger",
      "a.ts:14 null (warning)",
      "a.ts:15 no-debugger",
    ]);
  });

  test.each(["eslint", "oxlint"])(
    "// %s-disable applies to the rest of the file, up to the next -enable",
    async tool => {
      const code = `debugger;\n// ${tool}-disable no-debugger\ndebugger;\ndebugger;\n// ${tool}-enable no-debugger\ndebugger;\n`;
      expect(problems(await lint({ "a.js": code }, ["-f", "json"]))).toEqual([
        "a.js:1 no-debugger",
        "a.js:6 no-debugger",
      ]);
    },
  );

  test.each(["eslint", "oxlint"])(
    "the message about an unused %s-disable comment uses the comment's own prefix",
    async tool => {
      const files = {
        "a.js": `// ${tool}-disable-next-line no-debugger\nexport const a = 1;\n/* ${tool}-enable no-debugger */\n`,
      };
      expect(await lint(files, ["-f", "unix", "--report-unused-disable-directives"])).toEqual({
        stdout:
          `<dir>/a.js:1:1: Unused ${tool}-disable directive (no problems were reported from 'no-debugger'). [Error]\n` +
          `<dir>/a.js:3:1: Unused ${tool}-enable directive (no matching ${tool}-disable directives were found for 'no-debugger'). [Error]\n` +
          "\n2 problems\n",
        stderr: "Linted 1 file\n",
        exitCode: 1,
      });
    },
  );

  test("eslint- and oxlint- comments can be mixed", async () => {
    const code = `/* oxlint-disable no-debugger */\ndebugger;\n/* eslint-enable no-debugger */\ndebugger;\n`;
    expect(problems(await lint({ "a.js": code }, ["-f", "json"]))).toEqual(["a.js:4 no-debugger"]);
  });

  test("rules about comments skip both tools' directive comments", async () => {
    const code = `// oxlint-disable-next-line no-debugger
debugger;
debugger; // oxlint-disable-line no-debugger
// eslint-disable-next-line no-debugger
debugger;
debugger; // eslint-disable-line no-debugger
// another
`;
    const rules = { "capitalized-comments": "error", "no-inline-comments": "error", "no-debugger": "error" } as const;
    const flat = { "eslint.config.mjs": `export default [{ rules: ${JSON.stringify(rules)} }];\n` };
    const [withBunfig, fixed, withEslint] = await Promise.all([
      lint({ "a.js": code, ...bunfig(rules) }, ["-f", "json"]),
      // Capitalizing a directive comment would break it.
      lint({ "a.js": code, ...bunfig(rules) }, ["-f", "json", "--fix-dry-run"]),
      lint({ "a.js": code, ...flat }, ["-f", "json"]),
    ]);
    expect(problems(withBunfig)).toEqual(["a.js:7 capitalized-comments"]);
    expect(resultsOf(fixed).map(it => [it.messages, it.output])).toEqual([[[], code.replace("another", "Another")]]);
    expect(problems(withEslint)).toEqual([
      "a.js:1 capitalized-comments",
      "a.js:2 no-debugger",
      "a.js:3 capitalized-comments",
      "a.js:3 no-debugger",
      "a.js:3 no-inline-comments",
      "a.js:7 capitalized-comments",
    ]);
  });

  test("eslint-disable accepts every name of a rule", async () => {
    const code = `// eslint-disable-next-line unicorn/no-null
export const a = null;
// eslint-disable-next-line typescript/no-explicit-any
export const b: any = 1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const c: any = 1;
// eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
export const d = <img />;
// eslint-disable-next-line nextjs/no-img-element, jsx_a11y/alt-text
export const e = <img />;
export function F(x) {
  // eslint-disable-next-line react/rules-of-hooks
  if (x) useState();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (x) useState();
}
// eslint-disable-next-line n/no-exports-assign
exports = {};
// eslint-disable-next-line node/no-exports-assign
exports = {};
`;
    const [disabled, enabled] = await Promise.all([
      lint({ "a.tsx": code, ...rules }, ["-f", "json"]),
      lint(
        {
          "a.tsx": code.replaceAll("eslint-disable-next-line", "see"),
          ...rules,
        },
        ["-f", "json"],
      ),
    ]);
    expect(problems(disabled)).toEqual([]);
    expect(problems(enabled)).toEqual([
      "a.tsx:2 unicorn/no-null",
      "a.tsx:4 @typescript-eslint/no-explicit-any",
      "a.tsx:6 @typescript-eslint/no-explicit-any",
      "a.tsx:8 @next/next/no-img-element",
      "a.tsx:8 jsx-a11y/alt-text",
      "a.tsx:10 @next/next/no-img-element",
      "a.tsx:10 jsx-a11y/alt-text",
      "a.tsx:13 react-hooks/rules-of-hooks",
      "a.tsx:15 react-hooks/rules-of-hooks",
      "a.tsx:18 n/no-exports-assign",
      "a.tsx:20 n/no-exports-assign",
    ]);
  });

  test("eslint-disable accepts rules that are off", async () => {
    const code = "// eslint-disable-next-line oxc/no-accumulating-spread, jsx_a11y/alt-text\nexport {};\n";
    expect(problems(await lint({ "a.js": code }, ["-f", "json"]))).toEqual([]);
  });

  test("/* eslint rule: .. */ turns rules on and off", async () => {
    const code = `/* eslint unicorn/no-null: off, eslint/no-var: error, promise/param-names: error, nextjs/no-img-element: off */
export const a = null;
var b = new Promise(ok => ok());
export const c = [b, <img alt="" />];
`;
    expect(problems(await lint({ "a.jsx": code, ...rules }, ["-f", "json"]))).toEqual([
      "a.jsx:3 no-var",
      "a.jsx:3 promise/param-names",
    ]);
  });

  test("enabling an unknown rule in a comment is an error, but disabling one from a known plugin isn't", async () => {
    const code = `/* eslint react-hooks/jsx-key: error, unicorn/nothing: error */
// eslint-disable-next-line unicorn/nothing
export {};
`;
    const run = await lint({ "a.js": code }, ["-f", "json"]);
    expect(problems(run)).toEqual(["a.js:1 react-hooks/jsx-key", "a.js:1 unicorn/nothing"]);
    const messages = resultsOf(run)[0].messages.map(it => it.message);
    expect(messages.sort()).toEqual([
      "Definition for rule 'react-hooks/jsx-key' was not found.",
      "Definition for rule 'unicorn/nothing' was not found.",
    ]);
  });

  test("unicorn/no-abusive-eslint-disable isn't silenced by the comment it reports", async () => {
    const code = "// eslint-disable-next-line\nf();\nf(); // eslint-disable-line\n/* eslint-disable */\nf();\n";
    const run = await lint(
      {
        "a.js": code,
        ...bunfig({ "unicorn/no-abusive-eslint-disable": "error" }),
      },
      ["-f", "json"],
    );
    expect(problems(run).filter(it => ruleOf(it).endsWith("disable"))).toEqual([
      "a.js:1 unicorn/no-abusive-eslint-disable",
      "a.js:3 unicorn/no-abusive-eslint-disable",
      "a.js:4 unicorn/no-abusive-eslint-disable",
    ]);
  });
});

describe.concurrent("[lint.categories]", () => {
  const files = {
    "a.jsx": `[1].map(x => [x]).flat();
[1].reduce((all, x) => [...all, x], []);
export default B => <B list={[]} />;
`,
    "b.ts": "export class A {\n  f(): void;\n  f(a?: number): void {\n    g(a);\n  }\n}\nexport default null;\n",
  };
  const categories = (lines: string) => ({
    "bunfig.toml": `[lint.categories]\n${lines}\n`,
  });

  test("enable rules from several plugins", async () => {
    const react = { "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }) };
    const [plain, perf] = await Promise.all([
      lint({ ...files, ...react }, ["-f", "json"]),
      lint({ ...files, ...react, ...categories(`perf = "error"`) }, ["-f", "json"]),
    ]);
    expect(problems(plain)).toEqual([]);
    expect(problems(perf)).toEqual([
      "a.jsx:1 unicorn/prefer-array-flat-map",
      "a.jsx:2 oxc/no-accumulating-spread",
      "a.jsx:3 react-perf/jsx-no-new-array-as-prop",
    ]);
  });

  test("[lint.rules] overrides categories, and other categories override `all`", async () => {
    const lines = `perf = "off"\nall = "warn"\n[lint.rules]\n"oxc/no-accumulating-spread" = "error"`;
    const found = problems(await lint({ ...files, ...categories(lines) }, ["-f", "json"]));
    // The first two rules are in `perf`, which is off. no-null is in `style`, so only `all` turns it on.
    expect(found.filter(it => /prefer-array-flat-map|no-accumulating-spread|no-null/.test(it))).toEqual([
      "a.jsx:2 oxc/no-accumulating-spread",
      "b.ts:7 unicorn/no-null (warning)",
    ]);
  });

  test("enable the typescript-eslint version of a core rule in TypeScript files", async () => {
    const rules = await configOf({ ...files, ...categories(`correctness = "error"`) }, "b.ts");
    expect(rules["no-dupe-class-members"]).toEqual([0]);
    expect(rules["@typescript-eslint/no-dupe-class-members"]).toEqual([2]);
  });
});

// Each file breaks one `correctness` or `perf` rule per plugin.
const frameworkFiles = {
  "page.jsx": `export const Page = () => <img src="/a.png" style={{}} />;\n`,
  "sum.test.js": `test("adds", () => {\n  expect(1 + 1);\n});\n`,
  "util.js": `export const thenable = { then() {} };\n`,
};
const correctnessAndPerf = `[lint.categories]\ncorrectness = "error"\nperf = "error"\n`;
/** A package.json that lists `names` in `devDependencies`. */
const dependsOn = (...names: string[]) =>
  JSON.stringify({ name: "app", devDependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])) });
/** What each framework's plugins report in `frameworkFiles`. unicorn is a general-purpose plugin, so it always reports. */
const reportedBy = {
  general: ["util.js:1 unicorn/no-thenable"],
  react: ["page.jsx:1 jsx-a11y/alt-text", "page.jsx:1 react-perf/jsx-no-new-object-as-prop"],
  next: ["page.jsx:1 @next/next/no-img-element"],
  jest: ["sum.test.js:2 jest/valid-expect"],
  vitest: ["sum.test.js:2 vitest/valid-expect"],
};
const sorted = (...lists: string[][]) => lists.flat().sort(inOrder);

describe.concurrent("[lint.categories] and framework plugins", () => {
  const { general, react, next, jest, vitest } = reportedBy;
  const project = { ...frameworkFiles, "bunfig.toml": correctnessAndPerf };

  test.each([
    [[], []],
    [["lodash"], []],
    [["react"], react],
    [["next"], next],
    [
      ["next", "react"],
      [...next, ...react],
    ],
    [["jest"], jest],
    [["vitest"], vitest],
    [
      ["jest", "next", "react", "vitest"],
      [...jest, ...next, ...react, ...vitest],
    ],
  ])("with %j in package.json, only those frameworks' rules are enabled", async (names, expected) => {
    const run = await lint({ ...project, "package.json": dependsOn(...names) }, ["-f", "json"]);
    expect(problems(run)).toEqual(sorted(general, expected));
  });

  test("without a package.json, no framework's rules are enabled", async () => {
    expect(problems(await lint(project, ["-f", "json"]))).toEqual(general);
  });

  test("-D works like the key", async () => {
    const files = { ...frameworkFiles, "package.json": dependsOn("vitest") };
    const run = await lint(files, ["-D", "correctness", "-D", "perf", "-f", "json"]);
    expect(problems(run)).toEqual(sorted(general, vitest));
  });

  test("a rule named in [lint.rules] runs whether or not the project uses its framework", async () => {
    const rules = `[lint.rules]\n"@next/next/no-img-element" = "warn"\n"jest/valid-expect" = "error"\n`;
    const [rulesOnly, withCategories] = await Promise.all([
      lint({ ...frameworkFiles, "package.json": dependsOn(), "bunfig.toml": rules }, ["-f", "json"]),
      lint({ ...project, "package.json": dependsOn(), "bunfig.toml": correctnessAndPerf + rules }, ["-f", "json"]),
    ]);
    const warned = next.map(it => `${it} (warning)`);
    expect(problems(rulesOnly)).toEqual(sorted(warned, jest));
    expect(problems(withCategories)).toEqual(sorted(general, warned, jest));
  });

  test("in a monorepo, the closest package.json decides, and a package without a test runner inherits one", async () => {
    const inside = (directory: string) =>
      Object.fromEntries(Object.entries(frameworkFiles).map(([name, text]) => [`${directory}/${name}`, text]));
    const files = {
      "bunfig.toml": correctnessAndPerf,
      "package.json": dependsOn("next", "vitest"),
      "apps/web/package.json": dependsOn("next", "react"),
      ...inside("apps/web"),
      "packages/lib/package.json": dependsOn("lodash"),
      ...inside("packages/lib"),
      "packages/legacy/package.json": dependsOn("jest"),
      ...inside("packages/legacy"),
    };
    const found = async (args: string[]) => {
      const byDirectory: Record<string, (string | null)[]> = {};
      for (const { filePath, messages } of resultsOf(await lint(files, [...args, "-f", "json"]))) {
        const directory = filePath.replaceAll("\\", "/").split("/").slice(-3, -1).join("/");
        (byDirectory[directory] ??= []).push(...messages.map(it => it.ruleId));
      }
      for (const rules of Object.values(byDirectory)) rules.sort();
      return byDirectory;
    };
    const rules = (...lists: string[][]) =>
      lists
        .flat()
        .map(it => it.split(" ")[1])
        .sort();
    const expected = {
      "apps/web": rules(general, next, react, vitest),
      "packages/lib": rules(general, vitest),
      // It has its own test runner. With vitest's rules too, each problem would be reported twice.
      "packages/legacy": rules(general, jest),
    };
    const names = Object.keys(files).filter(it => /\.jsx?$/.test(it));
    // Searching directories and naming files take different code paths.
    expect(await Promise.all([found([]), found(names)])).toEqual([expected, expected]);
  });

  describe("a package.json outside the repository", () => {
    const inside = (directory: string) =>
      Object.fromEntries(Object.entries(frameworkFiles).map(([name, text]) => [`${directory}/${name}`, text]));
    const repository = { "project/.git/HEAD": "ref: refs/heads/main\n" };
    /** Lints from inside `project`, three ways. Detection walks up from a file, and the directory walk goes down from `..`. */
    const runs = async (files: Record<string, string>) => {
      const names = Object.keys(files).filter(it => /\.jsx?$/.test(it));
      const results = await Promise.all([
        lint(files, ["-f", "json"], "project"),
        lint(files, [...names.map(it => it.replace("project/", "")), "-f", "json"], "project"),
        lint(files, ["..", "-f", "json"], "project"),
      ]);
      return results.map(run => problems(run));
    };

    test("doesn't give its test runner to a package in the repository", async () => {
      const files = {
        "bunfig.toml": correctnessAndPerf,
        "package.json": dependsOn("jest"),
        "project/bunfig.toml": correctnessAndPerf,
        "project/package.json": dependsOn("lodash"),
        ...inside("project"),
        "project/nested/package.json": dependsOn("lodash"),
        ...inside("project/nested"),
      };
      const [plain, inRepository, fromAbove] = await Promise.all([
        runs(files),
        runs({ ...files, ...repository }),
        lint({ ...files, ...repository }, ["project", "-f", "json"]),
      ]);
      const inherited = sorted(general, general, jest, jest);
      expect(plain).toEqual([inherited, inherited, inherited]);
      const bounded = sorted(general, general);
      expect(inRepository).toEqual([bounded, bounded, bounded]);
      // The working directory makes no difference.
      expect(problems(fromAbove)).toEqual(bounded);
    });

    test("still decides about React and Next.js for a repository that has none at its root", async () => {
      const files = {
        "bunfig.toml": correctnessAndPerf,
        "package.json": dependsOn("jest", "next", "react"),
        "project/bunfig.toml": correctnessAndPerf,
        // No package.json up to the root of the repository, so the closest one is outside.
        ...inside("project/scripts"),
        // Its own package.json decides about the frameworks, and would inherit a test runner.
        "project/backend/package.json": dependsOn("lodash"),
        ...inside("project/backend"),
      };
      const [plain, inRepository] = await Promise.all([runs(files), runs({ ...files, ...repository })]);
      const outside = sorted(general, general, jest, jest, next, react);
      expect(plain).toEqual([outside, outside, outside]);
      // Only the test runner stops at the root of the repository.
      const bounded = sorted(general, general, next, react);
      expect(inRepository).toEqual([bounded, bounded, bounded]);
    });
  });

  test("a submodule without a package.json is part of the React project around it", async () => {
    const files = {
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": dependsOn("react"),
      "packages/ui/.git": "gitdir: ../../.git/modules/ui\n",
      "packages/ui/app.jsx": `export function App({ on }) {\n  if (on) useState(0);\n  return null;\n}\n`,
    };
    const results = await Promise.all([
      lint(files, ["-f", "json"]),
      lint(files, ["packages/ui/app.jsx", "-f", "json"]),
      lint(files, ["-f", "json"], "packages/ui"),
      lint(files, ["app.jsx", "-f", "json"], "packages/ui"),
    ]);
    const hooksProblems = results.map(run => problems(run).filter(it => it.includes(" react-hooks/")));
    expect(hooksProblems).toEqual(Array.from({ length: 4 }, () => ["app.jsx:2 react-hooks/rules-of-hooks"]));
  });

  test("--print-config detects frameworks from the file's path", async () => {
    const files = {
      "bunfig.toml": correctnessAndPerf,
      "package.json": dependsOn(),
      "web/package.json": dependsOn("next"),
    };
    const isOn = async (file: string): Promise<unknown> => (await configOf(files, file))["@next/next/no-img-element"];
    expect(await Promise.all([isOn("web/page.jsx"), isOn("page.jsx")])).toEqual([[2], undefined]);
  });
});

describe.concurrent(`"plugin/*" = "off" turns off every rule of a plugin`, () => {
  const { general, react, next, jest, vitest } = reportedBy;
  const everything = { ...frameworkFiles, "package.json": dependsOn("jest", "next", "react", "vitest") };
  const found = async (bunfig: string, args: string[] = [], files: Record<string, string> = everything) =>
    problems(await lint({ ...files, "bunfig.toml": bunfig }, [...args, "-f", "json"]));

  // First in the suite for the same reason `[lint.settings]` is early: each of these runs starts a JavaScript VM.
  test("it covers the rules of a JavaScript plugin", async () => {
    const plugin = `const rule = { create: context => ({ Program: node => context.report({ node, message: "found" }) }) };
export default { meta: { name: "demo" }, rules: { one: rule, two: rule } };\n`;
    const files = { "a.js": "export {};\n", "demo.js": plugin };
    const load = `[lint]\nplugins = ["./demo.js"]\nignorePatterns = ["demo.js"]\n[lint.rules]\n`;
    const listedByName = `${load}"demo/one" = "error"\n"demo/two" = "error"\n`;
    expect(
      await Promise.all([
        found(listedByName, [], files),
        found(listedByName, ["--rule", "demo/*: off"], files),
        found(`${load}"demo/*" = "off"\n"demo/two" = "error"\n`, [], files),
      ]),
    ).toEqual([["a.js:1 demo/one", "a.js:1 demo/two"], [], ["a.js:1 demo/two"]]);
  });

  test("off wins over a category", async () => {
    const rules = `[lint.rules]\n"nextjs/*" = "off"\n"jest/*" = "off"\n`;
    expect(await found(correctnessAndPerf + rules)).toEqual(sorted(general, react, vitest));
  });

  test.each(["nextjs", "@next/next"])("%s/* works, like every other spelling of the plugin's name", async name => {
    expect(await found(`${correctnessAndPerf}[lint.rules]\n"${name}/*" = "off"\n`)).toEqual(
      sorted(general, react, jest, vitest),
    );
  });

  test("it turns a general-purpose plugin off too", async () => {
    expect(await found(`${correctnessAndPerf}[lint.rules]\n"unicorn/*" = "off"\n`)).toEqual(
      sorted(react, next, jest, vitest),
    );
  });

  test("react/* and react-hooks/* are separate plugins", async () => {
    const hooks = `export function App({ on }) {\n  if (on) useState(0);\n  return <div children="a" />;\n}\n`;
    const files = { "app.jsx": hooks, "package.json": dependsOn("react") };
    const [hooksProblem, reactProblem] = ["app.jsx:2 react-hooks/rules-of-hooks", "app.jsx:3 react/no-children-prop"];
    const correctness = `[lint.categories]\ncorrectness = "error"\n`;
    const reactProblems = async (bunfig: string) =>
      (await found(bunfig, [], files)).filter(it => it.includes(" react"));
    const off = (name: string) => reactProblems(`${correctness}[lint.rules]\n"${name}/*" = "off"\n`);
    expect(
      await Promise.all([reactProblems(correctness), off("react"), off("react-hooks"), off("react_hooks")]),
    ).toEqual([[hooksProblem, reactProblem], [hooksProblem], [reactProblem], [reactProblem]]);
  });

  test("react/* leaves react/jsx-uses-react on, which only keeps no-unused-vars quiet about React", async () => {
    const files = {
      "app.jsx": `import React from "react";\nexport const App = () => <div />;\n`,
      "package.json": dependsOn("react"),
    };
    const off = `[lint.rules]\n"react/*" = "off"\n`;
    expect(
      await Promise.all([found(off, [], files), found(`${off}"react/jsx-uses-react" = "off"\n`, [], files)]),
    ).toEqual([[], ["app.jsx:1 no-unused-vars (warning)"]]);
  });

  describe("a rule that has an ESLint and a typescript-eslint version", () => {
    const unused = "const unused = 1;\nexport {};\n";
    const files = { "a.js": unused, "b.ts": unused };
    const [inJavaScript, inTypeScript] = ["a.js:1 no-unused-vars", "b.ts:1 @typescript-eslint/no-unused-vars"];
    const [warnedInJavaScript, warnedInTypeScript] = [`${inJavaScript} (warning)`, `${inTypeScript} (warning)`];

    test.each([
      // The defaults warn about it in both languages.
      ["", [warnedInJavaScript, warnedInTypeScript]],
      [`"@typescript-eslint/*" = "off"`, [warnedInJavaScript]],
      [`"typescript/*" = "off"`, [warnedInJavaScript]],
      [`"eslint/*" = "off"`, [warnedInTypeScript]],
      [`"eslint/*" = "off"\n"@typescript-eslint/*" = "off"`, []],
      // Naming the rule still sets both, and overrides the wildcards.
      [`"eslint/*" = "off"\n"@typescript-eslint/*" = "off"\n"no-unused-vars" = "error"`, [inJavaScript, inTypeScript]],
    ])("%j only turns it off in that plugin's language", async (lines, expected) => {
      const all = await found(`[lint]\ntypeAware = false\n[lint.rules]\n${lines}\n`, [], files);
      expect(all.filter(it => it.includes("no-unused-vars"))).toEqual(expected);
    });
  });

  test("a single rule overrides the wildcard, whichever is written first", async () => {
    const single = `"jsx-a11y/alt-text" = "error"`;
    const wildcard = `"jsx-a11y/*" = "off"`;
    const expected = ["page.jsx:1 jsx-a11y/alt-text"];
    expect(
      await Promise.all([
        found(`[lint.rules]\n${single}\n${wildcard}\n`),
        found(`[lint.rules]\n${wildcard}\n${single}\n`),
      ]),
    ).toEqual([expected, expected]);
  });

  test("--rule overrides [lint.rules], for wildcards and single rules alike", async () => {
    const altText = ["page.jsx:1 jsx-a11y/alt-text"];
    const single = (severity: string) => `[lint.rules]\n"jsx-a11y/alt-text" = "${severity}"\n`;
    const wildcard = `[lint.rules]\n"jsx-a11y/*" = "off"\n`;
    const both = `${wildcard}"jsx-a11y/alt-text" = "error"\n`;
    expect(
      await Promise.all([
        // A wildcard flag beats a single rule in the file, with or without a wildcard in the file.
        found(single("error"), ["--rule", "jsx-a11y/*: off"]),
        found(both, ["--rule", "jsx-a11y/*: off"]),
        // A single-rule flag beats a wildcard in the file.
        found(wildcard, ["--rule", "jsx-a11y/alt-text: error"]),
        // Between two flags, the single rule wins in either order.
        found(single("off"), ["--rule", "jsx-a11y/*: off", "--rule", "jsx-a11y/alt-text: error"]),
        found(single("off"), ["--rule", "jsx-a11y/alt-text: error", "--rule", "jsx-a11y/*: off"]),
        // A wildcard flag for one plugin leaves the file's rules for other plugins alone.
        found(single("error"), ["--rule", "unicorn/*: off"]),
        // -A and -D are flags like --rule.
        found(single("off"), ["-D", "jsx-a11y/alt-text", "--rule", "jsx-a11y/*: off"]),
        found(single("off"), ["--rule", "jsx-a11y/alt-text: error", "-A", "jsx-a11y/*"]),
        found(single("error"), ["-A", "jsx-a11y/*"]),
      ]),
    ).toEqual([[], [], altText, altText, altText, altText, altText, altText, []]);
  });

  test("a flag also wins for files outside the directory of bunfig.toml", async () => {
    const files = {
      "app/bunfig.toml": `[lint.rules]\n"unicorn/no-null" = "warn"\n`,
      "app/a.js": "export const a = null;\n",
      "shared/x.js": "export const x = null;\n",
    };
    const run = async (args: string[]) => problems(await lint(files, ["..", ...args, "-f", "json"], "app"));
    expect(await Promise.all([run([]), run(["--rule", "unicorn/*: off"]), run(["-A", "unicorn/*"])])).toEqual([
      ["a.js:1 unicorn/no-null (warning)", "x.js:1 unicorn/no-null (warning)"],
      [],
      [],
    ]);
  });

  test("--rule, -A and [[lint.overrides]] accept it", async () => {
    const withoutNext = sorted(general, react, jest, vitest);
    const override = `[[lint.overrides]]\nfiles = ["*.jsx"]\nrules = { "nextjs/*" = "off" }\n`;
    expect(
      await Promise.all([
        found(correctnessAndPerf, ["--rule", "nextjs/*: off"]),
        found(correctnessAndPerf, ["-A", "nextjs/*"]),
        found(correctnessAndPerf, ["--rule", "nextjs/*: [off]"]),
        found(`${correctnessAndPerf}[lint.rules]\n"nextjs/*" = ["off"]\n`),
        found(correctnessAndPerf + override),
      ]),
    ).toEqual([withoutNext, withoutNext, withoutNext, withoutNext, withoutNext]);
  });

  const onlyOff = `"nextjs/*" can only be "off"\n  To turn rules on, name them or use [lint.categories]`;

  // A line in `[lint.rules]`, the column the caret points at, and the error message.
  test.each([
    [`"nextj/*" = "off"`, 1, `Unknown plugin "nextj"\n  Did you mean "nextjs/*"?`],
    [`"jsx-ally/*" = "off"`, 1, `Unknown plugin "jsx-ally"\n  Did you mean "jsx-a11y/*"?`],
    [`"m/*" = "off"`, 1, `Unknown plugin "m"\n  Did you mean "n/*"?`],
    [
      `"perfectionist/*" = "off"`,
      1,
      `Unknown rule "perfectionist/*"\n  To use a rule from an ESLint plugin, add the plugin to plugins in [lint]`,
    ],
    [`"/*" = "off"`, 1, `Unknown rule "/*"`],
    [`"nextjs/*" = "always"`, 14, onlyOff],
    [`"nextjs/*" = "warn"`, 14, onlyOff],
    [`"nextjs/*" = ["error", {}]`, 15, onlyOff],
  ])("%s is rejected", async (line, column, message) => {
    const run = await lint({ ...everything, "bunfig.toml": `[lint.rules]\n${line}\n` });
    expect(run).toEqual(refused(2, column, line, message));
  });

  test.each([[["--rule", "nextjs/*: error"]], [["-W", "nextjs/*"]], [["-D", "nextjs/*"]]])(
    "%j is rejected",
    async args => {
      expect(await lint(everything, args)).toEqual({
        stdout: "",
        stderr: `error: ${onlyOff}\nnote: run 'bun lint --help' for more information\n`,
        exitCode: 2,
      });
    },
  );

  // Only native mode expands wildcards. With another config for the working directory they would silently do nothing.
  describe.each([
    [
      "eslint.config.js",
      `export default [{ rules: { "no-debugger": "error" } }];\n`,
      "eslint.config.js, an ESLint config.",
    ],
    [
      ".eslintrc.json",
      `{ "root": true, "rules": { "no-debugger": "error" } }\n`,
      ".eslintrc.json, an ESLint 8 config.",
    ],
    [".oxlintrc.json", `{ "rules": { "no-debugger": "error" } }\n`, ".oxlintrc.json, an oxlint config."],
    // No config file, but the dependency makes the run use oxlint's defaults.
    ["package.json", `{ "devDependencies": { "oxlint": "1.0.0" } }\n`, "oxlint's defaults."],
  ])("next to %s", (name, config, uses) => {
    const files = { "a.js": "export {};\n", [name]: config };
    const message = `"unicorn/*" only works with Bun's own lint config\n  This run uses ${uses}`;

    // A bunfig.toml, and the line and column of the wildcard in it.
    test.each([
      [`[lint.rules]\n"unicorn/*" = "off"\n`, 2, 1],
      [`[[lint.overrides]]\nfiles = ["*.js"]\nrules = { "unicorn/*" = "off" }\n`, 3, 11],
    ])("%j is rejected", async (bunfig, line, column) => {
      const run = await lint({ ...files, "bunfig.toml": bunfig });
      expect(run).toEqual(refused(line, column, bunfig.split("\n")[line - 1], message));
    });

    test.each([[["--rule", "unicorn/*: off"]], [["-A", "unicorn/*"]]])("%j is rejected", async args => {
      expect(await lint(files, args)).toEqual({ stdout: "", stderr: `error: ${message}\n`, exitCode: 2 });
    });
  });

  test("--no-config-lookup is rejected too, and the error doesn't mention a file", async () => {
    const run = await lint({ "a.js": "export {};\n" }, ["--no-config-lookup", "--rule", "unicorn/*: off"]);
    expect(run).toEqual({
      stdout: "",
      stderr: `error: "unicorn/*" only works with Bun's own lint config\n  This run uses ESLint's defaults.\n`,
      exitCode: 2,
    });
  });

  const legacy = ["b.js:1 no-debugger"];
  // oxlint's default rules apply in its directory. 15 of them need types, and none of those run without --type-aware.
  const skipped = "warn: Skipped 15 rules that need type information\n  Use --type-aware to run them.\n";

  // The config of packages/legacy, what it reports there, and what the run warns about.
  test.each([
    ["packages/legacy/.eslintrc.json", `{ "root": true, "rules": { "no-debugger": "error" } }\n`, legacy, ""],
    [
      "packages/legacy/.oxlintrc.json",
      `{ "rules": { "no-debugger": "error" } }\n`,
      [...legacy, "b.js:2 unicorn/no-thenable"],
      skipped,
    ],
    ["packages/legacy/eslint.config.js", `export default [{ rules: { "no-debugger": "error" } }];\n`, legacy, ""],
  ])(
    "a nested %s doesn't fail the run, and the wildcard applies to the rest of the project",
    async (name, config, inLegacy, warnings) => {
      // ES5, which is what ESLint 8 parses by default.
      const code = "debugger;\nvar thenable = { then: function () {} };\n";
      const files = { "a.js": code, "packages/legacy/b.js": code, [name]: config };
      const bunfig = `[lint.categories]\ncorrectness = "error"\n[lint.rules]\n"unicorn/*" = "off"\n`;
      const run = await lint({ ...files, "bunfig.toml": bunfig }, ["-f", "json"]);
      const found = problems(run, warnings).filter(it => /no-debugger|unicorn/.test(it));
      expect(found).toEqual(["a.js:1 no-debugger", ...inLegacy]);
    },
  );
});

describe.concurrent("unknown rules", () => {
  const source = { "a.js": "debugger;\n" };
  const cases: [written: string, said: string, saidToFlag?: string][] = [
    // Typos in a core rule, a plugin rule, and a plugin name.
    ["no-vra", `Unknown rule "no-vra"\n  Did you mean "no-var"?`],
    ["eslint/no-vra", `Unknown rule "eslint/no-vra"\n  Did you mean "eslint/no-var"?`],
    ["unicorn/no-nul", `Unknown rule "unicorn/no-nul"\n  Did you mean "unicorn/no-null"?`],
    ["unicron/no-null", `Unknown rule "unicron/no-null"\n  Did you mean "unicorn/no-null"?`],
    [
      "typescript/no-explicit-ayn",
      `Unknown rule "typescript/no-explicit-ayn"\n  Did you mean "typescript/no-explicit-any"?`,
    ],
    [
      "@typescript-eslint/no-explict-any",
      `Unknown rule "@typescript-eslint/no-explict-any"\n  Did you mean "@typescript-eslint/no-explicit-any"?`,
    ],
    // No plugin typed, so the suggestion uses the ID that reports print.
    ["no-explicit-an", `Unknown rule "no-explicit-an"\n  Did you mean "@typescript-eslint/no-explicit-any"?`],
    ["rules-of-hook", `Unknown rule "rules-of-hook"\n  Did you mean "react-hooks/rules-of-hooks"?`],
    ["no-img-elemnt", `Unknown rule "no-img-elemnt"\n  Did you mean "@next/next/no-img-element"?`],
    ["no-exports-asign", `Unknown rule "no-exports-asign"\n  Did you mean "n/no-exports-assign"?`],
    // The suggestion keeps the plugin spelling the user typed.
    ["nextjs/no-img-elemnt", `Unknown rule "nextjs/no-img-elemnt"\n  Did you mean "nextjs/no-img-element"?`],
    ["node/no-proces-exit", `Unknown rule "node/no-proces-exit"\n  Did you mean "node/no-process-exit"?`],
    ["react/rules-of-hook", `Unknown rule "react/rules-of-hook"\n  Did you mean "react/rules-of-hooks"?`],
    // Right rule name, missing or wrong plugin.
    ["no-null", `Unknown rule "no-null"\n  Did you mean "unicorn/no-null"?`],
    ["react-hooks/jsx-key", `Unknown rule "react-hooks/jsx-key"\n  Did you mean "react/jsx-key"?`],
    // Nothing is close enough to suggest.
    [
      "foo/bar-baz",
      `Unknown rule "foo/bar-baz"\n  To use a rule from an ESLint plugin, add the plugin to plugins in [lint]`,
      `Unknown rule "foo/bar-baz"\n  To use a rule from an ESLint plugin, load the plugin with --plugin`,
    ],
    // The plugin is already built in.
    [
      "react/only-in-the-package",
      `Unknown rule "react/only-in-the-package"\n  react is built in and has no rule of that name\n  To run a rule of the package, load it under another name in [lint]: plugins = [{ name = "react-js", specifier = "eslint-plugin-react" }]`,
    ],
    [
      "typescript/only-in-the-package",
      `Unknown rule "typescript/only-in-the-package"\n  typescript is built in and has no rule of that name\n  To run a rule of the package, load it under another name in [lint]: plugins = [{ name = "typescript-js", specifier = "@typescript-eslint/eslint-plugin" }]`,
    ],
    // There's no package that could have these rules.
    ["bun/only-in-the-package", `Unknown rule "bun/only-in-the-package"`],
    ["oxc/only-in-the-package", `Unknown rule "oxc/only-in-the-package"`],
    ["eslint/only-in-the-package", `Unknown rule "eslint/only-in-the-package"`],
    ["perfectly-fine", `Unknown rule "perfectly-fine"`],
    // Rules that bun lint deliberately doesn't implement.
    ["indent", `"indent" is a formatting rule\n  bun fmt does that`],
    ["eslint/semi", `"eslint/semi" is a formatting rule\n  bun fmt does that`],
    ["@stylistic/quotes", `"@stylistic/quotes" is a formatting rule\n  bun fmt does that`],
    [
      "jsdoc/require-param",
      `"jsdoc/require-param" is not supported\n  bun lint has no jsdoc rules. To run eslint-plugin-jsdoc, add it to plugins in [lint]`,
    ],
    [
      "vue/no-dupe-keys",
      `"vue/no-dupe-keys" is not supported\n  bun lint has no vue rules. To run eslint-plugin-vue, add it to plugins in [lint]`,
    ],
    // --rules lists these, but only an ESLint config can specify which files are JSON or Markdown.
    [
      "json/no-duplicate-keys",
      `"json/no-duplicate-keys" needs an ESLint config\n  Set language: "json/json" for the files in an eslint.config.js`,
    ],
    [
      "markdown/no-empty-links",
      `"markdown/no-empty-links" needs an ESLint config\n  Set language: "markdown/commonmark" for the files in an eslint.config.js`,
    ],
  ];

  test.each(cases)("%s is rejected", async (key, message, flagMessage = message) => {
    const [inFile, byFlag] = await Promise.all([
      lint({
        ...source,
        "bunfig.toml": `[lint.rules]\n"no-debugger" = "error"\n"${key}" = "error"\n`,
      }),
      lint(source, ["--rule", JSON.stringify({ [key]: "error" })]),
    ]);
    expect(inFile).toEqual(refused(3, 1, `"${key}" = "error"`, message));
    expect(byFlag).toEqual({
      stdout: "",
      stderr: `error: ${flagMessage}\n`,
      exitCode: 2,
    });
  });

  test("are rejected even when set to off, except rules that were left out on purpose", async () => {
    const [mistyped, leftOut] = await Promise.all([
      lint({ ...source, ...bunfig({ "no-debuger": "off" }) }, ["-f", "json"]),
      lint(
        {
          ...source,
          ...bunfig({
            indent: "off",
            "jsdoc/require-param": "off",
            "vue/no-dupe-keys": 0 as never,
          }),
        },
        ["-f", "json"],
      ),
    ]);
    expect(mistyped).toEqual(
      refused(2, 1, `"no-debuger" = "off"`, `Unknown rule "no-debuger"\n  Did you mean "no-debugger"?`),
    );
    expect(problems(leftOut)).toEqual(["a.js:1 no-debugger"]);
  });

  test("no-restricted-syntax/<name> is a valid extra instance of no-restricted-syntax", async () => {
    const run = await lint(
      {
        ...source,
        ...bunfig({
          "no-debugger": "off",
          "no-restricted-syntax/mine": ["error", "DebuggerStatement"],
        }),
      },
      ["-f", "json"],
    );
    expect(problems(run)).toEqual(["a.js:1 no-restricted-syntax/mine"]);
  });
});

describe.concurrent("invalid rule settings", () => {
  const source = { "a.js": "export {};\n" };
  // A line in `[lint.rules]`, the column the caret points at, and the error message.
  const cases: [line: string, column: number, said: string][] = [
    [
      `"eqeqeq" = ["error", "smrt"]`,
      22,
      `"smrt" is not a valid option for eqeqeq\n  Expected "always", "smart", or "allow-null"`,
    ],
    [
      `"no-console" = ["warn", { alow = ["log"] }]`,
      27,
      `Unknown option "alow" for no-console\n  Did you mean "allow"?`,
    ],
    [`"no-console" = ["warn", { allow = ["lgo"] }]`, 36, ""],
    [
      `"no-console" = ["warn", { allow = "log" }]`,
      35,
      `"log" is not valid for "allow" of no-console\n  Expected an array`,
    ],
    [`"no-debugger" = ["error", "always"]`, 27, `no-debugger takes no options`],
    [`"eqeqeq" = ["error", "always", { null = "ignore" }, 1]`, 53, `eqeqeq takes at most 2 options`],
    [
      `"max-depth" = ["error", -1]`,
      25,
      `-1 is not a valid option for max-depth\n  Expected a number that is at least 0 or an object`,
    ],
    [
      `"typescript/ban-ts-comment" = ["error", { minimumDescriptionLength = "3" }]`,
      70,
      `"3" is not valid for "minimumDescriptionLength" of typescript/ban-ts-comment\n  Expected a number`,
    ],
    [
      `"import/enforce-node-protocol-usage" = "error"`,
      40,
      `import/enforce-node-protocol-usage needs at least 1 option`,
    ],
    [`"eqeqeq" = "eror"`, 12, `"eror" is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"`],
    [
      `"eqeqeq" = ["eror", "smart"]`,
      13,
      `"eror" is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"`,
    ],
    // The schema accepts this, but the rule itself throws.
    [
      `"no-restricted-syntax" = ["error", "Foo["]`,
      36,
      `Invalid options for no-restricted-syntax\n  Syntax error in selector "Foo[" at position 4: Expected " " or [^ [\\],():#!=><~+.] but end of input found.`,
    ],
    [`"eqeqeq" = 3`, 12, `3 is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"`],
  ];

  test.each(cases.filter(it => it[2] !== ""))("%s is rejected", async (line, column, message) => {
    const run = await lint({ ...source, "bunfig.toml": `[lint.rules]\n${line}\n` });
    expect(run).toEqual(refused(2, column, line, message));
  });

  test("--rule prints the same errors without a code frame", async () => {
    const [options, severity, overBunfig] = await Promise.all([
      lint(source, ["--rule", `eqeqeq: [error, smrt]`]),
      lint(source, ["--rule", `eqeqeq: eror`]),
      lint({ ...source, ...bunfig({ eqeqeq: ["error", "smart"] }) }, ["--rule", `eqeqeq: [error, smrt]`]),
    ]);
    const expectedError = `error: "smrt" is not a valid option for eqeqeq\n  Expected "always", "smart", or "allow-null"\n`;
    expect(options).toEqual({ stdout: "", stderr: expectedError, exitCode: 2 });
    expect(overBunfig).toEqual({ stdout: "", stderr: expectedError, exitCode: 2 });
    expect(severity).toEqual({
      stdout: "",
      stderr: `error: "eror" is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"\n`,
      exitCode: 2,
    });
  });

  test.each(["eqeqeq:", "eqeqeq: ", "no-var: error, eqeqeq:", "eqeqeq: [, smart]", "", " ", "{}"])(
    "--rule %j is rejected: it has a rule without a severity, or no rule",
    async value => {
      expect(await lint({ ...source, ...bunfig({ eqeqeq: "error" }) }, ["--rule", value])).toEqual({
        stdout: "",
        stderr: `error: Invalid value for option 'rule' - expected type Object, received value: ${value}.\nnote: run 'bun lint --help' for more information\n`,
        exitCode: 2,
      });
    },
  );

  test("the error for a bad --rule doesn't point at the bunfig.toml line that sets the same rule", async () => {
    expect(await lint({ ...source, ...bunfig({ eqeqeq: "warn" }) }, ["--rule", "eqeqeq: null"])).toEqual({
      stdout: "",
      stderr: `error: null is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"\n`,
      exitCode: 2,
    });
  });

  test("options aren't validated when the rule is off", async () => {
    const run = await lint({ ...source, ...bunfig({ eqeqeq: ["off", "smrt"] }) }, ["-f", "json"]);
    expect(problems(run)).toEqual([]);
  });

  test("an invalid category severity is rejected", async () => {
    const run = await lint({ ...source, "bunfig.toml": `[lint.categories]\nstyle = "eror"\n` });
    expect(run).toEqual(
      refused(2, 9, `style = "eror"`, `"eror" is not a valid severity for style\n  Expected "off", "warn", or "error"`),
    );
  });
});

describe.concurrent("ESLint and oxlint configs keep their own behavior", () => {
  const source = { "a.js": "export default null;\n" };
  const flat = (rules: unknown) => ({
    "eslint.config.mjs": `export default [{ rules: ${JSON.stringify(rules)} }];\n`,
  });

  test("to an ESLint config, oxlint-disable and // eslint-disable are ordinary comments", async () => {
    const code = `// oxlint-disable-next-line no-debugger\ndebugger;\n// eslint-disable no-debugger\ndebugger;\n// eslint-disable-next-line no-debugger\ndebugger;\n`;
    const legacy = { root: true, rules: { "no-debugger": "error" } };
    const [inFlat, inLegacy] = await Promise.all([
      lint({ "a.js": code, ...flat({ "no-debugger": "error" }) }, ["-f", "json"]),
      lint({ "a.js": code, ".eslintrc.json": JSON.stringify(legacy) }, ["-f", "json"]),
    ]);
    expect(problems(inFlat)).toEqual(["a.js:2 no-debugger", "a.js:4 no-debugger"]);
    expect(problems(inLegacy)).toEqual(["a.js:2 no-debugger", "a.js:4 no-debugger"]);
  });

  test("with an ESLint config, eslint/no-var in a disable comment isn't treated as no-var", async () => {
    const code =
      "var a = 1; // eslint-disable-line eslint/no-var\nvar b = 2; // eslint-disable-line no-var\nexport { a, b };\n";
    const run = await lint({ "a.js": code, ...flat({ "no-var": "error" }) }, ["-f", "json"]);
    expect(problems(run)).toEqual(["a.js:1 eslint/no-var", "a.js:1 no-var"]);
    const notFound = resultsOf(run).flatMap(it => it.messages.filter(it => it.ruleId === "eslint/no-var"));
    expect(notFound.map(it => it.message)).toEqual(["Definition for rule 'eslint/no-var' was not found."]);
  });

  test("an ESLint config still has to declare its plugins", async () => {
    const [inFile, inBunfig] = await Promise.all([
      lint({ ...source, ...flat({ "unicorn/no-null": "error" }) }),
      lint({
        ...source,
        ...flat({}),
        ...bunfig({ "unicorn/no-null": "error" }),
      }),
    ]);
    const message = `Key "rules": Key "unicorn/no-null": Could not find plugin "unicorn" in configuration.\n`;
    expect(inFile).toEqual({
      stdout: "",
      stderr: `error: Invalid config in eslint.config.mjs\n${message}`,
      exitCode: 2,
    });
    expect(inBunfig).toEqual({ stdout: "", stderr: `error: Invalid config in bunfig.toml\n${message}`, exitCode: 2 });
  });

  test("invalid options print ESLint's message under a line with the config file's name", async () => {
    const notAllowed = `\tValue "smrt" should be equal to one of the allowed values.\n`;
    const values = `${notAllowed}${notAllowed}\tValue ["smrt"] should match some schema in anyOf.\n\n`;
    const words = `Key "rules": Key "eqeqeq":\n${values}`;
    const wrong = { eqeqeq: ["error", "smrt"] as Setting };
    const legacy = {
      root: true,
      parserOptions: { sourceType: "module" },
      rules: wrong,
    };
    const [inFile, inLegacy, inBunfig, byFlag] = await Promise.all([
      lint({ ...source, ...flat(wrong) }),
      lint({ ...source, ".eslintrc.json": JSON.stringify(legacy) }),
      lint({ ...source, ...flat({}), ...bunfig(wrong) }),
      lint({ ...source, ...flat({}) }, ["--rule", JSON.stringify(wrong)]),
    ]);
    const invalid = (where: string, message: string): Run => ({
      stdout: "",
      stderr: `error: Invalid config in ${where}\n${message}`,
      exitCode: 2,
    });
    expect(inFile).toEqual(invalid("eslint.config.mjs", words));
    expect(inLegacy).toEqual(
      invalid(".eslintrc.json", `.eslintrc.json:\n\tConfiguration for rule "eqeqeq" is invalid:\n${values}`),
    );
    expect(inBunfig).toEqual(invalid("bunfig.toml", words));
    expect(byFlag).toEqual(invalid("--rule", words));
  });

  test("an oxlint config reports rules under oxlint's names", async () => {
    const run = await lint(
      {
        ...source,
        ".oxlintrc.json": JSON.stringify({
          rules: { "unicorn/no-null": "error" },
        }),
      },
      ["-f", "unix"],
    );
    expect(run).toEqual({
      stdout: "a.js:1:16: Do not use `null` literals [Error/unicorn(no-null)]\n\n1 problem\n",
      stderr: "",
      exitCode: 1,
    });
  });
});
