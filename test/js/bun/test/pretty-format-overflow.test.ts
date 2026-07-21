// Test for integer overflow fix in pretty_format.zig
// Previously crashed with: panic: integer overflow at writeIndent in pretty_format.zig:648
// Platform: Windows x86_64_baseline, Bun v1.3.0

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";

describe("pretty_format should handle deeply nested objects without crashing", () => {
  test("deeply nested object with many properties", async () => {
    const dir = tempDirWithFiles("pretty-format-overflow", {
      "nested.test.ts": `
import { test, expect } from "bun:test";

test("deep nesting", () => {
  let obj = {};
  for (let i = 0; i < 100; i++) {
    obj[\`prop\${i}\`] = \`value\${i}\`;
  }

  let nested = obj;
  for (let i = 0; i < 500; i++) {
    const newObj = {};
    for (let j = 0; j < 50; j++) {
      newObj[\`key\${j}\`] = \`val\${j}\`;
    }
    newObj.nested = nested;
    nested = newObj;
  }

  expect(nested).toEqual({ shouldNotMatch: true });
});
`,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "test", "nested.test.ts"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // The test should fail due to assertion mismatch, but should NOT crash
    expect(exitCode).toBe(1);
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("integer overflow");
    expect(stderr).not.toContain("SIGTRAP");
    // Verify it actually formatted and showed the diff (not just crashed)
    expect(stderr).toContain("expect(received).toEqual(expected)");
  }, 30000);
});

// A failing toEqual / toMatchSnapshot on a deeply-nested (non-circular) value used to walk
// the native stack to exhaustion inside pretty_format's Formatter::print_as, taking the whole
// runner down with SIGSEGV instead of reporting a matcher failure. Run in a subprocess so a
// regression fails these tests rather than segfaulting the outer runner.
describe.concurrent("pretty_format stops recursion before native stack overflow", () => {
  const depth = 20000;

  test("failing toEqual on a deeply nested array", async () => {
    using dir = tempDir("pretty-format-deep-array", {
      "deep.test.ts": `
        import { test, expect } from "bun:test";
        test("deep array", () => {
          let a: any = [];
          for (let i = 0; i < ${depth}; i++) a = [a];
          expect(a).toEqual([1]);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "deep.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("expect(received).toEqual(expected)");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("failing toEqual on a deeply nested object", async () => {
    using dir = tempDir("pretty-format-deep-object", {
      "deep.test.ts": `
        import { test, expect } from "bun:test";
        test("deep object", () => {
          let a: any = {};
          for (let i = 0; i < ${depth}; i++) a = { k: a };
          expect(a).toEqual({ k: 1 });
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "deep.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("expect(received).toEqual(expected)");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("toMatchSnapshot on a deeply nested array", async () => {
    using dir = tempDir("pretty-format-deep-snapshot", {
      "deep.test.ts": `
        import { test, expect } from "bun:test";
        test("deep snapshot", () => {
          let a: any = [];
          for (let i = 0; i < ${depth}; i++) a = [a];
          expect(a).toMatchSnapshot();
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "deep.test.ts"],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("Ran 1 test");
    expect(exitCode).toBe(0);
  });
});
