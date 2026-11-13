/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.
Copyright Contributors to the Jest project.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */

import * as reference from "@jest/expect-utils";
import { describe, expect, test } from "bun:test";
import * as Immutable from "immutable";
import { List, OrderedMap, OrderedSet, Record } from "immutable";
import { createContext, runInContext } from "vm";

type Testers = Pick<typeof reference, "equals" | "iterableEquality" | "subsetEquality">;

declare module "bun:test" {
  interface Matchers<T> {
    _toTakeItsTesters(): void;
  }
}

// `this.utils.iterableEquality` and `this.utils.subsetEquality` are Bun's `iterableEquality()` and `subsetEquality()`
// of @jest/expect-utils, and `this.equals()` is its `equals()`.
let ours!: Testers;
expect.extend({
  _toTakeItsTesters() {
    const { iterableEquality, subsetEquality } = this.utils;
    ours = { equals: this.equals, iterableEquality, subsetEquality } as Testers;
    return { pass: true, message: () => "" };
  },
});
expect(0)._toTakeItsTesters();
const { equals, iterableEquality, subsetEquality } = ours;

// From here to the line that says where they end: the tests that Jest has for the two, as prettier prints them. They are
// describe("subsetEquality()"), describe("iterableEquality") and describe("iterableEquality (cross-realm)"), lines
// 269-669 and 726-756 of
// https://github.com/jestjs/jest/blob/v30.5.2/packages/expect-utils/src/__tests__/utils.test.ts
// The other describes of that file are for functions that `this.utils` does not have.

describe("subsetEquality()", () => {
  test("matching object returns true", () => {
    expect(subsetEquality({ foo: "bar" }, { foo: "bar" })).toBe(true);
  });

  test("object without keys is undefined", () => {
    expect(subsetEquality("foo", "bar")).toBeUndefined();
  });

  test("objects to not match", () => {
    expect(subsetEquality({ foo: "bar" }, { foo: "baz" })).toBe(false);
    expect(subsetEquality("foo", { foo: "baz" })).toBe(false);
  });

  test("null does not return errors", () => {
    expect(subsetEquality(null, { foo: "bar" })).not.toBeTruthy();
  });

  test("undefined does not return errors", () => {
    expect(subsetEquality(undefined, { foo: "bar" })).not.toBeTruthy();
  });

  describe("matching subsets with circular references", () => {
    test("simple circular references", () => {
      type CircularObj = { a?: string; ref?: unknown };

      const circularObjA1: CircularObj = { a: "hello" };
      circularObjA1.ref = circularObjA1;

      const circularObjA2: CircularObj = { a: "hello" };
      circularObjA2.ref = circularObjA2;

      const circularObjB: CircularObj = { a: "world" };
      circularObjB.ref = circularObjB;

      const primitiveInsteadOfRef: CircularObj = {};
      primitiveInsteadOfRef.ref = "not a ref";

      expect(subsetEquality(circularObjA1, {})).toBe(true);
      expect(subsetEquality({}, circularObjA1)).toBe(false);
      expect(subsetEquality(circularObjA2, circularObjA1)).toBe(true);
      expect(subsetEquality(circularObjB, circularObjA1)).toBe(false);
      expect(subsetEquality(primitiveInsteadOfRef, circularObjA1)).toBe(false);
    });

    test("referenced object on same level should not regarded as circular reference", () => {
      const referencedObj = { abc: "def" };
      const object = {
        a: { abc: "def" },
        b: { abc: "def", zzz: "zzz" },
      };
      const thisIsNotCircular = {
        a: referencedObj,
        b: referencedObj,
      };
      expect(subsetEquality(object, thisIsNotCircular)).toBeTruthy();
    });

    test("transitive circular references", () => {
      type CircularObj = { a: string; nestedObj?: unknown };

      const transitiveCircularObjA1: CircularObj = { a: "hello" };
      transitiveCircularObjA1.nestedObj = { parentObj: transitiveCircularObjA1 };

      const transitiveCircularObjA2: CircularObj = { a: "hello" };
      transitiveCircularObjA2.nestedObj = {
        parentObj: transitiveCircularObjA2,
      };

      const transitiveCircularObjB: CircularObj = { a: "world" };
      transitiveCircularObjB.nestedObj = {
        parentObj: transitiveCircularObjB,
      };

      const primitiveInsteadOfRef = {
        parentObj: "not the parent ref",
      };

      expect(subsetEquality(transitiveCircularObjA1, {})).toBe(true);
      expect(subsetEquality({}, transitiveCircularObjA1)).toBe(false);
      expect(subsetEquality(transitiveCircularObjA2, transitiveCircularObjA1)).toBe(true);
      expect(subsetEquality(transitiveCircularObjB, transitiveCircularObjA1)).toBe(false);
      expect(subsetEquality(primitiveInsteadOfRef, transitiveCircularObjA1)).toBe(false);
    });
  });

  describe("matching subsets with symbols", () => {
    describe("same symbol", () => {
      test("objects to not match with value diff", () => {
        const symbol = Symbol("foo");
        expect(subsetEquality({ [symbol]: 1 }, { [symbol]: 2 })).toBe(false);
      });

      test("objects to match with non-enumerable symbols", () => {
        const symbol = Symbol("foo");
        const foo = {};
        Object.defineProperty(foo, symbol, {
          enumerable: false,
          value: 1,
        });
        const bar = {};
        Object.defineProperty(bar, symbol, {
          enumerable: false,
          value: 2,
        });
        expect(subsetEquality(foo, bar)).toBe(true);
      });
    });

    describe("different symbol", () => {
      test("objects to not match with same value", () => {
        expect(subsetEquality({ [Symbol("foo")]: 1 }, { [Symbol("foo")]: 2 })).toBe(false);
      });
      test("objects to match with non-enumerable symbols", () => {
        const foo = {};
        Object.defineProperty(foo, Symbol("foo"), {
          enumerable: false,
          value: 1,
        });
        const bar = {};
        Object.defineProperty(bar, Symbol("foo"), {
          enumerable: false,
          value: 2,
        });
        expect(subsetEquality(foo, bar)).toBe(true);
      });
    });
  });

  describe("subset is not object with keys", () => {
    test("returns true if subset has keys", () => {
      expect(subsetEquality({ foo: "bar" }, { foo: "bar" })).toBe(true);
    });
    test("returns true if subset has Symbols", () => {
      const symbol = Symbol("foo");
      expect(subsetEquality({ [symbol]: "bar" }, { [symbol]: "bar" })).toBe(true);
    });
    test("returns undefined if subset has no keys", () => {
      expect(subsetEquality("foo", "bar")).toBeUndefined();
    });
    test("returns undefined if subset is null", () => {
      expect(subsetEquality({ foo: "bar" }, null)).toBeUndefined();
    });
    test("returns undefined if subset is Error", () => {
      expect(subsetEquality({ foo: "bar" }, new Error())).toBeUndefined();
    });
    test("returns undefined if subset is Array", () => {
      expect(subsetEquality({ foo: "bar" }, [])).toBeUndefined();
    });
    test("returns undefined if subset is Date", () => {
      expect(subsetEquality({ foo: "bar" }, new Date())).toBeUndefined();
    });
    test("returns undefined if subset is Set", () => {
      expect(subsetEquality({ foo: "bar" }, new Set())).toBeUndefined();
    });
    test("returns undefined if subset is Map", () => {
      expect(subsetEquality({ foo: "bar" }, new Map())).toBeUndefined();
    });
  });
});

describe("iterableEquality", () => {
  test("returns true when given circular iterators", () => {
    class Iter {
      *[Symbol.iterator]() {
        yield this;
      }
    }

    const a = new Iter();
    const b = new Iter();

    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns true when given circular Set", () => {
    const a = new Set();
    a.add(a);
    const b = new Set();
    b.add(b);
    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns true when given nested Sets", () => {
    expect(iterableEquality(new Set([new Set([[1]]), new Set([[2]])]), new Set([new Set([[2]]), new Set([[1]])]))).toBe(
      true,
    );
    expect(iterableEquality(new Set([new Set([[1]]), new Set([[2]])]), new Set([new Set([[3]]), new Set([[1]])]))).toBe(
      false,
    );
  });

  test("returns false when given inequal set within a set", () => {
    expect(iterableEquality(new Set([new Set([2])]), new Set([new Set([1, 2])]))).toBe(false);
    expect(iterableEquality(new Set([new Set([2])]), new Set([new Set([1, 2])]))).toBe(false);
  });

  test("returns false when given inequal map within a set", () => {
    expect(iterableEquality(new Set([new Map([["a", 2]])]), new Set([new Map([["a", 3]])]))).toBe(false);
    expect(iterableEquality(new Set([new Set([2])]), new Set([new Set([1, 2])]))).toBe(false);
  });

  test("returns false when given inequal set within a map", () => {
    expect(iterableEquality(new Map([["one", new Set([2])]]), new Map([["one", new Set([1, 2])]]))).toBe(false);
  });

  test("returns true when given iterator within equal objects", () => {
    const a = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      a: [],
    };
    const b = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      a: [],
    };

    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns false when given iterator within inequal objects", () => {
    const a = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      a: [1],
    };
    const b = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      a: [],
    };

    expect(iterableEquality(a, b)).toBe(false);
  });

  test("returns false when given iterator within inequal nested objects", () => {
    const a = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      a: {
        b: [1],
      },
    };
    const b = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      a: {
        b: [],
      },
    };

    expect(iterableEquality(a, b)).toBe(false);
  });

  test("returns true when given circular Set shape", () => {
    const a1 = new Set();
    const a2 = new Set();
    a1.add(a2);
    a2.add(a1);
    const b = new Set();
    b.add(b);

    expect(iterableEquality(a1, b)).toBe(true);
  });

  test("returns true when given circular key in Map", () => {
    const a = new Map();
    a.set(a, "a");
    const b = new Map();
    b.set(b, "a");

    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns true when given nested Maps", () => {
    expect(
      iterableEquality(
        new Map([["hello", new Map([["world", "foobar"]])]]),
        new Map([["hello", new Map([["world", "qux"]])]]),
      ),
    ).toBe(false);
    expect(
      iterableEquality(
        new Map([["hello", new Map([["world", "foobar"]])]]),
        new Map([["hello", new Map([["world", "foobar"]])]]),
      ),
    ).toBe(true);
  });

  test("returns true when given circular key and value in Map", () => {
    const a = new Map();
    a.set(a, a);
    const b = new Map();
    b.set(b, b);

    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns true when given circular value in Map", () => {
    const a = new Map();
    a.set("a", a);
    const b = new Map();
    b.set("a", b);

    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns true when given Immutable Lists without an OwnerID", () => {
    const a = List([1, 2, 3]);
    const b = a.filter(v => v > 0);

    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns true when given Immutable OrderedMaps without an OwnerID", () => {
    const a = OrderedMap().set("saving", true);
    const b = OrderedMap().merge({ saving: true });
    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns true when given Immutable OrderedSets without an OwnerID", () => {
    const a = OrderedSet().add("newValue");
    const b = List(["newValue"]).toOrderedSet();
    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns true when given Immutable Record without an OwnerID", () => {
    class TestRecord extends Record({ dummy: "" }) {}
    const a = new TestRecord().merge({ dummy: "data" });
    const b = new TestRecord().set("dummy", "data");
    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns true when given a symbols keys within equal objects", () => {
    const KEY = Symbol();

    const a = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      [KEY]: [],
    };
    const b = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      [KEY]: [],
    };

    expect(iterableEquality(a, b)).toBe(true);
  });

  test("returns false when given a symbols keys within inequal objects", () => {
    const KEY = Symbol();

    const a = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      [KEY]: [1],
    };
    const b = {
      [Symbol.iterator]: () => ({ next: () => ({ done: true }) }),
      [KEY]: [],
    };

    expect(iterableEquality(a, b)).toBe(false);
  });

  test("does not throw when iterating an object with a TypedArray iterator", () => {
    const badIterable = {
      [Symbol.iterator]: Uint8Array.prototype[Symbol.iterator],
    };

    expect(() => iterableEquality(badIterable, badIterable)).not.toThrow();
    // Returns undefined so equals() can fall through to Object.is / property checks.
    expect(iterableEquality(badIterable, badIterable)).toBeUndefined();
    // Same reference must still be considered equal via equals().
    expect(equals(badIterable, badIterable, [iterableEquality])).toBe(true);
  });
});

describe("iterableEquality (cross-realm)", () => {
  test("returns true for cross-realm Sets with same values", () => {
    const context = createContext({});
    const otherRealmSet = runInContext("new Set([1, 2, 3])", context);
    expect(iterableEquality(otherRealmSet, new Set([1, 2, 3]))).toBe(true);
  });

  test("returns true for cross-realm Maps with same entries", () => {
    const context = createContext({});
    const otherRealmMap = runInContext('new Map([["a", 1], ["b", 2]])', context);
    expect(
      iterableEquality(
        otherRealmMap,
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      ),
    ).toBe(true);
  });

  test("returns false for cross-realm Sets with different values", () => {
    const context = createContext({});
    const otherRealmSet = runInContext("new Set([1, 2])", context);
    expect(iterableEquality(otherRealmSet, new Set([1, 2, 3]))).toBe(false);
  });
});

// Here end the tests of Jest.

describe("Bun's two answer what those of @jest/expect-utils answer", () => {
  /**
   * In the place of the reference's answer: the row is not run with @jest/expect-utils, which compares it until the
   * stack runs out.
   */
  const overflows = Symbol("overflows");

  /** What `run` answers, or the name of the class of what it throws. */
  function answerOf(run: () => unknown) {
    try {
      return run();
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }

  // `Record` is the one of Immutable.js in this file.
  type Table<Value> = { [name: string]: Value };
  type Rows = Table<[answer: unknown, run: () => unknown, answerOfReference?: unknown]>;

  /**
   * Checks `[answer, run]` rows. `run` gives that answer with Bun's `equals`, `iterableEquality` and `subsetEquality`,
   * and with the three of @jest/expect-utils. Where Bun differs on purpose, a third item is the answer with those.
   */
  function check(rowsWith: (testers: Testers) => Rows) {
    const [expected, actual, expectedOfReference, actualOfReference]: Table<unknown>[] = [{}, {}, {}, {}];
    const rowsWithReference = rowsWith(reference);
    for (const [name, row] of Object.entries(rowsWith(ours))) {
      expected[name] = row[0];
      actual[name] = answerOf(row[1]);
      if (row[2] === overflows) continue;
      expectedOfReference[name] = row.length === 3 ? row[2] : row[0];
      actualOfReference[name] = answerOf(rowsWithReference[name][1]);
    }
    expect(actual).toStrictEqual(expected);
    expect(actualOfReference).toStrictEqual(expectedOfReference);
  }

  function* gen(items: unknown[]) {
    yield* items;
  }
  /** Without a tester, two of these are equal whatever they hold: they have no property. */
  class Hidden {
    #items;
    constructor(items: unknown[]) {
      this.#items = items;
    }
    *[Symbol.iterator]() {
      yield* this.#items;
    }
  }
  class Bag {
    constructor(
      public items: unknown[],
      public label?: string,
    ) {}
    *[Symbol.iterator]() {
      yield* this.items;
    }
  }
  class Length {
    constructor(
      public value: number,
      public unit: string,
    ) {}
  }
  const metre = () => new Length(1, "m");
  const hundredCentimetres = () => new Length(100, "cm");
  function areLengthsEqual(a: unknown, b: unknown) {
    const centimetres = (length: Length) => (length.unit === "m" ? length.value * 100 : length.value);
    return a instanceof Length && b instanceof Length ? centimetres(a) === centimetres(b) : undefined;
  }
  const setOfItself = () => {
    const set = new Set();
    return set.add(set);
  };
  const mapOfItself = () => {
    const map = new Map();
    return map.set("self", map);
  };
  const objectOfItself = () => {
    const object: Table<unknown> = { a: 1 };
    object.self = object;
    return object;
  };
  const key = Symbol("key");
  const anyNumber = { asymmetricMatch: (other: unknown) => typeof other === "number" };
  function argumentsOf(..._: unknown[]) {
    return arguments;
  }
  /** An iterable of nothing that has no prototype, and so no constructor. */
  const bare = () => Object.assign(Object.create(null), { *[Symbol.iterator]() {} });

  test("iterableEquality() compares two iterables that are no arrays, and is undefined for other values", () => {
    check(({ iterableEquality }) => ({
      "numbers": [undefined, () => iterableEquality(1, 1)],
      "strings": [undefined, () => iterableEquality("a", "a")],
      "null": [undefined, () => iterableEquality(null, null)],
      "a Set and null": [undefined, () => iterableEquality(new Set(), null)],
      "arrays": [undefined, () => iterableEquality([1], [2])],
      "typed arrays": [undefined, () => iterableEquality(new Uint8Array([1]), new Uint8Array([2]))],
      "plain objects": [undefined, () => iterableEquality({ a: 1 }, { a: 2 })],
      "functions": [undefined, () => iterableEquality(gen, gen)],
      "a Set and an array": [undefined, () => iterableEquality(new Set([1]), [1])],
      "a Set and a plain object": [undefined, () => iterableEquality(new Set([1]), {})],
      "no arguments": [undefined, () => (iterableEquality as Function)()],
      "WeakSets": [undefined, () => iterableEquality(new WeakSet(), new WeakSet())],
      "objects without a prototype": [undefined, () => iterableEquality(Object.create(null), Object.create(null))],
      // `typeof` says "function" for these, so they are no objects to compare.
      "functions that are iterables": [
        undefined,
        () =>
          iterableEquality(
            Object.assign(() => {}, { *[Symbol.iterator]() {} }),
            new Set(),
          ),
      ],
      "a Set and a Map": [false, () => iterableEquality(new Set([1]), new Map([[1, 1]]))],
      "a Set and a generator": [false, () => iterableEquality(new Set([1]), gen([1]))],
      "Sets in another order": [true, () => iterableEquality(new Set([1, 2]), new Set([2, 1]))],
      "Sets that differ": [false, () => iterableEquality(new Set([1, 2]), new Set([1, 3]))],
      "Sets of two sizes": [false, () => iterableEquality(new Set([1]), new Set([1, 2]))],
      "Sets of equal objects": [true, () => iterableEquality(new Set([{ a: [1] }]), new Set([{ a: [1] }]))],
      "Sets of different objects": [false, () => iterableEquality(new Set([{ a: [1] }]), new Set([{ a: [2] }]))],
      "Maps in another order": [
        true,
        () => iterableEquality(new Map(Object.entries({ a: 1, b: 2 })), new Map(Object.entries({ b: 2, a: 1 }))),
      ],
      "Maps with another value": [false, () => iterableEquality(new Map([[1, "a"]]), new Map([[1, "b"]]))],
      "Maps with another key": [false, () => iterableEquality(new Map([[1, "a"]]), new Map([[2, "a"]]))],
      "Maps with equal objects as keys": [
        true,
        () => iterableEquality(new Map([[{ a: 1 }, 2]]), new Map([[{ a: 1 }, 2]])),
      ],
      "Maps with different objects as keys": [
        false,
        () => iterableEquality(new Map([[{ a: 1 }, 2]]), new Map([[{ a: 2 }, 2]])),
      ],
      "generators": [true, () => iterableEquality(gen([1, { a: 2 }]), gen([1, { a: 2 }]))],
      "generators that differ": [false, () => iterableEquality(gen([1, 2]), gen([1, 3]))],
      "a shorter generator": [false, () => iterableEquality(gen([1]), gen([1, 2]))],
      "a longer generator": [false, () => iterableEquality(gen([1, 2]), gen([1]))],
      "iterables with private items": [true, () => iterableEquality(new Hidden([1, 2]), new Hidden([1, 2]))],
      "iterables with different private items": [false, () => iterableEquality(new Hidden([1, 2]), new Hidden([1, 3]))],
      "iterables of two classes": [false, () => iterableEquality(new Hidden([1]), new Bag([1]))],
      "iterables of two classes of one name": [
        false,
        () => {
          const classes = [0, 1].map(() => class Same extends Hidden {});
          return iterableEquality(new classes[0]([1]), new classes[1]([1]));
        },
      ],
      "iterables without a constructor": [true, () => iterableEquality(bare(), bare())],
      "an iterable without a constructor, and one with": [false, () => iterableEquality(bare(), new Hidden([]))],
      "iterables with another own property": [false, () => iterableEquality(new Bag([1], "x"), new Bag([1], "y"))],
      "iterables with another own symbol": [
        false,
        () =>
          iterableEquality(Object.assign(new Hidden([1]), { [key]: 1 }), Object.assign(new Hidden([1]), { [key]: 2 })),
      ],
      "String objects": [true, () => iterableEquality(new String("ab"), new String("ab"))],
      "String objects that differ": [false, () => iterableEquality(new String("ab"), new String("ac"))],
      "arguments": [true, () => iterableEquality(argumentsOf(1, 2), argumentsOf(1, 2))],
      "arguments that differ": [false, () => iterableEquality(argumentsOf(1, 2), argumentsOf(1, 3))],
      "URLSearchParams": [true, () => iterableEquality(new URLSearchParams("a=1"), new URLSearchParams("a=1"))],
      "URLSearchParams that differ": [
        false,
        () => iterableEquality(new URLSearchParams("a=1"), new URLSearchParams("a=2")),
      ],
      // Like Object.entries(), which looks at each property again before it reads it.
      "an own property that the getter of the one before it deletes": [
        true,
        () =>
          iterableEquality(
            {
              get a() {
                delete (this as { b?: number }).b;
                return 1;
              },
              b: 2,
              *[Symbol.iterator]() {},
            },
            { a: 1, *[Symbol.iterator]() {} },
          ),
      ],
      "Sets that hold themselves": [true, () => iterableEquality(setOfItself(), setOfItself())],
      "Maps that hold themselves": [true, () => iterableEquality(mapOfItself(), mapOfItself())],
    }));
  });

  test("iterableEquality() looks for each member of a Set or a Map in the other one", () => {
    const pair = (first: object, second: object) => [new Set([first, second]), new Set([second, first])] as const;
    check(({ iterableEquality }) => ({
      "Sets of two objects in another order": [true, () => iterableEquality(...pair({ a: 1 }, { b: 2 }))],
      "Maps of two objects in another order": [
        true,
        () =>
          iterableEquality(
            new Map([
              [{ a: 1 }, "a"],
              [{ b: 2 }, "b"],
            ]),
            new Map([
              [{ b: 2 }, "b"],
              [{ a: 1 }, "a"],
            ]),
          ),
      ],
      "Maps whose two keys swap their values": [
        false,
        () =>
          iterableEquality(
            new Map([
              [{ a: 1 }, "a"],
              [{ b: 2 }, "b"],
            ]),
            new Map([
              [{ a: 1 }, "b"],
              [{ b: 2 }, "a"],
            ]),
          ),
      ],
      // One member of the second can stand for two of the first: jestjs/jest#16546. toEqual() does the same (#34830).
      "a Set that holds two equal objects, and a Set that holds one of them": [
        true,
        () => iterableEquality(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }])),
      ],
      "a Set that holds one of two equal objects, and a Set that holds both": [
        false,
        () => iterableEquality(new Set([{ a: 1 }, { a: 2 }]), new Set([{ a: 1 }, { a: 1 }])),
      ],
    }));
  });

  test("iterableEquality() compares the members with the testers of its third argument", () => {
    const [a, b] = [() => new Set([metre()]), () => new Set([hundredCentimetres()])];
    check(({ iterableEquality }) => ({
      "a Set, without a tester": [false, () => iterableEquality(a(), b())],
      "a Set": [true, () => iterableEquality(a(), b(), [areLengthsEqual])],
      "a Map": [
        true,
        () => iterableEquality(new Map([["a", metre()]]), new Map([["a", hundredCentimetres()]]), [areLengthsEqual]),
      ],
      "a generator": [true, () => iterableEquality(gen([metre()]), gen([hundredCentimetres()]), [areLengthsEqual])],
      "a Set in a Set": [true, () => iterableEquality(new Set([a()]), new Set([b()]), [areLengthsEqual])],
      "itself in the list": [true, () => iterableEquality(a(), b(), [iterableEquality, areLengthsEqual])],
      // The reference compares the own properties of an iterable without a tester.
      "an own property": [
        false,
        () =>
          iterableEquality(new Bag([], metre() as never), new Bag([], hundredCentimetres() as never), [
            areLengthsEqual,
          ]),
      ],
      "a number for the list": ["TypeError", () => iterableEquality(a(), b(), 5 as never)],
      "null for the list": ["TypeError", () => iterableEquality(a(), b(), null as never)],
      "a number for the list, and no iterables": [undefined, () => iterableEquality(1, 1, 5 as never)],
      "a list with a number": ["TypeError", () => iterableEquality(new Set([{}]), new Set([{}]), [5 as never])],
    }));
  });

  test("iterableEquality() knows the collections of Immutable.js", () => {
    const Point = Immutable.Record({ x: 0 });
    const hashed = <T extends { hashCode(): number }>(collection: T) => (collection.hashCode(), collection);
    const entries: [string, number][] = [
      ["a", 1],
      ["b", 2],
    ];
    check(({ iterableEquality }) => ({
      "Sets in another order": [true, () => iterableEquality(Immutable.Set([1, 2]), Immutable.Set([2, 1]))],
      "Maps in another order": [
        true,
        () => iterableEquality(Immutable.Map(entries), Immutable.Map(entries.toReversed())),
      ],
      "OrderedSets in another order": [false, () => iterableEquality(OrderedSet([1, 2]), OrderedSet([2, 1]))],
      "OrderedMaps in another order": [
        false,
        () => iterableEquality(OrderedMap(entries), OrderedMap(entries.toReversed())),
      ],
      // What differs in each of these four is an own property that the reference leaves out.
      "Lists, one with its hash": [true, () => iterableEquality(hashed(List([1, 2])), List([1, 2]))],
      "OrderedMaps, one after a delete": [
        true,
        () => iterableEquality(OrderedMap([["x", 0], ...entries]).delete("x"), OrderedMap(entries)),
      ],
      "OrderedSets, one with its hash": [true, () => iterableEquality(hashed(OrderedSet([1, 2])), OrderedSet([1, 2]))],
      "Records, one that can change": [true, () => iterableEquality(Point({ x: 5 }).asMutable(), Point({ x: 5 }))],
    }));
  });

  test("subsetEquality() compares the properties of its second argument, and is undefined if that has none", () => {
    check(({ subsetEquality }) => ({
      "fewer properties": [true, () => subsetEquality({ a: 1, b: 2 }, { a: 1 })],
      "more properties": [false, () => subsetEquality({ a: 1 }, { a: 1, b: 2 })],
      "another value": [false, () => subsetEquality({ a: 1 }, { a: 2 })],
      "fewer nested properties": [true, () => subsetEquality({ a: { b: 1, c: 2 } }, { a: { b: 1 } })],
      "another nested value": [false, () => subsetEquality({ a: { b: 1, c: 2 } }, { a: { b: 2 } })],
      "a shorter array": [false, () => subsetEquality({ a: [1, 2] }, { a: [1] })],
      "an array of subsets": [true, () => subsetEquality({ a: [{ b: 1, c: 2 }] }, { a: [{ b: 1 }] })],
      "an undefined property": [true, () => subsetEquality({ a: undefined }, { a: undefined })],
      "a missing property": [false, () => subsetEquality({}, { a: undefined })],
      "an inherited property": [true, () => subsetEquality(Object.create({ a: 1 }), { a: 1 })],
      "a property that only Object.prototype has": [
        false,
        () => subsetEquality({}, { toString: Object.prototype.toString }),
      ],
      "a property that is not enumerable": [
        true,
        () => subsetEquality(Object.defineProperty({}, "a", { value: 1, enumerable: false }), { a: 1 }),
      ],
      "a symbol": [true, () => subsetEquality({ [key]: 1, b: 2 }, { [key]: 1 })],
      "a symbol with another value": [false, () => subsetEquality({ [key]: 1 }, { [key]: 2 })],
      "an instance of a class": [true, () => subsetEquality({ value: 1, unit: "m", x: 1 }, metre())],
      // The reference does not know the asymmetric matchers of Bun's expect, but both know an object like this one.
      "an object with asymmetricMatch()": [true, () => subsetEquality({ a: 1 }, { a: anyNumber })],
      "an object with asymmetricMatch() that does not match": [
        false,
        () => subsetEquality({ a: "x" }, { a: anyNumber }),
      ],
      "a Date": [true, () => subsetEquality({ a: new Date(0) }, { a: new Date(0) })],
      "another Date": [false, () => subsetEquality({ a: new Date(0) }, { a: new Date(1) })],
      "a subset that holds itself": [true, () => subsetEquality(objectOfItself(), objectOfItself())],
      "a subset that holds itself, of an object that does not": [
        false,
        () => subsetEquality({ a: 1, self: { a: 1, self: {} } }, objectOfItself()),
      ],
      "a number, of an object": [false, () => subsetEquality(1, { a: 1 })],
      "null, of an object": [false, () => subsetEquality(null, { a: 1 })],
      "null, of an empty object": [true, () => subsetEquality(null, {})],
      "an array, of its length": [true, () => subsetEquality([1, 2], { length: 2 })],
      "a function, of its name": [false, () => subsetEquality(gen, { name: "gen" })],
      "of a number": [undefined, () => subsetEquality({ a: 1 }, 1)],
      "of an array": [undefined, () => subsetEquality([1], [1])],
      "of a function": [undefined, () => subsetEquality({}, gen)],
      "of a function with a property": [
        undefined,
        () =>
          subsetEquality(
            { a: 1 },
            Object.assign(() => {}, { a: 1 }),
          ),
      ],
      "a function, of an empty object": [true, () => subsetEquality(gen, {})],
      "of a WeakSet": [true, () => subsetEquality({ a: 1 }, new WeakSet())],
      "undefined, of a WeakMap": [true, () => subsetEquality(undefined, new WeakMap())],
      "null, of an object with a constructor": [false, () => subsetEquality(null, { constructor: Object })],
      "objects without a prototype": [
        true,
        () =>
          subsetEquality(
            Object.assign(Object.create(null), { a: 1, b: 2 }),
            Object.assign(Object.create(null), { a: 1 }),
          ),
      ],
      "objects without a prototype that differ": [
        false,
        () =>
          subsetEquality(Object.assign(Object.create(null), { a: 1 }), Object.assign(Object.create(null), { a: 2 })),
      ],
      "no arguments": [undefined, () => (subsetEquality as Function)()],
      "with a tester": [
        true,
        () => subsetEquality({ a: metre(), x: 1 }, { a: hundredCentimetres() }, [areLengthsEqual]),
      ],
      "without a tester": [false, () => subsetEquality({ a: metre(), x: 1 }, { a: hundredCentimetres() })],
      "a number for the list": ["TypeError", () => subsetEquality({ a: 1 }, { a: 1 }, 5 as never)],
      "a number for the list, and a subset without properties": [
        "TypeError",
        () => subsetEquality({ a: 1 }, 1, 5 as never),
      ],
      // The equals() of the reference does not look into a Set or a Map without iterableEquality in its list.
      // this.equals() always does.
      "another Set": [false, () => subsetEquality({ a: new Set([1]) }, { a: new Set([2]) }), true],
      "another Map": [false, () => subsetEquality({ a: new Map([[1, 1]]) }, { a: new Map([[1, 2]]) }), true],
    }));
  });

  test("equals() with them in its list", () => {
    const [a, b] = [() => new Set([metre()]), () => new Set([hundredCentimetres()])];
    check(({ equals, iterableEquality, subsetEquality }) => ({
      "Sets in another order": [true, () => equals(new Set([1, 2]), new Set([2, 1]), [iterableEquality])],
      "Sets that differ": [false, () => equals(new Set([1, 2]), new Set([1, 3]), [iterableEquality])],
      "Sets that differ, in an object": [
        false,
        () => equals({ a: [new Set([1])] }, { a: [new Set([2])] }, [iterableEquality]),
      ],
      "Maps that differ": [false, () => equals(new Map([[1, 2]]), new Map([[1, 3]]), [iterableEquality])],
      "generators": [true, () => equals(gen([1, 2]), gen([1, 2]), [iterableEquality])],
      "generators that differ": [false, () => equals(gen([1, 2]), gen([1, 3]), [iterableEquality])],
      "iterables with different private items": [
        false,
        () => equals({ a: new Hidden([1]) }, { a: new Hidden([2]) }, [iterableEquality]),
      ],
      "iterables with different private items, without the tester": [
        true,
        () => equals({ a: new Hidden([1]) }, { a: new Hidden([2]) }, []),
      ],
      "plain objects": [true, () => equals({ a: [1] }, { a: [1] }, [iterableEquality])],
      "plain objects that differ": [false, () => equals({ a: [1] }, { a: [2] }, [iterableEquality])],
      "after a tester": [true, () => equals(a(), b(), [areLengthsEqual, iterableEquality])],
      "before a tester": [true, () => equals(a(), b(), [iterableEquality, areLengthsEqual])],
      "without the tester": [false, () => equals(a(), b(), [iterableEquality])],
      "fewer properties": [true, () => equals({ a: 1, b: 2 }, { a: 1 }, [subsetEquality])],
      "more properties": [false, () => equals({ a: 1 }, { a: 1, b: 2 }, [subsetEquality])],
      "fewer nested properties": [true, () => equals({ a: { b: 1, c: 2 } }, { a: { b: 1 } }, [subsetEquality])],
      "an array of subsets": [true, () => equals([{ a: 1, b: 2 }], [{ a: 1 }], [subsetEquality])],
      "a longer array": [false, () => equals([{ a: 1 }, 2], [{ a: 1 }], [subsetEquality])],
      "a Set of subsets": [
        true,
        () => equals(new Set([{ a: 1, b: 2 }]), new Set([{ a: 1 }]), [iterableEquality, subsetEquality]),
      ],
      "a Set of subsets, in the other order": [
        true,
        () => equals(new Set([{ a: 1, b: 2 }]), new Set([{ a: 1 }]), [subsetEquality, iterableEquality]),
      ],
      "a subset with a Set": [
        true,
        () => equals({ a: new Set([1]), b: 2 }, { a: new Set([1]) }, [iterableEquality, subsetEquality]),
      ],
      "a subset with another Set": [
        false,
        () => equals({ a: new Set([1]), b: 2 }, { a: new Set([2]) }, [iterableEquality, subsetEquality]),
      ],
      "a subset with another generator": [
        false,
        () => equals({ a: gen([1]), b: 2 }, { a: gen([2]) }, [iterableEquality, subsetEquality]),
      ],
    }));
  });

  // toStrictEqual() of Jest is strict through three more testers, which the members of an iterable are handed too.
  // Bun's is strict through the fourth argument of this.equals(), and the two testers keep that for what they compare.
  test("a strict equals() is strict for what the two compare", () => {
    class Metre {}
    class Yard {}
    const pairs: Table<[unknown, unknown]> = {
      "an undefined property": [{ a: undefined, b: 1 }, { b: 1 }],
      "two classes": [new Metre(), new Yard()],
      "a hole": [
        [, 1],
        [undefined, 1],
      ],
    };
    check(({ equals, iterableEquality, subsetEquality }) => {
      const places: Table<(a: unknown, b: unknown, isStrict: boolean) => unknown> = {
        "in a Set": (a, b, isStrict) => equals(new Set([a]), new Set([b]), [iterableEquality], isStrict),
        "in a Map": (a, b, isStrict) => equals(new Map([[1, a]]), new Map([[1, b]]), [iterableEquality], isStrict),
        "in a generator": (a, b, isStrict) => equals(gen([a]), gen([b]), [iterableEquality], isStrict),
      };
      const rows: Rows = {
        "strictly, a hole in an array of a subset": [
          false,
          () => equals({ a: [, 1] }, { a: [undefined, 1] }, [subsetEquality], true),
          true,
        ],
      };
      for (const [pair, [a, b]] of Object.entries(pairs)) {
        for (const [place, compare] of Object.entries(places)) {
          rows[`${pair} ${place}`] = [true, () => compare(a, b, false)];
          rows[`strictly, ${pair} ${place}`] = [false, () => compare(a, b, true), true];
        }
      }
      return rows;
    });
  });

  // The reference hands the tester of the outermost call on to every call below it, ahead of theirs, and that one
  // only knows the pair of the outermost call. Bun hands on what Vitest does (vitest-dev/vitest#5535).
  test("a Set that is reached again below another Set is compared once", () => {
    const setsInACycle = () => {
      const [a, b, c] = [new Set(), new Set(), new Set()];
      a.add(b);
      b.add(c);
      c.add(b);
      return a;
    };
    const objectInTwoSets = () => {
      const root: Table<unknown> = {};
      const object = { root };
      root.a = new Set([object]);
      root.b = new Set([object]);
      return root;
    };
    const tree = () => {
      const node = (parent?: object) => ({ parent, children: new Set<object>() });
      const root = node();
      const child = node(root);
      root.children.add(child);
      child.children.add(node(child));
      return root;
    };
    check(({ equals, iterableEquality }) => ({
      "Sets in a cycle that the first is not in": [
        true,
        () => iterableEquality(setsInACycle(), setsInACycle()),
        overflows,
      ],
      "an object in two Sets of the object that it holds": [
        true,
        () => equals(objectInTwoSets(), objectInTwoSets(), [iterableEquality]),
        overflows,
      ],
      "a tree of nodes that hold their parent and a Set of their children": [
        true,
        () => equals(tree(), tree(), [iterableEquality]),
        overflows,
      ],
      "a tree with another leaf": [
        false,
        () => {
          const other = tree();
          const [child] = other.children as Set<ReturnType<typeof tree>>;
          child.children.add({});
          return equals(tree(), other, [iterableEquality]);
        },
      ],
    }));
  });

  test("what a value throws is thrown, and a loop that stops early closes its iterator", () => {
    /** An iterable whose iterators add `name` to `closed` when they are closed. */
    const closing = (closed: string[], name: string, items: unknown[]) => ({
      [Symbol.iterator]() {
        let i = 0;
        return {
          next: () => (i < items.length ? { value: items[i++], done: false } : { value: undefined, done: true }),
          return: () => (closed.push(name), {}),
        };
      },
    });
    /** Object.prototype.toString() names it a Set. */
    const fakeSet = (closed: string[], name: string, items: unknown[], members: object = {}) => ({
      size: items.length,
      [Symbol.toStringTag]: "Set",
      has: () => false,
      ...closing(closed, name, items),
      ...members,
    });
    const fakeMap = (entries: unknown[], members: object) => ({
      ...fakeSet([], "", entries),
      [Symbol.toStringTag]: "Map",
      ...members,
    });
    const throws = (ErrorClass: ErrorConstructor) => () => {
      throw new ErrorClass("thrown by the value");
    };
    const steps = (next: () => unknown) => ({ [Symbol.iterator]: () => ({ next }) });
    const done = () => ({ done: true });
    const revoked = () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      return proxy;
    };
    /** What `run` answers or throws, and then the iterators that were closed, in order. */
    const withClosed = (run: (closed: string[]) => unknown) => {
      const closed: string[] = [];
      return [answerOf(() => run(closed)), closed.join()];
    };
    check(({ equals, iterableEquality, subsetEquality }) => ({
      "has() of a Set throws": [
        ["RangeError", "a"],
        () =>
          withClosed(closed =>
            iterableEquality(fakeSet(closed, "a", [1]), fakeSet(closed, "b", [1], { has: throws(RangeError) })),
          ),
      ],
      "a tester throws for two members": [
        ["RangeError", "b,a"],
        () =>
          withClosed(closed =>
            iterableEquality(fakeSet(closed, "a", [{}]), fakeSet(closed, "b", [{}]), [throws(RangeError)]),
          ),
      ],
      "Sets that differ": [
        [false, "a"],
        () => withClosed(closed => iterableEquality(fakeSet(closed, "a", [1, 2]), fakeSet(closed, "b", [3, 4]))),
      ],
      "has() throws, and then return() does": [
        "RangeError",
        () => {
          const a = fakeSet([], "a", [1], {
            [Symbol.iterator]: () => ({ next: () => ({ value: 1, done: false }), return: throws(SyntaxError) }),
          });
          return iterableEquality(a, fakeSet([], "b", [1], { has: throws(RangeError) }));
        },
      ],
      "return() throws when the Sets differ": [
        "SyntaxError",
        () => {
          const a = fakeSet([], "a", [1], {
            [Symbol.iterator]: () => ({ next: () => ({ value: 1, done: false }), return: throws(SyntaxError) }),
          });
          return iterableEquality(a, fakeSet([], "b", [2]));
        },
      ],
      "return() answers a number when the Sets differ": [
        "TypeError",
        () => {
          const a = fakeSet([], "a", [1], {
            [Symbol.iterator]: () => ({ next: () => ({ value: 1, done: false }), return: () => 5 }),
          });
          return iterableEquality(a, fakeSet([], "b", [2]));
        },
      ],
      "get() of a Map throws": [
        "RangeError",
        () => iterableEquality(fakeMap([[1, 1]], {}), fakeMap([[1, 1]], { has: () => true, get: throws(RangeError) })),
      ],
      "next() throws": ["RangeError", () => iterableEquality(steps(throws(RangeError)), steps(done))],
      "next() of the second throws": [
        "RangeError",
        () =>
          iterableEquality(
            steps(() => ({ value: 1, done: false })),
            steps(throws(RangeError)),
          ),
      ],
      "done throws": [
        "RangeError",
        () =>
          iterableEquality(
            steps(() => ({
              get done() {
                return throws(RangeError)();
              },
            })),
            steps(done),
          ),
      ],
      "value throws": [
        "RangeError",
        () => {
          const step = () => ({
            done: false,
            get value() {
              return throws(RangeError)();
            },
          });
          return iterableEquality(steps(step), steps(step));
        },
      ],
      // Like two values that are no iterables: the reference catches what making the iterator throws.
      "Symbol.iterator throws": [
        undefined,
        () => iterableEquality({ [Symbol.iterator]: throws(RangeError) }, { [Symbol.iterator]: throws(RangeError) }),
      ],
      "Symbol.iterator is a number": [
        undefined,
        () => iterableEquality({ [Symbol.iterator]: 5 }, { [Symbol.iterator]: 5 }),
      ],
      "Symbol.iterator of the second throws": [
        [undefined, ""],
        () =>
          withClosed(closed => iterableEquality(closing(closed, "a", [1]), { [Symbol.iterator]: throws(RangeError) })),
      ],
      // The reference steps the two by hand, and closes neither.
      "iterables that differ": [
        [false, ""],
        () => withClosed(closed => iterableEquality(closing(closed, "a", [1, 2]), closing(closed, "b", [1, 3]))),
      ],
      "the getter of Symbol.iterator throws": [
        "RangeError",
        () => {
          const value = () => ({
            get [Symbol.iterator]() {
              return throws(RangeError)();
            },
          });
          return iterableEquality(value(), value());
        },
      ],
      "the getter of the name of a constructor throws": [
        "RangeError",
        () => {
          const value = () => {
            const constructor = Object.defineProperty(function () {}, "name", { get: throws(RangeError) });
            return { constructor, *[Symbol.iterator]() {} };
          };
          return iterableEquality(value(), value());
        },
      ],
      "the getter of size throws": [
        "RangeError",
        () =>
          iterableEquality(
            { size: 1, *[Symbol.iterator]() {} },
            {
              get size() {
                return throws(RangeError)();
              },
              *[Symbol.iterator]() {},
            },
          ),
      ],
      "a Proxy that is revoked": ["TypeError", () => iterableEquality(revoked(), revoked())],
      "a subset that is a Proxy that is revoked": ["TypeError", () => subsetEquality({}, revoked())],
      // The reference calls itself for each prototype.
      "an object that is its own prototype": [
        "RangeError",
        () => {
          const object: object = new Proxy({}, { getPrototypeOf: () => object });
          return subsetEquality(object, { a: 1 });
        },
      ],
      "a subset that is a Proxy whose ownKeys() throws": [
        "RangeError",
        () => subsetEquality({}, new Proxy({ a: 1 }, { ownKeys: throws(RangeError) })),
      ],
      "a getter of the subset throws": [
        "RangeError",
        () =>
          subsetEquality(
            { a: 1 },
            {
              get a() {
                return throws(RangeError)();
              },
            },
          ),
      ],
      "a getter of the object throws": [
        "RangeError",
        () =>
          subsetEquality(
            {
              get a() {
                return throws(RangeError)();
              },
            },
            { a: 1 },
          ),
      ],
      "a tester throws for two properties": [
        "RangeError",
        () => subsetEquality({ a: {} }, { a: {} }, [throws(RangeError)]),
      ],
      "through equals(), has() of a Set throws": [
        ["RangeError", "a"],
        () =>
          withClosed(closed =>
            equals(
              { a: [fakeSet(closed, "a", [1])] },
              { a: [fakeSet(closed, "b", [1], { has: throws(RangeError) })] },
              [iterableEquality, subsetEquality],
            ),
          ),
      ],
    }));
  });
});
