import { Readable } from "stream";
import { it, expect } from "bun:test";

function makeUint8Array(str) {
  return new Uint8Array(
    [].map.call(str, function (ch) {
      return ch.charCodeAt(0);
    }),
  );
}

it("should work with .clear()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.push({})).toBeUndefined();
  expect(list.length).toBe(1);
  expect(list.push({})).toBeUndefined();
  expect(list.length).toBe(2);
  expect(list.clear()).toBeUndefined();
  expect(list.length).toBe(0);
});

it("should work with .concat()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.push(makeUint8Array("foo"))).toBeUndefined();
  expect(list.length).toBe(1);
  expect(list.concat(3)).toEqual(new Uint8Array([102, 111, 111]));
  expect(list.push(makeUint8Array("bar"))).toBeUndefined();
  expect(list.length).toBe(2);
  expect(list.concat(10)).toEqual(new Uint8Array([102, 111, 111, 98, 97, 114, 0, 0, 0, 0]));
});

it("should fail on .concat() with invalid items", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.push("foo")).toBeUndefined();
  expect(() => {
    list.concat(42);
  }).toThrow(TypeError);
});

it("should fail on .concat() buffer overflow", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.push(makeUint8Array("foo"))).toBeUndefined();
  expect(list.length).toBe(1);
  expect(() => {
    list.concat(2);
  }).toThrow(RangeError);
  expect(list.push(makeUint8Array("bar"))).toBeUndefined();
  expect(list.length).toBe(2);
  expect(() => {
    list.concat(5);
  }).toThrow(RangeError);
});

it("should work with .consume() on strings", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.consume(42, true)).toBe("");
  expect(list.push("foo")).toBeUndefined();
  expect(list.push("bar")).toBeUndefined();
  expect(list.push("baz")).toBeUndefined();
  expect(list.push("moo")).toBeUndefined();
  expect(list.push("moz")).toBeUndefined();
  expect(list.length).toBe(5);
  expect(list.consume(3, true)).toBe("foo");
  expect(list.length).toBe(4);
  expect(list.consume(4, true)).toBe("barb");
  expect(list.length).toBe(3);
  expect(list.consume(256, true)).toBe("azmoomoz");
  expect(list.length).toBe(0);
});

it("should work with .consume() on buffers", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.consume(42, false)).toEqual(new Uint8Array());
  expect(list.push(makeUint8Array("foo"))).toBeUndefined();
  expect(list.push(makeUint8Array("bar"))).toBeUndefined();
  expect(list.push(makeUint8Array("baz"))).toBeUndefined();
  expect(list.push(makeUint8Array("moo"))).toBeUndefined();
  expect(list.push(makeUint8Array("moz"))).toBeUndefined();
  expect(list.length).toBe(5);
  expect(list.consume(3, false)).toEqual(makeUint8Array("foo"));
  expect(list.length).toBe(4);
  expect(list.consume(2, false)).toEqual(makeUint8Array("ba"));
  expect(list.length).toBe(4);
  expect(list.consume(4, false)).toEqual(makeUint8Array("rbaz"));
  expect(list.length).toBe(2);
  expect(list.consume(10, false)).toEqual(new Uint8Array([109, 111, 111, 109, 111, 122, 0, 0, 0, 0]));
  expect(list.length).toBe(0);
});

it("should fail on .consume() with invalid items", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.push("foo")).toBeUndefined();
  expect(list.length).toBe(1);
  expect(list.consume(0, false)).toEqual(new Uint8Array([]));
  expect(() => {
    list.consume(1, false);
  }).toThrow(TypeError);
  expect(list.consume(3, true)).toBe("foo");
  expect(list.length).toBe(0);
  expect(list.push(makeUint8Array("bar"))).toBeUndefined();
  expect(list.length).toBe(1);
  expect(list.consume(0, true)).toEqual("");
  expect(() => {
    list.consume(1, true);
  }).toThrow(TypeError);
  expect(list.consume(3, false)).toEqual(new Uint8Array([98, 97, 114]));
});

it("should work with .first()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.first()).toBeUndefined();
  const item = {};
  expect(list.push(item)).toBeUndefined();
  expect(list.length).toBe(1);
  expect(list.first()).toBe(item);
});

it("should work with .join()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.push(42)).toBeUndefined();
  expect(list.push(null)).toBeUndefined();
  expect(list.push("foo")).toBeUndefined();
  expect(list.push(makeUint8Array("bar"))).toBeUndefined();
  expect(list.length).toBe(4);
  expect(list.join("")).toBe("42nullfoo98,97,114");
  expect(list.join(",")).toBe("42,null,foo,98,97,114");
  expect(list.join(" baz ")).toBe("42 baz null baz foo baz 98,97,114");
});

it("should work with .push()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  const item1 = {};
  expect(list.push(item1)).toBeUndefined();
  expect(list.length).toBe(1);
  expect(list.first()).toBe(item1);
  const item2 = {};
  expect(list.push(item2)).toBeUndefined();
  expect(list.length).toBe(2);
  expect(list.shift()).toBe(item1);
  expect(list.shift()).toBe(item2);
  expect(list.shift()).toBeUndefined();
});

it("should work with .shift()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.shift()).toBeUndefined();
  const item = {};
  expect(list.push(item)).toBeUndefined();
  expect(list.length).toBe(1);
  expect(list.shift()).toBe(item);
  expect(list.shift()).toBeUndefined();
});

it("should work with .unshift()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  const item1 = {};
  expect(list.unshift(item1)).toBeUndefined();
  expect(list.length).toBe(1);
  expect(list.first()).toBe(item1);
  const item2 = {};
  expect(list.push(item2)).toBeUndefined();
  expect(list.length).toBe(2);
  expect(list.first()).toBe(item1);
  const item3 = {};
  expect(list.unshift(item3)).toBeUndefined();
  expect(list.length).toBe(3);
  expect(list.shift()).toBe(item3);
  expect(list.shift()).toBe(item1);
  expect(list.shift()).toBe(item2);
  expect(list.shift()).toBeUndefined();
});

it("should work with partial .consume() followed by .first()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.push("foo")).toBeUndefined();
  expect(list.push("bar")).toBeUndefined();
  expect(list.length).toBe(2);
  expect(list.consume(4, true)).toEqual("foob");
  expect(list.length).toBe(1);
  expect(list.first()).toEqual("ar");
  expect(list.length).toBe(1);
});

it("should work with partial .consume() followed by .shift()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.push(makeUint8Array("foo"))).toBeUndefined();
  expect(list.push(makeUint8Array("bar"))).toBeUndefined();
  expect(list.length).toBe(2);
  expect(list.consume(4, false)).toEqual(makeUint8Array("foob"));
  expect(list.length).toBe(1);
  expect(list.shift()).toEqual(makeUint8Array("ar"));
  expect(list.length).toBe(0);
});

it("should work with partial .consume() followed by .unshift()", () => {
  const list = new Readable().readableBuffer;
  expect(list.length).toBe(0);
  expect(list.push(makeUint8Array("😋😋😋"))).toBeUndefined();
  expect(list.push(makeUint8Array("📋📋📋"))).toBeUndefined();
  expect(list.length).toBe(2);
  expect(list.consume(7, false)).toEqual(new Uint8Array([61, 11, 61, 11, 61, 11, 61]));
  expect(list.length).toBe(1);
  expect(list.unshift(makeUint8Array("👌👌👌"))).toBeUndefined();
  expect(list.length).toBe(2);
  expect(list.consume(12, false)).toEqual(new Uint8Array([61, 76, 61, 76, 61, 76, 203, 61, 203, 61, 203, 0]));
  expect(list.length).toBe(0);
});
