import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import assert from "node:assert";
import url from "node:url";

describe("url.parse", () => {
  test("rejects a non-string url", () => {
    // https://github.com/joyent/node/issues/568
    [
      [undefined, "undefined"],
      [null, "null"],
      [true, "type boolean (true)"],
      [false, "type boolean (false)"],
      [0.0, "type number (0)"],
      [0, "type number (0)"],
      [[], "an instance of Array"],
      [{}, "an instance of Object"],
      [() => {}, "function "],
      [Symbol("foo"), "type symbol (Symbol(foo))"],
    ].forEach(([val, received]) => {
      assert.throws(() => url.parse(val), {
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: `The "url" argument must be of type string. Received ${received}`,
      });
    });
  });

  test("surfaces the JS engine's URIError for a malformed escape", () => {
    assert.throws(
      () => url.parse("http://%E0%A4%A@fail"),
      // The error comes from the JS engine, not from us, so it has no `code`.
      e => e instanceof URIError && e.code === undefined,
    );
  });

  test("rejects a forbidden character in an IPv6 host", () => {
    assert.throws(() => url.parse("http://[127.0.0.1\x00c8763]:8000/"), {
      code: "ERR_INVALID_URL",
      input: "http://[127.0.0.1\x00c8763]:8000/",
    });
  });

  test("rejects a hostname that IDNA maps to a forbidden character", () => {
    /*
     * A slice of the code points whose NFKD contains one of `#%/:?@[\]^|`.
     * test/js/node/test/parallel/test-url-parse-invalid-input.js sweeps the
     * whole range, which is far too slow to repeat under the test runner.
     */
    for (const badCodePoint of ["\u2100", "\uFF20", "\uFF1A", "\uFF0F", "\uFF03", "\uFF1F"]) {
      const badURL = `http://fail${badCodePoint}fail.com/`;
      assert.throws(
        () => url.parse(badURL),
        e => e.code === "ERR_INVALID_URL",
        `parsing ${badURL}`,
      );
    }

    // A hostname that IDNA maps to nothing at all.
    assert.throws(
      () => url.parse("http://\u00AD/bad.com/"),
      e => e.code === "ERR_INVALID_URL",
      "parsing http://\u00AD/bad.com/",
    );
  });

  test("rejects an invalid port", () => {
    for (const badURL of ["https://evil.com:.example.com", "git+ssh://git@github.com:npm/npm"]) {
      assert.throws(() => url.parse(badURL), { code: "ERR_INVALID_ARG_VALUE" });
    }
  });

  test("an invalid port is fatal to a script that does not catch it", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `url.parse("https://evil.com:.example.com")`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("ERR_INVALID_ARG_VALUE");
    expect(exitCode).toBe(1);
  });
});
