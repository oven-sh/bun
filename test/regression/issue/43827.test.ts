import { afterEach, expect, test } from "bun:test";

const origPrepareStackTrace = Error.prepareStackTrace;
afterEach(() => {
  Error.prepareStackTrace = origPrepareStackTrace;
});

// https://github.com/oven-sh/bun/issues/43827
// Error.captureStackTrace() on an Error whose stack was already read must format the
// new stack on the next read of .stack, not at capture time, as V8 does.
test("Error.captureStackTrace after .stack was read: message is read when the stack is", () => {
  const error = new Error("first");
  void error.stack;
  Error.captureStackTrace(error);
  error.message = "second";
  const lines = error.stack.split("\n");
  expect(lines[0]).toBe("Error: second");
  expect(lines[1]).toStartWith("    at ");
});

test("Error.captureStackTrace after .stack was read: the new frames replace the old ones", () => {
  function first() {
    const error = new Error("boom");
    void error.stack;
    return error;
  }
  function second(error: Error) {
    Error.captureStackTrace(error);
  }
  const error = first();
  second(error);
  const stack = error.stack!;
  expect(stack).toContain("at second");
  expect(stack).not.toContain("at first");
});

test("Error.captureStackTrace after .stack was read: Error.prepareStackTrace runs when the stack is read", () => {
  const error = new Error("first");
  void error.stack;
  let calls = 0;
  Error.prepareStackTrace = (e, sites) => {
    calls++;
    return `prepared: ${(e as Error).message} ${sites.length > 0}`;
  };
  Error.captureStackTrace(error);
  expect(calls).toBe(0);
  error.message = "second";
  expect(error.stack).toBe("prepared: second true");
  expect(calls).toBe(1);
  // The stack is formatted once.
  error.message = "third";
  expect(error.stack).toBe("prepared: second true");
  expect(calls).toBe(1);
});

test("Error.captureStackTrace after .stack was read: assignment and the line, column and sourceURL properties", () => {
  const error = new Error("first");
  void error.stack;
  Error.captureStackTrace(error);
  expect(Object.keys(error)).toEqual([]);
  error.stack = "overwritten";
  expect(error.stack).toBe("overwritten");
  expect(Object.keys(error)).toEqual([]);

  const other = new Error("other");
  void other.stack;
  Error.captureStackTrace(other);
  expect(typeof (other as any).line).toBe("number");
  expect(typeof (other as any).column).toBe("number");
  expect(other.stack).toStartWith("Error: other\n    at ");
});

test("Error.captureStackTrace after .stack was read: capturing again replaces the frames again", () => {
  function first() {
    const error = new Error("x");
    Error.captureStackTrace(error);
    void error.stack;
    return error;
  }
  function second(error: Error) {
    Error.captureStackTrace(error);
  }
  const error = first();
  second(error);
  error.message = "y";
  const stack = error.stack!;
  expect(stack.split("\n")[0]).toBe("Error: y");
  expect(stack).toContain("at second");
  expect(stack).not.toContain("at first");
});

// A capture from inside Error.prepareStackTrace, on the error being formatted, keeps the
// frames the callback was given: the same capture is what reads the stack.
test("Error.captureStackTrace after .stack was read: Error.prepareStackTrace captures the same error again", () => {
  const error = new Error("first");
  void error.stack;
  let inner: string | undefined;
  Error.prepareStackTrace = (e, sites) => {
    Error.captureStackTrace(e);
    inner = e.stack;
    return `prepared: ${(e as Error).message} ${sites[0].getFunctionName()}`;
  };
  function outerSite(e: Error) {
    Error.captureStackTrace(e);
  }
  outerSite(error);
  error.message = "second";
  expect(error.stack).toBe("prepared: second outerSite");
  expect(inner!.split("\n").slice(0, 2)).toEqual(["Error: second", expect.stringMatching(/^    at outerSite \(/)]);
});

test("Error.captureStackTrace after .stack was read: a frame collected before the read does not crash", () => {
  const error = new Error("first");
  void error.stack;
  // The callee of the frame that captures is a function nothing holds after it returns.
  const capture = new Function("Error", "error", "Error.captureStackTrace(error);");
  capture(Error, error);
  Bun.gc(true);
  error.message = "second";
  expect(error.stack!.split("\n")[0]).toBe("Error: second");
});
