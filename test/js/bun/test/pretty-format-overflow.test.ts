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

  test("JSX element with circular or non-object props", async () => {
    const dir = tempDirWithFiles("pretty-format-jsx", {
      "jsx.test.ts": `
import { test, expect } from "bun:test";

test("circular props", () => {
  const el: any = { $$typeof: Symbol.for("react.element"), type: "div", props: {} };
  el.props = el;
  expect(el).toEqual({});
});

test("circular children", () => {
  const el: any = { $$typeof: Symbol.for("react.element"), type: "div", props: {} };
  el.props.children = el;
  expect(el).toEqual({});
});

test("non-object props", () => {
  const el: any = { $$typeof: Symbol.for("react.element"), type: "div", props: 42 };
  expect(el).toEqual({});
});
`,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "test", "jsx.test.ts"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("SIGSEGV");
    expect(stderr).toContain("[Circular]");
    expect(stderr).toContain("expect(received).toEqual(expected)");
    expect(stderr).toContain("3 fail");
  }, 30000);
});
