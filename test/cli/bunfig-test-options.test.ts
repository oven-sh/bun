import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readdirSync } from "node:fs";

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
});

async function bunTest(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "test", ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: stderr.replaceAll("\\", "/"), exitCode };
}

/** Adds `name`: `bun test <args>` and the keys, on one line. */
function named<Row extends { bunfig: string; args: string[] }>(rows: Row[]) {
  return rows.map(row => ({
    ...row,
    name: ["bun test", ...row.args].join(" ") + " with " + (row.bunfig.replaceAll("\n", ", ") || "no key"),
  }));
}

describe.concurrent("a flag of `bun test` wins over its [test] key", () => {
  const files = {
    "lib.ts": `export const used = () => 1;\nexport const unused = () => 2;\n`,
    "a.test.ts": `import { used } from "./lib";\ntest("one", () => {\n  used();\n});\ntest("two", () => {});\n`,
    // Passes on the third attempt.
    "flaky.test.ts": `let attempts = 0;\ntest("flaky", () => {\n  expect(++attempts).toBe(3);\n});\n`,
  };

  test.each(
    named([
      { bunfig: `coverage = false`, args: ["--coverage"], prints: "% Funcs" },
      { bunfig: `coverage = true\ncoverageReporter = "lcov"`, args: ["--coverage-reporter=text"], prints: "% Funcs" },
      {
        bunfig: `coverage = true\ncoverageReporter = "lcov"\ncoverageDir = "from-file"`,
        args: ["--coverage-dir=from-flag"],
        writes: ["from-flag", "from-flag/lcov.info"],
      },
      {
        bunfig: `reporter.junit = "from-file.xml"`,
        args: ["--reporter-outfile=from-flag.xml"],
        writes: ["from-flag.xml"],
      },
      { bunfig: `reporter.dots = false`, args: ["--dots"], hides: "(pass)" },
      { bunfig: `onlyFailures = false`, args: ["--only-failures"], hides: "(pass)" },
      { bunfig: `randomize = false`, args: ["--randomize"], prints: "--seed=" },
      { bunfig: `randomize = true\nseed = 1`, args: ["--seed=2"], prints: "--seed=2" },
      { bunfig: `rerunEach = 3`, args: ["--rerun-each=1"], prints: " 2 pass" },
      { bunfig: `retry = 2`, args: ["--retry=0", "flaky"], prints: " 1 fail", exitCode: 1 },
      { bunfig: `retry = 0`, args: ["--retry=2", "flaky"], prints: " 1 pass" },
    ]),
  )("$name", async ({ bunfig, args, prints = "", hides = "\0", writes = [], exitCode = 0 }) => {
    using dir = tempDir("test-flag-wins", { ...files, "bunfig.toml": `[test]\n${bunfig}\n` });
    const result = await bunTest(String(dir), ...(args.includes("flaky") ? args : [...args, "a.test"]));
    expect(result.stderr).toContain(prints);
    expect(result.stderr).not.toContain(hides);
    const written = readdirSync(String(dir), { recursive: true })
      .map(name => String(name).replaceAll("\\", "/"))
      .filter(name => !(name in files) && name !== "bunfig.toml");
    expect(written.sort()).toEqual(writes);
    expect(result.exitCode).toBe(exitCode);
  });

  // A worker reads bunfig.toml too. Workers only start when there are two files.
  test("bun test --parallel=2 --retry=0 with retry = 2", async () => {
    using dir = tempDir("test-flag-wins", {
      "flaky1.test.ts": files["flaky.test.ts"],
      "flaky2.test.ts": files["flaky.test.ts"],
      "bunfig.toml": `[test]\nretry = 2\n`,
    });
    const { stderr, exitCode } = await bunTest(String(dir), "--parallel=2", "--retry=0");
    expect(stderr).toContain(" 2 fail");
    expect(exitCode).toBe(1);
  });

  test.each(
    named([
      {
        bunfig: `seed = 1`,
        args: [],
        error: `error: "seed" can only be used when "randomize" is true\n    at <dir>/bunfig.toml:2:8\n`,
      },
      {
        bunfig: `retry = 2`,
        args: ["--rerun-each=3"],
        error: `error: "retry" cannot be used with "rerunEach"\n    at <dir>/bunfig.toml:2:9\n`,
      },
      {
        bunfig: `rerunEach = 3`,
        args: ["--retry=2"],
        error: `error: "rerunEach" cannot be used with "retry"\n    at <dir>/bunfig.toml:2:13\n`,
      },
      {
        bunfig: `reporter.junit = "from-file.xml"`,
        args: ["--reporter=junit"],
        error: `error: --reporter=junit requires --reporter-outfile [file] to specify where to save the XML report\n`,
      },
    ]),
  )("$name is an error as before", async ({ bunfig, args, error }) => {
    using dir = tempDir("test-flag-error", { ...files, "bunfig.toml": `[test]\n${bunfig}\n` });
    const { stderr, exitCode } = await bunTest(String(dir), ...args);
    expect(stderr.replaceAll(String(dir).replaceAll("\\", "/"), "<dir>")).toContain(error);
    expect(exitCode).toBe(1);
  });

  test("bun test --randomize with seed = 1 runs with that seed as before", async () => {
    using dir = tempDir("test-flag-wins", { ...files, "bunfig.toml": `[test]\nseed = 1\n` });
    const { stderr, exitCode } = await bunTest(String(dir), "--randomize", "a.test");
    expect(stderr).toContain("--seed=1");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("[test] filePatterns", () => {
  const empty = `test("passes", () => {});\n`;
  const files = {
    "a.itest.ts": empty,
    "b.test.ts": empty,
    "src/c.itest.ts": empty,
    "src/d.spec.tsx": empty,
  };
  /** The `path/to/file.ts:` lines. */
  const ran = (stderr: string) => [...stderr.matchAll(/^(\S+):$/gm)].map(match => match[1]).sort();

  test.each(
    named([
      { bunfig: ``, args: [], expected: ["b.test.ts", "src/d.spec.tsx"] },
      { bunfig: `filePatterns = "**/*.itest.ts"`, args: [], expected: ["a.itest.ts", "src/c.itest.ts"] },
      {
        bunfig: `filePatterns = ["*.itest.ts", "**/*.spec.tsx"]`,
        args: [],
        expected: ["a.itest.ts", "src/d.spec.tsx"],
      },
      { bunfig: `filePatterns = ["**/*.itest.ts", "!src/**"]`, args: [], expected: ["a.itest.ts"] },
      { bunfig: `filePatterns = "**/*.itest.ts"`, args: ["src"], expected: ["src/c.itest.ts"] },
      { bunfig: `filePatterns = "**/*.itest.ts"`, args: ["./b.test.ts"], expected: ["b.test.ts"] },
      { bunfig: `filePatterns = "**/*.itest.ts"\npathIgnorePatterns = "src/**"`, args: [], expected: ["a.itest.ts"] },
    ]),
  )("$name", async ({ bunfig, args, expected }) => {
    using dir = tempDir("test-file-patterns", { ...files, "bunfig.toml": `[test]\n${bunfig}\n` });
    const { stderr, exitCode } = await bunTest(String(dir), ...args);
    expect(ran(stderr)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test("coverageSkipTestFiles leaves the matching files out of the coverage table", async () => {
    using dir = tempDir("test-file-patterns", {
      "lib.ts": `export const used = () => 1;\n`,
      "lib.itest.ts": `import { used } from "./lib";\ntest("one", () => {\n  used();\n});\n`,
      "bunfig.toml": `[test]\nfilePatterns = "*.itest.ts"\ncoverageSkipTestFiles = true\n`,
    });
    const { stderr, exitCode } = await bunTest(String(dir), "--coverage");
    expect(stderr).toContain(" lib.ts ");
    expect(stderr).not.toContain(" lib.itest.ts ");
    expect(exitCode).toBe(0);
  });

  test.each(
    named([
      { bunfig: `filePatterns = ["*.a.ts", "*.b.ts"]`, args: [] },
      { bunfig: `filePatterns = ["*.a.ts", "*.b.ts"]`, args: ["filter"] },
    ]),
  )("$name finds nothing and names the patterns", async ({ bunfig, args }) => {
    using dir = tempDir("test-file-patterns", { ...files, "bunfig.toml": `[test]\n${bunfig}\n` });
    const { stderr, exitCode } = await bunTest(String(dir), ...args);
    expect(stderr).toContain("Tests need to match filePatterns in bunfig.toml: *.a.ts, *.b.ts\n");
    expect(stderr).not.toContain(`".test"`);
    expect(exitCode).toBe(1);
  });

  test("a number is an error", async () => {
    using dir = tempDir("test-file-patterns", { ...files, "bunfig.toml": `[test]\nfilePatterns = 1\n` });
    const { stderr, exitCode } = await bunTest(String(dir));
    expect(stderr).toContain("error: filePatterns must be a string or array of strings\n");
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("[test] isolate", () => {
  test.each(
    named([
      { bunfig: ``, args: [], sees: "1" },
      { bunfig: `isolate = false`, args: [], sees: "1" },
      { bunfig: `isolate = true`, args: [], sees: "undefined" },
      { bunfig: `isolate = true`, args: ["--no-isolate"], sees: "1" },
      { bunfig: `isolate = false`, args: ["--isolate"], sees: "undefined" },
      // With this delay one worker runs both files.
      { bunfig: `isolate = false`, args: ["--parallel=2", "--parallel-delay=1000000"], sees: "undefined" },
      { bunfig: `isolate = true`, args: ["--parallel=2", "--parallel-delay=1000000", "--no-isolate"], sees: "1" },
    ]),
  )("$name: the second file sees $sees", async ({ bunfig, args, sees }) => {
    using dir = tempDir("test-isolate", {
      "a.test.ts": `globalThis.leaked = 1;\ntest("leaks", () => {});\n`,
      "b.test.ts": `test("sees " + globalThis.leaked, () => {});\n`,
      "bunfig.toml": `[test]\n${bunfig}\n`,
    });
    const { stderr, exitCode } = await bunTest(String(dir), ...args);
    expect(stderr).toContain(`(pass) sees ${sees}`);
    expect(exitCode).toBe(0);
  });
});

// In smol mode a Blob is kept in a memfd from 1 MiB on, otherwise from 8 MiB on.
test.concurrent.skipIf(!isLinux).each([
  { bunfig: ``, expected: "normal" },
  { bunfig: `smol = true`, expected: "smol" },
])("bun test with [test] $bunfig is $expected", async ({ bunfig, expected }) => {
  using dir = tempDir("test-smol", {
    "bunfig.toml": `[test]\n${bunfig}\n`,
    "a.test.ts": `
      import { readdirSync, readlinkSync } from "node:fs";
      test("probe", () => {
        const blob = new Blob([new Uint8Array(2 * 1024 * 1024)]);
        const links = readdirSync("/proc/self/fd").map(fd => {
          try {
            return readlinkSync("/proc/self/fd/" + fd);
          } catch {
            return "";
          }
        });
        console.log(links.some(link => link.startsWith("/memfd:memfd-num-")) ? "smol" : "normal", blob.size);
      });
    `,
  });
  const { stdout, exitCode } = await bunTest(String(dir));
  expect(stdout).toContain(`${expected} 2097152\n`);
  expect(exitCode).toBe(0);
});
