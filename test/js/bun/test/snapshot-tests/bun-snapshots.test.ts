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

  describe("when formatting the received value throws", () => {
    // The snapshot formatter reads `$$typeof` off every object (React element
    // detection), `size` off Maps and Sets, and JSON-stringifies Dates, so
    // user code on any of those runs while the value is being formatted.
    const received: [string, () => unknown][] = [
      [
        "$$typeof getter on the received value",
        () => ({
          get $$typeof(): unknown {
            throw new Error("boom");
          },
        }),
      ],
      [
        // Keep this a single property: until #37331 lands, the property walk
        // only surfaces an exception thrown while formatting the last key.
        "$$typeof getter on a nested value",
        () => ({
          a: {
            get $$typeof(): unknown {
              throw new Error("boom");
            },
          },
        }),
      ],
      [
        "size getter on a Map",
        () =>
          Object.defineProperty(new Map(), "size", {
            get() {
              throw new Error("boom");
            },
          }),
      ],
      [
        "size getter on a Set",
        () =>
          Object.defineProperty(new Set(), "size", {
            get() {
              throw new Error("boom");
            },
          }),
      ],
      [
        "toJSON on a Date",
        () =>
          Object.assign(new Date(0), {
            toJSON() {
              throw new Error("boom");
            },
          }),
      ],
    ];

    it.each(received)("toMatchSnapshot throws the error from the %s", (_, makeValue) => {
      expect(() => expect(makeValue()).toMatchSnapshot()).toThrow("boom");
    });

    it.each(received)("toMatchInlineSnapshot throws the error from the %s", (_, makeValue) => {
      // Passing the inline snapshot means a build that does not throw fails on
      // the mismatch instead of writing into this file.
      expect(() => expect(makeValue()).toMatchInlineSnapshot(`"never recorded"`)).toThrow("boom");
    });

    it("throws the exception itself rather than a wrapper", () => {
      const error = new Error("boom");
      const value = {
        get $$typeof(): unknown {
          throw error;
        },
      };

      let thrown: unknown;
      try {
        expect(value).toMatchSnapshot();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(error);

      thrown = undefined;
      try {
        expect(value).toMatchInlineSnapshot(`"never recorded"`);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(error);
    });

    it("still throws the formatting error after the property matchers matched", () => {
      // Fresh object per call: matched property matchers are written into the received object (#3521).
      const makeValue = () => ({
        n: 1,
        get $$typeof(): unknown {
          throw new Error("boom");
        },
      });
      expect(() => expect(makeValue()).toMatchSnapshot({ n: expect.any(Number) })).toThrow("boom");
      expect(() => expect(makeValue()).toMatchInlineSnapshot({ n: expect.any(Number) }, `"never recorded"`)).toThrow(
        "boom",
      );
    });
  });
});
