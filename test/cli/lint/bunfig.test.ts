// Tests for the `[lint]` section of bunfig.toml.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  NO_COLOR: undefined,
  FORCE_COLOR: undefined,
};

const config = (rules: Record<string, unknown>) => `export default [{ rules: ${JSON.stringify(rules)} }];\n`;
const basic = config({
  "no-debugger": "error",
  "no-unused-vars": "warn",
  eqeqeq: "error",
  yoda: ["error", "always"],
  "no-var": "warn",
});
const bad = "var a = 1\nif (a == 2) { debugger; }\n";

/** Runs `bun lint ...args` in a temp directory containing `files`. `reads` lists the files to read back afterwards. */
async function lint(files: Record<string, string>, args: string[], reads: string[] = []) {
  using dir = tempDir("bun-lint", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const read = (name: string) =>
    existsSync(join(String(dir), name)) ? readFileSync(join(String(dir), name), "utf8") : null;
  type Result = { filePath: string; messages: { ruleId: string | null; severity: number }[] };
  const results: Result[] = stdout.startsWith('{"results":') ? JSON.parse(stdout).results : [];
  const problems = results.flatMap(({ filePath, messages }) => {
    const file = normalizeBunSnapshot(filePath, String(dir)).replace("<dir>/", "");
    return messages.map(it => `${file} ${it.ruleId ?? "-"} ${it.severity === 2 ? "error" : "warn"}`);
  });
  return {
    /** One `file rule severity` string per problem. Empty unless the run used `-f json-with-metadata`. */
    problems: problems.sort(),
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    files: Object.fromEntries(reads.map(name => [name, read(name)])),
  };
}

// Each `[lint]` key sets the default for the flag of the same name.
describe.concurrent("[lint] in bunfig.toml", () => {
  /** Returns everything a run leaves behind: its output with timings masked, its exit code and the files. */
  async function run(files: Record<string, string>, args: string[]) {
    const reads = Object.keys(files).filter(name => name !== "bunfig.toml");
    const result = await lint(files, args, reads);
    // JSON doubles the backslashes in Windows paths, so `normalizeBunSnapshot` misses the temp directory there.
    // Mask its random suffix here.
    const text = (printed: string) => printed.replace(/\d+(\.\d+)?m?s\b/g, "0ms").replace(/\bbun-lint_\w+/g, "<dir>");
    return { stdout: text(result.stdout), stderr: text(result.stderr), exitCode: result.exitCode, files: result.files };
  }

  const eslint = { "eslint.config.js": basic, "a.js": bad };
  const oxlint = { ".oxlintrc.json": `{ "rules": { "no-debugger": "error", "no-var": "warn" } }`, "a.js": bad };
  const typed = {
    ".oxlintrc.json": `{ "rules": { "typescript/no-floating-promises": "error" } }`,
    "tsconfig.json": `{ "compilerOptions": { "strict": true }, "include": ["*.ts"] }`,
    "a.ts": "async function f() {}\nf();\nconst a: string = 1;\n",
  };
  const many = Array.from({ length: 60 }, () => "debugger;\n").join("");
  const suppressions = JSON.stringify({
    "a.js": { "no-debugger": { count: 1 }, eqeqeq: { count: 1 }, yoda: { count: 1 } },
  });

  // Each case: the bunfig.toml lines, the equivalent flags, flags that override them, the files, and the other args.
  const keys: [lines: string, flags: string[], opposite: string[], files: Record<string, string>, args: string[]][] = [
    [
      `config = "other.config.js"`,
      ["--config", "other.config.js"],
      ["-c", "eslint.config.js"],
      { ...eslint, "other.config.js": config({ "no-var": "error" }) },
      ["a.js"],
    ],
    [`configLookup = false`, ["--no-config-lookup"], ["--config-lookup"], eslint, ["a.js"]],
    [`flavor = "oxlint"`, ["--flavor=oxlint"], ["--flavor=eslint"], { ...eslint, ...oxlint }, ["a.js"]],
    [`flavor = "eslint"`, ["--flavor=eslint"], ["--flavor=oxlint"], { ...eslint, ...oxlint }, ["a.js"]],
    [`ext = [".foo"]`, ["--ext", ".foo"], [], { ...eslint, "b.foo": bad }, ["."]],
    [`ext = ".foo"`, ["--ext", ".foo"], [], { ...eslint, "b.foo": bad }, ["."]],
    [
      `ignorePatterns = ["b.js", "sub/"]`,
      ["--ignore-pattern", "b.js", "--ignore-pattern=sub/"],
      [],
      { ...eslint, "b.js": bad, "sub/c.js": bad },
      ["."],
    ],
    [`ignorePath = "mine"`, ["--ignore-path", "mine"], [], { ...oxlint, "b.js": bad, mine: "b.js\n" }, ["."]],
    [
      `ignore = false`,
      ["--no-ignore"],
      ["--ignore"],
      {
        "eslint.config.js": `export default [{ ignores: ["a.js"] }, { rules: { "no-debugger": "error" } }];`,
        "a.js": bad,
      },
      ["a.js"],
    ],
    [
      `warnIgnored = false`,
      ["--no-warn-ignored"],
      ["--warn-ignored"],
      { "eslint.config.js": `export default [{ ignores: ["a.js"] }];`, "a.js": bad, "b.js": "" },
      ["a.js", "b.js"],
    ],
    [`quiet = true`, ["--quiet"], ["--no-quiet"], eslint, ["a.js"]],
    [`silent = true`, ["--silent"], ["--no-silent"], oxlint, ["a.js"]],
    [
      `maxWarnings = 0`,
      ["--max-warnings", "0"],
      ["--max-warnings=10"],
      { ...eslint, "a.js": "var a = 1;\na;\n" },
      ["a.js"],
    ],
    [
      `denyWarnings = true`,
      ["--deny-warnings"],
      ["--no-deny-warnings"],
      { ...oxlint, "a.js": "var a = 1;\na;\n" },
      ["a.js"],
    ],
    [`format = "unix"`, ["-f", "unix"], ["--format=json"], eslint, ["a.js"]],
    [`all = true`, ["--all"], ["--no-all"], { ...eslint, "a.js": many }, ["-f", "pretty", "a.js"]],
    [
      `inlineConfig = false`,
      ["--no-inline-config"],
      ["--inline-config"],
      { ...eslint, "a.js": "// eslint-disable-next-line no-debugger\ndebugger;\n" },
      ["a.js"],
    ],
    [
      `reportUnusedDisableDirectives = true`,
      ["--report-unused-disable-directives"],
      ["--report-unused-disable-directives-severity=off"],
      { ...eslint, "a.js": "// eslint-disable-next-line no-debugger\na;\n" },
      ["a.js"],
    ],
    [
      `reportUnusedDisableDirectives = "off"`,
      ["--report-unused-disable-directives-severity", "off"],
      ["--report-unused-disable-directives"],
      { ...eslint, "a.js": "// eslint-disable-next-line no-debugger\na;\n" },
      ["a.js"],
    ],
    [
      `reportUnusedInlineConfigs = "error"`,
      ["--report-unused-inline-configs=error"],
      ["--report-unused-inline-configs=off"],
      { ...eslint, "a.js": "/* eslint no-debugger: error */\na;\n" },
      ["a.js"],
    ],
    [
      `suppressionsLocation = "known.json"`,
      ["--suppressions-location", "known.json"],
      ["--suppressions-location=none.json"],
      { ...eslint, "known.json": suppressions },
      ["a.js"],
    ],
    [
      `passOnUnprunedSuppressions = true`,
      ["--pass-on-unpruned-suppressions"],
      ["--no-pass-on-unpruned-suppressions"],
      { ...eslint, "a.js": "a;\n", "eslint-suppressions.json": suppressions },
      ["a.js"],
    ],
    [
      `errorOnUnmatchedPattern = false`,
      ["--no-error-on-unmatched-pattern"],
      ["--error-on-unmatched-pattern"],
      eslint,
      ["none.js"],
    ],
    [`passOnNoPatterns = true`, ["--pass-on-no-patterns"], ["--no-pass-on-no-patterns"], eslint, []],
    [
      `exitOnFatalError = true`,
      ["--exit-on-fatal-error"],
      ["--no-exit-on-fatal-error"],
      { ...eslint, "a.js": "a(" },
      ["a.js"],
    ],
    [
      `allowUnsupported = true`,
      ["--allow-unsupported"],
      ["--no-allow-unsupported"],
      { ".eslintrc.json": `{ "rules": { "no-debugger": "error", "require-jsdoc": "warn" } }`, "a.js": bad },
      ["a.js"],
    ],
    [
      `inferGlobals = true`,
      ["--infer-globals"],
      ["--no-infer-globals"],
      {
        "eslint.config.js": config({ "no-undef": "error" }),
        "tsconfig.json": `{ "compilerOptions": { "allowJs": true }, "include": ["*.ts", "*.js"] }`,
        "globals.d.ts": "declare const mine: number;\n",
        "a.js": "mine;\nother;\n",
      },
      ["a.js"],
    ],
    [`typeAware = true`, ["--type-aware"], ["--no-type-aware"], typed, ["a.ts"]],
    [
      `typeAware = false`,
      ["--no-type-aware"],
      ["--type-aware"],
      {
        ...typed,
        ".oxlintrc.json": `{ "options": { "typeAware": true }, "rules": { "typescript/no-floating-promises": "error" } }`,
      },
      ["a.ts"],
    ],
    [`typeCheck = true`, ["--type-check"], ["--no-type-check"], typed, ["--type-aware", "a.ts"]],
    [
      `tsconfig = "none.json"`,
      ["--tsconfig", "none.json"],
      ["--tsconfig", "tsconfig.json"],
      typed,
      ["--type-aware", "a.ts"],
    ],
    [`project = "none.json"`, ["--project", "none.json"], ["-p", "tsconfig.json"], typed, ["--type-aware", "a.ts"]],
    [
      `disableNestedConfig = true`,
      ["--disable-nested-config"],
      ["--no-disable-nested-config"],
      { ...oxlint, "sub/.oxlintrc.json": `{ "rules": { "no-debugger": "off" } }`, "sub/a.js": bad },
      ["sub/a.js"],
    ],
    [
      `fixType = ["suggestion"]`,
      ["--fix-type", "suggestion"],
      [],
      { "eslint.config.js": config({ "unicode-bom": ["error", "always"], "no-var": "error" }), "a.js": bad },
      ["--fix", "a.js"],
    ],
    [
      `[lint.rules]\n"no-debugger" = "off"\neqeqeq = ["error", "smart"]\n"no-eval" = 2`,
      ["--rule", `{"no-debugger": "off", "eqeqeq": ["error", "smart"], "no-eval": 2}`],
      ["--rule", "no-debugger: warn"],
      { ...eslint, "a.js": `${bad}eval(a == null);\n` },
      ["a.js"],
    ],
    [
      `[lint.rules]\n"no-debugger" = "off"\n"no-eval" = "error"`,
      ["--rule", `{"no-debugger": "off", "no-eval": "error"}`, "--flavor=oxlint"],
      ["--rule", "no-debugger: warn"],
      { ...oxlint, "a.js": `${bad}eval(a);\n` },
      ["a.js"],
    ],
    [
      `[lint.rules]\n"no-restricted-imports" = ["error", { paths = ["lodash"], patterns = [{ group = ["a\\nb*"], message = "it's \\"so\\"" }] }]`,
      ["--rule", `{"no-restricted-imports": ["error", { "paths": ["lodash"] }]}`],
      [],
      { ...eslint, "a.js": `import "lodash";\n` },
      ["a.js"],
    ],
    [
      `[lint.globals]\nmine = "readonly"\nyours = true\ntheirs = false\nours = "writable"`,
      ["--global", "mine,yours:true", "--global", "theirs,ours:true"],
      [],
      {
        "eslint.config.js": config({ "no-undef": "error", "no-global-assign": "error" }),
        "a.js": "mine = yours = theirs = ours = other;\n",
      },
      ["a.js"],
    ],
    [
      `[lint.parserOptions]\necmaFeatures = { jsx = true }`,
      ["--parser-options", "ecmaFeatures: { jsx: true }"],
      ["--parser-options", "ecmaFeatures: { jsx: false }"],
      { ...eslint, "a.js": "<a />;\n" },
      ["a.js"],
    ],
    [
      `[lint.categories]\nstyle = "warn"\nall = "off"\ncorrectness = "error"`,
      ["-A", "all", "-W", "style", "-D", "correctness"],
      [],
      { ".oxlintrc.json": "{}", "a.js": `${bad}for (;;) {}\n` },
      ["a.js"],
    ],
  ];

  test.each(keys)("%s", async (lines, flags, opposite, files, args) => {
    const bunfig = { "bunfig.toml": lines.startsWith("[") ? `${lines}\n` : `[lint]\n${lines}\n` };
    const [plain, byKey, byFlag, underFlag, byOtherFlag] = await Promise.all([
      run(files, args),
      run({ ...files, ...bunfig }, args),
      run(files, [...flags, ...args]),
      run({ ...files, ...bunfig }, [...opposite, ...args]),
      // Flags add to list and table keys instead of replacing them.
      run(files, [...(opposite.length === 0 || /^\[|= \[/.test(lines) ? flags : []), ...opposite, ...args]),
    ]);
    expect(byKey).toEqual(byFlag);
    expect(byKey).not.toEqual(plain);
    expect(underFlag).toEqual(byOtherFlag);
  });

  test("threads works like --threads and rejects a negative number", async () => {
    const [byKey, byFlag, wrong] = await Promise.all([
      run({ ...eslint, "bunfig.toml": "[lint]\nthreads = 1\n" }, ["a.js"]),
      run(eslint, ["--threads=1", "a.js"]),
      run({ ...eslint, "bunfig.toml": "[lint]\nthreads = -1\n" }, ["a.js"]),
    ]);
    expect(byKey).toEqual(byFlag);
    expect(wrong.stderr).toContain(`--threads takes a number, not "-1"`);
    expect(wrong.exitCode).toBe(2);
  });

  // At 288 bytes per thread, these would take 19 GB, or more than the address space.
  test.each(["67108864", "9007199254740991", "9223372036854775808"])(
    "%s threads is capped at the maximum",
    async count => {
      const [byKey, byFlag, few] = await Promise.all([
        run({ ...eslint, "bunfig.toml": `[lint]\nthreads = ${count}\n` }, ["a.js"]),
        run(eslint, [`--threads=${count}`, "a.js"]),
        run(eslint, ["--threads=1", "a.js"]),
      ]);
      // Above 2^53 - 1, bunfig.toml fails to load before the key is read.
      if (Number.isSafeInteger(Number(count))) expect(byKey).toEqual(few);
      expect(byFlag).toEqual(few);
    },
  );

  // ESLint rejects --fix-type in a run that doesn't fix anything.
  test("fixType is ignored unless the run fixes", async () => {
    const files = { ...eslint, "bunfig.toml": `[lint]\nfixType = ["layout"]\n` };
    const [without, plain, dry, dryByFlag] = await Promise.all([
      run(files, ["a.js"]),
      run(eslint, ["a.js"]),
      run(files, ["--fix-dry-run", "-f", "json", "a.js"]),
      run(eslint, ["--fix-dry-run", "--fix-type=layout", "-f", "json", "a.js"]),
    ]);
    expect(without).toEqual(plain);
    expect(dry).toEqual(dryByFlag);
  });

  test("a key doesn't pick between an ESLint and an oxlint config", async () => {
    const both = { ...eslint, ...oxlint };
    const undecided = "note: Using .oxlintrc.json. eslint.config.js is ignored. Use --config to pick it.";
    const results = await Promise.all(
      [
        `denyWarnings = true`,
        `typeAware = true`,
        `ext = [".js"]`,
        `[lint.rules]\n"no-var" = "off"`,
        `[lint.categories]\nstyle = "warn"`,
      ].map(lines =>
        run({ ...both, "bunfig.toml": lines.startsWith("[") ? `${lines}\n` : `[lint]\n${lines}\n` }, ["a.js"]),
      ),
    );
    for (const result of results) {
      expect(result.stderr).toContain(undecided);
      expect(result.exitCode).toBe(1);
    }
    // With only an ESLint config, neither the key nor the flag switches the run to oxlint.
    const [byKey, byFlag, plain] = await Promise.all([
      run({ ...eslint, "bunfig.toml": "[lint]\ndenyWarnings = true\n" }, ["-f", "unix", "a.js"]),
      run(eslint, ["--deny-warnings", "-f", "unix", "a.js"]),
      run(eslint, ["-f", "unix", "a.js"]),
    ]);
    expect(byKey.stdout).toBe(plain.stdout);
    expect(byFlag.stdout).toBe(plain.stdout);
  });

  test("bun/format compares a file with bun fmt's output, including [fmt] options", async () => {
    const files = { "a.js": "a('b')\n", "bunfig.toml": "[fmt]\nsemi = false\nsingleQuote = true\n" };
    const rule = (...options: unknown[]) => ({
      ".oxlintrc.json": JSON.stringify({ rules: { "bun/format": ["error", ...options] } }),
    });
    const [withSection, without, overridden] = await Promise.all([
      run({ ...files, ...rule() }, ["-f", "unix", "a.js"]),
      run({ "a.js": files["a.js"], ...rule() }, ["-f", "unix", "a.js"]),
      run({ ...files, ...rule({ semi: true }) }, ["-f", "unix", "a.js"]),
    ]);
    expect(withSection.stdout).toBe("");
    expect(withSection.exitCode).toBe(0);
    expect(without.stdout).toContain(`Replace \`'b')\` with \`"b");\``);
    expect(overridden.stdout).toContain("Insert `;`");
    expect(overridden.stdout).not.toContain("Replace");
  });

  test("bunfig.toml is read from the working directory, after --cwd is applied", async () => {
    const files = {
      ...eslint,
      "sub/a.js": bad,
      "bunfig.toml": `[lint]\nformat = "unix"\n`,
      "sub/bunfig.toml": `[lint]\nquiet = true\nformat = "json"\n`,
    };
    const [above, below] = await Promise.all([run(files, ["sub/a.js"]), run(files, ["--cwd=sub", "a.js"])]);
    expect(above.stdout).toContain("[Warning/no-var]");
    expect(JSON.parse(below.stdout)[0].warningCount).toBe(0);
  });

  /** Runs `bun ...args` in a temp directory containing `files`. */
  async function bun(files: Record<string, string>, args: string[]) {
    using dir = tempDir("bun-lint-bunfig", files);
    const stdio = { stdin: "ignore", stdout: "pipe", stderr: "pipe" } as const;
    await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd: String(dir), ...stdio });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("--config= before `lint` picks a file other than bunfig.toml", async () => {
    const files = {
      ...eslint,
      "bunfig.toml": `[lint]\nformat = "unix"\n`,
      "other.toml": `[lint]\nformat = "json"\n`,
    };
    const results = await Promise.all([
      bun(files, ["lint", "a.js"]),
      bun(files, ["--config=other.toml", "lint", "a.js"]),
      bun(files, ["-c=other.toml", "lint", "a.js"]),
      // Flags after `lint` belong to the linter.
      bun(files, ["--config=other.toml", "lint", "-c", "eslint.config.js", "a.js"]),
      bun(files, ["--config=none.toml", "lint", "a.js"]),
    ]);
    expect(results.map(it => [it.stdout.startsWith("[{"), it.exitCode])).toEqual([
      [false, 1],
      [true, 1],
      [true, 1],
      [true, 1],
      [false, 2],
    ]);
    expect(results[4].stderr).toContain(`while reading config "`);
  });

  test("errors in [lint] point at the line in bunfig.toml, like errors in other sections", async () => {
    const bunfig = `[lint]\nquiet = true\n\n[lint.rules]\neqeqeq = ["error", "smart"]\n"no-var" = "always"\n`;
    const result = await bun({ ...eslint, "bunfig.toml": bunfig }, ["lint", "a.js"]);
    expect(result.stderr).toContain(`6 | "no-var" = "always"\n`);
    expect(result.stderr).toMatch(
      /error: "always" is not a valid severity for no-var\n  Expected "off", "warn", or "error"\n\s+at bunfig\.toml:6:12\n$/,
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(2);
  });

  test.each(["--config=", "-c="])(
    "a mistake in the rules of bun %sother.toml lint is shown in that file",
    async flag => {
      const files = {
        "a.js": "foo;\n",
        "bunfig.toml": `# Not read.\n[lint.rules]\n"no-var" = "error"\n`,
        "config/other.toml": `[lint.rules]\n"no-vra" = "error"\n`,
      };
      const result = await bun(files, [flag + "config/other.toml", "lint", "a.js"]);
      expect(result.stderr).toContain(`2 | "no-vra" = "error"\n`);
      expect(result.stderr).toMatch(
        /error: Unknown rule "no-vra"\n  Did you mean "no-var"\?\n\s+at config\/other\.toml:2:1\n$/,
      );
      expect(result.exitCode).toBe(2);
    },
  );

  // These flags describe a single run, not the project.
  test.each([
    ["fix = true", "--fix"],
    ["fixDryRun = true", "--fix-dry-run"],
    ["fixSuggestions = true", "--fix-suggestions"],
    ["fixDangerously = true", "--fix-dangerously"],
    ["init = true", "--init"],
    ["stdin = true", "--stdin"],
    [`stdinFilename = "a.js"`, "--stdin-filename"],
    [`printConfig = "a.js"`, "--print-config"],
    ["suppressAll = true", "--suppress-all"],
    [`suppressRule = ["no-var"]`, "--suppress-rule"],
    ["pruneSuppressions = true", "--prune-suppressions"],
    [`outputFile = "report.txt"`, "--output-file"],
    ["color = true", "--color"],
    ["timing = true", "--timing"],
    [`cwd = "sub"`, "--cwd"],
  ])("%s is rejected and nothing is written", async (line, flag) => {
    const key = line.split(" ")[0];
    const result = await run({ ...eslint, "bunfig.toml": `[lint]\n${line}\n` }, ["a.js"]);
    expect(result.stderr).toContain(
      `error: "${key}" cannot be set in bunfig.toml\n  Use ${flag} on the command line\n`,
    );
    expect(result.stdout).toBe("");
    expect(result.files["a.js"]).toBe(bad);
    expect(result.exitCode).toBe(2);
  });

  test.each([
    ["quiet = 1", "expected boolean but received number"],
    [`maxWarnings = "0"`, "expected number but received string"],
    ["maxWarnings = 1.5", "maxWarnings must be a whole number"],
    ["config = false", "expected string but received boolean"],
    ["ignorePatterns = true", "expected array but received boolean"],
    ["ignorePatterns = [1]", "expected string but received number"],
    [`flavor = "biome"`, '--flavor must be eslint or oxlint, not "biome"'],
    [`format = "fancy"`, `Unknown format "fancy"\n  Available formats: stylish, pretty, json,`],
    [`fixType = ["all"]`, `Unknown fix type\n  Expected "directive", "problem", "suggestion", or "layout"`],
    ["fixType = true", "expected array but received boolean"],
    [
      `reportUnusedDisableDirectives = "loud"`,
      `"loud" is not a valid severity for reportUnusedDisableDirectives\n  Expected "off", "warn", or "error"`,
    ],
    ["reportUnusedDisableDirectives = 3", "3 is not a valid severity for reportUnusedDisableDirectives"],
    [`reportUnusedInlineConfigs = true`, "true is not a valid severity for reportUnusedInlineConfigs"],
    ["rules = true", "expected object but received boolean"],
    [
      `[lint.rules]\neqeqeq = "always"`,
      `"always" is not a valid severity for eqeqeq\n  Expected "off", "warn", or "error"`,
    ],
    [`[lint.rules]\neqeqeq = ["smart"]`, `"smart" is not a valid severity for eqeqeq`],
    [`[lint.rules]\neqeqeq = []`, "[] is not a valid severity for eqeqeq"],
    [`[lint.rules]\neqeqeq = true`, "true is not a valid severity for eqeqeq"],
    [
      `[lint.globals]\na = "on"`,
      `"on" is not a valid value for the global a\n  Expected "readonly", "writable", or "off"`,
    ],
    [`[lint.globals]\na = 1`, "1 is not a valid value for the global a"],
    [`[lint.categories]\nstyles = "warn"`, `Unknown key "styles" in [lint.categories]\n  Did you mean "style"?`],
    [`[lint.categories]\nsecurity = "warn"`, `Unknown key "security" in [lint.categories]\n    at`],
    [`[lint.categories]\nstyle = "deny"`, `"deny" is not a valid severity for style`],
    ["maxWarning = 0", `Unknown key "maxWarning" in [lint]\n  Did you mean "maxWarnings"?`],
    ["max-warnings = 0", `Unknown key "max-warnings" in [lint]\n  Did you mean "maxWarnings"?`],
    // Flag names whose key is spelled differently.
    [`ignorePattern = ["a"]`, `Unknown key "ignorePattern" in [lint]\n  Did you mean "ignorePatterns"?`],
    [`rule = "a"`, `Unknown key "rule" in [lint]\n  Did you mean "rules"?`],
    [`global = "a"`, `Unknown key "global" in [lint]\n  Did you mean "globals"?`],
    [`deny = "style"`, `Unknown key "deny" in [lint]\n  Did you mean "categories"?`],
    [`plugin = ["a"]`, `Unknown key "plugin" in [lint]\n  Did you mean "plugins"?`],
    // No similar key, so no suggestion.
    [`extends = ["a"]`, `Unknown key "extends" in [lint]\n    at`],
    ["cache = true", `Unknown key "cache" in [lint]\n    at`],
    [`env = ["node"]`, `Unknown key "env" in [lint]\n    at`],
  ])("%s is rejected: %s", async (lines, message) => {
    const bunfig = lines.startsWith("[") ? `${lines}\n` : `[lint]\n${lines}\n`;
    const result = await run({ ...eslint, "bunfig.toml": bunfig }, ["a.js"]);
    expect(result.stderr).toContain(message);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(2);
  });

  test("every flag in --help has a key, or an error that names the flag to use instead", async () => {
    const help = await lint({}, ["--help", "--all"]);
    const flags = [...help.stdout.matchAll(/^\s+(?:-\w, )?--([a-z0-9-]+)/gm)].map(it => it[1]);
    expect(flags.length).toBeGreaterThan(90);
    const renamed: Record<string, string> = {
      "ignore-pattern": "ignorePatterns",
      "report-unused-disable-directives-severity": "reportUnusedDisableDirectives",
      plugin: "plugins",
      rule: "rules",
      global: "globals",
      allow: "categories",
      warn: "categories",
      deny: "categories",
    };
    const answers = await Promise.all(
      flags.map(async flag => {
        const positive = flag.replace(/^no-/, "");
        const key = renamed[positive] ?? positive.replace(/-(\w)/g, (_, it) => it.toUpperCase());
        // No key takes a nested array, so a key that exists complains about the type.
        const { stderr } = await run({ "bunfig.toml": `[lint]\n${key} = [[1]]\n` }, ["--list-files"]);
        return [flag, /expected .+ but received|is not a valid severity|cannot be set in bunfig\.toml/.test(stderr)];
      }),
    );
    // ESLint and oxlint flags that aren't project settings, or that do nothing.
    expect(
      answers
        .filter(it => !it[1])
        .map(it => it[0])
        .sort(),
    ).toEqual([
      "cache",
      "cache-file",
      "cache-location",
      "cache-strategy",
      "concurrency",
      "disable-oxc-plugin",
      "disable-typescript-plugin",
      "disable-unicorn-plugin",
      "env",
      "flag",
      "import-plugin",
      "jest-plugin",
      "jsdoc-plugin",
      "jsx-a11y-plugin",
      "lsp",
      "mcp",
      "nextjs-plugin",
      "no-eslintrc",
      "node-plugin",
      "parser",
      "promise-plugin",
      "react-perf-plugin",
      "react-plugin",
      "resolve-plugins-relative-to",
      "rulesdir",
      "vitest-plugin",
      "vue-plugin",
    ]);
  });
});

describe.concurrent("a bunfig.toml above the working directory", () => {
  /** Runs `bun lint -f unix ...args` in `cwd`, a directory of `files`. Returns the problems as `path:line rule`, from the root. */
  async function lintIn(cwd: string, files: Record<string, string>, args: string[], before: string[] = []) {
    using dir = tempDir("bun-lint", files);
    return await lintAt(String(dir), cwd, args, before);
  }

  /** The same in a project that is there, at `dir`. */
  async function lintAt(dir: string, cwd: string, args: string[], before: string[] = []) {
    await using proc = spawn({
      cmd: [bunExe(), ...before, "lint", "-f", "unix", ...args],
      env,
      cwd: join(dir, cwd),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const found = [...stdout.replaceAll("\\", "/").matchAll(/^(\S+?):(\d+):\d+: .* \[\w+\/(.+)\]$/gm)].map(
      ([, path, line, rule]) => {
        // oxlint's paths start in the working directory.
        const whole = path.includes("bun-lint_")
          ? path.replace(/^.*bun-lint_\w+\//, "")
          : join(cwd, path).replaceAll("\\", "/");
        return `${whole}:${line} ${rule.replace(/^eslint\((.+)\)$/, "$1").replace(/^(\w+)\((.+)\)$/, "$1/$2")}`;
      },
    );
    return {
      found: found.sort(),
      stderr: normalizeBunSnapshot(stderr, dir).replace(/ \[[\d.]+m?s\]/, ""),
      exitCode,
    };
  }

  const code = "// TODO\ndebugger;\nconsole.log(1);\n";
  const project = {
    "package.json": `{ "type": "module" }`,
    "bunfig.toml": `[lint]
ignorePatterns = ["packages/app/vendor/", "**/gen/**", "packages/*/out/"]
plugins = ["./tools/plugin.js"]

[lint.rules]
"no-debugger" = "error"
"no-console" = "error"
"local/no-todo" = "warn"

[[lint.overrides]]
files = ["packages/app/test/**"]
excludeFiles = ["packages/app/test/keep/**"]
rules = { "no-console" = "off" }
`,
    "tools/plugin.js": `export default { meta: { name: "local" }, rules: { "no-todo": { create: context => ({
      Program() { for (const it of context.sourceCode.getAllComments()) if (it.value.includes("TODO")) context.report({ node: it, message: "No TODO." }); },
    }) } } };\n`,
    "packages/app/src/a.js": code,
    "packages/app/src/gen/b.js": code,
    "packages/app/vendor/c.js": code,
    "packages/app/out/d.js": code,
    "packages/app/test/e.js": code,
    "packages/app/test/keep/f.js": code,
  };
  const all = (path: string) => [`${path}:1 local/no-todo`, `${path}:2 no-debugger`, `${path}:3 no-console`];
  const expected = [
    ...all("packages/app/src/a.js"),
    ...all("packages/app/test/e.js").slice(0, 2),
    ...all("packages/app/test/keep/f.js"),
  ].sort();

  const configs: [string, Record<string, string>][] = [
    ["no config file", {}],
    ["eslint.config.js", { "eslint.config.js": "export default [{ rules: {} }];\n" }],
    [".oxlintrc.json", { ".oxlintrc.json": `{ "rules": {} }` }],
    [
      ".eslintrc.json",
      { ".eslintrc.json": `{ "root": true, "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" } }` },
    ],
  ];
  describe.each(configs)("%s", (_, config) => {
    test.each([
      [".", ["packages/app"]],
      ["packages/app", ["."]],
      ["packages/app", []],
      ["packages/app/src", [".."]],
      ["packages/app/test/keep", ["../.."]],
      ["tools", ["../packages"]],
    ])("the same is found from %s with %j", async (cwd, args) => {
      expect(await lintIn(cwd, { ...project, ...config }, args)).toMatchObject({ found: expected, exitCode: 1 });
    });

    test("the patterns of a file that --config names start in the working directory", async () => {
      const { "bunfig.toml": bunfig, ...rest } = project;
      const files = { ...rest, ...config, "tools/bunfig.toml": bunfig.replace("./tools/plugin.js", "./plugin.js") };
      const result = await lintIn(".", files, ["packages/app"], ["--config=tools/bunfig.toml"]);
      expect(result).toMatchObject({ found: expected, exitCode: 1 });
    });

    test("the suppressions file is one file for every directory", async () => {
      const bunfig = `[lint]\nsuppressionsLocation = "tools/suppressed.json"\n[lint.rules]\n"no-debugger" = "error"\n`;
      using dir = tempDir("bun-lint", {
        ...config,
        "package.json": `{ "type": "module" }`,
        "bunfig.toml": bunfig,
        "packages/app/a.js": "debugger;\n",
        "packages/lib/b.js": "debugger;\n",
      });
      const read = async () => Object.keys(await Bun.file(join(String(dir), "tools/suppressed.json")).json()).sort();
      expect(await lintAt(String(dir), "packages/app", ["--suppress-all"])).toMatchObject({ found: [], exitCode: 0 });
      expect(await read()).toEqual(["packages/app/a.js"]);
      expect(await lintAt(String(dir), ".", ["--suppress-all"])).toMatchObject({ found: [], exitCode: 0 });
      expect(await read()).toEqual(["packages/app/a.js", "packages/lib/b.js"]);
      for (const cwd of [".", "packages", "packages/app", "packages/lib"]) {
        expect(await lintAt(String(dir), cwd, [])).toMatchObject({ found: [], exitCode: 0 });
      }
      // What another directory has is not unused.
      expect(await lintAt(String(dir), "packages/app", ["--prune-suppressions"])).toMatchObject({ exitCode: 0 });
      expect(await read()).toEqual(["packages/app/a.js", "packages/lib/b.js"]);
    });

    test("--ignore-pattern starts in the working directory", async () => {
      const result = await lintIn("packages/app", { ...project, ...config }, [".", "--ignore-pattern", "test/"]);
      expect(result).toMatchObject({ found: all("packages/app/src/a.js").sort(), exitCode: 1 });
    });
  });

  test("the suppressions file with the usual name is looked for where bunfig.toml is", async () => {
    using dir = tempDir("bun-lint", {
      "bunfig.toml": `[lint.rules]\n"no-debugger" = "error"\n`,
      "packages/app/a.js": "debugger;\n",
    });
    expect(await lintAt(String(dir), "packages/app", ["--suppress-all"])).toMatchObject({ found: [], exitCode: 0 });
    expect(await Bun.file(join(String(dir), "eslint-suppressions.json")).json()).toEqual({
      "packages/app/a.js": { "no-debugger": { count: 1 } },
    });
    expect(await lintAt(String(dir), ".", [])).toMatchObject({ found: [], exitCode: 0 });
  });

  test.each(configs.slice(1))(
    "next to %s a new suppressions file is where that tool looks for it",
    async (name, config) => {
      using dir = tempDir("bun-lint", {
        "package.json": `{ "type": "module" }`,
        "bunfig.toml": `[lint.rules]\n"no-debugger" = "error"\n`,
        ...Object.fromEntries(Object.entries(config).map(([path, text]) => [`project/${path}`, text])),
        "project/src/a.js": "debugger;\n",
      });
      expect(await lintAt(String(dir), "project", ["--suppress-all"])).toMatchObject({ found: [], exitCode: 0 });
      const file = name === ".oxlintrc.json" ? "oxlint-suppressions.json" : "eslint-suppressions.json";
      expect(existsSync(join(String(dir), "project", file))).toBe(true);
      expect(existsSync(join(String(dir), file))).toBe(false);
      for (const cwd of ["project", "project/src"]) {
        expect(await lintAt(String(dir), cwd, [])).toMatchObject({ found: [], exitCode: 0 });
      }
    },
  );

  test("--suppressions-location, and the names in that file, start in the working directory", async () => {
    using dir = tempDir("bun-lint", {
      "bunfig.toml": `[lint]\nsuppressionsLocation = "unused.json"\n[lint.rules]\n"no-debugger" = "error"\n`,
      "packages/app/a.js": "debugger;\n",
    });
    const flags = ["--suppressions-location", "mine.json"];
    expect(await lintAt(String(dir), "packages/app", [...flags, "--suppress-all"])).toMatchObject({ exitCode: 0 });
    expect(await Bun.file(join(String(dir), "packages/app/mine.json")).json()).toEqual({
      "a.js": { "no-debugger": { count: 1 } },
    });
    expect(await lintAt(String(dir), "packages/app", flags)).toMatchObject({ found: [], exitCode: 0 });
  });

  test.each([
    [
      "tools/eslint.config.js",
      `export default [{ ignores: ["packages/app/gen/**"] }, { files: ["packages/app/**"], rules: { "no-debugger": "error" } }];\n`,
    ],
    [
      "tools/.eslintrc.json",
      `{ "root": true, "ignorePatterns": ["packages/app/gen/**"], "overrides": [{ "files": ["packages/app/**"], "rules": { "no-debugger": "error" } }] }`,
    ],
  ])("the patterns in %s, which `config` names, start where bunfig.toml is", async (path, config) => {
    const files = {
      "package.json": `{ "type": "module" }`,
      "bunfig.toml": `[lint]\nconfig = "${path}"\n`,
      [path]: config,
      "packages/app/a.js": "debugger;\n",
      "packages/app/gen/b.js": "debugger;\n",
      "packages/lib/c.js": "debugger;\n",
    };
    for (const [cwd, args] of [
      [".", ["packages"]],
      ["packages/app", ["..", "--no-warn-ignored"]],
      ["packages/app/gen", ["../.."]],
    ] as const) {
      expect(await lintIn(cwd, files, [...args])).toMatchObject({ found: ["packages/app/a.js:1 no-debugger"] });
    }
    // The flag is as it was.
    const flag = ["--config", `../../${path}`, "."];
    expect(await lintIn("packages/app", files, flag)).toMatchObject({ found: [], exitCode: 0 });
  });

  const standIn = {
    "node_modules/eslint-plugin-import/package.json": `{ "name": "eslint-plugin-import", "version": "2.31.0", "main": "index.js", "type": "commonjs" }`,
    "node_modules/eslint-plugin-import/index.js": `const rule = { meta: { schema: false }, create() { return {}; } };\nmodule.exports = { meta: { name: "eslint-plugin-import" }, rules: { "no-restricted-paths": rule, "no-unassigned-import": rule } };\n`,
  };

  test.each(configs)("a path in the options of a rule starts where bunfig.toml is: %s", async (name, config) => {
    const files = {
      ...standIn,
      ...config,
      "package.json": `{ "type": "module" }`,
      "bunfig.toml": `[lint]
plugins = ["import"]

[lint.rules]
"import/no-restricted-paths" = ["error", { zones = [{ target = "./src/client", from = "./src/server" }] }]

[[lint.overrides]]
files = ["**/*.js"]
rules = { "import/no-unassigned-import" = ["error", { allow = ["src/client/*.css", "**/*.svg"] }] }
`,
      "src/server/s.js": "export const s = 1;\n",
      "src/client/style.css": "a {}\n",
      "src/client/c.js": `import "./style.css";\nimport "./a.svg";\nimport { s } from "../server/s.js";\nexport const c = s;\n`,
    };
    // oxlint holds \`allow\` against what is written in the import.
    const expected = ["src/client/c.js:3 import/no-restricted-paths"];
    if (name === ".oxlintrc.json") expected.unshift("src/client/c.js:1 import/no-unassigned-import");
    for (const [cwd, args] of [
      [".", ["src"]],
      ["src", []],
      ["src/client", []],
      ["src/server", ["../client"]],
    ] as const) {
      expect(await lintIn(cwd, files, [...args])).toMatchObject({ found: expected, exitCode: 1 });
    }
  });

  test.each(["import-x/no-restricted-paths", "eslint-plugin-import/no-restricted-paths"])(
    "so it does in the options of %s",
    async rule => {
      const files = {
        ".oxlintrc.json": `{ "plugins": ["import"] }`,
        "bunfig.toml": `[lint.rules]\n"${rule}" = ["error", { zones = [{ target = "./src/client", from = "./src/server" }] }]\n`,
        "src/server/s.js": "export const s = 1;\n",
        "src/client/c.js": `import { s } from "../server/s.js";\nexport const c = s;\n`,
      };
      for (const cwd of [".", "src", "src/client"]) {
        expect(await lintIn(cwd, files, [])).toMatchObject({ found: ["src/client/c.js:1 import/no-restricted-paths"] });
      }
    },
  );

  test("the name of a package in `allow` of import/no-unassigned-import is no path", async () => {
    const files = {
      "bunfig.toml": `[lint.rules]
"import/no-unassigned-import" = ["error", { allow = ["dotenv/config", "reflect-metadata", "**/*.css", "packages/app/ok/*.js"] }]
`,
      "packages/app/a.js": `import "dotenv/config";\nimport "reflect-metadata";\nimport "./x.css";\nimport "./ok/y.js";\nimport "./no/z.js";\n`,
    };
    for (const [cwd, args] of [
      [".", ["packages"]],
      ["packages/app", []],
    ] as const) {
      expect(await lintIn(cwd, files, [...args])).toMatchObject({
        found: ["packages/app/a.js:5 import/no-unassigned-import"],
      });
    }
  });

  test("a pattern in `allow` that is a path is not one from the working directory too", async () => {
    const files = {
      "bunfig.toml": `[lint.rules]\n"import/no-unassigned-import" = ["error", { allow = ["src/styles/**", "dotenv/config"] }]\n`,
      "src/styles/a.css": "a {}\n",
      "packages/app/src/styles/b.css": "a {}\n",
      "packages/app/src/main.js": `import "./styles/b.css";\nimport "dotenv/config";\nimport "../../../src/styles/a.css";\n`,
    };
    for (const [cwd, args] of [
      [".", ["packages"]],
      ["packages", []],
      ["packages/app", []],
      ["packages/app/src", []],
    ] as const) {
      expect(await lintIn(cwd, files, [...args])).toMatchObject({
        found: ["packages/app/src/main.js:1 import/no-unassigned-import"],
      });
    }
  });

  test.each([`basePath = ""`, `basePath = "."`, `basePath = "./"`])(
    "import/no-restricted-paths with %s starts where bunfig.toml is",
    async basePath => {
      const files = {
        "bunfig.toml": `[lint.rules]\n"import/no-restricted-paths" = ["error", { ${basePath}, zones = [{ target = "./src/client", from = "./src/server" }] }]\n`,
        "src/server/s.js": "export const s = 1;\n",
        "src/client/c.js": `import { s } from "../server/s.js";\nexport const c = s;\n`,
      };
      for (const cwd of [".", "src", "src/client"]) {
        expect(await lintIn(cwd, files, [])).toMatchObject({ found: ["src/client/c.js:1 import/no-restricted-paths"] });
      }
    },
  );

  test.each(["import/resolver", "import/resolve"])(
    "`paths` of the node resolver in %s start where bunfig.toml is",
    async key => {
      const value = key === "import/resolver" ? `{ node = { paths = ["lib"] } }` : `{ paths = ["lib"] }`;
      const files = {
        "package.json": `{ "type": "module" }`,
        // Without a config file "import/resolver" is set, and the old name does not count.
        ...(key === "import/resolve" ? { ".oxlintrc.json": `{ "plugins": ["import"] }` } : {}),
        "bunfig.toml": `[lint.rules]\n"import/no-unresolved" = "error"\n[lint.settings]\n"${key}" = ${value}\n`,
        "lib/shared.js": "export const shared = 1;\n",
        "packages/app/package.json": `{ "name": "app", "type": "module" }`,
        "packages/app/src/x.js": `import { shared } from "shared";\nimport { other } from "other";\nexport const x = [shared, other];\n`,
      };
      // With and without a package.json in the working directory.
      for (const cwd of [".", "packages", "packages/app", "packages/app/src"]) {
        expect(await lintIn(cwd, files, [])).toMatchObject({ found: ["packages/app/src/x.js:2 import/no-unresolved"] });
      }
    },
  );

  test("without a config file, the tsconfig.json that nothing names is the nearest to the file", async () => {
    const paths = (alias: string) => `{ "compilerOptions": { "paths": { "${alias}/*": ["./src/*"] } } }`;
    const code = `import a from "@root/y";\nimport b from "@app/y";\nimport c from "@lib/y";\nexport default [a, b, c];\n`;
    const files = {
      "bunfig.toml": `[lint.rules]\n"import/no-unresolved" = "error"\n`,
      "tsconfig.json": paths("@root"),
      "src/y.ts": "export default 1;\n",
      "src/x.ts": code,
      "packages/app/tsconfig.json": paths("@app"),
      "packages/app/src/y.ts": "export default 1;\n",
      "packages/app/src/x.ts": code,
      "packages/lib/tsconfig.json": paths("@lib"),
      "packages/lib/src/y.ts": "export default 1;\n",
      "packages/lib/src/x.ts": code,
    };
    const expected = [
      "packages/app/src/x.ts:1 import/no-unresolved",
      "packages/app/src/x.ts:3 import/no-unresolved",
      "packages/lib/src/x.ts:1 import/no-unresolved",
      "packages/lib/src/x.ts:2 import/no-unresolved",
      "src/x.ts:2 import/no-unresolved",
      "src/x.ts:3 import/no-unresolved",
    ];
    for (const [cwd, up] of [
      [".", "."],
      ["src", ".."],
      ["packages", ".."],
      ["packages/app", "../.."],
      ["packages/lib/src", "../../.."],
    ]) {
      expect(await lintIn(cwd, files, [up])).toMatchObject({ found: expected });
    }
  });

  test("next to eslint.config.js it is that of the working directory, as it was", async () => {
    const files = {
      ...standIn,
      "package.json": `{ "type": "module" }`,
      "bunfig.toml": `[lint]\nquiet = false\n`,
      "project/tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
      "project/eslint.config.js": `import plugin from "eslint-plugin-import";
        export default [{ plugins: { import: plugin }, settings: { "import/resolver": { typescript: true } },
          rules: { "import/no-unresolved": "error" } }];\n`,
      "project/src/y.js": "export default 1;\n",
      "project/src/x.js": `import y from "@/y";\nexport default y;\n`,
    };
    expect(await lintIn("project", files, [])).toMatchObject({ found: [] });
    expect(await lintIn("project/src", files, [])).toMatchObject({
      found: ["project/src/x.js:1 import/no-unresolved"],
    });
  });

  test("import/no-unused-modules looks for files from where bunfig.toml is, with or without `src`", async () => {
    const files = (options: string) => ({
      "package.json": `{ "type": "module" }`,
      ".eslintrc.json": `{ "root": true, "parserOptions": { "sourceType": "module", "ecmaVersion": 2022 } }`,
      "bunfig.toml": `[lint]\nplugins = ["import"]\n[lint.rules]\n"import/no-unused-modules" = ["error", { unusedExports = true${options} }]\n`,
      "src/a/lib.js": "export const used = 1;\n",
      "src/a/dead.js": "export const dead = 1;\n",
      "src/b/entry.js": "export const entry = 1;\n",
      "src/b/main.js": `import { used } from "../a/lib.js";\nconsole.log(used);\n`,
    });
    for (const options of ["", `, src = ["src"]`, `, src = ["src"], ignoreExports = ["**/entry.js"]`]) {
      for (const [cwd, args] of [
        [".", ["src/a"]],
        ["src/a", []],
      ] as const) {
        expect(await lintIn(cwd, files(options), [...args])).toMatchObject({
          found: ["src/a/dead.js:1 import/no-unused-modules"],
        });
      }
    }
  });

  test.each([
    ["no setting", ""],
    ["typescript = true", `[lint.settings]\n"import/resolver" = { typescript = true }\n`],
    ["project", `[lint.settings]\n"import/resolver" = { typescript = { project = "./tsconfig.json" } }\n`],
    ["projects", `[lint.settings]\n"import/resolver" = { typescript = { project = ["tsconfig.json"] } }\n`],
    ["a pattern", `[lint.settings]\n"import/resolver" = { typescript = { project = ["tsconf*.json"] } }\n`],
    [
      "configFile",
      `[lint.settings]\n"import/resolver" = { typescript = { tsconfig = { configFile = "tsconfig.json" } } }\n`,
    ],
    [
      "the name of the package",
      `[lint.settings]\n"import/resolver" = { "eslint-import-resolver-typescript" = { project = "tsconfig.json" } }\n`,
    ],
    ["a list", `[lint.settings]\n"import/resolver" = [{ typescript = { project = "./tsconfig.json" } }]\n`],
  ])("an import is resolved as from where bunfig.toml is: %s", async (_, settings) => {
    const files = {
      "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
      "bunfig.toml": `[lint.rules]\n"import/no-unresolved" = "error"\n"import/named" = "error"\n${settings}`,
      "src/lib/y.ts": "export const y = 1;\n",
      "src/t.ts": `import { y, z } from "@/lib/y";\nexport const t = [y, z];\n`,
    };
    for (const cwd of [".", "src", "src/lib"]) {
      expect(await lintIn(cwd, files, [join(cwd === "." ? "src" : cwd === "src" ? "." : "..", "t.ts")])).toMatchObject({
        found: ["src/t.ts:1 import/named"],
      });
    }
  });

  test.each([
    `parserOptions = { project = "./config/tsconfig.lint.json" }`,
    `parserOptions = { project = ["./config/tsconfig.lint.json"] }`,
    `parserOptions = { project = ["./conf*/tsconfig.lint.json"] }`,
    `parserOptions = { project = "tsconfig.lint.json", tsconfigRootDir = "config" }`,
  ])("%s starts where bunfig.toml is", async parserOptions => {
    const files = {
      "config/tsconfig.lint.json": `{ "compilerOptions": { "strict": false }, "include": ["../src"] }`,
      "bunfig.toml": `[lint]\n${parserOptions}\nrules = { "@typescript-eslint/no-unnecessary-condition" = "error" }\n`,
      "src/t.ts": "export function f(a: string) {\n  if (a === null) return 1;\n  return 2;\n}\n",
    };
    // Without `strictNullChecks` the rule says so, and nothing else.
    for (const cwd of [".", "src"]) {
      expect(await lintIn(cwd, files, [])).toMatchObject({
        found: ["src/t.ts:0 @typescript-eslint/no-unnecessary-condition"],
      });
    }
  });

  test("ignorePatterns start where bunfig.toml is for an .oxlintrc.json below it too", async () => {
    const files = {
      "bunfig.toml": `[lint]\nignorePatterns = ["generated/**"]\n`,
      "generated/a.js": "debugger;\n",
      "packages/app/.oxlintrc.json": `{ "rules": { "no-debugger": "error" } }`,
      "packages/app/generated/b.js": "debugger;\n",
    };
    for (const [cwd, args] of [
      [".", ["."]],
      ["packages/app", ["../.."]],
      ["packages/app", []],
    ] as const) {
      expect(await lintIn(cwd, files, [...args])).toMatchObject({
        found: ["packages/app/generated/b.js:1 no-debugger"],
      });
    }
  });

  test.each([
    ["./other", "./another"],
    // The very same words.
    ["./src/client", "./src/server"],
  ])("--rule for a rule that bunfig.toml has too starts in the working directory: %s", async (target, from) => {
    const files = {
      "bunfig.toml": `[lint.rules]\n"import/no-restricted-paths" = ["error", { zones = [{ target = "${target}", from = "${from}" }] }]\n`,
      "project/src/server/s.js": "export const s = 1;\n",
      "project/src/client/c.js": `import { s } from "../server/s.js";\nexport const c = s;\n`,
    };
    const rule = `import/no-restricted-paths: [error, { zones: [{ target: ./src/client, from: ./src/server }] }]`;
    expect(await lintIn("project", files, ["--rule", rule])).toMatchObject({
      found: ["project/src/client/c.js:1 import/no-restricted-paths"],
      exitCode: 1,
    });
  });

  test("a path in the options of --rule starts in the working directory", async () => {
    const files = {
      "bunfig.toml": `[lint]\nquiet = false\n`,
      "project/src/server/s.js": "export const s = 1;\n",
      "project/src/client/c.js": `import { s } from "../server/s.js";\nexport const c = s;\n`,
    };
    const rule = `import/no-restricted-paths: [error, { zones: [{ target: ./src/client, from: ./src/server }] }]`;
    expect(await lintIn("project", files, ["--rule", rule])).toMatchObject({
      found: ["project/src/client/c.js:1 import/no-restricted-paths"],
      exitCode: 1,
    });
  });

  test.each([
    [
      "eslint.config.js",
      (rules: string) =>
        `import plugin from "eslint-plugin-import";\nexport default [{ plugins: { import: plugin }, rules: ${rules} }];\n`,
    ],
    [
      ".eslintrc.json",
      (rules: string) =>
        `{ "root": true, "plugins": ["import"], "parserOptions": { "sourceType": "module", "ecmaVersion": 2022 }, "rules": ${rules} }`,
    ],
  ])("a path in the options of a rule in %s starts in the working directory, as it did", async (name, config) => {
    const rules = `{ "import/no-restricted-paths": ["error", { "zones": [{ "target": "./src/client", "from": "./src/server" }] }] }`;
    const files = {
      "bunfig.toml": `[lint]\nmaxWarnings = 10\n`,
      "package.json": `{ "type": "module" }`,
      ...standIn,
      [`packages/app/${name}`]: config(rules),
      "packages/app/src/server/s.js": "export const s = 1;\n",
      "packages/app/src/client/c.js": `import { s } from "../server/s.js";\nexport const c = s;\n`,
    };
    expect(await lintIn("packages/app", files, [])).toMatchObject({
      found: ["packages/app/src/client/c.js:1 import/no-restricted-paths"],
      exitCode: 1,
    });
  });

  test("a suppressions file with the usual name that is nearer than bunfig.toml is the one, with its names", async () => {
    using dir = tempDir("bun-lint", {
      "bunfig.toml": `[lint.rules]\n"no-debugger" = "error"\n`,
      "packages/app/eslint-suppressions.json": `{ "src/a.js": { "no-debugger": { "count": 1 } } }`,
      "packages/app/src/a.js": "debugger;\n",
      "packages/lib/b.js": "debugger;\n",
    });
    for (const cwd of ["packages/app", "packages/app/src"]) {
      expect(await lintAt(String(dir), cwd, [])).toMatchObject({ found: [], exitCode: 0 });
    }
    // It is not above these.
    expect(await lintAt(String(dir), "packages/lib", [])).toMatchObject({ found: ["packages/lib/b.js:1 no-debugger"] });
    expect(await lintAt(String(dir), ".", ["packages/app"])).toMatchObject({
      found: ["packages/app/src/a.js:1 no-debugger"],
    });
  });

  test.each([
    ["[lint.rules]", `[lint.rules]\n"bun/format" = "error"\n`, []],
    ["[[lint.overrides]]", `[[lint.overrides]]\nfiles = ["*.js"]\nrules = { "bun/format" = "error" }\n`, []],
    ["--rule", `[lint]\nquiet = false\n`, ["--rule", "bun/format: error"]],
    ["-D", `[lint]\nquiet = false\n`, ["-D", "bun/format"]],
  ])("with bun/format in %s, a bunfig.toml above that cannot be used is not passed over", async (_, bunfig, args) => {
    const files = {
      "bunfig.toml": "[fmt]\nsemi = false\n",
      "work/bunfig.toml": "[fmt]\nsemii = true\n",
      "work/project/bunfig.toml": bunfig,
      "work/project/a.js": "export const a = 1\n",
    };
    expect(await lintIn("work/project", files, args)).toEqual({
      found: [],
      stderr: `2 | semii = true\n    ^\nerror: Unknown key "semii" in [fmt]\n  Did you mean "semi"?\n    at ../bunfig.toml:2:1`,
      exitCode: 2,
    });
    const { "work/bunfig.toml": _broken, ...rest } = files;
    expect(await lintIn("work/project", rest, args)).toMatchObject({ found: [], exitCode: 0 });
  });

  test.each([
    ["that is no TOML", "[install\n"],
    ["with a mistake in [fmt]", "[fmt]\nprintWidht = 80\n"],
    ["with a mistake in [lint]", "[lint]\nnope = 1\n"],
  ])("a project with a [lint] of its own does not mind a bunfig.toml above it %s", async (_, above) => {
    const files = {
      "bunfig.toml": above,
      "work/project/bunfig.toml": `[lint.rules]\n"no-debugger" = "warn"\n`,
      "work/project/src/a.js": "debugger;\n",
    };
    for (const cwd of ["work/project", "work/project/src"]) {
      expect(await lintIn(cwd, files, [])).toEqual({
        found: ["work/project/src/a.js:1 no-debugger"],
        stderr: "Linted 1 file",
        exitCode: 0,
      });
    }
  });

  test("ignorePath, and what the file has, start where bunfig.toml is", async () => {
    const files = {
      ...project,
      "bunfig.toml": `[lint]\nignorePath = "tools/ignored"\n`,
      "tools/ignored": "packages/app/test/\nvendor\ngen\nout\n",
    };
    for (const [cwd, args] of [
      [".", ["packages"]],
      ["packages/app", ["."]],
      ["packages/app/src", [".."]],
    ] as const) {
      expect(await lintIn(cwd, files, [...args])).toMatchObject({
        found: ["packages/app/src/a.js:2 no-debugger"],
        exitCode: 1,
      });
    }
    // The flag's path and patterns start in the working directory.
    const byFlag = await lintIn("packages/app", { ...files, "packages/app/mine": "src\nvendor\nout\n" }, [
      ".",
      "--ignore-path",
      "mine",
    ]);
    expect(byFlag.found).toEqual(["packages/app/test/e.js:2 no-debugger", "packages/app/test/keep/f.js:2 no-debugger"]);
  });

  test("config starts where bunfig.toml is", async () => {
    const files = {
      "bunfig.toml": `[lint]\nconfig = "tools/lint.config.js"\n`,
      "package.json": `{ "type": "module" }`,
      "tools/lint.config.js": `export default [{ rules: { "no-console": "error" } }];\n`,
      "packages/app/a.js": code,
    };
    expect(await lintIn("packages/app", files, ["."])).toMatchObject({
      found: ["packages/app/a.js:3 no-console"],
      exitCode: 1,
    });
  });

  test("the nearest that has a [lint] section counts, and nothing else of those above", async () => {
    const files = {
      "bunfig.toml": `preload = ["./missing.js"]\nlogLevel = 1\n[lint.rules]\n"no-console" = "error"\n`,
      "packages/bunfig.toml": `[test]\ncoverage = true\n`,
      "packages/app/bunfig.toml": `[install]\nexact = true\n`,
      "packages/app/a.js": code,
      "packages/own/bunfig.toml": `[lint.rules]\n"no-debugger" = "off"\n`,
      "packages/own/a.js": code,
      "packages/own/src/a.js": code,
    };
    expect((await lintIn("packages/app", files, ["."])).found).toEqual([
      "packages/app/a.js:2 no-debugger",
      "packages/app/a.js:3 no-console",
    ]);
    expect(await lintIn("packages/own/src", files, ["."])).toMatchObject({ found: [], exitCode: 0 });
  });

  test("bun/format holds a file against the [fmt] that bun fmt would read, wherever [lint] is", async () => {
    const files = {
      "bunfig.toml": `[fmt]\nsemi = false\n[lint.rules]\n"no-debugger" = "off"\n`,
      "packages/bunfig.toml": `[lint.rules]\n"bun/format" = "error"\n`,
      "packages/app/a.js": `export const a = "b";\n`,
      "packages/app/b.js": `export const a = "b"\n`,
      "packages/own/bunfig.toml": `[fmt]\nsingleQuote = true\n`,
      "packages/own/a.js": `export const a = "b";\n`,
      "packages/own/b.js": `export const a = 'b';\n`,
    };
    expect((await lintIn("packages/app", files, ["."])).found).toEqual(["packages/app/a.js:1 bun/format"]);
    expect((await lintIn("packages/own", files, ["."])).found).toEqual(["packages/own/a.js:1 bun/format"]);
  });

  test.each([
    [
      `[lint.rules]\n"no-consol" = "error"\n`,
      `error: Unknown rule "no-consol"\n  Did you mean "no-console"?\n    at ../../bunfig.toml:2:1`,
    ],
    [
      `[lint]\nignorePat = "a"\n`,
      `error: Unknown key "ignorePat" in [lint]\n  Did you mean "ignorePath"?\n    at ../../bunfig.toml:2:1`,
    ],
    [`[lint]\nplugins = ["./nope.js"]\n`, `    at ../../bunfig.toml:2:12`],
    [`[lint\n`, `    at ../../bunfig.toml:1:6`],
  ])("a mistake is shown with the path of the file: %j", async (bunfig, message) => {
    const { found, stderr, exitCode } = await lintIn(
      "packages/app",
      { "bunfig.toml": bunfig, "packages/app/a.js": code },
      ["."],
    );
    expect(stderr).toContain(message);
    expect({ found, exitCode }).toEqual({ found: [], exitCode: 2 });
  });

  test("--init says that there is one, and writes nothing", async () => {
    using dir = tempDir("bun-lint", {
      "bunfig.toml": `[lint.rules]\n"no-console" = "error"\n`,
      "packages/app/a.js": code,
    });
    await using proc = spawn({
      cmd: [bunExe(), "lint", "--init"],
      env,
      cwd: join(String(dir), "packages/app"),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "../../bunfig.toml already has a [lint] section\n",
      stderr: "",
      exitCode: 0,
    });
    expect(existsSync(join(String(dir), "packages/app/bunfig.toml"))).toBe(false);
  });

  test.each(["../../shared.toml", "absolute"])("--init with --config=%s is as it was", async named => {
    using dir = tempDir("bun-lint", { "shared.toml": `[lint]\nquiet = false\n`, "packages/app/a.js": code });
    const path = named === "absolute" ? join(String(dir), "shared.toml") : named;
    await using proc = spawn({
      cmd: [bunExe(), `--config=${path}`, "lint", "--init"],
      env,
      cwd: join(String(dir), "packages/app"),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "Created bunfig.toml with a [lint] section\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// At the root every row was run on oxlint 1.87, with --ignore-path.
describe.concurrent("a file that is named, and `ignorePath` beside an .oxlintrc.json", () => {
  test.each([
    ["b.js", "a.js"],
    ["packages/app/src/gen/b.js", "a.js"],
    ["/packages/app/src/gen/b.js", "a.js"],
    ["**/gen/*.js", "a.js"],
    ["packages/**", ""],
    // These are no paths from where the file is.
    ["gen/b.js", "a.js gen/b.js"],
    ["src/gen/b.js", "a.js gen/b.js"],
    // A directory is not asked about a file that is named.
    ["packages/app/src/gen/", "a.js gen/b.js"],
  ])("%j", async (pattern, linted) => {
    using dir = tempDir("bun-lint", {
      ".oxlintrc.json": `{ "rules": { "no-debugger": "error" } }`,
      "bunfig.toml": `[lint]\nignorePath = ".lintignore"\n`,
      ".lintignore": `${pattern}\n`,
      "packages/app/src/a.js": "debugger;\n",
      "packages/app/src/gen/b.js": "debugger;\n",
    });
    for (const [cwd, prefix] of [
      [".", "packages/app/src/"],
      ["packages", "app/src/"],
      ["packages/app", "src/"],
      ["packages/app/src", ""],
    ]) {
      await using proc = spawn({
        cmd: [bunExe(), "lint", "-f", "unix", `${prefix}a.js`, `${prefix}gen/b.js`],
        env,
        cwd: join(String(dir), cwd),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const found = [...stdout.replaceAll("\\", "/").matchAll(/^(\S+?):1:1: /gm)].map(it => it[1].slice(prefix.length));
      expect({ cwd, linted: found.sort().join(" "), stderr, exitCode }).toEqual({
        cwd,
        linted,
        stderr: "",
        exitCode: 1,
      });
    }
  });
});

describe.concurrent("what is read from standard input beside an .oxlintrc.json", () => {
  test.each([
    ["ignorePatterns", `[lint]\nignorePatterns = ["generated/**"]\n`, [], "."],
    ["ignorePatterns, from below", `[lint]\nignorePatterns = ["generated/**"]\n`, [], "generated"],
    ["--ignore-pattern", "", ["--ignore-pattern", "generated/**"], "."],
  ])("is left out by %s", async (_, bunfig, flags, cwd) => {
    using dir = tempDir("bun-lint", {
      ".oxlintrc.json": `{ "rules": { "no-debugger": "error" } }`,
      "bunfig.toml": bunfig,
      "generated/a.js": "debugger;\n",
      "src/a.js": "debugger;\n",
    });
    const run = async (name: string) => {
      await using proc = spawn({
        cmd: [bunExe(), "lint", "-f", "unix", ...flags, "--stdin", "--stdin-filename", name],
        env,
        cwd: join(String(dir), cwd),
        stdin: Buffer.from("debugger;\n"),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { line: stdout.split("\n")[0].replace(/^\S+?:(\d+:\d+): /, "$1 "), exitCode };
    };
    const up = cwd === "." ? "" : "../";
    expect(await run(`${up}generated/a.js`)).toMatchObject({
      line: expect.stringMatching(/^0:0 File ignored because of a matching ignore pattern\./),
    });
    expect(await run(`${up}src/a.js`)).toEqual({
      line: "1:1 `debugger` statement is not allowed [Error/eslint(no-debugger)]",
      exitCode: 1,
    });
  });
});

// Every row was run on oxlint 1.87.
describe.concurrent("--ignore-pattern beside an .oxlintrc.json, with another one further down", () => {
  const config = `{ "rules": { "no-debugger": "error" } }`;
  const files = {
    ".oxlintrc.json": config,
    "sub/.oxlintrc.json": config,
    ...Object.fromEntries(
      ["a.js", "gen/b.js", "sub/c.js", "sub/gen/d.js", "sub/deep/e.js"].map(it => [it, "debugger;\n"]),
    ),
  };
  test.each([
    [".", ["gen/**"], [], "a.js sub/c.js sub/deep/e.js sub/gen/d.js"],
    [".", ["gen"], [], "a.js sub/c.js sub/deep/e.js"],
    [".", ["/gen"], [], "a.js sub/c.js sub/deep/e.js sub/gen/d.js"],
    [".", ["gen/**"], ["sub"], "sub/c.js sub/deep/e.js sub/gen/d.js"],
    // A file that is named.
    [".", ["a.js"], ["a.js"], ""],
    [".", ["gen/**"], ["gen/b.js", "sub/gen/d.js"], "sub/gen/d.js"],
    [".", ["*.js"], ["sub/c.js"], ""],
    [".", ["c.js"], ["sub/c.js"], ""],
    [".", ["sub/c.js"], ["sub/c.js"], ""],
    [".", ["/sub/c.js"], ["sub/c.js"], ""],
    [".", ["sub/**"], ["sub/c.js", "sub/deep/e.js"], ""],
    // The directory that it is in is not asked about.
    [".", ["gen"], ["gen/b.js"], "gen/b.js"],
    [".", ["sub"], ["sub/deep/e.js"], "sub/deep/e.js"],
    ["sub", ["gen"], ["gen/d.js", "c.js"], "c.js gen/d.js"],
    ["sub", ["deep/**"], ["deep/e.js"], ""],
    ["sub", ["c.js"], ["c.js", "gen/d.js"], "gen/d.js"],
    ["sub", ["sub/c.js"], ["c.js"], "c.js"],
  ])("in %s, %j with %j", async (cwd, patterns, args, linted) => {
    using dir = tempDir("bun-lint", files);
    await using proc = spawn({
      cmd: [bunExe(), "lint", "-f", "unix", ...patterns.flatMap(it => ["--ignore-pattern", it]), ...args],
      env,
      cwd: join(String(dir), cwd),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const found = [...stdout.replaceAll("\\", "/").matchAll(/^(\S+?):1:1: /gm)].map(it => it[1]);
    // Every file has a problem, and to have no file is one.
    expect({ linted: found.sort().join(" "), stderr, exitCode }).toEqual({ linted, stderr: "", exitCode: 1 });
    if (linted === "") expect(stdout).toBe("No files found to lint. Please check your paths and ignore patterns.\n");
  });
});

describe.concurrent("[[lint.overrides]]", () => {
  /** Returns the problems as `file rule severity`. This output format is the same for every kind of config. */
  async function problems(files: Record<string, string>, args: string[] = []) {
    return (await lint(files, ["-f", "json-with-metadata", ...args])).problems;
  }

  const log = "console.log(1);\n";
  const tree = {
    "a.test.js": log,
    "sub/b.test.js": log,
    "sub/c.js": log,
    "scripts/d.js": log,
    "scripts/vendor/e.js": log,
    "README.md": "# Not JavaScript\n",
  };
  const bunfig = `
[lint.rules]
"no-console" = "error"

[[lint.overrides]]
files = ["*.test.js", "scripts/**"]
excludeFiles = ["scripts/vendor/**"]
rules = { "no-console" = "off" }

[[lint.overrides]]
files = "*.md"
rules = { "no-var" = "error" }
`;
  const left = ["scripts/vendor/e.js no-console error", "sub/c.js no-console error"];
  const flat = `module.exports = [{ rules: { "no-console": "warn" } }];\n`;
  const oxlintrc = JSON.stringify({ categories: { correctness: "off" }, rules: { "no-console": "warn" } });
  const configs: Record<string, Record<string, string>> = {
    "no config file": {},
    "eslint.config.js": { "eslint.config.js": flat },
    ".oxlintrc.json": { ".oxlintrc.json": oxlintrc },
    ".eslintrc.json": { ".eslintrc.json": JSON.stringify({ root: true, rules: { "no-console": "warn" } }) },
  };

  describe.each(Object.keys(configs))("with %s", name => {
    const files = { ...tree, ...configs[name], "bunfig.toml": bunfig };

    // A pattern without a slash matches a file name in any directory. Others match the path relative to bunfig.toml.
    test("an override applies to files that match `files` but not `excludeFiles`", async () => {
      expect(await problems(files)).toEqual(left);
    });

    test("`files` doesn't add files to the run", async () => {
      const { stdout, exitCode } = await lint(files, ["--list-files"]);
      expect(stdout).toContain("c.js");
      expect(stdout).not.toContain("README.md");
      expect(exitCode).toBe(0);
    });

    test("--rule wins over an override, even when it repeats [lint.rules]", async () => {
      const all = Object.keys(tree).filter(it => it.endsWith(".js"));
      expect(await problems(files, ["--rule", "no-console: error"])).toEqual(
        all.map(it => `${it} no-console error`).sort(),
      );
      expect(await problems(files, ["--rule", "no-console: warn", "sub"])).toEqual([
        "sub/b.test.js no-console warn",
        "sub/c.js no-console warn",
      ]);
    });

    test("a later override wins over an earlier one", async () => {
      const later = `${bunfig}\n[[lint.overrides]]\nfiles = "sub/**"\nrules = { "no-console" = "warn" }\n`;
      expect(await problems({ ...files, "bunfig.toml": later })).toEqual([
        "scripts/vendor/e.js no-console error",
        "sub/b.test.js no-console warn",
        "sub/c.js no-console warn",
      ]);
    });

    test("patterns use Bun.Glob syntax, including extglobs and brace ranges", async () => {
      const names = ["a/x.js", "ab/x.js", "c/x.js", "f1.js", "f3.js", "f4.js"];
      const files = { ...configs[name], ...Object.fromEntries(names.map(it => [it, log])) };
      const override = (patterns: string) =>
        `[lint.rules]\n"no-console" = "error"\n[[lint.overrides]]\n${patterns}\nrules = { "no-console" = "off" }\n`;
      const globs = `["+(a|b)/**", "f{1..3}.js"]`;
      const reported = async (patterns: string) =>
        (await problems({ ...files, "bunfig.toml": override(patterns) })).map(it => it.split(" ")[0]);
      expect(await reported(`files = ${globs}`)).toEqual(["c/x.js", "f4.js"]);
      expect(await reported(`files = "**/*.js"\nexcludeFiles = ${globs}`)).toEqual([
        "a/x.js",
        "ab/x.js",
        "f1.js",
        "f3.js",
      ]);
    });

    test("a leading ! negates a pattern, with or without a slash", async () => {
      const [a, aTest, b, bTest] = ["a.js", "a.test.js", "src/b.js", "src/b.test.js"];
      const files = { ...configs[name], ...Object.fromEntries([a, aTest, b, bTest].map(it => [it, log])) };
      // The patterns, and the files that still get reported because the override doesn't apply to them.
      const rows: Record<string, string[]> = {
        'files = ["*.test.js"]': [a, b],
        'files = ["!**/*.test.js"]': [aTest, bTest],
        'files = ["!*.test.js"]': [aTest, bTest],
        'files = ["!!*.test.js"]': [a, b],
        'files = ["!./a.js"]': [a],
        'files = ["!src/"]': [],
        'files = ["!src/**"]': [b, bTest],
        // `!(` starts an extglob group. It isn't a negation.
        'files = ["!(a|b).js"]': [a, b],
        'files = ["!!(a|b).js"]': [aTest, bTest],
        'files = ["**/*.js"]\nexcludeFiles = ["!*.test.js"]': [a, b],
        'files = ["**/*.js"]\nexcludeFiles = ["!**/*.test.js"]': [a, b],
        'files = ["**/*.js"]\nexcludeFiles = ["!(a|b).js"]': [aTest, bTest],
      };
      const reported = async (patterns: string) => {
        const bunfig = `[lint.rules]\n"no-console" = "error"\n[[lint.overrides]]\n${patterns}\nrules = { "no-console" = "off" }\n`;
        return (await problems({ ...files, "bunfig.toml": bunfig })).map(it => it.split(" ")[0]);
      };
      const results = await Promise.all(Object.keys(rows).map(reported));
      expect(Object.fromEntries(Object.keys(rows).map((patterns, at) => [patterns, results[at]]))).toEqual(rows);
    });

    test("an override can set globals, and --global wins over it", async () => {
      const files = {
        ...configs[name],
        "a.js": "mine;\n",
        "a.test.js": "mine;\n",
        "bunfig.toml": `
[lint.rules]
"no-undef" = "error"
[lint.globals]
mine = "readonly"
[[lint.overrides]]
files = "*.test.js"
globals = { mine = "off" }
`,
      };
      expect(await problems(files, ["a.js", "a.test.js"])).toEqual(["a.test.js no-undef error"]);
      expect(await problems(files, ["--global", "mine", "a.js", "a.test.js"])).toEqual([]);
    });
  });

  // oxlint has no extglobs or brace ranges. It reads `{1..3}` as a group with one alternative, `1..3`.
  // Checked against oxlint 1.87.
  test("overrides in an .oxlintrc.json keep oxlint's glob syntax", async () => {
    const overrides = [{ files: ["f{1..3}.js", "@(a|b)/**"], rules: { "no-console": "off" } }];
    const files = {
      ".oxlintrc.json": JSON.stringify({ ...JSON.parse(oxlintrc), rules: { "no-console": "error" }, overrides }),
      "f1.js": log,
      "f1..3.js": log,
      "a/x.js": log,
    };
    expect(await problems(files)).toEqual(["a/x.js no-console error", "f1.js no-console error"]);
  });

  // oxlint puts `**/` in front of a pattern without a slash, even in front of a `!`, which then is a literal. Checked against
  // oxlint 1.87.
  test("a negated pattern without a slash in an .oxlintrc.json matches nothing, like in oxlint", async () => {
    const config = (override: object) =>
      JSON.stringify({
        ...JSON.parse(oxlintrc),
        rules: { "no-console": "error" },
        overrides: [{ ...override, rules: { "no-console": "off" } }],
      });
    const files = { "a.js": log, "a.test.js": log };
    const reported = async (override: object) =>
      (await problems({ ...files, ".oxlintrc.json": config(override) })).map(it => it.split(" ")[0]);
    expect(await reported({ files: ["!*.test.js"] })).toEqual(["a.js", "a.test.js"]);
    expect(await reported({ files: ["!**/*.test.js"] })).toEqual(["a.test.js"]);
    expect(await reported({ files: ["**/*.js"], excludeFiles: ["!*.test.js"] })).toEqual([]);
  });

  test("patterns are relative to bunfig.toml's directory, wherever the config file is", async () => {
    const files = { ...tree, "bunfig.toml": bunfig, "config/mine.json": oxlintrc, "config/mine.js": flat };
    expect(await problems(files, ["--config", "config/mine.json"])).toEqual(left);
    expect(await problems(files, ["--config", "config/mine.js"])).toEqual(left);
    const nested = { ...tree, "bunfig.toml": bunfig, ".oxlintrc.json": "{}", "scripts/.oxlintrc.json": oxlintrc };
    expect(await problems(nested)).toEqual(left);
    // That's the bunfig.toml in the working directory.
    const below = { ...tree, "bunfig.toml": "", "scripts/bunfig.toml": bunfig.replaceAll("scripts/", "") };
    expect(await problems(below, ["--cwd", "scripts"])).toEqual(["scripts/vendor/e.js no-console error"]);
  });

  test("a severity on its own keeps the options from [lint.rules]", async () => {
    const files = {
      "a.js": "export const f = a => [a == null, a == 1];\n",
      "bunfig.toml": `[lint.rules]\neqeqeq = ["error", "smart"]\n[[lint.overrides]]\nfiles = "*.js"\nrules = { eqeqeq = "warn" }\n`,
    };
    expect(await problems(files)).toEqual(["a.js eqeqeq warn"]);
  });

  test("a core rule set for *.test.ts runs as its typescript-eslint version in every directory", async () => {
    const files = {
      "a.test.ts": "const unused = 1;\nexport {};\n",
      "sub/b.test.ts": "const unused = 1;\nexport {};\n",
      "bunfig.toml": `[[lint.overrides]]\nfiles = "*.test.ts"\nrules = { "no-unused-vars" = "error" }\n`,
    };
    expect(await problems(files)).toEqual([
      "a.test.ts @typescript-eslint/no-unused-vars error",
      "sub/b.test.ts @typescript-eslint/no-unused-vars error",
    ]);
  });

  test("an override can set settings", async () => {
    const files = {
      "a.jsx": "export default <Picture />;\n",
      "legacy/b.jsx": "export default <Picture />;\n",
      "bunfig.toml": `
[lint.rules]
"jsx-a11y/alt-text" = "error"
[lint.globals]
Picture = "readonly"
[[lint.overrides]]
files = "legacy/**"
settings = { "jsx-a11y" = { components = { Picture = "img" } } }
`,
    };
    expect(await problems(files)).toEqual(["legacy/b.jsx jsx-a11y/alt-text error"]);
  });

  test("an override's tables can be written as [lint.overrides.*] sections", async () => {
    const files = {
      ...tree,
      "bunfig.toml": `
[lint.rules]
"no-console" = "error"
[[lint.overrides]]
files = "*.test.js"
[lint.overrides.rules]
"no-console" = "off"
[[lint.overrides]]
files = "scripts/*"
[lint.overrides.rules]
"no-console" = "warn"
`,
    };
    expect(await problems(files)).toEqual([
      "scripts/d.js no-console warn",
      "scripts/vendor/e.js no-console error",
      "sub/c.js no-console error",
    ]);
  });

  const inOverride = (lines: string) => `[[lint.overrides]]\nfiles = "*.js"\n${lines}`;
  test.each([
    ["[lint]\noverrides = true", "expected array but received boolean", "2:13"],
    [
      `[lint.overrides]\nfiles = "*.js"`,
      `"overrides" is an array of tables\n  Write [[lint.overrides]], with two brackets`,
      "1:7",
    ],
    ["[lint]\noverrides = [1]", "expected object but received number", "2:14"],
    [`[[lint.overrides]]\nrules = { "no-var" = "error" }`, `an override needs "files"`, "1:8"],
    ["[[lint.overrides]]\nfiles = []", `an override needs "files"`, "1:8"],
    ["[[lint.overrides]]\nfiles = 1", "expected string or array but received number", "2:9"],
    [`[[lint.overrides]]\nfiles = ["a", 1]`, "expected string but received number", "2:15"],
    [`[[lint.overrides]]\nfiles = "{a"`, "Invalid glob pattern `{a`: unclosed brace expansion", "2:9"],
    [`[[lint.overrides]]\nfiles = "a"\nexcludeFiles = "a["`, "Invalid glob pattern `a[`", "3:16"],
    [`[[lint.overrides]]\nfile = "a"`, `Unknown key "file" in [lint.overrides]\n  Did you mean "files"?`, "2:1"],
    [
      inOverride(`excludedFiles = "b"`),
      `Unknown key "excludedFiles" in [lint.overrides]\n  Did you mean "excludeFiles"?`,
      "3:1",
    ],
    [inOverride("options = {}"), `Unknown key "options" in [lint.overrides]\n    at`, "3:1"],
    [inOverride("rules = 1"), "expected object but received number", "3:9"],
    [inOverride(`rules = { "no-vra" = "error" }`), `Unknown rule "no-vra"\n  Did you mean "no-var"?`, "3:11"],
    [
      inOverride(`[lint.overrides.rules]\n"no-var" = "always"`),
      `"always" is not a valid severity for no-var\n  Expected "off", "warn", or "error"`,
      "4:12",
    ],
    [
      inOverride(`[lint.overrides.rules]\neqeqeq = ["error", "sometimes"]`),
      `"sometimes" is not a valid option for eqeqeq\n  Expected "always", "smart", or "allow-null"`,
      "4:20",
    ],
    [
      inOverride(`globals = { a = "yes" }`),
      `"yes" is not a valid value for the global a\n  Expected "readonly", "writable", or "off"`,
      "3:17",
    ],
    [inOverride("settings = 1"), "expected object but received number", "3:12"],
  ])("%s is rejected", async (bunfig, message, place) => {
    const { stdout, stderr, exitCode } = await lint({ "a.js": log, "bunfig.toml": `${bunfig}\n` }, []);
    expect(stderr).toContain(`error: ${message}`);
    expect(stderr).toEndWith(`\n    at bunfig.toml:${place}`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
  });

  test.each(["eslint.config.js", ".eslintrc.json"])(
    "with %s, an invalid rule option in an override is reported as an error in bunfig.toml",
    async name => {
      const bunfig = inOverride(`rules = { eqeqeq = ["error", "sometimes"] }\n`);
      const { stderr, exitCode } = await lint({ ...configs[name], "a.js": log, "bunfig.toml": bunfig }, []);
      expect(stderr).toContain("Invalid config in bunfig.toml\n");
      expect(exitCode).toBe(2);
    },
  );
});

// Which rules are on and whether type information is available are decided separately.
describe.concurrent("type information without a config file", () => {
  const files = {
    "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
    "a.ts": "async function f() {}\nf();\nexport const a: string = 1;\n",
  };
  const floating = `[lint.rules]\n"@typescript-eslint/no-floating-promises" = "error"\n`;
  const run = async (bunfig: string, args: string[] = []) => {
    const result = await lint({ ...files, "bunfig.toml": bunfig }, ["-f", "json-with-metadata", ...args]);
    return [result.problems, result.stderr.includes("Skipped 1 rule that needs type information")];
  };

  test("turning on a rule that needs types is enough to run it", async () => {
    const reported = ["a.ts @typescript-eslint/no-floating-promises error"];
    expect(await run("")).toEqual([[], false]);
    expect(await run(floating)).toEqual([reported, false]);
    expect(await run("", ["--rule", "@typescript-eslint/no-floating-promises: error"])).toEqual([reported, false]);
    const inOverride = floating.replace("[lint.rules]", `[[lint.overrides]]\nfiles = "*.ts"\n[lint.overrides.rules]`);
    expect(await run(inOverride)).toEqual([reported, false]);
  });

  // `consistent-type-imports` only reads tsconfig.json when type information is on.
  test("a rule that can use types but doesn't need them doesn't turn type information on", async () => {
    const files = {
      "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true } }`,
      "database.ts": "export class Database {}\n",
      "a.ts": `import { Database } from "./database";\n@Injectable()\nexport class Users {\n  constructor(private database: Database) {}\n}\n`,
    };
    const uses = `[lint.rules]\n"@typescript-eslint/consistent-type-imports" = "error"\n`;
    const args = ["-f", "json-with-metadata", "a.ts"];
    const reported = "a.ts @typescript-eslint/consistent-type-imports error";
    expect((await lint({ ...files, "bunfig.toml": uses }, args)).problems).toEqual([]);
    expect((await lint({ ...files, "bunfig.toml": uses }, ["--type-aware", ...args])).problems).toContain(reported);
  });

  test("typeAware = false and --no-type-aware skip rules that need types", async () => {
    expect(await run(`[lint]\ntypeAware = false\n${floating}`)).toEqual([[], true]);
    expect(await run(floating, ["--no-type-aware"])).toEqual([[], true]);
  });

  test("typeCheck and --type-check report type errors without turning any rule on", async () => {
    const reported = ["a.ts typescript/TS2322 error"];
    expect(await run("[lint]\ntypeCheck = true\n")).toEqual([reported, false]);
    expect(await run("", ["--type-check"])).toEqual([reported, false]);
  });
});

// `plugins` loads ESLint plugins. It's the key for `--plugin`.
describe.concurrent("plugins in [lint]", () => {
  const local = `
const noTodo = {
  meta: { messages: { todo: "No TODO." }, schema: [] },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments())
          if (comment.value.includes("TODO")) context.report({ loc: comment.loc, messageId: "todo" });
      },
    };
  },
};
export default { meta: { name: "local" }, rules: { "no-todo": noTodo } };
`;
  const packaged = (name: string, meta = name) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
    [`node_modules/${name}/index.js`]: `
module.exports = {
  meta: { name: ${JSON.stringify(meta)} },
  rules: {
    "no-foo": {
      meta: { schema: [{ type: "object", properties: { name: { type: "string" } }, additionalProperties: false }] },
      create(context) {
        const name = context.options[0]?.name ?? "foo";
        return { VariableDeclarator(node) { if (node.id.name === name) context.report({ node: node.id, message: "No " + name + "." }); } };
      },
    },
  },
};
`,
  });
  const project = {
    "package.json": "{}",
    "lint/plugin.js": local,
    ...packaged("eslint-plugin-demo"),
    "src/a.js": "// TODO: later\nexport const foo = 1;\ndebugger;\n",
  };
  const bunfig = (plugins: string, rules: Record<string, unknown>) => ({
    "bunfig.toml": `[lint]\nplugins = ${plugins}\n\n[lint.rules]\n${Object.entries(rules)
      .map(([id, setting]) => `${JSON.stringify(id)} = ${JSON.stringify(setting).replaceAll('":', '" =')}`)
      .join("\n")}\n`,
  });
  /** `line:column rule`, in the order of the report. oxlint writes `plugin(rule)`. */
  async function found(files: Record<string, string>, args: string[] = []) {
    const { stdout, stderr, exitCode } = await lint(files, ["-f", "unix", ...args, "src"]);
    const lines = [...stdout.matchAll(/:(\d+:\d+): .* \[\w+\/(.+)\]$/gm)].map(it => `${it[1]} ${it[2]}`);
    return {
      found: lines.sort(),
      stderr: stderr.replace(/^(Linted \d+ files?|✓ No problems in \d+ files?).*$/m, "").trim(),
      exitCode,
    };
  }
  const both = bunfig(`["./lint/plugin.js", "eslint-plugin-demo"]`, {
    "local/no-todo": "warn",
    "demo/no-foo": "error",
  });

  test("they add to Bun's defaults", async () => {
    expect(await found({ ...project, ...both })).toEqual({
      found: ["1:1 local/no-todo", "2:14 demo/no-foo", "3:1 no-debugger"],
      stderr: "",
      exitCode: 1,
    });
  });

  test("they add to an ESLint config and to an oxlint config", async () => {
    const [eslint, oxlint] = await Promise.all([
      found({ ...project, ...both, "eslint.config.js": `export default [{ rules: { "no-debugger": "warn" } }];\n` }),
      found({ ...project, ...both, ".oxlintrc.json": `{ "rules": { "no-debugger": "warn" } }` }),
    ]);
    expect(eslint).toEqual({
      found: ["1:1 local/no-todo", "2:14 demo/no-foo", "3:1 no-debugger"],
      stderr: "",
      exitCode: 1,
    });
    expect(oxlint).toEqual({
      found: ["1:1 local(no-todo)", "2:14 demo(no-foo)", "3:1 eslint(no-debugger)"],
      stderr: "",
      exitCode: 1,
    });
  });

  test.each([
    ["the name of the package", `["eslint-plugin-demo"]`, "demo/no-foo"],
    ["ESLint's short name", `["demo"]`, "demo/no-foo"],
    ["another prefix", `[{ name = "mine", specifier = "eslint-plugin-demo" }]`, "mine/no-foo"],
    [
      "another prefix for a path",
      `[{ name = "mine", specifier = "./node_modules/eslint-plugin-demo/index.js" }]`,
      "mine/no-foo",
    ],
  ])("%s", async (_, plugins, rule) => {
    expect(await found({ ...project, ...bunfig(plugins, { [rule]: "error" }) })).toEqual({
      found: [`2:14 ${rule}`, "3:1 no-debugger"],
      stderr: "",
      exitCode: 1,
    });
  });

  test("a scoped package by its short name", async () => {
    const files = {
      ...project,
      ...packaged("@acme/eslint-plugin", "@acme"),
      ...packaged("@acme/eslint-plugin-more", "@acme/more"),
    };
    const rules = { "@acme/no-foo": "error", "@acme/more/no-foo": "warn" };
    expect((await found({ ...files, ...bunfig(`["@acme", "@acme/more"]`, rules) })).found).toEqual([
      "2:14 @acme/more/no-foo",
      "2:14 @acme/no-foo",
      "3:1 no-debugger",
    ]);
  });

  test("a plugin that Bun only knows the name of, and one whose rules are otherwise left to bun fmt", async () => {
    const files = {
      ...project,
      ...packaged("eslint-plugin-jsdoc", "jsdoc"),
      ...packaged("@stylistic/eslint-plugin", "@stylistic"),
    };
    const rules = { "jsdoc/no-foo": "error", "@stylistic/no-foo": "warn" };
    expect(await found({ ...files, ...bunfig(`["jsdoc", "@stylistic"]`, rules) })).toEqual({
      found: ["2:14 @stylistic/no-foo", "2:14 jsdoc/no-foo", "3:1 no-debugger"],
      stderr: "",
      exitCode: 1,
    });
  });

  test("options go to the rule", async () => {
    const files = { ...project, "src/a.js": "export const foo = 1, bar = 2;\n" };
    const rules = { "demo/no-foo": ["error", { name: "bar" }] };
    expect((await found({ ...files, ...bunfig(`["demo"]`, rules) })).found).toEqual(["1:23 demo/no-foo"]);
  });

  test("--plugin does the same, from the working directory", async () => {
    const flags = [
      "--plugin",
      "./lint/plugin.js",
      "--plugin",
      "demo",
      "--rule",
      "local/no-todo: warn",
      "--rule",
      "demo/no-foo: error",
    ];
    expect(await found(project, flags)).toEqual({
      found: ["1:1 local/no-todo", "2:14 demo/no-foo", "3:1 no-debugger"],
      stderr: "",
      exitCode: 1,
    });
  });

  test("--plugin loads a package next to an eslint.config.js, as in ESLint", async () => {
    const files = { ...project, "eslint.config.js": `export default [{ rules: { "no-debugger": "warn" } }];\n` };
    expect(await found(files, ["--plugin", "demo", "--rule", "demo/no-foo: error"])).toEqual({
      found: ["2:14 demo/no-foo", "3:1 no-debugger"],
      stderr: "",
      exitCode: 1,
    });
  });

  test("[[lint.overrides]] can turn their rules on", async () => {
    const files = {
      ...project,
      "src/b.test.js": "// TODO: later\n",
      "bunfig.toml": `[lint]\nplugins = ["./lint/plugin.js"]\n\n[[lint.overrides]]\nfiles = ["*.test.js"]\nrules = { "local/no-todo" = "error" }\n`,
    };
    const { stdout } = await lint(files, ["-f", "unix", "src"]);
    expect(
      [...stdout.matchAll(/(\w+(?:\.\w+)+):\d+:\d+: .*\/(.+)\]$/gm)].map(it => `${it[1]} ${it[2]}`).sort(),
    ).toEqual(["a.js no-debugger", "b.test.js no-todo"]);
  });

  test.each([
    ["eslint-disable", "/* eslint-disable local/no-todo */\n// TODO: a\n", []],
    [
      "eslint-disable-next-line",
      "// TODO: a\n// eslint-disable-next-line local/no-todo\n// TODO: b\n",
      ["1:1 local/no-todo"],
    ],
    ["turned off", "/* eslint local/no-todo: off */\n// TODO: a\n", []],
    [
      "options",
      `/* eslint demo/no-foo: [error, { name: "bar" }] */\nexport const foo = 1, bar = 2;\n`,
      ["2:23 demo/no-foo"],
    ],
  ])("a comment names their rules: %s", async (_, code, expected) => {
    expect(await found({ ...project, ...both, "src/a.js": code })).toEqual({
      found: expected,
      stderr: "",
      exitCode: expected.some(it => it.includes("demo")) ? 1 : 0,
    });
  });

  test("a disable comment for a rule of theirs that reports nothing is unused", async () => {
    const files = { ...project, ...both, "src/a.js": "// eslint-disable-next-line local/no-todo\nexport {};\n" };
    const { stdout } = await lint(files, ["-f", "unix", "--report-unused-disable-directives", "src"]);
    expect(stdout).toContain("Unused eslint-disable directive (no problems were reported from 'local/no-todo')");
  });

  test("--doctor counts their rules", async () => {
    const { stdout } = await lint({ ...project, ...both }, ["--doctor", "src"]);
    expect(stdout).toContain("2 rules run in JavaScript");
  });

  // Each mistake points at the entry in bunfig.toml.
  test.each([
    [`plugins = ["./lint/plugn.js"]`, `Cannot load the plugin "./lint/plugn.js"\n  Cannot find module`, "2:12"],
    [
      `plugins = ["nope"]`,
      `Cannot load the plugin "nope"\n  Neither eslint-plugin-nope nor nope is installed\n`,
      "2:12",
    ],
    [`plugins = ["eslint-plugin-nope"]`, `Cannot load the plugin "eslint-plugin-nope"\n  Cannot find module`, "2:12"],
    // The package is there and fails. That is what's said, not that there's no package "boom".
    [`plugins = ["boom"]`, `Cannot load the plugin "boom"\n  Error: inside the plugin`, "2:12"],
    [
      `plugins = ["vue"]`,
      `Cannot load the plugin "vue"\n  eslint-plugin-vue is not installed, and the package vue is not an ESLint plugin\n`,
      "2:12",
    ],
    [`plugins = [""]`, "A plugin needs a specifier\n  A path, or the name of a package\n", "2:12"],
    [`plugins = ["eslint-plugin-"]`, "A plugin needs a specifier\n", "2:12"],
    [`plugins = [{ name = "x", specifier = "" }]`, "A plugin needs a specifier\n", "2:12"],
    [
      `plugins = ["./lint/no-name.js"]`,
      `"" can't be the name of a plugin\n  Give it another: { name = "..", specifier = "./lint/no-name.js" }\n`,
      "2:12",
    ],
    [`plugins = [{ name = "a/b", specifier = "demo" }]`, `"a/b" can't be the name of a plugin\n`, "2:12"],
    // Columns are counted as everywhere, not in bytes.
    [`plugins = ["./lint/ünï✓.js", "nope"]`, `Cannot load the plugin "nope"`, "2:30"],
    // So is a package that the plugin needs: it isn't the plugin that is missing.
    [`plugins = ["needs"]`, `Cannot load the plugin "needs"\n  Cannot find module 'not-installed'`, "2:12"],
    [
      `plugins = ["./lint/plugin.js", "./lint/same-name.js"]`,
      `Two plugins are called "local"\n  Give this one another name: { name = "local-2", specifier = "./lint/same-name.js" }\n`,
      "2:32",
    ],
    [`plugins = ["./lint/throws.js"]`, `Cannot load the plugin "./lint/throws.js"\n  Error: boom`, "2:12"],
    // Nothing of how a plugin is read.
    [
      `plugins = ["./lint/null-rule.js"]`,
      `Cannot load the plugin "./lint/null-rule.js"\n  TypeError: The rule "r" must be an object: null\n    at bunfig.toml`,
      "2:12",
    ],
    // It is installed.
    [
      `plugins = ["eslint-plugin-no-main"]`,
      `Cannot load the plugin "eslint-plugin-no-main"\n  eslint-plugin-no-main is installed, but its entry point cannot be found\n`,
      "2:12",
    ],
    [
      `plugins = ["no-main"]`,
      `Cannot load the plugin "no-main"\n  eslint-plugin-no-main is installed, but its entry point cannot be found\n  Check "main" and "exports" in its package.json\n`,
      "2:12",
    ],
    [
      `plugins = ["./lint/nameless.js"]`,
      `Cannot load the plugin "./lint/nameless.js"\n  Error: Plugin must either define \`meta.name\``,
      "2:12",
    ],
    [
      `plugins = ["./lint/react.js"]`,
      `The plugin "react" is built in\n  Its rules work without it, so remove it from plugins\n  To run the package as well, give it another name: { name = "react-js", specifier = "./lint/react.js" }\n`,
      "2:12",
    ],
    [`plugins = [{ name = "react", specifier = "demo" }]`, `The plugin "react" is built in`, "2:12"],
    [`plugins = "demo"`, "expected array but received string", "2:11"],
    [`plugins = [1]`, "expected string but received number", "2:12"],
    [
      `plugins = [{ nme = "a", specifier = "demo" }]`,
      `Unknown key "nme" in [lint.plugins]\n  Did you mean "name"?`,
      "2:14",
    ],
    [`plugins = [{ name = "a" }]`, "A plugin needs a specifier\n  A path, or the name of a package", "2:12"],
    [`plugins = [{ name = "", specifier = "demo" }]`, "A plugin's name can't be empty", "2:21"],
    [
      `plugins = ["demo"]\n[lint.rules]\n"demo/no-fo" = "error"`,
      `Unknown rule "demo/no-fo"\n  Did you mean "demo/no-foo"?`,
      "4:1",
    ],
    [
      `plugins = ["demo"]\n[lint.rules]\n"demo/other" = "error"`,
      `Unknown rule "demo/other"\n  The plugin "demo" has no rule by that name`,
      "4:1",
    ],
    [
      `plugins = ["demo"]\n[lint.rules]\n"demo/no-foo" = "loud"`,
      `"loud" is not a valid severity for demo/no-foo`,
      "4:17",
    ],
    [
      `plugins = ["demo"]\n[lint.rules]\n"demo/no-foo" = ["error", { nam = "x" }]`,
      `Invalid options for demo/no-foo\n  Value {"nam":"x"} should NOT have additional properties.\n    Unexpected property "nam". Expected properties: "name".\n`,
      "4:27",
    ],
  ])("%s is rejected", async (lines, message, at) => {
    const files = {
      ...project,
      "lint/throws.js": `throw new Error("boom");\n`,
      "lint/null-rule.js": `export default { meta: { name: "nulls" }, rules: { r: null } };\n`,
      "node_modules/eslint-plugin-no-main/package.json": `{ "name": "eslint-plugin-no-main", "main": "missing.js" }`,
      "lint/same-name.js": `export default { meta: { name: "local" }, rules: {} };\n`,
      "lint/no-name.js": `export default { meta: { name: "" }, rules: {} };\n`,
      "lint/ünï✓.js": `export default { meta: { name: "odd" }, rules: {} };\n`,
      "node_modules/vue/package.json": `{ "name": "vue", "main": "index.js" }`,
      "node_modules/vue/index.js": "module.exports = { createApp() {} };\n",
      "node_modules/eslint-plugin-boom/package.json": `{ "name": "eslint-plugin-boom", "main": "index.js" }`,
      "node_modules/eslint-plugin-boom/index.js": `throw new Error("inside the plugin");\n`,
      "node_modules/eslint-plugin-needs/package.json": `{ "name": "eslint-plugin-needs", "main": "index.js" }`,
      "node_modules/eslint-plugin-needs/index.js": `require("not-installed");\n`,
      "lint/nameless.js": `export default { rules: {} };\n`,
      "lint/react.js": `export default { meta: { name: "eslint-plugin-react" }, rules: {} };\n`,
      "bunfig.toml": `[lint]\n${lines}\n`,
    };
    const { stdout, stderr, exitCode } = await lint(files, ["src"]);
    expect(stderr).toContain(`error: ${message}`);
    expect(stderr).toEndWith(`\n    at bunfig.toml:${at}`);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
  });

  test("an AggregateError is printed with what it is made of", async () => {
    const files = {
      ...project,
      "lint/several.js": `throw new AggregateError([new Error("one"), new Error("two")], "several");\n`,
      "bunfig.toml": `[lint]\nplugins = ["./lint/several.js"]\n`,
    };
    const { stderr, exitCode } = await lint(files, ["src"]);
    expect(stderr).toContain(`error: Cannot load the plugin "./lint/several.js"\n  AggregateError: several\n`);
    expect(stderr).toEndWith(`\n  Error: one\n  Error: two\n    at bunfig.toml:2:12`);
    expect(exitCode).toBe(2);
  });

  test("the name of a built-in plugin does nothing without a config file, and turns it on for one further down", async () => {
    const files = {
      ...project,
      ...bunfig(`["react", "eslint-plugin-import", "@typescript-eslint"]`, { "react/jsx-key": "error" }),
      "src/a.js": "export const a = [1].map(x => <b>{x}</b>);\n",
      "src/app/a.js": "export const a = [1].map(x => <b>{x}</b>);\n",
      "src/app/eslint.config.js": `export default [{ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }];\n`,
    };
    expect(await found(files)).toEqual({
      found: ["1:31 react/jsx-key", "1:31 react/jsx-key"],
      stderr: "",
      exitCode: 1,
    });
  });

  test.each(["eslint.config.js", ".eslintrc.json", ".oxlintrc.json"])(
    "a plugin whose rules are there with every config needs no package: %s",
    async name => {
      const config =
        name === "eslint.config.js"
          ? "export default [{}];\n"
          : `{ "root": true }`.replace(name === ".oxlintrc.json" ? `"root": true` : "\0", "");
      const files = { ...project, [name]: config, "src/a.js": "export const a = Array.from(b.split(',')).length;\n" };
      const { stderr } = await lint({ ...files, ...bunfig(`["bun"]`, {}) }, ["src"]);
      expect(stderr).not.toContain("error:");
    },
  );

  test("a short name is the ESLint plugin, not another package of that name", async () => {
    const files = {
      ...project,
      ...packaged("eslint-plugin-vue", "vue"),
      "node_modules/vue/package.json": `{ "name": "vue", "main": "index.js" }`,
      "node_modules/vue/index.js": "module.exports = { createApp() {} };\n",
    };
    expect(await found({ ...files, ...bunfig(`["vue"]`, { "vue/no-foo": "warn" }) })).toEqual({
      found: ["2:14 vue/no-foo", "3:1 no-debugger"],
      stderr: "",
      exitCode: 1,
    });
  });

  test("a package that isn't called eslint-plugin-*", async () => {
    const files = { ...project, ...packaged("acme-lint", "acme") };
    expect((await found({ ...files, ...bunfig(`["acme-lint"]`, { "acme/no-foo": "warn" }) })).found).toEqual([
      "2:14 acme/no-foo",
      "3:1 no-debugger",
    ]);
  });

  test("a package that can only be imported", async () => {
    const files = {
      ...project,
      "node_modules/eslint-plugin-esm/package.json": `{ "name": "eslint-plugin-esm", "type": "module", "exports": { ".": { "import": "./index.mjs" } } }`,
      "node_modules/eslint-plugin-esm/index.mjs": local.replace(`"local"`, `"esm"`),
    };
    const expected = { found: ["1:1 esm/no-todo", "3:1 no-debugger"], stderr: "", exitCode: 1 };
    expect(await found({ ...files, ...bunfig(`["esm"]`, { "esm/no-todo": "warn" }) })).toEqual(expected);
    const oxlint = {
      ".oxlintrc.json": `{ "jsPlugins": ["eslint-plugin-esm"], "rules": { "esm/no-todo": "warn", "no-debugger": "off" } }`,
    };
    expect(await found({ ...files, ...oxlint })).toEqual({ found: ["1:1 esm(no-todo)"], stderr: "", exitCode: 0 });
  });

  test.each([
    ["without the ending", `["./lint/plugin.js", "./lint/plugin"]`],
    ["the directory of a package", `["demo", "./node_modules/eslint-plugin-demo"]`],
    ["the file of a package", `["demo", "./node_modules/eslint-plugin-demo/index.js"]`],
    ["through a link", `["./lint/plugin.js", "./lint/link.js"]`],
  ])("one file is one plugin, however it is written: %s", async (_, plugins) => {
    using dir = tempDir("bun-lint", { ...project, ...bunfig(plugins, {}) });
    symlinkSync("plugin.js", join(String(dir), "lint/link.js"));
    await using proc = spawn({
      cmd: [bunExe(), "lint", "-f", "unix", "src"],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("[Error/no-debugger]");
    expect(exitCode).toBe(1);
  });

  test("--explain doesn't say to add a plugin", async () => {
    const { stderr, exitCode } = await lint({ ...project, ...both }, ["--explain", "demo/no-foo"]);
    expect(stderr).toBe(
      `error: Unknown rule "demo/no-foo"\n  --explain has the built-in rules. For a rule from a plugin, see the plugin's docs`,
    );
    expect(exitCode).toBe(2);
  });

  test("a path that starts with a dot and not with ./", async () => {
    const files = { ...project, ".config/lint.js": local };
    expect((await found({ ...files, ...bunfig(`[".config/lint.js"]`, { "local/no-todo": "warn" }) })).found).toEqual([
      "1:1 local/no-todo",
      "3:1 no-debugger",
    ]);
  });

  test("the same plugin in bunfig.toml and by --plugin counts once", async () => {
    const files = { ...project, ...bunfig(`["./lint/plugin.js"]`, { "local/no-todo": "warn" }) };
    expect(await found(files, ["--plugin", "./lint/plugin.js"])).toEqual({
      found: ["1:1 local/no-todo", "3:1 no-debugger"],
      stderr: "",
      exitCode: 1,
    });
  });

  describe("next to an eslint.config.js", () => {
    const config = { "eslint.config.js": `export default [{ rules: { "no-debugger": "warn" } }];\n` };

    test("a plugin that is only built in without a config file is loaded from its package", async () => {
      const files = { ...project, ...config, ...packaged("eslint-plugin-unicorn", "unicorn") };
      expect(await found({ ...files, ...bunfig(`["unicorn"]`, { "unicorn/no-foo": "error" }) })).toEqual({
        found: ["2:14 unicorn/no-foo", "3:1 no-debugger"],
        stderr: "",
        exitCode: 1,
      });
    });

    test.each([`["react"]`, `["eslint-plugin-react"]`])("a plugin that is built in there too: %s", async plugins => {
      const files = {
        ...project,
        "eslint.config.js": `export default [{ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }];\n`,
        "src/a.js": "export const a = [1].map(x => <b>{x}</b>);\n",
      };
      expect(await found({ ...files, ...bunfig(plugins, { "react/jsx-key": "error" }) })).toEqual({
        found: ["1:31 react/jsx-key"],
        stderr: "",
        exitCode: 1,
      });
    });

    test("--no-native-plugin-rules runs the package of a plugin that is named here, too", async () => {
      const files = {
        ...project,
        "eslint.config.js": `export default [{ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }];\n`,
        "src/a.js": "export const a = [1].map(x => <b>{x}</b>);\n",
        "node_modules/eslint-plugin-react/package.json": `{ "name": "eslint-plugin-react", "version": "7.37.5", "main": "index.js" }`,
        "node_modules/eslint-plugin-react/index.js": `
          module.exports = { rules: { "jsx-key": { create: context => ({ JSXElement(node) { context.report({ node, message: "of the package" }); } }) } } };\n`,
        ...bunfig(`["react"]`, { "react/jsx-key": "error" }),
      };
      const [native, ofPackage] = await Promise.all([
        lint(files, ["-f", "unix", "src"]),
        lint(files, ["-f", "unix", "--no-native-plugin-rules", "src"]),
      ]);
      expect(native.stdout).toContain(`Missing "key" prop for element in iterator [Error/react/jsx-key]`);
      expect(ofPackage.stdout).toContain("of the package [Error/react/jsx-key]");
    });

    test("a rule of a built-in plugin that only the package has runs from there", async () => {
      const files = { ...project, ...config, ...packaged("eslint-plugin-react", "react") };
      expect(await found({ ...files, ...bunfig(`["react"]`, { "react/no-foo": "error" }) })).toEqual({
        found: ["2:14 react/no-foo", "3:1 no-debugger"],
        stderr: "",
        exitCode: 1,
      });
    });

    test("prettier needs its package, as in ESLint", async () => {
      const files = { ...project, ...config, ...bunfig(`["prettier"]`, { "prettier/prettier": "error" }) };
      const { stdout, stderr, exitCode } = await lint(files, ["src"]);
      expect(stderr).toContain(
        `error: Cannot load the plugin "prettier"\n  eslint-plugin-prettier is not installed\n  Without Prettier, turn on bun/format instead of prettier/prettier\n    at bunfig.toml:2:12`,
      );
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    });

    test("--plugin calls a plugin what the flag calls it, as ESLint does", async () => {
      const files = { ...project, ...config, ...packaged("@vt/eslint-plugin", "vt") };
      expect(await found(files, ["--plugin", "@vt", "--rule", "@vt/no-foo: error"])).toEqual({
        found: ["2:14 @vt/no-foo", "3:1 no-debugger"],
        stderr: "",
        exitCode: 1,
      });
    });

    test("a plugin without rules that the file has under the same name is an error too", async () => {
      const files = {
        ...project,
        "eslint.config.js": `const demo = { processors: {} };\nexport default [{ plugins: { demo } }];\n`,
      };
      const { stdout, stderr, exitCode } = await lint(files, ["--plugin", "demo", "src"]);
      expect(stderr).toContain(`The plugin "demo" is loaded twice: here, and by plugins in bunfig.toml or --plugin`);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    });

    test.each([
      [`"demo/no-fo" = "error"`, `Unknown rule "demo/no-fo"\n  Did you mean "demo/no-foo"?`, "4:1"],
      [`"demo/no-foo" = ["error", { nam = "x" }]`, "Invalid options for demo/no-foo\n", "4:27"],
    ])("a mistake in a rule of theirs is a mistake in bunfig.toml: %s", async (rule, message, at) => {
      const bunfig = { "bunfig.toml": `[lint]\nplugins = ["demo"]\n[lint.rules]\n${rule}\n` };
      for (const file of [config, { ".oxlintrc.json": "{}" }]) {
        const { stdout, stderr, exitCode } = await lint({ ...project, ...file, ...bunfig }, ["src"]);
        expect(stderr).toContain(`error: ${message}`);
        expect(stderr).toEndWith(`\n    at bunfig.toml:${at}`);
        expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
      }
    });

    test("a rule that is off isn't looked at, as in ESLint: it needn't exist", async () => {
      const files = {
        ...project,
        "eslint.config.js": `
          import demo from "eslint-plugin-demo";
          export default [{ plugins: { demo }, rules: { "demo/removed": "off", "demo/no-foo": "warn" } }];\n`,
      };
      const expected = { found: ["2:14 demo/no-foo"], stderr: "", exitCode: 0 };
      expect(await found({ ...files, ...bunfig(`["demo"]`, { "demo/gone": "off" }) })).toEqual(expected);
      expect(await found(files, ["--plugin", "demo", "--rule", "demo/nope: off"])).toEqual(expected);
    });

    test.each([
      ["only configs", `{ meta: { name: "cfg" }, configs: { all: { rules: { "no-debugger": "warn" } } } }`],
      ["only processors", `{ meta: { name: "cfg" }, processors: {} }`],
      ["no rules", `{ meta: { name: "cfg" }, rules: {} }`],
    ])("a plugin without rules that the file imports too is one plugin: %s", async (_, plugin) => {
      const files = {
        ...project,
        "node_modules/eslint-plugin-cfg/package.json": `{ "name": "eslint-plugin-cfg", "main": "index.js" }`,
        "node_modules/eslint-plugin-cfg/index.js": `module.exports = ${plugin};\n`,
        "eslint.config.js": `import cfg from "eslint-plugin-cfg";\nexport default [{ plugins: { cfg }, rules: { "no-debugger": "warn" } }];\n`,
      };
      const expected = { found: ["3:1 no-debugger"], stderr: "", exitCode: 0 };
      expect(await found(files, ["--plugin", "cfg"])).toEqual(expected);
      expect(await found({ ...files, ...bunfig(`["cfg"]`, {}) })).toEqual(expected);
    });

    test("--print-config calls them what ESLint calls them", async () => {
      const files = {
        ...project,
        ...config,
        "node_modules/eslint-plugin-demo/index.js": project["node_modules/eslint-plugin-demo/index.js"].replace(
          `name: "eslint-plugin-demo"`,
          `name: "eslint-plugin-demo", version: "1.2.3"`,
        ),
      };
      const { stdout } = await lint({ ...files, ...bunfig(`["demo", "./lint/plugin.js"]`, {}) }, [
        "--print-config",
        "src/a.js",
      ]);
      expect(JSON.parse(stdout).plugins).toEqual(
        expect.arrayContaining(["demo:eslint-plugin-demo@1.2.3", "local:local"]),
      );
    });

    test("the package of a built-in plugin isn't loaded if no rule is asked of it", async () => {
      const files = {
        ...project,
        "eslint.config.js": `export default [{ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }];\n`,
        "src/a.js": "export const a = [1].map(x => <b>{x}</b>);\n",
        "node_modules/eslint-plugin-react/package.json": `{ "name": "eslint-plugin-react", "version": "7.37.5", "main": "index.js" }`,
        "node_modules/eslint-plugin-react/index.js": `throw new Error("it was loaded");\n`,
      };
      expect(await found({ ...files, ...bunfig(`["react"]`, { "react/jsx-key": "error" }) })).toEqual({
        found: ["1:31 react/jsx-key"],
        stderr: "",
        exitCode: 1,
      });
    });

    test.each(["eslint-plugin-demo/index.js", "./node_modules/eslint-plugin-demo/index.js"])(
      "--plugin with what is no name has the name of the plugin: %s",
      async plugin => {
        expect(await found({ ...project, ...config }, ["--plugin", plugin, "--rule", "demo/no-foo: error"])).toEqual({
          found: ["2:14 demo/no-foo", "3:1 no-debugger"],
          stderr: "",
          exitCode: 1,
        });
      },
    );

    test("another plugin can't take the name of one that is built in there", async () => {
      const plugins = `[{ name = "react", specifier = "demo" }]`;
      const { stdout, stderr, exitCode } = await lint({ ...project, ...config, ...bunfig(plugins, {}) }, ["src"]);
      expect(stderr).toContain(`error: The plugin "react" needs another name\n`);
      expect(stderr).toEndWith("\n    at bunfig.toml:2:12");
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    });

    test("a plugin that the file has under the same name is an error, as two are in ESLint", async () => {
      const files = {
        ...project,
        "eslint.config.js": `
          const demo = { rules: { "no-foo": { create: context => ({ Program(node) { context.report({ node, message: "of the file" }); } }) } } };
          export default [{ plugins: { demo }, rules: { "demo/no-foo": "error" } }];\n`,
      };
      const { stdout, stderr, exitCode } = await lint({ ...files, ...bunfig(`["demo"]`, {}) }, ["src"]);
      expect(stderr).toContain(`The plugin "demo" is loaded twice: here, and by plugins in bunfig.toml or --plugin`);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    });

    test.each<[string, Record<string, string>, string[]]>([
      ["plugins", bunfig(`["demo"]`, {}), []],
      ["--plugin", {}, ["--plugin", "demo"]],
    ])("the package that the file imports too is one plugin, as in ESLint: %s", async (_, config, flags) => {
      const files = {
        ...project,
        "eslint.config.js": `
          import demo from "eslint-plugin-demo";
          export default [{ plugins: { demo }, rules: { "demo/no-foo": "error" } }];\n`,
      };
      expect(await found({ ...files, ...config }, flags)).toEqual({
        found: ["2:14 demo/no-foo"],
        stderr: "",
        exitCode: 1,
      });
    });

    test("so is a package whose main module has what another module of it exports", async () => {
      const files = {
        ...project,
        "node_modules/eslint-plugin-demo/dist/a.js": project["node_modules/eslint-plugin-demo/index.js"],
        "node_modules/eslint-plugin-demo/index.js": `module.exports = require("./dist/a.js");\n`,
        "eslint.config.js": `
          import demo from "eslint-plugin-demo";
          export default [{ plugins: { demo }, rules: { "demo/no-foo": "error" } }];\n`,
      };
      const expected = { found: ["2:14 demo/no-foo"], stderr: "", exitCode: 1 };
      expect(await found({ ...files, ...bunfig(`["demo"]`, {}) })).toEqual(expected);
      expect(await found(files, ["--plugin", "demo"])).toEqual(expected);
    });

    test.each([
      ["an ES module", `export { default } from "./impl.js";\n`, local],
      ["an ES module that imports it first", `import it from "./impl.js";\nexport default it;\n`, local],
    ])("so is a file of the project that has what another exports: %s", async (_, entry, impl) => {
      const files = {
        ...project,
        "lint/plugin.js": entry,
        "lint/impl.js": impl,
        "eslint.config.js": `
          import local from "./lint/plugin.js";
          export default [{ plugins: { local }, rules: { "local/no-todo": "warn" } }];\n`,
      };
      const expected = { found: ["1:1 local/no-todo"], stderr: "", exitCode: 0 };
      expect(await found({ ...files, ...bunfig(`["./lint/plugin.js"]`, {}) })).toEqual(expected);
      expect(await found(files, ["--plugin", "./lint/plugin.js"])).toEqual(expected);
    });

    test("so is a package of the workspace that is linked into node_modules", async () => {
      using dir = tempDir("bun-lint", {
        ...project,
        "packages/eslint-plugin-ws/package.json": `{ "name": "eslint-plugin-ws", "main": "index.js" }`,
        "packages/eslint-plugin-ws/index.js": `module.exports = require("./dist/plugin.js");\n`,
        "packages/eslint-plugin-ws/dist/plugin.js": project["node_modules/eslint-plugin-demo/index.js"].replace(
          "eslint-plugin-demo",
          "eslint-plugin-ws",
        ),
        "eslint.config.js": `
          import ws from "eslint-plugin-ws";
          export default [{ plugins: { ws }, rules: { "ws/no-foo": "error" } }];\n`,
        ...bunfig(`["ws"]`, {}),
      });
      symlinkSync(
        join(String(dir), "packages/eslint-plugin-ws"),
        join(String(dir), "node_modules/eslint-plugin-ws"),
        "junction",
      );
      await using proc = spawn({
        cmd: [bunExe(), "lint", "-f", "unix", "src"],
        env,
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain(":2:14: No foo. [Error/ws/no-foo]");
      expect(exitCode).toBe(1);
    });

    test.each([
      ["a name and a version", `meta: { name: "eslint-plugin-dual", version: "1.2.3" }, `],
      ["a name", `meta: { name: "eslint-plugin-dual" }, `],
      ["neither", ""],
    ])("the build to import and the build to require of one package are one plugin: with %s", async (_, meta) => {
      const build = (how: string, said: string) =>
        `${how} { ${meta}rules: { r: { create: context => ({
          Program(node) { context.report({ node, message: "${said}" }); } }) } } };\n`;
      const files = {
        ...project,
        "node_modules/eslint-plugin-dual/package.json": `{ "name": "eslint-plugin-dual", "version": "1.2.3",
          "exports": { ".": { "import": "./index.mjs", "require": "./index.cjs" }, "./other": "./other.cjs" } }`,
        "node_modules/eslint-plugin-dual/index.mjs": build("export default", "imported"),
        "node_modules/eslint-plugin-dual/index.cjs": build("module.exports =", "required"),
        "node_modules/eslint-plugin-dual/other.cjs": build("module.exports =", "another"),
        "eslint.config.js": `
          import dual from "eslint-plugin-dual";
          export default [{ plugins: { dual }, rules: { "dual/r": "error" } }];\n`,
      };
      const { stdout, stderr, exitCode } = await lint({ ...files, ...bunfig(`["dual"]`, {}) }, ["-f", "unix", "src"]);
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("[Error/dual/r]");
      expect(exitCode).toBe(1);
      // Another file of the package is another plugin.
      const other = bunfig(`[{ name = "dual", specifier = "eslint-plugin-dual/other" }]`, {});
      expect((await lint({ ...files, ...other }, ["src"])).stderr).toContain(`The plugin "dual" is loaded twice`);
    });

    test("two plugins of one package under one name are two plugins", async () => {
      const one = project["node_modules/eslint-plugin-demo/index.js"].replace(
        "eslint-plugin-demo",
        "eslint-plugin-multi",
      );
      const files = {
        ...project,
        "node_modules/eslint-plugin-multi/package.json": `{ "name": "eslint-plugin-multi", "main": "a.js" }`,
        "node_modules/eslint-plugin-multi/a.js": one,
        "node_modules/eslint-plugin-multi/b.js": one.replace("No foo.", "Another."),
        "eslint.config.js": `
          import multi from "eslint-plugin-multi/a.js";
          export default [{ plugins: { multi }, rules: { "multi/no-foo": "error" } }];\n`,
      };
      const { stdout, stderr, exitCode } = await lint({ ...files, ...bunfig(`["eslint-plugin-multi/b.js"]`, {}) }, [
        "src",
      ]);
      expect(stderr).toContain(`The plugin "multi" is loaded twice: here, and by plugins in bunfig.toml or --plugin`);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    });

    test("two files of the project under one name are two plugins", async () => {
      const files = {
        ...project,
        "lint/other.js": local.replace("No TODO.", "Another."),
        "eslint.config.js": `
          import local from "./lint/other.js";
          export default [{ plugins: { local }, rules: { "local/no-todo": "error" } }];\n`,
      };
      const { stdout, stderr, exitCode } = await lint({ ...files, ...bunfig(`["./lint/plugin.js"]`, {}) }, ["src"]);
      expect(stderr).toContain(`The plugin "local" is loaded twice: here, and by plugins in bunfig.toml or --plugin`);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    });

    // Enough of the package `eslint`: it says which rules it would run, and of which plugins it has them.
    const eslint = {
      "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version: "10.0.0", main: "index.js" }),
      "node_modules/eslint/index.js": `
        exports.Linter = class Linter {
          verify(text, configs) {
            const plugins = Object.assign({}, ...configs.map(it => it.plugins));
            const rules = Object.assign({}, ...configs.map(it => it.rules));
            return Object.keys(rules).map(ruleId => {
              const [prefix, name] = ruleId.split("/");
              const message = typeof plugins[prefix]?.rules[name]?.create === "function" ? "has it" : "does not have it";
              return { ruleId, severity: 2, message, line: 1, column: 1 };
            }).concat(
              // What a comment in the file can ask for: all of the plugin, not only the rules that are on.
              Object.entries(plugins).map(([prefix, plugin]) => ({
                ruleId: null,
                severity: 1,
                message: prefix + " is " + plugin.meta?.name + " with " + Object.keys(plugin.rules ?? {}).length + " listed",
                line: 1,
                column: 1,
              })),
            );
          }
          getSuppressedMessages() {
            return [];
          }
        };`,
      "eslint.config.js": `
        const parser = { parseForESLint: () => ({ ast: { type: "Program", body: [], tokens: [], comments: [], range: [0, 0], loc: {} } }) };
        export default [{ files: ["**/*.foo"], languageOptions: { parser } }];\n`,
      "src/a.foo": "anything\n",
    };
    test("a file that goes to the installed ESLint has the same plugin as the others, whatever is called default", async () => {
      const files = {
        ...project,
        ...eslint,
        "node_modules/eslint-plugin-demo/index.js": project["node_modules/eslint-plugin-demo/index.js"].replace(
          "rules: {",
          `default: { meta: { name: "another" }, rules: {} },\n  rules: {`,
        ),
      };
      const { stdout, stderr } = await lint({ ...files, ...both }, ["-f", "unix", "src/a.foo"]);
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("has it [Error/demo/no-foo]");
      expect(stdout).toContain("demo is eslint-plugin-demo with ");
    });

    test("a file that goes to the installed ESLint needs the package of a built-in plugin", async () => {
      const files = { ...project, ...eslint, ...bunfig(`["react"]`, { "react/jsx-key": "error" }) };
      const { stderr, exitCode } = await lint(files, ["src/a.foo"]);
      expect(stderr).toContain("eslint-plugin-react is not installed\n");
      expect(stderr).toContain("some of your files go to the installed ESLint, which needs the package");
      expect(exitCode).toBe(2);
    });

    test.each<[string, Record<string, string>, string[]]>([
      ["plugins", both, []],
      ["--plugin", {}, ["--plugin", "demo", "--rule", "demo/no-foo: error"]],
    ])("a file that goes to the installed ESLint has them too: %s", async (_, config, flags) => {
      const { stdout, stderr } = await lint({ ...project, ...eslint, ...config }, [
        "-f",
        "unix",
        ...flags,
        "src/a.foo",
      ]);
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("has it [Error/demo/no-foo]");
      expect(stdout).not.toContain("does not have it");
      expect(stdout).toContain("demo is eslint-plugin-demo with ");
    });
  });

  test.each<[string, Record<string, string>]>([
    [".oxlintrc.json", { ".oxlintrc.json": `{ "jsPlugins": ["./lint/other.js"] }` }],
    [
      ".eslintrc.json",
      { ".eslintrc.json": `{ "root": true, "plugins": ["local"] }`, ...packaged("eslint-plugin-local", "local") },
    ],
  ])("another plugin that an %s has under the same name is an error", async (_, config) => {
    const files = { ...project, ...config, "lint/other.js": local.replace("No TODO.", "Another.") };
    const { stdout, stderr, exitCode } = await lint({ ...files, ...bunfig(`["./lint/plugin.js"]`, {}) }, ["src"]);
    expect(stdout + stderr).toContain(
      `The plugin "local" is loaded twice: here, and by plugins in bunfig.toml or --plugin`,
    );
    expect(exitCode).not.toBe(0);
  });

  describe("next to an .eslintrc.json", () => {
    const parserOptions = `"parserOptions": { "sourceType": "module", "ecmaVersion": 2022 }`;
    const expected = { found: ["2:14 demo/no-foo"], stderr: "", exitCode: 0 };

    test.each<[string, string, string, string[]]>([
      ["the file and bunfig.toml", `"plugins": ["demo"], `, `["demo"]`, []],
      ["the long name", `"plugins": ["demo"], `, `["eslint-plugin-demo"]`, []],
      ["bunfig.toml and --plugin", "", `["demo"]`, ["--plugin", "demo"]],
      ["the file and a path", `"plugins": ["demo"], `, `["./node_modules/eslint-plugin-demo/index.js"]`, []],
    ])("the same package named twice is one plugin: %s", async (_, inFile, plugins, flags) => {
      const files = {
        ...project,
        ".eslintrc.json": `{ "root": true, ${parserOptions}, ${inFile}"rules": { "demo/no-foo": "warn" } }`,
      };
      expect(await found({ ...files, ...bunfig(plugins, {}) }, flags)).toEqual(expected);
    });

    test("a config of the plugin that the file extends brings the same plugin", async () => {
      const files = {
        ...project,
        "node_modules/eslint-plugin-demo/index.js": project["node_modules/eslint-plugin-demo/index.js"].replace(
          "rules: {",
          `configs: { rec: { plugins: ["demo"], rules: { "demo/no-foo": "warn" } } },\n  rules: {`,
        ),
        ".eslintrc.json": `{ "root": true, ${parserOptions}, "extends": ["plugin:demo/rec"] }`,
      };
      expect(await found({ ...files, ...bunfig(`["demo"]`, {}) })).toEqual(expected);
    });

    test("ESLint 8 takes any options for a rule without a schema, and a rule that is off needn't exist", async () => {
      const files = {
        ...project,
        ".eslintrc.json": `{ "root": true, ${parserOptions} }`,
        "lint/x.js": `
          export default { meta: { name: "x" }, rules: { opt: { create(context) {
            return { Program(node) { context.report({ node, message: JSON.stringify(context.options) }); } };
          } } } };\n`,
      };
      const { stdout, stderr, exitCode } = await lint(
        { ...files, ...bunfig(`["./lint/x.js"]`, { "x/opt": ["warn", "always"], "x/nope": "off" }) },
        ["-f", "unix", "src"],
      );
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain(`["always"] [Warning/x/opt]`);
      expect(exitCode).toBe(0);
    });
  });

  test("a module of Node.js is no plugin", async () => {
    const { stderr, exitCode } = await lint({ ...project, ...bunfig(`["fs"]`, {}) }, ["src"]);
    expect(stderr).toContain(
      `error: Cannot load the plugin "fs"\n  Neither eslint-plugin-fs nor fs is installed\n    at bunfig.toml:2:12`,
    );
    expect(exitCode).toBe(2);
  });

  test("--plugin with a path next to an .eslintrc.json", async () => {
    const files = {
      ...project,
      ".eslintrc.json": `{ "root": true, "parserOptions": { "sourceType": "module", "ecmaVersion": 2022 } }`,
    };
    expect(await found(files, ["--plugin", "./lint/plugin.js", "--rule", "local/no-todo: warn"])).toEqual({
      found: ["1:1 local/no-todo"],
      stderr: "",
      exitCode: 0,
    });
  });

  test("next to an .eslintrc.json, which has no word for a path or another prefix", async () => {
    const files = {
      ...project,
      ".eslintrc.json": `{ "root": true, "parserOptions": { "sourceType": "module", "ecmaVersion": 2022 }, "rules": { "no-debugger": "warn" } }`,
    };
    const plugins = `["./lint/plugin.js", { name = "mine", specifier = "eslint-plugin-demo" }]`;
    expect(await found({ ...files, ...bunfig(plugins, { "local/no-todo": "warn", "mine/no-foo": "error" }) })).toEqual({
      found: ["1:1 local/no-todo", "2:14 mine/no-foo", "3:1 no-debugger"],
      stderr: "",
      exitCode: 1,
    });
  });

  test("a severity that isn't one, by a flag", async () => {
    const { stdout, stderr, exitCode } = await lint(project, [
      "--plugin",
      "demo",
      "--rule",
      "demo/no-foo: loud",
      "src",
    ]);
    expect(stderr).toStartWith(`error: "loud" is not a valid severity for demo/no-foo\n`);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
  });

  test("a built-in plugin's name turns it on, as `plugins` in an .oxlintrc.json or an .eslintrc.json does", async () => {
    const files = { ...project, "src/a.js": "export const a = [1].map(x => <b>{x}</b>);\n" };
    const react = bunfig(`["react"]`, { "react/jsx-key": "error" });
    const [oxlint, without, eslintrc] = await Promise.all([
      found({ ...files, ...react, ".oxlintrc.json": "{}" }),
      found({ ...files, ".oxlintrc.json": `{ "rules": { "react/jsx-key": "error" } }` }),
      found({
        ...files,
        ...react,
        // ESLint 8 looks for the package. The rule that runs is Bun's.
        "node_modules/eslint-plugin-react/package.json": `{ "name": "eslint-plugin-react", "version": "7.37.5", "main": "index.js" }`,
        "node_modules/eslint-plugin-react/index.js": `module.exports = { rules: { "jsx-key": { create: () => ({}) } } };\n`,
        ".eslintrc.json": `{ "root": true, "parserOptions": { "sourceType": "module", "ecmaVersion": 2022, "ecmaFeatures": { "jsx": true } } }`,
      }),
    ]);
    expect(oxlint).toEqual({ found: ["1:22 react(jsx-key)"], stderr: "", exitCode: 1 });
    // The control: that is what the plugin is needed for.
    expect(without).toEqual({ found: [], stderr: "", exitCode: 0 });
    expect(eslintrc).toEqual({ found: ["1:31 react/jsx-key"], stderr: "", exitCode: 1 });
  });

  test("next to an .oxlintrc.json the names are oxlint's: node is built in, and n and prettier are packages", async () => {
    const files = { ...project, ".oxlintrc.json": "{}", "src/a.js": "export const foo = 1;\nprocess.exit(1);\n" };
    const [node, n, prettier, missing] = await Promise.all([
      found({ ...files, ...bunfig(`["node"]`, { "node/no-process-exit": "error" }) }),
      found({ ...files, ...packaged("eslint-plugin-n", "n"), ...bunfig(`["n"]`, { "n/no-foo": "error" }) }),
      found({
        ...files,
        ...packaged("eslint-plugin-prettier", "prettier"),
        ...bunfig(`["prettier"]`, { "prettier/no-foo": "error" }),
      }),
      lint({ ...files, ...bunfig(`["n"]`, {}) }, ["src"]),
    ]);
    expect(node).toEqual({ found: ["2:1 node(no-process-exit)"], stderr: "", exitCode: 1 });
    expect(n).toEqual({ found: ["1:14 n(no-foo)"], stderr: "", exitCode: 1 });
    expect(prettier).toEqual({ found: ["1:14 prettier(no-foo)"], stderr: "", exitCode: 1 });
    expect(missing.stderr).toContain(
      `Cannot load the plugin "n"\n  Neither eslint-plugin-n nor n is installed\n    at bunfig.toml:2:12`,
    );
    expect({ stdout: missing.stdout, exitCode: missing.exitCode }).toEqual({ stdout: "", exitCode: 2 });
  });

  test("--plugin next to an .oxlintrc.json", async () => {
    const files = { ...project, ".oxlintrc.json": `{ "rules": { "no-debugger": "off" } }` };
    expect(await found(files, ["--plugin", "demo", "--rule", "demo/no-foo: error"])).toEqual({
      found: ["2:14 demo(no-foo)"],
      stderr: "",
      exitCode: 1,
    });
  });

  test("next to an .oxlintrc.json a flag counts for more than bunfig.toml", async () => {
    const files = { ...project, ".oxlintrc.json": `{ "plugins": [] }`, "src/a.js": "export const a = null;\n" };
    const unicorn = bunfig(`["unicorn"]`, { "unicorn/no-null": "error" });
    expect(await found({ ...files, ...unicorn })).toEqual({
      found: ["1:18 unicorn(no-null)"],
      stderr: "",
      exitCode: 1,
    });
    expect(await found({ ...files, ...unicorn }, ["--disable-unicorn-plugin"])).toEqual({
      found: [],
      stderr: "",
      exitCode: 0,
    });
  });

  test("another plugin can't take a built-in plugin's name next to an .oxlintrc.json", async () => {
    const plugins = `[{ name = "react", specifier = "demo" }]`;
    const { stderr, exitCode } = await lint({ ...project, ...bunfig(plugins, {}), ".oxlintrc.json": "{}" }, ["src"]);
    expect(stderr).toContain(
      `error: The plugin "react" needs another name\n  That one is a built-in plugin's: { name = "react-js", specifier = "eslint-plugin-demo" }\n`,
    );
    expect(exitCode).toBe(2);
  });

  test("a name that oxlint keeps for rules that bun lint doesn't have", async () => {
    const files = { ...project, ...packaged("eslint-plugin-jsdoc", "jsdoc"), ".oxlintrc.json": "{}" };
    const refused = await lint({ ...files, ...bunfig(`["jsdoc"]`, {}) }, ["src"]);
    expect(refused.stderr).toContain(
      `error: The plugin "jsdoc" needs another name\n  oxlint keeps that one for its own rules, which bun lint doesn't have: { name = "jsdoc-js", specifier = "eslint-plugin-jsdoc" }\n`,
    );
    expect(refused.exitCode).toBe(2);
    const renamed = bunfig(`[{ name = "jsdoc-js", specifier = "eslint-plugin-jsdoc" }]`, {
      "jsdoc-js/no-foo": "error",
    });
    expect((await found({ ...files, ...renamed })).found).toContain("2:14 jsdoc-js(no-foo)");
  });

  test("a rule that is off doesn't have its options checked", async () => {
    const rules = { "demo/no-foo": ["off", { nam: "x" }] };
    expect((await found({ ...project, ...bunfig(`["demo"]`, rules) })).found).toEqual(["3:1 no-debugger"]);
  });

  test("the same package in a bunfig.toml elsewhere and by --plugin counts once", async () => {
    using dir = tempDir("bun-lint", {
      ...project,
      "config/bunfig.toml": `[lint]\nplugins = ["demo"]\n[lint.rules]\n"demo/no-foo" = "warn"\n`,
    });
    await using proc = spawn({
      cmd: [bunExe(), "--config=config/bunfig.toml", "lint", "-f", "unix", "--plugin", "demo", "src"],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("[Warning/demo/no-foo]");
    expect(exitCode).toBe(1);
  });

  test("a path is relative to the bunfig.toml that has it", async () => {
    using dir = tempDir("bun-lint", {
      ...project,
      "config/bunfig.toml": `[lint]\nplugins = ["../lint/plugin.js"]\n[lint.rules]\n"local/no-todo" = "warn"\n`,
    });
    await using proc = spawn({
      cmd: [bunExe(), "--config=config/bunfig.toml", "lint", "-f", "unix", "src"],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("[Warning/local/no-todo]");
    expect(exitCode).toBe(1);
  });
});
