import { describe, test, expect } from "bun:test";

describe("expect()", () => {
  describe("toBeInstanceOf()", () => {
    class Animal {}
    class Dog extends Animal {}
    const tests = [
      {
        label: "string",
        value: "",
        instanceOf: String,
      },
      {
        label: "number",
        value: 1,
        instanceof: Number,
      },
      {
        label: "bigint",
        value: 1n,
        instanceof: BigInt,
      },
      {
        label: "object",
        value: {},
        instanceOf: Object,
      },
      {
        label: "function",
        value: () => {},
        instanceof: Function,
      },
      {
        label: "Class",
        value: new Animal(),
        instanceof: Animal,
      },
      {
        label: "extends Class",
        value: new Dog(),
        instanceof: Dog,
      },
      {
        label: "super Class",
        value: new Dog(),
        instanceof: Animal,
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
    ];
    for (const { label, value, matched } of tests) {
      test(label, () => expect(value).toMatch(matched));
    }
  });
});
