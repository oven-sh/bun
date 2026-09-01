// The toEqual diff of a 500-level object must print every level and exit 1.
// Two past failures are pinned here: an integer overflow in writeIndent
// (Bun v1.3.0, Windows x64 baseline) and, in the debug build, stack
// exhaustion (exit 139) when each Formatter::print_as frame held the locals
// of every formatting arm.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
    for (let j = 0; j < 5; j++) {
      newObj[\`key\${j}\`] = \`val\${j}\`;
    }
    newObj.nested = nested;
    nested = newObj;
  }

  expect(nested).toEqual({ shouldNotMatch: true });
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "nested.test.ts"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    // The diff goes to stderr. Drain stdout too so the child never blocks on it.
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);

    // The diff header proves the formatter ran; the innermost property proves
    // it walked all 500 levels instead of dying part-way down.
    expect(stderr).toContain("expect(received).toEqual(expected)");
    expect(stderr).toContain('"prop99": "value99"');
    // The assertion mismatch exits 1. A crash exits with a signal code instead.
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  });
});
