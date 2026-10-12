// `[lint]` in bunfig.toml.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
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

/** `bun lint ...args` in a directory with `files`. `reads`: the files to read when it has run. */
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
    /** With `-f json-with-metadata`: `file rule severity` for each. */
    problems: problems.sort(),
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    files: Object.fromEntries(reads.map(name => [name, read(name)])),
  };
}

// A key of `[lint]` is the default of the flag of the same name.
describe.concurrent("[lint] in bunfig.toml", () => {
  /** What a run leaves behind: what it prints but for the times, how it ends, and the files. */
  async function run(files: Record<string, string>, args: string[]) {
    const reads = Object.keys(files).filter(name => name !== "bunfig.toml");
    const result = await lint(files, args, reads);
    // In JSON the `\\` of a path of Windows are doubled, so the directory is not found in it and its random end stays.
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

  // Lines of the section, the flags that say the same, flags that say otherwise, the files, and the arguments.
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
      // What takes a list or a table is added to.
      run(files, [...(opposite.length === 0 || /^\[|= \[/.test(lines) ? flags : []), ...opposite, ...args]),
    ]);
    expect(byKey).toEqual(byFlag);
    expect(byKey).not.toEqual(plain);
    expect(underFlag).toEqual(byOtherFlag);
  });

  test("threads", async () => {
    const [byKey, byFlag, wrong] = await Promise.all([
      run({ ...eslint, "bunfig.toml": "[lint]\nthreads = 1\n" }, ["a.js"]),
      run(eslint, ["--threads=1", "a.js"]),
      run({ ...eslint, "bunfig.toml": "[lint]\nthreads = -1\n" }, ["a.js"]),
    ]);
    expect(byKey).toEqual(byFlag);
    expect(wrong.stderr).toContain(`--threads takes a number, not "-1"`);
    expect(wrong.exitCode).toBe(2);
  });

  // 288 bytes for each: 19 GB, and more than there is to address.
  test.each(["67108864", "9007199254740991", "9223372036854775808"])(
    "%s threads are as many as there can be",
    async count => {
      const [byKey, byFlag, few] = await Promise.all([
        run({ ...eslint, "bunfig.toml": `[lint]\nthreads = ${count}\n` }, ["a.js"]),
        run(eslint, [`--threads=${count}`, "a.js"]),
        run(eslint, ["--threads=1", "a.js"]),
      ]);
      // Beyond 2^53 - 1 the file is refused before anybody asks for the key.
      if (Number.isSafeInteger(Number(count))) expect(byKey).toEqual(few);
      expect(byFlag).toEqual(few);
    },
  );

  // ESLint refuses the flag in a run that fixes nothing.
  test("fixType waits for a run that fixes", async () => {
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
    // With the configuration of ESLint alone, neither makes it a run of oxlint.
    const [byKey, byFlag, plain] = await Promise.all([
      run({ ...eslint, "bunfig.toml": "[lint]\ndenyWarnings = true\n" }, ["-f", "unix", "a.js"]),
      run(eslint, ["--deny-warnings", "-f", "unix", "a.js"]),
      run(eslint, ["-f", "unix", "a.js"]),
    ]);
    expect(byKey.stdout).toBe(plain.stdout);
    expect(byFlag.stdout).toBe(plain.stdout);
  });

  test("bun/format holds a file against what bun format prints, with [format]", async () => {
    const files = { "a.js": "a('b')\n", "bunfig.toml": "[format]\nsemi = false\nsingleQuote = true\n" };
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

  test("the file is that of the working directory, after --cwd", async () => {
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

  /** `bun ...args` in a directory with `files`. */
  async function bun(files: Record<string, string>, args: string[]) {
    using dir = tempDir("bun-lint-bunfig", files);
    const stdio = { stdin: "ignore", stdout: "pipe", stderr: "pipe" } as const;
    await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd: String(dir), ...stdio });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("--config= before lint names another file than bunfig.toml", async () => {
    const files = {
      ...eslint,
      "bunfig.toml": `[lint]\nformat = "unix"\n`,
      "other.toml": `[lint]\nformat = "json"\n`,
    };
    const results = await Promise.all([
      bun(files, ["lint", "a.js"]),
      bun(files, ["--config=other.toml", "lint", "a.js"]),
      bun(files, ["-c=other.toml", "lint", "a.js"]),
      // What follows `lint` is the linter's.
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

  test("what is wrong with [lint] is shown where it is, as for every other section", async () => {
    const bunfig = `[lint]\nquiet = true\n\n[lint.rules]\neqeqeq = ["error", "smart"]\n"no-var" = "always"\n`;
    const result = await bun({ ...eslint, "bunfig.toml": bunfig }, ["lint", "a.js"]);
    expect(result.stderr).toContain(`6 | "no-var" = "always"\n`);
    expect(result.stderr).toMatch(
      /error: "always" is not a valid severity for no-var\n  Expected "off", "warn", or "error"\n\s+at bunfig\.toml:6:12\n$/,
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(2);
  });

  // The flags that say what one run does.
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
  ])("%s is refused, and nothing is written", async (line, flag) => {
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
    // The name of a flag whose key is called otherwise.
    [`ignorePattern = ["a"]`, `Unknown key "ignorePattern" in [lint]\n  Did you mean "ignorePatterns"?`],
    [`rule = "a"`, `Unknown key "rule" in [lint]\n  Did you mean "rules"?`],
    [`global = "a"`, `Unknown key "global" in [lint]\n  Did you mean "globals"?`],
    [`deny = "style"`, `Unknown key "deny" in [lint]\n  Did you mean "categories"?`],
    // Nothing is near.
    [`plugins = ["import"]`, `Unknown key "plugins" in [lint]\n    at`],
    [`extends = ["a"]`, `Unknown key "extends" in [lint]\n    at`],
    ["cache = true", `Unknown key "cache" in [lint]\n    at`],
    [`env = ["node"]`, `Unknown key "env" in [lint]\n    at`],
  ])("%s is refused: %s", async (lines, message) => {
    const bunfig = lines.startsWith("[") ? `${lines}\n` : `[lint]\n${lines}\n`;
    const result = await run({ ...eslint, "bunfig.toml": bunfig }, ["a.js"]);
    expect(result.stderr).toContain(message);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(2);
  });

  test("every flag in the help is a key, or is refused as a key with its name", async () => {
    const help = await lint({}, ["--help", "--all"]);
    const flags = [...help.stdout.matchAll(/^\s+(?:-\w, )?--([a-z0-9-]+)/gm)].map(it => it[1]);
    expect(flags.length).toBeGreaterThan(90);
    const renamed: Record<string, string> = {
      "ignore-pattern": "ignorePatterns",
      "report-unused-disable-directives-severity": "reportUnusedDisableDirectives",
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
        // Of a type that no key takes: one that exists says what it expects.
        const { stderr } = await run({ "bunfig.toml": `[lint]\n${key} = [[1]]\n` }, ["--list-files"]);
        return [flag, /expected .+ but received|is not a valid severity|cannot be set in bunfig\.toml/.test(stderr)];
      }),
    );
    // Flags of ESLint and oxlint that say nothing about a project, or have no effect.
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
      "plugin",
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

describe.concurrent("[[lint.overrides]]", () => {
  /** What is reported, as `file rule severity`, in a format that is the same whosever the configuration is. */
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

    // A pattern without a slash is for a name in any directory, any other for the path from bunfig.toml.
    test("an override is for the files that `files` matches and `excludeFiles` does not", async () => {
      expect(await problems(files)).toEqual(left);
    });

    test("it makes no file linted", async () => {
      const { stdout, exitCode } = await lint(files, ["--list-files"]);
      expect(stdout).toContain("c.js");
      expect(stdout).not.toContain("README.md");
      expect(exitCode).toBe(0);
    });

    test("--rule wins, also where it says what [lint.rules] says", async () => {
      const all = Object.keys(tree).filter(it => it.endsWith(".js"));
      expect(await problems(files, ["--rule", "no-console: error"])).toEqual(
        all.map(it => `${it} no-console error`).sort(),
      );
      expect(await problems(files, ["--rule", "no-console: warn", "sub"])).toEqual([
        "sub/b.test.js no-console warn",
        "sub/c.js no-console warn",
      ]);
    });

    test("a later one wins over an earlier one", async () => {
      const later = `${bunfig}\n[[lint.overrides]]\nfiles = "sub/**"\nrules = { "no-console" = "warn" }\n`;
      expect(await problems({ ...files, "bunfig.toml": later })).toEqual([
        "scripts/vendor/e.js no-console error",
        "sub/b.test.js no-console warn",
        "sub/c.js no-console warn",
      ]);
    });

    test("patterns have Bun.Glob's syntax, including extglobs and brace ranges", async () => {
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

    test("globals, which --global wins over", async () => {
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

  // oxlint has no extglobs and no ranges. `{1..3}` is a group with the one alternative `1..3`. Checked against oxlint 1.87.
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

  test("the patterns are from the directory of bunfig.toml, wherever the config file is", async () => {
    const files = { ...tree, "bunfig.toml": bunfig, "config/mine.json": oxlintrc, "config/mine.js": flat };
    expect(await problems(files, ["--config", "config/mine.json"])).toEqual(left);
    expect(await problems(files, ["--config", "config/mine.js"])).toEqual(left);
    const nested = { ...tree, "bunfig.toml": bunfig, ".oxlintrc.json": "{}", "scripts/.oxlintrc.json": oxlintrc };
    expect(await problems(nested)).toEqual(left);
    // That of the working directory.
    const below = { ...tree, "bunfig.toml": "", "scripts/bunfig.toml": bunfig.replaceAll("scripts/", "") };
    expect(await problems(below, ["--cwd", "scripts"])).toEqual(["scripts/vendor/e.js no-console error"]);
  });

  test("a severity alone keeps the options of [lint.rules]", async () => {
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

  test("settings", async () => {
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

  test("its tables can be written as sections", async () => {
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
  ])("%s is refused", async (bunfig, message, place) => {
    const { stdout, stderr, exitCode } = await lint({ "a.js": log, "bunfig.toml": `${bunfig}\n` }, []);
    expect(stderr).toContain(`error: ${message}`);
    expect(stderr).toEndWith(`\n    at bunfig.toml:${place}`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
  });

  test.each(["eslint.config.js", ".eslintrc.json"])(
    "a mistake in its rules, with %s, is said to be in bunfig.toml",
    async name => {
      const bunfig = inOverride(`rules = { eqeqeq = ["error", "sometimes"] }\n`);
      const { stderr, exitCode } = await lint({ ...configs[name], "a.js": log, "bunfig.toml": bunfig }, []);
      expect(stderr).toContain("Invalid config in bunfig.toml\n");
      expect(exitCode).toBe(2);
    },
  );
});

// Which rules are on is one question, whether there are types another.
describe.concurrent("types without a config file", () => {
  const files = {
    "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
    "a.ts": "async function f() {}\nf();\nexport const a: string = 1;\n",
  };
  const floating = `[lint.rules]\n"@typescript-eslint/no-floating-promises" = "error"\n`;
  const run = async (bunfig: string, args: string[] = []) => {
    const result = await lint({ ...files, "bunfig.toml": bunfig }, ["-f", "json-with-metadata", ...args]);
    return [result.problems, result.stderr.includes("Skipped 1 rule that needs type information")];
  };

  test("a rule that needs types runs if it is turned on", async () => {
    const reported = ["a.ts @typescript-eslint/no-floating-promises error"];
    expect(await run("")).toEqual([[], false]);
    expect(await run(floating)).toEqual([reported, false]);
    expect(await run("", ["--rule", "@typescript-eslint/no-floating-promises: error"])).toEqual([reported, false]);
    const inOverride = floating.replace("[lint.rules]", `[[lint.overrides]]\nfiles = "*.ts"\n[lint.overrides.rules]`);
    expect(await run(inOverride)).toEqual([reported, false]);
  });

  // `consistent-type-imports` reads the tsconfig.json where there are types.
  test("a rule that only uses types where there are any does not make a run check them", async () => {
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

  test("not with typeAware = false or --no-type-aware", async () => {
    expect(await run(`[lint]\ntypeAware = false\n${floating}`)).toEqual([[], true]);
    expect(await run(floating, ["--no-type-aware"])).toEqual([[], true]);
  });

  test("typeCheck and --type-check report type errors, and turn no rule on", async () => {
    const reported = ["a.ts typescript/TS2322 error"];
    expect(await run("[lint]\ntypeCheck = true\n")).toEqual([reported, false]);
    expect(await run("", ["--type-check"])).toEqual([reported, false]);
  });
});
