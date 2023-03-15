import { describe, test, expect } from "bun:test";

describe("expect()", () => {
  describe("toBeInstanceOf()", () => {
    class Animal {}
    class Dog extends Animal {}
    const tests = [
      {
        label: "string",
        value: new String(""),
        instanceOf: Number,
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
});
