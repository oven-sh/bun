import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bunfig.toml test options", () => {
  test("randomize with seed produces consistent order", async () => {
    const dir = tempDirWithFiles("bunfig-test-randomize-seed", {
      "test.test.ts": `
        import { test, expect } from "bun:test";
        test("alpha", () => {
          console.log("RUNNING: alpha");
          expect(1).toBe(1);
        });
        test("bravo", () => {
          console.log("RUNNING: bravo");
          expect(2).toBe(2);
        });
        test("charlie", () => {
          console.log("RUNNING: charlie");
          expect(3).toBe(3);
        });
        test("delta", () => {
          console.log("RUNNING: delta");
          expect(4).toBe(4);
        });
        test("echo", () => {
          console.log("RUNNING: echo");
          expect(5).toBe(5);
        });
      `,
      "bunfig.toml": `[test]\nrandomize = true\nseed = 2444615283`,
    });

    // Run twice to verify same order
    const outputs: string[] = [];
    for (let i = 0; i < 2; i++) {
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
      outputs.push(stdout + stderr);
    }

    // Extract the order tests ran in
    const extractOrder = (output: string) => {
      const matches = output.matchAll(/RUNNING: (\w+)/g);
      return Array.from(matches, m => m[1]);
    };

    const order1 = extractOrder(outputs[0]);
    const order2 = extractOrder(outputs[1]);

    // Should have all 5 tests
    expect(order1.length).toBe(5);
    expect(order2.length).toBe(5);

    // Order should be identical across runs
    expect(order1).toEqual(order2);

    // Order should NOT be alphabetical (tests randomization is working)
    const alphabetical = ["alpha", "bravo", "charlie", "delta", "echo"];
    expect(order1).not.toEqual(alphabetical);

    // Snapshot the actual order for regression testing
    expect(order1).toMatchSnapshot();
  });

  test("seed without randomize errors", async () => {
    const dir = tempDirWithFiles("bunfig-test-seed-no-randomize", {
      "test.test.ts": `
        import { test, expect } from "bun:test";
        test("test 1", () => expect(1).toBe(1));
      `,
      "bunfig.toml": `[test]\nseed = 2444615283`,
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

    expect(exitCode).toBe(1);
    const output = stdout + stderr;
    expect(output).toContain("seed");
    expect(output).toContain("randomize");
  });

  test("seed with randomize=false errors", async () => {
    const dir = tempDirWithFiles("bunfig-test-seed-randomize-false", {
      "test.test.ts": `
        import { test, expect } from "bun:test";
        test("test 1", () => expect(1).toBe(1));
      `,
      "bunfig.toml": `[test]\nrandomize = false\nseed = 2444615283`,
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

    expect(exitCode).toBe(1);
    const output = stdout + stderr;
    expect(output).toContain("seed");
    expect(output).toContain("randomize");
  });

  test("rerunEach option works", async () => {
    const dir = tempDirWithFiles("bunfig-test-rerun-each", {
      "test.test.ts": `
        import { test, expect } from "bun:test";
        let counter = 0;
        test("test 1", () => {
          counter++;
          expect(counter).toBeGreaterThan(0);
        });
      `,
      "bunfig.toml": `[test]\nrerunEach = 3`,
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
    // With rerunEach = 3, the test file should run 3 times
    // So we should see "3 pass" (1 test * 3 runs)
    expect(output).toContain("3 pass");
  });

  test("all test options together", async () => {
    const dir = tempDirWithFiles("bunfig-test-all-options", {
      "test.test.ts": `
        import { test, expect } from "bun:test";
        test("test 1", () => expect(1).toBe(1));
        test("test 2", () => expect(2).toBe(2));
      `,
      "bunfig.toml": `[test]\nrandomize = true\nseed = 12345\nrerunEach = 2`,
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
    // 2 tests * 2 reruns = 4 total test runs
    expect(output).toContain("4 pass");
  });

  test("testPathIgnorePatterns excludes matching files", async () => {
    const dir = tempDirWithFiles("bunfig-test-ignore-patterns", {
      "included.test.ts": `
        import { test, expect } from "bun:test";
        test("included", () => {
          console.log("RUNNING: included");
          expect(1).toBe(1);
        });
      `,
      "ignored.test.ts": `
        import { test, expect } from "bun:test";
        test("ignored", () => {
          console.log("RUNNING: ignored");
          expect(1).toBe(1);
        });
      `,
      "bunfig.toml": `[test]\ntestPathIgnorePatterns = ["ignored.test.ts"]`,
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
    // Only the included test should run
    expect(output).toContain("RUNNING: included");
    expect(output).not.toContain("RUNNING: ignored");
    expect(output).toContain("1 pass");
  });

  test("testPathIgnorePatterns works with glob patterns", async () => {
    const dir = tempDirWithFiles("bunfig-test-ignore-glob", {
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("test a", () => {
          console.log("RUNNING: a");
          expect(1).toBe(1);
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("test b", () => {
          console.log("RUNNING: b");
          expect(1).toBe(1);
        });
      `,
      "ignored/c.test.ts": `
        import { test, expect } from "bun:test";
        test("test c", () => {
          console.log("RUNNING: c");
          expect(1).toBe(1);
        });
      `,
      "bunfig.toml": `[test]\ntestPathIgnorePatterns = ["ignored/**"]`,
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
    expect(output).toContain("RUNNING: a");
    expect(output).toContain("RUNNING: b");
    expect(output).not.toContain("RUNNING: c");
    expect(output).toContain("2 pass");
  });

  test("testPathIgnorePatterns works with single string", async () => {
    const dir = tempDirWithFiles("bunfig-test-ignore-string", {
      "included.test.ts": `
        import { test, expect } from "bun:test";
        test("included", () => {
          console.log("RUNNING: included");
          expect(1).toBe(1);
        });
      `,
      "skipped.test.ts": `
        import { test, expect } from "bun:test";
        test("skipped", () => {
          console.log("RUNNING: skipped");
          expect(1).toBe(1);
        });
      `,
      "bunfig.toml": `[test]\ntestPathIgnorePatterns = "**/skipped*"`,
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
    expect(output).toContain("RUNNING: included");
    expect(output).not.toContain("RUNNING: skipped");
    expect(output).toContain("1 pass");
  });

  test("testPathIgnorePatterns excludes matching directories", async () => {
    const dir = tempDirWithFiles("bunfig-test-ignore-dir", {
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("test a", () => {
          console.log("RUNNING: a");
          expect(1).toBe(1);
        });
      `,
      "__fixtures__/fixture.test.ts": `
        import { test, expect } from "bun:test";
        test("fixture test", () => {
          console.log("RUNNING: fixture");
          expect(1).toBe(1);
        });
      `,
      "bunfig.toml": `[test]\ntestPathIgnorePatterns = ["__fixtures__"]`,
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
    expect(output).toContain("RUNNING: a");
    expect(output).not.toContain("RUNNING: fixture");
    expect(output).toContain("1 pass");
  });
});
