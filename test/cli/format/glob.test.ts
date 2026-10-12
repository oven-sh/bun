import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined };
const ugly = "if (a) {\nb( 1 )\n}\n";

async function format(files: Record<string, string>, args: string[], stdin?: string) {
  using dir = tempDir("bun-format-glob", files);
  await using proc = spawn({
    cmd: [bunExe(), "format", ...args],
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

// What Prettier 3.9 lists for each.
test.concurrent.each([
  ["src/**/*.@(js|ts)", "src/a.js src/b.ts src/x/d.js"],
  ["{a,src/x/*}.?(c)js", "a.cjs a.js src/x/d.js"],
  ["lib/!(deep)*.js", "lib/f.js"],
  ["**/+(a|d).js", "a.js src/a.js src/x/d.js"],
  // To Prettier parentheses alone are a group too.
  ["(src|lib)/*.js", "lib/f.js src/a.js"],
  // And `a/**` matches `a`.
  ["lib/*/**", "lib/deep/g.js lib/deep/h.min.js lib/f.js"],
])("a pattern on the command line: %s", async (pattern, expected) => {
  const { stdout, exitCode } = await format(project, ["-l", pattern]);
  expect(stdout.trim().split("\n").sort().join(" ")).toBe(expected);
  expect(exitCode).toBe(1);
});

test.concurrent("`files` and `excludeFiles` of an override of Prettier", async () => {
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
  // Braces around one thing are characters.
  ["{a.js}", "a.js", "  "],
  ["{a.js,b.js}", "a.js", "    "],
  ["*.{js}", "a.js", "  "],
  // A `**` crosses `/` wherever it is.
  ["**.js", "lib/deep/a.js", "    "],
  ["lib/**.js", "lib/deep/a.js", "    "],
  ["lib/**.js", "a.js", "  "],
  ["li**a.js", "lib/deep/a.js", "    "],
  ["li**/a.js", "lib/deep/a.js", "    "],
  ["li**", "lib/deep/a.js", "    "],
  ["lib/*.js", "lib/deep/a.js", "  "],
  // Without a `/` it is for a name in any directory.
  ["a.js", "lib/deep/a.js", "    "],
  ["/a.js", "lib/deep/a.js", "  "],
])("a section of .editorconfig for Prettier: [%s] and %s", async (section, name, indent) => {
  const files = { ".prettierrc.json": "{}", ".editorconfig": `root = true\n[${section}]\nindent_size = 4\n` };
  const { stdout, exitCode } = await format(files, ["--stdin-filepath", name], ugly);
  expect(stdout).toBe(`if (a) {\n${indent}b(1);\n}\n`);
  expect(exitCode).toBe(0);
});
