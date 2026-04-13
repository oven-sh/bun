// https://github.com/oven-sh/bun/issues/29243
//
// Bun was rejecting unreachable top-level `await` at parse time when
// targeting a non-ESM output format. esbuild parses the `await`, lets DCE
// drop the unreachable branch, and only then reports the CJS / TLA
// incompatibility. This test locks in the same behaviour for `bun build`.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun build --format=cjs drops an unreachable top-level await before reporting TLA", async () => {
  using dir = tempDir("issue-29243-dead-tla", {
    "entry.js": `if (typeof TEST === "undefined" ? false : TEST) {
  await import("node:fs");
}
foo();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--minify", "--format=cjs", "--define", "TEST=false"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("foo();\n");
  expect(exitCode).toBe(0);
});

test("bun build --format=cjs still rejects a live top-level await", async () => {
  using dir = tempDir("issue-29243-live-tla", {
    "entry.js": `await import("node:fs");
foo();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`Top-level await is currently not supported with the "cjs" output format`);
  expect(exitCode).not.toBe(0);
});

test("await can still be used as an identifier at module scope in CJS output", async () => {
  using dir = tempDir("issue-29243-await-ident", {
    "entry.js": `var await = 42;
globalThis.output = await;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("var await = 42");
  expect(stdout).toContain("globalThis.output = await");
  expect(exitCode).toBe(0);
});

test("await inside a non-async function nested in a CJS file still reports a useful error", async () => {
  using dir = tempDir("issue-29243-nested-await", {
    "entry.js": `function notAsync() {
  await something();
}`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`"await" can only be used inside an "async" function`);
  expect(exitCode).not.toBe(0);
});

// A literal `if (false)` without `--define` has to hit the same code path,
// because the original bug fired from the lexer before constant folding.
test("bun build --format=cjs drops a literal if (false) top-level await", async () => {
  using dir = tempDir("issue-29243-literal-false", {
    "entry.js": `if (false) {
  await import("node:fs");
}
foo();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--minify", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("foo();\n");
  expect(exitCode).toBe(0);
});

// `var await = String.raw; await` + backtick-template is a tagged template
// call on the identifier `await`. Make sure the disambiguation doesn't
// misparse it as an await expression.
test("await as a tagged-template call identifier keeps working in CJS", async () => {
  using dir = tempDir("issue-29243-tagged-template", {
    "entry.js": "var await = String.raw;\n" + "globalThis.output = await`hello ${1 + 1} world`;\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("var await = String.raw");
  expect(exitCode).toBe(0);
});

// `await { foo: 1 }` has no useful identifier-continuation interpretation,
// so it gets parsed as an await expression and should be dropped by DCE in
// a dead branch.
test("bun build --format=cjs drops an unreachable await of an object literal", async () => {
  using dir = tempDir("issue-29243-await-brace", {
    "entry.js": `if (false) {
  await { foo: 1 };
}
bar();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--minify", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("bar();\n");
  expect(exitCode).toBe(0);
});

// `for await (x of y)` at module scope hits a different parse-time error
// than `await EXPR`, so it needs the same dead-code tolerance.
test("bun build --format=cjs drops an unreachable top-level for await loop", async () => {
  using dir = tempDir("issue-29243-dead-for-await", {
    "entry.js": `if (false) {
  for await (const x of someIter) {
    console.log(x);
  }
}
bar();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--minify", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("bar();\n");
  expect(exitCode).toBe(0);
});

test("bun build --format=cjs still rejects a live top-level for await loop", async () => {
  using dir = tempDir("issue-29243-live-for-await", {
    "entry.js": `for await (const x of someIter) {
  console.log(x);
}`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`Top-level await is currently not supported with the "cjs" output format`);
  expect(exitCode).not.toBe(0);
});

// A default parameter is not at module top level, so `await EXPR` inside
// a non-async function's default value must not be silently upgraded to an
// await expression just because the enclosing file is at module scope.
test("bun build --format=cjs rejects await in a default parameter of a non-async function", async () => {
  using dir = tempDir("issue-29243-default-param", {
    "entry.js": `function foo(x = await import("node:fs")) {
  return x;
}
module.exports = foo;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`"await" can only be used inside an "async" function`);
  expect(exitCode).not.toBe(0);
});

// A dead `await` shouldn't interfere with a top-level `return` statement
// in a CJS file; both are legal in CJS and the presence of the dead await
// is just DCE fodder.
test("bun build --format=cjs allows a top-level return alongside a dead top-level await", async () => {
  using dir = tempDir("issue-29243-dead-await-and-return", {
    "entry.js": `if (false) {
  await import("node:fs");
}
module.exports = 42;
return;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--format=cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("module.exports = 42");
  expect(stdout).toContain("return");
  expect(exitCode).toBe(0);
});
