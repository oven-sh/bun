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

// https://github.com/oven-sh/bun/issues/32060
test.each(["DATA:", "Data:", "dAtA:"])("should import ES module with case-insensitive scheme %s", async scheme => {
  const code = `export const scheme = ${JSON.stringify(scheme)};`;
  const mod = await import(scheme + "text/javascript," + code);
  expect(mod.scheme).toBe(scheme);
});

test("should import ES module with uppercase scheme without folding the base64 payload", async () => {
  const code = `export default function test(arg) { return arg + arg; }`;
  const mod = await import("DATA:text/javascript;base64," + btoa(code)).then(mod => mod.default);
  expect(mod(1)).toEqual(2);
});

test("case variants of the same data URL resolve to the same module", async () => {
  const code = `export const identity = {};`;
  const lower = await import("data:text/javascript," + code);
  const upper = await import("DATA:text/javascript," + code);
  expect(upper).toBe(lower);
});
