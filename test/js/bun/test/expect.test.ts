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
});
