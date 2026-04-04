import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("objects returned from macros should be mutable", async () => {
  using dir = tempDir("issue-26362", {
    "macro.ts": `export const getObj = () => ({});`,
    "index.ts": `
import { getObj } from "./macro.ts" with { type: "macro" };

const obj = getObj();

// Object should be extensible (not frozen/sealed)
if (!Object.isExtensible(obj)) {
  throw new Error("Object is not extensible");
}

// Should be able to add properties
obj.foo = "bar";

// Should be able to read back the property we just set
if (obj.foo !== "bar") {
  throw new Error("Property was not set correctly, got: " + obj.foo);
}

console.log("success");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toInclude("success");
  expect(exitCode).toBe(0);
});

test("arrays returned from macros should be mutable", async () => {
  using dir = tempDir("issue-26362-array", {
    "macro.ts": `export const getArr = () => [];`,
    "index.ts": `
import { getArr } from "./macro.ts" with { type: "macro" };

const arr = getArr();

// Array should be extensible
if (!Object.isExtensible(arr)) {
  throw new Error("Array is not extensible");
}

// Should be able to push elements
arr.push("first");

// Should be able to read back what we pushed
if (arr[0] !== "first") {
  throw new Error("Element was not pushed correctly, got: " + arr[0]);
}

if (arr.length !== 1) {
  throw new Error("Array length is wrong, got: " + arr.length);
}

console.log("success");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toInclude("success");
  expect(exitCode).toBe(0);
});
