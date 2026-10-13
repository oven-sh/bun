import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined };
const ugly = "if (a) {\nb( 1 )\n}\n";

async function format(files: Record<string, string>, args: string[], stdin?: string) {
  using dir = tempDir("bun-format-glob", files);
  await using proc = spawn({
    cmd: [bunExe(), "fmt", ...args],
    env,
    cwd: String(dir),
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const names = [
  "a.js",
  "a.cjs",
  "a.mjs",
  "a.ts",
  "src/a.js",
  "src/b.ts",
  "src/x/d.js",
  "src/x/e.tsx",
  "lib/f.js",
  "lib/deep/g.js",
  "lib/deep/h.min.js",
  "sub/i.js",
];
const project = { ...Object.fromEntries(names.map(name => [name, ugly])), ".prettierrc.json": "{}" };

// The expected files come from Prettier 3.9.
test.concurrent.each([
  ["src/**/*.@(js|ts)", "src/a.js src/b.ts src/x/d.js"],
  ["{a,src/x/*}.?(c)js", "a.cjs a.js src/x/d.js"],
  ["lib/!(deep)*.js", "lib/f.js"],
  ["**/+(a|d).js", "a.js src/a.js src/x/d.js"],
  // Prettier also treats parentheses without a prefix as a group.
  ["(src|lib)/*.js", "lib/f.js src/a.js"],
  // `a/**` also matches `a` itself.
  ["lib/*/**", "lib/deep/g.js lib/deep/h.min.js lib/f.js"],
])("the command line pattern %s lists the same files as Prettier", async (pattern, expected) => {
  const { stdout, exitCode } = await format(project, ["-l", pattern]);
  expect(stdout.trim().split("\n").sort().join(" ")).toBe(expected);
  expect(exitCode).toBe(1);
});

test.concurrent("extglob patterns work in `files` and `excludeFiles` of Prettier overrides", async () => {
  const overrides = [
    { files: "*.?(c|m)js", options: { semi: false } },
    { files: "src/**/*.@(ts|tsx)", options: { tabWidth: 8 } },
    { files: "lib/!(deep)/**", options: { tabWidth: 1 } },
    { files: ["lib/+(deep|x)/*.js"], excludeFiles: "**/*.min.js", options: { useTabs: true } },
  ];
  const files = { ".prettierrc.json": JSON.stringify({ overrides }) };
  const second = async (name: string) => (await format(files, ["--stdin-filepath", name], ugly)).stdout.split("\n")[1];
  expect(Object.fromEntries(await Promise.all(names.map(async name => [name, await second(name)])))).toEqual({
    "a.js": "  b(1)",
    "a.cjs": "  b(1)",
    "a.mjs": "  b(1)",
    "a.ts": "  b(1);",
    "src/a.js": "  b(1)",
    "src/b.ts": "        b(1);",
    "src/x/d.js": "  b(1)",
    "src/x/e.tsx": "        b(1);",
    "lib/f.js": " b(1)",
    "lib/deep/g.js": "\tb(1)",
    "lib/deep/h.min.js": "  b(1)",
    "sub/i.js": "  b(1)",
  });
});

test.concurrent.each([
  // Braces without a comma are literal.
  ["{a.js}", "a.js", "  "],
  ["{a.js,b.js}", "a.js", "    "],
  ["*.{js}", "a.js", "  "],
  // `**` crosses `/` anywhere in the section name.
  ["**.js", "lib/deep/a.js", "    "],
  ["lib/**.js", "lib/deep/a.js", "    "],
  ["lib/**.js", "a.js", "  "],
  ["li**a.js", "lib/deep/a.js", "    "],
  ["li**/a.js", "lib/deep/a.js", "    "],
  ["li**", "lib/deep/a.js", "    "],
  ["lib/*.js", "lib/deep/a.js", "  "],
  // A section without `/` matches in any directory.
  ["a.js", "lib/deep/a.js", "    "],
  ["/a.js", "lib/deep/a.js", "  "],
])(".editorconfig section [%s] with %s behaves like Prettier", async (section, name, indent) => {
  const files = { ".prettierrc.json": "{}", ".editorconfig": `root = true\n[${section}]\nindent_size = 4\n` };
  const { stdout, exitCode } = await format(files, ["--stdin-filepath", name], ugly);
  expect(stdout).toBe(`if (a) {\n${indent}b(1);\n}\n`);
  expect(exitCode).toBe(0);
});

const numbered = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "9",
  "10",
  "11",
  "15",
  "20",
  "01",
  "02",
  "03",
  "001",
  "-1",
  "a",
  "b",
  "c",
  "d",
];

// The expected results come from Prettier 3.9. fast-glob expands `{1..3}` to 1, 2 and 3. micromatch turns it into the class `[1-3]`.
test.concurrent.each([
  ["x{1..3}.js", "1 2 3", "1 2 3"],
  ["x{3..1}.js", "1 2 3", "1 2 3"],
  ["x{01..03}.js", "01 02 03", ""],
  ["x{1..10}.js", "1 10 2 3 4 9", "0 1"],
  ["x{10..20}.js", "10 11 15 20", "0 1 2"],
  ["x{1..9..2}.js", "1 3 9", "1 2 9"],
  ["x{a..c}.js", "a b c", "a b c"],
  ["x{c..a}.js", "a b c", "a b c"],
  ["x{-1..1}.js", "-1 0 1", "1"],
  ["x{a}.js", "", ""],
])("%s behaves like Prettier on the command line and in an override", async (pattern, listed, overridden) => {
  const files = Object.fromEntries(numbered.map(it => [`x${it}.js`, "a( 1 )\n"]));
  const names = (text: string) =>
    text
      .split(" ")
      .filter(Boolean)
      .map(it => `x${it}.js`)
      .sort();
  const { stdout } = await format({ ...files, ".prettierrc.json": "{}" }, ["-l", pattern]);
  expect(stdout.trim().split("\n").filter(Boolean).sort()).toEqual(names(listed));

  const config = { ".prettierrc.json": JSON.stringify({ overrides: [{ files: pattern, options: { semi: false } }] }) };
  const printed = await Promise.all(
    numbered.map(async it => [
      `x${it}.js`,
      (await format(config, ["--stdin-filepath", `x${it}.js`], "a( 1 )\n")).stdout,
    ]),
  );
  expect(
    printed
      .filter(it => it[1] === "a(1)\n")
      .map(it => it[0])
      .sort(),
  ).toEqual(names(overridden));
});

test.concurrent.each([
  ["{1..3}.js", "2.js", "    "],
  ["{1..3}.js", "4.js", "  "],
  ["{1..3}.js", "02.js", "  "],
  ["{01..03}.js", "02.js", "    "],
  ["{-1..1}.js", "-1.js", "    "],
  ["{3..1}.js", "2.js", "    "],
  ["v{1..2}/*.js", "v2/a.js", "    "],
])(".editorconfig number range [%s] with %s behaves like Prettier", async (section, name, indent) => {
  const files = { ".prettierrc.json": "{}", ".editorconfig": `root = true\n[${section}]\nindent_size = 4\n` };
  const { stdout, exitCode } = await format(files, ["--stdin-filepath", name], ugly);
  expect(stdout).toBe(`if (a) {\n${indent}b(1);\n}\n`);
  expect(exitCode).toBe(0);
});

// The expected files come from Prettier 3.9. Its `ignore` package looks for a `/` before it trims the line, so `a/ ` is anchored.
test.concurrent.each([
  ["a/", "z.js"],
  ["a/ ", "sub/a/y.js z.js"],
  ["a ", "z.js"],
])("the .prettierignore line %j ignores the same files as Prettier", async (line, expected) => {
  const files = {
    "a/x.js": ugly,
    "sub/a/y.js": ugly,
    "z.js": ugly,
    ".prettierrc.json": "{}\n",
    ".prettierignore": `${line}\n`,
  };
  const { stdout, exitCode } = await format(files, ["-l", "."]);
  expect(stdout.trim().split("\n").sort().join(" ")).toBe(expected);
  expect(exitCode).toBe(1);
});

// The expected files come from Prettier 3.9. To its `ignore` package the `**` in `build/**/` can stand for nothing, so the line is
// about `build` itself. git reads it differently: there `build/a.js` isn't ignored.
test.concurrent.each([
  ["build/**/", "a.js a/f.js ab.js src/build/d.js src/e.js"],
  ["**/build/**/", "a.js a/f.js ab.js src/e.js"],
  ["build/", "a.js a/f.js ab.js src/e.js"],
  ["build/**", "a.js a/f.js ab.js src/build/d.js src/e.js"],
  ["build/**/x/", "a.js a/f.js ab.js build/a.js build/sub/b.js src/build/d.js src/e.js"],
  ["a**/**", "a.js ab.js build/a.js build/sub/b.js build/sub/x/c.js src/build/d.js src/e.js"],
])("the .prettierignore line %j with ** ignores the same files as Prettier", async (line, expected) => {
  const names = "build/a.js build/sub/b.js build/sub/x/c.js src/build/d.js src/e.js a.js a/f.js ab.js".split(" ");
  const files = {
    ...Object.fromEntries(names.map(name => [name, ugly])),
    ".prettierrc.json": "{}\n",
    ".prettierignore": `${line}\n`,
  };
  const { stdout, exitCode } = await format(files, ["-l", "."]);
  expect(stdout.trim().split("\n").sort().join(" ")).toBe(expected);
  expect(exitCode).toBe(1);
});
