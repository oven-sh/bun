import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("issue/28501", () => {
  test("node:test done-style callback fails on assertion error in async callback", { timeout: 30_000 }, async () => {
    using dir = tempDir("issue-28501", {
      "a.test.cjs": `
"use strict";
const { describe, test } = require("node:test");
const assert = require("node:assert");

describe("describe wrapper", () => {
  test("callback test", (t, done) => {
    setTimeout(() => {
      assert.ok(false, "oh no an assert failed");
      done();
    });
  });
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("1 fail");
    expect(exitCode).not.toBe(0);
  });

  test("node:test done-style callback passes when done() is called without error", { timeout: 30_000 }, async () => {
    using dir = tempDir("issue-28501", {
      "a.test.cjs": `
"use strict";
const { describe, test } = require("node:test");

describe("describe wrapper", () => {
  test("callback test", (t, done) => {
    setTimeout(() => {
      done();
    });
  });
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("node:test done-style callback fails when done(err) is called", { timeout: 30_000 }, async () => {
    using dir = tempDir("issue-28501", {
      "a.test.cjs": `
"use strict";
const { describe, test } = require("node:test");

describe("describe wrapper", () => {
  test("callback test", (t, done) => {
    setTimeout(() => {
      done(new Error("intentional failure"));
    });
  });
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("1 fail");
    expect(exitCode).not.toBe(0);
  });

  test("node:test async done-style callback fails on promise rejection", { timeout: 30_000 }, async () => {
    using dir = tempDir("issue-28501", {
      "a.test.cjs": `
"use strict";
const { describe, test } = require("node:test");

describe("describe wrapper", () => {
  test("async callback test", async (t, done) => {
    await Promise.reject(new Error("async rejection"));
    done();
  });
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("1 fail");
    expect(exitCode).not.toBe(0);
  });

  test("node:test non-done-style test still works", { timeout: 30_000 }, async () => {
    using dir = tempDir("issue-28501", {
      "a.test.cjs": `
"use strict";
const { describe, test } = require("node:test");
const assert = require("node:assert");

describe("describe wrapper", () => {
  test("sync test", (t) => {
    assert.ok(true, "sync assertion works");
  });

  test("async test", async (t) => {
    await Promise.resolve();
    assert.ok(true, "async assertion works");
  });
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});
