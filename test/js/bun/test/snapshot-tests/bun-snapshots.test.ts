import { it, test, expect, describe } from "bun:test";

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
