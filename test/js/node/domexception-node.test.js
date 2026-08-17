import { describe, expect, it } from "bun:test";
import { inspect, types } from "node:util";

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

  it("has proper instance properties", () => {
    const error = new DOMException("Test error", "TestName");
    expect(error.code).toBe(0); // Default code for custom names

    // Create an exception with known code
    const abortError = new DOMException("Aborted", "AbortError");
    expect(abortError.code).toBe(20); // ABORT_ERR
  });
});

// WebIDL gives DOMException an [[ErrorData]] slot (whatwg/webidl#1421), so it has to pass the
// realm-independent brand checks, not just `instanceof Error`. Node agrees with everything below
// except the Bun.inspect and toEqual specifics.
describe("DOMException is an Error instance", () => {
  function thrownBy(fn) {
    try {
      fn();
    } catch (e) {
      return e;
    }
    throw new Error("expected fn to throw");
  }

  const cases = {
    "new DOMException()": () => new DOMException("m", "AbortError"),
    "class extends DOMException": () => new (class MyException extends DOMException {})("m", "AbortError"),
    "structuredClone(new DOMException())": () => structuredClone(new DOMException("m", "AbortError")),
    "AbortSignal.abort().reason": () => AbortSignal.abort().reason,
    "signal.throwIfAborted()": () => thrownBy(() => AbortSignal.abort().throwIfAborted()),
    "atob() InvalidCharacterError": () => thrownBy(() => atob("!!!")),
    "structuredClone() DataCloneError": () => thrownBy(() => structuredClone(() => {})),
  };

  for (const [label, make] of Object.entries(cases)) {
    it(`${label} passes Error.isError and util.types.isNativeError`, () => {
      const exception = make();
      expect(exception).toBeInstanceOf(DOMException);
      expect(Error.isError(exception)).toBe(true);
      expect(types.isNativeError(exception)).toBe(true);
    });
  }

  it("keeps the WebIDL shape: name, message and code come from the prototype", () => {
    const exception = new DOMException("m", "AbortError");
    expect([exception.name, exception.message, exception.code]).toEqual(["AbortError", "m", 20]);
    expect(Object.hasOwn(exception, "name")).toBe(false);
    expect(Object.hasOwn(exception, "message")).toBe(false);
    expect(Object.hasOwn(exception, "code")).toBe(false);
    expect(Object.keys(exception)).toEqual([]);
    expect(JSON.stringify(exception)).toBe("{}");
    expect(Object.prototype.toString.call(exception)).toBe("[object DOMException]");
    expect(Error.prototype.toString.call(exception)).toBe("AbortError: m");
    expect(Error.isError(DOMException.prototype)).toBe(false);
  });

  it("DOMExceptions thrown by Bun have no enumerable properties either", () => {
    const reason = AbortSignal.abort().reason;
    expect(Object.keys(reason)).toEqual([]);
    expect(JSON.stringify(reason)).toBe("{}");
    expect([reason.name, reason.code]).toEqual(["AbortError", 20]);
  });

  it("the prototype getters reject other Error instances", () => {
    for (const property of ["name", "message", "code"]) {
      const { get } = Object.getOwnPropertyDescriptor(DOMException.prototype, property);
      expect(() => get.call(new Error("not a DOMException"))).toThrow(TypeError);
      expect(() => get.call({})).toThrow(TypeError);
    }
  });

  it("has a stack that starts with name and message", () => {
    const exception = new DOMException("m", "AbortError");
    expect(Object.hasOwn(exception, "name")).toBe(false);
    expect(exception.stack).toStartWith("AbortError: m\n");
    expect(exception.stack).toContain(import.meta.path);

    const reason = AbortSignal.abort().reason;
    expect(reason.stack).toStartWith(`AbortError: ${reason.message}\n`);
    expect(reason.stack).toContain(import.meta.path);

    expect(new DOMException().stack).toStartWith("Error\n");
    expect(new DOMException("only a message").stack).toStartWith("Error: only a message\n");
  });

  it("survives structured cloning with its name, message, code and stack", () => {
    const original = new DOMException("m", "DataCloneError");
    const clone = structuredClone(original);
    expect(clone).toBeInstanceOf(DOMException);
    expect(clone).not.toBe(original);
    expect([clone.name, clone.message, clone.code]).toEqual(["DataCloneError", "m", 25]);
    expect(Object.hasOwn(clone, "message")).toBe(false);
    expect(Error.isError(clone)).toBe(true);
    // Like node (and a cloned Error), the clone keeps the original's stack instead of
    // getting one that points at the structuredClone() call.
    expect(clone.stack).toBe(original.stack);
    expect(clone.stack).toStartWith("DataCloneError: m\n");

    const arrived = structuredClone({ exception: new DOMException("m", "NotFoundError") }).exception;
    expect(arrived).toBeInstanceOf(DOMException);
    expect(arrived.code).toBe(8);
  });

  it("clones a DOMException whose stack was replaced or removed", () => {
    const replaced = new DOMException("m", "AbortError");
    replaced.stack = "custom stack";
    expect(structuredClone(replaced).stack).toBe("custom stack");

    const removed = new DOMException("m", "AbortError");
    delete removed.stack;
    const clone = structuredClone(removed);
    expect(clone.stack).toBeUndefined();
    expect([clone.name, clone.message, clone.code]).toEqual(["AbortError", "m", 20]);
  });

  it("subclasses get the subclass prototype and the DOMException internals", () => {
    class MyException extends DOMException {
      constructor() {
        super("m", "NotFoundError");
        this.extra = 1;
      }
    }
    const exception = new MyException();
    expect(exception).toBeInstanceOf(MyException);
    expect([exception.name, exception.message, exception.code, exception.extra]).toEqual(["NotFoundError", "m", 8, 1]);
    expect(Error.isError(exception)).toBe(true);
    expect(exception.stack).toStartWith("NotFoundError: m\n");

    const clone = structuredClone(exception);
    expect(clone).toBeInstanceOf(DOMException);
    expect([clone.name, clone.message, clone.code]).toEqual(["NotFoundError", "m", 8]);
  });

  it("Error.captureStackTrace works on it", () => {
    const exception = new DOMException("m", "TimeoutError");
    function capture() {
      Error.captureStackTrace(exception);
    }
    capture();
    expect(exception.stack).toStartWith("TimeoutError: m\n");
    expect(exception.stack).toContain("capture");
  });

  it("is formatted as an error, not as a plain object", () => {
    const exception = new DOMException("m", "AbortError");
    // Bun.inspect prints a source excerpt above the "name: message" line, like it does for any Error.
    expect(Bun.inspect(exception)).toContain("AbortError: m\n");
    expect(Bun.inspect(exception)).not.toContain("INDEX_SIZE_ERR");
    expect(inspect(exception)).toStartWith("DOMException [AbortError]: m\n");

    // A DOMException used as a cause used to be dropped from the output entirely.
    const outer = new Error("outer", { cause: new DOMException("inner", "TimeoutError") });
    expect(Bun.inspect(outer)).toContain("TimeoutError: inner");
  });

  it("compares by name and message in toEqual", () => {
    expect(new DOMException("m", "AbortError")).toEqual(new DOMException("m", "AbortError"));
    expect(new DOMException("m", "AbortError")).not.toEqual(new DOMException("m", "TimeoutError"));
    expect(new DOMException("m", "AbortError")).not.toEqual(new DOMException("other", "AbortError"));
    expect(new DOMException("m", "AbortError")).not.toEqual({});
  });
});
