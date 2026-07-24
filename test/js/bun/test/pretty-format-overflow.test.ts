// Test for integer overflow fix in pretty_format.zig
// Previously crashed with: panic: integer overflow at writeIndent in pretty_format.zig:648
// Platform: Windows x86_64_baseline, Bun v1.3.0

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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
      stdout: "ignore",
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

  test.each(["array", "object"])(
    "toEqual diff of a %s nested past the native stack limit does not crash",
    async kind => {
      // `b` is shallow so toEqual returns a mismatch immediately; the crash was in
      // the diff formatter rendering `a` afterwards.
      const build =
        kind === "array"
          ? "let a = []; for (let i = 0; i < 30000; i++) a = [a];"
          : "let a = {}; for (let i = 0; i < 30000; i++) a = {x: a};";
      const dir = tempDirWithFiles("pretty-format-stack", {
        "deep.test.js": `
          import { test, expect } from "bun:test";
          test("deep", () => {
            ${build}
            expect(a).toEqual(${kind === "array" ? '["leaf"]' : '{ x: "leaf" }'});
          });
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "deep.test.js"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
        stdout: "ignore",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      // The diff formatter stopped at the stack limit and the matcher threw its
      // normal mismatch error, so the runner reports a failing test.
      expect(stderr).toContain("expect(received).toEqual(expected)");
      expect(stderr).toContain("1 fail");
      expect(exitCode).toBe(1);
    },
  );
});
