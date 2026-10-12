import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { relative } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined };

// Each of these rules reports this code once, so that one run tells which of 16 patterns are for which files.
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

/** The files that each of `patterns` is for, as `files` of an object of an `eslint.config.mjs`. */
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

// What ESLint 10.12 lints with each.
test.concurrent("?( ), *( ), +( ), @( ) and !( ) in `files`", async () => {
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
    // In each other, and with braces.
    ["src/@(a|{b,c}).js", "src/a.js src/b.js src/c.js"],
    [
      "**/+(a|*(b)c).js",
      "a.js app/(group)/a.js app/group/a.js lib/a.js lib/x/a.js src/a.js src/abc.js src/bbc.js src/c.js src/x/a.js",
    ],
    // Parentheses alone are characters.
    ["app/(group)/*.js", "app/(group)/a.js"],
    [
      "**/*.{js,?(m)ts}",
      [...js.split(" "), "a.mts", "a.test.ts", "a.ts", "src/a.test.ts", "src/x/y.ts"].sort().join(" "),
    ],
    // A `**` at the end of an alternative that ends the pattern.
    [
      "{lib/*.js,src/**}",
      all
        .split(" ")
        .filter(it => it === "lib/a.js" || it.startsWith("src/"))
        .join(" "),
    ],
    // Not what starts with `a` or `b`: what follows the group counts.
    ["src/!(a|b)*.js", "src/.js src/c.js"],
    // To ESLint a `!` at the start negates the pattern, whatever follows it.
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

test.concurrent("a directory in `ignores`: `a`, `a/`, `a/*`, `a/**`, and what `!` takes back", async () => {
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
  // `all/**` has the directory `all`, which is not read then. `gen/*` does not have `gen`.
  expect(await filesOf(["**/*.js"], files, [{ ignores }])).toEqual([["**/*.js", "a.js gen/keep/a.js"]]);
});

test.concurrent("many groups, and groups in groups, take no time to speak of", async () => {
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

// eslint-plugin-import asks minimatch without `dot`.
test.concurrent("for the rules of import no `*` and no `**` takes the dot that a name starts with", async () => {
  const code = 'import "./a.css";\nimport "./a.less";\nimport "./a.scss";\n';
  const styles = { "a.css": "", "a.less": "", "a.scss": "" };
  const inside = (directory: string) =>
    Object.fromEntries(
      Object.entries({ "a.js": code, ...styles }).map(([name, text]) => [`${directory}/${name}`, text]),
    );
  using dir = tempDir("bun-lint-glob", {
    // `{**,}/` is `**/` or `/`.
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

/** `file:line` of what is reported in a project with these files. */
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

test.concurrent("import/no-extraneous-dependencies: `**/*.test.js` is not for a file in .storybook", async () => {
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
])("import/order: patternOptions.dot of a path group%s", async (options, expected) => {
  const group = `{ pattern = "~/**", group = "builtin", position = "before"${options} }`;
  const files = {
    "bunfig.toml": `[lint.rules]\n"import/order" = ["error", { pathGroups = [${group}], pathGroupsExcludedImportTypes = [] }]\n`,
    "a.js": 'import fs from "fs";\nimport a from "~/.hidden/a";\nexport default [fs, a];\n',
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
    // Not from one number to another, nor from one letter to another.
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

test.concurrent.each(["*[\\", "*[a\\", "[a-\\", "[\\", "{[\\}", "@([\\)", "\\", "[", "{", "@(", "{1..", "[!", "[^\\"])(
  "a pattern that ends in the middle of something matches nothing: %s",
  async pattern => {
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
  },
);
