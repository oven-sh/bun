import { describe, expect, it } from "bun:test";

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

  // TODO: missing stack trace on DOMException
  it.failing("inherits prototype properties from Error", () => {
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
