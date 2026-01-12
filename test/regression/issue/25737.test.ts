import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("function declaration inside labeled statement should be accessible in sloppy mode", async () => {
  using dir = tempDir("issue-25737", {
    "test.cjs": `
foo:
    function bar() { return "bar"; }

console.log(bar());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("bar");
  expect(exitCode).toBe(0);
});

test("function declaration inside nested labeled statements should be accessible", async () => {
  using dir = tempDir("issue-25737-nested", {
    "test.cjs": `
outer:
  inner:
    function baz() { return "baz"; }

console.log(baz());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("baz");
  expect(exitCode).toBe(0);
});

test("function declaration inside labeled statement with break should work", async () => {
  using dir = tempDir("issue-25737-break", {
    "test.cjs": `
let result = "";
foo: {
    function bar() { return "bar"; }
    result = bar();
    break foo;
}
console.log(result);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("bar");
  expect(exitCode).toBe(0);
});

test("transpiler output should not wrap labeled function in block", async () => {
  using dir = tempDir("issue-25737-transpile", {
    "test.cjs": `
foo:
    function bar() { return "bar"; }
console.log(bar());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // The output should NOT contain "{ function bar" or "{ let bar"
  // It should be a simple labeled function declaration
  expect(stdout).not.toContain("{ function bar");
  expect(stdout).not.toContain("{ let bar");
  expect(stdout).not.toContain("foo: {");
  expect(stdout).toContain("foo:");
  expect(stdout).toContain("function bar()");
  expect(exitCode).toBe(0);
});
