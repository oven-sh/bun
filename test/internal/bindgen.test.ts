import { bindgen } from "bun:internal-for-testing";

it("bindgen add example", () => {
  // Simple cases
  expect(bindgen.add(5, 3)).toBe(8);
  expect(bindgen.add(-2, 7)).toBe(5);
  expect(bindgen.add(0, 0)).toBe(0);
  // https://tc39.es/ecma262/multipage/bigint-object.html#sec-tonumber
  // 2. If argument is either a Symbol or a BigInt, throw a TypeError exception.
  expect(() => bindgen.add(1n, 0)).toThrow("Conversion from 'BigInt' to 'number' is not allowed");
  expect(() => bindgen.add(Symbol("1"), 0)).toThrow("Cannot convert a symbol to a number");
  // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
  // 3. If argument is null or false, return +0.
  expect(bindgen.add(null, "32")).toBe(32);
  expect(bindgen.add(false, "32")).toBe(32);
  // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
  // 3. If argument is undefined, return NaN.
  // https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
  // 8. If x is NaN, +0, +∞, or −∞, then return +0.
  expect(bindgen.add(undefined, "32")).toBe(32);
  expect(bindgen.add(NaN, "32")).toBe(32);
  expect(bindgen.add(Infinity, "32")).toBe(32);
  expect(bindgen.add(-Infinity, "32")).toBe(32);
  // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
  // 5. If argument is true, return 1.
  expect(bindgen.add(true, "32")).toBe(33);
  // https://tc39.es/ecma262/multipage/bigint-object.html#sec-tonumber
  // 6. If argument is a String, return StringToNumber(argument).
  expect(bindgen.add("1", "1")).toBe(2);
  // 8. Let primValue be ? ToPrimitive(argument, number).
  // 10. Return ? ToNumber(primValue).
  expect(bindgen.add({ [Symbol.toPrimitive]: () => "1" }, "1")).toBe(2);

  expect(bindgen.add(2147483647.9, 0)).toBe(2147483647);
  expect(bindgen.add(2147483647.1, 0)).toBe(2147483647);

  // Out of range wrapping behaviors. By adding `0`, this acts as an identity function.
  // https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
  expect(bindgen.add(2147483648, 0)).toBe(-2147483648);
  expect(bindgen.add(5555555555, 0)).toBe(1260588259);
  expect(bindgen.add(-5555555555, 0)).toBe(-1260588259);
  expect(bindgen.add(55555555555, 0)).toBe(-279019293);
  expect(bindgen.add(-55555555555, 0)).toBe(279019293);
  expect(bindgen.add(555555555555, 0)).toBe(1504774371);
  expect(bindgen.add(-555555555555, 0)).toBe(-1504774371);
  expect(bindgen.add(5555555555555, 0)).toBe(-2132125469);
  expect(bindgen.add(-5555555555555, 0)).toBe(2132125469);

  // Test Zig error handling
  expect(() => bindgen.add(2147483647, 1)).toThrow("Integer overflow while adding");
});

it("optional arguments / default arguments", () => {
  expect(bindgen.requiredAndOptionalArg(false)).toBe(123498);
  expect(bindgen.requiredAndOptionalArg(false, 10)).toBe(52);
  expect(bindgen.requiredAndOptionalArg(true, 10)).toBe(-52);
  expect(bindgen.requiredAndOptionalArg(1, 10, 5)).toBe(-15);
  expect(bindgen.requiredAndOptionalArg("coerce to true", 10, 5)).toBe(-15);
  expect(bindgen.requiredAndOptionalArg("", 10, 5)).toBe(15);
  expect(bindgen.requiredAndOptionalArg(true, 10, 5, 2)).toBe(-30);
  expect(bindgen.requiredAndOptionalArg(true, null, 5, 2)).toBe(123463);
});

it("custom enforceRange boundaries", () => {
  expect(bindgen.requiredAndOptionalArg(false, 0, 5)).toBe(5);
  expect(() => bindgen.requiredAndOptionalArg(false, 0, -1)).toThrow("Value -1 is outside the range [0, 100]");
  expect(() => bindgen.requiredAndOptionalArg(false, 0, 101)).toThrow("Value 101 is outside the range [0, 100]");
  expect(bindgen.requiredAndOptionalArg(false, 0, 100)).toBe(100);
  expect(bindgen.requiredAndOptionalArg(false, 0, 0)).toBe(0);
});
