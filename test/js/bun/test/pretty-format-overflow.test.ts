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
});

describe("pretty_format should handle collections with an overridden `size` property", () => {
  test("non-numeric `size` on (Weak)Set/(Weak)Map still produces a toEqual diff", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const values = [];
{
  const weakSet = new WeakSet();
  weakSet.size = BigUint64Array;
  values.push(weakSet);
}
{
  const weakMap = new WeakMap();
  weakMap.size = "not a number";
  values.push(weakMap);
}
{
  const set = new Set([1]);
  Object.defineProperty(set, "size", { value: {} });
  values.push(set);
}
{
  const map = new Map([[1, 2]]);
  Object.defineProperty(map, "size", { value: BigUint64Array });
  values.push(map);
}
for (const value of values) {
  try {
    Bun.jest().expect(BigUint64Array).toEqual(value);
    console.log("DID NOT THROW");
  } catch (e) {
    console.log(e.message.includes("expect(received).toEqual(expected)") ? "DIFF OK" : "UNEXPECTED: " + e.message);
  }
}
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim().split("\n")).toEqual(["DIFF OK", "DIFF OK", "DIFF OK", "DIFF OK"]);
    expect(exitCode).toBe(0);
  });
});
