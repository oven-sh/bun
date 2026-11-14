// The functions of node:path take as many operands as a call can carry, as in node: the count is not cut to sixteen bits.
import { expect, test } from "bun:test";
import path from "node:path";

test.each([65535, 65536, 65537, 70000])("join() and resolve() of %d operands", count => {
  const names = new Array<string>(count).fill("a");
  for (const [flavor, separator] of [
    [path.posix, "/"],
    [path.win32, "\\"],
  ] as const) {
    expect(flavor.join(...names)).toBe(names.join(separator));
    expect(flavor.join(...new Array<string>(count).fill(".."), "a")).toBe("..".concat(separator).repeat(count) + "a");
    expect(flavor.resolve(separator, ...names)).toEndWith(separator + names.join(separator));
  }
});
