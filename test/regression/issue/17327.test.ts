import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";

test("issue #17327: extra bracket in error message with colors enabled", async () => {
  const dir = tempDirWithFiles("17327", {
    "test.ts": `
const result = {success:false};
const err = new Error(\`error: \${JSON.stringify(
  result
)}\`);
throw err;
    `.trim(),
  });

  // Test with colors enabled
  await using coloredProc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: { ...bunEnv, FORCE_COLOR: "1" },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [coloredStdout, coloredStderr] = await Promise.all([
    new Response(coloredProc.stdout).text(),
    new Response(coloredProc.stderr).text(),
  ]);

  const coloredOutput = coloredStdout + coloredStderr;

  // Test with colors disabled
  await using plainProc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: { ...bunEnv, NO_COLOR: "1" },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [plainStdout, plainStderr] = await Promise.all([
    new Response(plainProc.stdout).text(),
    new Response(plainProc.stderr).text(),
  ]);

  const plainOutput = plainStdout + plainStderr;

  // The error message should contain the correct JSON without extra brackets
  expect(coloredOutput).toContain('error: {"success":false}');
  expect(plainOutput).toContain('error: {"success":false}');

  // The colored output should not contain extra closing brackets after JSON.stringify(
  // Check for the specific pattern where extra } appears in syntax highlighting
  expect(coloredOutput).not.toMatch(/stringify.*\(\s*}/);
  expect(coloredOutput).not.toMatch(/JSON\.stringify\([^)]*\)\s*}/);

  // Both outputs should contain the same essential error information
  expect(normalizeBunSnapshot(coloredOutput)).toContain('error: {"success":false}');
  expect(normalizeBunSnapshot(plainOutput)).toContain('error: {"success":false}');
});

test("issue #17327: template literal syntax highlighting edge cases", async () => {
  const dir = tempDirWithFiles("17327-edge", {
    "nested.ts": `
const obj = {nested: {deep: true}};
throw new Error(\`Complex: \${JSON.stringify(obj)}\`);
    `.trim(),
    "array.ts": `
const arr = [1, 2, {inner: "value"}];
throw new Error(\`Array: \${JSON.stringify(arr)}\`);
    `.trim(),
  });

  for (const file of ["nested.ts", "array.ts"]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), file],
      env: { ...bunEnv, FORCE_COLOR: "1" },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    const output = stdout + stderr;

    // Should not contain extra brackets in syntax highlighting (avoiding matching legitimate nested JSON)
    expect(output).not.toMatch(/stringify.*\(\s*}/);
    expect(output).not.toMatch(/JSON\.stringify\([^)]*\)\s*}/);
  }
});
