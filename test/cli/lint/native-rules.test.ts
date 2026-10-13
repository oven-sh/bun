// Tests for `bun lint` in projects with no ESLint or oxlint config. Every built-in rule can be set in bunfig.toml's
// `[lint.rules]`, with `--rule`, and in comments, under any of its names. An unknown rule name is an error.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

async function lint(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("bun-lint-native", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
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

/** Returns every problem as `file:line rule`, sorted. */
const problems = (stdout: string) =>
  (
    JSON.parse(stdout) as {
      filePath: string;
      messages: { line: number; ruleId: string | null; severity: number }[];
    }[]
  )
    .flatMap(file => file.messages.map(it => `${basename(file.filePath)}:${it.line} ${it.ruleId}`))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

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

type Listed = { scope: string; value: string; type_aware: boolean };

async function listed() {
  const { stdout } = await lint({}, ["--rules", "-f", "json"]);
  const rules = JSON.parse(stdout) as Listed[];
  expect(rules.length).toBeGreaterThan(1000);
  expect([...new Set(rules.map(it => it.scope))].filter(it => !(it in spellings))).toEqual([]);
  return rules;
}

/** Lists every core rule that has a typescript-eslint version, and whether that version needs type information. */
function pairsOf(rules: Listed[]) {
  const ofESLint = new Set(rules.filter(it => it.scope === "eslint").map(it => it.value));
  const base = (name: string) => (name === "only-throw-error" ? "no-throw-literal" : name);
  return rules
    .filter(it => it.scope === "typescript" && ofESLint.has(base(it.value)))
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
  async function configured(files: Record<string, string>, file: string) {
    const { stdout, stderr, exitCode } = await lint({ ...sources, ...files }, ["--print-config", file]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { rules } = JSON.parse(stdout) as {
      rules: Record<string, [number, ...unknown[]]>;
    };
    return new Map(Object.entries(rules).map(([id, [severity]]) => [id, severity]));
  }

  test("is accepted under all of its names and resolves to the same ID", async () => {
    const rules = await listed();
    // `--rules` lists eslint-plugin-react-hooks rules under `react`, like oxlint does.
    const asListed = await configured(
      bunfig(Object.fromEntries(rules.map(it => [`${it.scope}/${it.value}`, setting(it.value, "error")]))),
      "d.tsx",
    );
    const ofHooks = (it: { scope: string; value: string }) =>
      it.scope === "react" && asListed.has(`react-hooks/${it.value}`);
    expect(rules.filter(ofHooks).map(it => it.value)).toContain("rules-of-hooks");
    expect(rules.filter(ofHooks).map(it => it.value)).toContain("exhaustive-deps");
    expect(rules.filter(ofHooks).map(it => it.value)).not.toContain("jsx-key");
    const names = rules.map(it => spellings[ofHooks(it) ? "react-hooks" : it.scope].map(prefix => prefix + it.value));
    const ids = names.map(it => it[0]).sort();
    const on = (found: Map<string, number>) =>
      [...found].flatMap(([id, severity]) => (severity === 2 ? [id] : [])).sort();
    const runningOn = (file: string) => ids.filter(id => !resting(rules, file).has(id));
    expect(on(asListed)).toEqual(runningOn("d.tsx"));
    await Promise.all(
      [0, 1, 2].map(async nth => {
        const written = names.map(it => it[Math.min(nth, it.length - 1)]);
        const found = await configured(
          bunfig(Object.fromEntries(written.map(id => [id, setting(id, "error")]))),
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
    const [{ stdout, stderr, exitCode }, ...perFile] = await Promise.all([
      lint({ ...files, ...all }, ["-f", "json"]),
      ...Object.keys(sources).map(file => configured(all, file)),
    ]);
    expect(stderr).not.toContain("error:");
    expect((JSON.parse(stdout) as { filePath: string }[]).map(it => basename(it.filePath)).sort()).toEqual(
      Object.keys(sources),
    );
    expect(exitCode).toBe(1);
    for (const [nth, found] of perFile.entries()) {
      const off = [...found].flatMap(([id, severity]) => (severity !== 2 ? [id] : []));
      expect(off.sort()).toEqual([...resting(rules, Object.keys(sources)[nth])].sort());
      expect(found.size).toBe(rules.length);
    }
  });

  test("typescript-eslint rules run on JavaScript files", async () => {
    const { stdout, stderr, exitCode } = await lint(
      {
        "a.js": "const self = this;\nexport { self };\n",
        ...bunfig({ "@typescript-eslint/no-this-alias": "error" }),
      },
      ["-f", "json"],
    );
    expect(stderr).not.toContain("error:");
    expect(problems(stdout)).toEqual(["a.js:1 @typescript-eslint/no-this-alias"]);
    expect(exitCode).toBe(1);
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

  /** Returns each file's reports from its own pair as `severity rule`. Also checks that no pair reports twice in any file. */
  async function reports(pairs: Pair[], rules: Record<string, Setting>, args: string[] = []) {
    const { stdout, stderr } = await lint({ ...files, ...bunfig(rules) }, ["-f", "json", ...args]);
    expect(stderr).not.toContain("error:");
    const results: { filePath: string; messages: { ruleId: string; severity: number }[] }[] = JSON.parse(stdout);
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
        const ofPair = messages.filter(it => it.ruleId === own.base || it.ruleId === own.extension);
        return [name, ofPair.map(it => `${it.severity} ${it.ruleId}`)];
      }),
    );
    return { byFile, skipped: /Skipped (\d+) rules? that needs? type information/.exec(stderr)?.[1] };
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
    const skipped = typedNamesGetTypes ? undefined : String(typed.length);
    expect([byBase, byExtension, byBoth, byBothReversed].map(it => it.skipped)).toEqual([
      undefined,
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
    const run = async (bunfig: string, args: string[] = [], code = files["a.ts"]) => {
      const { stdout, stderr } = await lint({ ...files, "a.ts": code, "bunfig.toml": bunfig }, ["-f", "json", ...args]);
      return [problems(stdout), /Skipped \d+ rules?/.exec(stderr)?.[0]];
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
        [[], undefined],
        [[], undefined],
        [[], undefined],
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
        [coreReport, undefined],
        [coreReport, undefined],
        [coreReport, undefined],
      ]);
    });

    test("the core name uses the typed rule when the run has types anyway", async () => {
      expect(
        await Promise.all([
          run(rules(core), ["--type-aware"]),
          run(`[lint]\ntypeAware = true\n${rules(core)}`),
          run(rules(core, "@typescript-eslint/no-floating-promises")),
          // `pedantic` has both names, and other typed rules.
          run(`[lint.categories]\npedantic = "error"\n`).then(([found]) => [
            (found as string[]).filter(it => it.endsWith("require-await")),
            undefined,
          ]),
        ]),
      ).toEqual([
        [[], undefined],
        [[], undefined],
        [[], undefined],
        [[], undefined],
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
        [coreReport, "Skipped 1 rule"],
        [coreReport, "Skipped 1 rule"],
        [coreReport, undefined],
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
        [coreReport, undefined],
        [coreReport, undefined],
        [[], undefined],
        [[], undefined],
      ]);
    });
  });

  const unused = {
    "a.js": "const a = 1;\nexport {};\n",
    "b.ts": "const a = 1;\nexport {};\n",
  };

  test("either name sets both rules, and setting both names configures each language separately", async () => {
    const run = async (rules: Record<string, Setting>) =>
      problems((await lint({ ...unused, ...bunfig(rules) }, ["-f", "json"])).stdout);
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
      [`a.js:1 ${base}`, `b.ts:1 ${extension}`],
      [],
      [],
      [`b.ts:1 ${extension}`],
      [`b.ts:1 ${extension}`],
      [`a.js:1 ${base}`],
    ]);
  });

  test("--rule, [lint.categories] and [[lint.overrides]] set both rules too", async () => {
    const found = async (bunfig: string, args: string[] = []) =>
      problems((await lint({ ...unused, "bunfig.toml": bunfig }, ["-f", "json", ...args])).stdout);
    const both = ["a.js:1 no-unused-vars", "b.ts:1 @typescript-eslint/no-unused-vars"];
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
    ).toEqual([both, [], both.slice(1), both, [], both.slice(0, 1), both.slice(1)]);
  });

  test("typescript-eslint-only options are accepted under both names and ignored in JavaScript", async () => {
    const files = {
      "a.js": "const A = 1;\nexport function f(A) {\n  return A;\n}\nexport { A };\n",
      "b.ts": "type A = 1;\nexport function f(A: number) {\n  return A;\n}\nexport type { A };\n",
    };
    const run = async (rules: Record<string, Setting>) => {
      const { stdout, stderr } = await lint({ ...files, ...bunfig(rules) }, ["-f", "json"]);
      expect(stderr).not.toContain("error:");
      return problems(stdout);
    };
    const inComment = async (name: string) => {
      const comment = `/* eslint ${name}: ["error", { "ignoreTypeValueShadow": false }] */\n`;
      const commented = Object.fromEntries(Object.entries(files).map(([file, code]) => [file, code + comment]));
      return problems((await lint(commented, ["-f", "json"])).stdout);
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
      ]),
    ).toEqual([
      [inJavaScript],
      [inJavaScript, inTypeScript],
      [inJavaScript, inTypeScript],
      [inJavaScript, inTypeScript],
      [inJavaScript, inTypeScript],
    ]);
    const { stderr, exitCode } = await lint({
      ...files,
      ...bunfig({ "no-shadow": ["error", { ignoreTypeValueShado: 1 }] }),
    });
    expect(stderr).toContain(
      `error: Unknown option "ignoreTypeValueShado" for no-shadow\n  Did you mean "ignoreTypeValueShadow"?`,
    );
    expect(exitCode).toBe(2);
  });

  test("the core rule also runs on TypeScript when only it accepts the options", async () => {
    const code = "export function f(a, b, c) {\n  return [a, b, c];\n}\n";
    const run = async (rules: Record<string, Setting>, comment = "") => {
      const files = { "a.js": code + comment, "b.ts": code + comment };
      const { stdout, stderr } = await lint({ ...files, ...bunfig(rules) }, ["-f", "json"]);
      expect(stderr).not.toContain("error:");
      return problems(stdout);
    };
    const ofESLint = ["a.js:1 max-params", "b.ts:1 max-params"];
    expect(
      await Promise.all([
        run({ "max-params": ["error", { max: 2 }] }),
        run({ "max-params": ["error", 2] }),
        run({ "@typescript-eslint/max-params": ["error", 2] }),
        run({}, `/* eslint max-params: ["error", 2] */\n`),
        run({ "max-params": ["error", { max: 2 }] }, `/* eslint max-params: ["error", 2] */\n`),
      ]),
    ).toEqual([["a.js:1 max-params", "b.ts:1 @typescript-eslint/max-params"], ofESLint, ofESLint, ofESLint, ofESLint]);
  });

  test("eslint-disable works with either name and isn't reported as unused", async () => {
    const disabled = (name: string) => `// eslint-disable-next-line ${name}\nconst a = 1;\nexport {};\n`;
    const names = ["no-unused-vars", "@typescript-eslint/no-unused-vars", "typescript/no-unused-vars"];
    const files = Object.fromEntries(
      names.flatMap((name, nth) => [`a${nth}.js`, `b${nth}.ts`].map(file => [file, disabled(name)])),
    );
    const { stdout, exitCode } = await lint(files, ["-f", "json", "--report-unused-disable-directives"]);
    expect(problems(stdout)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("/* eslint rule: .. */ comments work with either name or both", async () => {
    const files = (comment: string) =>
      Object.fromEntries(Object.entries(unused).map(([file, code]) => [file, `/* eslint ${comment} */\n${code}`]));
    const found = async (comment: string) => {
      const results = JSON.parse((await lint(files(comment), ["-f", "json"])).stdout);
      return results.flatMap((file: { filePath: string; messages: { severity: number; ruleId: string }[] }) =>
        file.messages.map(it => `${basename(file.filePath)} ${it.severity} ${it.ruleId}`),
      );
    };
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
    const { stdout } = await lint({ "b.ts": unused["b.ts"], "eslint.config.mjs": config }, ["-f", "json", "b.ts"]);
    expect(problems(stdout)).toEqual(["b.ts:1 @typescript-eslint/no-unused-vars", "b.ts:1 no-unused-vars"]);
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
  const expected = rules.flatMap(it => it[1]).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const ids = new Set(expected.map(it => it.slice(it.indexOf(" ") + 1)));
  const ofThese = (stdout: string) => problems(stdout).filter(it => ids.has(it.slice(it.indexOf(" ") + 1)));

  test("when set in [lint.rules]", async () => {
    const { stdout, exitCode } = await lint(
      {
        ...files,
        ...bunfig(Object.fromEntries(rules.map(it => [it[0], "error"]))),
      },
      ["-f", "json"],
    );
    expect(ofThese(stdout)).toEqual(expected);
    expect(exitCode).toBe(1);
  });

  test("when set with --rule", async () => {
    const { stdout, exitCode } = await lint(files, [
      "-f",
      "json",
      "--rule",
      JSON.stringify(Object.fromEntries(rules.map(it => [it[0], "error"]))),
    ]);
    expect(ofThese(stdout)).toEqual(expected);
    expect(exitCode).toBe(1);
  });

  test("but are off by default", async () => {
    const { stdout } = await lint(files, ["-f", "json"]);
    // no-explicit-any is on by default for TypeScript.
    expect(ofThese(stdout)).toEqual(["view.tsx:2 @typescript-eslint/no-explicit-any"]);
  });

  test("prettier/prettier works without prettier installed", async () => {
    const { stdout } = await lint(
      {
        "a.js": "export   const a = 1\n",
        ...bunfig({ "prettier/prettier": "error" }),
      },
      ["-f", "unix"],
    );
    expect(stdout).toContain("a.js:1:8: Replace `··const·a·=·1` with `const·a·=·1;` [Error/prettier/prettier]");
  });

  test("oxlint rules print their help text", async () => {
    const { stdout } = await lint(
      {
        "a.js": "export default null;\n",
        ...bunfig({ "unicorn/no-null": "error" }),
      },
      ["-f", "pretty"],
    );
    expect(stdout).toContain("Replace `null` with `undefined`.");
  });
});

describe.concurrent("React Compiler rules", () => {
  const suggesting = ["exhaustive-effect-dependencies", "memo-dependencies", "syntax"].map(it => `react-hooks/${it}`);

  test("--rules only lists the ones that offer suggestions as fixable", async () => {
    const { stdout } = await lint({}, ["--rules", "-f", "json"]);
    const rules = (JSON.parse(stdout) as { id: string; fix: string }[]).filter(it => it.id.startsWith("react-hooks/"));
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
    const { stdout } = await lint({ ...files, ...bunfig(Object.fromEntries(suggesting.map(id => [id, "error"]))) }, [
      "-f",
      "json",
    ]);
    type Message = { ruleId: string; fix?: unknown; suggestions?: { desc: string }[] };
    const results: { filePath: string; messages: Message[] }[] = JSON.parse(stdout);
    const found = results.flatMap(file =>
      file.messages
        .filter(it => suggesting.includes(it.ruleId))
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
      const of = (stdout: string) => problems(stdout).filter(it => it.endsWith(` ${id}`));
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
      expect(of(plain.stdout)).toEqual(at(withoutOptions));
      expect(of(inFile.stdout)).toEqual(at(lines));
      expect(of(byFlag.stdout)).toEqual(at(lines));
      expect(of(inComment.stdout)).toEqual(at(lines));
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
    expect(problems(plain.stdout)).toEqual(["a.jsx:1 react/jsx-key"]);
    expect(problems(checked.stdout)).toEqual(["a.jsx:1 react/jsx-key", "a.jsx:2 react/jsx-key"]);
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

  // Both tools' comments count when neither tool's config is there.
  test.each(["eslint", "oxlint"])("%s-disable in every form", async tool => {
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
    const { stdout, exitCode } = await lint({ "a.ts": code, ...rules }, ["-f", "json"]);
    // The last comment is for another rule, so it is unused.
    expect(problems(stdout)).toEqual(["a.ts:7 no-debugger", "a.ts:14 null", "a.ts:15 no-debugger"]);
    expect(exitCode).toBe(1);
  });

  test.each(["eslint", "oxlint"])("// %s-disable is for the rest of the file, up to the next -enable", async tool => {
    const code = `debugger;\n// ${tool}-disable no-debugger\ndebugger;\ndebugger;\n// ${tool}-enable no-debugger\ndebugger;\n`;
    const { stdout } = await lint({ "a.js": code }, ["-f", "json"]);
    expect(problems(stdout)).toEqual(["a.js:1 no-debugger", "a.js:6 no-debugger"]);
  });

  test.each(["eslint", "oxlint"])("an unused %s-disable comment is called what it is called", async tool => {
    const files = {
      "a.js": `// ${tool}-disable-next-line no-debugger\nexport const a = 1;\n/* ${tool}-enable no-debugger */\n`,
    };
    const { stdout, exitCode } = await lint(files, ["-f", "unix", "--report-unused-disable-directives"]);
    expect(stdout).toContain(
      `:1:1: Unused ${tool}-disable directive (no problems were reported from 'no-debugger'). [Error]`,
    );
    expect(stdout).toContain(
      `:3:1: Unused ${tool}-enable directive (no matching ${tool}-disable directives were found for 'no-debugger'). [Error]`,
    );
    expect(exitCode).toBe(1);
  });

  test("the comments of the two can be mixed", async () => {
    const code = `/* oxlint-disable no-debugger */\ndebugger;\n/* eslint-enable no-debugger */\ndebugger;\n`;
    const { stdout } = await lint({ "a.js": code }, ["-f", "json"]);
    expect(problems(stdout)).toEqual(["a.js:4 no-debugger"]);
  });

  test("the rules about comments pass over the comments of both", async () => {
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
    const [alone, fixed, withEslint] = await Promise.all([
      lint({ "a.js": code, ...bunfig(rules) }, ["-f", "json"]),
      // A capital letter would end what the comment does.
      lint({ "a.js": code, ...bunfig(rules) }, ["-f", "json", "--fix-dry-run"]),
      lint({ "a.js": code, ...flat }, ["-f", "json"]),
    ]);
    expect(problems(alone.stdout)).toEqual(["a.js:7 capitalized-comments"]);
    expect(JSON.parse(fixed.stdout)[0].output).toBe(code.replace("another", "Another"));
    expect(problems(withEslint.stdout)).toEqual([
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
    expect(problems(disabled.stdout)).toEqual([]);
    expect(disabled.exitCode).toBe(0);
    expect(problems(enabled.stdout)).toEqual([
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
    const { stdout, exitCode } = await lint({ "a.js": code }, ["-f", "json"]);
    expect(problems(stdout)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("/* eslint rule: .. */ turns rules on and off", async () => {
    const code = `/* eslint unicorn/no-null: off, eslint/no-var: error, promise/param-names: error, nextjs/no-img-element: off */
export const a = null;
var b = new Promise(ok => ok());
export const c = [b, <img alt="" />];
`;
    const { stdout } = await lint({ "a.jsx": code, ...rules }, ["-f", "json"]);
    expect(problems(stdout)).toEqual(["a.jsx:3 no-var", "a.jsx:3 promise/param-names"]);
  });

  test("enabling an unknown rule in a comment is an error, but disabling one from a known plugin isn't", async () => {
    const code = `/* eslint react-hooks/jsx-key: error, unicorn/nothing: error */
// eslint-disable-next-line unicorn/nothing
export {};
`;
    const { stdout } = await lint({ "a.js": code }, ["-f", "json"]);
    expect(problems(stdout)).toEqual(["a.js:1 react-hooks/jsx-key", "a.js:1 unicorn/nothing"]);
    expect(stdout).toContain("Definition for rule 'react-hooks/jsx-key' was not found.");
  });

  test("unicorn/no-abusive-eslint-disable isn't silenced by the comment it reports", async () => {
    const code = "// eslint-disable-next-line\nf();\nf(); // eslint-disable-line\n/* eslint-disable */\nf();\n";
    const { stdout } = await lint(
      {
        "a.js": code,
        ...bunfig({ "unicorn/no-abusive-eslint-disable": "error" }),
      },
      ["-f", "json"],
    );
    expect(problems(stdout).filter(it => it.endsWith("disable"))).toEqual([
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

  test("enable rules from every plugin", async () => {
    const [plain, perf] = await Promise.all([
      lint(files, ["-f", "json"]),
      lint({ ...files, ...categories(`perf = "error"`) }, ["-f", "json"]),
    ]);
    expect(problems(plain.stdout)).toEqual([]);
    expect(problems(perf.stdout)).toEqual([
      "a.jsx:1 unicorn/prefer-array-flat-map",
      "a.jsx:2 oxc/no-accumulating-spread",
      "a.jsx:3 react-perf/jsx-no-new-array-as-prop",
    ]);
    expect(perf.exitCode).toBe(1);
  });

  test("[lint.rules] overrides categories, and other categories override `all`", async () => {
    const lines = `perf = "off"\nall = "warn"\n[lint.rules]\n"oxc/no-accumulating-spread" = "error"`;
    const { stdout } = await lint({ ...files, ...categories(lines) }, ["-f", "json"]);
    const found = problems(stdout);
    expect(found).toContain("a.jsx:2 oxc/no-accumulating-spread");
    expect(found).not.toContain("a.jsx:1 unicorn/prefer-array-flat-map");
    expect(found).toContain("b.ts:7 unicorn/no-null");
  });

  test("enable the typescript-eslint version of a core rule in TypeScript files", async () => {
    const { stdout } = await lint({ ...files, ...categories(`correctness = "error"`) }, ["--print-config", "b.ts"]);
    const { rules } = JSON.parse(stdout);
    expect(rules["no-dupe-class-members"]).toEqual([0]);
    expect(rules["@typescript-eslint/no-dupe-class-members"]).toEqual([2]);
  });
});

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
    const of = (stdout: string) => problems(stdout).filter(it => it.endsWith(` ${id}`));
    const rules = bunfig({ [id]: "error" })["bunfig.toml"];
    const [plain, set] = await Promise.all([
      lint({ "a.jsx": code, "bunfig.toml": rules }, ["-f", "json"]),
      lint({ "a.jsx": code, "bunfig.toml": `${rules}\n${settings}\n` }, ["-f", "json"]),
    ]);
    expect(of(plain.stdout)).toEqual(without.map(line => `a.jsx:${line} ${id}`));
    expect(of(set.stdout)).toEqual(withIt.map(line => `a.jsx:${line} ${id}`));
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
    const [ofOxlint, ofESLint] = await Promise.all([
      lint({ ...files, ...oxlint }, ["-f", "unix"]),
      lint({ ...files, ...eslint }, ["-f", "unix"]),
    ]);
    expect(ofOxlint.stdout).toContain("[Error/jsx-a11y(alt-text)]");
    expect(ofESLint.stdout).toContain(`{"mine":1,"jsx-a11y":{"components":{"Picture":"img"}}}`);
  });
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
    // The plugin is there already.
    [
      "react/only-in-the-package",
      `Unknown rule "react/only-in-the-package"\n  react is built in and has no rule of that name\n  To run a rule of the package, load it under another name in [lint]: plugins = [{ name = "react-js", specifier = "eslint-plugin-react" }]`,
    ],
    [
      "typescript/only-in-the-package",
      `Unknown rule "typescript/only-in-the-package"\n  typescript is built in and has no rule of that name\n  To run a rule of the package, load it under another name in [lint]: plugins = [{ name = "typescript-js", specifier = "@typescript-eslint/eslint-plugin" }]`,
    ],
    // No package has them.
    ["bun/only-in-the-package", `Unknown rule "bun/only-in-the-package"`],
    ["oxc/only-in-the-package", `Unknown rule "oxc/only-in-the-package"`],
    ["eslint/only-in-the-package", `Unknown rule "eslint/only-in-the-package"`],
    ["perfectly-fine", `Unknown rule "perfectly-fine"`],
    // Rules that bun lint leaves out on purpose.
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
  ];

  test.each(cases)("%s is rejected", async (written, said, saidToFlag = said) => {
    const [inFile, byFlag] = await Promise.all([
      lint({
        ...source,
        "bunfig.toml": `[lint.rules]\n"no-debugger" = "error"\n"${written}" = "error"\n`,
      }),
      lint(source, ["--rule", JSON.stringify({ [written]: "error" })]),
    ]);
    expect(inFile).toEqual({
      stdout: "",
      stderr: `3 | "${written}" = "error"\n    ^\nerror: ${said}\n    at bunfig.toml:3:1\n`,
      exitCode: 2,
    });
    expect(byFlag).toEqual({
      stdout: "",
      stderr: `error: ${saidToFlag}\n`,
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
    expect(mistyped.stderr).toContain(`error: Unknown rule "no-debuger"\n  Did you mean "no-debugger"?\n`);
    expect(mistyped.exitCode).toBe(2);
    expect(problems(leftOut.stdout)).toEqual(["a.js:1 no-debugger"]);
    expect(leftOut.exitCode).toBe(1);
  });

  test("no-restricted-syntax/<name> is a valid extra instance of no-restricted-syntax", async () => {
    const { stdout } = await lint(
      {
        ...source,
        ...bunfig({
          "no-debugger": "off",
          "no-restricted-syntax/mine": ["error", "DebuggerStatement"],
        }),
      },
      ["-f", "json"],
    );
    expect(problems(stdout)).toEqual(["a.js:1 no-restricted-syntax/mine"]);
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

  test.each(cases.filter(it => it[2] !== ""))("%s is rejected", async (line, column, said) => {
    const { stdout, stderr, exitCode } = await lint({
      ...source,
      "bunfig.toml": `[lint.rules]\n${line}\n`,
    });
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: `2 | ${line}\n${" ".repeat(column + 3)}^\nerror: ${said}\n    at bunfig.toml:2:${column}\n`,
      exitCode: 2,
    });
  });

  test("--rule prints the same errors without a code frame", async () => {
    const [options, severity, overBunfig] = await Promise.all([
      lint(source, ["--rule", `eqeqeq: [error, smrt]`]),
      lint(source, ["--rule", `eqeqeq: eror`]),
      lint({ ...source, ...bunfig({ eqeqeq: ["error", "smart"] }) }, ["--rule", `eqeqeq: [error, smrt]`]),
    ]);
    const said = `error: "smrt" is not a valid option for eqeqeq\n  Expected "always", "smart", or "allow-null"\n`;
    expect(options).toEqual({ stdout: "", stderr: said, exitCode: 2 });
    expect(overBunfig).toEqual({ stdout: "", stderr: said, exitCode: 2 });
    expect(severity).toEqual({
      stdout: "",
      stderr: `error: "eror" is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"\n`,
      exitCode: 2,
    });
  });

  test("options aren't validated when the rule is off", async () => {
    const { stderr, exitCode } = await lint({ ...source, ...bunfig({ eqeqeq: ["off", "smrt"] }) }, ["-f", "json"]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("an invalid category severity is rejected", async () => {
    const { stderr, exitCode } = await lint({
      ...source,
      "bunfig.toml": `[lint.categories]\nstyle = "eror"\n`,
    });
    expect(stderr).toBe(
      `2 | style = "eror"\n            ^\nerror: "eror" is not a valid severity for style\n  Expected "off", "warn", or "error"\n    at bunfig.toml:2:9\n`,
    );
    expect(exitCode).toBe(2);
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
    expect(problems(inFlat.stdout)).toEqual(["a.js:2 no-debugger", "a.js:4 no-debugger"]);
    expect(problems(inLegacy.stdout)).toEqual(["a.js:2 no-debugger", "a.js:4 no-debugger"]);
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
    for (const { stdout, stderr, exitCode } of [inFile, inBunfig]) {
      expect(stderr).toContain(`Key "rules": Key "unicorn/no-null": Could not find plugin "unicorn" in configuration.`);
      expect(stdout).toBe("");
      expect(exitCode).toBe(2);
    }
  });

  test("invalid options print ESLint's message under a line that names the file", async () => {
    const words = `Key "rules": Key "eqeqeq":\n\tValue "smrt" should be equal to one of the allowed values.`;
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
    expect(inFile.stderr).toStartWith(`error: Invalid config in eslint.config.mjs\n${words}`);
    expect(inLegacy.stderr).toStartWith("error: Invalid config in .eslintrc.json\n");
    expect(inBunfig.stderr).toStartWith(`error: Invalid config in bunfig.toml\n${words}`);
    expect(byFlag.stderr).toStartWith(`error: Invalid config in --rule\n${words}`);
    expect([inFile, inLegacy, inBunfig, byFlag].map(it => [it.stdout, it.exitCode])).toEqual(
      Array.from({ length: 4 }, () => ["", 2]),
    );
  });

  test("an oxlint config reports rules under oxlint's names", async () => {
    const { stdout, exitCode } = await lint(
      {
        ...source,
        ".oxlintrc.json": JSON.stringify({
          rules: { "unicorn/no-null": "error" },
        }),
      },
      ["-f", "unix"],
    );
    expect(stdout).toContain("[Error/unicorn(no-null)]");
    expect(exitCode).toBe(1);
  });
});
