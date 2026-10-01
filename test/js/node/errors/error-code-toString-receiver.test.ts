import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { readFileSync } from "node:fs";

// Errors with a Node `code` get their prototype, including `toString`, from the native
// error table (src/jsc/bindings/ErrorCode.cpp).
function nodeError(): Error & { code: string } {
  try {
    // @ts-expect-error the missing argument is the point
    readFileSync();
  } catch (e) {
    return e as Error & { code: string };
  }
  throw new Error("readFileSync() did not throw");
}

describe("node error toString()", () => {
  test("formats name, code and message", () => {
    const err = nodeError();
    expect({ code: err.code, string: err.toString() }).toEqual({
      code: "ERR_INVALID_ARG_TYPE",
      string: `TypeError [ERR_INVALID_ARG_TYPE]: ${err.message}`,
    });
  });

  // A call resolved through a binding that a closure captures is compiled with the scope
  // object itself in the this slot; native functions see it raw. toString() used to read
  // name/code/message off that scope object and return "undefined [undefined]: undefined".
  // Node's toString is strict-mode JS, so it throws on the undefined receiver instead.
  test("called without a receiver through a captured binding throws like Node", () => {
    const { toString } = nodeError();
    function keep() {
      return toString;
    }
    expect(() => toString()).toThrow(TypeError);
    expect(keep()).toBe(toString);
  });

  // Reading a binding that is still in its temporal dead zone through the scope object yields
  // an empty value rather than a TDZ error, and toString() crashed the process (SIGSEGV at
  // address 0x5) when it tried to stringify it.
  test("called through a scope whose `name` binding is in its TDZ does not crash", async () => {
    const src = `
      let toString;
      try {
        require("node:fs").readFileSync();
      } catch (e) {
        ({ toString } = e);
      }
      let result;
      try {
        result = toString();
      } catch (e) {
        result = e.constructor.name;
      }
      console.log(result);
      let name = "initialized only after the call above";
      function keep() {
        return [toString, name];
      }
      keep();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "TypeError\n", stderr: "", exitCode: 0 });
  });
});
