import { BunString_fromJSNullNoException } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bun.write with a non-BlobPart value falls through Blob.fromJSWithoutDeferGC's
// default branch to JSValue.toSlice -> String.fromJS -> BunString__fromJS ->
// Bun::toStringRef -> toWTFString. Fuzzilli repeatedly (cb01d84a, 16d4efee,
// 4d4492f1, eac903bf, + a fifth) tripped the debug assertion `Dead =>
// has_exception` in String.fromJS when toWTFString returned a null WTF::String
// while vm.exception() was null, under sustained REPRL eval + forced GC.
//
// Bun::toStringRef now decides Dead vs Empty by reading
// vm.exceptionForInspection() (the accessor documented for inspecting pending
// exceptions without disturbing Throw/CatchScopes) when toWTFString yields
// null: Dead only when a real exception is pending, else Empty.
describe("Bun::toStringRef null-string handling", () => {
  // The fuzzer state is not reproducible from JavaScript (every null-return
  // site in JSC's toWTFString throws first), so the native hook fabricates it
  // and calls the real BunString__fromJS. Before the fix this returned Dead
  // with no pending exception, which is exactly what fires
  // debugAssert(has_exception) in String.fromJS.
  test("null WTF::String with no pending exception maps to Empty, not Dead", () => {
    const { ok, dead, hasException } = BunString_fromJSNullNoException();
    expect({ dead, hasException }).not.toEqual({ dead: true, hasException: false });
    expect(ok).toBe(true);
  });
});

describe("Bun.write stringifies non-BlobPart values via Bun::toStringRef", () => {
  test.each([
    ["native constructor", ArrayBuffer],
    ["typed-array constructor", Float64Array],
    ["host function", Bun.gc],
    ["plain function", function foo() {}],
    ["plain object", { a: 1 }],
    ["non-ASCII toString()", { toString: () => "café 🍰" }],
  ] as const)("%s", async (_, value) => {
    using dir = tempDir("blob-fromjs-stringify", {});
    const p = join(dir, "out.txt");
    Bun.gc(true);
    const n = await Bun.write(p, value as any);
    const expected = String(value);
    expect(n).toBe(Buffer.byteLength(expected, "utf8"));
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
