import { expect, test } from "bun:test";

test("Bun.plugin does not crash when target has Symbol.toPrimitive returning an object", () => {
  const obj = { setup() {} };
  Object.defineProperty(obj, "target", {
    get() {
      return {
        [Symbol.toPrimitive]() {
          return {};
        },
      };
    },
  });
  expect(() => Bun.plugin(obj)).toThrow("toPrimitive");
});
