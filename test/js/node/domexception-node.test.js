import { describe, expect, it } from "bun:test";
import { inspect } from "node:util";

describe("DOMException in Node.js environment", () => {
  it("exists globally", () => {
    expect(typeof DOMException).toBe("function");
  });

  it("creates instance with message and name", () => {
    const error = new DOMException("Error message", "TestError");
    expect(error).toBeInstanceOf(DOMException);
    expect(error.message).toBe("Error message");
    expect(error.name).toBe("TestError");
    expect(error instanceof Error).toBe(true);
  });

  it("uses default name when only message is provided", () => {
    const error = new DOMException("Error message");
    expect(error.message).toBe("Error message");
    expect(error.name).toBe("Error");
  });

  it("creates instance with options object", () => {
    const cause = { reason: "test reason" };
    const error = new DOMException("Error with cause", { name: "CauseError", cause });

    expect(error.message).toBe("Error with cause");
    expect(error.name).toBe("CauseError");
    expect(error.cause).toBe(cause);
  });

  it("has standard error constants", () => {
    expect(DOMException.INDEX_SIZE_ERR).toBe(1);
    expect(DOMException.DOMSTRING_SIZE_ERR).toBe(2);
    expect(DOMException.HIERARCHY_REQUEST_ERR).toBe(3);
    expect(DOMException.WRONG_DOCUMENT_ERR).toBe(4);
    expect(DOMException.INVALID_CHARACTER_ERR).toBe(5);
    expect(DOMException.NO_DATA_ALLOWED_ERR).toBe(6);
    expect(DOMException.NO_MODIFICATION_ALLOWED_ERR).toBe(7);
    expect(DOMException.NOT_FOUND_ERR).toBe(8);
    expect(DOMException.NOT_SUPPORTED_ERR).toBe(9);
    expect(DOMException.INUSE_ATTRIBUTE_ERR).toBe(10);
    expect(DOMException.INVALID_STATE_ERR).toBe(11);
    expect(DOMException.SYNTAX_ERR).toBe(12);
    expect(DOMException.INVALID_MODIFICATION_ERR).toBe(13);
    expect(DOMException.NAMESPACE_ERR).toBe(14);
    expect(DOMException.INVALID_ACCESS_ERR).toBe(15);
    expect(DOMException.VALIDATION_ERR).toBe(16);
    expect(DOMException.TYPE_MISMATCH_ERR).toBe(17);
    expect(DOMException.SECURITY_ERR).toBe(18);
    expect(DOMException.NETWORK_ERR).toBe(19);
    expect(DOMException.ABORT_ERR).toBe(20);
    expect(DOMException.URL_MISMATCH_ERR).toBe(21);
    expect(DOMException.QUOTA_EXCEEDED_ERR).toBe(22);
    expect(DOMException.TIMEOUT_ERR).toBe(23);
    expect(DOMException.INVALID_NODE_TYPE_ERR).toBe(24);
    expect(DOMException.DATA_CLONE_ERR).toBe(25);
  });

  it("inherits prototype properties from Error", () => {
    const error = new DOMException("Test error");
    expect(error.toString()).toBe("Error: Test error");
    expect(error.stack).toBeDefined();
  });

  it("has [[ErrorData]] internal slot", () => {
    const error = new DOMException("boom", "AbortError");
    expect(Error.isError(error)).toBe(true);
    expect(Object.prototype.toString.call(error)).toBe("[object DOMException]");
  });

  it("captures a stack trace", () => {
    function inner() {
      return new DOMException("boom", "AbortError");
    }
    const error = inner();
    expect(typeof error.stack).toBe("string");
    expect(error.stack).toStartWith("AbortError: boom");
    expect(error.stack).toContain("inner");
    expect(Object.getOwnPropertyNames(error)).toContain("stack");
  });

  it("keeps name/message/code as prototype accessors", () => {
    const error = new DOMException("boom", "AbortError");
    const own = Object.getOwnPropertyNames(error);
    expect(own).not.toContain("name");
    expect(own).not.toContain("message");
    expect(own).not.toContain("code");

    const proto = Object.getPrototypeOf(error);
    expect(Object.getOwnPropertyDescriptor(proto, "name").get).toBeFunction();
    expect(Object.getOwnPropertyDescriptor(proto, "message").get).toBeFunction();
    expect(Object.getOwnPropertyDescriptor(proto, "code").get).toBeFunction();
  });

  it("AbortSignal.abort().reason is a DOMException with a stack", () => {
    const reason = AbortSignal.abort().reason;
    expect(reason).toBeInstanceOf(DOMException);
    expect(Error.isError(reason)).toBe(true);
    expect(reason.name).toBe("AbortError");
    expect(typeof reason.stack).toBe("string");
    expect(reason.stack).toStartWith("AbortError");
  });

  it("AbortSignal.timeout() reason gets a stack even with no JS frames", async () => {
    // The timeout fires from a native timer with no JS on the stack, so there
    // are no frames to capture; the stack must still be the error header.
    const signal = AbortSignal.timeout(1);
    const { promise, resolve } = Promise.withResolvers();
    signal.addEventListener("abort", resolve);
    await promise;
    const reason = signal.reason;
    expect(reason).toBeInstanceOf(DOMException);
    expect(Error.isError(reason)).toBe(true);
    expect(reason.stack).toBe("TimeoutError: The operation timed out.");
  });

  it("AbortController.abort() reason is a DOMException with a stack", () => {
    const c = new AbortController();
    c.abort();
    const reason = c.signal.reason;
    expect(reason).toBeInstanceOf(DOMException);
    expect(Error.isError(reason)).toBe(true);
    expect(reason.name).toBe("AbortError");
    expect(typeof reason.stack).toBe("string");
    expect(reason.stack).toStartWith("AbortError");
  });

  it("structuredClone preserves DOMException and captures a stack", () => {
    const original = new DOMException("boom", "QuotaExceededError");
    const clone = structuredClone(original);
    expect(clone).toBeInstanceOf(DOMException);
    expect(Error.isError(clone)).toBe(true);
    expect(clone.name).toBe("QuotaExceededError");
    expect(clone.message).toBe("boom");
    expect(clone.code).toBe(22);
    expect(typeof clone.stack).toBe("string");
  });

  it("util.inspect shows the error name and message", () => {
    const error = new DOMException("boom", "AbortError");
    const inspected = inspect(error);
    expect(inspected).toStartWith("DOMException [AbortError]: boom");
  });

  it("survives GC with intact stack traces", () => {
    function makeError() {
      return new DOMException("gc test", "AbortError");
    }
    const errors = [];
    for (let i = 0; i < 100; i++) errors.push(makeError());
    Bun.gc(true);
    for (const e of errors) {
      expect(Error.isError(e)).toBe(true);
      expect(typeof e.stack).toBe("string");
      expect(e.stack).toContain("makeError");
    }
    Bun.gc(true);
    for (const e of errors) {
      expect(e.name).toBe("AbortError");
      expect(e.message).toBe("gc test");
    }
  });

  it("has proper instance properties", () => {
    const error = new DOMException("Test error", "TestName");
    expect(error.code).toBe(0); // Default code for custom names

    // Create an exception with known code
    const abortError = new DOMException("Aborted", "AbortError");
    expect(abortError.code).toBe(20); // ABORT_ERR
  });
});
