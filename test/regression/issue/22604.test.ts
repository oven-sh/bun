import { test, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("Issue #22604: tabs in TypeScript comments should be properly escaped in source maps", async () => {
  using dir = tempDir("issue-22604", {
    "index.ts": `console.log("Hello World");
// \t})();
// Multiple tabs:\t\t\there
const x = "normal string with\ttab";`,
  });

  // Build with source maps
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--sourcemap", "--outdir", "out"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);

  // Read the generated source map
  const sourceMapPath = `${dir}/out/index.js.map`;
  const sourceMap = JSON.parse(await Bun.file(sourceMapPath).text());

  // Check that sourcesContent is valid JSON (i.e., tabs are escaped)
  expect(sourceMap.sourcesContent).toBeDefined();
  expect(sourceMap.sourcesContent).toBeArray();
  expect(sourceMap.sourcesContent.length).toBe(1);

  const sourceContent = sourceMap.sourcesContent[0];
  
  // The parsed JSON will have the actual tab and newline characters
  // The important thing is that the JSON was valid and could be parsed
  expect(sourceContent).toContain("\t");
  expect(sourceContent).toContain("\n");
  
  // Verify the content matches the original source exactly
  expect(sourceContent).toBe(
    'console.log("Hello World");\n// \t})();\n// Multiple tabs:\t\t\there\nconst x = "normal string with\ttab";'
  );
  
  // Also verify that the source map is valid JSON by re-parsing it
  const sourceMapText = await Bun.file(sourceMapPath).text();
  expect(() => JSON.parse(sourceMapText)).not.toThrow();
});

test("Issue #22604: newlines should also be properly escaped in source maps", async () => {
  using dir = tempDir("issue-22604-newlines", {
    "index.ts": `console.log("Line 1");
// Comment with newline
console.log("Line 3");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--sourcemap", "--outdir", "out"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);

  const sourceMapPath = `${dir}/out/index.js.map`;
  const sourceMap = JSON.parse(await Bun.file(sourceMapPath).text());

  // The parsed JSON will have actual newlines (that's correct behavior)
  const sourceContent = sourceMap.sourcesContent[0];
  expect(sourceContent).toContain("\n");
  expect(sourceContent).toBe(
    'console.log("Line 1");\n// Comment with newline\nconsole.log("Line 3");'
  );
});