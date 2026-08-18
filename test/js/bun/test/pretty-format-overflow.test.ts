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
describe.concurrent("pretty_format and the native stack limit", () => {
  // Several times deeper than the native stack holds for any of these shapes on any platform
  // (a release build gets through about 23k array levels or 5k object levels on Linux's 8 MB main
  // thread stack; macOS and Windows builds get an 18 MB stack, debug builds have far larger frames).
  const depth = 100_000;
  const shapes = {
    array: `let v = []; for (let i = 0; i < ${depth}; i++) v = [v];`,
    // The second key matters for the snapshot cases below: the property walk formats "k" and then
    // goes on to "x", and it does not carry an exception thrown while formatting "k" back out, so
    // refusing the snapshot must not rely on one.
    object: `let v = {}; for (let i = 0; i < ${depth}; i++) v = { k: v, x: 1 };`,
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
    const snapshotFile = join(String(dir), "__snapshots__", "deep.test.ts.snap");
    return {
      stderr,
      exitCode,
      snapshot: existsSync(snapshotFile) ? readFileSync(snapshotFile, "utf8") : null,
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

  // Asymmetric matchers are rendered through a separate entry point that used to wrap the writer
  // once per level, so every write from deep inside the chain went through one extra frame per
  // level below the stack check, and a release build still crashed after the check was added.
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

  // The formatter throws the stack overflow RangeError; the snapshot matchers currently report it
  // as "Failed to pretty format value" (#37334 changes them to rethrow the error itself).
  const formattingFailed = /Maximum call stack size exceeded|Failed to pretty format value/;

  test("toMatchSnapshot on a deep object fails instead of writing a truncated snapshot", async () => {
    const { stderr, exitCode, snapshot } = await runDeepTest(`${shapes.object}\nexpect(v).toMatchSnapshot();`);
    expect(stderr).toMatch(formattingFailed);
    expect(stderr).toContain("1 fail");
    expect(snapshot).toBeNull();
    expect(exitCode).toBe(1);
  });

  test("toMatchInlineSnapshot on a deep object fails instead of writing a truncated snapshot", async () => {
    const { stderr, exitCode, testFileRewritten } = await runDeepTest(
      `${shapes.object}\nexpect(v).toMatchInlineSnapshot();`,
    );
    expect(stderr).toMatch(formattingFailed);
    expect(stderr).toContain("1 fail");
    expect(testFileRewritten).toBe(false);
    expect(exitCode).toBe(1);
  });

  // The limit has to stay well clear of depths in everyday use. A debug build with ASAN, the build
  // with the largest frames, gets through about 500 object levels before the guard fires (a release
  // build about ten times that), so this value has to come out in full both as a snapshot and in a
  // diff, leaf included.
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
