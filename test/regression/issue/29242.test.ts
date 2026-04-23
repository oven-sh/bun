// https://github.com/oven-sh/bun/issues/29242
//
// The parser handles string-literal names in `export { ... } from 'mod'`
// clauses, but when transpiling without bundling the printer dropped the
// quotes around the local name, producing invalid syntax that JSC then
// rejected:
//
//   export { "a b c" } from './b.mjs';   // input
//   export { a b c } from './b.mjs';     // old output — SyntaxError
//   export { "a b c" } from './b.mjs';   // fixed output
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("re-export with string literal local name (export { 'a b c' } from 'mod')", async () => {
  using dir = tempDir("issue-29242-bare", {
    "a.mjs": `export { "a b c" } from './b.mjs';`,
    "b.mjs": `const a = 1;\nexport { a as "a b c" };`,
    "main.mjs": `import { "a b c" as a } from './a.mjs';\nconsole.log(a);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("SyntaxError");
  expect(stdout).toBe("1\n");
  expect(exitCode).toBe(0);
});

test.concurrent("re-export aliasing from string literal to identifier", async () => {
  using dir = tempDir("issue-29242-alias", {
    "a.mjs": `export { "a b c" as a } from './b.mjs';`,
    "b.mjs": `const a = 1;\nexport { a as "a b c" };`,
    "main.mjs": `import { a } from './a.mjs';\nconsole.log(a);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("SyntaxError");
  expect(stdout).toBe("1\n");
  expect(exitCode).toBe(0);
});

test.concurrent("re-export aliasing string literal to string literal", async () => {
  using dir = tempDir("issue-29242-both", {
    "a.mjs": `export { "a b c" as "x y z" } from './b.mjs';`,
    "b.mjs": `const a = 1;\nexport { a as "a b c" };`,
    "main.mjs": `import { "x y z" as a } from './a.mjs';\nconsole.log(a);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("SyntaxError");
  expect(stdout).toBe("1\n");
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  [`export { "a b c" } from './mod';`, [`"a b c"`]],
  [`export { "a b c" as a } from './mod';`, [`"a b c"`]],
  [`export { "a b c" as "x y z" } from './mod';`, [`"a b c"`, `"x y z"`]],
  [`export { plain, "a b c" as aliased } from './mod';`, [`"a b c"`, `plain`]],
])("transpiler preserves string literal names in export-from clauses: %s", async (source, mustContain) => {
  // Direct test of the printer: transpile without bundling and confirm the
  // quotes around the local names are preserved.
  using dir = tempDir("issue-29242-printer", {
    "input.ts": source,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.ts", "--target=bun", "--no-bundle"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("SyntaxError");
  for (const frag of mustContain) {
    expect(stdout).toContain(frag);
  }
  // No unquoted `a b c` or `x y z` anywhere (guard quote-style agnostic).
  expect(stdout).not.toMatch(/(^|[^"'])a b c(?!["'])/);
  expect(stdout).not.toMatch(/(^|[^"'])x y z(?!["'])/);
  expect(exitCode).toBe(0);
});

test.concurrent("transpiler preserves string literal names under --minify-identifiers", async () => {
  // Regression for a subtlety: the export-from clause's left-side symbol
  // is a synthesized intermediate that a minifier may rename. Printing
  // `original_name` (the raw source text) keeps re-exports correct.
  using dir = tempDir("issue-29242-minify", {
    "input.ts": [`export { "a b c" as aliased } from './mod';`, `export { foo as bar } from './mod';`].join("\n"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.ts", "--target=bun", "--no-bundle", "--minify-identifiers"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("SyntaxError");
  expect(stdout).toContain(`"a b c" as aliased`);
  expect(stdout).toContain(`foo as bar`);
  expect(stdout).not.toMatch(/(^|[^"'])a b c(?!["'])/);
  expect(exitCode).toBe(0);
});
