import { expect, test } from "bun:test";
import { sep } from "path";

test("pathToFileURL throws RangeError for extremely long relative paths", () => {
  const longPath = Buffer.alloc(8192, "a").toString() + sep + Buffer.alloc(8192, "b").toString();
  expect(() => Bun.pathToFileURL(longPath)).toThrow(new RangeError("Path is too long"));
});

test.skipIf(process.platform === "win32")("pathToFileURL accepts long relative paths that normalize down", () => {
  // Raw path exceeds 4096 bytes but normalizes to just "a" after collapsing "../" segments
  const longPath = "a/" + Buffer.alloc(7500, "../a/").toString();
  const url = Bun.pathToFileURL(longPath);
  expect(url.pathname).toEndWith("/a/");
});
