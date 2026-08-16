import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { realpathSync } from "node:fs";

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

// The transpiler drops these comment lines (and reformats what follows), so the positions
// JSC reports for the code below them are not the positions in the file. Positions Bun
// records on a DOMException it creates have to go through the source map like an Error's.
const padded = source => Array.from({ length: 10 }, (_, i) => `// padding ${i + 1}`).join("\n") + "\n" + source + "\n";

// 1-based line of the (unique) line of `source` containing `needle`.
function lineContaining(source, needle) {
  const matches = source.split("\n").flatMap((line, i) => (line.includes(needle) ? [i + 1] : []));
  expect(matches).toHaveLength(1);
  return matches[0];
}

async function runFixture(name, source) {
  using dir = tempDir("domexception-creation-site", { [name]: source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), name],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  let [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  for (const path of new Set([realpathSync.native(String(dir)), String(dir)])) {
    stderr = stderr.replaceAll(path, "<dir>");
  }
  return { stdout, stderr: stderr.replaceAll("\\", "/"), exitCode };
}

describe.concurrent("DOMExceptions created by Bun record where they were created", () => {
  it("line, column, sourceURL and stack are positions in the source file, like an Error's", async () => {
    // The callbacks passed to caught() have block bodies so that the call inside them is
    // not a tail call, which strict mode code would otherwise drop from the stack.
    const source = padded(`
      function caught(fn) { try { fn(); } catch (e) { return e; } }
      function nested() {
        const error = new Error("reference"), reason = AbortSignal.abort().reason;
        return { error, reason };
      }
      const controller = new AbortController();
      controller.abort();
      const fromNested = nested();
      const rejectionOf = promise => promise.then(() => { throw new Error("expected a rejection"); }, e => e);
      const exceptions = {
        "AbortSignal.abort().reason": AbortSignal.abort().reason,
        "AbortController#abort() reason": controller.signal.reason,
        "atob() InvalidCharacterError": caught(() => { atob("!"); }),
        "structuredClone() DataCloneError": caught(() => { structuredClone(() => {}); }),
        "crypto.subtle.importKey() rejection": await rejectionOf(crypto.subtle.importKey("raw", new Uint8Array(3), "AES-GCM", false, ["encrypt"])),
        "created inside a function": fromNested.reason,
      };
      const dump = e => ({
        isDOMException: e instanceof DOMException,
        name: e.name,
        message: e.message,
        line: e.line,
        column: e.column,
        sourceURL: e.sourceURL?.replaceAll(import.meta.path, "<file>"),
        stack: e.stack?.replaceAll(import.meta.path, "<file>"),
        enumerableKeys: Object.keys(e),
      });
      for (const name in exceptions) exceptions[name] = dump(exceptions[name]);
      console.log(JSON.stringify({ exceptions, reference: dump(fromNested.error) }));
    `);
    const { stdout, stderr, exitCode } = await runFixture("creation-site.js", source);
    expect(stderr).toBe("");
    const { exceptions, reference } = JSON.parse(stdout);

    // [line, column] of each frame of `stack` that is in the fixture file.
    const framePositions = stack =>
      stack
        .split("\n")
        .slice(1)
        .filter(frame => frame.includes("<file>"))
        .map(frame =>
          frame
            .match(/:(\d+):(\d+)\)?$/)
            .slice(1)
            .map(Number),
        );
    const summarize = ({ stack, line, column, ...rest }) => ({
      ...rest,
      header: stack.split("\n")[0],
      line,
      topFrameIsAtLineAndColumn: Bun.deepEquals(framePositions(stack)[0], [line, column]),
      frameLines: framePositions(stack).map(([line]) => line),
    });
    const expected = (name, message, frameLines) => ({
      isDOMException: true,
      name,
      message,
      header: `${name}: ${message}`,
      line: frameLines[0],
      sourceURL: "<file>",
      topFrameIsAtLineAndColumn: true,
      frameLines,
      enumerableKeys: [],
    });

    const nestedLine = lineContaining(source, 'new Error("reference")');
    const nestedCallLine = lineContaining(source, "= nested()");
    const caughtLine = lineContaining(source, "function caught");
    const atobLine = lineContaining(source, 'atob("!")');
    const structuredCloneLine = lineContaining(source, "structuredClone(");
    expect(Object.fromEntries(Object.entries(exceptions).map(([name, e]) => [name, summarize(e)]))).toEqual({
      // AbortSignal.abort() stores the default reason as an enum; the DOMException is
      // created when .reason is first read, which here is this line.
      "AbortSignal.abort().reason": expected("AbortError", "The operation was aborted.", [
        lineContaining(source, '"AbortSignal.abort().reason":'),
      ]),
      // AbortController#abort() creates the reason while aborting.
      "AbortController#abort() reason": expected("AbortError", "The operation was aborted.", [
        lineContaining(source, "controller.abort();"),
      ]),
      "atob() InvalidCharacterError": expected("InvalidCharacterError", "The string contains invalid characters.", [
        atobLine,
        caughtLine,
        atobLine,
      ]),
      "structuredClone() DataCloneError": expected("DataCloneError", "The object can not be cloned.", [
        structuredCloneLine,
        caughtLine,
        structuredCloneLine,
      ]),
      // Rejections are created while the API is being called, so they point at the call too.
      "crypto.subtle.importKey() rejection": expected(
        "DataError",
        "Data provided to an operation does not meet requirements",
        [lineContaining(source, '"crypto.subtle.importKey() rejection":')],
      ),
      "created inside a function": expected("AbortError", "The operation was aborted.", [nestedLine, nestedCallLine]),
    });
    // The Error created on the same line as the nested DOMException reports the same frames.
    expect({
      sourceURL: reference.sourceURL,
      frameLines: framePositions(reference.stack).map(([line]) => line),
    }).toEqual({ sourceURL: "<file>", frameLines: [nestedLine, nestedCallLine] });
    expect(exitCode).toBe(0);
  });

  // ML key imports reject through SubtleCrypto's rejectWithCause(), which builds the cause
  // and then the DOMException, while the import call is still on the stack. The reference
  // Error is created on the same line as the call.
  it("a rejection that carries a cause is recorded at the call site too", async () => {
    // prettier-ignore
    const reference = new Error("reference"), pending = crypto.subtle.importKey("pkcs8", new Uint8Array(64), "ML-DSA-44", false, ["sign"]);
    const rejection = await pending.then(
      () => null,
      e => e,
    );

    expect({
      isDOMException: rejection instanceof DOMException,
      causeIsError: rejection?.cause instanceof Error,
      header: rejection?.stack.split("\n")[0],
      line: rejection?.line,
      sourceURL: rejection?.sourceURL,
    }).toEqual({
      isDOMException: true,
      causeIsError: true,
      header: "DataError: Invalid keyData",
      line: reference.line,
      sourceURL: reference.sourceURL,
    });
  });

  it("a DOMException created with no JavaScript on the stack gets a header-only stack", async () => {
    const signal = AbortSignal.timeout(0);
    const { promise, resolve } = Promise.withResolvers();
    signal.addEventListener("abort", resolve, { once: true });
    await promise;

    const { reason } = signal;
    expect({ stack: reason.stack, line: reason.line, column: reason.column, sourceURL: reason.sourceURL }).toEqual({
      stack: "TimeoutError: The operation timed out.",
      line: undefined,
      column: undefined,
      sourceURL: undefined,
    });
  });

  it.each([
    ["unhandled rejection", `Promise.reject(AbortSignal.abort().reason);`, "Promise.reject("],
    ["uncaught exception", `function fail() {\n  atob("!");\n}\nfail();`, 'atob("!")'],
  ])("the %s printer reports the source line the DOMException was created on", async (_, body, needle) => {
    const source = padded(body);
    const expectedLine = lineContaining(source, needle);
    const { stdout, stderr, exitCode } = await runFixture("uncaught.js", source);

    const stackLines = stderr
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("at "));
    expect({ stdout, stackLines }).toEqual({
      stdout: "",
      stackLines: [expect.stringMatching(new RegExp(`^at <dir>/uncaught\\.js:${expectedLine}:\\d+$`))],
    });
    // The code excerpt above the error is taken from the source file at that line.
    expect(stderr).toContain(`${expectedLine} | ${source.split("\n")[expectedLine - 1]}`);
    expect(exitCode).toBe(1);
  });
});
