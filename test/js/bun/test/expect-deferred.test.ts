import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const prelude = `
  import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from "bun:test";
  const later = (value, ms = 1) => new Promise(resolve => setTimeout(resolve, ms, value));
  const laterReject = (value, ms = 1) => new Promise((_, reject) => setTimeout(reject, ms, value));
  const never = () => new Promise(() => {});
`;

async function run(cmd: string[], files: Record<string, string>, written: string[] = []) {
  using dir = tempDir("expect-deferred", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // A matcher that blocks on a promise which never settles cannot be interrupted from inside.
    timeout: 60_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results = stderr
    .split("\n")
    .filter(line => /^\((pass|fail|skip|todo)\)/.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  // Where each reported error points, in order, among the results.
  const report = stderr
    .split("\n")
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""))
    .filter(line => /^\((pass|fail|skip|todo)\)|^error: |^# Unhandled error|^\s+\^ this test timed out/.test(line));
  return {
    stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test v")),
    stderr,
    results,
    report,
    exitCode,
    signalCode: proc.signalCode,
    written: await Promise.all(written.map(name => Bun.file(`${dir}/${name}`).text())),
  };
}

const runTests = (source: string, written?: string[]) => run(["test"], { "a.test.js": prelude + source }, written);

/** The line of `a.test.js` that the first frame of each stack trace is on. */
function failingLines(stderr: string, source: string) {
  const lines = (prelude + source).split("\n");
  return [...stderr.matchAll(/^error: .*\n(?:(?!\s+at ).*\n)*?\s+at .*a\.test\.js:(\d+):\d+\)?$/gm)].map(match =>
    lines[Number(match[1]) - 1].trim(),
  );
}

describe.concurrent(".resolves and .rejects", () => {
  test("return a promise, which fulfills with undefined once the matcher has passed", async () => {
    const { stdout, exitCode } = await runTests(`
      test("promises", async () => {
        for (const [name, matcher] of [
          ["settled resolves", expect(Promise.resolve(1)).resolves.toBe(1)],
          ["settled rejects", expect(Promise.reject(1)).rejects.toBe(1)],
          ["pending resolves", expect(later(1)).resolves.toBe(1)],
          ["pending rejects", expect(laterReject(1)).rejects.toBe(1)],
          ["not", expect(later(1)).resolves.not.toBe(2)],
          ["not first", expect(later(1)).not.resolves.toBe(2)],
          ["returns this", expect(later({ a: 1 })).resolves.toContainKey("a")],
          ["toSatisfy", expect(later(5)).resolves.toSatisfy(value => value === 5)],
          ["toIncludeRepeated", expect(laterReject("aba")).rejects.toIncludeRepeated("a", 2)],
        ]) {
          console.log(name, matcher instanceof Promise, await matcher);
        }
        console.log("thenable", "then" in expect(later(1)).resolves);
      });
    `);
    expect(stdout).toEqual([
      "settled resolves true undefined",
      "settled rejects true undefined",
      "pending resolves true undefined",
      "pending rejects true undefined",
      "not true undefined",
      "not first true undefined",
      "returns this true undefined",
      "toSatisfy true undefined",
      "toIncludeRepeated true undefined",
      "thenable false",
    ]);
    expect(exitCode).toBe(0);
  });

  test("run nothing else before the matcher call returns", async () => {
    const { stdout, exitCode, signalCode } = await runTests(`
      test("the promise is settled by what follows the call", async () => {
        const { promise, resolve } = Promise.withResolvers();
        const matcher = expect(promise).resolves.toBe(25);
        resolve(25);
        await matcher;
      });
      test("timers and microtasks", async () => {
        const ran = [];
        setTimeout(() => ran.push("timeout"), 0);
        setImmediate(() => ran.push("immediate"));
        queueMicrotask(() => ran.push("microtask"));
        const matcher = expect(later(1, 20)).resolves.toBe(1);
        console.log("during the call: " + ran);
        await matcher;
        console.log("afterwards: " + ran.sort());
      });
      test("fake timers", async () => {
        jest.useFakeTimers();
        const matcher = expect(later("fake", 60_000)).resolves.toBe("fake");
        jest.advanceTimersByTime(60_000);
        await matcher;
        jest.useRealTimers();
      });
    `);
    expect(stdout).toEqual(["during the call: ", "afterwards: immediate,microtask,timeout"]);
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  test("a failure rejects the promise with an error that points at the matcher call", async () => {
    const source = `
      async function helper() {
        await expect(later(1)).resolves.toBe("in a helper");
      }
      test("value", async () => {
        await expect(later(1)).resolves.toBe(2);
      });
      test("direction", async () => {
        await expect(laterReject(new Error("boom"))).resolves.toBe("direction");
      });
      test("helper", async () => {
        await helper();
      });
      test("caught", async () => {
        const error = await expect(later(1), "my label").resolves.toBe(2).catch(error => error);
        console.log(error instanceof Error, Bun.stripANSI(error.message).split("\\n")[0]);
        await expect(expect(later(1)).rejects.toBe(1)).rejects.toThrow("Expected promise that rejects\\nReceived promise that resolved: Promise { <resolved> }");
      });
      test("arguments are checked when the matcher runs", async () => {
        const matcher = expect(later(1)).resolves.toBeCloseTo("x");
        await expect(matcher).rejects.toThrow("Expected expected to be a number for 'toBeCloseTo'.");
      });
    `;
    const { stdout, stderr, results, exitCode } = await runTests(source);
    expect(stdout).toEqual(["true my label"]);
    expect(failingLines(stderr, source)).toEqual([
      "await expect(later(1)).resolves.toBe(2);",
      'await expect(laterReject(new Error("boom"))).resolves.toBe("direction");',
      'await expect(later(1)).resolves.toBe("in a helper");',
    ]);
    expect(stderr).toContain("at helper (");
    expect(results).toEqual([
      "(fail) value",
      "(fail) direction",
      "(fail) helper",
      "(pass) caught",
      "(pass) arguments are checked when the matcher runs",
    ]);
    expect(exitCode).toBe(1);
  });

  test("a promise that has settled is checked at once", async () => {
    const { stdout, exitCode } = await runTests(`
      test("throws", () => {
        for (const call of [
          () => expect(Promise.resolve(1)).resolves.toBe(1),
          () => expect(Promise.resolve(1)).resolves.toBe(2),
          () => expect(Promise.reject(1)).rejects.toBe(2),
          () => expect(Promise.reject(1)).resolves.toBe(1),
          () => expect(1).resolves.toBe(1),
        ]) {
          try {
            console.log("returned", call());
          } catch (error) {
            console.log("threw", Bun.stripANSI(error.message).replaceAll("\\n", " "));
          }
        }
      });
    `);
    expect(stdout).toEqual([
      "returned Promise { <resolved> }",
      "threw expect(received).toBe(expected)  Expected: 2 Received: 1 ",
      "threw expect(received).toBe(expected)  Expected: 2 Received: 1 ",
      "threw expect(received).resolves.toBe(expected)  Expected promise that resolves Received promise that rejected: Promise { <rejected> } ",
      "threw expect(received).resolves.toBe(expected)  Expected promise Received: 1 ",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a test waits for the matchers it did not await, and their failures are its own", async () => {
    const source = `
      test("passes", () => {
        expect(later(1)).resolves.toBe(1).then(() => console.log("passes: checked"));
      });
      test("fails", () => {
        expect(later(1)).resolves.toBe("not awaited");
      });
      test("next", () => {});
      test("async", async () => {
        expect(later(1, 5)).resolves.toBe("not awaited in an async test");
        await later(0);
      });
      test("done", done => {
        expect(later(1)).resolves.toBe("not awaited before done()");
        done();
      });
      test("several", () => {
        const promise = later(1);
        expect(promise).resolves.toBe("first of several");
        expect(promise).rejects.toBe("second of several");
      });
      test.failing("failing", () => {
        expect(later(1)).resolves.toBe(2);
      });
      test.failing("failing, but it passes", () => {
        expect(later(1)).resolves.toBe(1);
      });
      test("handled later", async () => {
        const { promise, resolve } = Promise.withResolvers();
        const matcher = expect(promise).resolves.toBe("handled later");
        resolve(1);
        await later();
        await matcher.catch(() => console.log("handled later: caught"));
      });
    `;
    const { stdout, stderr, report, exitCode } = await runTests(source);
    expect(stdout).toEqual(["passes: checked", "handled later: caught"]);
    expect(report).toEqual([
      "(pass) passes",
      "error: expect(received).toBe(expected)",
      "(fail) fails",
      "(pass) next",
      "error: expect(received).toBe(expected)",
      "(fail) async",
      "error: expect(received).toBe(expected)",
      "(fail) done",
      "error: expect(received).toBe(expected)",
      "error: expect(received).rejects.toBe(expected)",
      "(fail) several",
      "(pass) failing",
      "(fail) failing, but it passes",
      "error: expect(received).toBe(expected)",
      "(fail) handled later",
    ]);
    expect(failingLines(stderr, source)).toEqual([
      'expect(later(1)).resolves.toBe("not awaited");',
      'expect(later(1, 5)).resolves.toBe("not awaited in an async test");',
      'expect(later(1)).resolves.toBe("not awaited before done()");',
      'expect(promise).resolves.toBe("first of several");',
      'expect(promise).rejects.toBe("second of several");',
      'const matcher = expect(promise).resolves.toBe("handled later");',
    ]);
    expect(exitCode).toBe(1);
  });

  test("hooks wait for their matchers too, each before the next entry starts", async () => {
    const { stdout, report, exitCode } = await runTests(`
      const check = name => expect(later(1, 5)).resolves.toBe(1).then(() => console.log(name, "checked"));
      describe("passing", () => {
        beforeAll(() => void check("beforeAll"));
        afterEach(() => void check("afterEach"));
        afterAll(() => void check("afterAll"));
        test("test", () => {
          console.log("test");
          check("test");
        });
      });
      describe("failing", () => {
        afterEach(() => {
          expect(later(1)).resolves.toBe(2);
        });
        test("test", () => {});
      });
      test("last", () => console.log("last"));
    `);
    expect(stdout).toEqual([
      "beforeAll checked",
      "test",
      "test checked",
      "afterEach checked",
      "afterAll checked",
      "last",
    ]);
    expect(report).toEqual([
      "(pass) passing > test",
      "error: expect(received).toBe(expected)",
      "(fail) failing > test",
      "(pass) last",
    ]);
    expect(exitCode).toBe(1);
  });

  test("the timeout of the test ends the wait", async () => {
    const { stdout, report, exitCode, signalCode } = await runTests(`
      test("awaited", async () => {
        await expect(never()).resolves.toBe(1);
      }, 50);
      test("not awaited", () => {
        expect(never()).rejects.toBe(1);
      }, 50);
      const late = Promise.withResolvers();
      test("too late", async () => {
        await expect(late.promise).resolves.toBe(2);
        console.log("not reached");
      }, 50);
      test("next", async () => {
        late.resolve(1);
        await later();
      });
      const first = Promise.withResolvers();
      let attempt = 0;
      test("the matchers of an earlier attempt", async () => {
        expect.assertions(1);
        if (++attempt === 1) {
          expect(first.promise).resolves.toBe("settles during the second attempt");
          await never();
        }
        first.resolve(1);
        await expect(later(1)).resolves.toBe(1);
      }, { retry: 1, timeout: 500 });
    `);
    expect(stdout).toEqual([]);
    expect(report).toEqual([
      "(fail) awaited",
      "  ^ this test timed out after 50ms.",
      "(fail) not awaited",
      "  ^ this test timed out after 50ms.",
      "(fail) too late",
      "  ^ this test timed out after 50ms.",
      "(pass) next",
      "(pass) the matchers of an earlier attempt (attempt 2)",
    ]);
    expect({ exitCode, signalCode }).toEqual({ exitCode: 1, signalCode: null });
  });

  test("a test that has failed does not wait", async () => {
    const { report, exitCode } = await runTests(`
      test("throws", () => {
        expect(never()).resolves.toBe(1);
        throw new Error("thrown by the test");
      });
    `);
    expect(report).toEqual(["error: thrown by the test", "(fail) throws"]);
    expect(exitCode).toBe(1);
  });

  test("concurrent tests go on while one of them waits for a matcher", async () => {
    const source = `
      const log = [];
      const a = Promise.withResolvers(), b = Promise.withResolvers();
      describe("each settles the promise of the other", () => {
        test.concurrent("a", async () => {
          log.push("a starts");
          const matcher = expect(a.promise).resolves.toBe("a");
          b.resolve("b");
          await matcher;
          log.push("a ends");
        });
        test.concurrent("b", async () => {
          log.push("b starts");
          await expect(b.promise).resolves.toBe("b");
          a.resolve("a");
          log.push("b ends");
        });
      });
      test("order", () => console.log(log.join()));
      describe("failures", () => {
        test.concurrent("not awaited", () => {
          expect(later(1, 5)).resolves.toBe("not awaited");
        });
        test.concurrent("awaited", async () => {
          await later(0);
          await expect(later(1)).resolves.toBe("awaited");
        });
        test.concurrent("passes", async () => {
          await later(0);
          await expect(later(1)).resolves.toBe(1);
        });
      });
      describe("which test called the matcher is not known after its first await", () => {
        test.concurrent("c", async () => {
          await later(0);
          expect(later(1, 5)).resolves.toBe(1).then(() => console.log("checked before the next test"));
        });
        test.concurrent("d", () => {});
      });
      test("next", () => console.log("next"));
    `;
    const { stdout, stderr, results, exitCode, signalCode } = await runTests(source);
    expect(stdout).toEqual(["a starts,b starts,b ends,a ends", "checked before the next test", "next"]);
    expect(results.toSorted()).toEqual([
      "(fail) failures > awaited",
      "(fail) failures > not awaited",
      "(pass) each settles the promise of the other > a",
      "(pass) each settles the promise of the other > b",
      "(pass) failures > passes",
      "(pass) next",
      "(pass) order",
      "(pass) which test called the matcher is not known after its first await > c",
      "(pass) which test called the matcher is not known after its first await > d",
    ]);
    expect(stderr).not.toContain("Unhandled error");
    expect({ exitCode, signalCode }).toEqual({ exitCode: 1, signalCode: null });
  });

  test("the expect of a test context names its test, whichever tests run beside it", async () => {
    const { stdout, stderr, results, exitCode } = await run(["test"], {
      "a.test.js": `
        import { test } from "vitest";
        const later = (value, ms = 1) => new Promise(resolve => setTimeout(resolve, ms, value));
        test.concurrent("not awaited", async ({ expect }) => {
          await later();
          expect(later(1)).resolves.toBe(2);
        });
        test.concurrent("soft", async ({ expect }) => {
          await later();
          expect.soft(1).toBe(2);
          console.log("soft: goes on");
        });
        test.concurrent("poll", async ({ expect }) => {
          await later();
          expect.assertions(1);
          let calls = 0;
          expect.poll(() => ++calls, { interval: 1 }).toBe(3);
        });
        test.concurrent("poll fails", async ({ expect }) => {
          await later();
          expect.poll(() => 1, { interval: 1, timeout: 5 }).toBe(2);
        });
        test.concurrent("passes", () => later(0, 20));
      `,
    });
    expect(stdout).toEqual(["soft: goes on"]);
    expect(results.toSorted()).toEqual([
      "(fail) not awaited",
      "(fail) poll fails",
      "(fail) soft",
      "(pass) passes",
      "(pass) poll",
    ]);
    expect(stderr).not.toContain("Unhandled error");
    expect(exitCode).toBe(1);
  });

  test("count towards expect.assertions() once, when they run", async () => {
    const { results, exitCode } = await runTests(`
      expect.extend({
        async toBeLater(received, expected) {
          await later();
          return { pass: received === expected, message: () => "" };
        },
      });
      test("awaited", async () => {
        expect.assertions(3);
        await expect(later(1)).resolves.toBe(1);
        await expect(laterReject(1)).rejects.toBe(1);
        await expect(Promise.resolve(1)).resolves.toBe(1);
      });
      test("not awaited", () => {
        expect.assertions(2);
        const number = Promise.withResolvers(), object = Promise.withResolvers();
        expect(number.promise).resolves.toBeGreaterThan(0);
        expect(object.promise).resolves.toContainKey("a");
        number.resolve(1);
        object.resolve({ a: 1 });
      });
      test("hasAssertions", () => {
        expect.hasAssertions();
        expect(later(1)).resolves.toBe(1);
      });
      test("matchers that find a pending promise on their way", async () => {
        expect.assertions(5);
        await expect(async () => { await later(); throw new Error("thrown"); }).toThrow("thrown");
        await expect(1).toBeLater(1);
        await expect(later(1)).resolves.toBeLater(1);
        await expect([1, later(2)]).toEqual([expect.toBeLater(1), expect.resolvesTo.toBeLater(2)]);
        await expect(later("one")).toEqual(expect.resolvesTo.stringContaining("one"));
      });
      test("too few", async () => {
        expect.assertions(2);
        await expect(later(1)).resolves.toBe(1);
      });
    `);
    expect(results).toEqual([
      "(pass) awaited",
      "(pass) not awaited",
      "(pass) hasAssertions",
      "(pass) matchers that find a pending promise on their way",
      "(fail) too few",
    ]);
    expect(exitCode).toBe(1);
  });

  test("the flags of the call are those it was made with", async () => {
    const { results, exitCode } = await runTests(`
      test("one chain, several matchers", async () => {
        const { promise, resolve } = Promise.withResolvers();
        const chain = expect(promise).resolves;
        const first = chain.toBe(1);
        const second = chain.not.toBe(2);
        const third = chain.not.toBe(1);
        resolve(1);
        await Promise.all([first, second, third]);
      });
    `);
    expect(results).toEqual(["(pass) one chain, several matchers"]);
    expect(exitCode).toBe(0);
  });

  test("snapshot matchers find their test and their call", async () => {
    const source = `
      test("inline", async () => {
        await expect(later({ a: 1 })).resolves.toMatchInlineSnapshot();
          expect(later("not awaited")).resolves.toMatchInlineSnapshot();
        await expect(async () => { await later(); throw new Error("thrown later"); }).toThrowErrorMatchingInlineSnapshot();
      });
      test("file", async () => {
        const { promise, resolve } = Promise.withResolvers();
        const matcher = expect(promise).resolves.toMatchSnapshot();
        resolve("first");
        await matcher;
        expect("second").toMatchSnapshot();
      });
    `;
    const { results, exitCode, written } = await runTests(source, ["a.test.js", "__snapshots__/a.test.js.snap"]);
    expect(results).toEqual(["(pass) inline", "(pass) file"]);
    expect(written[0].slice(prelude.length)).toBe(`
      test("inline", async () => {
        await expect(later({ a: 1 })).resolves.toMatchInlineSnapshot(\`
          {
            "a": 1,
          }
        \`);
          expect(later("not awaited")).resolves.toMatchInlineSnapshot(\`"not awaited"\`);
        await expect(async () => { await later(); throw new Error("thrown later"); }).toThrowErrorMatchingInlineSnapshot(\`"thrown later"\`);
      });
      test("file", async () => {
        const { promise, resolve } = Promise.withResolvers();
        const matcher = expect(promise).resolves.toMatchSnapshot();
        resolve("first");
        await matcher;
        expect("second").toMatchSnapshot();
      });
    `);
    expect(written[1]).toContain('exports[`file 1`] = `"first"`;\n\nexports[`file 2`] = `"second"`;');
    expect(exitCode).toBe(0);
  });

  test("call a function and wait for what it returns", async () => {
    const { stdout, results, exitCode } = await runTests(`
      test("functions", async () => {
        const fn = jest.fn(async () => { throw "Oops"; });
        await expect(fn).rejects.toEqual("Oops");
        await expect(() => later(5)).resolves.toBe(5);
        await expect(() => Promise.resolve(6)).resolves.toBe(6);
        await expect(() => ({ then: resolve => resolve(7) })).resolves.toBe(7);
        expect(fn).toHaveBeenCalledTimes(1);
      });
      test("that return no promise, or throw", () => {
        expect(() => expect(() => 1).resolves.toBe(1)).toThrow("Expected promise\\nReceived: [Function]");
        expect(() => expect(() => { throw new Error("thrown by the function"); }).rejects.toThrow()).toThrow("thrown by the function");
      });
      test("a function with then() is a thenable", async () => {
        const fn = jest.fn();
        await expect(Object.assign(fn, { then: resolve => resolve("thenable") })).resolves.toBe("thenable");
        expect(fn).not.toHaveBeenCalled();
      });
    `);
    expect(stdout).toEqual([]);
    expect(results).toEqual([
      "(pass) functions",
      "(pass) that return no promise, or throw",
      "(pass) a function with then() is a thenable",
    ]);
    expect(exitCode).toBe(0);
  });

  test("work outside of bun test", async () => {
    const { stdout, stderr, exitCode } = await run(["a.js"], {
      "a.js":
        prelude.replace(/import .*/, 'import { expect } from "bun:test";') +
        `
      const ran = [];
      setImmediate(() => ran.push("immediate"));
      const matcher = expect(later(1, 5)).resolves.toBe(1);
      console.log("during the call: " + ran);
      console.log(await matcher);
      console.log(await expect(later(1)).resolves.toBe(2).catch(error => Bun.stripANSI(error.message).split("\\n")[0]));
      function notAwaited() {
        expect(later(1)).resolves.toBe(3);
      }
      notAwaited();
    `,
    });
    expect(stdout).toEqual(["during the call: ", "undefined", "expect(received).toBe(expected)"]);
    expect(stderr).toContain("Expected: 3\nReceived: 1");
    expect(stderr).toContain("at notAwaited (");
    expect(exitCode).toBe(1);
  });

  test("what is pending when its file ends is dropped", async () => {
    for (const args of [[], ["--isolate"]]) {
      const { stdout, report, stderr, exitCode } = await run(["test", ...args, "./a.test.js", "./b.test.js"], {
        "a.test.js":
          prelude +
          `
          test("times out", async () => {
            expect(later(1, 100)).resolves.toBe(2).finally(() => console.log("not reached"));
            await never();
          }, 20);
        `,
        "b.test.js": prelude + `test("goes on for a while", () => later(0, 200));`,
      });
      expect(stdout).toEqual([]);
      expect(report).toEqual(["(fail) times out", "  ^ this test timed out after 20ms.", "(pass) goes on for a while"]);
      expect(stderr).not.toContain("Unhandled error");
      expect(exitCode).toBe(1);
    }
  });

  test("survive garbage collection while they wait", async () => {
    const { stdout, exitCode } = await runTests(`
      test("gc", async () => {
        const matchers = [], settle = [];
        const pending = value => new Promise(resolve => settle.push(() => resolve(value)));
        for (let i = 0; i < 100; i++) {
          matchers.push(expect(pending({ i })).resolves.toEqual({ i }));
          matchers.push(expect([pending(i)]).toEqual([expect.resolvesTo.any(Number)]));
          matchers.push(expect(async () => { await pending(); throw new Error("e" + i); }).toThrow("e" + i));
          if (i % 20 === 0) Bun.gc(true);
        }
        Bun.gc(true);
        for (const [i, fn] of settle.entries()) {
          fn();
          if (i % 60 === 0) {
            await later();
            Bun.gc(true);
          }
        }
        console.log((await Promise.all(matchers)).length);
      });
    `);
    expect(stdout).toEqual(["300"]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("matchers that meet a pending promise", () => {
  test("toThrow() calls the function once and returns a promise", async () => {
    const source = `
      test("passes", async () => {
        const fn = jest.fn(async () => { await later(); throw new TypeError("thrown later"); });
        const matcher = expect(fn).toThrow(TypeError);
        console.log(matcher instanceof Promise, await matcher, fn.mock.calls.length);
        await expect(async () => { await later(); }).not.toThrow();
        console.log(expect(() => { throw new Error("now"); }).toThrow("now"));
      });
      test("fails", async () => {
        await expect(async () => { await later(); }).toThrow();
      });
      test("fails, not awaited", () => {
        expect(async () => { await later(); throw new Error("thrown later"); }).not.toThrow();
      });
      test("times out", async () => {
        await expect(never).toThrow();
      }, 50);
    `;
    const { stdout, stderr, report, exitCode, signalCode } = await runTests(source);
    expect(stdout).toEqual(["true undefined 1", "undefined"]);
    expect(report).toEqual([
      "(pass) passes",
      "error: expect(received).toThrow()",
      "(fail) fails",
      "error: expect(received).not.toThrow()",
      "(fail) fails, not awaited",
      "(fail) times out",
      "  ^ this test timed out after 50ms.",
    ]);
    expect(failingLines(stderr, source)).toEqual([
      "await expect(async () => { await later(); }).toThrow();",
      'expect(async () => { await later(); throw new Error("thrown later"); }).not.toThrow();',
    ]);
    expect({ exitCode, signalCode }).toEqual({ exitCode: 1, signalCode: null });
  });

  test("a custom matcher may return one", async () => {
    const source = `
      const toBeLater = jest.fn(async function (received, expected) {
        await later();
        return { pass: received === expected, message: () => \`\${this.promise}|\${this.isNot}|\${received}|\${expected}\` };
      });
      expect.extend({
        toBeLater,
        async toRejectLater() {
          await later();
          throw new Error("rejected later");
        },
        toThrowNow(received) {
          throw new Error("thrown on " + received);
        },
      });
      test("passes", async () => {
        const matcher = expect(1).toBeLater(1);
        console.log(matcher instanceof Promise, await matcher, toBeLater.mock.calls.length);
        await expect(1).not.toBeLater(2);
        await expect(later(3)).resolves.toBeLater(3);
        await expect(laterReject(4)).rejects.not.toBeLater(5);
        console.log(toBeLater.mock.calls.length);
        const fn = jest.fn(() => Promise.resolve(6));
        await expect(fn).resolves.toBeLater(6);
        expect(fn).toHaveBeenCalledTimes(1);
      });
      test("inside another value, each use is called once", async () => {
        toBeLater.mockClear();
        await expect([1, 1, { a: 3 }]).toEqual([expect.toBeLater(1), expect.not.toBeLater(2), { a: expect.toBeLater(3) }]);
        console.log(toBeLater.mock.calls.join(" "));
        await expect([1]).not.toEqual([expect.toBeLater(2)]);
      });
      test("fails", async () => {
        await expect(later(1)).resolves.not.toBeLater(1);
      });
      test("fails, not awaited", () => {
        expect(1).toBeLater(2);
      });
      test("rejects", async () => {
        await expect(expect(1).toRejectLater()).rejects.toThrow("Matcher \`toRejectLater\` returned a promise that rejected");
      });
      test("throws", async () => {
        await expect(later(1)).resolves.toThrowNow();
      });
    `;
    const { stdout, stderr, results, exitCode } = await runTests(source);
    expect(stdout).toEqual(["true undefined 1", "4", "1,1 1,2 3,3"]);
    expect(results).toEqual([
      "(pass) passes",
      "(pass) inside another value, each use is called once",
      "(fail) fails",
      "(fail) fails, not awaited",
      "(pass) rejects",
      "(fail) throws",
    ]);
    expect(stderr).toContain("resolves|true|1|1");
    expect(stderr).toContain("|false|1|2");
    expect(stderr).toMatch(/error: thrown on 1\n\s+at toThrowNow \(.*\n\s+at <anonymous> \(.*a\.test\.js:\d+:\d+\)/);
    expect(failingLines(stderr, source)).toEqual([
      "await expect(later(1)).resolves.not.toBeLater(1);",
      "expect(1).toBeLater(2);",
      'throw new Error("rejected later");',
      'throw new Error("thrown on " + received);',
    ]);
    expect(exitCode).toBe(1);
  });

  test("expect.resolvesTo and expect.rejectsTo", async () => {
    const source = `
      test("passes", async () => {
        const matcher = expect(later("one")).toEqual(expect.resolvesTo.stringContaining("on"));
        console.log(matcher instanceof Promise, await matcher);
        console.log(expect(Promise.resolve("one")).toEqual(expect.resolvesTo.stringContaining("on")));
        await expect({ a: later("one"), b: [laterReject("two", 5)] }).toEqual({
          a: expect.resolvesTo.stringContaining("on"),
          b: [expect.rejectsTo.stringContaining("tw")],
        });
        await expect({ a: later("one") }).not.toEqual({ a: expect.resolvesTo.stringContaining("two") });
        await expect({ a: later("one") }).toEqual({ a: expect.not.resolvesTo.stringContaining("two") });
        await expect({ a: later("one") }).not.toEqual({ a: expect.rejectsTo.anything() });
        await expect({ a: later("one"), b: 1 }).toMatchObject({ a: expect.resolvesTo.any(String) });
        const fn = jest.fn();
        fn(later(1));
        await expect(fn).toHaveBeenCalledWith(expect.resolvesTo.any(Number));
      });
      test("calls then() once", async () => {
        const then = jest.fn(resolve => void setTimeout(resolve, 1, "thenable"));
        await expect([{ then }, later(1, 5)]).toEqual([expect.resolvesTo.stringContaining("thenable"), expect.resolvesTo.any(Number)]);
        expect(then).toHaveBeenCalledTimes(1);
      });
      test("not awaited", () => {
        expect(later("one")).toEqual(expect.resolvesTo.stringContaining("one"));
      });
      test("fails", async () => {
        await expect({ a: later("one") }).toEqual({ a: expect.resolvesTo.stringContaining("two") });
      });
      test("fails, not awaited", () => {
        expect(later("one")).toEqual(expect.rejectsTo.anything());
      });
      test("times out", async () => {
        await expect(never()).toEqual(expect.resolvesTo.anything());
      }, 50);
    `;
    const { stdout, stderr, results, exitCode, signalCode } = await runTests(source);
    expect(stdout).toEqual(["true undefined", "undefined"]);
    expect(results).toEqual([
      "(pass) passes",
      "(pass) calls then() once",
      "(pass) not awaited",
      "(fail) fails",
      "(fail) fails, not awaited",
      "(fail) times out",
    ]);
    expect(failingLines(stderr, source)).toEqual([
      'await expect({ a: later("one") }).toEqual({ a: expect.resolvesTo.stringContaining("two") });',
      'expect(later("one")).toEqual(expect.rejectsTo.anything());',
    ]);
    expect({ exitCode, signalCode }).toEqual({ exitCode: 1, signalCode: null });
  });
});

describe.concurrent("expect.soft()", () => {
  test("a failure fails the test, which goes on", async () => {
    const source = `
      expect.extend({
        toBeFoo(received) {
          return { pass: received === "foo", message: () => \`expected \${received} to be foo\` };
        },
      });
      test("several", () => {
        console.log(expect.soft(1).toBe("first"));
        expect.soft(1, "my label").toBe("second");
        expect.soft(1).not.toBe(1);
        expect.soft("bar").toBeFoo();
        expect.soft(1).toThrow();
        expect.soft({ a: 1 }).toMatchInlineSnapshot(\`"other"\`);
        console.log("several: end");
      });
      test("passes", () => {
        console.log(expect.soft(1).toBe(1));
        expect.soft("foo").toBeFoo();
      });
      test("then one that is not soft", () => {
        expect.soft(1).toBe("soft");
        expect(1).toBe("not soft");
        console.log("not reached");
      });
      const { soft } = expect;
      test("on its own", () => {
        soft(1).toBe("on its own");
        console.log("on its own: end");
      });
    `;
    const { stdout, stderr, report, exitCode } = await runTests(source);
    expect(stdout).toEqual(["undefined", "several: end", "undefined", "on its own: end"]);
    expect(report).toEqual([
      "error: expect(received).toBe(expected)",
      "error: my label",
      "error: expect(received).not.toBe(expected)",
      "error: expect(received).toBeFoo()",
      "error: Expected value must be a function",
      "error: expect(received).toMatchInlineSnapshot(expected)",
      "(fail) several",
      "(pass) passes",
      "error: expect(received).toBe(expected)",
      "error: expect(received).toBe(expected)",
      "(fail) then one that is not soft",
      "error: expect(received).toBe(expected)",
      "(fail) on its own",
    ]);
    expect(failingLines(stderr, source)).toEqual([
      'console.log(expect.soft(1).toBe("first"));',
      'expect.soft(1, "my label").toBe("second");',
      "expect.soft(1).not.toBe(1);",
      'expect.soft("bar").toBeFoo();',
      "expect.soft(1).toThrow();",
      'expect.soft({ a: 1 }).toMatchInlineSnapshot(`"other"`);',
      'expect.soft(1).toBe("soft");',
      'expect(1).toBe("not soft");',
      'soft(1).toBe("on its own");',
    ]);
    expect(exitCode).toBe(1);
  });

  test("with .resolves and .rejects, the promise of the matcher fulfills", async () => {
    const source = `
      test("awaited", async () => {
        console.log(await expect.soft(later(1)).resolves.toBe("pending"));
        console.log(await expect.soft(Promise.resolve(1)).resolves.toBe("settled"));
        console.log(await expect.soft(laterReject(1)).resolves.toBe("direction"));
        console.log(await expect.soft(async () => { await later(); }).toThrow());
      });
      test("not awaited", () => {
        expect.soft(later(1)).resolves.toBe("first");
        expect.soft(later(1, 5)).resolves.toBe("second");
      });
    `;
    const { stdout, stderr, results, exitCode } = await runTests(source);
    expect(stdout).toEqual(["undefined", "undefined", "undefined", "undefined"]);
    expect(failingLines(stderr, source)).toEqual([
      'console.log(await expect.soft(later(1)).resolves.toBe("pending"));',
      'console.log(await expect.soft(Promise.resolve(1)).resolves.toBe("settled"));',
      'console.log(await expect.soft(laterReject(1)).resolves.toBe("direction"));',
      "console.log(await expect.soft(async () => { await later(); }).toThrow());",
      'expect.soft(later(1)).resolves.toBe("first");',
      'expect.soft(later(1, 5)).resolves.toBe("second");',
    ]);
    expect(results).toEqual(["(fail) awaited", "(fail) not awaited"]);
    expect(exitCode).toBe(1);
  });

  test("counts like any other failure", async () => {
    const { stdout, results, stderr, exitCode, written } = await run(
      ["test", "--reporter=junit", "--reporter-outfile=junit.xml"],
      {
        "a.test.js":
          prelude +
          `
          test.failing("failing", () => {
            expect.soft(1).toBe(2);
          });
          test("assertions", () => {
            expect.assertions(2);
            expect.soft(1).toBe("assertions");
            expect.soft(1).toBe(1);
          });
          let attempts = 0;
          test("retry", () => {
            expect.soft(++attempts).toBe(2);
          }, { retry: 1 });
          describe("hooks", () => {
            beforeEach(() => {
              expect.soft(1).toBe("beforeEach");
            });
            afterEach(() => {
              expect.soft(1).toBe("afterEach");
            });
            test("test", () => console.log("the test runs"));
          });
          describe("beforeAll", () => {
            beforeAll(() => {
              expect.soft(1).toBe("beforeAll");
              console.log("beforeAll goes on");
            });
            test("skipped", () => console.log("not reached"));
          });
          describe("concurrent", () => {
            test.concurrent("before the first await", async () => {
              expect.soft(1).toBe("before the first await");
              console.log("concurrent: goes on");
              await later();
            });
            test.concurrent("after it, the failure is thrown", async () => {
              await later();
              expect.soft(1).toBe("after the first await");
              console.log("not reached");
            });
          });
        `.replace("afterEach,", "afterEach, beforeEach,"),
      },
      ["junit.xml"],
    );
    expect(stdout).toEqual(["the test runs", "beforeAll goes on", "concurrent: goes on"]);
    expect(results).toEqual([
      "(pass) failing",
      "(fail) assertions",
      "(pass) retry (attempt 2)",
      "(fail) hooks > test",
      "(fail) beforeAll > (unnamed)",
      "(fail) concurrent > before the first await",
      "(fail) concurrent > after it, the failure is thrown",
    ]);
    expect(stderr).not.toContain("Unhandled error");
    const hooks = written[0].slice(written[0].indexOf('<testcase name="test"'));
    expect(hooks.slice(0, hooks.indexOf("</testcase>")).match(/Expected: &quot;\w+&quot;/g)).toEqual([
      "Expected: &quot;beforeEach&quot;",
      "Expected: &quot;beforeEach&quot;",
      "Expected: &quot;afterEach&quot;",
    ]);
    expect(exitCode).toBe(1);
  });

  test("outside of a test, the failure is thrown", async () => {
    const { stdout, exitCode } = await run(["a.js"], {
      "a.js": `
        import { expect } from "bun:test";
        expect.soft(1).toBe(1);
        try {
          expect.soft(1).toBe(2);
        } catch (error) {
          console.log(Bun.stripANSI(error.message).split("\\n")[0]);
        }
      `,
    });
    expect(stdout).toEqual(["expect(received).toBe(expected)"]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("expect.poll()", () => {
  test("calls the function and the matcher until the matcher passes", async () => {
    const { stdout, results, exitCode } = await runTests(`
      const options = { interval: 1 };
      test("passes", async () => {
        let calls = 0;
        const matcher = expect.poll(() => ++calls, options).toBe(3);
        console.log(matcher instanceof Promise, await matcher, calls);
        console.log(await expect.poll(() => 1).toBe(1));
      });
      test("awaits what the function returns", async () => {
        let calls = 0;
        await expect.poll(async () => { await later(); return ++calls; }, options).toBe(2);
        await expect.poll(() => ({ then: resolve => resolve(++calls) }), options).toBe(4);
        console.log(calls);
      });
      test("a function that throws or rejects is called again", async () => {
        let calls = 0;
        await expect.poll(() => { if (++calls < 3) throw new Error("not yet"); return calls; }, options).toBe(3);
        await expect.poll(async () => { if (++calls < 6) throw new Error("not yet"); return calls; }, options).toBe(6);
      });
      test("not, custom and asymmetric matchers", async () => {
        expect.extend({
          toBeFoo: received => ({ pass: received === "foo", message: () => "" }),
          toBeLater: async (received, expected) => (await later(), { pass: received === expected, message: () => "" }),
        });
        let calls = 0;
        await expect.poll(() => ++calls, options).not.toBe(1);
        await expect.poll(() => (++calls > 3 ? "foo" : "bar"), options).toBeFoo();
        await expect.poll(() => ++calls, options).toBeLater(6);
        await expect.poll(() => ({ calls: ++calls }), options).toEqual({ calls: expect.toBeLater(8) });
        await expect.poll(() => [later(++calls)], options).toEqual([expect.resolvesTo.toBeLater(10)]);
        console.log(calls);
      });
      test("counts as one assertion", async () => {
        expect.assertions(2);
        let calls = 0;
        await expect.poll(() => ++calls, options).toBe(3);
        await expect.poll(() => { if (++calls < 6) throw new Error("not yet"); return calls; }, options).toBeGreaterThan(5);
      });
      const { poll } = expect;
      test("on its own", async () => {
        let calls = 0;
        await poll(() => ++calls, options).toBe(2);
      });
    `);
    expect(stdout).toEqual(["true undefined 3", "undefined", "4", "10"]);
    expect(results).toEqual([
      "(pass) passes",
      "(pass) awaits what the function returns",
      "(pass) a function that throws or rejects is called again",
      "(pass) not, custom and asymmetric matchers",
      "(pass) counts as one assertion",
      "(pass) on its own",
    ]);
    expect(exitCode).toBe(0);
  });

  test("rejects with the last failure once the time is up", async () => {
    const source = `
      const show = error => [error.constructor.name, Bun.stripANSI(error.message).replaceAll("\\n", " ").trim(), "<-", error.cause?.message].join(" ");
      test("caught", async () => {
        let calls = 0;
        console.log(show(await expect.poll(() => ++calls, { timeout: 60, interval: 10 }).toBe(-1).catch(error => error)).replace(String(calls), "<calls>"), calls > 1);
        console.log(show(await expect.poll(() => 1, { timeout: 5, interval: 1, message: "my message" }).toBe(2).catch(error => error)));
        console.log(show(await expect.poll(() => { throw new TypeError("thrown " + ++calls); }, { timeout: 5, interval: 1 }).toBe(2).catch(error => error)).replace(String(calls), "<calls>"));
        console.log(show(await expect.poll(async () => { throw new RangeError("rejected"); }, { timeout: 5, interval: 1 }).toBe(2).catch(error => error)));
        console.log(show(await expect.poll(() => { throw new Error("has a cause", { cause: new Error("its own") }); }, { timeout: 5, interval: 1 }).toBe(2).catch(error => error)));
        console.log(show(await expect.poll(never, { timeout: 5, interval: 1 }).toBe(2).catch(error => error)));
      });
      test("fails", async () => {
        await expect.poll(() => 1, { timeout: 5, interval: 1 }).toBe("awaited");
      });
      test("fails, not awaited", () => {
        expect.poll(() => 1, { timeout: 5, interval: 1 }).toBe("not awaited");
      });
      function thrower() {
        throw new Error("thrown by the function");
      }
      test("the function throws", async () => {
        await expect.poll(thrower, { timeout: 5, interval: 1 }).toBe(1);
      });
      test("passes, not awaited", () => {
        let calls = 0;
        expect.poll(() => ++calls, { interval: 1 }).toBe(3).then(() => console.log("checked"));
      });
    `;
    const { stdout, stderr, results, exitCode } = await runTests(source);
    expect(stdout).toEqual([
      "Error expect(received).toBe(expected)  Expected: -1 Received: <calls> <- Matcher did not succeed in time. true",
      "Error my message  Expected: 2 Received: 1 <- Matcher did not succeed in time.",
      "TypeError thrown <calls> <- Matcher did not succeed in time.",
      "RangeError rejected <- Matcher did not succeed in time.",
      "Error has a cause <- its own",
      "Error Matcher did not succeed in time. <- ",
      "checked",
    ]);
    // Each failure, then its cause.
    expect(failingLines(stderr, source)).toEqual([
      'await expect.poll(() => 1, { timeout: 5, interval: 1 }).toBe("awaited");',
      'await expect.poll(() => 1, { timeout: 5, interval: 1 }).toBe("awaited");',
      'expect.poll(() => 1, { timeout: 5, interval: 1 }).toBe("not awaited");',
      'expect.poll(() => 1, { timeout: 5, interval: 1 }).toBe("not awaited");',
      'throw new Error("thrown by the function");',
      "await expect.poll(thrower, { timeout: 5, interval: 1 }).toBe(1);",
    ]);
    expect(stderr).toMatch(/at thrower \(.*\n\s+at <anonymous> \(.*a\.test\.js/);
    expect(results).toEqual([
      "(pass) caught",
      "(fail) fails",
      "(fail) fails, not awaited",
      "(fail) the function throws",
      "(pass) passes, not awaited",
    ]);
    expect(exitCode).toBe(1);
  });

  test("ends with its test", async () => {
    const { stdout, report, exitCode, signalCode } = await runTests(`
      let calls = 0;
      test("times out", async () => {
        await expect.poll(() => ++calls, { timeout: 60_000, interval: 1 }).toBe(-1);
      }, 50);
      test("next", async () => {
        const before = calls;
        await later(0, 20);
        console.log(calls > 1, calls - before);
      });
    `);
    expect(stdout).toEqual(["true 0"]);
    expect(report).toEqual(["(fail) times out", "  ^ this test timed out after 50ms.", "(pass) next"]);
    expect({ exitCode, signalCode }).toEqual({ exitCode: 1, signalCode: null });
  });

  test("keeps real time under fake timers, and advances them by the interval", async () => {
    const { stdout, exitCode, signalCode } = await runTests(`
      test("fake timers", async () => {
        jest.useFakeTimers();
        const start = Date.now();
        let fired = 0;
        setInterval(() => fired++, 50);
        await expect.poll(() => fired, { interval: 50 }).toBe(3);
        console.log(fired, Date.now() - start);
        jest.useRealTimers();
      });
    `);
    expect(stdout).toEqual(["3 150"]);
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  test("refuses what cannot be polled", async () => {
    const { stdout, exitCode } = await runTests(`
      test("refusals", () => {
        const fn = jest.fn();
        for (const call of [
          () => expect.poll(fn).toThrow(),
          () => expect.poll(fn).not.toThrowError(),
          () => expect.poll(fn).toMatchSnapshot(),
          () => expect.poll(fn).toMatchInlineSnapshot(),
          () => expect.poll(fn).toThrowErrorMatchingSnapshot(),
          () => expect.poll(fn).toThrowErrorMatchingInlineSnapshot(),
          () => expect.poll(fn).resolves,
          () => expect.poll(fn).rejects,
          () => expect.poll(1),
          () => expect.poll(),
          () => expect.poll(fn, 1),
        ]) {
          try {
            console.log("returned", call());
          } catch (error) {
            console.log(error.message);
          }
        }
        console.log(fn.mock.calls.length);
      });
    `);
    const use = "Use vi.waitFor() for a condition that takes time to hold";
    expect(stdout).toEqual([
      `expect.poll() does not support .toThrow(). ${use}`,
      `expect.poll() does not support .toThrowError(). ${use}`,
      `expect.poll() does not support .toMatchSnapshot(). ${use}`,
      `expect.poll() does not support .toMatchInlineSnapshot(). ${use}`,
      `expect.poll() does not support .toThrowErrorMatchingSnapshot(). ${use}`,
      `expect.poll() does not support .toThrowErrorMatchingInlineSnapshot(). ${use}`,
      "expect.poll() does not support .resolves",
      "expect.poll() does not support .rejects",
      'The "fn" argument must be of type function. Received type number (1)',
      'The "fn" argument must be of type function. Received undefined',
      'The "options" argument must be of type object. Received type number (1)',
      "0",
    ]);
    expect(exitCode).toBe(0);
  });
});
