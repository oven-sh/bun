import { expect, test } from "bun:test";

test("expect().toEqual() diff with WeakMap that has a user-set size property does not crash", () => {
  const wm = new WeakMap();
  // @ts-expect-error
  wm.size = 1000;
  expect(() => expect(wm).toEqual({})).toThrow();
  expect(() => expect(wm).toEqual(new Number())).toThrow();
});

test("expect().toEqual() diff with WeakSet that has a user-set size property does not crash", () => {
  const ws = new WeakSet();
  // @ts-expect-error
  ws.size = 1000;
  expect(() => expect(ws).toEqual({})).toThrow();
  expect(() => expect(ws).toEqual(new Number())).toThrow();
});

test("expect().toEqual() diff with Map whose size getter throws does not crash", () => {
  const m = new Map();
  Object.defineProperty(m, "size", {
    get() {
      throw new TypeError("bad");
    },
  });
  expect(() => expect(m).toEqual({})).toThrow();
});

test("Bun.inspect() of WeakMap/WeakSet with user-set size property does not throw", () => {
  const wm = new WeakMap();
  // @ts-expect-error
  wm.size = 1000;
  expect(Bun.inspect(wm)).toBe("WeakMap {}");

  const ws = new WeakSet();
  // @ts-expect-error
  ws.size = 1000;
  expect(Bun.inspect(ws)).toBe("WeakSet {}");
});
