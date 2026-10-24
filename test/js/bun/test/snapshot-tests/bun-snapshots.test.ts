import { describe, expect, it, test } from "bun:test";

test("it will create a snapshot file if it doesn't exist", () => {
  expect({ a: { b: { c: false } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Boolean) } } });
  expect({ a: { b: { c: "string" } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(String) } } });
  expect({ a: { b: { c: 4 } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Number) } } });
  expect({ a: { b: { c: 2n } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(BigInt) } } });
  expect({ a: new Date() }).toMatchSnapshot({ a: expect.any(Date) });
  expect({ j: 2, a: "any", b: "any2" }).toMatchSnapshot({ j: expect.any(Number), a: "any", b: expect.any(String) });
  expect({ j: /regex/, a: "any", b: "any2" }).toMatchSnapshot({
    j: expect.any(RegExp),
    a: "any",
    b: expect.any(String),
  });
});

test("ArrayBuffer values are serialized like typed arrays", () => {
  expect(new Uint8Array([1, 2, 3]).buffer).toMatchInlineSnapshot(`
    ArrayBuffer [
      1,
      2,
      3,
    ]
  `);
  expect({ a: 1, b: new Uint8Array([4, 5]).buffer }).toMatchInlineSnapshot(`
    {
      "a": 1,
      "b": ArrayBuffer [
        4,
        5,
      ],
    }
  `);
});

// https://github.com/oven-sh/bun/issues/3521
describe("property matchers leave the received value as it was", () => {
  // Every own property descriptor reachable from `roots`, as text: toEqual would accept a matcher that was left behind.
  function ownState(...roots: object[]) {
    const ids = new Map<object, number>();
    const queue: object[] = [];
    const show = (value: unknown) => {
      if (value === null || (typeof value !== "object" && typeof value !== "function")) return String(value);
      if (!ids.has(value)) {
        ids.set(value, ids.size);
        queue.push(value);
      }
      return `#${ids.get(value)}`;
    };
    roots.forEach(show);
    const lines: string[] = [];
    for (const object of queue) {
      const properties = Reflect.ownKeys(object).map(key => {
        const { value, get, set, ...flags } = Reflect.getOwnPropertyDescriptor(object, key)!;
        return `${String(key)} ${JSON.stringify(flags)} ${show(value)} ${show(get)} ${show(set)}`;
      });
      lines.push(
        [`#${ids.get(object)} frozen=${Object.isFrozen(object)} sealed=${Object.isSealed(object)}`, ...properties].join(
          "\n  ",
        ),
      );
    }
    return lines.join("\n");
  }

  const any = expect.any;
  class User {
    #id = 3;
    name = "alice";
    profile = { age: 30 };
    get id() {
      return this.#id;
    }
    get self() {
      return this.profile;
    }
  }
  const deepFreeze = <T extends object>(object: T): T => {
    Object.values(object).forEach(value => typeof value === "object" && deepFreeze(value));
    return Object.freeze(object);
  };
  const symbol = Symbol("key");

  const cases: Record<string, () => [received: any, matchers: any]> = {
    "objects, arrays and dates": () => [
      { id: 42, when: new Date(0), nested: { name: "abc" }, list: [1, "two", 3.5], rows: [{ id: 1 }, { id: 2 }] },
      {
        id: any(Number),
        when: any(Date),
        nested: { name: any(String) },
        list: [1, any(String), any(Number)],
        rows: [{ id: any(Number) }, { id: 2 }],
      },
    ],
    "a class instance": () => [new User(), { name: any(String) }],
    "a getter on the prototype": () => [new User(), { id: any(Number) }],
    "an object reached through a getter": () => [new User(), { self: { age: any(Number) } }],
    "an inherited property": () => [Object.create({ inherited: 1 }), { inherited: any(Number) }],
    "an own getter": () => [
      {
        a: 0,
        get id() {
          return 7;
        },
        z: 1,
      },
      { id: any(Number) },
    ],
    "an own getter and setter that cannot be redefined": () => [
      Object.defineProperty({ a: 0 }, "id", { get: () => 7, set() {}, enumerable: true }),
      { id: any(Number) },
    ],
    "a symbol key": () => [{ [symbol]: 1, a: 2 }, { [symbol]: any(Number) }],
    "a read-only and a hidden property": () => [
      Object.defineProperties(
        { a: 1 },
        { readOnly: { value: 5, enumerable: true }, hidden: { value: 6, writable: true, configurable: true } },
      ),
      { readOnly: any(Number), hidden: any(Number) },
    ],
    "a frozen object": () => [Object.freeze({ foo: "foo", bar: "bar" }), { bar: any(String) }],
    "a sealed object": () => [Object.seal({ foo: "foo", bar: "bar" }), { bar: any(String) }],
    "a frozen tree": () => [
      deepFreeze({ id: "x", items: [{ id: 1 }, { id: 2 }] }),
      { id: any(String), items: [{ id: any(Number) }, { id: 2 }] },
    ],
    "a frozen instance with a getter on the prototype": () => [
      Object.freeze(new User()),
      { id: any(Number), name: any(String) },
    ],
    "an object that appears twice": () => {
      const shared = { x: 1, y: "s" };
      return [{ a: shared, b: shared, log: [{ shared }] }, { a: { x: any(Number) } }];
    },
    "cycles": () => {
      const inner: any = { id: 1 };
      const outer: any = { id: 2, inner };
      inner.parent = outer;
      outer.self = outer;
      return [outer, { id: any(Number), inner: { id: any(Number) } }];
    },
    "an array with a read-only element and an accessor element": () => {
      const array = [1, 2, 3];
      Object.defineProperty(array, 1, { get: () => 2, enumerable: true, configurable: true });
      Object.defineProperty(array, 2, { writable: false });
      return [array, [any(Number), any(Number), any(Number)]];
    },
    "an Error": () => [Object.assign(new TypeError("boom"), { code: "E_FOO" }), { code: any(String) }],
    "a matcher on the received side": () => [{ a: any(Number), b: 1 }, { a: 5 }],
  };

  for (const [name, make] of Object.entries(cases)) {
    test(name, () => {
      const [received, matchers] = make();
      const before = ownState(received, matchers);
      expect(received).toMatchSnapshot(matchers);
      expect(ownState(received, matchers)).toBe(before);
    });
  }

  test("inline snapshots", () => {
    const received = { id: 42, name: "abc" };
    expect(received).toMatchInlineSnapshot(
      { id: expect.any(Number) },
      `
      {
        "id": Any<Number>,
        "name": "abc",
      }
    `,
    );
    expect(received.id).toBe(42);
  });

  test("when they do not match", () => {
    const received = Object.freeze({ id: 42, name: "abc" });
    const matchers = { id: expect.any(Number), name: expect.any(Number) };
    const before = ownState(received, matchers);
    expect(() => expect(received).toMatchSnapshot(matchers)).toThrow("to match properties from received object");
    expect(ownState(received, matchers)).toBe(before);
  });

  test("when two matchers pass on one property", () => {
    const received: any = { x: 1 };
    received.self = received;
    const matchers: any = { x: expect.any(Number) };
    matchers.self = matchers;
    expect(received).toMatchInlineSnapshot(
      matchers,
      `
      {
        "self": [Circular],
        "x": Any<Number>,
      }
    `,
    );
    expect(received.x).toBe(1);
  });

  test("when printing the value throws", () => {
    const readOnly = Object.defineProperty([1, 2], 0, { writable: false });
    const received = {
      id: 42,
      list: [1, 2],
      readOnly,
      bytes: new Uint8Array([1, 2]),
      broken: new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("thrown while printing");
          },
        },
      ),
    };
    const matchers = {
      id: expect.any(Number),
      list: [expect.any(Number), 2],
      readOnly: [expect.any(Number), 2],
      bytes: { 0: expect.any(Number) },
    };
    expect(() => expect(received).toMatchSnapshot(matchers)).toThrow("thrown while printing");
    expect(received.id).toBe(42);
    expect(received.list[0]).toBe(1);
    expect(Object.getOwnPropertyDescriptor(readOnly, 0)).toEqual({
      value: 1,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    expect(received.bytes[0]).toBe(1);
  });
});

describe("toMatchSnapshot errors", () => {
  it("should throw if property matchers exist and received is not an object", () => {
    expect(() => {
      expect(1).toMatchSnapshot({ a: 1 });
    }).toThrow();
  });
  it("should throw if property matchers don't match", () => {
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: 1 });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(Date) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(String) });
    }).toThrow();
    expect(() => {
      expect({ a: 4n }).toMatchSnapshot({ a: expect.any(Number) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(BigInt) });
    }).toThrow();
  });
  it("should throw if arguments are in the wrong order", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: "oops" }).toMatchSnapshot("wrong spot", { a: "oops" });
    }).toThrow();
    expect(() => {
      expect({ a: "oops" }).toMatchSnapshot({ a: "oops" }, "right spot");
    }).not.toThrow();
  });

  it("should throw if expect.any() doesn't received a constructor", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any() });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 5 }).toMatchSnapshot({ a: expect.any(5) });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any("not a constructor") });
    }).toThrow();
  });
});
