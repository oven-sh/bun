import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("block-scoped function declarations not accessible outside block in strict mode", async () => {
  using dir = tempDir("issue-14715", {
    "index.js": `"use strict";
try { f; console.log("BUG"); } catch(e) { console.log("PASS: " + e.message); }
{ function f() {} }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("PASS:");
  expect(stdout).not.toContain("BUG");
  expect(exitCode).toBe(0);
});

test("bare reference to block-scoped function throws ReferenceError in strict mode", async () => {
  using dir = tempDir("issue-14715", {
    "index.js": `"use strict";
f;
{ function f() {} }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("ReferenceError");
  expect(exitCode).not.toBe(0);
});

test("block-scoped function in ESM (with export) not accessible outside block", async () => {
  using dir = tempDir("issue-14715", {
    "index.mjs": `try { f; console.log("BUG"); } catch(e) { console.log("PASS: " + e.message); }
{ function f() {} }
export {};`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("PASS:");
  expect(stdout).not.toContain("BUG");
  expect(exitCode).toBe(0);
});

test("block-scoped function accessible inside block in strict mode", async () => {
  using dir = tempDir("issue-14715", {
    "index.js": `"use strict";
{ function f() { return 42; } console.log("RESULT: " + f()); }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("RESULT: 42");
  expect(exitCode).toBe(0);
});
