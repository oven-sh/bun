import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bun.write with a non-BlobPart value falls through Blob.fromJSWithoutDeferGC's
// default branch to JSValue.toSlice -> String.fromJS -> BunString__fromJS ->
// Bun::fromJS -> toWTFString. Fuzzilli repeatedly (cb01d84a, 16d4efee,
// 4d4492f1, eac903bf, + a fifth) tripped the debug assertion `Dead =>
// has_exception` in String.fromJS when toWTFString returned a null WTF::String
// while vm.exception() was null, under sustained REPRL eval + forced GC.
//
// Bun::fromJS / Bun::toStringRef now decide Dead vs Empty by reading
// vm.exceptionForInspection() (the accessor documented for inspecting pending
// exceptions without disturbing Throw/CatchScopes) when toWTFString yields
// null: Dead only when a real exception is pending, else Empty. That edge
// state is not reproducible from JavaScript (every null-return site in JSC's
// toWTFString throws first), so these tests pin the observable stringification
// behavior the fix must preserve.
describe("Bun.write stringifies non-BlobPart values via Bun::fromJS", () => {
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
