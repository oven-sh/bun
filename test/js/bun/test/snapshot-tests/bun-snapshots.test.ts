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

test("object keys get the same escapes in Latin-1 and UTF-16 strings", () => {
  // A string decoded from UTF-16 bytes keeps 16-bit storage, even when every character is ASCII.
  const utf16 = (s: string) => Buffer.from(s, "utf16le").toString("utf16le");
  const special = '"\\\n\x1b';
  const value = {
    [utf16(["ascii in utf16 ", special].join(""))]: 1,
    ["latin1 " + special]: 2,
    ["日本 " + special]: 3,
    ["😀 " + special]: 4,
  };
  expect(value).toMatchInlineSnapshot(`
    {
      "ascii in utf16 \\"\\\\\\n\\u001B": 1,
      "latin1 \\"\\\\\\n\\u001B": 2,
      "日本 \\"\\\\\\n\\u001B": 3,
      "😀 \\"\\\\\\n\\u001B": 4,
    }
  `);

  // A matcher failure prints the value too. toEqual uses the snapshot formatter. toBe uses the console formatter.
  const failure = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return Bun.stripANSI((e as Error).message);
    }
  };
  expect(failure(() => expect(value).toEqual(0))).toMatchInlineSnapshot(`
    "expect(received).toEqual(expected)

    - 0
    + {
    +   "ascii in utf16 \\"\\\\\\n\\u001B": 1,
    +   "latin1 \\"\\\\\\n\\u001B": 2,
    +   "日本 \\"\\\\\\n\\u001B": 3,
    +   "😀 \\"\\\\\\n\\u001B": 4,
    + }

    - Expected  - 1
    + Received  + 6
    "
  `);
  expect(failure(() => expect(value).toBe(0))).toMatchInlineSnapshot(`
    "expect(received).toBe(expected)

    Expected: 0
    Received: {
      "ascii in utf16 \\"\\\\\\n\\u001B": 1,
      "latin1 \\"\\\\\\n\\u001B": 2,
      "日本 \\"\\\\\\n\\u001B": 3,
      "😀 \\"\\\\\\n\\u001B": 4,
    }
    "
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
});
