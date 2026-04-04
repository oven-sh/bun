import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that --compile implies --production (minification enabled)
// https://github.com/oven-sh/bun/issues/26373

test("--compile implies --production and enables minification", async () => {
  using dir = tempDir("issue-26373", {
    // Use code with long variable names that will be minified in production mode
    "index.ts": `
const myVeryLongVariableName = "hello";
const anotherLongVariableName = "world";
console.log(myVeryLongVariableName, anotherLongVariableName);
`,
  });

  // Build without flags (no minification, larger bundle)
  await using noMinifyProc = Bun.spawn({
    cmd: [bunExe(), "build", "--outfile", "no-minify.js", "./index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, noMinifyStderr, noMinifyExitCode] = await Promise.all([
    noMinifyProc.stdout.text(),
    noMinifyProc.stderr.text(),
    noMinifyProc.exited,
  ]);

  expect(noMinifyStderr).toBe("");
  expect(noMinifyExitCode).toBe(0);

  // Build with --production (minification enabled, smaller bundle)
  await using productionProc = Bun.spawn({
    cmd: [bunExe(), "build", "--production", "--outfile", "production.js", "./index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, productionStderr, productionExitCode] = await Promise.all([
    productionProc.stdout.text(),
    productionProc.stderr.text(),
    productionProc.exited,
  ]);

  expect(productionStderr).toBe("");
  expect(productionExitCode).toBe(0);

  // Read the bundle files
  const noMinifyContent = await Bun.file(`${dir}/no-minify.js`).text();
  const productionContent = await Bun.file(`${dir}/production.js`).text();

  // Non-minified should contain the original long variable names
  expect(noMinifyContent).toContain("myVeryLongVariableName");
  expect(noMinifyContent).toContain("anotherLongVariableName");

  // Production (minified) should NOT contain the original long variable names
  expect(productionContent).not.toContain("myVeryLongVariableName");
  expect(productionContent).not.toContain("anotherLongVariableName");

  // Build with --compile only (should imply --production, including minification)
  // The output should show "minify" step
  await using compileProc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--outfile", "compiled", "./index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [compileStdout, compileStderr, compileExitCode] = await Promise.all([
    compileProc.stdout.text(),
    compileProc.stderr.text(),
    compileProc.exited,
  ]);

  expect(compileStderr).toBe("");
  expect(compileExitCode).toBe(0);

  // The stdout should contain "minify" indicating minification was performed
  // This is the key assertion that proves --compile implies --production
  expect(compileStdout).toContain("minify");

  // The compiled executable should run correctly
  await using runCompiled = Bun.spawn({
    cmd: [`${dir}/compiled`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [compiledOutput, compiledStderr, runExitCode] = await Promise.all([
    runCompiled.stdout.text(),
    runCompiled.stderr.text(),
    runCompiled.exited,
  ]);

  expect(compiledStderr).toBe("");
  expect(compiledOutput).toBe("hello world\n");
  expect(runExitCode).toBe(0);
});
