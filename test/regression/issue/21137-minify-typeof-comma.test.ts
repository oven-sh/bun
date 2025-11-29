import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// Regression test for minification bug where typeof comparison in comma operator
// produces invalid JavaScript output
test("issue #21137: minify typeof undefined in comma operator", async () => {
  using dir = tempDir("issue-21137", {});

  // This code pattern was producing invalid JavaScript: ", !1" instead of "!1"
  const testCode = `
function testFunc() {
  return (typeof undefinedVar !== "undefined", false);
}

// Test with other variations
function testFunc2() {
  return (typeof someVar === "undefined", true);
}

function testFunc3() {
  // Nested comma operators
  return ((typeof a !== "undefined", 1), (typeof b === "undefined", 2));
}

// Test in conditional
const result = typeof window !== "undefined" ? (typeof document !== "undefined", true) : false;

console.log(testFunc());
console.log(testFunc2());
console.log(testFunc3());
console.log(result);
`;

  const testFile = path.join(String(dir), "test.js");
  await Bun.write(testFile, testCode);

  // Build with minify-syntax flag
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify-syntax", testFile],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildOutput, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  // Build should succeed
  expect(buildExitCode).toBe(0);

  // The output should NOT contain invalid syntax like ", !" or ", false" or ", true"
  // These patterns indicate the bug where the left side of comma was incorrectly removed
  expect(buildOutput).not.toContain(", !");
  expect(buildOutput).not.toContain(", false");
  expect(buildOutput).not.toContain(", true");
  expect(buildOutput).not.toContain(", 1");
  expect(buildOutput).not.toContain(", 2");

  // Verify the minified code runs without syntax errors
  const minifiedFile = path.join(String(dir), "minified.js");
  await Bun.write(minifiedFile, buildOutput);

  await using runProc = Bun.spawn({
    cmd: [bunExe(), minifiedFile],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runOutput, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  // Should run without errors
  expect(runExitCode).toBe(0);

  // Verify the output is correct
  const lines = runOutput.trim().split("\n");
  expect(lines[0]).toBe("false"); // testFunc() returns false
  expect(lines[1]).toBe("true"); // testFunc2() returns true
  expect(lines[2]).toBe("2"); // testFunc3() returns 2
  expect(lines[3]).toBe("false"); // result is false (no window in Node/Bun)
});

// Additional test for the specific optimization that was causing the bug
test("issue #21137: typeof undefined optimization preserves valid syntax", async () => {
  using dir = tempDir("issue-21137-opt", {});

  // Test the specific optimization: typeof x !== "undefined" -> typeof x < "u"
  const testCode = `
// These should be optimized but remain valid
const a = typeof x !== "undefined";
const b = typeof y === "undefined";
const c = typeof z != "undefined";
const d = typeof w == "undefined";

// In comma expressions
const e = (typeof foo !== "undefined", 42);
const f = (typeof bar === "undefined", "test");

// Should not break when left side is removed
function check() {
  return (typeof missing !== "undefined", null);
}

console.log(JSON.stringify({a, b, c, d, e, f, check: check()}));
`;

  const testFile = path.join(String(dir), "optimize.js");
  await Bun.write(testFile, testCode);

  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify-syntax", testFile],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildOutput, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Check that the optimization is applied (should contain < or > comparisons with "u")
  expect(buildOutput).toContain('"u"');

  // But should not have invalid comma syntax
  expect(buildOutput).not.toMatch(/,\s*[!<>]/); // No comma followed by operator
  expect(buildOutput).not.toMatch(/,\s*"u"/); // No comma followed by "u"

  // Run the minified code to ensure it's valid
  const minifiedFile = path.join(String(dir), "minified.js");
  await Bun.write(minifiedFile, buildOutput);

  await using runProc = Bun.spawn({
    cmd: [bunExe(), minifiedFile],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runOutput, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runExitCode).toBe(0);

  // Parse and verify the output
  const result = JSON.parse(runOutput.trim());
  expect(result.a).toBe(false);
  expect(result.b).toBe(true);
  expect(result.c).toBe(false);
  expect(result.d).toBe(true);
  expect(result.e).toBe(42);
  expect(result.f).toBe("test");
  expect(result.check).toBe(null);
});
