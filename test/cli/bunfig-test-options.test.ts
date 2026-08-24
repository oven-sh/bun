import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

  // A `bun test` flag wins over the same `[test]` key in bunfig.toml.
  describe("[test] keys and command line flags", () => {
    const files = {
      "helper.ts": `
        export function covered() { return 1; }
        export function uncovered() { return 2; }
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { covered } from "./helper";
        test("alpha", () => expect(covered()).toBe(1));
        test("bravo", () => expect(2).toBe(2));
      `,
    };

    async function runTest(dir: string, ...flags: string[]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...flags, "a.test.ts"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test.concurrent("--reporter-outfile wins over [test.reporter] junit", async () => {
      using dir = tempDir("bunfig-reporter-outfile-cli", {
        ...files,
        "bunfig.toml": `[test.reporter]\njunit = "from-bunfig.xml"`,
      });

      const { stderr, exitCode } = await runTest(
        String(dir),
        "--reporter=junit",
        `--reporter-outfile=${join(String(dir), "cli.xml")}`,
      );
      expect(stderr).toContain("2 pass");
      expect(existsSync(join(String(dir), "from-bunfig.xml"))).toBe(false);
      const xml = readFileSync(join(String(dir), "cli.xml"), "utf8");
      expect(xml).toContain("<testsuites");
      expect(xml).toContain('name="alpha"');
      expect(xml).toContain('name="bravo"');
      expect(exitCode).toBe(0);
    });

    test.concurrent("--reporter-outfile without --reporter names the file for [test.reporter] junit", async () => {
      using dir = tempDir("bunfig-reporter-outfile-only", {
        ...files,
        "bunfig.toml": `[test.reporter]\njunit = "from-bunfig.xml"`,
      });

      const { stderr, exitCode } = await runTest(String(dir), `--reporter-outfile=${join(String(dir), "cli.xml")}`);
      expect(stderr).toContain("2 pass");
      expect(existsSync(join(String(dir), "from-bunfig.xml"))).toBe(false);
      expect(readFileSync(join(String(dir), "cli.xml"), "utf8")).toContain('name="alpha"');
      expect(exitCode).toBe(0);
    });

    test.concurrent("[test.reporter] junit writes its own path when the command line has no outfile", async () => {
      using dir = tempDir("bunfig-reporter-junit-default", {
        ...files,
        "bunfig.toml": `[test.reporter]\njunit = "from-bunfig.xml"`,
      });

      const { stderr, exitCode } = await runTest(String(dir));
      expect(stderr).toContain("2 pass");
      expect(readFileSync(join(String(dir), "from-bunfig.xml"), "utf8")).toContain('name="alpha"');
      expect(exitCode).toBe(0);
    });

    test.concurrent("--dots wins over [test.reporter] dots = false", async () => {
      using dir = tempDir("bunfig-reporter-dots-cli", {
        ...files,
        "bunfig.toml": `[test.reporter]\ndots = false`,
      });

      const { stdout, stderr, exitCode } = await runTest(String(dir), "--dots");
      expect(stderr).toContain("2 pass");
      const output = stdout + stderr;
      expect(output).toContain("..");
      expect(output).not.toContain("(pass)");
      expect(exitCode).toBe(0);
    });

    test.concurrent("[test.reporter] dots = true still applies next to --reporter=junit", async () => {
      using dir = tempDir("bunfig-reporter-dots-and-junit", {
        ...files,
        "bunfig.toml": `[test.reporter]\ndots = true`,
      });

      const { stdout, stderr, exitCode } = await runTest(
        String(dir),
        "--reporter=junit",
        `--reporter-outfile=${join(String(dir), "cli.xml")}`,
      );
      expect(stderr).toContain("2 pass");
      const output = stdout + stderr;
      expect(output).toContain("..");
      expect(output).not.toContain("(pass)");
      expect(readFileSync(join(String(dir), "cli.xml"), "utf8")).toContain('name="alpha"');
      expect(exitCode).toBe(0);
    });

    test.concurrent("--reporter=junit accepts the outfile from [test.reporter] junit", async () => {
      using dir = tempDir("bunfig-reporter-junit-flag-only", {
        ...files,
        "bunfig.toml": `[test.reporter]\njunit = "from-bunfig.xml"`,
      });

      const { stderr, exitCode } = await runTest(String(dir), "--reporter=junit");
      expect(stderr).toContain("2 pass");
      expect(readFileSync(join(String(dir), "from-bunfig.xml"), "utf8")).toContain('name="alpha"');
      expect(exitCode).toBe(0);
    });

    test.concurrent("--coverage wins over [test] coverage = false", async () => {
      using dir = tempDir("bunfig-coverage-cli", {
        ...files,
        "bunfig.toml": `[test]\ncoverage = false`,
      });

      const { stdout, stderr, exitCode } = await runTest(String(dir), "--coverage");
      expect(stderr).toContain("2 pass");
      const output = stdout + stderr;
      expect(output).toContain("% Funcs");
      expect(output).toContain("helper.ts");
      expect(exitCode).toBe(0);
    });

    test.concurrent("--coverage-reporter wins over [test] coverageReporter", async () => {
      using dir = tempDir("bunfig-coverage-reporter-cli", {
        ...files,
        "bunfig.toml": `[test]\ncoverage = true\ncoverageReporter = "lcov"`,
      });

      const { stdout, stderr, exitCode } = await runTest(String(dir), "--coverage-reporter", "text");
      expect(stderr).toContain("2 pass");
      expect(stdout + stderr).toContain("% Funcs");
      expect(existsSync(join(String(dir), "coverage", "lcov.info"))).toBe(false);
      expect(exitCode).toBe(0);
    });

    test.concurrent("--coverage-dir wins over [test] coverageDir", async () => {
      using dir = tempDir("bunfig-coverage-dir-cli", {
        ...files,
        "bunfig.toml": `[test]\ncoverage = true\ncoverageReporter = "lcov"\ncoverageDir = "from-bunfig"`,
      });

      const { stderr, exitCode } = await runTest(String(dir), "--coverage-dir", "from-cli");
      expect(stderr).toContain("2 pass");
      expect(existsSync(join(String(dir), "from-bunfig"))).toBe(false);
      expect(readFileSync(join(String(dir), "from-cli", "lcov.info"), "utf8")).toContain("SF:");
      expect(exitCode).toBe(0);
    });

    test.concurrent("--only-failures wins over [test] onlyFailures = false", async () => {
      using dir = tempDir("bunfig-only-failures-cli", {
        ...files,
        "bunfig.toml": `[test]\nonlyFailures = false`,
      });

      const { stdout, stderr, exitCode } = await runTest(String(dir), "--only-failures");
      expect(stderr).toContain("2 pass");
      expect(stdout + stderr).not.toContain("(pass)");
      expect(exitCode).toBe(0);
    });

    test.concurrent("--randomize wins over [test] randomize = false", async () => {
      using dir = tempDir("bunfig-randomize-cli", {
        ...files,
        "bunfig.toml": `[test]\nrandomize = false`,
      });

      const { stderr, exitCode } = await runTest(String(dir), "--randomize");
      expect(stderr).toContain("2 pass");
      expect(stderr).toMatch(/--seed=\d+/);
      expect(exitCode).toBe(0);
    });

    test.concurrent("--randomize satisfies the randomize requirement of [test] seed", async () => {
      using dir = tempDir("bunfig-seed-cli-randomize", {
        ...files,
        "bunfig.toml": `[test]\nseed = 2444615283`,
      });

      const { stderr, exitCode } = await runTest(String(dir), "--randomize");
      expect(stderr).toContain("2 pass");
      expect(stderr).toContain("--seed=2444615283");
      expect(exitCode).toBe(0);
    });

    test.concurrent("--seed wins over [test] seed", async () => {
      using dir = tempDir("bunfig-seed-cli", {
        ...files,
        "bunfig.toml": `[test]\nrandomize = true\nseed = 2`,
      });

      const { stderr, exitCode } = await runTest(String(dir), "--seed", "1");
      expect(stderr).toContain("2 pass");
      expect(stderr).toContain("--seed=1");
      expect(stderr).not.toContain("--seed=2");
      expect(exitCode).toBe(0);
    });

    test.concurrent("--rerun-each wins over [test] rerunEach", async () => {
      using dir = tempDir("bunfig-rerun-each-cli", {
        ...files,
        "bunfig.toml": `[test]\nrerunEach = 3`,
      });

      const { stderr, exitCode } = await runTest(String(dir), "--rerun-each", "1");
      expect(stderr).toContain("2 pass");
      expect(stderr).not.toContain("6 pass");
      expect(exitCode).toBe(0);
    });

    test.concurrent("--rerun-each still conflicts with [test] retry", async () => {
      using dir = tempDir("bunfig-retry-vs-cli-rerun-each", {
        ...files,
        "bunfig.toml": `[test]\nretry = 2`,
      });

      const { stderr, exitCode } = await runTest(String(dir), "--rerun-each", "2");
      expect(stderr).toMatch(/retry.* cannot be used with .*rerun/i);
      expect(exitCode).toBe(1);
    });

    // A --parallel worker loads bunfig.toml again. It must receive the
    // coordinator's --retry 0, or the bunfig retry would apply in the worker.
    // Two files: with one file the coordinator runs it in-process, no worker.
    test.concurrent("--retry 0 wins over [test] retry in --parallel workers", async () => {
      const failsOnce = (marker: string) => `
        import { test } from "bun:test";
        import { existsSync, writeFileSync } from "node:fs";
        test("fails on the first attempt", () => {
          const marker = import.meta.dir + "/${marker}";
          if (!existsSync(marker)) {
            writeFileSync(marker, "");
            throw new Error("first attempt");
          }
        });
      `;
      using dir = tempDir("bunfig-retry-parallel-cli", {
        "one.test.ts": failsOnce("first-attempt-one"),
        "two.test.ts": failsOnce("first-attempt-two"),
        "bunfig.toml": `[test]\nretry = 2`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--parallel=2", "--retry", "0"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const output = stdout + stderr;
      expect(output).not.toContain("(attempt 2)");
      expect(output).toContain("2 fail");
      expect(exitCode).toBe(1);
    });
  });
});
