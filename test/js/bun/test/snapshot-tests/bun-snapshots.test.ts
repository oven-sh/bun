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

// https://github.com/oven-sh/bun/issues/3521
test("property matchers do not mutate the received object", () => {
  const date = new Date(0);
  const obj = { id: 42, when: date, nested: { name: "abc" }, list: [1, "two", 3] };
  expect(obj).toMatchSnapshot({
    id: expect.any(Number),
    when: expect.any(Date),
    nested: { name: expect.any(String) },
    list: [1, expect.any(String), 3],
  });
  expect(obj.id).toBe(42);
  expect(obj.when).toBe(date);
  expect(obj.nested.name).toBe("abc");
  expect(obj.list).toEqual([1, "two", 3]);
});

test("property matchers preserve class name and handle shared references", () => {
  class User {
    id: number;
    name: string;
    constructor() {
      this.id = 1;
      this.name = "alice";
    }
  }
  const user = new User();
  expect(user).toMatchSnapshot({ id: expect.any(Number) });
  expect(user.id).toBe(1);
  expect(user).toBeInstanceOf(User);

  const shared = { x: 1 };
  const dag = { a: shared, b: shared };
  expect(dag).toMatchSnapshot({
    a: { x: expect.any(Number) },
    b: { x: expect.any(Number) },
  });
  expect(dag.a).toBe(shared);
  expect(dag.b).toBe(shared);
  expect(shared.x).toBe(1);

  const cyclic: any = { id: 1 };
  cyclic.self = cyclic;
  expect(cyclic).toMatchSnapshot({ id: expect.any(Number) });
  expect(cyclic.id).toBe(1);
  expect(cyclic.self).toBe(cyclic);

  const err: any = new Error("boom");
  err.code = "E_FOO";
  expect(err).toMatchSnapshot({ code: expect.any(String) });
  expect(err.code).toBe("E_FOO");
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
