import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
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

/** Uses each pattern as `files` in an `eslint.config.mjs`, or in the `overrides` of an `.oxlintrc.json`, and returns the files it matched. */
async function filesOf(patterns: string[], files: string[], more: object[] | "oxlint" = []) {
  const objects = patterns.map((pattern, index) => ({ files: [pattern], rules: { [rules[index]]: "error" } }));
  using dir = tempDir("bun-lint-glob", {
    ...Object.fromEntries(files.map(file => [file, code])),
    ...(more === "oxlint"
      ? { ".oxlintrc.json": JSON.stringify({ plugins: [], categories: { correctness: "off" }, overrides: objects }) }
      : { "eslint.config.mjs": `export default ${JSON.stringify([...more, ...objects])};\n` }),
  });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", "."],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (!/^[[{]/.test(stdout)) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
  const json = JSON.parse(stdout);
  const results: { filePath: string; messages: { ruleId: string }[] }[] =
    more === "oxlint"
      ? json.diagnostics.map((it: { filename: string; code: string }) => ({
          filePath: join(String(dir), it.filename),
          messages: [{ ruleId: it.code.slice("eslint(".length, -1) }],
        }))
      : json;
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
const extglobs = [
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

test.concurrent("extglob patterns in `files` match the same files as ESLint", async () => {
  expect(
    await filesOf(
      extglobs.map(it => it[0]),
      files,
    ),
  ).toEqual(extglobs);
});

// oxlint 1.87 takes the parentheses literally, so there `**/*.?(c|m)js` matches none of these files.
test.concurrent("extglob patterns in `files` of an .oxlintrc.json match the same files as ESLint", async () => {
  expect(
    await filesOf(
      extglobs.map(it => it[0]),
      files,
      "oxlint",
    ),
  ).toEqual(extglobs);
});

test.concurrent(
  "the rest of a pattern with extglob groups in an .oxlintrc.json is read like oxlint reads it",
  async () => {
    const files = ["a.js", "b.js", "src/a.js", "src/b.js", "lib/a.js", "p/@(a).js", "p/+(a.js", "p/+(a).js", "f2.js"];
    const all = [...files].sort().join(" ");
    const expected = [
      // A pattern without a slash matches in any directory. oxlint puts `**/` in front of it, so its `!` isn't at the start.
      ["@(a|c).js", "a.js lib/a.js src/a.js"],
      ["!(a).js", "b.js f2.js p/+(a).js p/+(a.js p/@(a).js src/b.js"],
      ["./@(src|lib)/*.js", "lib/a.js src/a.js src/b.js"],
      // A `!` at the start negates the pattern, even before `(`.
      ["!@(src|lib)/**", "a.js b.js f2.js p/+(a).js p/+(a.js p/@(a).js"],
      ["./!(src)/*.js", all],
      // An escaped `(` or prefix is literal, and so is a group that isn't closed, or isn't closed in its braces.
      ["p/\\@(a).js", "p/@(a).js"],
      ["p/@\\(a).js", "p/@(a).js"],
      ["p/[@](a).js", "p/@(a).js"],
      ["p/+(a.js", "p/+(a.js"],
      ["p/{+(a,b}.js", "p/+(a.js"],
      ["p/{+(a,b}).js", "p/+(a).js"],
      // No sequences, in a group or not
      ["f@({1..3}).js", ""],
    ];
    expect(
      await filesOf(
        expected.map(it => it[0]),
        files,
        "oxlint",
      ),
    ).toEqual(expected);
  },
);

// With an ESLint config these options are minimatch patterns. oxlint 1.87 reports all three imports and both elements.
test.concurrent("extglob patterns in rule options work with an .oxlintrc.json", async () => {
  using dir = tempDir("bun-lint-glob", {
    "a.jsx":
      'import "./a.css";\nimport "./a.scss";\nimport "./a.less";\nexport const a = [<FOO_BAR />, <BAZ_QUX />];\n',
    ".oxlintrc.json": JSON.stringify({
      plugins: ["import", "react"],
      categories: { correctness: "off" },
      rules: {
        "import/no-unassigned-import": ["error", { allow: ["**/*.@(css|scss)"] }],
        "react/jsx-pascal-case": ["error", { ignore: ["+(FOO|_)BAR"] }],
      },
    }),
  });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "unix", "a.jsx"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(
    stdout.split("\n").filter(line => line.startsWith("a.jsx")),
    stderr,
  ).toEqual([
    "a.jsx:3:1: Imported module should be assigned [Error/import(no-unassigned-import)]",
    "a.jsx:4:32: JSX component BAZ_QUX must be in PascalCase [Error/react(jsx-pascal-case)]",
  ]);
  expect(exitCode).toBe(1);
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

// Where `bun lint` joins a directory in front of a pattern, the directory is a path, whatever bytes its name has:
// `[proj]` is no class, `{a,b}` no group and `+(old)` no extglob.

// A debug build takes seconds to lint a project, and more with an ESLint 8 config, with a config file that is a
// program, or with the installed ESLint.
const debugTimeout = isDebug || isASAN ? 60_000 : undefined;

type Files = Record<string, string>;

/**
 * Lints `files` from the directory `cwd`. Returns each report as `file:line rule`, with the file relative to the
 * directory `root`. `files` can be a function of the directory that they are written to.
 */
async function reportedFrom(
  cwd: string,
  files: Files | ((directory: string) => Files),
  args: string[] = [],
  root = ".",
) {
  using dir = tempDir("bun-lint-glob", typeof files === "function" ? {} : files);
  if (typeof files === "function") {
    for (const [path, text] of Object.entries(files(String(dir)))) {
      mkdirSync(dirname(join(String(dir), path)), { recursive: true });
      writeFileSync(join(String(dir), path), text);
    }
  }
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "unix", ...args],
    env,
    cwd: join(String(dir), cwd),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0 && exitCode !== 1) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
  // With an oxlint config the paths are relative to the working directory and a rule is `import(no-cycle)`.
  return [...stdout.matchAll(/^(.+?):(\d+):\d+: .* \[\w+\/(.+)\]\r?$/gm)]
    .map(([, path, line, rule]) => {
      const absolute = isAbsolute(path) ? path : join(String(dir), cwd, path);
      const file = relative(join(String(dir), root), absolute).replaceAll("\\", "/");
      return `${file}:${line} ${rule.replace(/^(\w+)\((.+)\)$/, "$1/$2")}`;
    })
    .sort();
}

/** The same for a project that is in a directory named `name`, from its subdirectory `cwd`. */
function reportedIn(name: string, files: Files, args: string[] = [], cwd = ".") {
  const inside = Object.fromEntries(Object.entries(files).map(([path, text]) => [`${name}/${path}`, text]));
  return reportedFrom(join(name, cwd), inside, args, name);
}

// `bun lint --run-path-tests` is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

test.skipIf(!hasRunner)("what is joined to a directory is split where the directory ends in it", async () => {
  // The directory, what is joined to it, and the two parts of the result: what is left of the directory, which is no
  // pattern, and the rest.
  const rows = [
    ["/t/[p]", "src/**", "/t/[p]", "/src/**"],
    ["/t/[p]", "./src/../lib/*.js", "/t/[p]", "/lib/*.js"],
    ["/t/[p]", ".", "/t/[p]", ""],
    // A `..` leaves the directory.
    ["/t/[p]/app", "../lib/*.js", "/t/[p]", "/lib/*.js"],
    ["/t/[p]/app", "src/../../lib/*.js", "/t/[p]", "/lib/*.js"],
    ["/t/[p]", "../../../x/*.js", "", "/x/*.js"],
    // What comes back into the directory by its name is written, so it is a pattern.
    ["/t/[p]/app", "../../[p]/app/*.js", "/t", "/[p]/app/*.js"],
    // A root has no name.
    ["/", "src/*.js", "", "/src/*.js"],
    ["/t", "../src/*.js", "", "/src/*.js"],
  ];
  // `path.resolve`, `path.join`, and the join of a tsconfig.json entry. Only the last takes a `\` for a separator in a
  // POSIX path, and the checker writes a drive as `/C:`.
  const joins = {
    split_resolved: [...rows, ["/t/[p]", "..\\lib/*.js", "/t/[p]", "/..\\lib/*.js"]],
    split_joined: [...rows, ["/t/[p]", "/t/[p]/src/**", "/t/[p]", "/t/[p]/src/**"]],
    split_included: [
      ...rows,
      ["/t/[p]/app", "..\\lib/*.js", "/t/[p]", "/lib/*.js"],
      ["/C:/r/[p]/app", "..\\lib/*.js", "/C:/r/[p]", "/lib/*.js"],
      // An absolute entry is a pattern, unless it goes through the directory.
      ["/t/[p]/app", "/t/[p]/lib/*.js", "", "/t/[p]/lib/*.js"],
      ["/t/[p]", "/t/[p]/src/**", "/t/[p]", "/src/**"],
    ],
  };
  const windows = {
    split_resolved: [
      ["C:/r/[p]", "src\\**", "C:/r/[p]", "/src/**"],
      ["C:/r/[p]/app", "..\\lib/*.js", "C:/r/[p]", "/lib/*.js"],
      ["C:/r", "../src/*.js", "", "C:/src/*.js"],
      ["//server/share/[p]", "src/**", "//server/share/[p]", "/src/**"],
      ["//server/share/[p]", "../x/**", "", "//server/share/x/**"],
    ],
  };
  // Not in a directory whose `package.json` has a `lint` script.
  using dir = tempDir("bun-lint-glob", {});
  const run = async (style: string, table: Record<string, string[][]>) => {
    const calls = Object.entries(table).flatMap(([join, rows]) => rows.flatMap(row => [join, row[0], row[1]]));
    await using proc = spawn({
      cmd: [bunExe(), "lint", "--run-path-tests", style, ...calls],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { lines: stdout.split(/\r?\n/).slice(0, -1), stderr, exitCode };
  };
  const expected = (table: Record<string, string[][]>) => ({
    lines: Object.values(table).flatMap(rows => rows.map(([, , directory, rest]) => `${directory} + ${rest}`)),
    stderr: "",
    exitCode: 0,
  });
  expect(await run("posix", joins)).toEqual(expected(joins));
  expect(await run("windows", windows)).toEqual(expected(windows));
});

const oxlintrc = {
  ".oxlintrc.json": JSON.stringify({
    plugins: ["import"],
    categories: { correctness: "off" },
    rules: { "import/no-cycle": "error" },
  }),
};
const paths = { compilerOptions: { paths: { "@/*": ["./src/*"] } } };
// `a` imports `other` and `c`, and both import `a`. A cycle is only found where the tsconfig.json applies to both of
// its files, because only then `@/` means `src/`.
const cycles = (other: string) => ({
  ...oxlintrc,
  "src/a.ts": `import { b } from "@/${other}";\nimport { c } from "@/c";\nexport const a = [b, c];\n`,
  [`src/${other}.ts`]: `import { a } from "@/a";\nexport const b = a;\n`,
  "src/c.ts": `import { a } from "@/a";\nexport const c = a;\n`,
});
const cycleOfOther = (other: string) => [`src/${other}.ts:1`, "src/a.ts:1"];
const cycleOfC = ["src/a.ts:2", "src/c.ts:1"];

// The expected reports are those of oxlint 1.89. Its resolver compares the directory of a tsconfig.json as a path
// where no `include` pattern is joined to it, and it compares an entry with the file before it reads the entry as a
// pattern. So an entry that names a file applies to it, also if the name or a directory above has a `[` or a `{`.
// With `include: ["src"]` oxlint applies nothing in a directory named `[proj]`, and neither does `bun lint`.
test.concurrent.each([
  ["[proj]", "b", {}, [...cycleOfC, ...cycleOfOther("b")]],
  ["{a,b}", "b", { include: ["src/a.ts", "src/b.ts", "src/c.ts"] }, [...cycleOfC, ...cycleOfOther("b")]],
  ["[proj]", "b", { exclude: ["src/b.ts"] }, cycleOfC],
  ["[proj]", "b", { include: ["src"] }, []],
  ["proj", "[id]", { include: ["src/a.ts", "src/[id].ts", "src/c.ts"] }, [...cycleOfC, ...cycleOfOther("[id]")]],
  ["proj", "[id]", { exclude: ["src/[id].ts"] }, cycleOfC],
])(
  "with an .oxlintrc.json in a directory named %s and a file %s.ts, a tsconfig.json with %j",
  async (name, other, scope, expected) => {
    const files = { ...cycles(other), "tsconfig.json": JSON.stringify({ ...paths, ...scope }) };
    expect(await reportedIn(name, files)).toEqual(expected.map(it => `${it} import/no-cycle`).sort());
  },
  debugTimeout,
);

// A config that `--tsconfig` names, with a project that it references and that has no `include`.
test.concurrent.each(["[proj]", "{a,b}"])(
  "with an .oxlintrc.json, a referenced project without `include` applies in a directory named %s",
  async name => {
    const { "src/c.ts": _, ...files } = cycles("b");
    const configs = {
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      "tsconfig.app.json": JSON.stringify(paths),
      "src/a.ts": `import { b } from "@/b";\nexport const a = b;\n`,
    };
    expect(await reportedIn(name, { ...files, ...configs }, ["--tsconfig", "tsconfig.json"])).toEqual(
      cycleOfOther("b")
        .map(it => `${it} import/no-cycle`)
        .sort(),
    );
  },
  debugTimeout,
);

/** The reports with `settings["import/resolver"].typescript.project` set to `projects`. */
function reportedWithProjects(name: string, projects: string[], rule: string, files: Files) {
  const settings = `"import/resolver" = { typescript = { project = ${JSON.stringify(projects)} } }`;
  return reportedIn(name, {
    "package.json": `{ "name": "p", "type": "module" }`,
    "bunfig.toml": `[lint.rules]\n"${rule}" = "error"\n[lint.settings]\n${settings}\n`,
    ...files,
  });
}
const aliasedTo = (directory: string) => ({ compilerOptions: { paths: { "@/*": [`./${directory}/*`] } } });
const exporting = (name: string) => `export const only${name} = 1;\n`;
const importing = (name: string) => `import { only${name} } from "@/y";\nexport default only${name};\n`;

// `bun lint` uses the closest `project` whose `include` has the file, alone. eslint-import-resolver-typescript 4.4.5
// does that once the project has resolved an import, and these are its reports. It reads the directory of a
// tsconfig.json as a path. Like TypeScript, it takes a last name with a `.` for a file, so in `my.app` the entry `.`
// includes nothing, and the paths of the other project apply.
test.concurrent.each([
  ["[proj]", ["b"], "b/u.ts"],
  ["{a,b}", ["b"], "b/u.ts"],
  ["[proj]", ["."], "b/u.ts"],
  ["proj", ["."], "b/u.ts"],
  ["my.app", ["b"], "b/u.ts"],
  ["my.app", ["."], "b/t.ts"],
])(
  "settings[import/resolver].typescript in a directory named %s, with `include` %j in the second project",
  async (name, include, reported) => {
    const files = {
      "tsconfig.a.json": JSON.stringify({ ...aliasedTo("a"), include: ["a"] }),
      "tsconfig.b.json": JSON.stringify({ ...aliasedTo("b"), include }),
      "a/y.ts": exporting("A"),
      "b/y.ts": exporting("B"),
      "b/t.ts": importing("B"),
      "b/u.ts": importing("A"),
    };
    const projects = ["tsconfig.a.json", "tsconfig.b.json"];
    expect(await reportedWithProjects(name, projects, "import/named", files)).toEqual([`${reported}:1 import/named`]);
  },
  debugTimeout,
);

// An entry of the second project leaves its directory, or is excluded there. These are the reports of ESLint 9.39.5
// with the resolver in every directory.
const shared = {
  "tsconfig.a.json": JSON.stringify({ ...aliasedTo("a"), include: ["a"] }),
  "a/y.ts": exporting("A"),
  "app/src/y.ts": exporting("App"),
  "shared/t.ts": importing("App"),
  "shared/u.ts": importing("A"),
};
test.concurrent.each([
  ["[ws]", ["src", "../shared"]],
  ["{a,b}", ["${configDir}/src", "${configDir}/../shared"]],
  ["[ws]", ["src", "..\\shared"]],
])(
  "settings[import/resolver].typescript in a directory named %s, with `include` %j in a project below it",
  async (name, include) => {
    const files = { ...shared, "app/tsconfig.json": JSON.stringify({ ...aliasedTo("src"), include }) };
    const projects = ["tsconfig.a.json", "app/tsconfig.json"];
    expect(await reportedWithProjects(name, projects, "import/named", files)).toEqual(["shared/u.ts:1 import/named"]);
  },
  debugTimeout,
);

test.concurrent(
  "settings[import/resolver].typescript in a directory named {a,b}, with an `exclude` in the first project",
  async () => {
    const files = {
      "tsconfig.b.json": JSON.stringify({ ...aliasedTo("b"), include: ["b"], exclude: ["b/gen"] }),
      "tsconfig.a.json": JSON.stringify({ ...aliasedTo("a"), include: ["a", "b/gen"] }),
      "a/y.ts": exporting("A"),
      "b/y.ts": exporting("B"),
      "b/gen/t.ts": importing("A"),
      "b/gen/u.ts": importing("B"),
    };
    const projects = ["tsconfig.b.json", "tsconfig.a.json"];
    expect(await reportedWithProjects("{a,b}", projects, "import/named", files)).toEqual(["b/gen/u.ts:1 import/named"]);
  },
  debugTimeout,
);

// Both projects include b/t.ts. `bun lint` uses the first one alone, in a directory of any name. The resolver goes on
// to the second one until the first one has resolved an import. So it reports the same if `./y` comes first, and
// nothing if `@b/y` does.
test.concurrent.each([
  [`import "./y";\nimport "@b/y";\n`, "b/t.ts:2 import/no-unresolved"],
  [`import "@b/y";\n`, "b/t.ts:1 import/no-unresolved"],
])(
  "settings[import/resolver].typescript in a directory named [ws], with two projects for a file that has %j",
  async (code, reported) => {
    const files = {
      "tsconfig.a.json": JSON.stringify({ compilerOptions: { paths: { "@a/*": ["./a/*"] } }, include: ["a", "b"] }),
      "tsconfig.b.json": JSON.stringify({ compilerOptions: { paths: { "@b/*": ["./b/*"] } }, include: ["b"] }),
      "b/y.ts": exporting("B"),
      "b/t.ts": code,
    };
    const projects = ["tsconfig.a.json", "tsconfig.b.json"];
    expect(await reportedWithProjects("[ws]", projects, "import/no-unresolved", files)).toEqual([reported]);
  },
  debugTimeout,
);

// No project includes b/. `bun lint` then tries each one, in a directory of any name. The resolver does that in a
// directory named `ws`. In one named `[ws]` it takes the path of each project for a pattern, and resolves nothing.
test.concurrent(
  "settings[import/resolver].typescript in a directory named [ws], for a file that no project includes",
  async () => {
    const files = {
      "tsconfig.a.json": JSON.stringify({ ...aliasedTo("a"), include: ["a"] }),
      "tsconfig.b.json": JSON.stringify({ ...aliasedTo("b"), include: ["c"] }),
      "a/y.ts": exporting("A"),
      "b/t.ts": importing("A"),
      "b/u.ts": importing("B"),
    };
    const projects = ["tsconfig.a.json", "tsconfig.b.json"];
    expect(await reportedWithProjects("[ws]", projects, "import/named", files)).toEqual(["b/u.ts:1 import/named"]);
  },
  debugTimeout,
);

// `--ignore-pattern` is relative to the working directory and `ignorePatterns` to bunfig.toml. ESLint passes the
// directory of its own patterns as their `basePath` since 9.30, and `bun lint` does the same for it. An older ESLint
// refuses the key. It writes the directory in front of each pattern, and so does `bun lint` for it.
describe("ignore patterns for the installed ESLint, from another directory than the config file's", () => {
  // A stand-in for the `eslint` package that ignores like ESLint's config array. The last pattern that matches decides.
  // An object with a `basePath` is for what is below that directory. Nothing below an ignored directory is linted.
  const eslintAt = (version: string) => ({
    "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version, main: "index.js" }),
    "node_modules/eslint/lib/config/flat-config-array.js": `
      const path = require("node:path");
      const [major, minor] = ${JSON.stringify(version)}.split(".").map(Number);
      exports.FlatConfigArray = class {
        #configs = [];
        constructor(configs, { basePath }) {
          this.basePath = basePath;
          this.push(...configs);
        }
        push(...configs) {
          this.#configs.push(...configs);
        }
        normalize() {
          const knowsBasePath = major > 9 || (major === 9 && minor >= 30);
          if (!knowsBasePath && this.#configs.some(it => "basePath" in it)) throw new Error('Unexpected key "basePath" found.');
        }
        #isIgnored(target, slash) {
          let isIgnored = false;
          for (const { basePath = this.basePath, ignores = [], ...rest } of this.#configs) {
            if (Object.keys(rest).length > 0) continue;
            const relative = path.relative(basePath, target).replaceAll("\\\\", "/");
            if (relative === "" || relative === ".." || relative.startsWith("../")) continue;
            for (const it of ignores) {
              const isNegated = it.startsWith("!");
              if (new Bun.Glob(isNegated ? it.slice(1) : it).match(relative + slash)) isIgnored = !isNegated;
            }
          }
          return isIgnored;
        }
        getConfig(file) {
          for (let directory = path.dirname(file); directory !== this.basePath; directory = path.dirname(directory)) {
            if (this.#isIgnored(directory, "/")) return undefined;
          }
          return this.#isIgnored(file, "") ? undefined : { hasBasePath: this.#configs.some(it => "basePath" in it) };
        }
      };`,
    "node_modules/eslint/index.js": `
      exports.Linter = class {
        static version = ${JSON.stringify(version)};
        verify(text, configs, { filename }) {
          const config = configs.getConfig(filename);
          const message = config === undefined ? "ignored" : config.hasBasePath ? "linted, with a basePath" : "linted";
          return [{ ruleId: null, severity: 1, message, line: 1, column: 1 }];
        }
        getSuppressedMessages() {
          return [];
        }
      };`,
  });
  // The parser is an inline object, so the .vue files go to the installed ESLint with the whole config file.
  const config = `
    const parser = { meta: { name: "vue-eslint-parser" }, parseForESLint() {} };
    export default [{ ignores: ["**/dist/**/*"] }, { files: ["**/*.vue"], languageOptions: { parser } }];`;

  /**
   * Lints the directory `pkg` or `name` from `cwd`, with the config file in the directory `config`. Returns what the
   * installed ESLint says about each file that `bun lint` sends to it.
   */
  async function sent(version: string, args: string[], { name = "pkg", config: at = ".", cwd = name, more = {} } = {}) {
    using dir = tempDir("bun-lint-glob", {
      ...eslintAt(version),
      [join(at, "eslint.config.mjs")]: config,
      ...Object.fromEntries(
        ["keep", "dist/keep", "dist/x", "src/y"].map(it => [`${name}/${it}.vue`, "<template />\n"]),
      ),
      ...more,
    });
    await using proc = spawn({
      cmd: [bunExe(), "lint", "-f", "json", ...args, relative(cwd, name) || "."],
      env,
      cwd: join(String(dir), cwd),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (!stdout.startsWith("[")) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
    const results: { filePath: string; messages: { message: string }[] }[] = JSON.parse(stdout);
    // The stand-in has a message for each file. `bun lint` has none for the config file, which it lints itself.
    return Object.fromEntries(
      results
        .filter(it => it.messages.length > 0)
        .map(it => [
          relative(join(String(dir), name), it.filePath).replaceAll("\\", "/"),
          it.messages.map(message => message.message).join(),
        ]),
    );
  }
  const all = (message: string) => ({ "keep.vue": message, "dist/keep.vue": message, "src/y.vue": message });
  const ignorePatterns = (patterns: string[]) => `[lint]\nignorePatterns = ${JSON.stringify(patterns)}\n`;

  test.concurrent.each([
    ["9.30.0", "pkg"],
    ["9.30.0", "[pkg]"],
    ["10.0.0", "c++(old)"],
  ])(
    "with ESLint %s, --ignore-pattern lets a file in from a directory named %s",
    async (version, name) => {
      expect(await sent(version, ["--ignore-pattern", "!dist/keep.vue"], { name })).toEqual(
        all("linted, with a basePath"),
      );
    },
    debugTimeout,
  );

  // Written in front of `**`, the directory itself is ignored, and then no pattern lets a file in it in.
  test.concurrent.each([
    ["--ignore-pattern", () => sent("9.30.0", ["--ignore-pattern", "**", "--ignore-pattern", "!keep.vue"])],
    ["bunfig.toml", () => sent("10.0.0", [], { more: { "pkg/bunfig.toml": ignorePatterns(["**", "!keep.vue"]) } })],
  ])(
    "with ESLint 9.30 or later, %s lets a file in after `**`",
    async (_, run) => {
      expect(await run()).toEqual({ "keep.vue": "linted, with a basePath" });
    },
    debugTimeout,
  );

  // The patterns belong to a directory above the config file.
  test.concurrent.each([
    ["--ignore-pattern", () => sent("9.30.0", ["--ignore-pattern", "!*/dist/keep.vue"], { config: "pkg", cwd: "." })],
    [
      "bunfig.toml",
      () =>
        sent("9.30.0", [], { config: "pkg", cwd: ".", more: { "bunfig.toml": ignorePatterns(["!*/dist/keep.vue"]) } }),
    ],
  ])(
    "with ESLint 9.30 or later, %s lets a file in from above the config file",
    async (_, run) => {
      expect(await run()).toEqual(all("linted, with a basePath"));
    },
    debugTimeout,
  );

  test.concurrent(
    "from the directory of the config file, ESLint gets the patterns without a `basePath`",
    async () => {
      expect(await sent("10.0.0", ["--ignore-pattern", "!pkg/dist/keep.vue"], { cwd: "." })).toEqual(all("linted"));
    },
    debugTimeout,
  );

  test.concurrent.each(["9.29.0", "8.57.1"])(
    "ESLint %s gets no `basePath`",
    async version => {
      expect(await sent(version, ["--ignore-pattern", "!dist/keep.vue"])).toEqual(all("linted"));
      // There `[pkg]` is a class in each pattern, so what ESLint gets does not let dist/keep.vue in.
      expect(await sent(version, ["--ignore-pattern", "!dist/keep.vue"], { name: "[pkg]" })).toMatchObject({
        "src/y.vue": "linted",
      });
    },
    debugTimeout,
  );
});

// The import rules join the working directory in front of their patterns. Without an ESLint or oxlint config, no rule
// has to match eslint-plugin-import, and the working directory is a path. On POSIX a name can also have a `|` or a `*`.
const oddNames = ["[proj]", "{a,b}", "c++(old)", "app@(v2)", ...(isWindows ? [] : ["a(b|c)", "s*"])];
// A class, an extglob group, and a name that only is-glob takes for a pattern.
const someOddNames = ["[proj]", "c++(old)", ...(isWindows ? [] : ["a(b|c)"])];

const devDependency = {
  "package.json": JSON.stringify({ name: "p", type: "module", devDependencies: { dev: "1.0.0" } }),
  "node_modules/dev/package.json": JSON.stringify({ name: "dev", version: "1.0.0", main: "index.js" }),
  "node_modules/dev/index.js": "module.exports = 1;\n",
};
// Every option that the import rules join to the working directory: a path and a glob as `target` and as `from`, and
// the globs of the two other rules.
const zonedOptions = {
  "import/no-restricted-paths": {
    zones: [
      { target: "./src/client", from: "./src/server" },
      { target: "./src/pages/**", from: "./src/db/**", except: ["**/types.js"] },
    ],
  },
  "import/no-extraneous-dependencies": { devDependencies: ["test/**"] },
  "import/no-unassigned-import": { allow: ["src/client/*.css"] },
};
const zonedFiles = {
  ...devDependency,
  "src/server/db.js": "export function query() {}\n",
  "src/client/style.css": "a {}\n",
  "src/client/other.scss": "a {}\n",
  "src/client/app.js": `import "./style.css";\nimport "./other.scss";\nimport { query } from "../server/db.js";\nimport dev from "dev";\nquery(dev);\n`,
  "src/db/q.js": "export const q = 1;\n",
  "src/db/types.js": "export const T = 1;\n",
  "src/pages/p.js": `import { q } from "../db/q.js";\nimport { T } from "../db/types.js";\nexport const p = [q, T];\n`,
  "test/a.test.js": `import dev from "dev";\nexport default dev;\n`,
};
// A JSON object is an inline table.
const toml = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(toml).join(", ")}]`
    : typeof value === "object" && value !== null
      ? `{ ${Object.entries(value)
          .map(([key, it]) => `${key} = ${toml(it)}`)
          .join(", ")} }`
      : JSON.stringify(value);
const zonedProject = {
  ...zonedFiles,
  "bunfig.toml": `[lint.rules]\n${Object.entries(zonedOptions)
    .map(([rule, options]) => `"${rule}" = ["error", ${toml(options)}]\n`)
    .join("")}`,
};
const zonedReports = [
  "src/client/app.js:2 import/no-unassigned-import",
  "src/client/app.js:3 import/no-restricted-paths",
  "src/client/app.js:4 import/no-extraneous-dependencies",
  "src/pages/p.js:1 import/no-restricted-paths",
];

test.concurrent.each(["proj", ...oddNames])(
  "the import rules report the same in a working directory named %s",
  async name => {
    expect(await reportedIn(name, zonedProject)).toEqual(zonedReports);
  },
  debugTimeout,
);

// There the globs get a `../` in front, and so does the `basePath` of the zones. From `test` no zone is below the
// working directory.
test.concurrent.each([...someOddNames.map(name => [name, "src"]), ["[proj]", "test"]])(
  "the import rules report the same in a directory named %s, from its directory %s",
  async (name, cwd) => {
    expect(await reportedIn(name, zonedProject, [".."], cwd)).toEqual(zonedReports);
  },
  debugTimeout,
);

const importingQuery = (path: string) => `import { query } from "${path}";\nquery();\n`;

test.concurrent.each(someOddNames)(
  "import/no-restricted-paths: a zone next to the working directory, below a directory named %s",
  async name => {
    const files = {
      "app/src/server/db.js": "export function query() {}\n",
      "app/bunfig.toml": `[lint.rules]\n"import/no-restricted-paths" = ["error", { zones = [{ target = "../lib/src", from = "./src/server" }] }]\n`,
      "lib/src/x.js": importingQuery("../../app/src/server/db.js"),
    };
    expect(await reportedIn(name, files, [".", "../lib"], "app")).toEqual([
      "lib/src/x.js:1 import/no-restricted-paths",
    ]);
  },
  debugTimeout,
);

// The `..` is in `basePath`, and what the zones say follows it.
test.concurrent.each(["ws", ...someOddNames])(
  "import/no-restricted-paths: a `basePath` next to the working directory, below a directory named %s",
  async name => {
    const zones = [
      `{ target = "./src/client", from = "./src/server" }`,
      `{ target = "./src/client/**", from = "./src/server/**" }`,
    ];
    const files = {
      "app/bunfig.toml": `[lint.rules]\n"import/no-restricted-paths" = ["error", { basePath = "../lib", zones = [${zones.join(", ")}] }]\n`,
      "lib/src/server/db.js": "export function query() {}\n",
      "lib/src/client/c.js": importingQuery("../server/db.js"),
    };
    const reported = "lib/src/client/c.js:1 import/no-restricted-paths";
    expect(await reportedIn(name, files, ["../lib"], "app")).toEqual([reported, reported]);
  },
  debugTimeout,
);

// With an ESLint config the rules are those of the plugin, which compiles the working directory with each pattern.
// These are the reports of ESLint 9.39.5 and 10.13.0 with eslint-plugin-import 2.32.0 for this project.
test.concurrent(
  "with an ESLint config, the import rules report what eslint-plugin-import reports in a directory named [proj]",
  async () => {
    const rule = `{ meta: { schema: false }, create() { return {}; } }`;
    const rules = Object.entries(zonedOptions).map(([id, options]) => [id, ["error", options]]);
    const files = {
      ...zonedFiles,
      "package.json": JSON.stringify({
        name: "p",
        type: "module",
        dependencies: { "eslint-plugin-import": "2.32.0" },
        devDependencies: { dev: "1.0.0" },
      }),
      "node_modules/eslint-plugin-import/package.json": JSON.stringify({
        name: "eslint-plugin-import",
        version: "2.32.0",
        main: "index.js",
      }),
      "node_modules/eslint-plugin-import/index.js": `module.exports = { meta: { name: "eslint-plugin-import" }, rules: { ${Object.keys(
        zonedOptions,
      )
        .map(id => `"${id.slice("import/".length)}": ${rule}`)
        .join(", ")} } };\n`,
      "eslint.config.mjs": `import plugin from "eslint-plugin-import";\nexport default [{ plugins: { import: plugin }, rules: ${JSON.stringify(
        Object.fromEntries(rules),
      )} }];\n`,
    };
    expect(await reportedIn("[proj]", files)).toEqual([
      "src/client/app.js:1 import/no-unassigned-import",
      "src/client/app.js:2 import/no-unassigned-import",
      "src/client/app.js:4 import/no-extraneous-dependencies",
      "test/a.test.js:1 import/no-extraneous-dependencies",
    ]);
  },
  debugTimeout,
);

// One rule, with the same options, is for the files of both kinds in a run. In a directory named `[proj]`, ESLint
// 8.57.1 with eslint-plugin-import 2.32.0 reports no zone in the package, and both globs match no file there.
test.concurrent.each(["proj", "[proj]"])(
  "in a directory named %s, a package with an ESLint config gets the reports of eslint-plugin-import",
  async name => {
    const roots = ["", "pkg/"];
    const zones = roots.map(it => `{ target = "./${it}src/client", from = "./${it}src/server" }`);
    const globs = (below: string) => roots.map(it => JSON.stringify(`${it}${below}`)).join(", ");
    const files = {
      ...devDependency,
      "bunfig.toml": `[lint.rules]
"import/no-restricted-paths" = ["error", { zones = [${zones.join(", ")}] }]
"import/no-extraneous-dependencies" = ["error", { devDependencies = [${globs("test/**")}] }]
"import/no-unassigned-import" = ["error", { allow = [${globs("src/client/*.css")}] }]
`,
      "pkg/.eslintrc.json": JSON.stringify({
        root: true,
        parserOptions: { ecmaVersion: 2022, sourceType: "module" },
        plugins: ["import"],
      }),
      ...Object.fromEntries(
        roots.flatMap(it => [
          [`${it}src/server/db.js`, "export function query() {}\n"],
          [`${it}src/client/style.css`, "a {}\n"],
          [`${it}src/client/c.js`, `import "./style.css";\n${importingQuery("../server/db.js")}`],
          [`${it}test/a.test.js`, `import dev from "dev";\nexport default dev;\n`],
        ]),
      ),
    };
    const inPackage =
      name === "proj"
        ? ["pkg/src/client/c.js:2 import/no-restricted-paths"]
        : [
            "pkg/src/client/c.js:1 import/no-unassigned-import",
            "pkg/test/a.test.js:1 import/no-extraneous-dependencies",
          ];
    expect(await reportedIn(name, files)).toEqual([...inPackage, "src/client/c.js:2 import/no-restricted-paths"]);
  },
  debugTimeout,
);

// Only the directory that `bun lint` joins is a path. What the options say is a pattern, `basePath` too.
test.concurrent(
  "import/no-restricted-paths: a `basePath` with a wildcard is a pattern",
  async () => {
    const files = {
      "bunfig.toml": `[lint.rules]\n"import/no-restricted-paths" = ["error", { basePath = "./packages/*", zones = [{ target = "./src/client/**", from = "./src/server/**" }] }]\n`,
      "packages/one/src/server/db.js": "export function query() {}\n",
      "packages/one/src/client/c.js": importingQuery("../server/db.js"),
    };
    expect(await reportedIn("proj", files)).toEqual(["packages/one/src/client/c.js:1 import/no-restricted-paths"]);
  },
  debugTimeout,
);

// An absolute path in the options is a pattern as a whole, also where it goes through the working directory.
test.concurrent.each([
  ["proj", ["src/client/c.js:1 import/no-restricted-paths"]],
  ["[proj]", []],
])(
  "import/no-restricted-paths: an absolute `target` in a directory named %s",
  async (name, expected) => {
    const files = (directory: string) => ({
      [`${name}/bunfig.toml`]: `[lint.rules]\n"import/no-restricted-paths" = ["error", { zones = [{ target = ${JSON.stringify(
        join(directory, name, "src/client").replaceAll("\\", "/"),
      )}, from = "./src/server" }] }]\n`,
      [`${name}/src/server/db.js`]: "export function query() {}\n",
      [`${name}/src/client/c.js`]: importingQuery("../server/db.js"),
    });
    expect(await reportedFrom(name, files, [], name)).toEqual(expected);
  },
  debugTimeout,
);

// So a folder that the options name reads the same from every directory, also from inside that folder.
test.concurrent.each([".", "app", "app/[locale]", "app/[locale]/client"])(
  "the import rules read a folder that bunfig.toml names as a pattern, from the directory %s",
  async cwd => {
    const files = {
      ...devDependency,
      "bunfig.toml": `[lint.rules]
"import/no-restricted-paths" = ["error", { zones = [{ target = "./app/[locale]/client", from = "./app/[locale]/server" }] }]
"import/no-extraneous-dependencies" = ["error", { devDependencies = ["app/[locale]/test/**"] }]
"import/no-unassigned-import" = ["error", { allow = ["app/[locale]/client/*.css"] }]
`,
      "app/[locale]/server/db.js": "export function query() {}\n",
      "app/[locale]/client/style.css": "a {}\n",
      "app/[locale]/client/c.js": `import "./style.css";\nimport { query } from "../server/db.js";\nquery();\n`,
      "app/[locale]/test/a.test.js": `import dev from "dev";\nexport default dev;\n`,
    };
    expect(await reportedFrom(cwd, files, [relative(cwd, "app/[locale]") || "."])).toEqual([
      "app/[locale]/client/c.js:1 import/no-unassigned-import",
      "app/[locale]/test/a.test.js:1 import/no-extraneous-dependencies",
    ]);
  },
  debugTimeout,
);
