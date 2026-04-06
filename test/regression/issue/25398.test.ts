import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/25398
// Bug: Object spread with nullish coalescing to empty object literal
// in unused expression statements was incorrectly simplified,
// resulting in invalid JavaScript output like `k?.x ?? ` (missing {})

test("object spread with nullish coalescing to empty object in arrow function body", async () => {
  // This pattern is common in Webpack-style CommonJS chunks
  using dir = tempDir("issue-25398", {
    "test.js": `exports.id=1,exports.ids=[1],exports.modules={1:(a,b,c)=>{let k={};({...k,a:k?.x??{}})}};`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not throw "Expected CommonJS module to have a function wrapper"
  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(exitCode).toBe(0);
});

test("object spread with nullish coalescing preserves value in simplification", async () => {
  // This specifically tests that the value after ?? is preserved when used
  using dir = tempDir("issue-25398-preserve", {
    "test.js": `
      let result;
      const f = () => { let k = {x: null}; result = {...k, a: k?.x ?? {default: true}}; };
      f();
      console.log(JSON.stringify(result));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ x: null, a: { default: true } });
  expect(exitCode).toBe(0);
});
