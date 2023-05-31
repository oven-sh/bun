import { inspect } from "bun";
import { describe, test, expect } from "bun:test";

describe("expect()", () => {
  describe("toBeInstanceOf()", () => {
    class Animal {}
    class Dog extends Animal {}
    const tests = [
      {
        label: "string",
        value: new String(""),
        instanceOf: String,
      },
      {
        label: "number",
        value: new Number(1),
        instanceOf: Number,
      },
      {
        label: "object",
        value: {},
        instanceOf: Object,
      },
      {
        label: "function",
        value: () => {},
        instanceOf: Function,
      },
      {
        label: "Class",
        value: new Animal(),
        instanceOf: Animal,
      },
      {
        label: "extends Class",
        value: new Dog(),
        instanceOf: Dog,
      },
      {
        label: "super Class",
        value: new Dog(),
        instanceOf: Animal,
      },
    ];
    for (const { label, value, instanceOf } of tests) {
      test(label, () => expect(value).toBeInstanceOf(instanceOf));
    }
  });

  describe("toMatch()", () => {
    const tests = [
      {
        label: "reguler expression",
        value: "123",
        matched: /123/,
      },
      {
        label: "reguler expression object",
        value: "123",
        matched: new RegExp("123"),
      },
      {
        label: "substring",
        value: "123",
        matched: "12",
      },
      {
        label: "substring emojis",
        value: "👍👎",
        matched: "👍",
      },
      {
        label: "substring UTF-16",
        value: "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂",
        matched: "🥲 ☺️ 😊",
      },
    ];
    for (const { label, value, matched } of tests) {
      test(label, () => expect(value).toMatch(matched));
    }
  });

  describe("toBeCloseTo()", () => {
    const passTests = [
      [0, 0],
      [0, 0.001],
      [1.23, 1.229],
      [1.23, 1.226],
      [1.23, 1.225],
      [1.23, 1.234],
      [Infinity, Infinity],
      [-Infinity, -Infinity],
      [0, 0.1, 0],
      [0, 0.0001, 3],
      [0, 0.000004, 5],
      [2.0000002, 2, 5],
    ];
    for (const [actual, expected, precision] of passTests) {
      if (precision === undefined) {
        test(`actual = ${actual}, expected = ${expected}`, () => {
          expect(actual).toBeCloseTo(expected);
        });
      } else {
        test(`actual = ${actual}, expected = ${expected}, precision = ${precision}`, () => {
          expect(actual).toBeCloseTo(expected, precision);
        });
      }
    }
    const failTests = [
      [0, 0.01],
      [1, 1.23],
      [1.23, 1.2249999],
      [Infinity, -Infinity],
      [Infinity, 1.23],
      [-Infinity, -1.23],
      [3.141592e-7, 3e-7, 8],
      [56789, 51234, -4],
    ];
    for (const [actual, expected, precision] of failTests) {
      if (precision === undefined) {
        test(`actual = ${actual}, expected != ${expected}`, () => {
          expect(actual).not.toBeCloseTo(expected);
        });
      } else {
        test(`actual = ${actual}, expected != ${expected}, precision = ${precision}`, () => {
          expect(actual).not.toBeCloseTo(expected, precision);
        });
      }
    }
  });

  describe("toBeEmpty()", () => {
    const values = [
      "",
      [],
      {},
      new Set(),
      new Map(),
      new String(),
      new Array(),
      new Uint8Array(),
      new Object(),
      Buffer.from(""),
      Bun.file("/tmp/empty.txt"),
      new Headers(),
      new URLSearchParams(),
      new FormData(),
      (function* () {})(),
    ];
    for (const value of values) {
      test(label(value), () => {
        if (value && typeof value === "object" && value instanceof Blob) {
          require("fs").writeFileSync("/tmp/empty.txt", "");
        }

        expect(value).toBeEmpty();
      });
    }
  });

  describe("not.toBeEmpty()", () => {
    const values = [
      " ",
      [""],
      [undefined],
      { "": "" },
      new Set([""]),
      new Map([["", ""]]),
      new String(" "),
      new Array(1),
      new Uint8Array(1),
      Buffer.from(" "),
      Bun.file(import.meta.path),
      new Headers({
        a: "b",
        c: "d",
      }),
      new URL("https://example.com?d=e&f=g").searchParams,
      (() => {
        var a = new FormData();
        a.append("a", "b");
        a.append("c", "d");
        return a;
      })(),
      (function* () {
        yield "123";
      })(),
    ];
    for (const value of values) {
      test(label(value), () => {
        expect(value).not.toBeEmpty();
      });
    }
  });

  test("toBeNil()", () => {
    expect(null).toBeNil();
    expect(undefined).toBeNil();
    expect(false).not.toBeNil();
    expect(0).not.toBeNil();
    expect("").not.toBeNil();
    expect([]).not.toBeNil();
    expect(true).not.toBeNil();
    expect({}).not.toBeNil();
  });
});

function label(value: unknown): string {
  switch (typeof value) {
    case "object":
      const string = inspect(value).replace(/\n/g, "");
      return string || '""';
    default:
      return JSON.stringify(value);
  }
}
