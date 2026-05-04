import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bun.write with a non-BlobPart value falls through Blob.fromJSWithoutDeferGC's
// default branch to JSValue.toSlice -> String.fromJS -> BunString__fromJS ->
// toWTFString. Fuzzilli repeatedly (cb01d84a, 16d4efee, 4d4492f1, eac903bf)
// observed the debug assertion `Dead => has_exception` failing here under
// sustained REPRL eval + forced GC. Bun::fromJS now uses RETURN_IF_EXCEPTION
// so Dead is returned iff an exception is pending. These tests pin the happy
// path and the exception-propagation path; the fuzzer-only null-without-
// exception state cannot be reproduced from JavaScript.
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
