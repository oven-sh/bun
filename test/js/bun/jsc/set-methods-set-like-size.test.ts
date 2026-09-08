import { describe, expect, test } from "bun:test";

// The Set methods take any "set-like" with a numeric `size`, a `has()` and a
// `keys()`. GetSetRecord (https://tc39.es/ecma262/#sec-getsetrecord) keeps that
// size as an unbounded integer or +Infinity, and each method compares it with
// the receiver's size to pick a strategy: ask `other.has()` about each of the
// receiver's elements, or iterate `other.keys()`. JSC used to truncate the size
// to uint32 first, so a set-like reporting 2^32 or more elements compared as
// size mod 2^32 and the methods consulted the wrong side.

const sizes = [
  0,
  1,
  2,
  3,
  2 ** 31,
  2 ** 32 - 1,
  2 ** 32,
  2 ** 32 + 1,
  2 ** 32 + 2,
  2 ** 33,
  2 ** 53 - 1,
  2 ** 53,
  2 ** 53 + 2,
  2 ** 64,
  1e300,
  Number.MAX_VALUE,
  Infinity,
];

// A set-like whose has() claims exactly the value 1 and whose keys() yields
// exactly the value 1, independent of the size it reports. It logs every
// observable interaction so the chosen strategy is visible.
function makeSetLike(size: number) {
  const log: string[] = [];
  const setLike = {
    get size() {
      log.push("size");
      return size;
    },
    has(v: unknown) {
      log.push("has:" + String(v));
      return v === 1;
    },
    keys() {
      log.push("keys");
      let done = false;
      return {
        next() {
          log.push("next");
          if (done) return { value: undefined, done: true };
          done = true;
          return { value: 1, done: false };
        },
        return() {
          log.push("return");
          return {};
        },
      };
    },
  };
  return { setLike, log };
}

// What the spec algorithms do for a receiver of `thisSize` elements against a
// set-like reporting `otherSize`, given the has()/keys() behaviour above.
function expected(method: string, receiver: number[], otherSize: number) {
  const thisSize = receiver.length;
  const hasCalls = receiver.map(v => "has:" + v);
  switch (method) {
    case "union":
      return { result: [...new Set([...receiver, 1])], log: ["size", "keys", "next", "next"] };
    case "symmetricDifference":
      return {
        result: receiver.includes(1) ? receiver.filter(v => v !== 1) : [...receiver, 1],
        log: ["size", "keys", "next", "next"],
      };
    case "intersection":
      return thisSize <= otherSize
        ? { result: receiver.filter(v => v === 1), log: ["size", ...hasCalls] }
        : { result: receiver.includes(1) ? [1] : [], log: ["size", "keys", "next", "next"] };
    case "difference":
      return thisSize <= otherSize
        ? { result: receiver.filter(v => v !== 1), log: ["size", ...hasCalls] }
        : { result: receiver.filter(v => v !== 1), log: ["size", "keys", "next", "next"] };
    case "isSubsetOf":
      if (thisSize > otherSize) return { result: false, log: ["size"] };
      // Stops at the first element other.has() rejects.
      return {
        result: receiver.every(v => v === 1),
        log: ["size", ...hasCalls.slice(0, receiver.findIndex(v => v !== 1) + 1 || receiver.length)],
      };
    case "isSupersetOf":
      if (thisSize < otherSize) return { result: false, log: ["size"] };
      // keys() yields 1; if the receiver lacks it the iterator is closed early.
      return receiver.includes(1)
        ? { result: true, log: ["size", "keys", "next", "next"] }
        : { result: false, log: ["size", "keys", "next", "return"] };
    case "isDisjointFrom":
      if (thisSize <= otherSize) {
        // Stops at the first element other.has() accepts.
        const i = receiver.indexOf(1);
        return { result: i === -1, log: ["size", ...hasCalls.slice(0, i === -1 ? receiver.length : i + 1)] };
      }
      return receiver.includes(1)
        ? { result: false, log: ["size", "keys", "next", "return"] }
        : { result: true, log: ["size", "keys", "next", "next"] };
  }
  throw new Error(method);
}

const methods = [
  "union",
  "intersection",
  "difference",
  "symmetricDifference",
  "isSubsetOf",
  "isSupersetOf",
  "isDisjointFrom",
] as const;

const receivers = [[], [1], [2], [1, 2], [2, 3], [2, 1, 3]];

describe.each(methods)("Set.prototype.%s", method => {
  test.each(sizes)("set-like with size %p", size => {
    for (const receiver of receivers) {
      const { setLike, log } = makeSetLike(size);
      const raw = (new Set(receiver) as any)[method](setLike);
      const result = raw instanceof Set ? [...raw] : raw;
      expect({ receiver, size, result, log }).toEqual({ receiver, size, ...expected(method, receiver, size) });
    }
  });

  test("negative sizes throw RangeError, even beyond -2^32", () => {
    for (const size of [-1, -(2 ** 31), -(2 ** 32), -(2 ** 32) - 1, -(2 ** 53), -1e300, -Infinity]) {
      const { setLike, log } = makeSetLike(size);
      expect(() => (new Set([1]) as any)[method](setLike)).toThrow(RangeError);
      expect(log).toEqual(["size"]);
    }
  });

  test("sizes that coerce to NaN throw TypeError", () => {
    for (const size of [NaN, undefined, "x", {}]) {
      const { setLike, log } = makeSetLike(size as number);
      expect(() => (new Set([1]) as any)[method](setLike)).toThrow(TypeError);
      expect(log).toEqual(["size"]);
    }
  });

  test("fractional sizes truncate toward zero before the comparison", () => {
    // 1.9 truncates to 1, so a two-element receiver is larger than the set-like.
    const { setLike, log } = makeSetLike(1.9);
    const raw = (new Set([1, 2]) as any)[method](setLike);
    const result = raw instanceof Set ? [...raw] : raw;
    expect({ result, log }).toEqual(expected(method, [1, 2], 1));
  });
});
