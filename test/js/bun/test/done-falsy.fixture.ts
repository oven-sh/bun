import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, onTestFinished, test } from "bun:test";
import { EventEmitter } from "node:events";

// `done(value)` fails the test only when `value` is truthy, as in Jest and Mocha.
// Every test name starts with the verdict that the test must get.

const falsy = [
  ["undefined", undefined],
  ["null", null],
  ["false", false],
  ["0", 0],
  ["-0", -0],
  ["0n", 0n],
  ["NaN", NaN],
  ['""', ""],
] as const;
const truthy = [
  ["true", true],
  ["1", 1],
  ['"x"', "x"],
  ["{}", {}],
  ["[]", []],
  ["Symbol()", Symbol()],
  ["new Boolean(false)", new Boolean(false)],
  ["new Error()", new Error("e")],
] as const;

const timings: Record<string, (fn: () => void) => void> = {
  "in the test body": fn => fn(),
  "from a microtask": fn => queueMicrotask(fn),
  "from a macrotask": fn => setImmediate(fn),
};

for (const [when, schedule] of Object.entries(timings)) {
  test.each(falsy)(`passes: done(%s) ${when}`, (_label, value, done) => {
    schedule(() => done(value));
  });
  test.each(truthy)(`fails: done(%s) ${when}`, (_label, value, done) => {
    schedule(() => done(value));
  });
}

test("passes: done is the listener of an event that emits 0", done => {
  const emitter = new EventEmitter();
  emitter.on("exit", done);
  setImmediate(() => emitter.emit("exit", 0));
});

test("passes: done reads only its first argument", done => {
  (done as (...args: unknown[]) => void)(false, new Error("second argument"));
});

test.concurrent("passes: done(0) in a concurrent test", done => {
  done(0);
});
test.concurrent("passes: done(false) from a macrotask in a concurrent test", done => {
  setImmediate(() => done(false));
});

describe("hooks", () => {
  beforeAll(done => done(false));
  beforeEach(done => done(0));
  afterEach(done => done(""));
  afterAll(done => done(NaN));
  test("passes: beforeAll, beforeEach, afterEach and afterAll call done with a falsy value", () => {});
});

describe("done(false) after the test timed out", () => {
  let lateDone: (value?: unknown) => void;
  test("fails: the test times out before it calls done", done => {
    lateDone = done;
  }, 1);
  test("passes: a late done(false) does not fail the test that runs now", () => {
    lateDone(false);
  });
});

// A falsy value that is thrown is still a failure.
test.each([[0], [false], [""]] as const)("fails: a test with a done parameter throws %p", (value, done) => {
  throw value;
});

// Jest cannot run the rows below. It has no onTestFinished, it rejects a test that
// takes done and returns a promise, and its test.todo takes no function.
test("passes: onTestFinished calls done with a falsy value", () => {
  onTestFinished(done => done(0n));
});

describe("done(false) while the promise of an async test is pending", () => {
  let settled = false;
  test("passes: the test waits for its promise, as after done()", async done => {
    await new Promise<void>(resolve => {
      setImmediate(() => {
        done(false);
        setImmediate(resolve);
      });
    });
    settled = true;
  });
  test("passes: the promise of the previous test settled before this test", () => {
    expect(settled).toBe(true);
  });
});

// With --todo, a todo test that passes is a failure.
test.todo("fails: a todo test passes when it calls done(false)", done => {
  done(false);
});
