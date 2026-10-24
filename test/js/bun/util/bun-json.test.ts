import { expect, test } from "bun:test";

test("Bun.JSON is an object of its own whose parse throws", async () => {
  expect(Bun.JSON).not.toBe(JSON);
  expect((await import("bun")).JSON).toBe(Bun.JSON);
  expect(require("bun").JSON).toBe(Bun.JSON);
  expect(Object.getOwnPropertyDescriptor(Bun, "JSON")).toEqual({
    value: Bun.JSON,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  expect(Object.getPrototypeOf(Bun.JSON)).toBe(Object.prototype);
  expect(String(Bun.JSON)).toBe("[object JSON]");
  expect(Object.keys(Bun.JSON)).toEqual([]);

  const { parse } = Bun.JSON as { parse(text: string): unknown };
  expect(parse).not.toBe(JSON.parse);
  expect(() => parse("1")).toThrow(TypeError);
  expect(() => parse("1")).toThrow(`JSON.parse() from "bun" has no type to validate against here`);
  expect(Object.getOwnPropertyDescriptor(Bun.JSON, "parse")).toEqual({
    value: parse,
    writable: false,
    enumerable: false,
    configurable: false,
  });
});

test("the other members of Bun.JSON are the global's", () => {
  for (const name of ["stringify", "rawJSON", "isRawJSON"] as const) {
    expect((Bun.JSON as any)[name]).toBe((JSON as any)[name]);
  }
  expect(Bun.JSON.stringify({ a: [1] })).toBe('{"a":[1]}');
});
