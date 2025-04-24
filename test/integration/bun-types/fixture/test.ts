import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { expectType } from "./utilities";

const spy = spyOn(console, "log");
expectType<any[][]>(spy.mock.calls);

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

    // @ts-expect-error
    expect({ a: 1 }).toEqual<{ a: number; b: number }>({ a: 1, b: undefined });

    // Support passing a type parameter to force exact type matching
    expect({ a: 1 }).toEqual<{ a: number; b: number }>({ a: 1, b: 1 });

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

describe("Bun.Wider matchers", () => {
  test("toBe and resolves", async () => {
    expect(5).toBe(5);
    expect("hello").toBe("hello");
    const promiseNumber = Promise.resolve(10 as number);
    await expect(promiseNumber).resolves.toBe(10);
    // @ts-expect-error
    expect(5).toBe("5");
  });

  test("toEqual and generic overload", () => {
    expect({ x: 1 }).toEqual({ x: 1 });
    expect({ x: [1, 2] }).toEqual({ x: [1, 2] });
    expect({ a: { b: true }, c: [1, "two"] }).toEqual({ a: { b: true }, c: [1, "two"] });
    expect({ x: 1 }).toEqual<{ x: number }>({ x: 1 });
    // @ts-expect-error
    expect({ x: 1 }).toEqual<{ x: string }>({ x: 1 as any });
  });

  test("toStrictEqual", () => {
    expect([{ a: 1 }]).toStrictEqual([{ a: 1 }]);
    const sym = Symbol("foo");
    expect([sym]).toStrictEqual([sym]);
    expect([{ a: 1 }]).toStrictEqual([{ a: 2 }]);
  });

  test("toBeOneOf", () => {
    expect(2).toBeOneOf([1, 2, 3]);
    expect("b").toBeOneOf(new Set(["a", "b"]));
    expect(true).toBeOneOf([false]);
  });

  test("toContain", () => {
    expect([1, 2, 3]).toContain(2);
    expect("abc").toContain("b");
    // @ts-expect-error
    expect([1, 2]).toContain("2");
  });

  test("key-based matchers", () => {
    const obj = { foo: 1, bar: 2, baz: 3 };
    expect(obj).toContainKey("foo");
    expect(obj).toContainAllKeys(["foo", "baz"]);
    expect(obj).toContainAnyKeys(["abc", "bar"]);
    expect(obj).toContainKeys(["bar", "foo"]);
    expect(obj).toContainKey("unknown");
    expect(obj).toContainAllKeys(["foo", "unknown"]);
    expect(obj).toContainAnyKeys(["unknown"]);
    // @ts-expect-error
    expect(obj).toContainKeys([1]);
  });

  test("toContainEqual", () => {
    const arr = [{ x: 1 }, { x: 2 }];
    expect(arr).toContainEqual({ x: 1 });
    expect(arr).toContainEqual({ x: 3 });
  });

  test("custom type mismatch", () => {
    interface User {
      name: string;
      age: number;
    }
    const aUser: User = { name: "Alice", age: 30 };
    expect(aUser).toBe(aUser);
    // @ts-expect-error
    expect(aUser).toBe({ name: "Bob" });
    // @ts-expect-error
    expect(aUser).toBe({ name: "Bob", age: "thirty" });
  });

  test("Set and Map types", () => {
    const numSet: Set<number> = new Set([1, 2, 3]);
    expect(numSet).toContain(2);
    // @ts-expect-error
    expect(numSet).toContain("2");
    const mapSN: Map<string, number> = new Map([["x", 10]]);
    expect(mapSN).toEqual(new Map([["x", 10]]));
    // @ts-expect-error
    expect(mapSN).toEqual(new Map([["x", "10"]]));
    expect(mapSN).toHaveProperty("size", 1);
    expect(mapSN).toHaveProperty("unknown", 1);
  });

  test("object value containment", () => {
    const nested = { a: { x: 1 }, b: { x: 2 } };
    expect(nested).toContainValue({ x: 1 });
    expect(nested).toContainValue({ x: 3 });
    expect(nested).toContainValues([{ x: 1 }, { x: 2 }]);
    expect(nested).toContainValues([{ x: 3 }]);
  });

  test("promise matchers", async () => {
    const successPromise = Promise.resolve({ data: 42 });
    const failPromise = Promise.reject(new Error("fail"));

    await expect(successPromise).resolves.toEqual({ data: 42 });
    // @ts-expect-error
    await expect(successPromise).resolves.toEqual({ data: "42" });

    await expect(failPromise).rejects.toThrow("fail");
    await expect(failPromise).rejects.toBeInstanceOf(Error);

    await expect(successPromise).rejects.toThrow();
  });

  test("WeakMap and WeakSet types", () => {
    const key1 = { id: 1 };
    const key2 = { id: 2 };
    const weakMap = new WeakMap<typeof key1, number>();

    expect(weakMap.has(key1)).toBe(true);
    expect(weakMap.get(key1)).toBe(100);
    expect(weakMap.get(key2)).toBe(100);

    const weakSet = new WeakSet<typeof key1>();
    weakSet.add(key1);
    expect(weakSet.has(key1)).toBe(true);
  });

  test("array and typed array matchers", () => {
    const arr = [1, 2, 3];
    const uint8 = new Uint8Array([1, 2, 3]);
    const float64 = new Float64Array([1.1, 2.2]);

    expect(arr).toBeArray();
    expect(arr).toBeArrayOfSize(3);
    expect(arr).toEqual(expect.arrayContaining([2, 1]));
    expect(arr).toEqual(expect.arrayContaining(["1", "2"]));

    expect(uint8).toHaveLength(3);
    expect(uint8).toContain(1);
    expect(uint8).toContain(256);
    // @ts-expect-error
    expect(uint8).toContain("cool");

    expect(float64).toHaveLength(2);
    expect(float64).toContain(1.1);
    // @ts-expect-error
    expect(float64).toContain("1.1");
  });

  test("built-in object type matchers", () => {
    const date = new Date();
    const regex = /test/;
    const error = new Error("test");
    const buffer = new ArrayBuffer(8);
    const dataView = new DataView(buffer);

    expect(date).toBeDate();
    expect(date).toBeValidDate();
    expect(date.getTime()).toBeNumber();
    // @ts-expect-error
    expect(date).toBe("2024-01-01");

    expect(regex.test("test")).toBe(true);
    expect("test").toMatch(regex);
    expect(123).toMatch(regex);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("test");
    // @ts-expect-error
    expect(error).toBe("test");

    expect(dataView.byteLength).toBe(8);
    expect(dataView.buffer).toBe(buffer);
    expect(dataView.getInt8(100)).toBeDefined();
  });

  // Custom class tests that demonstrate real-world patterns
  interface DatabaseRecord {
    id: string;
    createdAt: Date;
    updatedAt: Date;
  }

  abstract class BaseEntity implements DatabaseRecord {
    id: string;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: DatabaseRecord) {
      this.id = data.id;
      this.createdAt = data.createdAt;
      this.updatedAt = data.updatedAt;
    }

    abstract validate(): boolean;
  }

  class User extends BaseEntity {
    email: string;
    private passwordHash: string;
    roles: Set<string>;
    metadata: Map<string, unknown>;

    constructor(data: DatabaseRecord & { email: string; passwordHash: string }) {
      super(data);
      this.email = data.email;
      this.passwordHash = data.passwordHash;
      this.roles = new Set();
      this.metadata = new Map();
    }

    validate(): boolean {
      return this.email.includes("@") && this.passwordHash.length > 0;
    }

    async checkPassword(password: string): Promise<boolean> {
      // Simulate async password check
      return Promise.resolve(password === this.passwordHash);
    }

    hasRole(role: string): boolean {
      return this.roles.has(role);
    }
  }

  test("custom class type checking", () => {
    const userData = {
      id: "123",
      email: "test@example.com",
      passwordHash: "hashedpw",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const user = new User(userData);

    // Instance and inheritance checks
    expect(user).toBeInstanceOf(User);
    expect(user).toBeInstanceOf(BaseEntity);
    // @ts-expect-error - User is not a DatabaseRecord directly
    expect(user).toBeInstanceOf(DatabaseRecord);

    // Property type checking
    expect(user.email).toBeString();
    expect(user.roles).toBeInstanceOf(Set);
    expect(user.metadata).toBeInstanceOf(Map);
    // @ts-expect-error - passwordHash is private
    expect(user.passwordHash).toBeDefined();

    // Method return type checking
    expect(user.validate()).toBeBoolean();
    expect(user.hasRole("admin")).toBe(false);

    // Complex object matching
    expect(user).toEqual(
      expect.objectContaining({
        id: "123",
        email: "test@example.com",
        roles: new Set(),
        metadata: new Map(),
      }),
    );

    // Nested property type checking
    expect(user).toHaveProperty("createdAt");
    expect(user.createdAt).toBeDate();
  });

  test("custom class async operations", async () => {
    const user = new User({
      id: "123",
      email: "test@example.com",
      passwordHash: "secret123",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(user.checkPassword("secret123")).resolves.toBe(true);
    // @ts-expect-error
    await expect(user.checkPassword("wrong")).resolves.toBe("test");

    // Collection operations with type checking
    user.roles.add("admin");
    expect(user.hasRole("admin")).toBe(true);
  });
});
