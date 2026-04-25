import { expect, test } from "bun:test";

test("DOMException from new DOMException() has a stack trace", () => {
  const e = new DOMException("test error", "AbortError");
  expect(typeof e.stack).toBe("string");
  expect(e.stack).toContain("AbortError: test error");
  expect(e.stack).toContain("17877.test");
  expect(e instanceof DOMException).toBe(true);
  expect(e instanceof Error).toBe(true);
});

test("DOMException from AbortSignal.abort() has a stack trace", () => {
  const signal = AbortSignal.abort();
  try {
    signal.throwIfAborted();
    expect.unreachable();
  } catch (err: any) {
    expect(typeof err.stack).toBe("string");
    expect(err.stack).toContain("AbortError");
    expect(err.stack).toContain("The operation was aborted");
    expect(err instanceof DOMException).toBe(true);
    expect(err instanceof Error).toBe(true);
  }
});

test("DOMException stack trace includes correct name and message", () => {
  const e = new DOMException("custom message", "NotFoundError");
  expect(typeof e.stack).toBe("string");
  expect(e.stack).toStartWith("NotFoundError: custom message\n");
});

test("DOMException with default args has a stack trace", () => {
  const e = new DOMException();
  expect(typeof e.stack).toBe("string");
  expect(e.name).toBe("Error");
  expect(e.message).toBe("");
});

test("DOMException stack trace shows correct call site", () => {
  function createException() {
    return new DOMException("inner", "DataError");
  }

  const e = createException();
  expect(typeof e.stack).toBe("string");
  expect(e.stack).toContain("createException");
});

test("DOMException.stack is writable", () => {
  const e = new DOMException("test", "AbortError");
  expect(typeof e.stack).toBe("string");
  e.stack = "custom stack";
  expect(e.stack).toBe("custom stack");
});

test("DOMException from AbortSignal.abort() with custom reason has no stack on reason", () => {
  const reason = "custom reason string";
  const signal = AbortSignal.abort(reason);
  try {
    signal.throwIfAborted();
    expect.unreachable();
  } catch (err: any) {
    // When a custom reason (non-DOMException) is used, it's thrown as-is
    expect(err).toBe("custom reason string");
  }
});

test("DOMException from AbortSignal.abort() with DOMException reason has stack", () => {
  const reason = new DOMException("custom abort", "AbortError");
  const signal = AbortSignal.abort(reason);
  try {
    signal.throwIfAborted();
    expect.unreachable();
  } catch (err: any) {
    expect(err).toBe(reason);
    expect(typeof err.stack).toBe("string");
    expect(err.stack).toContain("AbortError: custom abort");
  }
});
