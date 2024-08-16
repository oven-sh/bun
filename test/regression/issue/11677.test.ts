import { test, expect } from "bun:test";

test("toContainKeys empty", () => {
  expect({ "": 1 }).toContainKeys([""]);
});

test("toContainKey proxy", () => {
  expect(
    new Proxy(
      {},
      {
        has(target, str) {
          return str === "foo";
        },
        getOwnPropertyDescriptor(target, str) {
          if (str === "foo") {
            return { value: 1, configurable: true, enumerable: true };
          }

          return undefined;
        },
      },
    ),
  ).toContainKey("foo");
});

test("toContainKeys proxy", () => {
  expect(
    new Proxy(
      {},
      {
        has(target, str) {
          return str === "foo";
        },
        getOwnPropertyDescriptor(target, str) {
          if (str === "foo") {
            return { value: 1, configurable: true, enumerable: true };
          }

          return undefined;
        },
      },
    ),
  ).toContainKeys(["foo"]);
});

test("toContainKeys proxy throwing", () => {
  expect(() =>
    expect(
      new Proxy(
        {},
        {
          has(target, str) {
            return str === "foo";
          },
          getOwnPropertyDescriptor(target, str) {
            throw new Error("my error!");
          },
        },
      ),
    ).not.toContainKeys(["my error!"]),
  ).toThrow();
});

test("NOT toContainKeys empty", () => {
  expect({}).not.toContainKeys([""]);
});

test("NOT toContainAnyKeys string empty", () => {
  expect({}).not.toContainAnyKeys([""]);
});

test("toContainAnyKeys true string empty", () => {
  expect({ "": 1 }).toContainAnyKeys([""]);
});

test("toContainAnyKeys holey", () => {
  expect([,]).not.toContainAnyKeys([,]);
});

test("NOT toContainAnyKeysEmpty", () => {
  expect({}).not.toContainAnyKeys([]);
});
