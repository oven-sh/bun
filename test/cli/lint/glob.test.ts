import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { relative } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined };

// Each rule reports this code exactly once, so a single run shows which of up to 16 patterns match which files.
const rules = [
  "no-var",
  "eqeqeq",
  "no-debugger",
  "no-self-assign",
  "no-empty",
  "no-console",
  "no-alert",
  "no-eval",
  "no-void",
  "no-plusplus",
  "no-ternary",
  "no-undefined",
  "no-bitwise",
  "no-implicit-coercion",
  "no-object-constructor",
  "no-unused-expressions",
];
const code = `var x = 1;
if (x == 2) debugger;
x = x;
if (x) {}
console.log(x);
alert(x);
eval("x");
void x;
x++;
x = x ? 1 : 2;
x = undefined;
x = x | 1;
x = !!x;
x = new Object();
x;
`;

/** Uses each pattern as `files` in an `eslint.config.mjs` and returns the files it matched. */
async function filesOf(patterns: string[], files: string[], more: object[] = []) {
  const objects = patterns.map((pattern, index) => ({ files: [pattern], rules: { [rules[index]]: "error" } }));
  using dir = tempDir("bun-lint-glob", {
    ...Object.fromEntries(files.map(file => [file, code])),
    "eslint.config.mjs": `export default ${JSON.stringify([...more, ...objects])};\n`,
  });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", "."],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (!stdout.startsWith("[")) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
  const results: { filePath: string; messages: { ruleId: string }[] }[] = JSON.parse(stdout);
  return patterns.map((pattern, index) => [
    pattern,
    results
      .filter(it => it.messages.some(message => message.ruleId === rules[index]))
      .map(it => relative(String(dir), it.filePath).replaceAll("\\", "/"))
      .sort()
      .join(" "),
  ]);
}

const files = [
  "a.js",
  "a.mjs",
  "a.cjs",
  "a.ts",
  "a.tsx",
  "a.mts",
  "a.test.ts",
  "a.css.js",
  "src/a.js",
  "src/b.js",
  "src/c.js",
  "src/ab.js",
  "src/aab.js",
  "src/abc.js",
  "src/bbc.js",
  "src/.js",
  "src/x/a.js",
  "src/x/y.ts",
  "src/a.test.ts",
  "lib/a.js",
  "lib/x/a.js",
  "app/(group)/a.js",
  "app/group/a.js",
];
const js =
  "a.css.js a.js app/(group)/a.js app/group/a.js lib/a.js lib/x/a.js src/.js src/a.js src/aab.js src/ab.js src/abc.js src/b.js src/bbc.js src/c.js src/x/a.js";
const all = [...files].sort().join(" ");

// The expected files come from ESLint 10.12.
test.concurrent("extglob patterns in `files` match the same files as ESLint", async () => {
  const expected = [
    ["**/*.?(c|m)js", ["a.cjs", "a.mjs", ...js.split(" ")].sort().join(" ")],
    ["**/*.@(js|ts)", [...js.split(" "), "a.test.ts", "a.ts", "src/a.test.ts", "src/x/y.ts"].sort().join(" ")],
    ["src/+(a|b).js", "src/a.js src/aab.js src/ab.js src/b.js"],
    ["src/*(a|b).js", "src/.js src/a.js src/aab.js src/ab.js src/b.js"],
    ["**/!(*.test).ts", "a.ts src/x/y.ts"],
    ["**/*.?([cm])[jt]s?(x)", all],
    [
      "@(src|lib)/**/*.js",
      js
        .split(" ")
        .filter(it => /^(src|lib)\//.test(it))
        .join(" "),
    ],
    // Nested groups, and groups mixed with braces
    ["src/@(a|{b,c}).js", "src/a.js src/b.js src/c.js"],
    [
      "**/+(a|*(b)c).js",
      "a.js app/(group)/a.js app/group/a.js lib/a.js lib/x/a.js src/a.js src/abc.js src/bbc.js src/c.js src/x/a.js",
    ],
    // Parentheses without a prefix are literal.
    ["app/(group)/*.js", "app/(group)/a.js"],
    [
      "**/*.{js,?(m)ts}",
      [...js.split(" "), "a.mts", "a.test.ts", "a.ts", "src/a.test.ts", "src/x/y.ts"].sort().join(" "),
    ],
    // `**` at the end of an alternative that ends the pattern
    [
      "{lib/*.js,src/**}",
      all
        .split(" ")
        .filter(it => it === "lib/a.js" || it.startsWith("src/"))
        .join(" "),
    ],
    // `!(a|b)` only rejects a name if the rest of the pattern matches after `a` or `b`.
    ["src/!(a|b)*.js", "src/.js src/c.js"],
    // For ESLint a leading `!` always negates the pattern, even before `(`.
    ["!(src)/**/*.js", all],
    ["**/@(a|b).!(js)", "a.cjs a.css.js a.mjs a.mts a.test.ts a.ts a.tsx src/a.test.ts"],
    ["src/?(a)?(b).js", "src/.js src/a.js src/ab.js src/b.js"],
  ];
  expect(
    await filesOf(
      expected.map(it => it[0]),
      files,
    ),
  ).toEqual(expected);
});

test.concurrent("`ignores` handles `a`, `a/`, `a/*`, `a/**` and `!` like ESLint", async () => {
  const files = [
    "a.js",
    "out/a.js",
    "x/out/a.js",
    "gen/a.js",
    "gen/keep/a.js",
    "all/a.js",
    "all/keep/a.js",
    "dir/a.js",
  ];
  const ignores = ["**/out", "gen/*", "!gen/keep", "all/**", "!all/keep", "dir/", "@(no|none)/**"];
  // `all/**` ignores the directory `all` itself, so nothing in it can be re-included. `gen/*` doesn't ignore `gen`.
  expect(await filesOf(["**/*.js"], files, [{ ignores }])).toEqual([["**/*.js", "a.js gen/keep/a.js"]]);
});

test.concurrent("patterns with many or deeply nested groups match quickly", async () => {
  const name = Buffer.alloc(60, "a").toString();
  const expected = [
    [`${Buffer.alloc(120, "*(a|a)").toString()}b.js`, ""],
    [`${Buffer.alloc(100, "{a,a}").toString()}*b.js`, ""],
    [`${Buffer.alloc(40, "+(").toString()}a${Buffer.alloc(20, ")").toString()}.js`, `${name}.js`],
    [`${Buffer.alloc(40, "!(b)").toString()}.js`, `${name}.js`],
  ];
  expect(
    await filesOf(
      expected.map(it => it[0]),
      [`${name}.js`],
    ),
  ).toEqual(expected);
});

// eslint-plugin-import calls minimatch without `dot`.
test.concurrent("wildcards in import rule options don't match a leading dot", async () => {
  const code = 'import "./a.css";\nimport "./a.less";\nimport "./a.scss";\n';
  const styles = { "a.css": "", "a.less": "", "a.scss": "" };
  const inside = (directory: string) =>
    Object.fromEntries(
      Object.entries({ "a.js": code, ...styles }).map(([name, text]) => [`${directory}/${name}`, text]),
    );
  using dir = tempDir("bun-lint-glob", {
    // `{**,}/` means `**/` or `/`.
    "bunfig.toml": `[lint.rules]\n"import/no-unassigned-import" = ["error", { allow = ["{**,}/*.css", "**/*.less"] }]\n`,
    ...inside("src/x"),
    ...inside(".hidden/x"),
  });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", "src", ".hidden/x/a.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (!stdout.startsWith("[")) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
  const results: { filePath: string; messages: { line: number }[] }[] = JSON.parse(stdout);
  const lines = results.map(it => [
    relative(String(dir), it.filePath).replaceAll("\\", "/"),
    it.messages.map(message => message.line),
  ]);
  expect(Object.fromEntries(lines)).toEqual({ "src/x/a.js": [3], ".hidden/x/a.js": [1, 2, 3] });
  expect(exitCode).toBe(1);
});

/** Lints a project with these files and returns each report as `file:line`. */
async function reported(files: Record<string, string>, args: string[]) {
  using dir = tempDir("bun-lint-glob", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", ...args],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (!stdout.startsWith("[")) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
  const results: { filePath: string; messages: { line: number }[] }[] = JSON.parse(stdout);
  return results
    .flatMap(it =>
      it.messages.map(message => `${relative(String(dir), it.filePath).replaceAll("\\", "/")}:${message.line}`),
    )
    .sort();
}

test.concurrent("import/no-extraneous-dependencies: `**/*.test.js` doesn't match files in .storybook", async () => {
  const code = 'import dev from "dev";\nexport default dev;\n';
  const files = {
    "bunfig.toml": `[lint.rules]\n"import/no-extraneous-dependencies" = ["error", { devDependencies = ["**/*.test.js"] }]\n`,
    "package.json": JSON.stringify({ name: "p", version: "1.0.0", devDependencies: { dev: "1.0.0" } }),
    "node_modules/dev/package.json": JSON.stringify({ name: "dev", version: "1.0.0", main: "index.js" }),
    "node_modules/dev/index.js": "module.exports = 1;\n",
    "src/a.test.js": code,
    "src/b.js": code,
    ".storybook/a.test.js": code,
  };
  expect(await reported(files, ["src", ".storybook/a.test.js"])).toEqual([".storybook/a.test.js:1", "src/b.js:1"]);
});

test.concurrent.each([
  [", patternOptions = { dot = true }", ["a.js:2"]],
  ["", []],
])("import/order honors patternOptions.dot%s", async (options, expected) => {
  const group = `{ pattern = "~/**", group = "builtin", position = "before"${options} }`;
  const files = {
    "bunfig.toml": `[lint.rules]\n"import/order" = ["error", { pathGroups = [${group}], pathGroupsExcludedImportTypes = [] }]\n`,
    "a.js": 'import fs from "fs";\nimport a from "~/.hidden/a";\nexport default [fs, a];\n',
  };
  expect(await reported(files, ["a.js"])).toEqual(expected);
});

// The answers are minimatch's. A report means that the pattern matched "~(x)/a".
// On Windows, minimatch 3 turns every `\` of a pattern into `/`, so nothing can be escaped there.
const escaped = isWindows ? [] : ["a.js:2"];
test.concurrent.each([
  ["~(x)/**", true, ["a.js:2"]],
  ["~(x)/**", false, ["a.js:2"]],
  ["~\\(x)/**", true, escaped],
  ["~\\(x)/**", false, escaped],
  ["~+(x)/**", true, []],
  ["~?(\\(x\\))/**", true, []],
  ["~?(\\(x\\))/**", false, escaped],
])("import/order: the pattern %j with patternOptions.noext = %p", async (pattern, noext, expected) => {
  const group = `{ pattern = ${JSON.stringify(pattern)}, group = "builtin", position = "before", patternOptions = { noext = ${noext} } }`;
  const files = {
    "bunfig.toml": `[lint.rules]\n"import/order" = ["error", { pathGroups = [${group}], pathGroupsExcludedImportTypes = [] }]\n`,
    "a.js": 'import fs from "fs";\nimport a from "~(x)/a";\nexport default [fs, a];\n',
  };
  expect(await reported(files, ["a.js"])).toEqual(expected);
});

// The expected files come from ESLint 10.12.
test.concurrent("brace sequences in `files` match the same files as ESLint", async () => {
  // prettier-ignore
  const names = ["0", "1", "2", "3", "4", "9", "10", "11", "01", "02", "001", "-1", "-", "a", "b", "c", "d", "{a}", "1..a"];
  const expected = [
    ["x{1..3}.js", "1 2 3"],
    ["x{3..1}.js", "1 2 3"],
    ["x{01..03}.js", "01 02"],
    ["x{1..10}.js", "1 10 2 3 4 9"],
    ["x{001..3}.js", "001"],
    ["x{-1..1}.js", "-1 0 1"],
    ["x{1..9..2}.js", "1 3 9"],
    ["x{9..1..4}.js", "1 9"],
    ["x{a..c}.js", "a b c"],
    ["x{d..a..2}.js", "b d"],
    ["x{{1..2},a}.js", "1 2 a"],
    // Not sequences
    ["x{1..a}.js", ""],
    ["x{1..3,a}.js", "a"],
    ["x{a}.js", "{a}"],
    ["v{1..2}/**/*.js", "v1 v2"],
  ].map(([pattern, found]) => [
    pattern,
    found
      .split(" ")
      .filter(Boolean)
      .map(it => (it.startsWith("v") ? `${it}/x/a.js` : `x${it}.js`))
      .sort()
      .join(" "),
  ]);
  const files = [...names.map(it => `x${it}.js`), "v1/x/a.js", "v2/x/a.js", "v3/x/a.js"];
  expect(
    await filesOf(
      expected.map(it => it[0]),
      files,
    ),
  ).toEqual(expected);
});

// On Windows `\` is the root of the current drive, which is a directory to lint.
const backslash = isWindows ? [] : ["\\"];
test.concurrent.each([
  "*[\\",
  "*[a\\",
  "[a-\\",
  "[\\",
  "{[\\}",
  "@([\\)",
  "[",
  "{",
  "@(",
  "{1..",
  "[!",
  "[^\\",
  ...backslash,
])("an incomplete pattern matches no files: %s", async pattern => {
  using dir = tempDir("bun-lint-glob", { "a.js": "", "eslint.config.mjs": "export default [{}];\n" });
  await using proc = spawn({
    cmd: [bunExe(), "lint", pattern],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain("No files matching the pattern");
  expect(exitCode).toBe(2);
});

const ignorable = [
  "a.js",
  "b.js",
  "build/a.js",
  "build/sub/c.js",
  "src/b.js",
  "src/build/d.js",
  "a,b.js",
  "[a].js",
  "{a}.js",
  "1.js",
  "2.js",
  "a b.js",
];

// The expected files come from oxlint 1.87.
test.concurrent.each([
  ["build/", "build/a.js | build/sub/c.js | src/build/d.js"],
  ["build\\/", "build/a.js | build/sub/c.js | src/build/d.js"],
  ["/build", "build/a.js | build/sub/c.js"],
  ["build", "build/a.js | build/sub/c.js | src/build/d.js"],
  ["**/build", "build/a.js | build/sub/c.js | src/build/d.js"],
  ["src/**", "src/b.js | src/build/d.js"],
  ["src/*/", "src/build/d.js"],
  ["**/sub/**", "build/sub/c.js"],
  ["/**", ignorable.join(" | ")],
  ["{a,b}.js", "a.js | b.js | build/a.js | src/b.js"],
  // An empty alternative is dropped.
  ["{a,}.js", "a.js | build/a.js"],
  ["{a\\,b,1}.js", "a,b.js | 1.js"],
  ["{a,{b,1}}.js", "a.js | b.js | build/a.js | src/b.js | 1.js"],
  ["a\\,b.js", "a,b.js"],
  ["\\{a\\}.js", "{a}.js"],
  // No sequences and no extglob
  ["{1..2}.js", ""],
  ["@(a|b).js", ""],
  ["[a-b].js", "a.js | b.js | build/a.js | src/b.js"],
  ["[!a].js", "b.js | build/sub/c.js | src/b.js | src/build/d.js | 1.js | 2.js"],
  ["\\[a\\].js", "[a].js"],
  // `\` doesn't escape inside a class, so the class ends at the first `]`.
  ["[\\]a].js", ""],
  ["a\\ b.js", "a b.js"],
  ["a b.js  ", "a b.js"],
  ["!a.js", ""],
])("the oxlint ignorePatterns entry %j ignores the same files as oxlint", async (line, ignored) => {
  using dir = tempDir("bun-lint-glob", {
    ...Object.fromEntries(ignorable.map(file => [file, "debugger;\n"])),
    ".oxlintrc.json": JSON.stringify({ rules: { "no-debugger": "error" }, ignorePatterns: [line] }),
  });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", "."],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // There's no JSON if every file is ignored.
  const diagnostics: { filename: string }[] = stdout.startsWith("{") ? JSON.parse(stdout).diagnostics : [];
  const linted = diagnostics.map(it => it.filename.replaceAll("\\", "/"));
  expect(ignorable.filter(file => !linted.includes(file)).join(" | "), stderr).toBe(ignored);
  expect(exitCode).toBe(1);
});

// The expected results come from ESLint 10.12. minimatch reads a leading `#` as a comment and a leading `!` as a negation.
test.concurrent.each(["#*", "!*"])("the command line pattern %s matches no files, like in ESLint", async pattern => {
  using dir = tempDir("bun-lint-glob", {
    "a.js": "debugger;\n",
    "#a.js": "debugger;\n",
    "sub/b.js": "debugger;\n",
    "eslint.config.mjs": 'export default [{ rules: { "no-debugger": "error" } }];\n',
  });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "--", pattern],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain(`No files matching the pattern "${pattern}" were found.`);
  expect(exitCode).toBe(2);
});

// The expected results come from oxlint 1.87, whose glob matcher never matches a pattern with an unclosed `{` or `[`.
test.concurrent.each(["{a,", "a{,", "*{a,", "[*", "{*", "a\\"])(
  "the oxlint no-restricted-imports pattern %j restricts nothing",
  async pattern => {
    using dir = tempDir("bun-lint-glob", {
      "x.js": ["a", "aa", "{a}", "[a]", "{a,", "a{,"].map(source => `import "${source}";\n`).join(""),
      ".oxlintrc.json": JSON.stringify({ rules: { "no-restricted-imports": ["error", { patterns: [pattern] }] } }),
    });
    await using proc = spawn({
      cmd: [bunExe(), "lint", "-f", "json", "x.js"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (!stdout.startsWith("{")) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
    const diagnostics: { code: string }[] = JSON.parse(stdout).diagnostics;
    expect(diagnostics.filter(it => it.code.includes("no-restricted-imports"))).toEqual([]);
    expect(exitCode).toBe(0);
  },
);
