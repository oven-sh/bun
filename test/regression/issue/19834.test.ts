import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/19834
// HTML bundle imports are cached incorrectly without honoring `with { type }` value
test("issue #19834 - HTML imports with different `with { type }` should not be cached together", async () => {
  using dir = tempDir("issue-19834", {
    "index.html": `<!DOCTYPE html>
<html>
  <head>
    <title>Test Page</title>
  </head>
  <body>
    <h1>Hello World</h1>
  </body>
</html>`,
    "test.ts": `
// First import as HTMLBundle (default behavior)
const htmlBundle = await import("./index.html").then(v => v.default);

// Second import with { type: "file" } should return a string path
const htmlFile = await import("./index.html", { with: { type: "file" } }).then(v => v.default);

// Output the types and values for verification
console.log("HTMLBundle type:", typeof htmlBundle);
console.log("HTMLBundle is object:", typeof htmlBundle === "object" && htmlBundle !== null);
console.log("HTMLBundle has index:", "index" in (htmlBundle ?? {}));

console.log("File type:", typeof htmlFile);
console.log("File is string:", typeof htmlFile === "string");

// The critical check: these should be different types
if (typeof htmlBundle === typeof htmlFile) {
  console.log("BUG: Both imports returned the same type!");
  process.exit(1);
}

console.log("SUCCESS: Different types returned for different import attributes");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  console.log("stdout:", stdout);
  console.log("stderr:", stderr);

  // When the bug is fixed:
  // - htmlBundle should be an object (HTMLBundle with index property)
  // - htmlFile should be a string (file path)
  expect(stdout).toContain("HTMLBundle type: object");
  expect(stdout).toContain("HTMLBundle is object: true");
  expect(stdout).toContain("HTMLBundle has index: true");
  expect(stdout).toContain("File type: string");
  expect(stdout).toContain("File is string: true");
  expect(stdout).toContain("SUCCESS: Different types returned for different import attributes");

  expect(exitCode).toBe(0);
});

// Test the reverse order (file first, then bundle)
test("issue #19834 - reverse order: file import first, then HTMLBundle", async () => {
  using dir = tempDir("issue-19834-reverse", {
    "index.html": `<!DOCTYPE html>
<html>
  <head>
    <title>Test Page</title>
  </head>
  <body>
    <h1>Hello World</h1>
  </body>
</html>`,
    "test.ts": `
// First import with { type: "file" } should return a string path
const htmlFile = await import("./index.html", { with: { type: "file" } }).then(v => v.default);

// Second import as HTMLBundle (default behavior)
const htmlBundle = await import("./index.html").then(v => v.default);

// Output the types and values for verification
console.log("File type:", typeof htmlFile);
console.log("File is string:", typeof htmlFile === "string");

console.log("HTMLBundle type:", typeof htmlBundle);
console.log("HTMLBundle is object:", typeof htmlBundle === "object" && htmlBundle !== null);
console.log("HTMLBundle has index:", "index" in (htmlBundle ?? {}));

// The critical check: these should be different types
if (typeof htmlBundle === typeof htmlFile) {
  console.log("BUG: Both imports returned the same type!");
  process.exit(1);
}

console.log("SUCCESS: Different types returned for different import attributes");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  console.log("stdout:", stdout);
  console.log("stderr:", stderr);

  // When the bug is fixed:
  // - htmlFile should be a string (file path)
  // - htmlBundle should be an object (HTMLBundle with index property)
  expect(stdout).toContain("File type: string");
  expect(stdout).toContain("File is string: true");
  expect(stdout).toContain("HTMLBundle type: object");
  expect(stdout).toContain("HTMLBundle is object: true");
  expect(stdout).toContain("HTMLBundle has index: true");
  expect(stdout).toContain("SUCCESS: Different types returned for different import attributes");

  expect(exitCode).toBe(0);
});
