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

// A value nested deeper than the native stack can hold. A failure diff shows what was rendered, and a
// snapshot refuses the value: a truncated one would be stored as if it were complete. Each case runs
// in a subprocess, so that a crash fails the test and not the runner.
describe.concurrent("the native stack limit in diffs and snapshots", () => {
  // Several times deeper than the native stack holds on any platform. The walk goes on to "x" after it
  // gave up on "k", so refusing the snapshot cannot rely on an exception coming back out of "k".
  const deepObject = `let v = {}; for (let i = 0; i < 100_000; i++) v = { k: v, x: 1 };`;

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
    const snapshotFile = join(String(dir), "__snapshots__", "deep.test.ts.snap");
    return {
      stderr,
      exitCode,
      snapshot: existsSync(snapshotFile) ? readFileSync(snapshotFile, "utf8") : null,
      testFileRewritten: readFileSync(join(String(dir), "deep.test.ts"), "utf8") !== source,
    };
  }

  test("failing toEqual against a deep expect.objectContaining chain still prints a diff", async () => {
    const { stderr, exitCode } = await runDeepTest(`
      let v = expect.objectContaining({ leaf: 1 });
      for (let i = 0; i < 50_000; i++) v = expect.objectContaining({ k: v });
      expect({ k: 2 }).toEqual(v);
    `);
    expect(stderr).toContain("expect(received).toEqual(expected)");
    expect(stderr).toContain('"k": ObjectContaining {');
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  const formattingFailed = "RangeError: Maximum call stack size exceeded.";

  test("toMatchSnapshot on a deep object fails instead of writing a truncated snapshot", async () => {
    const { stderr, exitCode, snapshot } = await runDeepTest(`${deepObject}\nexpect(v).toMatchSnapshot();`);
    expect(stderr).toContain(formattingFailed);
    expect(stderr).toContain("1 fail");
    expect(snapshot).toBeNull();
    expect(exitCode).toBe(1);
  });

  test("toMatchInlineSnapshot on a deep object fails instead of writing a truncated snapshot", async () => {
    const { stderr, exitCode, testFileRewritten } = await runDeepTest(
      `${deepObject}\nexpect(v).toMatchInlineSnapshot();`,
    );
    expect(stderr).toContain(formattingFailed);
    expect(stderr).toContain("1 fail");
    expect(testFileRewritten).toBe(false);
    expect(exitCode).toBe(1);
  });

  // The limit has to stay well clear of depths in everyday use, on the build with the largest frames too.
  test("a 256-deep object is still serialized in full", async () => {
    const { stderr, exitCode, snapshot } = await runDeepTest(`
      let v = "floor-leaf";
      for (let i = 0; i < 256; i++) v = { k: v, x: 1 };
      expect(v).toMatchSnapshot();
      expect(v).toEqual(1);
    `);
    expect(snapshot).toContain('"floor-leaf"');
    expect(stderr).toContain('"floor-leaf"');
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });
});
