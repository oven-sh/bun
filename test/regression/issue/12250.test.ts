// https://github.com/oven-sh/bun/issues/12250
// `bun test --bail` stops the run: nothing that has not started starts. It must not skip
// teardown: what already started finishes, and the afterAll hooks of every scope that was
// entered still run.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

describe.concurrent("the report in the issue", () => {
  const fixture = `
    import { afterAll, beforeAll, describe, expect, it } from "bun:test";

    describe("test", () => {
      beforeAll(async () => {
        console.log("Before");
      });

      afterAll(async () => {
        console.log("After");
      });

      it("should fail", async () => {
        expect(true).toBe(false);
      });

      it("should pass", async () => {
        expect(true).toBe(true);
      });
    });
  `;

  async function run(...args: string[]) {
    using dir = tempDir("test-12250", { "test.spec.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args, "test.spec.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The first line of stdout is the version banner.
    return { hooks: stdout.split("\n").slice(1).filter(Boolean), stderr, exitCode };
  }

  test("afterAll runs with --bail", async () => {
    const { hooks, stderr, exitCode } = await run("--bail");

    expect(hooks).toEqual(["Before", "After"]);
    expect(stderr).toContain("(fail) test > should fail");
    // Bailed out after the first failure: the second test did not run.
    expect(stderr).not.toContain("should pass");
    expect(stderr).toContain("Bailed out after 1 failure");
    expect(stderr).toContain("Ran 1 test across 1 file.");
    expect(exitCode).toBe(1);
  });

  test("afterAll runs without --bail", async () => {
    const { hooks, stderr, exitCode } = await run();

    expect(hooks).toEqual(["Before", "After"]);
    expect(stderr).toContain("(fail) test > should fail");
    expect(stderr).toContain("(pass) test > should pass");
    expect(stderr).not.toContain("Bailed out");
    expect(stderr).toContain("Ran 2 tests across 1 file.");
    expect(exitCode).toBe(1);
  });
});

// Every hook and test body appends its name to hooks.log, so the order is read from that file
// and not from what the reporter prints.
describe.concurrent("teardown", () => {
  const log = `
    import { appendFileSync } from "node:fs";
    export const log = (name: string) => appendFileSync("hooks.log", name + " ");
  `;
  // Async, to show that the run waits for them.
  const preload = `
    import { afterAll, beforeAll } from "bun:test";
    import { log } from "./log";
    const tick = () => new Promise(resolve => setImmediate(resolve));
    beforeAll(async () => (await tick(), log("preload-beforeAll")));
    afterAll(async () => (await tick(), log("preload-afterAll")));
  `;
  const passes = `
    import { afterAll, test } from "bun:test";
    import { log } from "./log";
    afterAll(() => log("pass-afterAll"));
    test("pass", () => log("pass"));
  `;
  const fails = `
    import { afterAll, test } from "bun:test";
    import { log } from "./log";
    afterAll(() => log("fail-afterAll"));
    test("fail", () => {
      log("fail");
      throw new Error("fail");
    });
    test("next", () => log("next"));
  `;
  const neverLoaded = `
    import { log } from "./log";
    log("never-loaded");
  `;
  const throwsOnLoad = `
    import { afterAll, test } from "bun:test";
    import { log } from "./log";
    afterAll(() => log("throws-afterAll"));
    test("registered before the throw", () => log("throws-test"));
    log("load");
    throw new Error("thrown while the file loads");
  `;

  async function run(files: Record<string, string>, args: string[], read: string[] = []) {
    using dir = tempDir("bun-test-bail", { "log.ts": log, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const text = async (name: string) => {
      const file = Bun.file(join(String(dir), name));
      return (await file.exists()) ? await file.text() : "";
    };
    return {
      hooks: (await text("hooks.log")).trim(),
      stderr,
      exitCode,
      files: Object.fromEntries(await Promise.all(read.map(async name => [name, await text(name)]))),
    };
  }

  const cases: { name: string; files: Record<string, string>; args: string[]; hooks: string }[] = [
    {
      name: "afterAll runs for each describe that was entered and for the file, innermost first",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { afterAll, afterEach, beforeAll, describe, test } from "bun:test";
          import { log } from "./log";
          beforeAll(() => log("file-beforeAll"));
          afterAll(() => log("file-afterAll"));
          describe("A", () => {
            beforeAll(() => log("A-beforeAll"));
            afterAll(() => log("A-afterAll"));
            describe("A1", () => {
              afterEach(() => log("A1-afterEach"));
              afterAll(async () => {
                await new Promise(resolve => setImmediate(resolve));
                log("A1-afterAll");
              });
              test("fail", () => {
                log("fail");
                throw new Error("fail");
              });
              test("next in A1", () => log("next-in-A1"));
            });
            test("next in A", () => log("next-in-A"));
            describe("A2", () => {
              beforeAll(() => log("A2-beforeAll"));
              afterAll(() => log("A2-afterAll"));
              test("in A2", () => log("in-A2"));
            });
          });
          describe("B", () => {
            beforeAll(() => log("B-beforeAll"));
            afterAll(() => log("B-afterAll"));
            test("in B", () => log("in-B"));
          });
        `,
      },
      hooks: "file-beforeAll A-beforeAll fail A1-afterEach A1-afterAll A-afterAll file-afterAll",
    },
    {
      name: "a beforeAll that fails is the failure that bails",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { afterAll, beforeAll, describe, test } from "bun:test";
          import { log } from "./log";
          afterAll(() => log("file-afterAll"));
          describe("A", () => {
            beforeAll(() => {
              log("A-beforeAll");
              throw new Error("beforeAll fails");
            });
            afterAll(() => log("A-afterAll"));
            test("in A", () => log("in-A"));
          });
          describe("B", () => {
            beforeAll(() => log("B-beforeAll"));
            afterAll(() => log("B-afterAll"));
            test("in B", () => log("in-B"));
          });
        `,
      },
      hooks: "A-beforeAll A-afterAll file-afterAll",
    },
    {
      name: "an afterAll that fails is the failure that bails",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { afterAll, describe, test } from "bun:test";
          import { log } from "./log";
          afterAll(() => log("file-afterAll"));
          describe("A", () => {
            describe("A1", () => {
              afterAll(() => {
                log("A1-afterAll");
                throw new Error("afterAll fails");
              });
              test("in A1", () => log("in-A1"));
            });
            afterAll(() => log("A-afterAll"));
            test("in A", () => log("in-A"));
          });
          describe("B", () => {
            afterAll(() => log("B-afterAll"));
            test("in B", () => log("in-B"));
          });
        `,
      },
      hooks: "in-A1 A1-afterAll A-afterAll file-afterAll",
    },
    {
      name: "an afterAll that throws after the bail does not stop the outer afterAll hooks",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { afterAll, describe, test } from "bun:test";
          import { log } from "./log";
          afterAll(() => log("file-afterAll"));
          describe("A", () => {
            afterAll(() => {
              log("A-afterAll");
              throw new Error("afterAll fails");
            });
            test("fail", () => {
              log("fail");
              throw new Error("fail");
            });
          });
        `,
      },
      hooks: "fail A-afterAll file-afterAll",
    },
    {
      name: "a concurrent test that is running finishes, with its afterEach",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { afterAll, afterEach, describe, test } from "bun:test";
          import { log } from "./log";
          const siblingStarted = Promise.withResolvers<void>();
          const bailed = Promise.withResolvers<void>();
          afterAll(() => log("file-afterAll"));
          describe("A", () => {
            afterEach(() => log("afterEach"));
            afterAll(() => log("A-afterAll"));
            test.concurrent("fail", async () => {
              await siblingStarted.promise;
              log("fail");
              setImmediate(bailed.resolve);
              throw new Error("fail");
            });
            test.concurrent("sibling", async () => {
              log("sibling-start");
              siblingStarted.resolve();
              await bailed.promise;
              log("sibling-done");
            });
            test("next", () => log("next"));
          });
        `,
      },
      hooks: "sibling-start fail afterEach sibling-done afterEach A-afterAll file-afterAll",
    },
    {
      name: "a concurrent test that has not started does not start",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { afterAll, describe, test } from "bun:test";
          import { log } from "./log";
          describe("A", () => {
            afterAll(() => log("A-afterAll"));
            test.concurrent("fail", () => {
              log("fail");
              throw new Error("fail");
            });
            test.concurrent("not started", () => log("not-started"));
          });
        `,
      },
      hooks: "fail A-afterAll",
    },
    {
      // B's test runs in the concurrent group that A's test opened, before B's own hooks.
      name: "afterAll runs for a describe whose concurrent test joined a running group",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { afterAll, describe, test } from "bun:test";
          import { log } from "./log";
          const bailed = Promise.withResolvers<void>();
          describe("A", () => {
            afterAll(() => log("A-afterAll"));
            test.concurrent("in A", async () => {
              log("in-A-start");
              await bailed.promise;
              log("in-A-done");
            });
            describe("B", () => {
              afterAll(() => log("B-afterAll"));
              test.concurrent("fail", async () => {
                log("fail");
                setImmediate(bailed.resolve);
                throw new Error("fail");
              });
            });
            describe("C", () => {
              afterAll(() => log("C-afterAll"));
              test("in C", () => log("in-C"));
            });
          });
        `,
      },
      hooks: "in-A-start fail in-A-done B-afterAll A-afterAll",
    },
    {
      name: "a test is retried before it counts as the failure that bails",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { afterAll, describe, test } from "bun:test";
          import { log } from "./log";
          describe("A", () => {
            afterAll(() => log("A-afterAll"));
            let attempt = 0;
            test("fail", () => {
              log("attempt-" + ++attempt);
              throw new Error("fail");
            }, { retry: 1 });
            test("next", () => log("next"));
          });
        `,
      },
      hooks: "attempt-1 attempt-2 A-afterAll",
    },
    {
      name: "a running test does not retry or repeat after the bail",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { afterAll, describe, test } from "bun:test";
          import { log } from "./log";
          const siblingStarted = Promise.withResolvers<void>();
          const bailed = Promise.withResolvers<void>();
          describe("A", () => {
            afterAll(() => log("A-afterAll"));
            test.concurrent("fail", async () => {
              await siblingStarted.promise;
              setImmediate(bailed.resolve);
              throw new Error("fail");
            });
            test.concurrent("fails later, has retries", async () => {
              log("retry-run");
              siblingStarted.resolve();
              await bailed.promise;
              throw new Error("fails after the bail");
            }, { retry: 2 });
            test.concurrent("passes later, has repeats", async () => {
              log("repeat-run");
              await bailed.promise;
            }, { repeats: 2 });
          });
        `,
      },
      hooks: "retry-run repeat-run A-afterAll",
    },
    {
      name: "node:test after() runs",
      args: ["--bail"],
      files: {
        "a.test.ts": `
          import { after, before, describe, it } from "node:test";
          import { log } from "./log";
          after(() => log("file-after"));
          describe("A", () => {
            before(() => log("A-before"));
            after(() => log("A-after"));
            it("fail", () => {
              log("fail");
              throw new Error("fail");
            });
            it("next", () => log("next"));
          });
        `,
      },
      hooks: "A-before fail A-after file-after",
    },
    {
      name: "--rerun-each does not run the file again",
      args: ["--bail", "--rerun-each=3", "./a.test.ts"],
      files: { "a.test.ts": fails },
      hooks: "fail fail-afterAll",
    },
    {
      name: "the preload afterAll runs when the first file bails",
      args: ["--bail", "--preload=./preload.ts", "./a.test.ts", "./b.test.ts"],
      files: { "preload.ts": preload, "a.test.ts": fails, "b.test.ts": neverLoaded },
      hooks: "preload-beforeAll fail fail-afterAll preload-afterAll",
    },
    {
      name: "the preload afterAll runs when a middle file bails",
      args: ["--bail", "--preload=./preload.ts", "./a.test.ts", "./b.test.ts", "./c.test.ts"],
      files: { "preload.ts": preload, "a.test.ts": passes, "b.test.ts": fails, "c.test.ts": neverLoaded },
      hooks: "preload-beforeAll pass pass-afterAll fail fail-afterAll preload-afterAll",
    },
    {
      name: "the preload afterAll runs once when the last file bails",
      args: ["--bail", "--preload=./preload.ts", "./a.test.ts", "./b.test.ts"],
      files: { "preload.ts": preload, "a.test.ts": passes, "b.test.ts": fails },
      hooks: "preload-beforeAll pass pass-afterAll fail fail-afterAll preload-afterAll",
    },
    {
      name: "the preload afterAll runs under --isolate",
      args: ["--bail", "--isolate", "--preload=./preload.ts", "./a.test.ts", "./b.test.ts"],
      files: { "preload.ts": preload, "a.test.ts": fails, "b.test.ts": neverLoaded },
      hooks: "preload-beforeAll fail fail-afterAll preload-afterAll",
    },
    {
      name: "the preload hooks run when the first file fails to load",
      args: ["--bail", "--preload=./preload.ts", "./a.test.ts", "./b.test.ts"],
      files: { "preload.ts": preload, "a.test.ts": throwsOnLoad, "b.test.ts": neverLoaded },
      hooks: "load preload-beforeAll preload-afterAll",
    },
    {
      name: "the preload afterAll runs when a middle file fails to load",
      args: ["--bail", "--preload=./preload.ts", "./a.test.ts", "./b.test.ts", "./c.test.ts"],
      files: { "preload.ts": preload, "a.test.ts": passes, "b.test.ts": throwsOnLoad, "c.test.ts": neverLoaded },
      hooks: "preload-beforeAll pass pass-afterAll load preload-afterAll",
    },
  ];
  for (const { name, files, args, hooks } of cases) {
    test(name, async () => {
      const result = await run(files, args);
      expect({ hooks: result.hooks, exitCode: result.exitCode }).toEqual({ hooks, exitCode: 1 });
      expect(result.stderr).toContain("Bailed out after 1 failure");
    });
  }

  test("--bail=2 does not bail on one failure", async () => {
    const { hooks, stderr, exitCode } = await run({ "a.test.ts": fails }, ["--bail=2"]);
    expect({ hooks, exitCode }).toEqual({ hooks: "fail next fail-afterAll", exitCode: 1 });
    expect(stderr).not.toContain("Bailed out");
  });

  // A failed run must not exit 0, and its report must not be lost, because teardown exits.
  test("an afterAll that calls process.exit(0) after the bail", async () => {
    const { hooks, stderr, exitCode, files } = await run(
      {
        "a.test.ts": `
          import { afterAll, test } from "bun:test";
          import { log } from "./log";
          afterAll(() => {
            log("afterAll");
            process.exit(0);
          });
          test("fail", () => {
            log("fail");
            throw new Error("fail");
          });
        `,
      },
      ["--bail", "--reporter=junit", "--reporter-outfile=junit.xml"],
      ["junit.xml"],
    );
    expect({ hooks, exitCode }).toEqual({ hooks: "fail afterAll", exitCode: 1 });
    expect(stderr).toContain("Bailed out after 1 failure");
    expect(stderr).toContain("Ran 1 test across 1 file.");
    expect(files["junit.xml"]).toContain('<testcase name="fail"');
  });
});

// Without --bail too: the run used to go on to the next file while these hooks were pending.
test("async preload hooks finish when a test file fails to load", async () => {
  using dir = tempDir("bun-test-load-failure-preload", {
    "preload.ts": `
      import { afterAll, beforeAll } from "bun:test";
      const tick = () => new Promise(resolve => setImmediate(resolve));
      beforeAll(async () => {
        console.log("preload beforeAll start");
        await tick();
        console.log("preload beforeAll done");
      });
      afterAll(async () => {
        console.log("preload afterAll start");
        await tick();
        console.log("preload afterAll done");
      });
    `,
    "a.test.ts": `throw new Error("a throws while it loads");`,
    "b.test.ts": `
      import { test } from "bun:test";
      test("b", () => console.log("b"));
    `,
    "c.test.ts": `throw new Error("c throws while it loads");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--preload=./preload.ts", "./a.test.ts", "./b.test.ts", "./c.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.split("\n").slice(1)).toEqual([
    "preload beforeAll start",
    "preload beforeAll done",
    "b",
    "preload afterAll start",
    "preload afterAll done",
    "",
  ]);
  expect(stderr).toContain("a throws while it loads");
  expect(stderr).toContain("c throws while it loads");
  expect(exitCode).toBe(1);
});

// --bail only stops the run. What a run does at its end still happens.
describe.concurrent("a bailed run ends like any other run", () => {
  const files = {
    "math.ts": `
      export const add = (a: number, b: number) => a + b;
    `,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import { add } from "./math";
      test("snapshot", () => expect({ sum: add(1, 2) }).toMatchSnapshot());
      test("fail", () => expect(add(1, 2)).toBe(4));
      test("next", () => {});
    `,
  };

  async function run(args: string[], read: string[] = [], env: Record<string, string> = {}) {
    using dir = tempDir("bun-test-bail-end", { ...files, "not-a-directory": "" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args, "./a.test.ts"],
      // CI=false: a new snapshot is only written outside CI.
      env: { ...bunEnv, CI: "false", ...env },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const text = async (name: string) => {
      const file = Bun.file(join(String(dir), name));
      return (await file.exists()) ? await file.text() : "";
    };
    return {
      stderr,
      exitCode,
      signalCode: proc.signalCode,
      files: Object.fromEntries(await Promise.all(read.map(async name => [name, await text(name)]))),
    };
  }

  test("it prints the summary of the tests that ran", async () => {
    const { stderr, exitCode } = await run(["--bail"]);
    const end = stderr.slice(stderr.indexOf("Bailed out")).replace(/\[[\d.]+m?s\]/, "[time]");
    expect(end.split("\n")).toEqual([
      "Bailed out after 1 failure",
      "",
      " 1 pass",
      " 1 fail",
      "snapshots: +1 added",
      " 2 expect() calls",
      "Ran 2 tests across 1 file. [time]",
      "",
    ]);
    expect(exitCode).toBe(1);
  });

  test("it writes the snapshot file", async () => {
    const snapshot = "__snapshots__/a.test.ts.snap";
    const { files, exitCode } = await run(["--bail"], [snapshot]);
    expect(files[snapshot]).toContain('exports[`snapshot 1`] = `\n{\n  "sum": 3,\n}\n`;');
    expect(exitCode).toBe(1);
  });

  test("it writes the coverage report", async () => {
    const { stderr, files, exitCode } = await run(
      ["--bail", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov"],
      ["coverage/lcov.info"],
    );
    expect(stderr).toContain("% Funcs");
    expect(files["coverage/lcov.info"]).toContain("SF:math.ts");
    expect(exitCode).toBe(1);
  });

  // The coverage report comes before the summary and the JUnit file, so it must not end the run.
  test.each([[[]], [["--bail"]]])(
    "a coverage file that cannot be written does not drop the JUnit file: %j",
    async args => {
      const { stderr, files, exitCode } = await run(
        [
          ...args,
          "--coverage",
          "--coverage-reporter=lcov",
          "--coverage-dir=./not-a-directory/coverage",
          "--reporter=junit",
          "--reporter-outfile=junit.xml",
        ],
        ["junit.xml"],
      );
      expect(stderr).toContain("Failed to write lcov.info");
      expect(stderr).toContain(" 1 fail");
      expect(files["junit.xml"]).toContain('<testcase name="fail"');
      expect(exitCode).toBe(1);
    },
  );

  // The exit goes through the VM teardown that the sanitizer lane checks (scripts/runner.node.ts
  // sets this environment). Without it, LeakSanitizer aborts the process with 134.
  test.skipIf(!isASAN)("it exits 1 cleanly under LeakSanitizer", async () => {
    const { stderr, exitCode, signalCode } = await run(["--bail"], [], {
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1",
      LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:suppressions=${join(import.meta.dir, "../../leaksan.supp")}`,
    });
    expect(stderr).toContain("Bailed out after 1 failure");
    expect(stderr).not.toContain("LeakSanitizer");
    expect({ exitCode, signalCode }).toEqual({ exitCode: 1, signalCode: null });
  });

  // On Windows, `bun test --watch` runs as a parent watcher-manager that respawns a child process
  // on change (rather than exec()-in-place), which makes the stderr-stream sync points racy there.
  test.skipIf(isWindows)("--watch keeps watching", async () => {
    using dir = tempDir("bun-test-bail-watch", {
      "a.test.ts": `
        import { expect, test } from "bun:test";
        test("first", () => expect(1).toBe(2));
        test("second", () => {});
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--watch", "--no-clear-screen", "--bail", "./a.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    async function waitFor(needle: string, from = 0): Promise<void> {
      while (!buf.slice(from).includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream closed before seeing ${JSON.stringify(needle)}\n${buf}`);
        buf += decoder.decode(value, { stream: true });
      }
    }

    // Sync on the end-of-run summary so the watcher is seeded before the file changes.
    await waitFor("Bailed out after 1 failure");
    await waitFor("Ran 1 test across 1 file");

    const before = buf.length;
    writeFileSync(
      join(String(dir), "a.test.ts"),
      `
        import { expect, test } from "bun:test";
        test("first", () => expect(1).toBe(1));
        test("second", () => {});
      `,
    );
    await waitFor("Ran 2 tests across 1 file", before);
    expect(buf.slice(before)).toContain(" 2 pass");
    expect(buf.slice(before)).not.toContain("Bailed out");

    proc.kill();
    reader.releaseLock();
  });
});
