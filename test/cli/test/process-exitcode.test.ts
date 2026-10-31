import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The test results decide the exit code of a passing `bun test` run. The `process.exitCode` that is left at the
// end does not, as in vitest (vitest-dev/vitest#3023) and in jest with workers (jestjs/jest#14501). Bun keeps the
// code that the setup or teardown of the run stored: a `--preload`'s top level and its `beforeAll`/`afterAll` hooks.

const ignored = (left: number) =>
  `note: process.exitCode is ${left} at the end of the run. bun test ignores it: no test failed, so the exit code is 0. ` +
  `To fail the run, call reportError(err) or throw an error.`;
const ignoredForPreload = (left: number, kept: number) =>
  `note: process.exitCode is ${left} at the end of the run. bun test ignores it: no test failed, ` +
  `so the exit code is ${kept}, which a preload script set.`;

async function run(files: Record<string, string>, args: string[], env: Record<string, string> = {}) {
  using dir = tempDir("bun-test-exit-code", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stderr.split(/\r?\n/);
  return {
    // The lines of the summary, for example "2 pass, 0 fail" or "2 pass, 0 fail, 1 error".
    counts: lines
      .map(line => line.trim())
      .filter(line => /^\d+ (pass|fail|errors?)$/.test(line))
      .join(", "),
    notes: lines.filter(line => line.startsWith("note: process.exitCode")),
    // A worker's stdout arrives on the stderr of the coordinator.
    laterHookRan: (stdout + stderr).includes("the later hook ran"),
    exitCode,
  };
}

const passed = (counts: string, exitCode: number, notes: string[] = []) => ({
  counts,
  notes,
  laterHookRan: false,
  exitCode,
});

const passes = `
  import { test } from "bun:test";
  test("a passing test", () => {});
`;
const stores = (...codes: number[]) => `
  import { test } from "bun:test";
  ${codes.map(code => `process.exitCode = ${code};`).join("\n  ")}
  test("a passing test", () => {});
`;
// A macrotask, so that what follows runs with no test or hook callback on the stack.
const nextTurn = `await new Promise(resolve => setImmediate(resolve));`;

const inTheMainProcess: [flags: string[]][] = [[[]], [["--isolate"]], [["--parallel=1"]]];
const withWorkers: [flags: string[]][] = [[["--parallel=2"]], [["--parallel=2", "--no-isolate"]]];
const usesWorkers = { BUN_TEST_PARALLEL_SCALE_MS: "0" };

describe.concurrent("a process.exitCode that test code leaves", () => {
  const files = { "a.test.ts": stores(5), "b.test.ts": passes };

  test.each(inTheMainProcess)("is not the exit code of a passing run: %j", async flags => {
    expect(await run(files, [...flags, "a.test.ts", "b.test.ts"])).toEqual(passed("2 pass, 0 fail", 0, [ignored(5)]));
  });

  test("is not the exit code when --parallel has one file, which the main process runs", async () => {
    expect(await run(files, ["--parallel=2", "a.test.ts"])).toEqual(passed("1 pass, 0 fail", 0, [ignored(5)]));
  });

  test.each(withWorkers)("is not the exit code with workers, which print no note: %j", async flags => {
    expect(await run(files, [...flags, "a.test.ts", "b.test.ts"], usesWorkers)).toEqual(passed("2 pass, 0 fail", 0));
  });

  // The three cases of #26435.
  const cases26435: [name: string, file: string, counts: string][] = [
    [
      "inside-a-test.test.ts",
      `
        import { test, expect } from "bun:test";
        test("a CLI helper reports an error", () => {
          process.exitCode = 1;
          expect(process.exitCode).toBe(1);
        });
      `,
      "1 pass, 0 fail",
    ],
    [
      "inside-several-tests.test.ts",
      `
        import { test } from "bun:test";
        test("stores 42", () => void (process.exitCode = 42));
        test("stores 255", () => void (process.exitCode = 255));
        test("stores 1", () => void (process.exitCode = 1));
      `,
      "3 pass, 0 fail",
    ],
    [
      "inside-after-each.test.ts",
      `
        import { test, afterEach } from "bun:test";
        afterEach(() => void (process.exitCode = 1));
        test("first test", () => {});
        test("second test", () => {});
      `,
      "2 pass, 0 fail",
    ],
  ];
  const files26435 = Object.fromEntries(cases26435.map(([name, file]) => [name, file]));
  const names26435 = cases26435.map(([name]) => name);

  test.each(cases26435)("is not the exit code when stored as in %s", async (name, file, counts) => {
    expect(await run({ [name]: file }, [name])).toEqual(passed(counts, 0, [ignored(1)]));
  });

  test.each(inTheMainProcess)("is not the exit code when three files store it: %j", async flags => {
    expect(await run(files26435, [...flags, ...names26435])).toEqual(passed("6 pass, 0 fail", 0, [ignored(1)]));
  });

  test.each(withWorkers)("is not the exit code when three files store it with workers: %j", async flags => {
    expect(await run(files26435, [...flags, ...names26435], usesWorkers)).toEqual(passed("6 pass, 0 fail", 0));
  });

  test.each([
    [
      "after the last hook of the file",
      `
        import { test, afterAll } from "bun:test";
        afterAll(() => {
          process.exitCode = 4;
          setImmediate(() => void (process.exitCode = 6));
        });
        test("a passing test", () => {});
      `,
      passed("1 pass, 0 fail", 0, [ignored(6)]),
    ],
    [
      "inside a concurrent test after an await",
      `
        import { test } from "bun:test";
        test.concurrent("stores", async () => {
          ${nextTurn}
          process.exitCode = 5;
        });
        test.concurrent("waits", async () => {
          ${nextTurn}
        });
      `,
      passed("2 pass, 0 fail", 0, [ignored(5)]),
    ],
    [
      "as a numeric string through Reflect.set",
      `
        import { test } from "bun:test";
        test("a passing test", () => void Reflect.set(process, "exitCode", "7"));
      `,
      passed("1 pass, 0 fail", 0, [ignored(7)]),
    ],
    [
      "by a file that registers no test",
      `
        process.exitCode = 1;
      `,
      passed("0 pass, 0 fail", 0, [ignored(1)]),
    ],
  ])("is not the exit code when stored %s", async (_, file, expected) => {
    expect(await run({ "a.test.ts": file }, ["a.test.ts"])).toEqual(expected);
  });

  test("is not the exit code when a macro of the file stores it", async () => {
    expect(
      await run(
        {
          "a.test.ts": `
            import { test, expect } from "bun:test";
            import { storeExitCode } from "./macro.ts" with { type: "macro" };
            const stored = storeExitCode();
            test("the macro ran", () => expect(stored).toBe(7));
          `,
          "macro.ts": `
            export function storeExitCode() {
              process.exitCode = 7;
              return process.exitCode;
            }
          `,
        },
        ["a.test.ts"],
      ),
    ).toEqual(passed("1 pass, 0 fail", 0, [ignored(7)]));
  });

  describe("changes nothing", () => {
    test("for a bare process.exit(), which exits with it", async () => {
      const file = `
        import { test } from "bun:test";
        process.exitCode = 5;
        test("exits", () => process.exit());
      `;
      expect(await run({ "a.test.ts": file }, ["a.test.ts"])).toEqual(passed("", 5));
    });

    test("for a failing run, which exits with 1", async () => {
      const file = `
        import { test, expect } from "bun:test";
        process.exitCode = 5;
        test("a failing test", () => expect(1).toBe(2));
      `;
      expect(await run({ "a.test.ts": file, "b.test.ts": passes }, ["a.test.ts", "b.test.ts"])).toEqual(
        passed("1 pass, 1 fail", 1),
      );
    });

    test("for a file that stores 0 again, which prints no note", async () => {
      const file = `
        import { test, afterEach } from "bun:test";
        afterEach(() => void (process.exitCode = 0));
        test("a CLI helper reports an error", () => void (process.exitCode = 1));
      `;
      expect(await run({ "a.test.ts": file }, ["a.test.ts"])).toEqual(passed("1 pass, 0 fail", 0));
    });
  });
});

describe.concurrent("a process.exitCode that a --preload stores", () => {
  const preloaded = (setup: string, a = passes, b = passes) => ({
    "setup.ts": setup,
    "a.test.ts": a,
    "b.test.ts": b,
  });
  const args = ["--preload", "./setup.ts", "a.test.ts", "b.test.ts"];
  const kept = (exitCode: number) => passed("2 pass, 0 fail", exitCode);

  describe.each([[[]], [["--isolate"]], [["--concurrent"]]])("%j", flags => {
    test.each([
      ["at its top level", `process.exitCode = 5;`],
      [
        "in a beforeAll hook",
        `
          import { beforeAll } from "bun:test";
          beforeAll(() => void (process.exitCode = 5));
        `,
      ],
      [
        "in an afterAll hook after an await",
        `
          import { afterAll } from "bun:test";
          afterAll(async () => {
            ${nextTurn}
            process.exitCode = 5;
          });
        `,
      ],
    ])("is the exit code of a passing run when stored %s", async (_, setup) => {
      expect(await run(preloaded(setup), [...flags, ...args])).toEqual(kept(5));
    });

    test("is the exit code when its afterAll hook answers the code of a test file", async () => {
      const guard = `
        import { afterAll } from "bun:test";
        afterAll(() => {
          if (process.exitCode) process.exitCode = 1;
        });
      `;
      expect(await run(preloaded(guard, stores(5)), [...flags, ...args])).toEqual(kept(1));
    });

    // Only the hooks of the whole run are its setup and teardown. A hook of each test runs between the tests.
    test("is not the exit code when stored in a beforeEach or an afterEach hook", async () => {
      const setup = `
        import { beforeEach, afterEach } from "bun:test";
        beforeEach(() => void (process.exitCode = 4));
        afterEach(async () => {
          await null;
          process.exitCode = 5;
        });
      `;
      const twoTests = `
        import { test } from "bun:test";
        test("first test", async () => {
          ${nextTurn}
        });
        test("second test", async () => {
          ${nextTurn}
        });
      `;
      expect(await run(preloaded(setup, twoTests, twoTests), [...flags, ...args])).toEqual(
        passed("4 pass, 0 fail", 0, [ignored(5)]),
      );
    });

    test("does not keep the code of a test file when its hooks store nothing", async () => {
      const setup = `
        import { beforeAll, beforeEach, afterEach, afterAll } from "bun:test";
        beforeAll(() => {});
        beforeEach(() => {});
        afterEach(async () => {
          ${nextTurn}
        });
        afterAll(() => {});
      `;
      const file = `
        import { test } from "bun:test";
        test("a passing test", async () => {
          ${nextTurn}
          process.exitCode = 5;
        });
      `;
      expect(await run(preloaded(setup, file, file), [...flags, ...args])).toEqual(
        passed("2 pass, 0 fail", 0, [ignored(5)]),
      );
    });
  });

  describe("and a test file stores another code", () => {
    const setup = `process.exitCode = 3;`;

    test("after it: the exit code is the preload's", async () => {
      expect(await run(preloaded(setup, stores(5)), args)).toEqual({ ...kept(3), notes: [ignoredForPreload(5, 3)] });
    });

    // With --isolate the preload runs again for each file, so its store is the last one unless the last file stores.
    test.each([
      ["last", preloaded(setup, passes, stores(5)), [ignoredForPreload(5, 3)]],
      ["first", preloaded(setup, stores(5), passes), []],
    ])("in the %s file with --isolate: the exit code is the preload's", async (_, files, notes) => {
      expect(await run(files, ["--isolate", ...args])).toEqual({ ...kept(3), notes });
    });
  });

  describe("and a test file stores 0", () => {
    const setup = `process.exitCode = 7;`;

    test("after it: the 0 clears the preload's code", async () => {
      expect(await run(preloaded(setup, stores(0)), args)).toEqual(kept(0));
    });

    test("and then 5: the exit code is 0", async () => {
      expect(await run(preloaded(setup, stores(0, 5)), args)).toEqual({ ...kept(0), notes: [ignored(5)] });
    });

    test("in the first file with --isolate: the preload stores again for the next file", async () => {
      expect(await run(preloaded(setup, stores(0)), ["--isolate", ...args])).toEqual(kept(7));
    });

    test("before the preload's afterAll hook stores: the exit code is the preload's", async () => {
      const teardown = `
        import { afterAll } from "bun:test";
        afterAll(() => void (process.exitCode = 7));
      `;
      expect(await run(preloaded(teardown, stores(0)), args)).toEqual(kept(7));
    });
  });

  describe("is not changed by a store in another thread, which has an exit code of its own", () => {
    const setup = `process.exitCode = 7;`;

    test("a macro of an imported module", async () => {
      const files = {
        ...preloaded(
          setup,
          `
            import { test, expect } from "bun:test";
            import { macroRanOnTheMainThread } from "./imported.ts";
            test("the macro ran in another thread", () => expect(macroRanOnTheMainThread).toBe(false));
          `,
        ),
        "imported.ts": `
          import { storeZero } from "./macro.ts" with { type: "macro" };
          export const macroRanOnTheMainThread = storeZero();
        `,
        "macro.ts": `
          export function storeZero() {
            process.exitCode = 0;
            return Bun.isMainThread;
          }
        `,
      };
      expect(await run(files, args)).toEqual(kept(7));
    });

    test("a Worker", async () => {
      const files = {
        ...preloaded(
          setup,
          `
            import { test, expect } from "bun:test";
            test("a Worker stores 0", async () => {
              const worker = new Worker(new URL("./worker.ts", import.meta.url));
              const stored = await new Promise((resolve, reject) => {
                worker.addEventListener("message", event => resolve(event.data), { once: true });
                worker.addEventListener("error", event => reject(event.error ?? new Error(event.message)), {
                  once: true,
                });
              });
              expect(stored).toBe(0);
              await worker.terminate();
            });
          `,
        ),
        "worker.ts": `
          process.exitCode = 0;
          postMessage(process.exitCode);
        `,
      };
      expect(await run(files, args)).toEqual(kept(7));
    });
  });

  test.each([
    [["--parallel=1", ...args], "2 pass, 0 fail"],
    [["--parallel=2", "--preload", "./setup.ts", "a.test.ts"], "1 pass, 0 fail"],
  ])("is the exit code when the main process runs the files: %j", async (argv, counts) => {
    expect(await run(preloaded(`process.exitCode = 5;`), argv)).toEqual(passed(counts, 5));
  });

  test("is not the exit code with workers", async () => {
    expect(await run(preloaded(`process.exitCode = 5;`), ["--parallel=2", ...args], usesWorkers)).toEqual(kept(0));
  });
});

describe.concurrent("reportError() fails a run whose process.exitCode bun test ignores", () => {
  const setup = `
    import { afterAll } from "bun:test";
    afterAll(() => {
      reportError(new Error("a test left a server running"));
    });
    afterAll(() => {
      console.log("the later hook ran");
    });
  `;
  const files = { "setup.ts": setup, "a.test.ts": stores(5), "b.test.ts": passes };
  const args = ["--preload", "./setup.ts", "a.test.ts", "b.test.ts"];

  // The hooks of a preload run once in a run that shares one global, and once for each file otherwise.
  test.each([
    [[], "2 pass, 0 fail, 1 error", {}],
    [["--isolate"], "2 pass, 0 fail, 2 errors", {}],
    [["--parallel=2"], "2 pass, 0 fail, 2 errors", usesWorkers],
  ])("from an afterAll hook of a preload, and the next hook still runs: %j", async (flags, counts, env) => {
    expect(await run(files, [...flags, ...args], env)).toEqual({ counts, notes: [], laterHookRan: true, exitCode: 1 });
  });

  test("from a test, which fails that test", async () => {
    const file = `
      import { test } from "bun:test";
      process.exitCode = 5;
      test("reports an error", () => {
        reportError(new Error("a check failed"));
      });
    `;
    expect(await run({ "a.test.ts": file, "b.test.ts": passes }, ["a.test.ts", "b.test.ts"])).toEqual(
      passed("1 pass, 1 fail", 1),
    );
  });
});

describe.concurrent("a process.exitCode in a run with node's exit semantics", () => {
  const nodeTestFile = `
    import { test } from "node:test";
    test("a passing test", () => {});
  `;
  const kept = passed("2 pass, 0 fail", 5);

  test("is the exit code when a node:test file stores it", async () => {
    const file = `
      import { test } from "node:test";
      process.exitCode = 5;
      test("a passing test", () => {});
    `;
    expect(await run({ "a.test.ts": file, "b.test.ts": nodeTestFile }, ["a.test.ts", "b.test.ts"])).toEqual(kept);
  });

  test.each([
    ["before", { "a.test.ts": stores(5), "b.test.ts": nodeTestFile }],
    ["after", { "a.test.ts": nodeTestFile, "b.test.ts": stores(5) }],
  ])("is the exit code when a bun:test file stores it %s a node:test file runs", async (_, files) => {
    expect(await run(files, ["a.test.ts", "b.test.ts"])).toEqual(kept);
  });

  test.each([
    ["is the exit code once a file calls mock.fn() of node:test", "mock.fn();", passed("1 pass, 0 fail", 5)],
    [
      "is not the exit code when a file only imports node:test",
      "void mock;",
      passed("1 pass, 0 fail", 0, [ignored(5)]),
    ],
  ])("%s", async (_, use, expected) => {
    const file = `
      import { test } from "bun:test";
      import { mock } from "node:test";
      ${use}
      process.exitCode = 5;
      test("a passing test", () => {});
    `;
    expect(await run({ "a.test.ts": file }, ["a.test.ts"])).toEqual(expected);
  });

  test("is the exit code under BUN_TEST_DRAIN_EVENT_LOOP", async () => {
    expect(
      await run({ "a.test.ts": stores(5), "b.test.ts": passes }, ["a.test.ts", "b.test.ts"], {
        BUN_TEST_DRAIN_EVENT_LOOP: "1",
      }),
    ).toEqual(kept);
  });
});
