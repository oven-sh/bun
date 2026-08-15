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

test("ArrayBuffer values are serialized like typed arrays", () => {
  expect(new Uint8Array([1, 2, 3]).buffer).toMatchInlineSnapshot(`
    ArrayBuffer [
      1,
      2,
      3,
    ]
  `);
  expect({ a: 1, b: new Uint8Array([4, 5]).buffer }).toMatchInlineSnapshot(`
    {
      "a": 1,
      "b": ArrayBuffer [
        4,
        5,
      ],
    }
  `);
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
  expect(obj.list[1]).toBe("two");
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

  let getterCalls = 0;
  const withGetter = {
    id: 1,
    get ts() {
      getterCalls++;
      return Date.now();
    },
  };
  expect(withGetter).toMatchSnapshot({ id: expect.any(Number) });
  expect(withGetter.id).toBe(1);
  expect(getterCalls).toBe(0);

  const inner: any = { id: 1 };
  const outer: any = { inner };
  inner.parent = outer;
  expect(outer).toMatchSnapshot({ inner: { id: expect.any(Number) } });
  expect(inner.id).toBe(1);
  expect(inner.parent).toBe(outer);
});

// The recorded snapshot must show exactly the matchers the property-matcher
// check looked at, in the same places they were looked at.
test("snapshot records the matchers that were checked", () => {
  // The propertyMatchers argument itself is never matched against the
  // received value, so it must not replace the snapshot.
  const plain = { a: 1 };
  expect(plain).toMatchSnapshot(expect.any(Object));
  expect(plain).toMatchSnapshot(expect.any(Array));

  // One received object checked through two properties, with a different
  // matcher at each: it is a single object, so it records the same everywhere.
  const shared = { x: 1, y: "s" };
  expect({ a: shared, b: shared }).toMatchSnapshot({
    a: { x: expect.any(Number) },
    b: { y: expect.any(String) },
  });
  expect(shared.x).toBe(1);
  expect(shared.y).toBe("s");

  // A matcher on a key the received object implements as a getter.
  const withGetter = {
    get id() {
      return 7;
    },
  };
  expect(withGetter).toMatchSnapshot({ id: expect.any(Number) });
  expect(withGetter.id).toBe(7);

  // Errors render as [Name: message], so a matcher on message is visible
  // through the message's string form.
  const err = new TypeError("boom");
  expect(err).toMatchSnapshot({ message: expect.any(String) });
  expect(err.message).toBe("boom");

  // Instances of native classes render by own properties like plain objects.
  const headers = new Headers({ "x-a": "1" });
  expect(headers).toMatchSnapshot({ append: expect.any(Function) });
  expect(Object.hasOwn(headers, "append")).toBe(false);
  expect(headers.get("x-a")).toBe("1");

  const event = new Event("x");
  expect(event).toMatchSnapshot({ timeStamp: expect.any(Number) });
  expect(Object.hasOwn(event, "timeStamp")).toBe(false);
  expect(typeof event.timeStamp).toBe("number");

  // Events with a dedicated rendering (message/error) fall back to the
  // by-properties rendering once a matcher is recorded on them.
  const message = new MessageEvent("message", { data: "hi" });
  expect(message).toMatchSnapshot({ data: expect.any(String) });
  expect(message.data).toBe("hi");

  // A received value that is itself a matcher still prints as that matcher.
  expect(expect.any(String)).toMatchSnapshot({});

  // A shared object referenced again from inside an object the matchers did
  // not walk keeps its real values there (as in Jest; the in-place mutation
  // used to show the matcher at both places).
  const user = { id: 7 };
  expect({ current: user, log: [{ user }] }).toMatchSnapshot({ current: { id: expect.any(Number) } });
  expect(user.id).toBe(7);

  // A cyclic received object is checked against every matcher object it is
  // paired with, so a matcher one lap into the cycle is checked and recorded.
  const ring: any = { id: 1 };
  ring.self = ring;
  expect(ring).toMatchSnapshot({ self: { self: { id: expect.any(Number) } } });
  expect(ring.id).toBe(1);
});

// The matcher is recorded on the object the getter returns, which the snapshot
// shows under the field that holds it; the getter itself is left as it was.
test("a matcher object checked through a getter is recorded on the object behind it", () => {
  class Wrapper {
    _user: { name: string };
    constructor() {
      this._user = { name: "alice" };
    }
    get user() {
      return this._user;
    }
  }
  const wrapper = new Wrapper();
  expect(wrapper).toMatchSnapshot({ user: { name: expect.any(String) } });
  expect(wrapper._user.name).toBe("alice");
  expect(Object.hasOwn(wrapper, "user")).toBe(false);

  const withOwnGetter = {
    _user: { name: "bob" },
    get user() {
      return this._user;
    },
  };
  expect(withOwnGetter).toMatchSnapshot({ user: { name: expect.any(String) } });
  expect(withOwnGetter._user.name).toBe("bob");
  expect(Object.getOwnPropertyDescriptor(withOwnGetter, "user")!.get).toBeFunction();
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
