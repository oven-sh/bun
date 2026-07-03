import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";

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
  return { stdout, stderr, exitCode };
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
    const { stderr, exitCode } = await runTestFile({
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
    expect(stripExpectCallCount(normalizeBunSnapshot(stderr))).toMatchInlineSnapshot(`
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
        at <anonymous> (file:NN:NN)
        at <anonymous> (file:NN:NN)
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
        at <anonymous> (file:NN:NN)
        at <anonymous> (file:NN:NN)
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
        at <anonymous> (file:NN:NN)
        at <anonymous> (file:NN:NN)
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
        at <anonymous> (file:NN:NN)
        at <anonymous> (file:NN:NN)
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
    const { stdout, stderr, exitCode } = await runTestFile({
      "fixture.test.ts": `import { test, expect } from "bun:test";
test("un-awaited failing resolves", () => {
  expect(Promise.resolve(1)).resolves.toBe(2);
});
test("sibling test", () => {
  expect(1).toBe(1);
});
`,
    });
    expect(stderr).toContain("(fail) un-awaited failing resolves");
    expect(stderr).not.toContain("(fail) sibling test");
    expect(stderr).toContain("expect(received).toBe(expected)");
    // Attributed to the `expect()` call: the code frame excerpts line 3 of the fixture.
    expect(stderr).toContain("3 |   expect(Promise.resolve(1)).resolves.toBe(2);");
    expect(stderr).toMatch(/fixture\.test\.ts:3:\d+/);
    expect(stdout + stderr).not.toContain("Unhandled");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 1 fail");
    expect(exitCode).toBe(1);
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

  // A matcher called from inside a `Bun.serve` fetch handler must not re-enter the event loop
  // synchronously (oven-sh/bun#33261). `nestedDispatchTicks` requires a debug build.
  test.skipIf(!isDebug || isWindows)(
    "a matcher inside a Bun.serve fetch handler does not re-enter the event loop",
    async () => {
      const { stdout, stderr, exitCode } = await runTestFile({
        "fixture.test.ts": `import { test, expect } from "bun:test";
import { getEventLoopStats } from "bun:internal-for-testing";
// The counter only counts re-entrant ticks started while an outer ready-poll dispatch is
// mid-batch, so both probes run inside a Bun.serve fetch handler (always dispatched from
// the server socket's poll batch). HTMLRewriter's string transform still waits
// synchronously on its async handlers, so it is the positive control proving the counter
// detects exactly what the matcher below must avoid.
test("nested dispatch is counted for a synchronous waiter inside a fetch handler", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      const before = getEventLoopStats().nestedDispatchTicks;
      new HTMLRewriter()
        .on("p", {
          async element() {
            await Bun.sleep(1);
          },
        })
        .transform("<p>x</p>");
      const after = getEventLoopStats().nestedDispatchTicks;
      return new Response(JSON.stringify({ delta: after - before }));
    },
  });
  const { delta } = await (await fetch(server.url)).json();
  console.log("K_CONTROL_DELTA:" + delta);
  expect(delta).toBeGreaterThan(0);
});
test("matcher inside fetch handler", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch() {
      const before = getEventLoopStats().nestedDispatchTicks;
      const pending = expect(Bun.sleep(1).then(() => "settled")).resolves.toBe("settled");
      const after = getEventLoopStats().nestedDispatchTicks;
      await pending;
      return new Response(JSON.stringify({ delta: after - before }));
    },
  });
  const { delta } = await (await fetch(server.url)).json();
  console.log("K_NESTED_DELTA:" + delta);
  expect(delta).toBe(0);
});
`,
      });
      expect(stdout).toContain("K_CONTROL_DELTA:1");
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
});
