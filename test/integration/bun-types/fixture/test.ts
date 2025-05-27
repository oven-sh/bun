import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { expectType } from "./utilities";

const hooks = [beforeAll, beforeEach, afterAll, afterEach];

for (const hook of hooks) {
  hook(() => {
    // ...
  });
  // eslint-disable-next-line
  hook(async () => {
    // ...
    return;
  });
  hook((done: (err?: unknown) => void) => {
    done();
    done(new Error());
    done("Error");
  });
}

describe("bun:test", () => {
  describe("expect()", () => {
    test("toThrow()", () => {
      function fail() {
        throw new Error("Bad");
      }
      expect(fail).toThrow();
      expect(fail).toThrow("Bad");
      expect(fail).toThrow(/bad/i);
      expect(fail).toThrow(Error);
      expect(fail).toThrow(new Error("Bad"));
    });
  });
  test("expect()", () => {
    expect(1).toBe(1);
    expect(1).not.toBe(2);
    // @ts-expect-error
    expect({ a: 1 }).toEqual({ a: 1, b: undefined });
    expect({ a: 1 }).toStrictEqual({ a: 1 });
    expect(new Set()).toHaveProperty("size");
    expect(new Uint8Array()).toHaveProperty("byteLength", 0);
    expect([]).toHaveLength(0);
    expect(["bun"]).toContain("bun");
    expect(true).toBeTruthy();
    expect(false).toBeFalsy();
    expect(Math.PI).toBeGreaterThan(3.14);
    expect(Math.PI).toBeGreaterThan(3n);
    expect(Math.PI).toBeGreaterThanOrEqual(3.14);
    expect(Math.PI).toBeGreaterThanOrEqual(3n);
    expect(NaN).toBeNaN();
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
    expect(undefined).not.toBeDefined();
  });
});

// inference should work when data is passed directly in
test.each([
  ["a", true, 5],
  ["b", false, 1234],
])("test.each", (a, b, c) => {
  expectType<string>(a);
  expectType<boolean>(b);
  expectType<number | string>(c);
});
describe.each([
  ["a", true, 5],
  ["b", false, 5],
])("test.each", (a, b, c) => {
  expectType<string>(a);
  expectType<boolean>(b);
  expectType<number | string>(c);
});
describe.each([
  ["a", true, 5],
  ["b", false, "asdf"],
])("test.each", (a, b, c) => {
  expectType<string>(a);
  expectType<boolean>(b);
  expectType<number | string>(c);
});
describe.each([{ asdf: "asdf" }, { asdf: "asdf" }])("test.each", (a, b, c) => {
  expectType<{ asdf: string }>(a);
  expectType<{ asdf: string }>(c);
});

// no inference on data
const data = [
  ["a", true, 5],
  ["b", false, "asdf"],
];
test.each(data)("test.each", arg => {
  expectType<string | number | boolean>(arg);
});
describe.each(data)("test.each", (a, b, c) => {
  expectType<string | number | boolean>(a);
  expectType<string | number | boolean>(b);
  expectType<string | number | boolean>(c);
});

// as const
const dataAsConst = [
  ["a", true, 5],
  ["b", false, "asdf"],
] as const;

test.each(dataAsConst)("test.each", (...args) => {
  expectType<string>(args[0]);
  expectType<boolean>(args[1]);
  expectType<string | number>(args[2]);
});
describe.each(dataAsConst)("test.each", (...args) => {
  expectType<string>(args[0]);
  expectType<boolean>(args[1]);
  expectType<string | number>(args[2]);
});
describe.each(dataAsConst)("test.each", (a, b, c) => {
  expectType<"a" | "b">(a);
  expectType<boolean>(b);
  expectType<5 | "asdf">(c);
});

const mySpyOnObjectWithOptionalMethod: {
  optionalMethod?: (input: { question: string }) => { answer: string };
} = {
  optionalMethod: input => ({ answer: `Aswer to ${input.question}` }),
};

const mySpiedMethodOfOptional = spyOn(mySpyOnObjectWithOptionalMethod, "optionalMethod");
mySpiedMethodOfOptional({ question: "asdf" });
expectType<Mock<(input: { question: string }) => { answer: string }>>(mySpiedMethodOfOptional);

const myNormalSpyOnObject = {
  normalMethod: (name: string) => `Hello ${name}`,
};

const myNormalSpiedMethod = spyOn(myNormalSpyOnObject, "normalMethod");
myNormalSpiedMethod("asdf");
expectType<Mock<(name: string) => string>>(myNormalSpiedMethod);

const spy = spyOn(console, "log");
expectType(spy.mock.calls).is<[message?: any, ...optionalParams: any[]][]>();
