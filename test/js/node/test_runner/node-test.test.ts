import { spawn } from "bun";
import { nodeTestRunFrames } from "bun:internal-for-testing";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { once } from "node:events";
import { join } from "node:path";
import { run } from "node:test";

// Every test here starts a bun subprocess, and a debug or ASAN build takes seconds to start one.
if (isDebug || isASAN) setDefaultTimeout(30_000);

describe("node:test", () => {
  // These three drive the largest fixtures (01-harness has 32 node:test cases);
  // a debug+ASAN `bun test` child takes several seconds to start, so give them
  // headroom and let them spawn in parallel instead of serially.
  test.concurrent(
    "should run basic tests",
    async () => {
      const { exitCode, stderr } = await runTests(["01-harness.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining("0 fail"),
      });
    },
    30_000,
  );

  test.concurrent(
    "should run hooks in the right order",
    async () => {
      const { exitCode, stderr } = await runTests(["02-hooks.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        stderr: expect.stringContaining("0 fail"),
      });
    },
    30_000,
  );

  test("should run tests with different variations", async () => {
    const { exitCode, stderr } = await runTests(["03-test-variations.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run async tests", async () => {
    const { exitCode, stderr } = await runTests(["04-async-tests.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test.concurrent(
    "should run all tests from multiple files",
    async () => {
      const { exitCode, stderr } = await runTests(["01-harness.js", "02-hooks.js"]);
      expect({ exitCode, stderr }).toMatchObject({
        exitCode: 0,
        // 32 from 01-harness + 3 from 02-hooks
        stderr: expect.stringContaining("35 pass"),
      });
    },
    30_000,
  );

  test("should run test() and describe() called inside another test() as subtests", async () => {
    const { exitCode, stderr } = await runTests(["05-test-in-test.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run before hooks created on a running test once and validate hook options", async () => {
    const { exitCode, stderr } = await runTests(["06-hook-semantics.js"]);
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should fail tests whose hooks, bodies, or inline suite callbacks fail", async () => {
    const { exitCode, stdout, stderr } = await runTests(["07-failing-hooks.js"]);
    // The subtest after the failing before hook must not run its body (Node).
    expect(stdout).toContain("SUB_BODY_RAN=false");
    expect(stderr).toContain("0 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("10 fail"),
    });
  });

  test("should support done callbacks in tests and hooks", async () => {
    const { exitCode, stderr } = await runTests(["10-done-callbacks.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should count runtime t.todo()/t.skip() as todo/skip and keep runner timers real under mock timers", async () => {
    const { exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("1 skip");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should count runtime t.todo()/t.skip() as todo/skip under --concurrent too", async () => {
    // markCurrentResult's microtask-drain fallback could not name a sequence
    // inside a concurrent group, so the skip/todo mark was dropped and both
    // tests were reported as pass.
    const { exitCode, stderr } = await runTests(["12-runtime-todo-and-mock-timers.js"], {}, ["--concurrent"]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("1 skip");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should run todo bodies under --todo instead of registering an empty function", async () => {
    const { exitCode, stderr } = await runTests(["13-todo-bodies.js"], {}, ["--todo"]);
    expect(stderr).toContain("2 todo");
    expect(stderr).toContain("1 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should forward Infinity and finite timeouts so they override the runner default", async () => {
    const { exitCode, stderr } = await runTests(["11-timeout-overrides.js"], {}, ["--timeout", "100"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should not leak file-level beforeEach hooks across files in one process", async () => {
    const { exitCode, stderr } = await runTests(["14-root-hooks-a.js", "14-root-hooks-b.js"]);
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should treat only as a no-op instead of using bun:test's CI-banned only()", async () => {
    // bun:test's only() only throws when CI is set; pin the precondition.
    const { exitCode, stderr } = await runTests(["08-only-no-op.js"], { CI: "1" });
    expect(stderr).toContain("4 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should serialize inline suites and await async describe callbacks like node", async () => {
    const { exitCode, stderr } = await runTests(["09-inline-suites.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should expose the body outcome to afterEach and workerId to the context", async () => {
    const { exitCode, stderr } = await runTests(["15-outcome-in-hooks.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should capture plan at first t.assert access and resolve subtests started after their parent finished", async () => {
    const { exitCode, stderr } = await runTests(["16-plan-and-late-subtest.js"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("1 todo");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should bound plan({wait:true}) by the test's own timeout instead of hanging", async () => {
    const { exitCode, stderr } = await runTests(["16b-plan-wait-timeout.js"]);
    expect(stderr).toContain("test timed out after 100ms");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should fail the parent when a t.test() that fulfills plan({wait}) throws", async () => {
    const { exitCode, stderr } = await runTests(["24-plan-wait-late-subtest.js"]);
    // The error message from makeTestFailure — must not be satisfied by the
    // fixture's own source lines echoed in the failure context.
    expect(stderr).toContain("error: 1 subtest failed");
    expect(stderr).toContain("boom");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should treat a failing expectFailure test as a pass", async () => {
    const { exitCode, stderr } = await runTests(["25-expect-failure.js"]);
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should fail an expectFailure test that passes", async () => {
    const { exitCode, stderr } = await runTests(["27-expect-failure-but-passes.js"]);
    expect(stderr).toContain("test was expected to fail but passed");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should fail an expectFailure test whose error does not match the validator", async () => {
    const { exitCode, stderr } = await runTests(["29-expect-failure-mismatch.js"]);
    expect(stderr).toContain("the error did not match the expected validation");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should inherit expectFailure into subtests", async () => {
    // Matches node v26.3.0: the subtest inherits the expectation and passes, so
    // the parent is the one that fails for not failing.
    const { exitCode, stderr } = await runTests(["28-expect-failure-inherited.js"]);
    expect(stderr).toContain("test was expected to fail but passed");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("1 fail"),
    });
  });

  test("should not run a skipped suite's callback", async () => {
    const { exitCode, stdout, stderr } = await runTests(["26-skipped-suite-body.js"]);
    expect(stdout).not.toContain("[suite body ran: skip-only]");
    // { skip: true, todo: true } is a skip in Node, so this body is skipped too.
    expect(stdout).not.toContain("[suite body ran: both-flags]");
    // A todo suite's callback does run.
    expect(stdout).toContain("[suite body ran: pending-only]");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should reset the module-level mock tracker between --rerun-each iterations", async () => {
    // ESM entry: --rerun-each currently only re-evaluates ESM entry files.
    const { exitCode, stderr } = await runTests(["17-rerun-mock-reset.mjs"], {}, ["--rerun-each=3"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should keep node's zero-delay mock interval semantics", async () => {
    const { exitCode, stderr } = await runTests(["18-mock-timers-interval-zero.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should apply the plan option before beforeEach so a hook cannot snapshot a null plan", async () => {
    const { exitCode, stderr } = await runTests(["19-plan-option-order.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should enforce a hook-level signal and install t.assert.ok separately", async () => {
    const { exitCode, stderr } = await runTests(["20-hook-signal-and-assert-ok.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should let a registered ok assertion override the built-in one", async () => {
    const { exitCode, stderr } = await runTests(["21-register-ok.js"]);
    expect(stderr).toContain("2 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should gate a nested inline subtest on every ancestor suite's before hooks", async () => {
    const { exitCode, stderr } = await runTests(["22-nested-suite-before.js"]);
    expect(stderr).toContain("3 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });

  test("should resolve the promise of a test that a name pattern filters out", async () => {
    const { exitCode, stderr } = await runTests(["23-filtered-test-promise.js"], {}, ["-t", "should resolve"]);
    expect(stderr).not.toContain("timed out");
    expect(stderr).toContain("1 pass");
    expect({ exitCode, stderr }).toMatchObject({
      exitCode: 0,
      stderr: expect.stringContaining("0 fail"),
    });
  });
});

async function runTests(filenames: string[], env: Record<string, string> = {}, args: string[] = []) {
  const testPaths = filenames.map(filename => join(import.meta.dirname, "fixtures", filename));
  const {
    exited,
    stdout: stdoutStream,
    stderr: stderrStream,
  } = spawn({
    cmd: [bunExe(), "test", ...args, ...testPaths],
    env: { ...bunEnv, ...env },
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    exited,
    new Response(stdoutStream).text(),
    new Response(stderrStream).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("node:test mock", () => {
  const { mock } = require("node:test");

  test("mock.getter accepts the (object, methodName, options) overload", () => {
    const obj = {
      get prop() {
        return "original";
      },
    };
    // Passing an options object in the implementation slot must not clobber
    // the getter flag.
    const getter = mock.getter(obj, "prop", {});
    expect(obj.prop).toBe("original");
    expect(getter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.setter accepts the (object, methodName, options) overload", () => {
    let stored = "";
    const obj = {
      set prop(v: string) {
        stored = v;
      },
    };
    const setter = mock.setter(obj, "prop", {});
    obj.prop = "x";
    expect(stored).toBe("x");
    expect(setter.mock.callCount()).toBe(1);
    mock.restoreAll();
  });

  test("mock.getter rejects getter: false", () => {
    const obj = {
      get prop() {
        return 1;
      },
    };
    expect(() => mock.getter(obj, "prop", { getter: false })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.method rejects getter and setter together", () => {
    const obj = {
      get prop() {
        return 1;
      },
      set prop(_v) {},
    };
    expect(() => mock.method(obj, "prop", { getter: true, setter: true })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("mock.fn options.times reverts to the original after N calls", () => {
    const original = () => "original";
    const impl = () => "mocked";
    const fn = mock.fn(original, impl, { times: 2 });
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("mocked");
    expect(fn()).toBe("original");
    expect(fn.mock.callCount()).toBe(3);
    mock.restoreAll();
  });

  test("mock.method options.times restores the method after N calls", () => {
    const obj = {
      value: 5,
      addOne() {
        return this.value + 1;
      },
    };
    mock.method(obj, "addOne", () => 100, { times: 1 });
    expect(obj.addOne()).toBe(100);
    expect(obj.addOne()).toBe(6);
    mock.restoreAll();
  });

  test("mock.fn options.times is validated", () => {
    expect(() => mock.fn(() => {}, { times: 0 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    expect(() => mock.fn(() => {}, { times: 1.5 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
  });

  test("mock.restoreAll makes bare mock.fn mocks call their original again", () => {
    const fn = mock.fn(
      () => "original",
      () => "mocked",
    );
    expect(fn()).toBe("mocked");
    mock.restoreAll();
    expect(fn()).toBe("original");
  });
});

describe("node:test mock tracker semantics", () => {
  const { mock } = require("node:test");

  test("restoreAll keeps mocks associated; reset disassociates", () => {
    // mirrors observed node behavior exactly
    const f = mock.fn(
      () => "orig",
      () => "mocked",
    );
    expect(f()).toBe("mocked");
    mock.restoreAll();
    expect(f()).toBe("orig");
    // still tracked after restoreAll: reset() reverts a re-installed
    // implementation again
    f.mock.mockImplementation(() => "again");
    expect(f()).toBe("again");
    mock.reset();
    expect(f()).toBe("orig");
    // after reset() the context is disassociated: restoreAll no longer
    // touches it
    f.mock.mockImplementation(() => "post-reset");
    mock.restoreAll();
    expect(f()).toBe("post-reset");
    mock.reset();
  });

  test("queued once-implementations survive restoreAll like node", () => {
    const g = mock.fn(
      () => "g-orig",
      () => "g-mocked",
    );
    g.mock.mockImplementationOnce(() => "g-once", 1);
    mock.restoreAll();
    expect([g(), g(), g()]).toEqual(["g-orig", "g-once", "g-orig"]);
    mock.reset();
  });

  test("mock.method validates a non-object options argument", () => {
    const obj = {
      foo() {},
    };
    expect(() => mock.method(obj, "foo", () => {}, 5)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

test("the call record is pushed after the implementation runs, like node", () => {
  const { mock } = require("node:test");
  let inside = -1;
  const f = mock.fn(function () {
    inside = f.mock.callCount();
    return 1;
  });
  f();
  expect(inside).toBe(0);
  expect(f.mock.callCount()).toBe(1);
  mock.reset();
});

test("mock.property/mock.method survive a polluted Object.prototype", async () => {
  // The defineProperty descriptors must carry __proto__:null so an inherited
  // `value` on Object.prototype does not turn the accessor descriptor into a
  // TypeError (nodejs/node lib/internal/test_runner/mock/mock.js does this).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        Object.prototype.value = 1;
        const { mock } = require("node:test");
        const obj = { x: 1, get p() { return 5; } };
        mock.property(obj, "x");
        mock.getter(obj, "p");
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({ stdout: "ok", exitCode: 0 });
});

describe("node:test run()", () => {
  const { createRunOutputDecoder, encodeRunFrame } = nodeTestRunFrames;
  const encoder = new TextEncoder();
  const bytes = (...parts: (string | Uint8Array)[]) =>
    Buffer.concat(parts.map(part => (typeof part === "string" ? encoder.encode(part) : part)));
  const asText = (...parts: (string | Uint8Array)[]) => new TextDecoder().decode(bytes(...parts));

  // The frame of one event, built by hand: 0xFF, the tag, the payload length in
  // four big-endian bytes, the payload.
  const header = (length: number) =>
    bytes(
      Uint8Array.of(0xff),
      "bun:test:run",
      Uint8Array.of(length >>> 24, (length >>> 16) & 255, (length >>> 8) & 255, length & 255),
    );
  const frameOf = (payload: string | Uint8Array) => {
    const body = bytes(payload);
    return bytes(header(body.length), body);
  };
  const frame = (type: string, data: unknown) => frameOf(JSON.stringify({ type, data }));
  // A line that holds this marker and JSON after it was an event before run()
  // framed events in bytes.
  const marker = (type: string, data: unknown) => "\0bun:test:run\0" + JSON.stringify({ type, data });
  const neverRan = { name: "never ran", nesting: 0 };

  describe("frames", () => {
    function decode(input: Uint8Array, chunkSize = input.length) {
      const out: unknown[] = [];
      const decoder = createRunOutputDecoder(
        message => out.push(message),
        event => out.push({ type: event.type, name: event.data.name }),
      );
      for (let i = 0; i < input.length; i += chunkSize) decoder.write(input.subarray(i, i + chunkSize));
      decoder.end();
      return out;
    }
    const ran = { type: "test:pass", name: "ran" };
    const real = frame("test:pass", { name: "ran", nesting: 0 });
    // Bytes that are not an event come out as text, and the frame behind them as an event.
    const text = (...parts: (string | Uint8Array)[]): [Uint8Array, unknown[]] => [
      bytes(...parts, "\n", real),
      [asText(...parts, "\n"), ran],
    ];

    const cases: Record<string, [Uint8Array, unknown[]]> = {
      "lines": [bytes("a\nb\n"), ["a\n", "b\n"]],
      "empty lines": [bytes("\n\na\n\n", real, "\n"), ["a\n", ran]],
      "a frame": [real, [ran]],
      "frames back to back": [
        bytes(real, frame("test:fail", { name: "failed", nesting: 0, error: { message: "boom" } }), real),
        [ran, { type: "test:fail", name: "failed" }, ran],
      ],
      "a line, then a frame": [bytes("line\n", real), ["line\n", ran]],
      "an open line is closed before the event": [bytes("open", real, "rest\n"), ["open\n", ran, "rest\n"]],
      "text in more than one byte per character": [
        bytes(
          "h\u00e9llo \u{1f600}\n",
          frame("test:pass", { name: "n\u00e4me \u{1f600}", nesting: 0 }),
          "\u4e2d\u6587\n",
        ),
        ["h\u00e9llo \u{1f600}\n", { type: "test:pass", name: "n\u00e4me \u{1f600}" }, "\u4e2d\u6587\n"],
      ],
      "an error with causes": [
        frame("test:fail", {
          name: "ran",
          nesting: 0,
          error: { message: "a", cause: { message: "b", cause: { message: "c" } } },
        }),
        [{ type: "test:fail", name: "ran" }],
      ],
      "the text marker of older builds": text(marker("test:pass", neverRan)),
      "the tag without the lead byte": text("bun:test:run", real.subarray(13)),
      "a frame that went through a text decoder": text(asText(frame("test:pass", neverRan))),
      "a frame that went through a text encoder": text(frame("test:pass", neverRan).toString("latin1")),
      "a lead byte and other bytes": text(Uint8Array.of(0xff), "abc"),
      "a payload that is not JSON": text(frameOf("abc")),
      "a payload that is not UTF-8": text(
        frameOf(bytes('{"type":"test:pass","data":{"name":"', Uint8Array.of(0xc3, 0x28), '"}}')),
      ),
      "an event named end": text(frame("end", {})),
      "an event named close": text(frame("close", {})),
      "an event named error": text(frame("error", {})),
      "an event named data": text(frame("data", {})),
      "an event named test:summary": text(frame("test:summary", { counts: {} })),
      "no type": text(frameOf(JSON.stringify({ data: neverRan }))),
      "a payload that is null": text(frameOf("null")),
      "data that is null": text(frame("test:pass", null)),
      "data that is an array": text(frame("test:pass", [])),
      "data that is a string": text(frame("test:pass", "never ran")),
      "nesting that is not a number": text(frame("test:pass", { ...neverRan, nesting: { valueOf: 1, toString: 1 } })),
      "an error that is null": text(frame("test:fail", { ...neverRan, error: null })),
      "an error that is a string": text(frame("test:fail", { ...neverRan, error: "made up" })),
      "a cause that is null": text(frame("test:fail", { ...neverRan, error: { message: "made up", cause: null } })),
      "a cause of a cause that is null": text(
        frame("test:fail", { ...neverRan, error: { message: "a", cause: { message: "b", cause: null } } }),
      ),
      "a length over the bound": text(header(64 * 1024 * 1024 + 1), "abc"),
      "a length no frame has": text(header(0xffffffff), "abc"),
      // The payload these headers announce would hold the real frame: all of it, and more than is there.
      "a made-up frame around a real one": text(header(real.length + 4), "abc"),
      "a made-up frame that never ends": text(header(real.length + 100), "abc"),
      "a lead byte at the end": [bytes("a\n", Uint8Array.of(0xff)), ["a\n", "\ufffd\n"]],
      "a header cut off at the end": [bytes("a\n", header(10).subarray(0, 9)), ["a\n", "\ufffdbun:test\n"]],
      "a frame cut off at the end": [bytes("a\n", real.subarray(0, 30)), ["a\n", asText(real.subarray(0, 30)) + "\n"]],
    };

    test.each(Object.keys(cases))("%s", name => {
      const [input, expected] = cases[name];
      expect(decode(input)).toEqual(expected);
      // A read can end anywhere: inside the tag, the length, the payload or a character.
      for (const chunkSize of [1, 2, 7, 17, 64]) {
        expect(decode(input, chunkSize)).toEqual(expected);
      }
    });

    test("the child writes the frame the parent reads", () => {
      const data = { name: "ran \u{1f600}", nesting: 0, error: { message: "boom" } };
      expect(Buffer.from(encodeRunFrame("test:fail", data)!)).toEqual(frame("test:fail", data));
    });

    test("an error over the frame bound goes out shortened", () => {
      const stack = Buffer.alloc(64 * 1024 * 1024, "s").toString();
      const error = {
        message: Buffer.alloc(2048, "m").toString(),
        stack,
        name: "RangeError",
        code: "ERR_X",
        failureType: "testCodeFailure",
      };
      const encoded = encodeRunFrame("test:fail", { name: "big", nesting: 0, error })!;
      expect(encoded.length).toBeLessThan(4096);
      const events: { type: string; data: Record<string, any> }[] = [];
      const decoder = createRunOutputDecoder(
        message => expect.unreachable(message),
        event => events.push(event),
      );
      decoder.write(encoded);
      decoder.end();
      expect(events).toEqual([
        {
          type: "test:fail",
          data: {
            name: "big",
            nesting: 0,
            error: {
              message: Buffer.alloc(1024, "m").toString() + "... (the error is too large to report)",
              name: "RangeError",
              code: "ERR_X",
              failureType: "testCodeFailure",
            },
          },
        },
      ]);
    });
  });

  // What a script that calls run() sees, in order: the lines the file printed and
  // the verdict of each test.
  async function collect(stream: ReturnType<typeof run>, form: "for await" | "listeners" = "for await") {
    const log: string[] = [];
    const errors: Record<string, any> = {};
    let counts: unknown;
    let ends = 0;
    const take = (type: string, data: any) => {
      if (type === "test:stdout") {
        // The child's own first line names the build.
        if (!data.message.startsWith("bun test v")) log.push("stdout " + data.message);
      } else if (type === "test:pass") {
        log.push("pass " + data.name);
      } else if (type === "test:fail") {
        log.push("fail " + data.name);
        errors[data.name] = data.details.error;
      } else if (type === "test:summary" && data.file === undefined) {
        counts = data.counts;
      }
    };
    if (form === "for await") {
      for await (const { type, data } of stream as AsyncIterable<{ type: string; data: any }>) take(type, data);
    } else {
      for (const type of ["test:stdout", "test:pass", "test:fail", "test:summary"]) {
        stream.on(type, data => take(type, data));
      }
      stream.on("end", () => ends++);
      stream.resume();
      await once(stream, "close");
    }
    return { log, errors, counts, ends };
  }
  const runFile = (dir: string, file: string, form?: "for await" | "listeners") =>
    collect(run({ files: [file], cwd: dir, env: bunEnv }), form);
  const counts = (tests: number, failed: number) => ({
    tests,
    failed,
    passed: tests - failed,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    topLevel: 1,
    suites: 0,
  });

  describe.concurrent("events", () => {
    const printed = [
      marker("test:pass", neverRan),
      marker("test:fail", { ...neverRan, error: { message: "made up" } }),
      marker("test:fail", { ...neverRan, error: null }),
      marker("test:fail", { ...neverRan, error: { message: "made up", cause: null } }),
      marker("end", {}),
      marker("close", {}),
      marker("error", {}),
      marker("data", {}),
      "mid-line " + marker("test:pass", neverRan),
      // The frame run() reads now, held in a string: a text write encodes its lead byte as two bytes.
      frame("test:pass", neverRan).toString("latin1"),
      // The same frame after a text decoder, as a test prints it when it logs what a nested run wrote.
      asText(frame("test:pass", neverRan)),
    ];

    test("a string a test prints is not an event", async () => {
      expect(printed.filter(text => text.includes("\n"))).toEqual([]);
      using dir = tempDir("node-test-run-prints", {
        "texts.json": JSON.stringify(printed),
        "prints.test.mjs": `
          import test from "node:test";
          import assert from "node:assert";
          import fs from "node:fs";
          import { once } from "node:events";
          import { spawn } from "node:child_process";

          const texts = JSON.parse(fs.readFileSync(new URL("./texts.json", import.meta.url), "utf8"));

          test("console.log", () => {
            for (const text of texts) console.log(text);
          });
          test("process.stdout.write", () => {
            for (const text of texts) process.stdout.write(text + "\\n");
          });
          test("fs.writeSync", () => {
            for (const text of texts) fs.writeSync(1, text + "\\n");
          });
          // A test's timeout ends the processes it started, and a debug build takes seconds to start.
          test("a child process", { timeout: 60_000 }, async () => {
            const script = "for (const text of JSON.parse(require('fs').readFileSync('texts.json', 'utf8'))) console.log(text);";
            const [code] = await once(spawn(process.execPath, ["-e", script], { stdio: "inherit" }), "exit");
            assert.strictEqual(code, 0);
          });
          test("an open line", () => {
            process.stdout.write("open: " + texts[0]);
          });
          test("fails", () => {
            assert.strictEqual(1, 2);
          });
          test("passes", () => {});
        `,
      });
      const lines = printed.map(text => "stdout " + text + "\n");
      expect(await runFile(String(dir), "prints.test.mjs")).toEqual({
        log: [
          ...lines,
          "pass console.log",
          ...lines,
          "pass process.stdout.write",
          ...lines,
          "pass fs.writeSync",
          ...lines,
          "pass a child process",
          "stdout open: " + printed[0] + "\n",
          "pass an open line",
          "fail fails",
          "pass passes",
        ],
        errors: { fails: expect.objectContaining({ code: "ERR_ASSERTION" }) },
        counts: counts(7, 1),
        ends: 0,
      });
    });

    test("a printed event name does not reach the listeners of the stream", async () => {
      using dir = tempDir("node-test-run-listeners", {
        "names.test.mjs": `
          import test from "node:test";

          test("prints", () => {
            for (const text of ${JSON.stringify(printed.slice(4, 8))}) console.log(text);
          });
          test("fails", () => {
            throw new Error("after the printed names");
          });
        `,
      });
      // A script that counts test:fail in a listener and stops at "end" missed this failure.
      expect(await runFile(String(dir), "names.test.mjs", "listeners")).toEqual({
        log: [...printed.slice(4, 8).map(text => "stdout " + text + "\n"), "pass prints", "fail fails"],
        errors: { fails: expect.objectContaining({ message: "after the printed names" }) },
        counts: counts(2, 1),
        ends: 1,
      });
    });

    test("a script that only prints is a file that passed", async () => {
      const text = marker("test:fail", { ...neverRan, error: { message: "made up" } });
      using dir = tempDir("node-test-run-script", { "script.mjs": `console.log(${JSON.stringify(text)});` });
      expect(await runFile(String(dir), "script.mjs")).toEqual({
        log: ["stdout " + text + "\n", "pass script.mjs"],
        errors: {},
        counts: counts(1, 0),
        ends: 0,
      });
    });

    test("a verdict goes out whole, after what its test printed", async () => {
      using dir = tempDir("node-test-run-order", {
        "order.test.mjs": `
          import test from "node:test";

          let ticks = 0;
          let logger;
          test("starts a logger", () => {
            logger = setInterval(() => console.log("tick " + ++ticks), 0);
          });
          test("fails with a 400 KB error", () => {
            console.log("before the failure");
            throw new Error(Buffer.alloc(400 * 1024, "x").toString());
          });
          test("the logger prints while that verdict is on its way", async () => {
            const seen = ticks;
            while (ticks < seen + 3) await new Promise(resolve => setImmediate(resolve));
            clearInterval(logger);
          });

          test("replaces process.stdout.write", () => {
            const { write } = process.stdout;
            const captured = [];
            process.stdout.write = chunk => (captured.push(chunk), true);
            globalThis.restoreWrite = () => {
              process.stdout.write = write;
              return captured;
            };
          });
          test("restores it", () => {
            console.log("captured " + globalThis.restoreWrite().length);
          });

          for (let i = 0; i < 8; i++) {
            test("line " + i, async () => {
              if (i % 2) console.log("line " + i);
              else process.stdout.write("line " + i + (i % 4 ? "\\n" : ""));
              if (i % 3 === 0) await 1;
            });
          }
          test("a megabyte through process.stdout", () => {
            const row = Buffer.alloc(64 * 1024 - 1, "m").toString();
            for (let i = 0; i < 16; i++) process.stdout.write(row + "\\n");
          });

          test("fails with a message that has no string form", () => {
            throw Object.assign(new Error(), { message: { toString: 1, valueOf: 1 } });
          });
        `,
      });
      const { log, errors, counts: seen } = await runFile(String(dir), "order.test.mjs");
      const row = "stdout " + Buffer.alloc(64 * 1024 - 1, "m").toString() + "\n";
      expect({
        log: log
          .filter(entry => !entry.startsWith("stdout tick "))
          .map(entry => (entry === row ? "stdout (a row)" : entry)),
        counts: seen,
        messages: [
          errors["fails with a 400 KB error"]?.message.length,
          errors["fails with a message that has no string form"]?.message,
        ],
      }).toEqual({
        log: [
          "pass starts a logger",
          "stdout before the failure\n",
          "fail fails with a 400 KB error",
          "pass the logger prints while that verdict is on its way",
          "pass replaces process.stdout.write",
          "stdout captured 0\n",
          "pass restores it",
          ...Array.from({ length: 8 }, (_, i) => [`stdout line ${i}\n`, `pass line ${i}`]).flat(),
          ...Array.from({ length: 16 }, () => "stdout (a row)"),
          "pass a megabyte through process.stdout",
          "fail fails with a message that has no string form",
        ],
        counts: counts(15, 2),
        messages: [400 * 1024, { toString: 1, valueOf: 1 }],
      });
    });

    test("a nested run on the same stdout counts in this run", async () => {
      using dir = tempDir("node-test-run-nested", {
        "outer.test.mjs": `
          import test from "node:test";
          import { once } from "node:events";
          import { spawn } from "node:child_process";

          // A test's timeout ends the processes it started, and a debug build takes seconds to start.
          test("runs a nested file", { timeout: 60_000 }, async () => {
            await once(spawn(process.execPath, ["test", "./inner.test.mjs"], { stdio: "inherit" }), "exit");
          });
        `,
        "inner.test.mjs": `
          import test from "node:test";

          test("inner passes", () => {});
          test("inner fails", () => {
            throw new Error("inner boom");
          });
        `,
      });
      const { log, errors, counts: seen } = await runFile(String(dir), "outer.test.mjs");
      expect({
        // The nested child prints lines of its own.
        log: log.filter(entry => !entry.startsWith("stdout ")),
        error: errors["inner fails"]?.message,
        counts: seen,
      }).toEqual({
        log: ["pass inner passes", "fail inner fails", "pass runs a nested file"],
        error: "inner boom",
        counts: counts(3, 1),
      });
    });
  });
});
