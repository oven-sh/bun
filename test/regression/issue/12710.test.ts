import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/12710
// Const-inlining should not change the observable result of Function.prototype.toString()
// by replacing variable references with literal values inside function bodies.

test("const values are not inlined into function bodies (require + eval toString)", async () => {
  using dir = tempDir("issue-12710", {
    "entry.js": `
const { log } = require("./helper");
const hi = "hi";
log(() => console.log(hi));
`,
    "helper.js": `
export const log = (fun) => {
  try {
    eval("(" + fun.toString() + ")()");
    console.log("NO_ERROR");
  } catch (e) {
    console.log(e.constructor.name + ": " + e.message);
  }
};
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The eval'd function should throw ReferenceError because `hi` is not
  // defined in the eval scope. If const inlining replaced `hi` with `"hi"`,
  // this would incorrectly print "hi" instead.
  expect(stdout.trim()).toBe("ReferenceError: hi is not defined");
  expect(exitCode).toBe(0);
});

test("const values are still inlined at the same scope level", async () => {
  using dir = tempDir("issue-12710-same-scope", {
    "entry.js": `
const hi = "hi";
console.log(hi);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hi");
  expect(exitCode).toBe(0);
});

test("const values declared inside function bodies are still inlined within that function", async () => {
  using dir = tempDir("issue-12710-inner", {
    "entry.js": `
function foo() {
  const x = "hello";
  console.log(x);
}
foo();
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);
});

test("toString() preserves variable references in arrow functions", async () => {
  using dir = tempDir("issue-12710-tostring", {
    "entry.js": `
const hi = "hi";
const fn = () => console.log(hi);
// The toString should contain the identifier 'hi', not the literal '"hi"'
const str = fn.toString();
console.log(str.includes("hi") ? "has_reference" : "no_reference");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("has_reference");
  expect(exitCode).toBe(0);
});

test("let variables are not inlined (unchanged behavior)", async () => {
  using dir = tempDir("issue-12710-let", {
    "entry.js": `
const { log } = require("./helper");
let hi = "hi";
log(() => console.log(hi));
`,
    "helper.js": `
export const log = (fun) => {
  try {
    eval("(" + fun.toString() + ")()");
    console.log("NO_ERROR");
  } catch (e) {
    console.log(e.constructor.name + ": " + e.message);
  }
};
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ReferenceError: hi is not defined");
  expect(exitCode).toBe(0);
});
