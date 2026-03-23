import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe.concurrent("NO_COLOR does not affect snapshot output", () => {
  test("toThrowErrorMatchingSnapshot does not contain ANSI escape codes", async () => {
    using dir = tempDir("issue-28439", {
      "test.test.ts": `
        import { test, expect } from "bun:test";
        test("snapshot has no ansi", () => {
          expect(() => {
            expect({ a: 1 }).toMatchObject({ a: 2 });
          }).toThrowErrorMatchingSnapshot();
        });
      `,
    });

    // Run with FORCE_COLOR=1 to simulate a TTY/Windows environment
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--update-snapshots", "test.test.ts"],
      env: { ...bunEnv, FORCE_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const snapFile = join(String(dir), "__snapshots__", "test.test.ts.snap");
    const snapContent = await Bun.file(snapFile).text();

    // Snapshot must not contain ANSI escape codes
    expect(snapContent).not.toContain("\\x1B");
    expect(snapContent).not.toMatch(/\x1b/);

    // Snapshot should contain the clean error text
    expect(snapContent).toContain("expect(received).toMatchObject(expected)");
    expect(exitCode).toBe(0);
  });

  test("NO_COLOR from --env-file disables colors for test output", async () => {
    using dir = tempDir("issue-28439-envfile", {
      ".env.test": "NO_COLOR=1\n",
      "test.test.ts": `
        import { test, expect } from "bun:test";
        test("snapshot has no ansi with env-file", () => {
          expect(() => {
            expect({ a: 1 }).toMatchObject({ a: 2 });
          }).toThrowErrorMatchingSnapshot();
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--env-file=.env.test", "test", "--update-snapshots", "test.test.ts"],
      env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const snapFile = join(String(dir), "__snapshots__", "test.test.ts.snap");
    const snapContent = await Bun.file(snapFile).text();

    // Snapshot must not contain ANSI escape codes
    expect(snapContent).not.toContain("\\x1B");
    expect(snapContent).not.toMatch(/\x1b/);
    expect(snapContent).toContain("expect(received).toMatchObject(expected)");
    expect(exitCode).toBe(0);
  });

  test("FORCE_COLOR=0 from --env-file disables colors", async () => {
    using dir = tempDir("issue-28439-force0", {
      ".env.test": "FORCE_COLOR=0\n",
      "test.test.ts": `
        import { test, expect } from "bun:test";
        test("snapshot has no ansi with force_color=0", () => {
          expect(() => {
            expect({ a: 1 }).toMatchObject({ a: 2 });
          }).toThrowErrorMatchingSnapshot();
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--env-file=.env.test", "test", "--update-snapshots", "test.test.ts"],
      env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const snapFile = join(String(dir), "__snapshots__", "test.test.ts.snap");
    const snapContent = await Bun.file(snapFile).text();

    expect(snapContent).not.toContain("\\x1B");
    expect(snapContent).not.toMatch(/\x1b/);
    expect(snapContent).toContain("expect(received).toMatchObject(expected)");
    expect(exitCode).toBe(0);
  });
});
