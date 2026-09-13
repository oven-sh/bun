import { describe, expect, test } from "bun:test";

// An error that is raised under a wasm frame (a trap, a SuspendError) has no JS expression of its own, so its message is
// the fixed text only, with no "(evaluating '<source text>')" suffix. That suffix would hold the text of the nearest JS
// frame, which is some caller. When the call into wasm is in tail position (`() => div0()` in a module), that caller is
// the line that asserts on the message, and `expect(() => div0()).toThrow("any text")` can never fail.

// (module
//   (import "m" "suspending" (func $suspending))
//   (func (export "div0") i32.const 1 i32.const 0 i32.div_s drop)
//   (func (export "unreachable") unreachable)
//   (func (export "callSuspending") call $suspending))
// prettier-ignore
const bytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x02, 0x10, 0x01, 0x01, 0x6d, 0x0a, 0x73, 0x75, 0x73, 0x70, 0x65, 0x6e, 0x64, 0x69, 0x6e, 0x67, 0x00, 0x00,
  0x03, 0x04, 0x03, 0x00, 0x00, 0x00,
  0x07, 0x27, 0x03,
  0x04, 0x64, 0x69, 0x76, 0x30, 0x00, 0x01,
  0x0b, 0x75, 0x6e, 0x72, 0x65, 0x61, 0x63, 0x68, 0x61, 0x62, 0x6c, 0x65, 0x00, 0x02,
  0x0e, 0x63, 0x61, 0x6c, 0x6c, 0x53, 0x75, 0x73, 0x70, 0x65, 0x6e, 0x64, 0x69, 0x6e, 0x67, 0x00, 0x03,
  0x0a, 0x13, 0x03,
  0x08, 0x00, 0x41, 0x01, 0x41, 0x00, 0x6d, 0x1a, 0x0b,
  0x03, 0x00, 0x00, 0x0b,
  0x04, 0x00, 0x10, 0x00, 0x0b,
]);
const hasJSPI = typeof (WebAssembly as any).Suspending === "function";
const suspending = hasJSPI ? new (WebAssembly as any).Suspending(async () => {}) : () => {};
const { div0, unreachable, callSuspending } = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
  m: { suspending },
}).exports as Record<string, () => void>;

function thrownBy(fn: () => void): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("did not throw");
}

describe("the message of an error raised under a wasm frame has no source text of a JS caller", () => {
  test("trap", () => {
    // The call in tail position leaves no frame: the nearest JS expression is the `fn()` in thrownBy.
    const tailCall = thrownBy(() => div0());
    expect(tailCall).toBeInstanceOf(WebAssembly.RuntimeError);
    expect(tailCall.message).toBe("Division by zero");
    // prettier-ignore
    expect(thrownBy(() => { div0(); }).message).toBe("Division by zero");
    expect(thrownBy(div0).message).toBe("Division by zero");
    expect(thrownBy(() => unreachable()).message).toBe("Unreachable code should not be executed");
  });

  test.skipIf(!hasJSPI)("SuspendError", () => {
    const error = thrownBy(() => callSuspending());
    expect(error).toBeInstanceOf((WebAssembly as any).SuspendError);
    expect(error.message).toBe("Suspending() wrapper called outside of a promising() context");
  });

  test("toThrow does not match the text of its own call", () => {
    expect(() => div0()).toThrow("Division by zero");
    expect(() => div0()).not.toThrow("nope");
    expect(() => div0()).toThrow(new WebAssembly.RuntimeError("Division by zero"));
  });
});
