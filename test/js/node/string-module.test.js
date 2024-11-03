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
