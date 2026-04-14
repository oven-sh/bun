import { test, expect } from "bun:test";

test("Bun.inspect with throwing getter in Proxy prototype does not crash", () => {
  const proto = {
    get a() {
      throw new Error("boom");
    },
    b: 1,
  };
  const obj = Object.create(new Proxy(proto, {}));
  expect(Bun.inspect(obj)).toBeString();
});

test("Bun.inspect with throwing getPrototypeOf trap does not crash", () => {
  const obj = {};
  const proto = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("nope");
      },
    },
  );
  Object.setPrototypeOf(obj, proto);
  expect(Bun.inspect(obj)).toBeString();
});

test("Bun.inspect nested object with throwing Proxy prototype does not crash", () => {
  const proto = {
    get a() {
      throw new Error("boom");
    },
  };
  const inner = Object.create(new Proxy(proto, {}));
  expect(Bun.inspect({ x: inner, y: inner })).toBeString();
});
