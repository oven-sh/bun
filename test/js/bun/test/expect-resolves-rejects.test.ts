import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";

// Every test spawns a `bun test` child (some of which sleep for seconds by design) and
// they all run concurrently, so the default 5s per-test timeout is too tight on CI.
setDefaultTimeout(60_000);

async function runTestFile(files: Record<string, string>, env: NodeJS.Dict<string> = bunEnv) {
  using dir = tempDir("expect-resolves-rejects", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fixture.test.ts"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Snapshot-friendly stderr must be normalized against the fixture dir HERE: attributed
  // stack frames print its absolute (random) path, and the dir is gone once we return.
  return { stdout, stderr, exitCode, normalizedStderr: normalizeBunSnapshot(stderr, String(dir)) };
}

// The "N expect() calls" summary line counts matcher invocations, which is covered by the
// expect.assertions fixtures below; keep it out of output snapshots.
function stripExpectCallCount(output: string): string {
  return output.replace(/^\s*\d+ expect\(\) calls\n/m, "");
}

// Every test spawns its own `bun test` subprocess in its own temp dir, so they are
// independent and run concurrently.
describe.concurrent("deferred matcher promises", () => {
  // The subject promise is marked handled by the matcher, so an un-awaited
  // `.rejects` whose subject rejects must not surface as an unhandled rejection.
  test("un-awaited .rejects on an already-rejected subject does not report an unhandled rejection", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `
      import { test, expect } from "bun:test";
      test("un-awaited rejects", () => {
        expect(Promise.reject(new Error("SUBJECT_REJECTION_MARKER"))).rejects.toThrow("SUBJECT_REJECTION_MARKER");
      });
    `,
    });
    const output = stdout + stderr;
    // Any unhandled-rejection report would echo the rejection message.
    expect(output).not.toContain("Unhandled");
    expect(output).not.toContain("SUBJECT_REJECTION_MARKER");
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("un-awaited .resolves on a rejecting subject fails the test without an unhandled-rejection report", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `
      import { test, expect } from "bun:test";
      test("un-awaited resolves, rejecting subject", () => {
        expect(Promise.reject(new Error("SUBJECT_REJECTION_MARKER"))).resolves.toBe(1);
      });
    `,
    });
    const output = stdout + stderr;
    // The rejection is consumed by the matcher: it fails the test, it is not re-reported
    // by the unhandled-rejection machinery.
    expect(output).not.toContain("Unhandled");
    expect(output).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("un-awaited .rejects on a subject that rejects later does not report an unhandled rejection", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `
      import { test, expect } from "bun:test";
      test("un-awaited rejects, pending subject", async () => {
        const subject = (async () => {
          await Bun.sleep(1);
          throw new Error("SUBJECT_REJECTION_MARKER");
        })();
        expect(subject).rejects.toThrow("SUBJECT_REJECTION_MARKER");
        await Bun.sleep(10);
      });
    `,
    });
    const output = stdout + stderr;
    expect(output).not.toContain("Unhandled");
    expect(output).not.toContain("SUBJECT_REJECTION_MARKER");
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  // Awaited `.resolves`/`.rejects` matchers report the same message and location as always.
  test("awaited .resolves/.rejects pass and fail with the expected message and location", async () => {
    const { normalizedStderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("resolves pass", async () => {
  await expect(Promise.resolve(1)).resolves.toBe(1);
});
test("resolves fail", async () => {
  await expect(Promise.resolve(1)).resolves.toBe(2);
});
test("rejects pass", async () => {
  await expect(Promise.reject(new Error("boom"))).rejects.toThrow("boom");
});
test("rejects fail", async () => {
  await expect(Promise.reject(new Error("boom"))).rejects.toThrow("other");
});
test("resolves direction mismatch", async () => {
  await expect(Promise.reject(new Error("nope"))).resolves.toBe(1);
});
test("rejects direction mismatch", async () => {
  await expect(Promise.resolve(1)).rejects.toBe(1);
});
`,
    });
    expect(stripExpectCallCount(normalizedStderr)).toMatchInlineSnapshot(`
    "fixture.test.ts:
    (pass) resolves pass
    1 | import { test, expect } from "bun:test";
    2 | test("resolves pass", async () => {
    3 |   await expect(Promise.resolve(1)).resolves.toBe(1);
    4 | });
    5 | test("resolves fail", async () => {
    6 |   await expect(Promise.resolve(1)).resolves.toBe(2);
                                                    ^
    error: expect(received).toBe(expected)

    Expected: 2
    Received: 1

          at <dir>/fixture.test.ts:6:45
          at <dir>/fixture.test.ts:5:23
    (fail) resolves fail
    (pass) rejects pass
     7 | });
     8 | test("rejects pass", async () => {
     9 |   await expect(Promise.reject(new Error("boom"))).rejects.toThrow("boom");
    10 | });
    11 | test("rejects fail", async () => {
    12 |   await expect(Promise.reject(new Error("boom"))).rejects.toThrow("other");
                                                                   ^
    error: expect(received).toThrow(expected)

    Expected substring: "other"
    Received message: "boom"

          at <dir>/fixture.test.ts:12:59
          at <dir>/fixture.test.ts:11:22
    (fail) rejects fail
    10 | });
    11 | test("rejects fail", async () => {
    12 |   await expect(Promise.reject(new Error("boom"))).rejects.toThrow("other");
    13 | });
    14 | test("resolves direction mismatch", async () => {
    15 |   await expect(Promise.reject(new Error("nope"))).resolves.toBe(1);
                                                                    ^
    error: expect(received).resolves.toBe(expected)

    Expected promise that resolves
    Received promise that rejected: Promise { <rejected> }

          at <dir>/fixture.test.ts:15:60
          at <dir>/fixture.test.ts:14:37
    (fail) resolves direction mismatch
    13 | });
    14 | test("resolves direction mismatch", async () => {
    15 |   await expect(Promise.reject(new Error("nope"))).resolves.toBe(1);
    16 | });
    17 | test("rejects direction mismatch", async () => {
    18 |   await expect(Promise.resolve(1)).rejects.toBe(1);
                                                    ^
    error: expect(received).rejects.toBe(expected)

    Expected promise that rejects
    Received promise that resolved: Promise { <resolved> }

          at <dir>/fixture.test.ts:18:44
          at <dir>/fixture.test.ts:17:36
    (fail) rejects direction mismatch

     2 pass
     4 fail
    Ran 6 tests across 1 file."
  `);
    expect(exitCode).toBe(1);
  });

  // An un-awaited failing `.resolves` fails its test, attributed to the `expect()` line,
  // and is not reported a second time as an unhandled rejection.
  test("un-awaited failing .resolves fails the test and is attributed to the expect line", async () => {
    const { stdout, stderr, normalizedStderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("un-awaited failing resolves", () => {
  expect(Promise.resolve(1)).resolves.toBe(2);
});
test("sibling test", () => {
  expect(1).toBe(1);
});
`,
    });
    // The whole report is pinned: the failure is attributed to the `expect()` call (the
    // code frame excerpts fixture line 3), the sibling test still passes, and the failure
    // is reported exactly once.
    expect(stripExpectCallCount(normalizedStderr)).toMatchInlineSnapshot(`
      "fixture.test.ts:
      1 | import { test, expect } from "bun:test";
      2 | test("un-awaited failing resolves", () => {
      3 |   expect(Promise.resolve(1)).resolves.toBe(2);
                                                ^
      error: expect(received).toBe(expected)

      Expected: 2
      Received: 1

            at <dir>/fixture.test.ts:3:39
      (fail) un-awaited failing resolves
      (pass) sibling test

       1 pass
       1 fail
      Ran 2 tests across 1 file."
    `);
    expect(stdout + stderr).not.toContain("Unhandled");
    expect(exitCode).toBe(1);
  });

  // A failing deferred matcher created in a beforeEach fails the test even when the test
  // itself is `test.failing`: hook failures are never inverted by the failing mode.
  test("an un-awaited failing matcher in a beforeEach fails a test.failing test", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect, beforeEach } from "bun:test";
beforeEach(() => {
  expect(Promise.resolve(1)).resolves.toBe(2);
});
test.failing("failing test with hook matcher failure", () => {
  throw new Error("expected failure");
});
`,
    });
    const output = stdout + stderr;
    expect(output).toContain("expect(received).toBe(expected)");
    // Exactly one report, attributed by the runner (not the generic unhandled path).
    expect(output.split("expect(received).toBe(expected)").length - 1).toBe(1);
    expect(output).not.toContain("Unhandled");
    expect(output).toContain("1 fail");
    expect(output).not.toContain("1 pass");
    expect(exitCode).toBe(1);
  });

  // Whether an un-awaited matcher failure is reported belongs to the user's handling of the
  // returned promise `D`, decided when the test completes — not to how quickly they adopt it.
  // (a) Adopting `D` after a macrotask and swallowing the rejection is a pass, printed 0 times.
  test("a failing matcher promise adopted late and caught passes and prints nothing", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("delayed adoption, caught", async () => {
  const d = expect(Promise.resolve(1)).resolves.toBe(4141);
  await Bun.sleep(5);
  try {
    await d;
  } catch {}
});
`,
    });
    const output = stdout + stderr;
    // The user observed and swallowed the failure: it is reported zero times.
    expect(output.split("4141").length - 1).toBe(0);
    expect(output).not.toContain("expect(received).toBe(expected)");
    expect(output).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // (b) The same adoption without a catch fails the test and prints the failure exactly once
  // (no second print through the unhandled-rejection or uncaught-exception paths).
  test("a failing matcher promise adopted late without a catch fails and prints exactly once", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("delayed adoption, uncaught", async () => {
  const d = expect(Promise.resolve(1)).resolves.toBe(4242);
  await Bun.sleep(5);
  await d;
});
`,
    });
    const output = stdout + stderr;
    expect(stderr).toContain("(fail) delayed adoption, uncaught");
    expect(output.split("Expected: 4242").length - 1).toBe(1);
    expect(output).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // (c) `.finally()` attaches a reaction without handling the rejection: a failing matcher
  // with only a floating `.finally()` must not leave the test reported as passing.
  test("a failing matcher with only a floating .finally() does not report the test as passing", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("floating finally", () => {
  const d = expect(Bun.sleep(5).then(() => 1)).resolves.toBe(4343);
  d.finally(() => {});
});
`,
    });
    const output = stdout + stderr;
    expect(stderr).not.toContain("(pass) floating finally");
    expect(stderr).not.toContain(" 1 pass");
    expect(stderr).toContain(" 1 fail");
    expect(output).toContain("Expected: 4343");
    // Reported exactly once, as the test's failure — never doubled by the generic
    // unhandled-rejection path (the provisional machinery claims the leaked rejection).
    expect(output).not.toContain("Unhandled");
    expect(output.split("Expected: 4343").length - 1).toBe(1);
    expect(exitCode).toBe(1);
  });

  // (c) again, but with a subject settled from an `el.tasks` task (fs I/O) rather than a
  // timer: the leaked-notification for the floating `.finally()` is only delivered after
  // the task queue drains, so `finish_sequence` must flush it before committing.
  test("a failing matcher with only a floating .finally() and an fs-resolved subject does not report the test as passing", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
test("floating finally, fs subject", () => {
  const d = expect(readFile(import.meta.path, "utf8").then(() => 1)).resolves.toBe(4343);
  d.finally(() => {});
});
`,
    });
    const output = stdout + stderr;
    expect(stderr).not.toContain("(pass) floating finally, fs subject");
    expect(stderr).not.toContain(" 1 pass");
    expect(stderr).toContain(" 1 fail");
    expect(output).not.toContain("Unhandled");
    expect(output).toContain("Expected: 4343");
    expect(exitCode).toBe(1);
  });

  // (d) An async arrow that implicitly returns the matcher promise: the runner adopts the
  // returned promise, so the failure is the test's failure, reported exactly once.
  test("an implicitly returned failing .rejects matcher fails the test exactly once", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("implicit return", async () => expect(Promise.reject(new Error("boom"))).rejects.toThrow("other"));
`,
    });
    const output = stdout + stderr;
    expect(stderr).toContain("(fail) implicit return");
    expect(output.split('Expected substring: "other"').length - 1).toBe(1);
    expect(output).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // (e) An un-awaited PASSING matcher reports nothing at all.
  test("an un-awaited passing matcher reports nothing", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("un-awaited passing matcher", async () => {
  const d = expect(Promise.resolve(2)).resolves.toBe(2);
  await Bun.sleep(5);
});
`,
    });
    const output = stdout + stderr;
    expect(output).not.toContain("expect(received)");
    expect(output).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // A matcher promise still pending when the synchronous body returns is settled before the
  // test completes: the body is not blocked, and the next test starts only after settlement.
  test("a matcher promise pending when the sync body returns settles before the test completes", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
const order: string[] = [];
test("pending at body return", () => {
  const subject = Bun.sleep(5).then(() => {
    order.push("subject-settled");
    return 1;
  });
  expect(subject).resolves.toBe(1);
  order.push("body-returned");
});
test("next test", () => {
  order.push("next-test");
  console.log("ORDER:" + order.join(","));
});
`,
    });
    expect(stdout).toContain("ORDER:body-returned,subject-settled,next-test");
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test("a matcher that fails after the sync body returned still fails the test", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("late failing matcher", () => {
  expect(Bun.sleep(5).then(() => 1)).resolves.toBe(2);
});
`,
    });
    expect(stderr).toContain("(fail) late failing matcher");
    expect(stdout + stderr).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // The common synchronous-callback shape: several un-awaited matchers, none of which block
  // the body while their subjects settle.
  test("un-awaited matchers inside a synchronous test callback pass without blocking the body", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("sync body with un-awaited matchers", () => {
  const order: string[] = [];
  const subject = Bun.sleep(2).then(() => {
    order.push("settled");
    return "later";
  });
  expect(Promise.resolve("value")).resolves.toBe("value");
  expect(Promise.reject(new Error("boom"))).rejects.toThrow("boom");
  expect(subject).resolves.toBe("later");
  order.push("body-returned");
  console.log("E_ORDER:" + order.join(","));
});
`,
    });
    expect(stdout).toContain("E_ORDER:body-returned\n");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // A test that returns a promise and also has un-awaited matchers completes only after both
  // the returned promise and every matcher promise settled.
  test("a test returning a promise with un-awaited matchers waits for both", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
const order: string[] = [];
test("returned promise and un-awaited matcher", () => {
  const subject = Bun.sleep(4).then(() => {
    order.push("subject-settled");
    return 7;
  });
  expect(subject).resolves.toBe(7);
  order.push("body");
  return Promise.resolve().then(() => {
    order.push("returned-promise");
  });
});
test("verify order", () => {
  console.log("F_ORDER:" + order.join(","));
});
`,
    });
    expect(stdout).toContain("F_ORDER:body,returned-promise,subject-settled");
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test("a test returning a promise still fails when an un-awaited matcher fails", async () => {
    const { stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("returned promise with failing matcher", () => {
  expect(Bun.sleep(2).then(() => 1)).resolves.toBe(999);
  return Bun.sleep(1);
});
`,
    });
    expect(stderr).toContain("(fail) returned promise with failing matcher");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // Un-awaited `toThrow`/`.not.toThrow` on async functions.
  test("un-awaited async toThrow and .not.toThrow report the settled outcome", async () => {
    const { stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("toThrow on rejecting fn", () => {
  expect(async () => {
    throw new Error("async-boom");
  }).toThrow("async-boom");
});
test("not.toThrow on resolving fn", () => {
  expect(async () => {}).not.toThrow();
});
test("toThrow on resolving fn", () => {
  expect(async () => {}).toThrow("async-boom");
});
test("not.toThrow on rejecting fn", () => {
  expect(async () => {
    throw new Error("async-boom");
  }).not.toThrow();
});
`,
    });
    expect(stderr).not.toContain("(fail) toThrow on rejecting fn");
    expect(stderr).not.toContain("(fail) not.toThrow on resolving fn");
    expect(stderr).toContain("(fail) toThrow on resolving fn");
    expect(stderr).toContain("(fail) not.toThrow on rejecting fn");
    expect(stderr).toContain("expect(received).toThrow(expected)");
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 2 fail");
    expect(exitCode).toBe(1);
  });

  // `.resolves`/`.rejects` on a non-promise subject keeps throwing synchronously.
  test("expect(nonPromise).resolves/.rejects throws synchronously", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("non-promise subject", () => {
  let resolvesThrew = false;
  let resolvesMessage = "";
  try {
    expect(42).resolves.toBe(42);
  } catch (error) {
    resolvesThrew = true;
    resolvesMessage = String((error as Error).message);
  }
  console.log("H_RESOLVES:" + resolvesThrew + ":" + resolvesMessage.includes("promise"));
  let rejectsThrew = false;
  let rejectsMessage = "";
  try {
    expect(42).rejects.toThrow("x");
  } catch (error) {
    rejectsThrew = true;
    rejectsMessage = String((error as Error).message);
  }
  console.log("H_REJECTS:" + rejectsThrew + ":" + rejectsMessage.includes("promise"));
  expect(resolvesThrew).toBe(true);
  expect(rejectsThrew).toBe(true);
});
`,
    });
    expect(stdout).toContain("H_RESOLVES:true:true");
    expect(stdout).toContain("H_REJECTS:true:true");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // `.resolves`/`.rejects`/async `toThrow` matchers return a real Promise; synchronous
  // matchers keep returning undefined.
  test(".resolves/.rejects and async toThrow matchers return a Promise", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("matcher return values", async () => {
  const resolves = expect(Promise.resolve(1)).resolves.toBe(1);
  const rejects = expect(Promise.reject(new Error("boom"))).rejects.toThrow("boom");
  const asyncThrow = expect(async () => {
    throw new Error("boom");
  }).toThrow("boom");
  console.log("I_RESOLVES:" + (resolves instanceof Promise));
  console.log("I_REJECTS:" + (rejects instanceof Promise));
  console.log("I_ASYNC_THROW:" + (asyncThrow instanceof Promise));
  console.log("I_SYNC:" + (expect(1).toBe(1) === undefined));
  await Promise.all([resolves, rejects, asyncThrow]);
});
`,
    });
    expect(stdout).toContain("I_RESOLVES:true");
    expect(stdout).toContain("I_REJECTS:true");
    expect(stdout).toContain("I_ASYNC_THROW:true");
    expect(stdout).toContain("I_SYNC:true");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // On a pass, the promise a deferred matcher returns resolves with `undefined` — never the
  // matcher result or the chainable `Expect` — for built-in matchers, async `toThrow`, and
  // async `expect.extend` matchers (both directly and reached through `.resolves`).
  test("a passing deferred matcher's promise resolves to undefined", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
expect.extend({
  async _toEqualAsync(received, expected) {
    await Bun.sleep(1);
    return { pass: received === expected, message: () => "_toEqualAsync(" + expected + ")" };
  },
});
test("deferred matcher promises resolve to undefined", async () => {
  await expect(expect(Promise.resolve(1)).resolves.toBe(1)).resolves.toBeUndefined();
  await expect(expect(Promise.reject(new Error("boom"))).rejects.toThrow("boom")).resolves.toBeUndefined();
  await expect(expect(Bun.sleep(1).then(() => 3)).resolves.toBe(3)).resolves.toBeUndefined();
  await expect(
    expect(async () => {
      throw new Error("boom");
    }).toThrow("boom"),
  ).resolves.toBeUndefined();
  await expect(expect(7)._toEqualAsync(7)).resolves.toBeUndefined();
  await expect(expect(Bun.sleep(1).then(() => 7)).resolves._toEqualAsync(7)).resolves.toBeUndefined();
});
`,
    });
    expect(stdout + stderr).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // Per-test matcher/assertion counters reset across test.each entries, retries, and repeats.
  test("expect.assertions with un-awaited matchers across test.each, retry, and repeats", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
let attempt = 0;
test(
  "retry until subject matches",
  () => {
    attempt++;
    console.log("ATTEMPT:" + attempt);
    expect.assertions(1);
    expect(Bun.sleep(1).then(() => attempt)).resolves.toBe(3);
  },
  { retry: 2 },
);
test.each([1, 2, 3])("each %i", (value: number) => {
  expect.assertions(1);
  expect(Promise.resolve(value)).resolves.toBe(value);
});
let run = 0;
test(
  "repeats with un-awaited matcher",
  () => {
    run++;
    console.log("REPEAT:" + run);
    expect.assertions(1);
    expect(Bun.sleep(1).then(() => "ok")).resolves.toBe("ok");
  },
  { repeats: 2 },
);
`,
    });
    // retry: the first two attempts fail (the subject settles to 1, then 2) and the third passes.
    expect(stdout).toContain("ATTEMPT:1");
    expect(stdout).toContain("ATTEMPT:2");
    expect(stdout).toContain("ATTEMPT:3");
    expect(stdout).toContain("REPEAT:3");
    expect(stderr).not.toContain("(fail)");
    // `expect.assertions(1)` holds on every attempt/entry/repeat: the matcher counter is
    // reset per run and the deferred re-invocation is not double-counted.
    expect(stderr).not.toContain("AssertionError");
    expect(stderr).toContain(" 5 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // A matcher called from inside an event-loop poll callback (a `Bun.serve` fetch handler,
  // oven-sh/bun#33261) must not re-enter the event loop synchronously.
  // `nestedDispatchTicks` requires a debug build and only the POSIX loop increments it.
  test.skipIf(!isDebug || isWindows)(
    "a matcher inside an event-loop poll callback does not re-enter the event loop",
    async () => {
      const { stdout, stderr, exitCode } = await runTestFile({
        "fixture.test.ts": `import { test, expect } from "bun:test";
import { getEventLoopStats } from "bun:internal-for-testing";
// The counter only counts re-entrant ticks started while an outer ready-poll dispatch is
// mid-batch, so both probes run inside a Bun.serve fetch handler (always dispatched from
// the server socket's poll batch). HTMLRewriter's string transform still waits
// synchronously on its async handlers, so it is the positive control proving the counter
// detects exactly what the matcher below must avoid.
async function deltaInFetchHandler(probe) {
  using server = Bun.serve({
    port: 0,
    async fetch() {
      const before = getEventLoopStats().nestedDispatchTicks;
      const pending = probe();
      const after = getEventLoopStats().nestedDispatchTicks;
      await pending;
      return new Response(JSON.stringify({ delta: after - before }));
    },
  });
  const { delta } = await (await fetch(server.url)).json();
  return delta;
}
test("nested dispatch is counted for a synchronous waiter inside a poll callback", async () => {
  const delta = await deltaInFetchHandler(() => {
    new HTMLRewriter()
      .on("p", {
        async element() {
          await Bun.sleep(1);
        },
      })
      .transform("<p>x</p>");
  });
  console.log("K_CONTROL_DELTA:" + delta);
  expect(delta).toBeGreaterThan(0);
});
test("matcher inside poll callback", async () => {
  const delta = await deltaInFetchHandler(() => expect(Bun.sleep(1).then(() => "settled")).resolves.toBe("settled"));
  console.log("K_NESTED_DELTA:" + delta);
  expect(delta).toBe(0);
});
`,
      });
      // The synchronous waiter may tick more than once before its promise settles, so the
      // control only asserts a nonzero count.
      expect(stdout).toMatch(/K_CONTROL_DELTA:[1-9]/);
      expect(stdout).toContain("K_NESTED_DELTA:0");
      expect(stderr).toContain(" 2 pass");
      expect(stderr).toContain(" 0 fail");
      expect(exitCode).toBe(0);
    },
  );

  // https://github.com/oven-sh/bun/issues/14950 — the subject can only settle after the
  // matcher call returns, so a matcher that synchronously waits on it can never finish.
  // Jest passes this; Bun used to spin at 100% CPU until the test timeout.
  test("a subject resolved after the matcher call settles instead of deadlocking", async () => {
    const { stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("promise resolves after expect call", () => {
  let resolve;
  expect(new Promise(r => (resolve = r))).resolves.toBe(25);
  resolve(25);
});
`,
    });
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // The pending-matcher gate sits between the test entry and the afterEach entries: an
  // un-awaited deferred matcher observes the state the test left behind, not the state
  // afterEach mutates it to (Jest and released Bun both order it this way).
  test("un-awaited deferred matchers settle before afterEach runs", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect, afterEach } from "bun:test";
let ok = true;
afterEach(() => {
  console.log("AFTER_EACH:" + ok);
  ok = false;
});
test("deferred matcher sees pre-afterEach state", () => {
  expect(Bun.sleep(20).then(() => ok)).resolves.toBe(true);
});
test("afterEach ran after the matcher settled", () => {
  expect(ok).toBe(false);
});
`,
    });
    // The first afterEach runs only after the deferred matcher observed `ok === true`.
    expect(stdout).toContain("AFTER_EACH:true");
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // A failing deferred matcher whose subject settles while the sequence is parked at the
  // test/afterEach boundary (no active entry): the deferred's rejection must be claimed by
  // the provisional-matcher machinery, not double-reported through the generic
  // unhandled-rejection path as "Unhandled error between tests".
  test("a failing deferred matcher with an afterEach fails once and still runs afterEach", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect, afterEach } from "bun:test";
afterEach(() => {
  console.log("AFTER_EACH_RAN");
});
test("t", () => {
  expect(Bun.sleep(10).then(() => 1)).resolves.toBe(4949);
});
`,
    });
    const output = stdout + stderr;
    expect(stdout).toContain("AFTER_EACH_RAN");
    expect(output.split("Expected: 4949").length - 1).toBe(1);
    expect(output).not.toContain("Unhandled");
    expect(stderr).not.toContain("(pass)");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // When the per-test timeout abandons pending deferred matchers while the sequence is
  // parked before its afterEach entries, the afterEach hooks must still run.
  test("afterEach still runs when the timeout abandons a pending deferred matcher", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect, afterEach } from "bun:test";
afterEach(() => {
  console.log("AFTER_EACH_RAN");
});
test("t", () => {
  expect(new Promise(() => {})).resolves.toBe(1);
}, 500);
`,
    });
    expect(stdout).toContain("AFTER_EACH_RAN");
    expect(stderr).toContain("timed out after 500ms");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // A deferred matcher abandoned by the per-test timeout belongs to that attempt only
  // (`ExecutionSequence::settle_matcher_promise`'s epoch check): when its subject settles
  // during the retry attempt, it must neither release the retry's pending-matcher count
  // (completing it while its own matcher is still pending) nor write the stale failure
  // into the retry's result.
  test("a deferred matcher abandoned by the timeout does not affect the retry attempt", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
let attempt = 0;
test(
  "stale settle",
  () => {
    attempt++;
    console.log("ATTEMPT:" + attempt);
    if (attempt === 1) {
      // Never settles within the timeout: attempt 1 is abandoned at ~3s and retried.
      // The subject settles at ~4.5s — during attempt 2, whose own matcher is still
      // pending — and its re-invoked matcher fails (424242); that stale failure must
      // not be attributed to attempt 2. Attempt 2's own work (0.5s) is far below the
      // 3s timeout so a slow runner cannot time it out too.
      expect(Bun.sleep(4500).then(() => 1)).resolves.toBe(424242);
    } else {
      expect(Bun.sleep(500).then(() => 2)).resolves.toBe(2);
    }
  },
  { timeout: 3000, retry: 1 },
);
`,
    });
    expect(stdout).toContain("ATTEMPT:1");
    expect(stdout).toContain("ATTEMPT:2");
    // Attempt 1's stale matcher failure must not leak into attempt 2's report.
    expect(stderr).not.toContain("424242");
    expect(stderr).not.toContain("(fail)");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // The deferred re-invocation of an inline-snapshot matcher runs from a promise-reaction
  // job with no user JS frames on the stack, so the snapshot's file/line/column come from
  // the call site captured when the matcher deferred (not from a stack walk of that frame).
  // CI=false: creating a new inline snapshot is what exercises the call-site resolution,
  // and creation is otherwise disabled in CI.
  test(".resolves/.rejects inline snapshot matchers resolve the expect() call site", async () => {
    const { stdout, stderr, exitCode } = await runTestFile(
      {
        "fixture.test.ts": `import { test, expect } from "bun:test";
test("resolves inline snapshot", async () => {
  await expect(Promise.resolve({ a: 1 })).resolves.toMatchInlineSnapshot();
});
test("rejects inline error snapshot", async () => {
  await expect(Promise.reject(new Error("DEFERRED_SNAPSHOT_ERROR"))).rejects.toThrowErrorMatchingInlineSnapshot();
});
`,
      },
      { ...bunEnv, CI: "false" },
    );
    const output = stdout + stderr;
    expect(output).not.toContain("must be called from the test file");
    expect(output).toContain("+2 added");
    expect(output).toContain(" 2 pass");
    expect(output).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // Deferred (un-awaited) snapshot matchers that settle after the test callback returned
  // must still resolve their owning test's snapshot state (name counter, .snap file).
  test("un-awaited snapshot matchers that settle late still resolve the owning test", async () => {
    using dir = tempDir("late-settling-snapshot", {
      "late.test.js": `
        import { test, expect } from "bun:test";
        test("throw", () => {
          expect(async () => {
            await Bun.sleep(10);
            throw new Error("late-throw");
          }).toThrowErrorMatchingSnapshot();
        });
        test("resolve", () => {
          expect(Bun.sleep(10).then(() => "late-resolve")).resolves.toMatchSnapshot();
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "late.test.js"],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    const snapshot = await Bun.file(`${dir}/__snapshots__/late.test.js.snap`)
      .text()
      .catch(() => "<missing snapshot file>");
    expect({ stderr, snapshot }).toEqual({
      stderr: expect.stringContaining("2 pass"),
      snapshot: expect.stringContaining('exports[`throw 1`] = `"late-throw"`'),
    });
    expect(snapshot).toContain('exports[`resolve 1`] = `"late-resolve"`');
    expect(exitCode).toBe(0);
  });

  // DELIBERATE BEHAVIOR CHANGE (Jest parity): snapshot indices are assigned in SETTLE order,
  // not source order. A deferred `.resolves.toMatchSnapshot()` written before a synchronous
  // one gets the later index because it settles later; existing .snap files may need `-u`.
  test("snapshot indices are assigned in settle order, not source order", async () => {
    using dir = tempDir("snapshot-settle-order", {
      "order.test.js": `
        import { test, expect } from "bun:test";
        test("order", async () => {
          const deferred = expect(Promise.resolve("ASYNC")).resolves.toMatchSnapshot();
          expect("SYNC").toMatchSnapshot();
          await deferred;
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "order.test.js"],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    const snapshot = await Bun.file(`${dir}/__snapshots__/order.test.js.snap`)
      .text()
      .catch(() => "<missing snapshot file>");
    // The synchronous matcher settles first, so it owns index 1; the deferred one gets 2.
    expect({ stderr, snapshot }).toEqual({
      stderr: expect.stringContaining("1 pass"),
      snapshot: expect.stringContaining('exports[`order 1`] = `"SYNC"`;'),
    });
    expect(snapshot).toContain('exports[`order 2`] = `"ASYNC"`;');
    expect(exitCode).toBe(0);
  });

  // A CHAINED deferral: the settle re-invocation of `.resolves.toThrow(fn)` defers a second
  // time on the promise the resolved function returned. The promise the user holds is the
  // one the FIRST pass returned, so an un-awaited failure of the second deferral must still
  // fail the test, attributed to the `expect()` line, exactly once, with no
  // unhandled-rejection report.
  test("un-awaited chained .resolves.toThrow on a fn returning a promise fails the test once", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("chained deferral", () => {
  expect(Promise.resolve(async () => { throw new Error("CHAIN_INNER"); })).resolves.toThrow("nope");
});
test("sibling test", () => {
  expect(1).toBe(1);
});
`,
    });
    expect(stderr).toContain("(fail) chained deferral");
    expect(stderr).not.toContain("(fail) sibling test");
    // Attributed to the `expect()` call site, reported exactly once.
    expect(stderr).toMatch(/fixture\.test\.ts:3:\d+/);
    expect(stderr.split('Expected substring: "nope"').length - 1).toBe(1);
    expect(stdout + stderr).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // The awaited form of the same chain settles the promise the matcher returned on the
  // FIRST pass: it must resolve on a pass and reject (into the user's handler) on a failure.
  test("awaited chained .resolves.toThrow resolves on pass and rejects on failure", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("chained pass and fail", async () => {
  await expect(Promise.resolve(async () => { throw new Error("CHAIN_INNER"); })).resolves.toThrow("CHAIN_INNER");
  let caught = "";
  try {
    await expect(Promise.resolve(async () => { throw new Error("CHAIN_INNER"); })).resolves.toThrow("nope");
  } catch (error) {
    caught = String((error as Error).message);
  }
  console.log("J_CHAIN_CAUGHT:" + caught.includes('Expected substring: "nope"'));
});
`,
    });
    expect(stdout).toContain("J_CHAIN_CAUGHT:true");
    expect(stdout + stderr).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // Same chained shape through an async `expect.extend` matcher reached via `.resolves`:
  // the subject deferral resolves into a matcher-result deferral. Un-awaited, its failure
  // must fail the test with the expect-line attribution and no unhandled-rejection report.
  test("un-awaited failing async expect.extend matcher via .resolves fails the test", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
expect.extend({
  async _alwaysFailAsync() {
    await Bun.sleep(1);
    // Built at runtime so the marker only ever appears in the failure report.
    return { pass: false, message: () => "ASYNC_EXTEND" + "_FAIL_MARKER" };
  },
});
test("un-awaited async custom matcher", () => {
  expect(Promise.resolve(1)).resolves._alwaysFailAsync();
});
test("sibling test", () => {
  expect(1).toBe(1);
});
`,
    });
    expect(stderr).toContain("(fail) un-awaited async custom matcher");
    expect(stderr).not.toContain("(fail) sibling test");
    // Attributed to the `expect()` call site, reported exactly once.
    expect(stderr).toMatch(/fixture\.test\.ts:10:\d+/);
    expect(stderr.split("ASYNC_EXTEND_FAIL_MARKER").length - 1).toBe(1);
    expect(stdout + stderr).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // An argument-validation error thrown by a matcher whose `.resolves` subject is still
  // pending must not leave a deferral registered: the settle reaction would re-invoke the
  // matcher, hit the same argument error, and record a second failure against a test that
  // already handled the first one (as well as hold the test open until the subject settles).
  test("a matcher argument error on a pending .resolves subject is thrown once, synchronously", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("argument error", async () => {
  const { promise, resolve } = Promise.withResolvers();
  expect(() => expect(promise).resolves.toBeArrayOfSize("3")).toThrow(
    "toBeArrayOfSize() requires the first argument to be a number",
  );
  resolve([1, 2, 3]);
  await promise;
  // A macrotask so the settle reaction of any (incorrectly) registered deferral runs.
  await Bun.sleep(5);
});
`,
    });
    const output = stdout + stderr;
    expect(output).toContain(" 1 pass");
    expect(output).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/14670 — `Bun.$` returns a lazy promise subclass
  // that only starts when its own `.then` is called, so the deferral must adopt the
  // subject with `Promise.resolve` semantics (native reactions on its internal slots
  // would never start it and the matcher would never settle).
  test("lazy thenable subjects (Bun.$, Promise subclasses) start and settle", async () => {
    const { stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
import { $ } from "bun";
test("rejects on a failing command", async () => {
  await expect($\`exit 1\`.quiet()).rejects.toThrow();
});
test("resolves on a succeeding command", async () => {
  await expect($\`echo hi\`.quiet().text()).resolves.toBe("hi\\n");
});
test("un-awaited rejects on a failing command", () => {
  expect($\`exit 1\`.quiet()).rejects.toThrow();
});
test("promise subclass with an overridden then", async () => {
  let adopted = false;
  class Lazy extends Promise {
    then(onFulfilled, onRejected) {
      adopted = true;
      return super.then(onFulfilled, onRejected);
    }
  }
  const subject = new Lazy(resolve => queueMicrotask(() => resolve(7)));
  await expect(subject).resolves.toBe(7);
  expect(adopted).toBe(true);
});
`,
    });
    expect(stderr).toContain(" 4 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // A subclass whose `then` delegates to an inner promise never settles its OWN internal
  // slots, so the settle re-invocation must consume the settlement its reaction captured
  // instead of re-reading the raw subject (which stays "pending" forever).
  test("promise subclass with a delegating then whose own slots never settle", async () => {
    const { stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
class Weird extends Promise {
  constructor(executor) {
    super(() => {});
    this._p = new Promise(executor);
  }
  then(onFulfilled, onRejected) {
    return this._p.then(onFulfilled, onRejected);
  }
}
test("delegating subclass resolves", async () => {
  await expect(new Weird(resolve => setTimeout(() => resolve(42), 10))).resolves.toBe(42);
});
test("delegating subclass rejects", async () => {
  await expect(new Weird((_, reject) => setTimeout(() => reject(new Error("boom")), 10))).rejects.toThrow(
    "boom",
  );
});
`,
    });
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // A chained deferral (the subject deferral followed by an async `toThrow` / async
  // custom-matcher deferral) re-invokes the matcher a second time: that pass must resume
  // from the carried subject settlement, never from the raw subject's internal slots
  // (which the delegating subclass never settles). Plain-Promise controls prove the
  // chaining itself works either way.
  test("delegating subclass with a chained deferral never re-reads the raw subject", async () => {
    const { stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
class Weird extends Promise {
  constructor(executor) {
    super(() => {});
    this._p = new Promise(executor);
  }
  then(onFulfilled, onRejected) {
    return this._p.then(onFulfilled, onRejected);
  }
}
expect.extend({
  async toEventuallyBe(received, expected) {
    await Bun.sleep(1);
    return { pass: received === expected, message: () => "expected " + received + " to be " + expected };
  },
});
const asyncThrower = async () => {
  throw new Error("kaboom");
};
test("delegating subclass + async custom matcher", async () => {
  await expect(new Weird(resolve => setTimeout(() => resolve(42), 10))).resolves.toEventuallyBe(42);
});
test("delegating subclass resolving to an async-throwing function + toThrow", async () => {
  await expect(new Weird(resolve => setTimeout(() => resolve(asyncThrower), 10))).resolves.toThrow("kaboom");
});
test("plain promise + async custom matcher (control)", async () => {
  await expect(new Promise(resolve => setTimeout(() => resolve(42), 10))).resolves.toEventuallyBe(42);
});
test("plain promise resolving to an async-throwing function + toThrow (control)", async () => {
  await expect(new Promise(resolve => setTimeout(() => resolve(asyncThrower), 10))).resolves.toThrow("kaboom");
});
`,
    });
    expect(stderr).toContain(" 4 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // The trackability predicate is per concurrent GROUP: a lone `test.concurrent` is a
  // group of one sequence, so its owning test is resolvable and its matcher defers
  // (non-blocking) exactly like a sequential test's.
  test("a lone test.concurrent defers instead of blocking on a pending subject", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test.concurrent("lone concurrent", async () => {
  const { promise, resolve } = Promise.withResolvers<number>();
  const before = Date.now();
  const deferred = expect(promise).resolves.toBe(42);
  const dt = Date.now() - before;
  // Only reachable because expect() returned without blocking on the still-pending subject.
  resolve(42);
  await deferred;
  console.log("N_LONE_DT:" + dt);
  // A regression to the blocking carve-out hangs on the never-yet-resolved subject: the
  // 3s timeout turns that into a fast assertion failure instead of a stalled runner.
}, 3000);
`,
    });
    // dt only measures the (non-blocking) expect() call itself: the subject could not
    // resolve until after it returned, so a blocking wait would never have come back.
    const dt = Number(stdout.match(/N_LONE_DT:(\d+)/)?.[1]);
    expect(dt).toBeLessThan(1000);
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // Two adjacent `test.concurrent`s share one group of 2 sequences, so no single owning
  // test is resolvable: each matcher keeps the pre-existing synchronous wait (the
  // deliberately-unchanged carve-out), returning only after its subject settled.
  test("sibling test.concurrent tests in one group keep the synchronous wait", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
function probe(label: string, value: number) {
  const order: string[] = [];
  const before = Date.now();
  const subject = Bun.sleep(50).then(() => {
    order.push("subject-settled");
    return value;
  });
  expect(subject).resolves.toBe(value);
  order.push("expect-returned");
  console.log(label + ":" + order.join(",") + ":" + (Date.now() - before));
}
test.concurrent("sibling one", () => probe("P_ONE", 1));
test.concurrent("sibling two", () => probe("P_TWO", 2));
`,
    });
    for (const label of ["P_ONE", "P_TWO"]) {
      const [, order, dt] = stdout.match(new RegExp(`${label}:([a-z,-]+):(\\d+)`)) ?? [];
      // Blocking: the 50ms subject settled before expect() returned, and the call took at
      // least the subject delay (small slack for timer granularity).
      expect(`${label}:${order}`).toBe(`${label}:subject-settled,expect-returned`);
      expect(Number(dt)).toBeGreaterThanOrEqual(45);
    }
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // `.resolves` returns the same wrapper, so a later `.not` mutates the flags byte an
  // earlier call already captured. Each deferral must re-invoke with ITS call-time flags
  // (Jest parity: `resolves` and `resolves.not` are independent matcher sets).
  test("a reused .resolves handle applies each call's own flags, not the latest", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("per-call flags, both pass", async () => {
  const r = expect(Promise.resolve(3)).resolves;
  const outcomes: string[] = [];
  const first = r.toBe(3);
  const second = r.not.toBe(4);
  await first.then(() => outcomes.push("first:fulfilled"), () => outcomes.push("first:rejected"));
  await second.then(() => outcomes.push("second:fulfilled"), () => outcomes.push("second:rejected"));
  console.log("G_OUTCOMES:" + outcomes.join(","));
});
`,
    });
    // Neither call fails under its own flags: `.resolves.toBe(3)` and `.resolves.not.toBe(4)`.
    expect(stdout).toContain("G_OUTCOMES:first:fulfilled,second:fulfilled");
    expect(stdout + stderr).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  // Same reuse where the later `.not` call is the failing one: the first deferral still
  // fulfills (it was made without `.not`), and the un-awaited second fails the test once
  // with the `.not` matcher error.
  test("a reused .resolves handle fails only the call made through .not", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("per-call flags, second fails", async () => {
  const r = expect(Promise.resolve(3)).resolves;
  const first = r.toBe(3);
  r.not.toBe(3);
  await first.then(() => console.log("F_FIRST:fulfilled"), () => console.log("F_FIRST:rejected"));
});
`,
    });
    expect(stdout).toContain("F_FIRST:fulfilled");
    // Only the `.not` call fails, reported exactly once.
    expect(stderr.split("expect(received).not.toBe(expected)").length - 1).toBe(1);
    expect(stdout + stderr).not.toContain("Unhandled");
    expect(stderr).toContain(" 0 pass");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // A beforeAll/afterAll-only sequence has no test entry to bound a deferral, so its
  // matcher keeps the pre-existing synchronous wait. That wait ignores the hook timeout —
  // a NEVER-settling subject in a hook still hangs the whole run, exactly as in released
  // Bun — which is why this fixture's subject settles: it pins the blocking fallback
  // (subject settled before expect() returned) plus the overrun hook-timeout report.
  test("a beforeAll-only sequence keeps the synchronous wait and reports the hook timeout", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect, beforeAll } from "bun:test";
const order: string[] = [];
beforeAll(() => {
  const subject = Bun.sleep(250).then(() => {
    order.push("subject-settled");
    return 1;
  });
  expect(subject).resolves.toBe(1);
  order.push("expect-returned");
  console.log("HOOK_ORDER:" + order.join(","));
}, 50);
test("t", () => {});
`,
    });
    // Blocking fallback: the subject settled before expect() returned inside the hook, so
    // the hook overran its 50ms timeout and the run still terminated with that failure.
    expect(stdout).toContain("HOOK_ORDER:subject-settled,expect-returned");
    expect(stdout + stderr).toContain("hook timed out");
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("deferred matcher error attribution", () => {
  // The rejection the user's `await` observes is the matcher's REAL exception (class,
  // `cause`, extra properties intact) with the `expect()` call-site frames grafted onto
  // its `stack`, not a placeholder error carrying only the message.
  test("an awaited deferred matcher failure keeps its error class and properties and points at the expect line", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
class MatcherBoom extends Error {}
expect.extend({
  toFailCustom() {
    const err = new MatcherBoom("CUSTOM_MATCHER_FAILURE");
    err.cause = "CUSTOM_CAUSE";
    err.detail = 42;
    throw err;
  },
});
test("attribution", async () => {
  let caught;
  try {
    await expect(Bun.sleep(5).then(() => 1)).resolves.toFailCustom();
  } catch (e) {
    caught = e;
  }
  console.log(
    "ATTRIBUTION:" +
      JSON.stringify({
        isMatcherBoom: caught instanceof MatcherBoom,
        message: caught.message,
        cause: caught.cause,
        detail: caught.detail,
        stackHasExpectLine: typeof caught.stack === "string" && caught.stack.includes("fixture.test.ts:14:"),
      }),
  );
});
`,
    });
    expect(stdout).toContain(
      `ATTRIBUTION:{"isMatcherBoom":true,"message":"CUSTOM_MATCHER_FAILURE","cause":"CUSTOM_CAUSE","detail":42,"stackHasExpectLine":true}`,
    );
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });

  // Grafting the call site must not destroy the exception's own user frames: an error
  // thrown from user JS inside the re-invoked matcher keeps its real throw site, with the
  // `expect()` call-site frames appended after it.
  test("a deferred custom matcher throwing from user code keeps the throw-site frame and gains the expect line", async () => {
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
function deepHelper() {
  throw new Error("DEEP_BOOM");
}
expect.extend({
  toFailDeep() {
    deepHelper();
    return { pass: true, message: () => "" };
  },
});
test("throw site survives", async () => {
  let caught;
  try {
    await expect(Bun.sleep(3).then(() => 1)).resolves.toFailDeep();
  } catch (e) {
    caught = e;
  }
  const at = needle => caught.stack.indexOf(needle);
  console.log(
    "FRAMES:" +
      JSON.stringify({
        throwSite: at("deepHelper (") >= 0 && caught.stack.includes("fixture.test.ts:3:"),
        matcher: caught.stack.includes("fixture.test.ts:7:"),
        expectLine: caught.stack.includes("fixture.test.ts:14:"),
        throwSiteFirst: at("fixture.test.ts:3:") < at("fixture.test.ts:14:"),
      }),
  );
});
`,
    });
    expect(stdout).toContain('FRAMES:{"throwSite":true,"matcher":true,"expectLine":true,"throwSiteFirst":true}');
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });

  // A deferral abandoned by a per-test timeout (its epoch is stale by the time the subject
  // settles) rejects `D` with a real reason attributed to the `expect()` line, never the
  // internal call-site placeholder.
  test("a deferral abandoned by a test timeout rejects with a real stale-attempt message", async () => {
    const { stdout, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect, afterAll } from "bun:test";
let d: Promise<unknown> | undefined;
test("times out", async () => {
  d = expect(Bun.sleep(100).then(() => 1)).resolves.toBe(1);
  await Bun.sleep(2_000);
}, 50);
afterAll(async () => {
  const outcome = await d!.then(
    () => "fulfilled",
    e => "rejected:" + e.message + ":stack=" + (typeof e.stack === "string" && e.stack.includes("fixture.test.ts:4:")),
  );
  console.log("STALE_OUTCOME:" + outcome);
});
`,
    });
    expect(stdout).toContain(
      "STALE_OUTCOME:rejected:Test attempt ended (timeout or retry) before the matcher promise settled:stack=true",
    );
    expect(stdout).not.toContain("Matcher promise was not awaited");
    expect(exitCode).toBe(1);
  });
});
