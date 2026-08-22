import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bunfig.toml test options", () => {
  test("randomize with seed produces consistent order", async () => {
    await using dir = tempDir("bunfig-test-randomize-seed", {
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
    await using dir = tempDir("bunfig-test-seed-no-randomize", {
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
    await using dir = tempDir("bunfig-test-seed-randomize-false", {
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
    await using dir = tempDir("bunfig-test-rerun-each", {
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
    await using dir = tempDir("bunfig-test-all-options", {
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

  test.concurrent("test.concurrent option runs all tests concurrently", async () => {
    const testFile = `
import { test, expect } from "bun:test";
import { appendFileSync, readFileSync } from "fs";
import { join } from "path";

const logFile = join(import.meta.dir, "execution.log");

test("test-1", async () => {
  appendFileSync(logFile, "test-1-start\\n");
  const deadline = Date.now() + 3000;
  while (!readFileSync(logFile, "utf8").includes("test-2-start")) {
    if (Date.now() > deadline) break;
    await Bun.sleep(20);
  }
  expect(readFileSync(logFile, "utf8")).toContain("test-2-start");
  appendFileSync(logFile, "test-1-end\\n");
});

test("test-2", async () => {
  appendFileSync(logFile, "test-2-start\\n");
  appendFileSync(logFile, "test-2-end\\n");
  expect(2).toBe(2);
});
`;

    using dir = tempDir("bunfig-test-concurrent", {
      "bunfig.toml": `[test]\nconcurrent = true`,
      "a.test.ts": testFile,
      "execution.log": "",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout + stderr).toContain("2 pass");
    // With concurrent execution both tests start together, so test-1 observes
    // test-2's start marker. In serial mode test-1 hits the poll deadline,
    // its expectation fails, and the run exits non-zero.
    expect(exitCode).toBe(0);
  });

  test.concurrent("CLI --concurrent overrides test.concurrent", async () => {
    const testFile = `
import { test, expect } from "bun:test";
import { appendFileSync, readFileSync } from "fs";
import { join } from "path";

const logFile = join(import.meta.dir, "override.log");

test("test-1", async () => {
  appendFileSync(logFile, "test-1-start\\n");
  const deadline = Date.now() + 3000;
  while (!readFileSync(logFile, "utf8").includes("test-2-start")) {
    if (Date.now() > deadline) break;
    await Bun.sleep(20);
  }
  expect(readFileSync(logFile, "utf8")).toContain("test-2-start");
  appendFileSync(logFile, "test-1-end\\n");
});

test("test-2", async () => {
  appendFileSync(logFile, "test-2-start\\n");
  appendFileSync(logFile, "test-2-end\\n");
  expect(2).toBe(2);
});
`;

    using dir = tempDir("bunfig-test-concurrent-cli", {
      "bunfig.toml": `[test]\nconcurrent = false`,
      "a.test.ts": testFile,
      "override.log": "",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--concurrent"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout + stderr).toContain("2 pass");
    // The CLI flag wins: tests run concurrently even though the config says false.
    expect(exitCode).toBe(0);
  });

  test.concurrent("test.concurrent rejects non-boolean values even with --concurrent", async () => {
    using dir = tempDir("bunfig-test-concurrent-invalid", {
      "bunfig.toml": `[test]\nconcurrent = "true"`,
      "a.test.ts": `import { test, expect } from "bun:test"; test("a", () => expect(1).toBe(1));`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--concurrent"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The type is validated even when --concurrent overrides the value.
    expect(stdout + stderr).toContain("expected boolean but received string");
    expect(exitCode).toBe(1);
  });
});
