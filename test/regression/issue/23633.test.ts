import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/23633
// Block-scoped function declarations in sloppy mode (.cjs) should follow
// ECMAScript Annex B.3.3 semantics: the function should be assigned to the
// outer var-scoped binding at the point of the declaration.

test("Annex B.3.3: block-scoped function overwrites outer binding in sloppy mode", async () => {
  // This is the exact reproduction from the issue.
  using dir = tempDir("issue-23633", {
    "test.cjs": `
function foo() {
  console.log('foo');
}
foo();
{
  function foo() {
    console.log('bar');
  }
  foo();
}
foo();
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Before the fix, the last call printed "foo" instead of "bar"
  expect(stdout.trim()).toBe("foo\nbar\nbar");
  expect(exitCode).toBe(0);
});

test("Annex B.3.3: block-scoped function inside a function scope", async () => {
  using dir = tempDir("issue-23633-fn-scope", {
    "test.cjs": `
function test1() {
  function foo() { return 'outer'; }
  console.log(foo());
  {
    function foo() { return 'inner'; }
    console.log(foo());
  }
  console.log(foo());
}
test1();
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("outer\ninner\ninner");
  expect(exitCode).toBe(0);
});

test("Annex B.3.3: block-scoped function hoisted from block to enclosing scope", async () => {
  using dir = tempDir("issue-23633-nested", {
    "test.cjs": `
{
  function f() { return 'block'; }
  console.log(f());
}
console.log(f());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("block\nblock");
  expect(exitCode).toBe(0);
});

test("Annex B.3.3: strict mode (ESM) does NOT leak block-scoped functions", async () => {
  using dir = tempDir("issue-23633-esm", {
    "test.mjs": `
export {};
function foo() { return 'outer'; }
console.log(foo());
{
  function foo() { return 'inner'; }
  console.log(foo());
}
console.log(foo());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("outer\ninner\nouter");
  expect(exitCode).toBe(0);
});

test("Annex B.3.3: transpiled output is correct for sloppy mode", async () => {
  // Verify that `bun build --no-bundle` produces correct Annex B output
  using dir = tempDir("issue-23633-build", {
    "test.cjs": `
function foo() {
  console.log('foo');
}
foo();
{
  function foo() {
    console.log('bar');
  }
  foo();
}
foo();
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The transpiled output should contain a var assignment from the block function
  // to the outer scope (the key Annex B.3.3 behavior)
  expect(stdout).toContain("var foo");
  expect(stdout).toContain("foo =");
  expect(exitCode).toBe(0);
});
