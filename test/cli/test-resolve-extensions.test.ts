import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bun test --resolve-extensions", () => {
  test("CLI flag allows custom test file suffixes", async () => {
    const dir = tempDirWithFiles("resolve-extensions-cli", {
      "mytest.check.ts": `
        import { test, expect } from "bun:test";
        test("check test", () => {
          console.log("RUNNING: check test");
          expect(1).toBe(1);
        });
      `,
      "regular.test.ts": `
        import { test, expect } from "bun:test";
        test("regular test", () => {
          console.log("RUNNING: regular test");
          expect(2).toBe(2);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--resolve-extensions", ".check"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain("RUNNING: check test");
    expect(output).not.toContain("RUNNING: regular test");
    expect(output).toContain("1 pass");
  });

  test("CLI flag supports multiple extensions", async () => {
    const dir = tempDirWithFiles("resolve-extensions-multiple", {
      "alpha.check.ts": `
        import { test, expect } from "bun:test";
        test("check test", () => {
          console.log("RUNNING: check");
          expect(1).toBe(1);
        });
      `,
      "beta.verify.ts": `
        import { test, expect } from "bun:test";
        test("verify test", () => {
          console.log("RUNNING: verify");
          expect(2).toBe(2);
        });
      `,
      "gamma.test.ts": `
        import { test, expect } from "bun:test";
        test("regular test", () => {
          console.log("RUNNING: regular");
          expect(3).toBe(3);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--resolve-extensions", ".check", "--resolve-extensions", ".verify"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain("RUNNING: check");
    expect(output).toContain("RUNNING: verify");
    expect(output).not.toContain("RUNNING: regular");
    expect(output).toContain("2 pass");
  });

  test("bunfig.toml resolveExtensions as string", async () => {
    const dir = tempDirWithFiles("resolve-extensions-bunfig-string", {
      "mytest.check.ts": `
        import { test, expect } from "bun:test";
        test("check test", () => {
          console.log("RUNNING: check test");
          expect(1).toBe(1);
        });
      `,
      "regular.test.ts": `
        import { test, expect } from "bun:test";
        test("regular test", () => {
          console.log("RUNNING: regular test");
          expect(2).toBe(2);
        });
      `,
      "bunfig.toml": `[test]\nresolveExtensions = ".check"`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain("RUNNING: check test");
    expect(output).not.toContain("RUNNING: regular test");
    expect(output).toContain("1 pass");
  });

  test("bunfig.toml resolveExtensions as array", async () => {
    const dir = tempDirWithFiles("resolve-extensions-bunfig-array", {
      "alpha.check.ts": `
        import { test, expect } from "bun:test";
        test("check test", () => {
          console.log("RUNNING: check");
          expect(1).toBe(1);
        });
      `,
      "beta.verify.ts": `
        import { test, expect } from "bun:test";
        test("verify test", () => {
          console.log("RUNNING: verify");
          expect(2).toBe(2);
        });
      `,
      "gamma.test.ts": `
        import { test, expect } from "bun:test";
        test("regular test", () => {
          console.log("RUNNING: regular");
          expect(3).toBe(3);
        });
      `,
      "bunfig.toml": `[test]\nresolveExtensions = [".check", ".verify"]`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain("RUNNING: check");
    expect(output).toContain("RUNNING: verify");
    expect(output).not.toContain("RUNNING: regular");
    expect(output).toContain("2 pass");
  });

  test("CLI flag overrides bunfig.toml", async () => {
    const dir = tempDirWithFiles("resolve-extensions-cli-override", {
      "alpha.check.ts": `
        import { test, expect } from "bun:test";
        test("check test", () => {
          console.log("RUNNING: check");
          expect(1).toBe(1);
        });
      `,
      "beta.verify.ts": `
        import { test, expect } from "bun:test";
        test("verify test", () => {
          console.log("RUNNING: verify");
          expect(2).toBe(2);
        });
      `,
      "bunfig.toml": `[test]\nresolveExtensions = ".check"`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--resolve-extensions", ".verify"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).not.toContain("RUNNING: check");
    expect(output).toContain("RUNNING: verify");
    expect(output).toContain("1 pass");
  });

  test("custom extensions work with underscore prefix", async () => {
    const dir = tempDirWithFiles("resolve-extensions-underscore", {
      "mytest_check.ts": `
        import { test, expect } from "bun:test";
        test("check test", () => {
          console.log("RUNNING: check");
          expect(1).toBe(1);
        });
      `,
      "regular.test.ts": `
        import { test, expect } from "bun:test";
        test("regular test", () => {
          console.log("RUNNING: regular");
          expect(2).toBe(2);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--resolve-extensions", "_check"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain("RUNNING: check");
    expect(output).not.toContain("RUNNING: regular");
    expect(output).toContain("1 pass");
  });

  test("no tests found shows custom extensions in error message", async () => {
    const dir = tempDirWithFiles("resolve-extensions-no-tests", {
      "regular.test.ts": `
        import { test, expect } from "bun:test";
        test("regular test", () => expect(1).toBe(1));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--resolve-extensions", ".custom"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(1);
    const output = stdout + stderr;
    expect(output).toContain("No tests found");
    expect(output).toContain(".custom");
  });

  test("works with nested directories", async () => {
    const dir = tempDirWithFiles("resolve-extensions-nested", {
      "src/feature/alpha.check.ts": `
        import { test, expect } from "bun:test";
        test("nested check", () => {
          console.log("RUNNING: nested check");
          expect(1).toBe(1);
        });
      `,
      "src/feature/beta.test.ts": `
        import { test, expect } from "bun:test";
        test("nested test", () => {
          console.log("RUNNING: nested test");
          expect(2).toBe(2);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--resolve-extensions", ".check"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain("RUNNING: nested check");
    expect(output).not.toContain("RUNNING: nested test");
    expect(output).toContain("1 pass");
  });

  test("works with default extensions when not specified", async () => {
    const dir = tempDirWithFiles("resolve-extensions-default", {
      "alpha.test.ts": `
        import { test, expect } from "bun:test";
        test("test suffix", () => {
          console.log("RUNNING: test");
          expect(1).toBe(1);
        });
      `,
      "beta.spec.ts": `
        import { test, expect } from "bun:test";
        test("spec suffix", () => {
          console.log("RUNNING: spec");
          expect(2).toBe(2);
        });
      `,
      "gamma_test.ts": `
        import { test, expect } from "bun:test";
        test("_test suffix", () => {
          console.log("RUNNING: _test");
          expect(3).toBe(3);
        });
      `,
      "delta_spec.ts": `
        import { test, expect } from "bun:test";
        test("_spec suffix", () => {
          console.log("RUNNING: _spec");
          expect(4).toBe(4);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain("RUNNING: test");
    expect(output).toContain("RUNNING: spec");
    expect(output).toContain("RUNNING: _test");
    expect(output).toContain("RUNNING: _spec");
    expect(output).toContain("4 pass");
  });
});
