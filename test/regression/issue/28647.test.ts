import { test, expect } from "bun:test";

// https://github.com/oven-sh/bun/issues/28647
// assert.deepStrictEqual incorrectly fails for Proxy-wrapped arrays/objects

test("Bun.deepEquals strict mode works with Proxy-wrapped arrays", () => {
  const proxy = new Proxy(["foo"], {});
  expect(Bun.deepEquals(proxy, ["foo"], true)).toBe(true);
  expect(Bun.deepEquals(["foo"], proxy, true)).toBe(true);
});

test("Bun.deepEquals strict mode works with Proxy-wrapped objects", () => {
  const proxy = new Proxy({ a: 1 }, {});
  expect(Bun.deepEquals(proxy, { a: 1 }, true)).toBe(true);
  expect(Bun.deepEquals({ a: 1 }, proxy, true)).toBe(true);
});

test("Bun.deepEquals strict mode works with both sides being proxies", () => {
  const proxy1 = new Proxy(["foo", "bar"], {});
  const proxy2 = new Proxy(["foo", "bar"], {});
  expect(Bun.deepEquals(proxy1, proxy2, true)).toBe(true);

  const proxyObj1 = new Proxy({ x: 1 }, {});
  const proxyObj2 = new Proxy({ x: 1 }, {});
  expect(Bun.deepEquals(proxyObj1, proxyObj2, true)).toBe(true);
});

test("Bun.deepEquals strict mode detects differences through proxies", () => {
  // Different array contents
  expect(Bun.deepEquals(new Proxy(["foo"], {}), ["bar"], true)).toBe(false);
  // Different array lengths
  expect(Bun.deepEquals(new Proxy(["foo", "bar"], {}), ["foo"], true)).toBe(false);
  // Different object values
  expect(Bun.deepEquals(new Proxy({ a: 1 }, {}), { a: 2 }, true)).toBe(false);
  // Different object keys
  expect(Bun.deepEquals(new Proxy({ a: 1 }, {}), { b: 1 }, true)).toBe(false);
  // Array vs non-array
  expect(Bun.deepEquals(new Proxy(["foo"], {}), { 0: "foo" }, true)).toBe(false);
});

test("Bun.deepEquals non-strict mode still works with proxies", () => {
  expect(Bun.deepEquals(new Proxy(["foo"], {}), ["foo"], false)).toBe(true);
  expect(Bun.deepEquals(new Proxy({ a: 1 }, {}), { a: 1 }, false)).toBe(true);
});

test("assert.deepStrictEqual works with Proxy-wrapped arrays", () => {
  const assert = require("assert");
  assert.deepStrictEqual(new Proxy(["foo"], {}), ["foo"]);
});

test("assert.deepStrictEqual works with Proxy-wrapped objects", () => {
  const assert = require("assert");
  assert.deepStrictEqual(new Proxy({ a: 1 }, {}), { a: 1 });
});

test("Proxy with trapping handler is compared correctly", () => {
  const handler = {
    get(target: any, prop: string | symbol, receiver: any) {
      return Reflect.get(target, prop, receiver);
    },
  };
  const proxy = new Proxy([1, 2, 3], handler);
  expect(Bun.deepEquals(proxy, [1, 2, 3], true)).toBe(true);

  const proxyObj = new Proxy({ key: "value" }, handler);
  expect(Bun.deepEquals(proxyObj, { key: "value" }, true)).toBe(true);
});

test("Proxy-wrapped nested structures compare correctly", () => {
  const nested = { arr: [1, 2], obj: { x: "y" } };
  const proxy = new Proxy(nested, {});
  expect(Bun.deepEquals(proxy, { arr: [1, 2], obj: { x: "y" } }, true)).toBe(true);
});

test("expect().toStrictEqual works with Proxy-wrapped values", () => {
  expect(new Proxy(["foo"], {})).toStrictEqual(["foo"]);
  expect(new Proxy({ a: 1 }, {})).toStrictEqual({ a: 1 });
});
