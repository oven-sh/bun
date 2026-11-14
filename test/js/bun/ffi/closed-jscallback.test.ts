import { JSCallback, dlopen } from "bun:ffi";
import { expect, test } from "bun:test";
import { isGlibc } from "harness";

test.skipIf(!isGlibc)("a closed JSCallback is not handed to native code", () => {
  const { symbols, close } = dlopen("libc.so.6", {
    qsort: { args: ["ptr", "usize", "usize", "function"], returns: "void" },
  });
  try {
    const compare = new JSCallback(() => 0, { returns: "int", args: ["ptr", "ptr"] });
    const bytes = new Uint8Array(16);
    symbols.qsort(bytes, 0, 4, compare);
    compare.close();
    expect(() => symbols.qsort(bytes, 0, 4, compare)).toThrow(TypeError);
  } finally {
    close();
  }
});
