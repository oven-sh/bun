import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

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

function thrownBy(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the callback to throw");
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected the promise to reject");
}

async function timeoutReason() {
  const signal = AbortSignal.timeout(0);
  const { promise, resolve } = Promise.withResolvers();
  signal.addEventListener("abort", resolve, { once: true });
  await promise;
  return signal.reason;
}

// As in Node, no DOMException has own enumerable properties. The creation site Bun
// records on internally created ones (line/column/sourceURL/stack) is non-enumerable.
describe("DOMException own properties", () => {
  it.each([
    ["new DOMException()", "AbortError", () => new DOMException("The operation was aborted.", "AbortError")],
    ["structuredClone(domException)", "AbortError", () => structuredClone(new DOMException("cloned", "AbortError"))],
    ["AbortSignal.abort().reason", "AbortError", () => AbortSignal.abort().reason],
    [
      "AbortController#abort() reason",
      "AbortError",
      () => {
        const controller = new AbortController();
        controller.abort();
        return controller.signal.reason;
      },
    ],
    ["AbortSignal.timeout() reason", "TimeoutError", timeoutReason],
    ["structuredClone() DataCloneError", "DataCloneError", () => thrownBy(() => structuredClone(() => {}))],
    ["atob() InvalidCharacterError", "InvalidCharacterError", () => thrownBy(() => atob("!"))],
    [
      "crypto.subtle rejection",
      "DataError",
      () => rejectionOf(crypto.subtle.importKey("raw", new Uint8Array(3), { name: "AES-GCM" }, false, ["encrypt"])),
    ],
  ])("%s has no own enumerable properties", async (_, name, create) => {
    const exception = await create();
    expect(exception).toBeInstanceOf(DOMException);
    expect(exception.name).toBe(name);

    expect({
      keys: Object.keys(exception),
      json: JSON.stringify(exception),
      spread: { ...exception },
    }).toEqual({ keys: [], json: "{}", spread: {} });
  });

  it("internally created DOMExceptions from different call sites are deep equal", () => {
    const first = AbortSignal.abort().reason;
    const second = AbortSignal.abort().reason;
    const constructed = new DOMException(first.message, first.name);

    expect(isDeepStrictEqual(first, second)).toBe(true);
    expect(isDeepStrictEqual(first, constructed)).toBe(true);
    expect(first).toEqual(second);
    expect(first).toEqual(constructed);
  });

  it("the uncaught error printer still reports where an internally created DOMException came from", async () => {
    using dir = tempDir("domexception-uncaught", {
      "reject.js": "Promise.reject(AbortSignal.abort().reason);\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "reject.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The location comes from the sourceURL JSC recorded, which spells the
    // drive letter in lowercase on Windows.
    const normalizeCase = line => (isWindows ? line.toLowerCase() : line);
    const locations = stderr
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("at "))
      .map(normalizeCase);
    expect({ stdout, locations, exitCode }).toEqual({
      stdout: "",
      locations: [normalizeCase(`at ${join(String(dir), "reject.js")}:1`)],
      exitCode: 1,
    });
  });
});
