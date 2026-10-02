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

test("should import an uppercase-scheme data: URL longer than the path-length limit", async () => {
  const big = Buffer.alloc(200000, "z").toString();
  const url = "DATA:text/javascript," + encodeURIComponent(`export default "${big}";`);
  const mod = await import(url);
  expect(mod.default).toBe(big);
});

test("should keep '?' as part of the data in an uppercase-scheme data: URL", async () => {
  const mod = await import(`DATA:text/javascript,export default "a?b=c";`);
  expect(mod.default).toBe("a?b=c");
});

test("should start a Worker from an uppercase-scheme data: URL longer than the path-length limit", async () => {
  const pad = "//" + Buffer.alloc(200000, "x").toString();
  const worker = new Worker("DATA:text/javascript," + encodeURIComponent("postMessage('upper')" + pad));
  const { promise, resolve, reject } = Promise.withResolvers();
  worker.onmessage = e => resolve(e.data);
  worker.onerror = e => reject(new Error(e.message));
  try {
    expect(await promise).toBe("upper");
  } finally {
    worker.terminate();
  }
});
