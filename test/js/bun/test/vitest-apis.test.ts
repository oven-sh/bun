import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runTests(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("vitest-apis", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results = stderr
    .split("\n")
    .filter(line => /^\((pass|fail|skip|todo)\)/.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  return { stdout, stderr, results, exitCode };
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return Bun.stripANSI((error as Error).message);
  }
  throw new Error("expected the function to throw");
}

describe("modifiers", () => {
  test.concurrent("test.fails inverts the result", async () => {
    const { results, stderr, exitCode } = await runTests({
      "fails.test.ts": `
        import { expect, it, test } from "bun:test";
        test.fails("throws", () => { throw new Error("expected"); });
        test.fails("rejects", async () => { await 1; throw new Error("expected"); });
        it.fails("a failed assertion", () => { expect(1).toBe(2); });
        test.fails("does not throw", () => {});
        test.fails("resolves", async () => { await 1; });
        test.fails.each([[1], [2]])("each %d", n => { if (n === 1) throw new Error("expected"); });
        test.concurrent.fails("concurrent.fails", () => { throw new Error("expected"); });
        test.fails.concurrent("fails.concurrent", () => { throw new Error("expected"); });
      `,
    });
    expect(results).toEqual([
      "(pass) throws",
      "(pass) rejects",
      "(pass) a failed assertion",
      "(fail) does not throw",
      "(fail) resolves",
      "(pass) each 1",
      "(fail) each 2",
      "(pass) concurrent.fails",
      "(pass) fails.concurrent",
    ]);
    expect(stderr).toContain("this test is marked as failing but it passed.");
    expect(exitCode).toBe(1);
  });

  test.concurrent("test.fails passes whatever it is that fails, test.failing when the test throws", async () => {
    const file = (modifier: string) => `
      import { afterEach, beforeEach, describe, expect, onTestFinished, test } from "bun:test";
      const marked = test.${modifier};
      const never = () => new Promise(() => {});
      marked("the test throws", () => { throw new Error("hidden"); });
      marked("nothing", () => {});
      marked("the time limit", never, 1);
      marked("too few assertions", () => { expect.assertions(2); expect(1).toBe(1); });
      marked("as many assertions as announced", () => { expect.assertions(1); expect(1).toBe(1); });
      marked("no assertion", () => { expect.hasAssertions(); });
      marked("a soft assertion", () => { expect.soft("hidden").toBe(2); });
      marked("a matcher that is not awaited", () => { expect(new Promise(resolve => setImmediate(resolve, "hidden"))).resolves.toBe(2); });
      marked("onTestFinished", () => { onTestFinished(() => { throw new Error("shown for failing"); }); });
      describe("beforeEach", () => {
        beforeEach(() => { throw new Error("shown for failing"); });
        afterEach(() => console.log("afterEach ran"));
        marked("test", () => console.log("unreachable"));
      });
      describe("afterEach", () => {
        afterEach(() => { throw new Error("shown for failing"); });
        marked("test", () => {});
      });
      describe("the time limit of beforeEach", () => { beforeEach(never, 1); marked("test", () => console.log("unreachable")); });
      describe("the time limit of afterEach", () => { afterEach(never, 1); marked("test", () => {}); });
      test("the next test", () => {});
    `;
    const [fails, failing] = await Promise.all([
      runTests({ "a.test.ts": file("fails") }),
      runTests({ "a.test.ts": file("failing") }),
    ]);
    const errors = (stderr: string) => stderr.split("\n").filter(line => /hidden|shown|\^ |^\w*Error:/.test(line));
    expect({ ...fails, stdout: fails.stdout.split("\n").slice(1), stderr: errors(fails.stderr) }).toEqual({
      results: [
        "(pass) the test throws",
        "(fail) nothing",
        "(pass) the time limit",
        "(pass) too few assertions",
        "(fail) as many assertions as announced",
        "(pass) no assertion",
        "(pass) a soft assertion",
        "(pass) a matcher that is not awaited",
        "(pass) onTestFinished",
        "(pass) beforeEach > test",
        "(pass) afterEach > test",
        "(pass) the time limit of beforeEach > test",
        "(pass) the time limit of afterEach > test",
        "(pass) the next test",
      ],
      stdout: ["afterEach ran", ""],
      stderr: Array(2).fill(
        "  ^ this test is marked as failing but it passed. Remove `.fails` if tested behavior now works",
      ),
      exitCode: 1,
    });
    expect(failing.results).toEqual([
      "(pass) the test throws",
      "(fail) nothing",
      "(fail) the time limit",
      "(fail) too few assertions",
      "(fail) as many assertions as announced",
      "(fail) no assertion",
      "(pass) a soft assertion",
      "(pass) a matcher that is not awaited",
      "(fail) onTestFinished",
      "(fail) beforeEach > test",
      "(fail) afterEach > test",
      "(fail) the time limit of beforeEach > test",
      "(fail) the time limit of afterEach > test",
      "(pass) the next test",
    ]);
    expect(errors(failing.stderr).filter(line => line.startsWith("error: "))).toEqual(
      Array(3).fill("error: shown for failing"),
    );
  });

  test.concurrent("test.fails: an attempt in which nothing fails is retried, and ends the repeats", async () => {
    const { results, stdout, exitCode } = await runTests({
      "a.test.ts": `
        import { afterAll, test } from "bun:test";
        const runs = {};
        const failsOn = (name, ...attempts) => () => {
          runs[name] = (runs[name] ?? 0) + 1;
          if (attempts.includes(runs[name])) throw new Error("expected");
        };
        test.fails("retry: fails at once", failsOn("a", 1), { retry: 2 });
        test.fails("retry: fails the second time", failsOn("b", 2), { retry: 2 });
        test.fails("retry: never fails", failsOn("c"), { retry: 2 });
        test.fails("repeats: always fails", failsOn("d", 1, 2, 3), { repeats: 2 });
        test.fails("repeats: does not fail the second time", failsOn("e", 1, 3), { repeats: 2 });
        afterAll(() => console.log(JSON.stringify(runs)));
      `,
    });
    expect({ results, stdout: stdout.split("\n")[1], exitCode }).toEqual({
      results: [
        "(pass) retry: fails at once",
        "(pass) retry: fails the second time (attempt 2)",
        "(fail) retry: never fails (attempt 3)",
        "(pass) repeats: always fails (run 3)",
        "(fail) repeats: does not fail the second time (run 2)",
      ],
      stdout: `{"a":1,"b":2,"c":3,"d":3,"e":2}`,
      exitCode: 1,
    });
  });

  describe.each([[[]], [["--parallel=2"]]])("test.fails in the JUnit report %j", args => {
    test.concurrent("a failure that is expected is not reported, and one that is missing is", async () => {
      using dir = tempDir("vitest-apis-junit", {
        "a.test.ts": `
          import { beforeEach, describe, expect, test } from "bun:test";
          test.fails("throws", () => { throw new Error("hidden"); });
          test.fails("time limit", () => new Promise(() => {}), 1);
          test.fails("assertions", () => { expect.assertions(1); });
          describe("hook", () => { beforeEach(() => { throw new Error("hidden"); }); test.fails("test", () => {}); });
          test.fails("nothing fails", () => {});
          test.failing("nothing throws", () => {});
        `,
        "b.test.ts": `import { test } from "bun:test"; test("another file", () => {});`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--reporter=junit", "--reporter-outfile=junit.xml", ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const cases = (await Bun.file(`${dir}/junit.xml`).text())
        .split("<testcase ")
        .slice(1)
        .map(testcase => [/^name="([^"]*)"/.exec(testcase)![1], /<failure[^>]*>/.exec(testcase)?.[0]]);
      expect(cases.filter(([name]) => name !== "another file")).toEqual([
        ["throws", undefined],
        ["time limit", undefined],
        ["assertions", undefined],
        ["test", undefined],
        ["nothing fails", `<failure message="test marked with .fails() did not fail" type="AssertionError"/>`],
        ["nothing throws", `<failure message="test marked with .failing() did not throw" type="AssertionError"/>`],
      ]);
      expect(stderr).not.toContain("hidden");
      expect(exitCode).toBe(1);
    });
  });

  test.concurrent("runIf runs when the condition is truthy and skips otherwise", async () => {
    const { results, exitCode } = await runTests({
      "runIf.test.ts": `
        import { describe, expect, it, test } from "bun:test";
        const never = () => { throw new Error("must not run"); };
        test.runIf(true)("test true", () => {});
        test.runIf(false)("test false", never);
        it.runIf(1)("it truthy", () => {});
        it.runIf("")("it falsy", never);
        test.runIf(true).each([[1], [2]])("each true %d", () => {});
        test.runIf(false).each([[1], [2]])("each false %d", never);
        test.concurrent.runIf(false)("concurrent false", never);
        test.runIf(true).runIf(false)("true then false", never);
        test.runIf(false).runIf(false)("false then false", never);
        test.skipIf(true).runIf(false)("skipIf then runIf", never);
        test.runIf(true).fails("true, fails", () => { throw new Error("expected"); });
        test.runIf(false).fails("false, fails", never);
        describe.runIf(true)("describe true", () => { test("inner", () => {}); });
        describe.runIf(false)("describe false", () => { test("inner", never); });
        test("no condition", () => { expect(() => test.runIf()).toThrow("Expected condition to be a boolean"); });
      `,
    });
    expect(results).toEqual([
      "(pass) test true",
      "(skip) test false",
      "(pass) it truthy",
      "(skip) it falsy",
      "(pass) each true 1",
      "(pass) each true 2",
      "(skip) each false 1",
      "(skip) each false 2",
      "(skip) concurrent false",
      "(skip) true then false",
      "(skip) false then false",
      "(skip) skipIf then runIf",
      "(pass) true, fails",
      "(skip) false, fails",
      "(pass) describe true > inner",
      "(skip) describe false > inner",
      "(pass) no condition",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("sequential tests do not overlap inside a concurrent group", async () => {
    const { results, exitCode } = await runTests({
      "sequential.test.ts": `
        import { describe, expect, it, test } from "bun:test";
        const nextTurn = () => new Promise(resolve => setImmediate(resolve));
        let running = 0;
        async function alone() {
          expect(running).toBe(0);
          running++;
          await nextTurn();
          expect(running).toBe(1);
          running--;
        }
        describe.concurrent("concurrent", () => {
          const { promise: secondStarted, resolve: startSecond } = Promise.withResolvers();
          test("first waits for second", () => secondStarted);
          test("second", () => startSecond());
          test.sequential("test.sequential 1", alone);
          test.sequential("test.sequential 2", alone);
          it.sequential("it.sequential", alone);
          test.sequential.each([[1], [2]])("each %d", alone);
          describe.sequential("describe.sequential", () => {
            test("1", alone);
            test("2", alone);
          });
        });
      `,
    });
    expect(results).toEqual([
      "(pass) concurrent > second",
      "(pass) concurrent > first waits for second",
      "(pass) concurrent > test.sequential 1",
      "(pass) concurrent > test.sequential 2",
      "(pass) concurrent > it.sequential",
      "(pass) concurrent > each 1",
      "(pass) concurrent > each 2",
      "(pass) concurrent > describe.sequential > 1",
      "(pass) concurrent > describe.sequential > 2",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("modifiers combine in any order: a repeated one is a no-op and skip > todo > fails", async () => {
    const { results, stdout, exitCode } = await runTests({
      "chains.test.ts": `
        import { describe, test } from "bun:test";
        const never = () => { throw new Error("must not run"); };
        test.skip.skip("skip.skip", never);
        test.skip.todo("skip.todo", never);
        test.todo.skip("todo.skip", never);
        test.skip.fails("skip.fails", never);
        test.fails.skip("fails.skip", never);
        test.skip.failing("skip.failing", never);
        test.todo.todo("todo.todo", never);
        test.todo.fails("todo.fails", never);
        test.fails.todo("fails.todo", never);
        test.fails.fails("fails.fails", () => { throw new Error("expected"); });
        test.fails.failing("fails.failing", () => { throw new Error("expected"); });
        test.concurrent.concurrent("concurrent.concurrent", () => {});
        test.sequential.sequential("sequential.sequential", () => {});
        test.sequential.serial("sequential.serial", () => {});
        test.skipIf(true).skipIf(true)("skipIf.skipIf", never);
        test.skipIf(true).todoIf(true)("skipIf.todoIf", never);
        test.todoIf(true).skipIf(true)("todoIf.skipIf", never);
        test.failingIf(true).skipIf(true)("failingIf.skipIf", never);
        describe.skip.skip("describe.skip.skip", () => { test("inner", never); });
        describe.todo.skip("describe.todo.skip", () => { test("inner", never); });

        const modifiers = ["skip", "only", "todo", "fails", "concurrent", "sequential", "shuffle"];
        const functions = ["runIf", "skipIf", "each"];
        for (const [name, root, skipped] of [["test", test, ["shuffle"]], ["describe", describe, ["fails"]]]) {
          for (const first of modifiers.filter(m => !skipped.includes(m))) {
            for (const second of [...modifiers, ...functions].filter(m => !skipped.includes(m))) {
              let outcome;
              try { outcome = typeof root[first][second]; } catch (error) { outcome = error.message; }
              if (outcome !== "function") console.log(name + "." + first + "." + second + ": " + outcome);
            }
          }
        }
      `,
    });
    expect(results).toEqual([
      "(skip) skip.skip",
      "(skip) skip.todo",
      "(skip) todo.skip",
      "(skip) skip.fails",
      "(skip) fails.skip",
      "(skip) skip.failing",
      "(todo) todo.todo",
      "(todo) todo.fails",
      "(todo) fails.todo",
      "(pass) fails.fails",
      "(pass) fails.failing",
      "(pass) concurrent.concurrent",
      "(pass) sequential.sequential",
      "(pass) sequential.serial",
      "(skip) skipIf.skipIf",
      "(skip) skipIf.todoIf",
      "(skip) todoIf.skipIf",
      "(skip) failingIf.skipIf",
      "(skip) describe.skip.skip > inner",
      "(skip) describe.todo.skip > inner",
    ]);
    expect(stdout.split("\n").filter(line => line.includes(": "))).toEqual([
      "test.concurrent.sequential: Cannot get .sequential on test.concurrent",
      "test.sequential.concurrent: Cannot get .concurrent on test.serial",
      "describe.concurrent.sequential: Cannot get .sequential on describe.concurrent",
      "describe.sequential.concurrent: Cannot get .concurrent on describe.serial",
    ]);
    expect(exitCode).toBe(0);
  });

  test("describe.fails is an error, like describe.failing", () => {
    expect(() => (describe as any).fails).toThrow("Cannot get .fails on describe");
  });

  describe.concurrent("describe.shuffle", () => {
    const numbered = (prefix: string, count = 20) => Array.from({ length: count }, (_, i) => prefix + i);
    const seedOf = (stderr: string) => /^ --seed=(\d+)$/m.exec(stderr)?.[1];
    const linesOf = (stdout: string) => stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
    const startingWith = (lines: string[], prefix: string) => lines.filter(line => line.startsWith(prefix));
    const add = `const add = (prefix, count = 20) => { for (let i = 0; i < count; i++) test(prefix + i, () => console.log(prefix + i)); };`;
    const blocks = (module: string) => `
      import { afterAll, beforeAll, describe, test } from "${module}";
      ${add}
      add("before", 3);
      describe.shuffle("shuffled", () => {
        beforeAll(() => console.log("beforeAll"));
        afterAll(() => console.log("afterAll"));
        add("outer");
        describe("nested", () => {
          beforeAll(() => console.log("nested beforeAll"));
          afterAll(() => console.log("nested afterAll"));
          add("inner");
        });
      });
      add("after", 3);
    `;

    test.each(["bun:test", "vitest"])(
      "of %j shuffles its tests and the blocks inside it, by the seed",
      async module => {
        const files = { "a.test.ts": blocks(module) };
        const first = await runTests(files);
        const lines = linesOf(first.stdout);

        expect(lines.slice(0, 4)).toEqual([...numbered("before", 3), "beforeAll"]);
        expect(lines.slice(-4)).toEqual(["afterAll", ...numbered("after", 3)]);
        expect(startingWith(lines, "outer").toSorted()).toEqual(numbered("outer").toSorted());
        expect(startingWith(lines, "outer")).not.toEqual(numbered("outer"));
        const nested = lines.slice(lines.indexOf("nested beforeAll") + 1, lines.indexOf("nested afterAll"));
        expect(nested.toSorted()).toEqual(numbered("inner").toSorted());
        expect(nested).not.toEqual(numbered("inner"));
        expect(first.exitCode).toBe(0);

        const seed = seedOf(first.stderr);
        expect(seed).toBeString();
        const [again, another] = await Promise.all([
          runTests(files, ["--seed=" + seed]),
          runTests(files, ["--seed=" + (Number(seed) ^ 1)]),
        ]);
        expect({
          outer: startingWith(linesOf(again.stdout), "outer"),
          inner: startingWith(linesOf(again.stdout), "inner"),
          seed: seedOf(again.stderr),
        }).toEqual({ outer: startingWith(lines, "outer"), inner: nested, seed });
        expect(startingWith(linesOf(another.stdout), "outer")).not.toEqual(startingWith(lines, "outer"));
      },
    );

    test("the shuffle option of a block of vitest, which the blocks inside it inherit until one says false", async () => {
      const files = {
        "a.test.ts": `
          import { describe, test } from "vitest";
          import { describe as bunDescribe } from "bun:test";
          ${add}
          describe("on", { shuffle: true }, () => {
            add("on");
            describe("off", { shuffle: false }, () => {
              add("off");
              describe("nested", () => add("nestedOff"));
              describe.shuffle("on again", () => add("again"));
            });
            bunDescribe("of bun:test", () => add("inherited"));
          });
          describe.shuffle("the modifier wins", { shuffle: false }, () => add("modifier"));
          bunDescribe("bun:test does not read it", () => add("ignored"), { shuffle: true });
          describe.shuffle.each([["x"], ["y"]])("each %s", letter => add(letter));
          describe.shuffle.skip("skipped", () => add("skipped", 1));
          test("the option means nothing for a test", { shuffle: true }, () => {});
        `,
      };
      const [plain, randomized] = await Promise.all([runTests(files), runTests(files, ["--randomize"])]);
      const inOrder = (stdout: string) =>
        Object.fromEntries(
          ["on", "off", "nestedOff", "again", "inherited", "modifier", "ignored", "x", "y"].map(prefix => {
            const lines = linesOf(stdout).filter(line => line.replace(/\d+$/, "") === prefix);
            expect(lines.toSorted()).toEqual(numbered(prefix).toSorted());
            return [prefix, lines.join() === numbered(prefix).join()];
          }),
        );
      const shuffled = { on: false, again: false, inherited: false, modifier: false, x: false, y: false };
      expect(inOrder(plain.stdout)).toEqual({ ...shuffled, off: true, nestedOff: true, ignored: true });
      expect(inOrder(randomized.stdout)).toEqual({ ...shuffled, off: true, nestedOff: true, ignored: false });
      expect(plain.results).toContain("(skip) skipped > skipped0");
      expect({ plain: plain.exitCode, randomized: randomized.exitCode }).toEqual({ plain: 0, randomized: 0 });
    });

    test.each([[[]], [["--parallel=2"]]])(
      "the summary names the seed only if something was shuffled %j",
      async args => {
        const other = `import { test } from "bun:test"; test("other", () => {});`;
        const files = { "a.test.ts": blocks("bun:test"), "b.test.ts": other };
        const [shuffled, inOrder] = await Promise.all([
          runTests(files, args),
          runTests({ "a.test.ts": other, "b.test.ts": other }, args),
        ]);
        expect({ seed: seedOf(inOrder.stderr), exitCode: inOrder.exitCode }).toEqual({ seed: undefined, exitCode: 0 });
        const seed = seedOf(shuffled.stderr);
        expect(seed).toBeString();
        const again = await runTests(files, ["--seed=" + seed]);
        // The coordinator of --parallel prints what its workers wrote to stderr.
        const lines = linesOf(shuffled.stdout + shuffled.stderr);
        expect(startingWith(lines, "outer")).not.toEqual(numbered("outer"));
        expect(startingWith(lines, "outer")).toEqual(startingWith(linesOf(again.stdout), "outer"));
        expect(startingWith(lines, "after")).toEqual(["afterAll", ...numbered("after", 3)]);
        expect(shuffled.exitCode).toBe(0);
      },
    );

    test("is a modifier of describe only", () => {
      expect(describe.shuffle).toBeFunction();
      expect((test as any).shuffle).toBeUndefined();
      expect((test.skip as any).shuffle).toBeUndefined();
    });
  });
});

const stateAtTopLevel = { ...expect.getState?.() };

describe("expect.getState", () => {
  const stateInDescribe = { ...expect.getState?.() };
  const names: Record<string, unknown> = {};
  beforeAll(() => {
    names.beforeAll = expect.getState?.().currentTestName;
  });
  beforeEach(() => {
    names.beforeEach = expect.getState?.().currentTestName;
  });
  afterEach(() => {
    names.afterEach = expect.getState?.().currentTestName;
  });

  describe("nested", () => {
    test("currentTestName joins the describe blocks and the test like a snapshot key", () => {
      const name = "expect.getState nested currentTestName joins the describe blocks and the test like a snapshot key";
      expect(expect.getState().currentTestName).toBe(name);
      expect(names.beforeEach).toBe(name);
      expect(names.beforeAll).toBeUndefined();
    });

    test("afterEach saw the name of the test it ran for", () => {
      expect(names.afterEach).toBe(
        "expect.getState nested currentTestName joins the describe blocks and the test like a snapshot key",
      );
    });

    test.each([["a"], ["b"]])("each %s", letter => {
      expect(expect.getState().currentTestName).toBe(`expect.getState nested each ${letter}`);
    });
  });

  test("testPath is the absolute path of the test file", () => {
    expect(expect.getState().testPath).toBe(import.meta.path);
    expect(stateAtTopLevel.testPath).toBe(import.meta.path);
  });

  test("outside of a test there is no test name and no assertion", () => {
    for (const state of [stateAtTopLevel, stateInDescribe]) {
      expect(state).toEqual({
        assertionCalls: 0,
        currentTestName: undefined,
        expectedAssertionsNumber: null,
        isExpectingAssertions: false,
        suppressedErrors: [],
        testPath: import.meta.path,
      });
    }
  });

  test("assertionCalls counts the assertions of this test, failed ones included", () => {
    const counts = [expect.getState().assertionCalls];
    expect(1).toBe(1);
    expect(2).not.toBe(1);
    counts.push(expect.getState().assertionCalls);
    try {
      expect(1).toBe(2);
    } catch {}
    counts.push(expect.getState().assertionCalls);
    expect(counts).toEqual([0, 2, 3]);
  });

  test("reflects expect.assertions() and expect.hasAssertions()", () => {
    const seen: unknown[] = [];
    const record = () => {
      const { expectedAssertionsNumber, isExpectingAssertions } = expect.getState();
      seen.push([expectedAssertionsNumber, isExpectingAssertions]);
    };
    record();
    expect.hasAssertions();
    record();
    expect.assertions(1);
    record();
    expect(seen).toEqual([
      [null, false],
      [null, true],
      [1, false],
    ]);
  });

  test("returns the same object every time, with plain enumerable properties", () => {
    const state = expect.getState();
    expect(expect.getState()).toBe(state);
    expect(Object.keys(state)).toEqual(
      expect.arrayContaining([
        "assertionCalls",
        "currentTestName",
        "expectedAssertionsNumber",
        "isExpectingAssertions",
        "suppressedErrors",
        "testPath",
      ]),
    );
    expect(Object.getOwnPropertyDescriptor(state, "testPath")).toEqual({
      value: import.meta.path,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });

  test.concurrent("the test is unknown in a concurrent test (1)", async () => {
    await Promise.resolve();
    expect(expect.getState().currentTestName).toBeUndefined();
    expect(expect.getState().testPath).toBe(import.meta.path);
  });

  test.concurrent("the test is unknown in a concurrent test (2)", async () => {
    await Promise.resolve();
    expect(() => expect.setState({ assertionCalls: 1 })).toThrow(
      "expect.setState() cannot set the assertion counters in the describe phase, in concurrent tests, between tests, or after test execution has completed",
    );
  });
});

describe("expect.setState", () => {
  test("merges unknown keys, which stay for later tests", () => {
    expect(expect.setState({ vitestApisFirst: 1 })).toBeUndefined();
    expect.setState({ vitestApisSecond: { nested: true }, 7: "index" });
    expect(expect.getState()).toMatchObject({ vitestApisFirst: 1, vitestApisSecond: { nested: true }, 7: "index" });
    expect.setState({ vitestApisFirst: 2 });
    expect(expect.getState().vitestApisFirst).toBe(2);
    expect(expect.getState().vitestApisSecond).toEqual({ nested: true });
  });

  test("a later test still sees them", () => {
    expect(expect.getState()).toMatchObject({ vitestApisFirst: 2, vitestApisSecond: { nested: true } });
  });

  test("what the caller puts on the state object stays too", () => {
    expect.getState().vitestApisDirect = "direct";
    expect(expect.getState().vitestApisDirect).toBe("direct");
  });

  test("assertionCalls feeds expect.assertions()", () => {
    expect.assertions(5);
    expect.setState({ assertionCalls: 5 });
  });

  test("expectedAssertionsNumber is what expect.assertions() sets, and null unsets it", () => {
    expect.setState({ expectedAssertionsNumber: 40 });
    const set = expect.getState().expectedAssertionsNumber;
    expect.setState({ expectedAssertionsNumber: null });
    const unset = expect.getState().expectedAssertionsNumber;
    expect([set, unset]).toEqual([40, null]);
  });

  test("isExpectingAssertions is what expect.hasAssertions() sets, and false unsets it", () => {
    expect.setState({ isExpectingAssertions: true });
    const set = expect.getState().isExpectingAssertions;
    expect.setState({ isExpectingAssertions: false });
    const unset = expect.getState().isExpectingAssertions;
    expect.setState({ assertionCalls: 0 });
    if (set !== true || unset !== false) throw new Error(`expected true then false, got ${set} then ${unset}`);
  });

  test("the test name and path belong to the runner", () => {
    expect.setState({ currentTestName: "other", testPath: "/other" });
    expect(expect.getState().currentTestName).toBe("expect.setState the test name and path belong to the runner");
    expect(expect.getState().testPath).toBe(import.meta.path);
  });

  test.each([
    [undefined, 'The "state" argument must be of type object. Received undefined'],
    [1, 'The "state" argument must be of type object. Received type number (1)'],
    [
      { assertionCalls: -1 },
      'The "state.assertionCalls" argument must be of type non-negative integer. Received type number (-1)',
    ],
    [
      { assertionCalls: 1.5 },
      'The "state.assertionCalls" argument must be of type non-negative integer. Received type number (1.5)',
    ],
    [
      { expectedAssertionsNumber: "2" },
      "The \"state.expectedAssertionsNumber\" argument must be of type non-negative integer. Received type string ('2')",
    ],
  ])("rejects %p", (state, message) => {
    expect(messageOf(() => expect.setState(state as any))).toBe(message);
  });

  test.concurrent("the counters it sets decide whether the test passes", async () => {
    const { results, stderr, exitCode } = await runTests({
      "counters.test.ts": `
        import { expect, test } from "bun:test";
        test("expectedAssertionsNumber met", () => { expect.setState({ expectedAssertionsNumber: 1 }); expect(1).toBe(1); });
        test("expectedAssertionsNumber unmet", () => { expect.setState({ expectedAssertionsNumber: 2 }); expect(1).toBe(1); });
        test("isExpectingAssertions met", () => { expect.setState({ isExpectingAssertions: true }); expect(1).toBe(1); });
        test("isExpectingAssertions unmet", () => { expect.setState({ isExpectingAssertions: true }); });
        test("assertionCalls lowered", () => { expect.assertions(1); expect(1).toBe(1); expect.setState({ assertionCalls: 0 }); });
        test("the next test starts from zero", () => {
          const { assertionCalls, expectedAssertionsNumber, isExpectingAssertions } = expect.getState();
          expect([assertionCalls, expectedAssertionsNumber, isExpectingAssertions]).toEqual([0, null, false]);
        });
      `,
    });
    expect(results).toEqual([
      "(pass) expectedAssertionsNumber met",
      "(fail) expectedAssertionsNumber unmet",
      "(pass) isExpectingAssertions met",
      "(fail) isExpectingAssertions unmet",
      "(fail) assertionCalls lowered",
      "(pass) the next test starts from zero",
    ]);
    expect(stderr).toContain("expected 2 assertions, but test ended with 1 assertion");
    expect(stderr).toContain("received 0 assertions, but expected at least one assertion to be called");
    expect(stderr).toContain("expected 1 assertion, but test ended with 0 assertions");
    expect(exitCode).toBe(1);
  });
});

test("a custom matcher reads the state of the test from `this`", () => {
  let seen: Record<string, unknown> = {};
  expect.extend({
    toRecordItsContext() {
      seen = {
        assertionCalls: this.assertionCalls,
        currentTestName: this.currentTestName,
        customTesters: Array.isArray(this.customTesters),
        expectedAssertionsNumber: this.expectedAssertionsNumber,
        isExpectingAssertions: this.isExpectingAssertions,
        suppressedErrors: this.suppressedErrors,
        testPath: this.testPath,
      };
      return { pass: true, message: () => "" };
    },
  });
  expect.assertions(3);
  expect(1).toBe(1);
  (expect(1) as any).toRecordItsContext();
  expect(seen).toEqual({
    assertionCalls: 2,
    currentTestName: "a custom matcher reads the state of the test from `this`",
    customTesters: true,
    expectedAssertionsNumber: 3,
    isExpectingAssertions: false,
    suppressedErrors: [],
    testPath: import.meta.path,
  });
});

test.concurrent(
  "among concurrent tests, a custom matcher of the expect of a test context reads the state of that test",
  async () => {
    const { stdout, results, exitCode } = await runTests(
      {
        "shared.ts": `
        import { expect } from "bun:test";
        export const contexts = [];
        expect.extend({
          toShowItsTest(received, label) {
            contexts.push(this);
            console.log(label + ":", this.currentTestName, this.assertionCalls, this.expectedAssertionsNumber, this.isExpectingAssertions);
            return { pass: true, message: () => "" };
          },
        });
      `,
        "a.test.ts": `
        import { describe, test } from "vitest";
        import { contexts } from "./shared.ts";
        describe.concurrent("concurrent", () => {
          test("one", async ({ expect }) => {
            expect.assertions(2);
            expect(1).toShowItsTest("one");
            await 1;
            expect(1).toShowItsTest("one, later");
          });
          test("two", async ({ expect }) => {
            expect.hasAssertions();
            await 1;
            expect(1).toShowItsTest("two");
          });
        });
        test("afterwards", () => console.log("afterwards:", contexts.map(context => context.currentTestName).join()));
      `,
        "b.test.ts": `
        import { test } from "bun:test";
        import { contexts } from "./shared.ts";
        test("the next file", () => console.log("the next file:", contexts.map(context => context.currentTestName).join()));
      `,
      },
      ["./a.test.ts", "./b.test.ts"],
    );
    expect({
      stdout: stdout
        .split("\n")
        .filter(line => line.includes(":"))
        .toSorted(),
      results: results.toSorted(),
      exitCode,
    }).toEqual({
      stdout: [
        "afterwards: concurrent > one,concurrent > one,concurrent > two",
        "one, later: concurrent > one 2 2 false",
        "one: concurrent > one 1 2 false",
        "the next file: the next file,the next file,the next file",
        "two: concurrent > two 1 null true",
      ],
      results: ["(pass) afterwards", "(pass) concurrent > one", "(pass) concurrent > two", "(pass) the next file"],
      exitCode: 0,
    });
  },
);

test("this.equals and the functions of this.utils do not need a receiver", () => {
  let outcome: unknown;
  expect.extend({
    toUseDetachedFunctions(received, expected) {
      const { equals, utils } = this;
      const { stringify, printExpected, printReceived, EXPECTED_COLOR, RECEIVED_COLOR, matcherHint } = utils as any;
      outcome = {
        equals: [equals(received, expected), [[1]].some(item => equals(item, [1])), equals.call(undefined, 1, 2)],
        explicitTesters: equals(1, 2, [() => true]),
        sameFunction: [equals === this.equals, stringify === utils.stringify],
        strings: [stringify, printExpected, printReceived].map(print => Bun.stripANSI(print({ a: "b" }))),
        colors: [EXPECTED_COLOR, RECEIVED_COLOR].map(color => Bun.stripANSI(color("text"))),
        matcherHint: Bun.stripANSI(matcherHint("toUseDetachedFunctions")).split("\n")[0],
        ownFunctions: Object.keys(utils).sort(),
      };
      return { pass: true, message: () => "" };
    },
  });
  (expect({ a: [1] }) as any).toUseDetachedFunctions({ a: [1] });
  const printed = '{\n  a: "b",\n}';
  expect(outcome).toEqual({
    equals: [true, true, false],
    explicitTesters: true,
    sameFunction: [true, true],
    strings: [printed, printed, printed],
    colors: ["text", "text"],
    matcherHint: "expect(received).toUseDetachedFunctions(expected)",
    ownFunctions: [
      "EXPECTED_COLOR",
      "RECEIVED_COLOR",
      "diff",
      "matcherHint",
      "printExpected",
      "printReceived",
      "printWithType",
      "stringify",
    ],
  });
});

test.concurrent("matchers of jest-extended, which detach this.equals and this.utils", async () => {
  // One module per matcher: the whole package takes seconds to load in a debug build.
  const matcher = (name: string) =>
    `import { ${name} } from ${JSON.stringify(require.resolve(`jest-extended/dist/matchers/${name}.js`))};`;
  const { results, stdout, exitCode } = await runTests({
    "jest-extended.test.ts": `
      import { expect, test } from "bun:test";
      ${matcher("toBeHexadecimal")}
      ${matcher("toIncludeAllMembers")}
      ${matcher("toIncludeSameMembers")}
      expect.extend({ toBeHexadecimal, toIncludeAllMembers, toIncludeSameMembers });
      test("this.equals is passed to a helper", () => {
        expect([1, { a: 2 }]).toIncludeAllMembers([{ a: 2 }]);
        expect([1, { a: 2 }]).not.toIncludeAllMembers([{ a: 3 }]);
        expect([{ a: 1 }, { b: 2 }]).toIncludeSameMembers([{ b: 2 }, { a: 1 }]);
      });
      test("the message is built with detached utils", () => {
        try {
          expect("zz").toBeHexadecimal();
        } catch (error) {
          console.log(Bun.stripANSI(error.message).split("\\n").slice(-2).join("|"));
        }
      });
    `,
  });
  expect(stdout).toContain('Expected value to be a hexadecimal, received:|  "zz"\n');
  expect(results).toEqual([
    "(pass) this.equals is passed to a helper",
    "(pass) the message is built with detached utils",
  ]);
  expect(exitCode).toBe(0);
});

describe("expect.addEqualityTesters", () => {
  class Volume {
    constructor(
      public amount: number,
      public unit: "L" | "mL",
    ) {}
    toMillilitres() {
      return this.unit === "L" ? this.amount * 1000 : this.amount;
    }
  }
  const litre = () => new Volume(1, "L");
  const thousandMillilitres = () => new Volume(1000, "mL");
  const twoLitres = () => new Volume(2, "L");

  const seen: unknown[][] = [];
  function areVolumesEqual(this: unknown, a: unknown, b: unknown, customTesters: unknown): boolean | undefined {
    seen.push([this, a, b, customTesters]);
    const isAVolume = a instanceof Volume;
    const isBVolume = b instanceof Volume;
    if (isAVolume && isBVolume) return a.toMillilitres() === b.toMillilitres();
    if (isAVolume !== isBVolume) return false;
    return undefined;
  }

  test("values that differ are equal once a tester says so", () => {
    expect(litre()).not.toEqual(thousandMillilitres());
    expect(expect.addEqualityTesters([])).toBeUndefined();
    expect(litre()).not.toEqual(thousandMillilitres());
    expect(expect.addEqualityTesters([areVolumesEqual])).toBeUndefined();
    expect(litre()).toEqual(thousandMillilitres());
  });

  const matchers: [string, () => void, () => void][] = [
    ["toEqual", () => expect(litre()).toEqual(thousandMillilitres()), () => expect(litre()).not.toEqual(twoLitres())],
    [
      "toEqual on a property",
      () => expect({ a: 1, v: litre() }).toEqual({ a: 1, v: thousandMillilitres() }),
      () => expect({ a: 1, v: litre() }).not.toEqual({ a: 1, v: twoLitres() }),
    ],
    [
      "toEqual on an array element",
      () => expect([0, litre()]).toEqual([0, thousandMillilitres()]),
      () => expect([0, litre()]).not.toEqual([0, twoLitres()]),
    ],
    [
      "toEqual on a Map value",
      () => expect(new Map([["k", litre()]])).toEqual(new Map([["k", thousandMillilitres()]])),
      () => expect(new Map([["k", litre()]])).not.toEqual(new Map([["k", twoLitres()]])),
    ],
    [
      "toEqual on a Set member",
      () => expect(new Set([litre()])).toEqual(new Set([thousandMillilitres()])),
      () => expect(new Set([litre()])).not.toEqual(new Set([twoLitres()])),
    ],
    [
      "toStrictEqual",
      () => expect({ v: litre() }).toStrictEqual({ v: thousandMillilitres() }),
      () => expect({ v: litre() }).not.toStrictEqual({ v: twoLitres() }),
    ],
    [
      "toContainEqual",
      () => expect([twoLitres(), litre()]).toContainEqual(thousandMillilitres()),
      () => expect([twoLitres()]).not.toContainEqual(thousandMillilitres()),
    ],
    [
      "toMatchObject",
      () => expect({ v: litre(), extra: 1 }).toMatchObject({ v: thousandMillilitres() }),
      () => expect({ v: litre(), extra: 1 }).not.toMatchObject({ v: twoLitres() }),
    ],
    [
      "toMatchObject on the values themselves",
      () => expect(litre()).toMatchObject(thousandMillilitres()),
      () => expect(litre()).not.toMatchObject(twoLitres()),
    ],
    [
      "toHaveProperty",
      () => expect({ a: { v: litre() } }).toHaveProperty("a.v", thousandMillilitres()),
      () => expect({ a: { v: litre() } }).not.toHaveProperty("a.v", twoLitres()),
    ],
    [
      "expect.arrayContaining",
      () => expect([litre()]).toEqual(expect.arrayContaining([thousandMillilitres()])),
      () => expect([litre()]).not.toEqual(expect.arrayContaining([twoLitres()])),
    ],
    [
      "expect.objectContaining",
      () => expect({ v: litre(), extra: 1 }).toEqual(expect.objectContaining({ v: thousandMillilitres() })),
      () => expect({ v: litre(), extra: 1 }).not.toEqual(expect.objectContaining({ v: twoLitres() })),
    ],
  ];
  test.each(matchers)("%s", (_, equal, different) => {
    equal();
    different();
  });

  test.each([
    ["toHaveBeenCalledWith", []],
    ["toHaveBeenLastCalledWith", []],
    ["toHaveBeenNthCalledWith", [1]],
    ["toHaveBeenCalledExactlyOnceWith", []],
  ] as const)("%s", (matcher, leading) => {
    const fn = mock();
    fn(litre(), "other");
    (expect(fn) as any)[matcher](...leading, thousandMillilitres(), "other");
    (expect(fn).not as any)[matcher](...leading, twoLitres(), "other");
  });

  test.each([
    ["toHaveReturnedWith", []],
    ["toHaveLastReturnedWith", []],
    ["toHaveNthReturnedWith", [1]],
    ["toHaveResolvedWith", []],
    ["toHaveLastResolvedWith", []],
    ["toHaveNthResolvedWith", [1]],
  ] as const)("%s", (matcher, leading) => {
    const fn = mock(() => litre());
    fn();
    (expect(fn) as any)[matcher](...leading, thousandMillilitres());
    (expect(fn).not as any)[matcher](...leading, twoLitres());
  });

  test("toBe, toContain and Bun.deepEquals do not use testers", () => {
    expect(litre()).toEqual(thousandMillilitres());
    expect(litre()).not.toBe(thousandMillilitres());
    expect([litre()]).not.toContain(thousandMillilitres());
    expect(Bun.deepEquals(litre(), thousandMillilitres())).toBe(false);
    expect(Bun.deepEquals(litre(), thousandMillilitres(), true)).toBe(false);
  });

  test("a tester gets the two values, the testers in use, and this.equals", () => {
    seen.length = 0;
    const received = litre();
    const expected = thousandMillilitres();
    expect(received).toEqual(expected);
    expect(seen).toHaveLength(1);
    const [context, a, b, customTesters] = seen[0] as [{ equals: unknown }, unknown, unknown, unknown[]];
    expect(a).toBe(received);
    expect(b).toBe(expected);
    expect(customTesters).toContain(areVolumesEqual);
    expect(context.equals).toBeFunction();
  });

  test("a tester is asked about every level, before the built-in rules, even for the same object", () => {
    seen.length = 0;
    const same = { v: 1 };
    expect(same).toEqual(same);
    expect({ list: ["x", "y"] }).toEqual({ list: ["x", "y"] });
    expect(seen.map(([, a]) => a)).toEqual([same, { list: ["x", "y"] }, ["x", "y"], "x", "y"]);
  });

  test("a hole is undefined for a tester", () => {
    seen.length = 0;
    const holey = new Array(2);
    holey[1] = 1;
    expect(holey).not.toEqual([2, 1]);
    expect(seen.map(([, a, b]) => [a, b]).slice(1)).toEqual([[undefined, 2]]);
  });

  test("asymmetric matchers come first", () => {
    seen.length = 0;
    expect(litre()).toEqual(expect.any(Volume));
    expect(seen).toHaveLength(0);
    expect({ v: litre() }).toEqual({ v: expect.any(Volume) });
    expect(seen).toHaveLength(1);
  });

  test("the sample of expect.objectContaining is a pattern, not a value for a tester", () => {
    expect(litre()).toEqual(thousandMillilitres());
    expect(litre()).not.toEqual(expect.objectContaining(thousandMillilitres()));
    expect(litre()).toEqual(expect.objectContaining({ unit: "L" }));
  });

  test("testers run in registration order until one has an opinion", () => {
    const calls: number[] = [];
    expect.addEqualityTesters([
      a => {
        if (a === "vitest-apis-order") calls.push(1);
        return undefined;
      },
      a => {
        if (a !== "vitest-apis-order") return undefined;
        calls.push(2);
        return true;
      },
      a => {
        if (a !== "vitest-apis-order") return undefined;
        calls.push(3);
        return false;
      },
    ]);
    expect("vitest-apis-order").toEqual("something else");
    expect(calls).toEqual([1, 2]);
  });

  test("anything but undefined is an opinion, by truthiness", () => {
    let result: unknown;
    expect.addEqualityTesters([a => (a === "vitest-apis-result" ? (result as boolean) : undefined)]);
    const verdicts = [true, 1, "yes", {}, false, null, 0, "", NaN].map(value => {
      result = value;
      try {
        expect("vitest-apis-result").toEqual("something else");
        return true;
      } catch {
        return false;
      }
    });
    expect(verdicts).toEqual([true, true, true, true, false, false, false, false, false]);
  });

  test("what a tester throws is thrown by the matcher", () => {
    expect.addEqualityTesters([
      a => {
        if (a === "vitest-apis-throw") throw new RangeError("the tester threw");
        return undefined;
      },
    ]);
    expect(() => expect("vitest-apis-throw").toEqual("x")).toThrow(new RangeError("the tester threw"));
    expect(() => expect({ deep: ["vitest-apis-throw"] }).toEqual({ deep: ["x"] })).toThrow(
      new RangeError("the tester threw"),
    );
    expect(() => expect({ deep: "vitest-apis-throw" }).toMatchObject({ deep: "x" })).toThrow(
      new RangeError("the tester threw"),
    );
  });

  test("this.equals uses only the testers it is given", () => {
    class Box {
      constructor(public content: unknown) {}
    }
    const outcomes: unknown[] = [];
    expect.addEqualityTesters([
      function (a, b, customTesters) {
        if (!(a instanceof Box && b instanceof Box)) return undefined;
        outcomes.push(this.equals(a.content, b.content), this.equals(a.content, b.content, []));
        outcomes.push(this.equals(a.content, b.content, [() => true]));
        const { equals } = this;
        return equals(a.content, b.content, customTesters);
      },
    ]);
    expect(new Box(litre())).toEqual(new Box(thousandMillilitres()));
    expect(outcomes).toEqual([false, false, true]);
    expect(new Box(litre())).not.toEqual(new Box(twoLitres()));
  });

  test("a tester may call this.equals on the values it was given", () => {
    class Tagged {
      constructor(
        public id: number,
        public value: unknown,
      ) {}
    }
    expect.addEqualityTesters([
      function (a, b) {
        if (!(a instanceof Tagged && b instanceof Tagged)) return undefined;
        return this.equals(new Tagged(0, a.value), new Tagged(0, b.value));
      },
    ]);
    expect(new Tagged(1, "same")).toEqual(new Tagged(2, "same"));
    expect(new Tagged(1, "same")).not.toEqual(new Tagged(2, "other"));
  });

  test("the registered testers apply again after this.equals returns or throws", () => {
    expect.extend({
      toCompareWithoutTesters(received, expected) {
        try {
          this.equals(received, expected, [
            () => {
              throw new Error("inner");
            },
          ]);
        } catch {}
        return { pass: this.equals(received, expected) === false, message: () => "" };
      },
    });
    (expect(litre()) as any).toCompareWithoutTesters(thousandMillilitres());
    expect(litre()).toEqual(thousandMillilitres());
  });

  test("a custom matcher gets them as this.customTesters and passes them to this.equals", () => {
    const outcomes: unknown[] = [];
    expect.extend({
      toProbeEquals(received, expected) {
        outcomes.push(
          this.customTesters.includes(areVolumesEqual),
          this.equals(received, expected),
          this.equals(received, expected, this.customTesters),
          this.equals({ a: undefined }, {}, [], false),
          this.equals({ a: undefined }, {}, [], true),
          this.equals.length,
        );
        return { pass: true, message: () => "" };
      },
    });
    (expect(litre()) as any).toProbeEquals(thousandMillilitres());
    expect(outcomes).toEqual([true, false, true, true, false, 4]);
  });

  test.each([
    [undefined, 'The "testers" argument must be of type array. Received undefined'],
    [null, 'The "testers" argument must be of type array. Received null'],
    [{}, 'The "testers" argument must be of type array. Received an instance of Object'],
    [areVolumesEqual, 'The "testers" argument must be of type array. Received function areVolumesEqual'],
    [[areVolumesEqual, 1], 'The "testers[1]" argument must be of type function. Received type number (1)'],
    [[undefined], 'The "testers[0]" argument must be of type function. Received undefined'],
  ])("rejects %p", (testers, message) => {
    expect(messageOf(() => expect.addEqualityTesters(testers as any))).toBe(message);
  });

  test("an invalid list registers nothing", () => {
    const marker = () => undefined;
    expect(() => expect.addEqualityTesters([marker, 1 as any])).toThrow();
    let customTesters: unknown[] = [];
    expect.extend({
      toReadCustomTesters() {
        customTesters = this.customTesters;
        return { pass: true, message: () => "" };
      },
    });
    (expect(1) as any).toReadCustomTesters();
    expect(customTesters).toContain(areVolumesEqual);
    expect(customTesters).not.toContain(marker);
  });

  test("this.equals rejects testers that are not an array of functions", () => {
    const messages: string[] = [];
    expect.extend({
      toPassBadTesters() {
        messages.push(messageOf(() => this.equals(1, 2, "nope" as any)));
        messages.push(messageOf(() => this.equals(1, 2, [1 as any])));
        return { pass: true, message: () => "" };
      },
    });
    (expect(1) as any).toPassBadTesters();
    expect(messages).toEqual([
      "The \"customTesters\" argument must be of type array. Received type string ('nope')",
      'The "customTesters[0]" argument must be of type function. Received type number (1)',
    ]);
  });

  test("a tester is asked about two values that are the same", () => {
    const unequal = 918273645;
    expect.addEqualityTesters([(a, b) => (a === unequal || b === unequal ? false : undefined)]);
    class Holder {
      a = unequal;
    }
    const key = Symbol("key");
    for (const make of [
      () => unequal,
      () => [unequal],
      () => ({ a: unequal }),
      () => ({ a: 1, b: unequal }),
      () => ({ [key]: unequal }),
      () => new Holder(),
      () => ({ nested: { a: [{ b: unequal }] } }),
      () => new Map([["key", unequal]]),
      () => new Uint32Array([unequal]),
      () => new Float64Array([1, unequal]),
    ]) {
      expect(make()).not.toEqual(make());
      expect(make()).not.toStrictEqual(make());
      expect([make()]).not.toContainEqual(make());
      if (!(make() instanceof Map)) expect({ a: make() }).not.toMatchObject({ a: make() });
    }
    expect({ a: unequal, b: 1 }).not.toEqual({ b: 1, a: unequal });
    expect(new Float64Array([1, 2])).toEqual(new Float64Array([1, 2]));
    expect(new Float64Array([1, 2])).not.toEqual(new Float64Array([1, 3]));
  });

  test("a tester is asked about the elements of typed arrays", () => {
    expect.addEqualityTesters([
      (a, b) =>
        typeof a === "number" && typeof b === "number" && a > 5e8 && b > 5e8 ? Math.abs(a - b) < 1 : undefined,
    ]);
    expect(new Float64Array([1, 6e8])).toEqual(new Float64Array([1, 6e8 + 0.5]));
    expect(new Float64Array([1, 6e8])).not.toEqual(new Float64Array([1, 6e8 + 2]));
    expect(new Float64Array([1, 6e8])).not.toEqual(new Float64Array([2, 6e8]));
  });

  test("the testers survive garbage collection", () => {
    expect.addEqualityTesters([
      (() => {
        const sentinel = "vitest-apis-gc";
        return (a: unknown) => (a === sentinel ? true : undefined);
      })(),
    ]);
    Bun.gc(true);
    expect("vitest-apis-gc").toEqual("something else");
    expect(litre()).toEqual(thousandMillilitres());
  });

  const perFile = {
    "tester.ts": `
      export class Celsius { constructor(public degrees: number) {} }
      export class Fahrenheit { constructor(public degrees: number) {} }
      export function sameTemperature(a: unknown, b: unknown) {
        if (a instanceof Celsius && b instanceof Fahrenheit) return a.degrees * 9 / 5 + 32 === b.degrees;
        return undefined;
      }
    `,
    "a-registers.test.ts": `
      import { expect, test } from "bun:test";
      import { Celsius, Fahrenheit, sameTemperature } from "./tester";
      expect.addEqualityTesters([sameTemperature]);
      test("the file that registers a tester uses it", () => {
        expect(new Celsius(100)).toEqual(new Fahrenheit(212));
      });
    `,
    "b-does-not.test.ts": `
      import { expect, test } from "bun:test";
      import { Celsius, Fahrenheit } from "./tester";
      test("the next file does not", () => {
        expect(new Celsius(100)).not.toEqual(new Fahrenheit(212));
      });
      test("and sees no custom testers", () => {
        let count = -1;
        expect.extend({ toCountTesters() { count = this.customTesters.length; return { pass: true, message: () => "" }; } });
        expect(1).toCountTesters();
        expect(count).toBe(Number(process.env.EXPECTED_TESTERS ?? 0));
      });
    `,
  };

  test.concurrent.each([[[]], [["--isolate"]]])("a tester lasts until the end of its test file %j", async args => {
    const { results, exitCode } = await runTests(perFile, args);
    expect(results).toEqual([
      "(pass) the file that registers a tester uses it",
      "(pass) the next file does not",
      "(pass) and sees no custom testers",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("each run of --rerun-each registers once", async () => {
    const { results, exitCode } = await runTests(
      {
        "rerun.test.ts": `
          import { expect, test } from "bun:test";
          expect.addEqualityTesters([() => undefined]);
          test("one tester", () => {
            let count = -1;
            expect.extend({ toCountTesters() { count = this.customTesters.length; return { pass: true, message: () => "" }; } });
            expect(1).toCountTesters();
            expect(count).toBe(1);
          });
        `,
      },
      ["--rerun-each=3"],
    );
    expect(results).toEqual(["(pass) one tester", "(pass) one tester", "(pass) one tester"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([[[]], [["--isolate"]]])(
    "a tester that a module registers holds in every test file that imports the module %j",
    async args => {
      const file = (name: string) => `
        import { expect, test } from "bun:test";
        import { Celsius, Fahrenheit } from "./tester";
        import { registerAgain } from "./registers";
        registerAgain();
        test("${name}", () => {
          expect(new Celsius(100)).toEqual(new Fahrenheit(212));
          let count = -1;
          expect.extend({ toCountTesters() { count = this.customTesters.length; return { pass: true, message: () => "" }; } });
          expect(1).toCountTesters();
          expect(count).toBe(1);
        });
      `;
      const { results, exitCode } = await runTests(
        {
          "tester.ts": perFile["tester.ts"],
          "registers.ts": `
            import { expect } from "bun:test";
            import { sameTemperature } from "./tester";
            expect.addEqualityTesters([sameTemperature]);
            export function registerAgain() {
              expect.addEqualityTesters([sameTemperature]);
            }
          `,
          "a.test.ts": file("a"),
          "b.test.ts": file("b"),
          "c.test.ts": file("c"),
        },
        args,
      );
      expect(results).toEqual(["(pass) a", "(pass) b", "(pass) c"]);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent.each([[[]], [["--isolate"]]])(
    "a tester from a preload script lasts for every file %j",
    async args => {
      const { results, exitCode } = await runTests(
        {
          "tester.ts": perFile["tester.ts"],
          "setup.ts": `
          import { expect } from "bun:test";
          import { sameTemperature } from "./tester";
          expect.addEqualityTesters([sameTemperature]);
        `,
          "a.test.ts": `
          import { expect, test } from "bun:test";
          import { Celsius, Fahrenheit } from "./tester";
          expect.addEqualityTesters([(a, b) => (a === "only in a" ? true : undefined)]);
          test("a: preload and own tester", () => {
            expect(new Celsius(100)).toEqual(new Fahrenheit(212));
            expect("only in a").toEqual("x");
          });
        `,
          "b.test.ts": `
          import { expect, test } from "bun:test";
          import { Celsius, Fahrenheit } from "./tester";
          test("b: preload tester only", () => {
            expect(new Celsius(100)).toEqual(new Fahrenheit(212));
            expect("only in a").not.toEqual("x");
          });
        `,
          "c.test.ts": `
          import { expect, test } from "bun:test";
          import { Celsius, Fahrenheit } from "./tester";
          test("c: preload tester only", () => {
            expect(new Celsius(0)).toEqual(new Fahrenheit(32));
            expect("only in a").not.toEqual("x");
          });
        `,
        },
        ["--preload", "./setup.ts", ...args],
      );
      expect(results).toEqual([
        "(pass) a: preload and own tester",
        "(pass) b: preload tester only",
        "(pass) c: preload tester only",
      ]);
      expect(exitCode).toBe(0);
    },
  );
});

describe("toHaveBeenCalledExactlyOnceWith", () => {
  test("passes for one call with equal arguments", () => {
    const fn = mock();
    fn(1, { a: [2] });
    expect(fn).toHaveBeenCalledExactlyOnceWith(1, { a: [2] });
    expect(fn).toHaveBeenCalledExactlyOnceWith(expect.any(Number), expect.objectContaining({ a: [2] }));
  });

  test("passes for one call without arguments", () => {
    const fn = mock();
    fn();
    expect(fn).toHaveBeenCalledExactlyOnceWith();
    expect(fn).not.toHaveBeenCalledExactlyOnceWith(undefined);
  });

  test("the number of arguments counts", () => {
    const fn = mock();
    fn(1, undefined);
    expect(fn).not.toHaveBeenCalledExactlyOnceWith(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(1, undefined);
  });

  test("fails for other arguments, with a diff", () => {
    const fn = mock();
    fn(1, 3);
    expect(fn).not.toHaveBeenCalledExactlyOnceWith(1, 2);
    const message = messageOf(() => expect(fn).toHaveBeenCalledExactlyOnceWith(1, 2));
    expect(message).toStartWith("expect(received).toHaveBeenCalledExactlyOnceWith(...expected)\n\n");
    expect(message).toEndWith("    1,\n-   2,\n+   3,\n  ]\n\n- Expected  - 1\n+ Received  + 1\n");
  });

  test("fails for more than one call, even when every call matches", () => {
    const fn = mock();
    fn(1);
    fn(1);
    expect(fn).not.toHaveBeenCalledExactlyOnceWith(1);
    expect(messageOf(() => expect(fn).toHaveBeenCalledExactlyOnceWith(1))).toMatchInlineSnapshot(`
      "expect(received).toHaveBeenCalledExactlyOnceWith(...expected)

          Expected: [ 1 ]
          Received:
                    1: [ 1 ]
                    2: [ 1 ]

          Expected number of calls: 1
          Received number of calls: 2
      "
    `);
  });

  test("fails when it was never called", () => {
    const fn = mock();
    expect(fn).not.toHaveBeenCalledExactlyOnceWith();
    expect(messageOf(() => expect(fn).toHaveBeenCalledExactlyOnceWith("a"))).toMatchInlineSnapshot(`
      "expect(received).toHaveBeenCalledExactlyOnceWith(...expected)

      Expected: [ "a" ]
      But it was not called."
    `);
  });

  test(".not fails for one call with equal arguments", () => {
    const fn = mock();
    fn("a");
    expect(messageOf(() => expect(fn).not.toHaveBeenCalledExactlyOnceWith("a"))).toMatchInlineSnapshot(`
      "expect(received).not.toHaveBeenCalledExactlyOnceWith(...expected)

      Expected mock function not to have been called exactly once with: [ "a" ]
      But it was."
    `);
  });

  test("the received value must be a mock function", () => {
    expect(messageOf(() => expect(1).toHaveBeenCalledExactlyOnceWith(1))).toMatchInlineSnapshot(`
      "expect(received).toHaveBeenCalledExactlyOnceWith(...expected)

      Matcher error: received value must be a mock function
      Received: 1"
    `);
  });
});

describe("toHaveBeenCalledBefore and toHaveBeenCalledAfter", () => {
  function called(order: string) {
    const mocks = { a: mock(), b: mock() };
    for (const name of order) mocks[name as "a" | "b"]();
    return mocks;
  }

  // [calls in order, failIfNoFirstInvocation, a before b, b after a]
  test.each([
    ["ab", undefined, true, true],
    ["ba", undefined, false, false],
    ["aba", undefined, true, true],
    ["bab", undefined, false, false],
    ["b", undefined, false, false],
    ["b", true, false, false],
    ["b", false, true, true],
    ["b", 0, true, true],
    ["b", null, true, true],
    ["a", undefined, false, false],
    ["a", false, false, false],
    ["", undefined, false, false],
    ["", false, true, true],
  ] as const)("calls %j, failIfNoFirstInvocation %p", (order, flag, aBeforeB, bAfterA) => {
    const { a, b } = called(order);
    (aBeforeB ? expect(a) : expect(a).not).toHaveBeenCalledBefore(b, flag as boolean);
    (bAfterA ? expect(b) : expect(b).not).toHaveBeenCalledAfter(a, flag as boolean);
  });

  test("a mock function is neither before nor after itself", () => {
    const { a } = called("a");
    expect(a).not.toHaveBeenCalledBefore(a);
    expect(a).not.toHaveBeenCalledAfter(a);
  });

  const withoutInvocationIds = (message: string) => message.replace(/invocation \d+/g, "invocation N");

  test("failure messages", () => {
    const { a, b } = called("ba");
    expect(withoutInvocationIds(messageOf(() => expect(a).toHaveBeenCalledBefore(b)))).toMatchInlineSnapshot(`
      "expect(received).toHaveBeenCalledBefore(expected)

      Expected the first call of received to be before the first call of expected

      First call of received: invocation N
      First call of expected: invocation N
      "
    `);
    expect(withoutInvocationIds(messageOf(() => expect(b).not.toHaveBeenCalledBefore(a)))).toMatchInlineSnapshot(`
      "expect(received).not.toHaveBeenCalledBefore(expected)

      Expected the first call of received not to be before the first call of expected

      First call of received: invocation N
      First call of expected: invocation N
      "
    `);
    expect(withoutInvocationIds(messageOf(() => expect(b).toHaveBeenCalledAfter(mock())))).toMatchInlineSnapshot(`
      "expect(received).toHaveBeenCalledAfter(expected)

      Expected the first call of received to be after the first call of expected

      First call of received: invocation N
      First call of expected: (no calls)
      "
    `);
  });

  test("the message names the two first invocations", () => {
    const { a, b } = called("ba");
    const message = messageOf(() => expect(a).toHaveBeenCalledBefore(b));
    expect(message).toContain(`First call of received: invocation ${a.mock.invocationCallOrder[0]}\n`);
    expect(message).toContain(`First call of expected: invocation ${b.mock.invocationCallOrder[0]}\n`);
  });

  test("both values must be mock functions", () => {
    const { a } = called("a");
    expect(messageOf(() => expect(a).toHaveBeenCalledBefore((() => {}) as any))).toMatchInlineSnapshot(`
      "expect(received).toHaveBeenCalledBefore(expected)

      Matcher error: expected value must be a mock function
      Expected: [Function]"
    `);
    expect(messageOf(() => (expect(a) as any).toHaveBeenCalledAfter())).toMatchInlineSnapshot(`
      "expect(received).toHaveBeenCalledAfter(expected)

      Matcher error: expected value must be a mock function
      Expected: undefined"
    `);
    expect(messageOf(() => expect("a").toHaveBeenCalledAfter(a))).toMatchInlineSnapshot(`
      "expect(received).toHaveBeenCalledAfter(expected)

      Matcher error: received value must be a mock function
      Received: "a""
    `);
  });
});

describe("toHaveResolved and friends", () => {
  /** Calls: resolves 1, rejects "no", resolves { two: 2 }, never settles. */
  async function mixed() {
    const outcomes = [
      () => Promise.resolve(1),
      () => Promise.reject("no"),
      () => Promise.resolve({ two: 2 }),
      () => new Promise(() => {}),
    ];
    const fn = mock(() => outcomes[fn.mock.calls.length - 1]());
    await fn();
    await fn().catch(() => {});
    await fn();
    fn();
    return fn;
  }
  const rejecting = async () => {
    const fn = mock(() => Promise.reject("no"));
    await fn().catch(() => {});
    return fn;
  };
  const pending = () => {
    const fn = mock(() => new Promise(() => {}));
    fn();
    return fn;
  };

  test("toHaveResolved", async () => {
    expect(await mixed()).toHaveResolved();
    expect(await rejecting()).not.toHaveResolved();
    expect(pending()).not.toHaveResolved();
    expect(mock()).not.toHaveResolved();
  });

  test("a value that is not a promise counts as resolved, a throw as rejected", () => {
    const returns = mock(() => 1);
    returns();
    expect(returns).toHaveResolved();
    expect(returns).toHaveResolvedWith(1);
    const throws = mock(() => {
      throw new Error("no");
    });
    expect(throws).toThrow("no");
    expect(throws).not.toHaveResolved();
  });

  test("toHaveResolvedTimes", async () => {
    expect(await mixed()).toHaveResolvedTimes(2);
    expect(await mixed()).not.toHaveResolvedTimes(4);
    expect(await rejecting()).toHaveResolvedTimes(0);
    expect(mock()).toHaveResolvedTimes(0);
  });

  test("toHaveResolvedWith", async () => {
    const fn = await mixed();
    expect(fn).toHaveResolvedWith(1);
    expect(fn).toHaveResolvedWith({ two: 2 });
    expect(fn).toHaveResolvedWith(expect.objectContaining({ two: expect.any(Number) }));
    expect(fn).not.toHaveResolvedWith("no");
    expect(fn).not.toHaveResolvedWith(undefined);
    expect(mock()).not.toHaveResolvedWith(undefined);
  });

  test("toHaveLastResolvedWith", async () => {
    const fn = mock(async (value: unknown) => value);
    await fn(1);
    await fn({ two: 2 });
    expect(fn).toHaveLastResolvedWith({ two: 2 });
    expect(fn).not.toHaveLastResolvedWith(1);
    expect(await rejecting()).not.toHaveLastResolvedWith("no");
    expect(pending()).not.toHaveLastResolvedWith(undefined);
    expect(mock()).not.toHaveLastResolvedWith(undefined);
  });

  test("toHaveNthResolvedWith", async () => {
    const fn = await mixed();
    expect(fn).toHaveNthResolvedWith(1, 1);
    expect(fn).not.toHaveNthResolvedWith(1, 2);
    expect(fn).not.toHaveNthResolvedWith(2, "no");
    expect(fn).toHaveNthResolvedWith(3, { two: 2 });
    expect(fn).not.toHaveNthResolvedWith(4, undefined);
    expect(fn).not.toHaveNthResolvedWith(5, undefined);
  });

  test("toHaveResolved and toHaveResolvedTimes messages", async () => {
    const fn = await mixed();
    expect(messageOf(() => expect(fn).not.toHaveResolved())).toMatchInlineSnapshot(`
      "expect(received).not.toHaveResolved()

      Expected number of resolved calls: < 1
      Received number of resolved calls:   2
      Received number of calls:            4
      "
    `);
    expect(messageOf(() => expect(pending()).toHaveResolved())).toMatchInlineSnapshot(`
      "expect(received).toHaveResolved()

      Expected number of resolved calls: >= 1
      Received number of resolved calls:    0
      Received number of calls:             1
      "
    `);
    expect(messageOf(() => expect(fn).toHaveResolvedTimes(3))).toMatchInlineSnapshot(`
      "expect(received).toHaveResolvedTimes(expected)

      Expected number of resolved calls: == 3
      Received number of resolved calls:    2
      Received number of calls:             4
      "
    `);
    expect(messageOf(() => expect(fn).not.toHaveResolvedTimes(2))).toMatchInlineSnapshot(`
      "expect(received).not.toHaveResolvedTimes(expected)

      Expected number of resolved calls: != 2
      Received number of resolved calls:    2
      Received number of calls:             4
      "
    `);
  });

  test("toHaveResolvedWith messages", async () => {
    const fn = await mixed();
    expect(messageOf(() => expect(fn).toHaveResolvedWith(9))).toMatchInlineSnapshot(`
      "expect(received).toHaveResolvedWith(expected)

          Expected: 9
          Received:
                    1: 1
                    2: function call rejected with: "no"
                    3: {
        two: 2,
      }
                    4: <pending call>

          Number of resolved calls: 2
          Number of calls:          4
      "
    `);
    expect(messageOf(() => expect(fn).not.toHaveResolvedWith(1))).toMatchInlineSnapshot(`
      "expect(received).not.toHaveResolvedWith(expected)

      Expected mock function not to have resolved with: 1
      "
    `);
    expect(messageOf(() => expect(mock()).toHaveResolvedWith(1))).toMatchInlineSnapshot(`
      "expect(received).toHaveResolvedWith(expected)

      Expected: 1
      But it was not called."
    `);
    const once = mock(async () => 1);
    await once();
    expect(messageOf(() => expect(once).toHaveResolvedWith(2))).toMatchInlineSnapshot(`
      "expect(received).toHaveResolvedWith(expected)

      Expected: 2
      Received: 1"
    `);
  });

  test("toHaveLastResolvedWith messages", async () => {
    const fn = mock(async (value: unknown) => value);
    await fn(1);
    expect(messageOf(() => expect(fn).toHaveLastResolvedWith(2))).toMatchInlineSnapshot(`
      "expect(received).toHaveLastResolvedWith(expected)

      The last call:
      Expected: 2
      Received: 1"
    `);
    expect(messageOf(() => expect(fn).not.toHaveLastResolvedWith(1))).toMatchInlineSnapshot(`
      "expect(received).not.toHaveLastResolvedWith(expected)

      The last call was expected not to resolve with: 1
      But it did.
      "
    `);
    expect(messageOf(() => expect(mock()).toHaveLastResolvedWith(1))).toMatchInlineSnapshot(`
      "expect(received).toHaveLastResolvedWith(expected)

      The mock function was not called."
    `);
    const rejected = await rejecting();
    expect(messageOf(() => expect(rejected).toHaveLastResolvedWith(1))).toMatchInlineSnapshot(`
      "expect(received).toHaveLastResolvedWith(expected)

      The last call rejected with: "no"
      "
    `);
    expect(messageOf(() => expect(pending()).toHaveLastResolvedWith(1))).toMatchInlineSnapshot(`
      "expect(received).toHaveLastResolvedWith(expected)

      The last call has not settled.
      "
    `);
  });

  test("toHaveNthResolvedWith messages", async () => {
    const fn = await mixed();
    expect(messageOf(() => expect(fn).toHaveNthResolvedWith(1, 2))).toMatchInlineSnapshot(`
      "expect(received).toHaveNthResolvedWith(n, expected)

      Call 1:
      Expected: 2
      Received: 1"
    `);
    expect(messageOf(() => expect(fn).not.toHaveNthResolvedWith(1, 1))).toMatchInlineSnapshot(`
      "expect(received).not.toHaveNthResolvedWith(n, expected)

      Call 1 was expected not to resolve with: 1
      But it did.
      "
    `);
    expect(messageOf(() => expect(fn).toHaveNthResolvedWith(2, 1))).toMatchInlineSnapshot(`
      "expect(received).toHaveNthResolvedWith(n, expected)

      Call 2 rejected with: "no"
      "
    `);
    expect(messageOf(() => expect(fn).toHaveNthResolvedWith(4, 1))).toMatchInlineSnapshot(`
      "expect(received).toHaveNthResolvedWith(n, expected)

      Call 4 has not settled.
      "
    `);
    expect(messageOf(() => expect(fn).toHaveNthResolvedWith(5, 1))).toMatchInlineSnapshot(`
      "expect(received).toHaveNthResolvedWith(n, expected)

      The mock function was called 4 times, but call 5 was requested.
      "
    `);
  });

  test("invalid arguments", async () => {
    const fn = await mixed();
    expect(messageOf(() => (expect(fn) as any).toHaveResolved(1))).toBe("toHaveResolved() must not have an argument");
    for (const times of [undefined, -1, 1.5, "1"]) {
      expect(messageOf(() => expect(fn).toHaveResolvedTimes(times as number))).toBe(
        "toHaveResolvedTimes() requires 1 non-negative integer argument",
      );
    }
    for (const n of [undefined, 1.5, "1"]) {
      expect(messageOf(() => expect(fn).toHaveNthResolvedWith(n as number, 1))).toBe(
        "toHaveNthResolvedWith() first argument must be an integer",
      );
    }
    for (const n of [0, -1]) {
      expect(messageOf(() => expect(fn).toHaveNthResolvedWith(n, 1))).toBe(
        "toHaveNthResolvedWith() n must be greater than 0",
      );
    }
  });

  test.each([
    "toHaveResolved",
    "toHaveResolvedTimes",
    "toHaveResolvedWith",
    "toHaveLastResolvedWith",
    "toHaveNthResolvedWith",
  ] as const)("%s needs a mock function", matcher => {
    expect(messageOf(() => (expect(() => {}) as any)[matcher](1, 1))).toBe(
      "Expected value must be a mock function: [Function]",
    );
  });
});

afterAll(() => {
  // Nothing after this file may depend on what it put on the shared state object.
  for (const key of ["vitestApisFirst", "vitestApisSecond", "vitestApisDirect", "7"]) delete expect.getState?.()[key];
});
