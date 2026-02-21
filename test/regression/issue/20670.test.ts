import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/20670
// Default import from 'bun' was undefined when using --bytecode flag.
// The CJS lowering pass incorrectly added ".default" property access
// to globalThis.Bun, which doesn't have a "default" property.

describe("issue #20670: import from 'bun' with --bytecode", () => {
  test("default import", async () => {
    using dir = tempDir("20670-default", {
      "index.js": `
        import Bun from 'bun';
        console.log(Bun === undefined ? 'FAIL' : 'PASS');
      `,
    });

    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--target=bun",
        "--bytecode",
        "--outdir",
        String(dir) + "/out",
        join(String(dir), "index.js"),
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [buildStderr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
    expect(buildStderr).toBe("");
    expect(buildExit).toBe(0);

    await using run = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "out", "index.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("default import with alias name", async () => {
    using dir = tempDir("20670-alias", {
      "index.js": `
        import MyBun from 'bun';
        console.log(MyBun === undefined ? 'FAIL' : 'PASS');
      `,
    });

    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--target=bun",
        "--bytecode",
        "--outdir",
        String(dir) + "/out",
        join(String(dir), "index.js"),
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [buildStderr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
    expect(buildStderr).toBe("");
    expect(buildExit).toBe(0);

    await using run = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "out", "index.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("default import combined with named import", async () => {
    using dir = tempDir("20670-combined", {
      "index.js": `
        import Bun, { serve } from 'bun';
        console.log(Bun === undefined ? 'FAIL:default' : 'PASS:default');
        console.log(typeof serve === 'function' ? 'PASS:named' : 'FAIL:named');
      `,
    });

    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--target=bun",
        "--bytecode",
        "--outdir",
        String(dir) + "/out",
        join(String(dir), "index.js"),
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [buildStderr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
    expect(buildStderr).toBe("");
    expect(buildExit).toBe(0);

    await using run = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "out", "index.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout).toContain("PASS:default");
    expect(stdout).toContain("PASS:named");
    expect(exitCode).toBe(0);
  });

  test("namespace import", async () => {
    using dir = tempDir("20670-star", {
      "index.js": `
        import * as Bun from 'bun';
        console.log(Bun === undefined ? 'FAIL' : 'PASS');
      `,
    });

    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--target=bun",
        "--bytecode",
        "--outdir",
        String(dir) + "/out",
        join(String(dir), "index.js"),
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [buildStderr, buildExit] = await Promise.all([build.stderr.text(), build.exited]);
    expect(buildStderr).toBe("");
    expect(buildExit).toBe(0);

    await using run = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "out", "index.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  });
});
