// https://github.com/oven-sh/bun/issues/22552
// Macros that return objects with circular references should produce a clear error message
// instead of crashing with a segmentation fault.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("macro with direct circular reference should error gracefully - issue #22552", async () => {
  using dir = tempDir("22552-circular-direct", {
    "circular.ts": `
export function getCircularData(): any {
  const obj: any = { name: "test" };
  obj.self = obj;  // Direct circular reference
  return obj;
}
`,
    "main.ts": `
import { getCircularData } from "./circular.ts" with { type: "macro" };
const data = getCircularData();
console.log(data);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should fail with a clear error message, not crash
  expect(stderr).toContain("circular reference");
  expect(exitCode).toBe(1);
});

test("macro with indirect circular reference should error gracefully - issue #22552", async () => {
  using dir = tempDir("22552-circular-indirect", {
    "circular.ts": `
export function getIndirectCircular(): any {
  const a: any = { name: "a" };
  const b: any = { name: "b" };
  a.ref = b;
  b.ref = a;  // Indirect circular reference
  return a;
}
`,
    "main.ts": `
import { getIndirectCircular } from "./circular.ts" with { type: "macro" };
const data = getIndirectCircular();
console.log(data);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should fail with a clear error message, not crash
  expect(stderr).toContain("circular reference");
  expect(exitCode).toBe(1);
});

test("macro with circular array reference should error gracefully - issue #22552", async () => {
  using dir = tempDir("22552-circular-array", {
    "circular.ts": `
export function getCircularArray(): any {
  const arr: any[] = [1, 2, 3];
  arr.push(arr);  // Array contains itself
  return arr;
}
`,
    "main.ts": `
import { getCircularArray } from "./circular.ts" with { type: "macro" };
const data = getCircularArray();
console.log(data);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should fail with a clear error message, not crash
  expect(stderr).toContain("circular reference");
  expect(exitCode).toBe(1);
});

test("macro with non-circular nested objects should work fine - issue #22552", async () => {
  using dir = tempDir("22552-non-circular", {
    "data.ts": `
export function getNestedData(): any {
  return {
    level1: {
      level2: {
        level3: {
          value: "deep"
        }
      }
    }
  };
}
`,
    "main.ts": `
import { getNestedData } from "./data.ts" with { type: "macro" };
const data = getNestedData();
console.log(data.level1.level2.level3.value);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./main.ts", "--outdir", "./out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Non-circular structures should work fine
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
});
