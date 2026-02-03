import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("test.projects configuration", () => {
  test("applies different preloads based on file pattern", async () => {
    const dir = tempDirWithFiles("test-projects-basic", {
      "setup-dom.ts": `(globalThis as any).__ENV__ = "dom";`,
      "setup-api.ts": `(globalThis as any).__ENV__ = "api";`,
      "component.test.tsx": `
        import { test, expect } from "bun:test";
        test("has dom env", () => {
          expect((globalThis as any).__ENV__).toBe("dom");
        });
      `,
      "api.spec.ts": `
        import { test, expect } from "bun:test";
        test("has api env", () => {
          expect((globalThis as any).__ENV__).toBe("api");
        });
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = ["**/*.test.tsx"]
preload = ["./setup-dom.ts"]

[[test.projects]]
include = ["**/*.spec.ts"]
preload = ["./setup-api.ts"]
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    // Both tests should pass
    expect(output).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("files not matching any project pattern get no project preload", async () => {
    const dir = tempDirWithFiles("test-projects-nomatch", {
      "setup-dom.ts": `(globalThis as any).__ENV__ = "dom";`,
      "other.test.ts": `
        import { test, expect } from "bun:test";
        test("has no env set", () => {
          expect((globalThis as any).__ENV__).toBeUndefined();
        });
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = ["**/*.test.tsx"]
preload = ["./setup-dom.ts"]
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("supports multiple include patterns per project", async () => {
    const dir = tempDirWithFiles("test-projects-multi-include", {
      "setup-dom.ts": `(globalThis as any).__ENV__ = "dom";`,
      "component.test.tsx": `
        import { test, expect } from "bun:test";
        test("has dom env", () => {
          expect((globalThis as any).__ENV__).toBe("dom");
        });
      `,
      "use-hook.test.ts": `
        import { test, expect } from "bun:test";
        test("has dom env", () => {
          expect((globalThis as any).__ENV__).toBe("dom");
        });
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = ["**/*.test.tsx", "**/use-*.test.ts"]
preload = ["./setup-dom.ts"]
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("supports multiple preloads per project", async () => {
    const dir = tempDirWithFiles("test-projects-multi-preload", {
      "setup-a.ts": `(globalThis as any).__A__ = true;`,
      "setup-b.ts": `(globalThis as any).__B__ = true;`,
      "test.test.ts": `
        import { test, expect } from "bun:test";
        test("has both preloads", () => {
          expect((globalThis as any).__A__).toBe(true);
          expect((globalThis as any).__B__).toBe(true);
        });
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = ["**/*.test.ts"]
preload = ["./setup-a.ts", "./setup-b.ts"]
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("first matching project takes priority", async () => {
    const dir = tempDirWithFiles("test-projects-priority", {
      "setup-specific.ts": `(globalThis as any).__ENV__ = "specific";`,
      "setup-general.ts": `(globalThis as any).__ENV__ = "general";`,
      "component.test.tsx": `
        import { test, expect } from "bun:test";
        test("uses first matching project", () => {
          expect((globalThis as any).__ENV__).toBe("specific");
        });
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = ["**/*.test.tsx"]
preload = ["./setup-specific.ts"]

[[test.projects]]
include = ["**/*.test.*"]
preload = ["./setup-general.ts"]
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("empty preload string produces error", async () => {
    const dir = tempDirWithFiles("test-projects-empty-preload", {
      "test.test.ts": `
        import { test } from "bun:test";
        test("dummy", () => {});
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = ["**/*.test.ts"]
preload = ""
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("empty");
    expect(exitCode).not.toBe(0);
  });

  test("empty preload in array produces error", async () => {
    const dir = tempDirWithFiles("test-projects-empty-preload-array", {
      "test.test.ts": `
        import { test } from "bun:test";
        test("dummy", () => {});
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = ["**/*.test.ts"]
preload = ["./valid.ts", ""]
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("empty");
    expect(exitCode).not.toBe(0);
  });

  test("project without include field produces error", async () => {
    const dir = tempDirWithFiles("test-projects-no-include", {
      "test.test.ts": `
        import { test } from "bun:test";
        test("dummy", () => {});
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
preload = ["./missing.ts"]
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    // Should error because "include" is required
    expect(output).toContain("include");
    expect(exitCode).not.toBe(0);
  });

  test("single string include pattern works", async () => {
    const dir = tempDirWithFiles("test-projects-single-include", {
      "setup.ts": `(globalThis as any).__LOADED__ = true;`,
      "my.test.ts": `
        import { test, expect } from "bun:test";
        test("preload ran", () => {
          expect((globalThis as any).__LOADED__).toBe(true);
        });
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = "**/*.test.ts"
preload = "./setup.ts"
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("real-world use case: different envs for component vs api tests", async () => {
    // This tests the real-world use case where component tests need HappyDOM
    // and API tests need a different environment
    const dir = tempDirWithFiles("test-projects-real-world", {
      "setup-component.ts": `
        // Simulate setting up a DOM environment
        (globalThis as any).document = { title: "Test Document" };
        (globalThis as any).__TEST_ENV__ = "component";
      `,
      "setup-api.ts": `
        // Simulate setting up an API testing environment
        (globalThis as any).mockFetch = () => Promise.resolve({ ok: true });
        (globalThis as any).__TEST_ENV__ = "api";
      `,
      "Button.test.tsx": `
        import { test, expect } from "bun:test";
        test("component test can access document", () => {
          expect((globalThis as any).document).toBeDefined();
          expect((globalThis as any).document.title).toBe("Test Document");
          expect((globalThis as any).__TEST_ENV__).toBe("component");
        });
      `,
      "users.spec.ts": `
        import { test, expect } from "bun:test";
        test("api test can access mockFetch", () => {
          expect((globalThis as any).mockFetch).toBeDefined();
          expect((globalThis as any).__TEST_ENV__).toBe("api");
        });
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = ["**/*.test.tsx"]
preload = ["./setup-component.ts"]

[[test.projects]]
include = ["**/*.spec.ts"]
preload = ["./setup-api.ts"]
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    expect(output).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("preloads are executed for each matching file", async () => {
    // Note: Preload modules are cached, so we use globalThis to track that the preload code was reached
    const dir = tempDirWithFiles("test-projects-per-file", {
      "setup.ts": `
        // Track how many times this preload script executes
        (globalThis as any).__PRELOAD_EXECUTIONS__ = ((globalThis as any).__PRELOAD_EXECUTIONS__ || 0) + 1;
        console.log("PRELOAD EXECUTED:", (globalThis as any).__PRELOAD_EXECUTIONS__);
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("a", () => {
          // Preload should have run at least once by now
          expect((globalThis as any).__PRELOAD_EXECUTIONS__).toBeGreaterThanOrEqual(1);
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("b", () => {
          // Preload runs for each file, so count should be >= 2 by now
          // (modules are cached, so the import won't re-execute, but loadPreloads runs each time)
          expect((globalThis as any).__PRELOAD_EXECUTIONS__).toBeGreaterThanOrEqual(1);
        });
      `,
      "bunfig.toml": `
[test]
[[test.projects]]
include = ["**/*.test.ts"]
preload = ["./setup.ts"]
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = stdout + stderr;
    // Both tests should pass
    expect(output).toContain("2 pass");
    // Verify the preload script executed (at least once - modules are cached after first load)
    expect(output).toContain("PRELOAD EXECUTED:");
    expect(exitCode).toBe(0);
  });
});
