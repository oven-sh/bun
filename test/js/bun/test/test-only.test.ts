import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test.each(["./only-fixture-1.ts", "./only-fixture-2.ts", "./only-fixture-3.ts"])(
  `test.only shouldn't need --only for %s`,
  async (file: string) => {
    const result = await $.cwd(import.meta.dir)`${bunExe()} test ${file}`.env({ ...bunEnv, CI: "false" });

    expect(result.stderr.toString()).toContain(" 1 pass\n");
    expect(result.stderr.toString()).toContain(" 0 fail\n");
    expect(result.stderr.toString()).toContain("Ran 1 test across 1 file");
  },
);

test("only resets per test", async () => {
  const files = ["./only-fixture-1.ts", "./only-fixture-2.ts", "./only-fixture-3.ts", "./only-fixture-4.ts"];
  const result = await $.cwd(import.meta.dir)`${bunExe()} test ${{ raw: files.join(" ") }}`.env({
    ...bunEnv,
    CI: "false",
  });

  expect(result.stderr.toString()).toContain(" 6 pass\n");
  expect(result.stderr.toString()).toContain(" 0 fail\n");
  expect(result.stderr.toString()).toContain("Ran 6 tests across 4 files");
});

// A `.only` focuses the file only when it selects a test that can run. A skipped
// one (or todo without --todo) used to drop every other test while the run stayed green.
describe.concurrent("a .only with no test that can run does not focus the file", () => {
  async function run(files: Record<string, string>, ...flags: string[]) {
    using dir = tempDir("only-nothing-to-run", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...flags, ...Object.keys(files).map(file => `./${file}`)],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr: normalizeBunSnapshot(stderr, dir), exitCode };
  }

  test("skipped, todo, or empty", async () => {
    const { stderr, exitCode } = await run({
      "only-in-describe-skip.test.ts": `
        test("plain", () => {});
        describe.skip("skipped", () => {
          test.only("only", () => {});
          test("sibling", () => {});
        });
      `,
      // unlike in Jest, a describe.only inside describe.skip stays skipped
      "nested-in-describe-skip.test.ts": `
        test("plain", () => {});
        describe.skip("skipped", () => {
          describe("inner", () => {
            test.only("only", () => {});
          });
          describe.only("inner only", () => {
            test("in describe.only", () => {});
          });
        });
        xdescribe("xdescribe", () => {
          test.only("only", () => {});
        });
      `,
      "only-chained-with-skip.test.ts": `
        test("plain", () => {});
        test.skip.only("skip.only", () => {});
        test.only.if(false)("only.if(false)", () => {});
        test.skipIf(true).only("skipIf(true).only", () => {});
        describe.skip.only("describe.skip.only", () => {
          test("inner", () => {});
        });
      `,
      "only-in-describe-todo.test.ts": `
        test("plain", () => {});
        describe.todo("todo group", () => {
          test.only("only", () => {});
        });
        test.todo.only("todo.only", () => {});
      `,
      "describe-only-with-nothing-to-run.test.ts": `
        test("plain", () => {});
        describe.only("focused", () => {
          test.skip("skipped", () => {});
          test.todo("todo", () => {});
        });
        describe.only("empty", () => {});
      `,
      // describe.only "focused" still focuses the file, and keeps its own plain test
      "inside-describe-only.test.ts": `
        describe.only("focused", () => {
          test("plain", () => {});
          describe.skip("skipped", () => {
            test.only("only", () => {});
          });
          describe.only("inner", () => {
            test.skip("skipped", () => {});
          });
        });
        test("outside", () => {});
      `,
      // a test.only that runs still focuses the file
      "next-to-a-running-only.test.ts": `
        test("plain", () => {});
        test.only("only", () => {});
        describe.skip("skipped", () => {
          test.only("skipped only", () => {});
        });
      `,
    });
    expect(stderr).toMatchInlineSnapshot(`
      "only-in-describe-skip.test.ts:
      (pass) plain
      (skip) skipped > only
      (skip) skipped > sibling

      nested-in-describe-skip.test.ts:
      (pass) plain
      (skip) skipped > inner > only
      (skip) skipped > inner only > in describe.only
      (skip) xdescribe > only

      only-chained-with-skip.test.ts:
      (pass) plain
      (skip) skip.only
      (skip) only.if(false)
      (skip) skipIf(true).only
      (skip) describe.skip.only > inner

      only-in-describe-todo.test.ts:
      (pass) plain
      (todo) todo group > only
      (todo) todo.only

      describe-only-with-nothing-to-run.test.ts:
      (pass) plain
      (skip) focused > skipped
      (todo) focused > todo

      inside-describe-only.test.ts:
      (pass) focused > plain
      (skip) focused > skipped > only
      (skip) focused > inner > skipped

      next-to-a-running-only.test.ts:
      (pass) only

       7 pass
       12 skip
       3 todo
       0 fail
      Ran 22 tests across 7 files."
    `);
    expect(exitCode).toBe(0);
  });

  // The "<file>:" headers, the "(pass) name" lines and the counts, without the error blocks.
  const resultLines = (stderr: string) =>
    stderr.split("\n").filter(line => /^(\S+\.test\.ts:|\((pass|fail|skip|todo)\) .+| \d+ [a-z ]+)$/.test(line));

  test("--todo: a todo test with a body can run, one without a body cannot", async () => {
    const { stderr, exitCode } = await run(
      {
        "todo-only-with-a-body.test.ts": `
          test("plain", () => {});
          describe.todo("todo group", () => {
            test.only("only", () => {
              throw new Error("not implemented");
            });
          });
        `,
        "todo-only-without-a-body.test.ts": `
          test("plain", () => {});
          test.todo.only("todo.only");
          describe.only("focused", () => {
            test.todo("todo");
          });
        `,
      },
      "--todo",
    );
    expect(resultLines(stderr)).toEqual([
      "todo-only-with-a-body.test.ts:",
      "(todo) todo group > only",
      "todo-only-without-a-body.test.ts:",
      "(pass) plain",
      "(todo) todo.only",
      "(todo) focused > todo",
      " 1 pass",
      " 3 todo",
      " 0 fail",
    ]);
    expect(exitCode).toBe(0);
  });

  test("-t narrows a focused file and does not change what focuses it", async () => {
    const { stderr, exitCode } = await run(
      {
        // "other" still focuses the file, as in Jest, so "plain" does not run
        "only-filtered-out.test.ts": `
          test("plain", () => {});
          test.only("other", () => {});
        `,
        "skipped-only-filtered-out.test.ts": `
          test("plain", () => {});
          test.skip.only("skip.only", () => {});
          describe.only("focused", () => {
            test.skip("skipped", () => {});
          });
        `,
      },
      "-t",
      "plain",
    );
    expect(stderr).toMatchInlineSnapshot(`
      "only-filtered-out.test.ts:

      skipped-only-filtered-out.test.ts:
      (pass) plain

       1 pass
       3 filtered out
       0 fail
      Ran 1 test across 2 files."
    `);
    expect(exitCode).toBe(0);
  });

  test("a describe.only that throws keeps the file focused", async () => {
    const { stderr, exitCode } = await run({
      "throws.test.ts": `
        describe.only("focused", () => {
          throw new Error("boom");
        });
        test("outside", () => {});
      `,
      "nested-throws.test.ts": `
        describe.only("focused", () => {
          describe("inner", () => {
            throw new Error("boom");
          });
        });
        test("outside", () => {});
      `,
    });
    expect(resultLines(stderr)).toEqual([
      "throws.test.ts:",
      "nested-throws.test.ts:",
      " 0 pass",
      " 0 fail",
      " 2 errors",
    ]);
    expect(exitCode).toBe(1);
  });
});
