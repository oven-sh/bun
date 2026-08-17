// Test for integer overflow fix in pretty_format.zig
// Previously crashed with: panic: integer overflow at writeIndent in pretty_format.zig:648
// Platform: Windows x86_64_baseline, Bun v1.3.0

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("pretty_format should handle deeply nested objects without crashing", () => {
  test("deeply nested object with many properties", async () => {
    await using dir = tempDir("pretty-format-overflow", {
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

// Formatting a value nested deeper than the native stack can hold used to recurse until the
// process died with SIGSEGV, taking the whole `bun test` run down with it. The formatter now stops
// before that point: a failure diff shows what was rendered, and a snapshot refuses to serialize
// the value (a truncated snapshot would be stored as if it were complete). Each case runs in a
// subprocess so a regression fails the test instead of the runner.
describe.concurrent("pretty_format on a value deeper than the native stack", () => {
  // Several times deeper than the native stack holds for any of these shapes on any platform
  // (a release build gets through about 23k array levels or 5k object levels on Linux's 8 MB main
  // thread stack; macOS and Windows builds get an 18 MB stack, debug builds have far larger frames).
  const depth = 100_000;
  const shapes = {
    array: `let v = []; for (let i = 0; i < ${depth}; i++) v = [v];`,
    object: `let v = {}; for (let i = 0; i < ${depth}; i++) v = { k: v };`,
    // React elements are formatted by their own arm (Tag::JSX), not the object one.
    "React element": `
      let v = "x";
      for (let i = 0; i < ${depth}; i++) {
        v = { $$typeof: Symbol.for("react.element"), type: "div", key: null, ref: null, props: { children: v } };
      }`,
  };

  async function runDeepTest(body: string) {
    const source = `
      import { test, expect } from "bun:test";
      test("deep", () => {
        ${body}
      });
    `;
    using dir = tempDir("pretty-format-deep", { "deep.test.ts": source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "deep.test.ts"],
      // Snapshot writing is disabled under CI=1 (which bunEnv sets); allow it so that "no snapshot
      // was written" below is the formatter's doing.
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return {
      stderr,
      exitCode,
      snapshotFileWritten: existsSync(join(String(dir), "__snapshots__", "deep.test.ts.snap")),
      testFileRewritten: readFileSync(join(String(dir), "deep.test.ts"), "utf8") !== source,
    };
  }

  for (const [name, build] of Object.entries(shapes)) {
    test(`failing toEqual on a deep ${name} still prints a diff`, async () => {
      const { stderr, exitCode } = await runDeepTest(`${build}\nexpect(v).toEqual(1);`);
      expect(stderr).toContain("expect(received).toEqual(expected)");
      expect(stderr).toContain("+ Received");
      expect(stderr).toContain("1 fail");
      expect(exitCode).toBe(1);
    });
  }

  test("toMatchSnapshot on a deep object throws instead of writing a truncated snapshot", async () => {
    const { stderr, exitCode, snapshotFileWritten } = await runDeepTest(
      `${shapes.object}\nexpect(v).toMatchSnapshot();`,
    );
    expect(stderr).toContain("RangeError: Maximum call stack size exceeded");
    expect(stderr).toContain("1 fail");
    expect(snapshotFileWritten).toBe(false);
    expect(exitCode).toBe(1);
  });

  test("toMatchInlineSnapshot on a deep object throws instead of writing a truncated snapshot", async () => {
    const { stderr, exitCode, testFileRewritten } = await runDeepTest(
      `${shapes.object}\nexpect(v).toMatchInlineSnapshot();`,
    );
    expect(stderr).toContain("RangeError: Maximum call stack size exceeded");
    expect(stderr).toContain("1 fail");
    expect(testFileRewritten).toBe(false);
    expect(exitCode).toBe(1);
  });
});
