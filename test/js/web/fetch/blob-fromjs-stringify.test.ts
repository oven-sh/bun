import { BunString_fromJSNullNoException } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bun.write with a non-BlobPart value falls through Blob.fromJSWithoutDeferGC's
// default branch to JSValue.toSlice -> String.fromJS -> BunString__fromJS ->
// toWTFString. Fuzzilli repeatedly (cb01d84a, 16d4efee, 4d4492f1, eac903bf)
// observed the debug assertion `Dead => has_exception` failing here under
// sustained REPRL eval + forced GC: toWTFString returned a null WTF::String
// while vm.exception() was null. Bun::fromJS now uses RETURN_IF_EXCEPTION so
// Dead is returned iff an exception is pending; a null-without-exception
// string falls through isEmpty() to Empty instead.
describe("Bun.write stringifies non-BlobPart values via Bun::fromJS", () => {
  // The fuzzer-observed state cannot be produced from JavaScript (every
  // null-return path in JSC's toWTFString throws first). Synthesize it via a
  // native hook that nulls a JSString's m_fiber so toWTFString's isString()
  // fast path returns null without entering any throw scope, then call the
  // real BunString__fromJS on it. Before the fix this returned Dead with no
  // pending exception — exactly what fires debugAssert(has_exception) in
  // String.fromJS and propagates a phantom error.JSError. After the fix the
  // null string is treated as Empty and ok=true.
  test("BunString__fromJS does not return Dead without a pending exception", () => {
    const { ok, dead, hasException } = BunString_fromJSNullNoException();
    // The invariant String.fromJS relies on: !ok implies hasException.
    // Equivalently: never (dead && !hasException).
    expect({ dead, hasException }).not.toEqual({ dead: true, hasException: false });
    expect(ok).toBe(true);
  });

  test.each([
    ["native constructor", ArrayBuffer],
    ["typed-array constructor", Float64Array],
    ["host function", Bun.gc],
    ["plain function", function foo() {}],
    ["plain object", { a: 1 }],
  ] as const)("%s", async (_, value) => {
    using dir = tempDir("blob-fromjs-stringify", {});
    const p = join(dir, "out.txt");
    Bun.gc(true);
    const n = await Bun.write(p, value as any);
    const expected = String(value);
    expect(n).toBe(expected.length);
    expect(readFileSync(p, "utf8")).toBe(expected);
  });

  test("propagates exception thrown from toString()", () => {
    using dir = tempDir("blob-fromjs-stringify", {});
    const err = new TypeError("boom");
    const value = {
      toString() {
        throw err;
      },
    };
    expect(() => Bun.write(join(dir, "throws.txt"), value as any)).toThrow(err);
  });

  test("empty result from toString()", async () => {
    using dir = tempDir("blob-fromjs-stringify", {});
    const p = join(dir, "empty.txt");
    const n = await Bun.write(p, { toString: () => "" } as any);
    expect(n).toBe(0);
    expect(readFileSync(p, "utf8")).toBe("");
  });
});
