import { expect, test } from "bun:test";

test("should import and execute ES module from string", async () => {
  const code = `export default function test(arg) { return arg + arg };`;
  const mod = await import("data:text/javascript," + code).then(mod => mod.default);
  const result = mod(1);
  expect(result).toEqual(2);
});

test("should import and execute ES module from string (base64)", async () => {
  const code = `export default function test(arg) { return arg + arg; }`;
  const mod = await import("data:text/javascript;base64," + btoa(code)).then(mod => mod.default);
  const result = mod(1);
  expect(result).toEqual(2);
});

test("should throw when importing malformed string (base64)", async () => {
  expect(() => import("data:text/javascript;base64,asdasdasd")).toThrowError("Base64DecodeError");
});

// data: URLs carry the module source inline and never touch the filesystem,
// so no path-length limit applies. 200000 exceeds the largest platform cap
// (Windows, ~147 KB); the smallest (macOS) is ~1.5 KB.
test("should import a data: URL longer than the path-length limit", async () => {
  const big = Buffer.alloc(200000, "x").toString();
  const url = "data:text/javascript," + encodeURIComponent(`export default "${big}";`);
  const mod = await import(url);
  expect(mod.default).toBe(big);
});

test("should import a base64 data: URL longer than the path-length limit", async () => {
  const big = Buffer.alloc(200000, "y").toString();
  const url = "data:text/javascript;base64," + btoa(`export default "${big}";`);
  const mod = await import(url);
  expect(mod.default).toBe(big);
});

test("should keep '?' as part of the data in a data: URL", async () => {
  const mod = await import(`data:text/javascript,export default "a?b=c";`);
  expect(mod.default).toBe("a?b=c");
});
