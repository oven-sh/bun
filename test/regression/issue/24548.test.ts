// https://github.com/oven-sh/bun/issues/24548
// Test that Bun can handle deeply nested if-else chains without stack overflow
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("deeply nested if-else chains should not cause stack overflow", async () => {
  // Generate a deeply nested if-else chain (similar to Gleam's entity resolver)
  const depth = 2500; // More than the 2124 in the original issue
  let code = "export function test(x) {\n";

  for (let i = 0; i < depth; i++) {
    if (i > 0) code += " else ";
    code += `if (x === ${i}) {\n`;
    code += `    return ${i};\n`;
    code += "  }";
  }

  code += " else {\n    return -1;\n  }\n}\n";

  using dir = tempDir("issue-24548", {
    "deep-if-else.js": code,
    "index.js": `import { test } from "./deep-if-else.js";\nconsole.log(test(42));`,
  });

  // Test that bun can run the file
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"42"`);
  expect(exitCode).toBe(0);
});

test("bun build should handle deeply nested if-else chains", async () => {
  const depth = 2500;
  let code = "export function test(x) {\n";

  for (let i = 0; i < depth; i++) {
    if (i > 0) code += " else ";
    code += `if (x === ${i}) {\n`;
    code += `    return ${i};\n`;
    code += "  }";
  }

  code += " else {\n    return -1;\n  }\n}\n";

  using dir = tempDir("issue-24548-build", {
    "deep-if-else.js": code,
  });

  // Test that bun build can bundle the file
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "deep-if-else.js", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // Verify the bundle was created
  const bundlePath = `${dir}/bundle.js`;
  expect(await Bun.file(bundlePath).exists()).toBe(true);
});
