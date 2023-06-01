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

  test("toBeBoolean()", () => {
    expect(true).toBeBoolean();
    expect(false).toBeBoolean();
    expect(0).not.toBeBoolean();
    expect(1).not.toBeBoolean();
    expect("").not.toBeBoolean();
    expect({}).not.toBeBoolean();
  });

  test("toBeTrue()", () => {
    expect(true).toBeTrue();
    expect(false).not.toBeTrue();
    expect(0).not.toBeTrue();
    expect(1).not.toBeTrue();
    expect("").not.toBeTrue();
    expect({}).not.toBeTrue();
  });

  test("toBeFalse()", () => {
    expect(false).toBeFalse();
    expect(true).not.toBeFalse();
    expect(0).not.toBeFalse();
    expect(1).not.toBeFalse();
    expect("").not.toBeFalse();
    expect({}).not.toBeFalse();
  });

  test("toBeNumber()", () => {
    expect(0).toBeNumber();
    expect(1).toBeNumber();
    expect(1.23).toBeNumber();
    expect(Infinity).toBeNumber();
    expect(-Infinity).toBeNumber();
    expect(NaN).toBeNumber();
    expect("").not.toBeNumber();
    expect({}).not.toBeNumber();
  });

  test("toBeInteger()", () => {
    expect(0).toBeInteger();
    expect(1).toBeInteger();
    expect(1.23).not.toBeInteger();
    expect(Infinity).not.toBeInteger();
    expect(-Infinity).not.toBeInteger();
    expect(NaN).not.toBeInteger();
    expect("").not.toBeInteger();
    expect({}).not.toBeInteger();
  });

  test("toBeFinite()", () => {
    expect(0).toBeFinite();
    expect(1).toBeFinite();
    expect(1.23).toBeFinite();
    expect(Infinity).not.toBeFinite();
    expect(-Infinity).not.toBeFinite();
    expect(NaN).not.toBeFinite();
    expect("").not.toBeFinite();
    expect({}).not.toBeFinite();
  });

  test("toBePositive()", () => {
    expect(1).toBePositive();
    expect(1.23).toBePositive();
    expect(Infinity).not.toBePositive();
    expect(0).not.toBePositive();
    expect(-Infinity).not.toBePositive();
    expect(NaN).not.toBePositive();
    expect("").not.toBePositive();
    expect({}).not.toBePositive();
  });

  test("toBeNegative()", () => {
    expect(-1).toBeNegative();
    expect(-1.23).toBeNegative();
    expect(-Infinity).not.toBeNegative();
    expect(0).not.toBeNegative();
    expect(Infinity).not.toBeNegative();
    expect(NaN).not.toBeNegative();
    expect("").not.toBeNegative();
    expect({}).not.toBeNegative();
  });

  test("toBeWithin()", () => {
    expect(0).toBeWithin(0, 1);
    expect(3.14).toBeWithin(3, 3.141);
    expect(-25).toBeWithin(-100, 0);
    expect(0).not.toBeWithin(1, 2);
    expect(3.14).not.toBeWithin(3.1, 3.14);
    expect(99).not.toBeWithin(99, 99);
    expect(100).not.toBeWithin(99, 100);
    expect(NaN).not.toBeWithin(0, 1);
    expect("").not.toBeWithin(0, 1);
    expect({}).not.toBeWithin(0, 1);
    expect(Infinity).not.toBeWithin(-Infinity, Infinity);
  });

  test("toBeSymbol()", () => {
    expect(Symbol()).toBeSymbol();
    expect(Symbol("")).toBeSymbol();
    expect(Symbol.iterator).toBeSymbol();
    expect("").not.toBeSymbol();
    expect({}).not.toBeSymbol();
  });

  test("toBeFunction()", () => {
    expect(() => {}).toBeFunction();
    expect(function () {}).toBeFunction();
    expect(async function () {}).toBeFunction();
    expect(async () => {}).toBeFunction();
    expect(function* () {}).toBeFunction();
    expect(async function* () {}).toBeFunction();
    expect("").not.toBeFunction();
    expect({}).not.toBeFunction();
    expect(null).not.toBeFunction();
  });

  test("toBeDate()", () => {
    expect(new Date()).toBeDate();
    expect(new Date(0)).toBeDate();
    expect(new Date("2021-01-01")).toBeDate();
    expect("2021-01-01").not.toBeDate();
    expect({}).not.toBeDate();
    expect(null).not.toBeDate();
  });

  test.todo("toBeValidDate()", () => {
    expect(new Date()).toBeValidDate();
    expect(new Date(-1)).not.toBeValidDate();
    expect("2021-01-01").not.toBeValidDate();
    expect({}).not.toBeValidDate();
    expect(null).not.toBeValidDate();
  });

  test("toBeString()", () => {
    expect("").toBeString();
    expect("123").toBeString();
    expect(new String()).toBeString();
    expect(new String("123")).toBeString();
    expect(123).not.toBeString();
    expect({}).not.toBeString();
  });

  test("toInclude()", () => {
    expect("123").toInclude("1");
    expect("abc").toInclude("abc");
    expect(" 123 ").toInclude(" ");
    expect("").toInclude("");
    expect("bob").not.toInclude("alice");
  });

  test("toStartWith()", () => {
    expect("123").toStartWith("1");
    expect("abc").toStartWith("abc");
    expect(" 123 ").toStartWith(" ");
    expect(" ").toStartWith("");
    expect("").toStartWith("");
    expect("bob").not.toStartWith("alice");
  });

  test("toEndWith()", () => {
    expect("123").toEndWith("3");
    expect("abc").toEndWith("abc");
    expect(" 123 ").toEndWith(" ");
    expect(" ").toEndWith("");
    expect("").toEndWith("");
    expect("bob").not.toEndWith("alice");
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
