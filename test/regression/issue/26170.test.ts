// https://github.com/oven-sh/bun/issues/26170
// t.after() callback should receive the test context
import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("t.after() callback receives TestContext", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { test } = require("node:test");

test("test with after hook", (t) => {
  t.after((ctx) => {
    if (ctx === undefined) {
      console.log("FAIL: ctx is undefined");
      process.exit(1);
    }
    if (typeof ctx.diagnostic !== "function") {
      console.log("FAIL: ctx.diagnostic is not a function, got:", typeof ctx.diagnostic);
      process.exit(1);
    }
    // Call diagnostic to ensure it works
    ctx.diagnostic("after hook called successfully");
    console.log("PASS: ctx received correctly");
  });
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("PASS: ctx received correctly");
  expect(stdout).not.toContain("FAIL:");
  expect(exitCode).toBe(0);
});

test("t.before() callback receives TestContext", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { test } = require("node:test");

test("test with before hook", (t) => {
  t.before((ctx) => {
    if (ctx === undefined) {
      console.log("FAIL: ctx is undefined");
      process.exit(1);
    }
    if (typeof ctx.name !== "string") {
      console.log("FAIL: ctx.name is not a string, got:", typeof ctx.name);
      process.exit(1);
    }
    console.log("PASS: before ctx received correctly");
  });
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("PASS: before ctx received correctly");
  expect(stdout).not.toContain("FAIL:");
  expect(exitCode).toBe(0);
});

test("t.beforeEach() callback receives TestContext", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { test } = require("node:test");

test("test with beforeEach hook", (t) => {
  t.beforeEach((ctx) => {
    if (ctx === undefined) {
      console.log("FAIL: ctx is undefined");
      process.exit(1);
    }
    console.log("PASS: beforeEach ctx received correctly");
  });
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("PASS: beforeEach ctx received correctly");
  expect(stdout).not.toContain("FAIL:");
  expect(exitCode).toBe(0);
});

test("t.afterEach() callback receives TestContext", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { test } = require("node:test");

test("test with afterEach hook", (t) => {
  t.afterEach((ctx) => {
    if (ctx === undefined) {
      console.log("FAIL: ctx is undefined");
      process.exit(1);
    }
    console.log("PASS: afterEach ctx received correctly");
  });
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("PASS: afterEach ctx received correctly");
  expect(stdout).not.toContain("FAIL:");
  expect(exitCode).toBe(0);
});
