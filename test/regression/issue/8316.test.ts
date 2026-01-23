import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Issue #8316: console.log ignores enumerable:false
// https://github.com/oven-sh/bun/issues/8316
//
// When a property is set to enumerable:false, console.log should not
// display it, matching Node.js behavior.

test("console.log should not display enumerable:false properties", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const obj = { a: 1, b: 2 };
console.log(JSON.stringify(Object.keys(obj)));
Object.defineProperty(obj, "b", { enumerable: false });
console.log(obj);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // First line shows keys before modification
  expect(stdout).toContain('["a","b"]');

  // Second part (the object output) should only show 'a' since 'b' is now non-enumerable
  // It should NOT contain "b:" or "b :" in the output
  expect(stdout).toContain("a:");
  expect(stdout).not.toMatch(/\bb:\s/);

  expect(exitCode).toBe(0);
});

test("console.log should not display properties defined with enumerable:false from the start", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const obj = {};
Object.defineProperty(obj, "hidden", { value: "secret", enumerable: false });
Object.defineProperty(obj, "visible", { value: "public", enumerable: true });
console.log(obj);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should show 'visible' but not 'hidden'
  expect(stdout).toContain("visible");
  expect(stdout).toContain("public");
  expect(stdout).not.toContain("hidden");
  expect(stdout).not.toContain("secret");

  expect(exitCode).toBe(0);
});

test("console.log should handle mixed enumerable properties on prototype chain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const proto = {};
Object.defineProperty(proto, "protoHidden", { value: "hiddenVal", enumerable: false });
Object.defineProperty(proto, "protoVisible", { value: "visibleVal", enumerable: true });

const obj = Object.create(proto);
obj.ownProp = "ownVal";
console.log(obj);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should show own property
  expect(stdout).toContain("ownProp");
  expect(stdout).toContain("ownVal");

  // Should not show non-enumerable prototype property
  expect(stdout).not.toContain("protoHidden");
  expect(stdout).not.toContain("hiddenVal");

  expect(exitCode).toBe(0);
});

test("console.log behavior matches Node.js for Object.defineProperty with enumerable:false", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const test = {
  a: 1,
  b: 2,
};

// Before modification - both should be visible
console.log("keys-before:", JSON.stringify(Object.keys(test)));

Object.defineProperty(test, "b", { enumerable: false });

// After modification - only 'a' should be in keys
console.log("keys-after:", JSON.stringify(Object.keys(test)));

// The console.log of the object should only show 'a'
console.log("object:", test);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Verify Object.keys behavior
  expect(stdout).toContain('keys-before: ["a","b"]');
  expect(stdout).toContain('keys-after: ["a"]');

  // The console.log of the object should only show 'a', not 'b'
  // Match the line that starts with "object:" and verify it contains 'a' but not 'b'
  const objectMatch = stdout.match(/object:\s*\{[\s\S]*?\}/);
  expect(objectMatch).not.toBeNull();
  if (objectMatch) {
    expect(objectMatch[0]).toContain("a:");
    expect(objectMatch[0]).not.toMatch(/\bb:/);
  }

  expect(exitCode).toBe(0);
});
