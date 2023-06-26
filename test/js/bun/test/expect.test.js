"use strict";

/** This file is meant to be runnable in both Jest and Bun.
 *  `bunx jest mock-fn.test.js`
 */
var { isBun, test, describe, expect, jest, vi, mock, bunTest, spyOn } = require("./test-interop.js")();

describe("expect()", () => {
  test("rejects", async () => {
    await expect(Promise.reject(1)).rejects.toBe(1);

    // Different task
    await expect(
      new Promise((_, reject) => {
        setTimeout(() => reject(1), 0);
      }),
    ).rejects.toBe(1);
  });

  test("resolves", async () => {
    await expect(Promise.resolve(1)).resolves.toBe(1);

    // Different task
    await expect(
      new Promise(resolve => {
        setTimeout(() => resolve(1), 0);
      }),
    ).resolves.toBe(1);
  });

  test("can call without an argument", () => {
    expect().toBe(undefined);
  });

  test("toStrictEqual() vs toEqual()", () => {
    expect([1, , 3]).toEqual([1, , 3]);
    expect({}).toEqual({});
    expect({}).toStrictEqual({});
    expect({}).toEqual({ a: undefined });
    expect({}).not.toStrictEqual({ a: undefined });

    class C {
      hi = 34;
    }
    class D {
      hi = 34;
    }
    let c = new C();
    let d = new D();

    expect(d).toEqual(c);
    expect(d).not.toStrictEqual(c);
    expect({ a: 1, b: undefined }).toEqual({ a: 1 });
    expect({ a: 1 }).toEqual({ a: 1, b: undefined });
    expect({ a: 1, b: undefined }).toEqual({ a: 1, b: undefined });

    expect({ a: 1, b: undefined }).not.toStrictEqual({ a: 1 });
    expect({ a: 1 }).not.toStrictEqual({ a: 1, b: undefined });
    expect({ a: 1, b: undefined }).toStrictEqual({ a: 1, b: undefined });

    expect({ a: 1, b: null }).not.toEqual({ a: 1 });
    expect({ a: 1 }).not.toEqual({ a: 1, b: null });
    expect({ a: 1, b: null }).toEqual({ a: 1, b: null });

    expect({ a: 1 }).not.toEqual({ a: true });
    expect({ a: 1 }).not.toEqual({ a: "1" });
    expect({ a: 1 }).not.toEqual({ a: 1, b: 2 });
    expect({ a: 1, b: 2 }).not.toEqual({ a: 1 });
    expect({ a: 1 }).not.toStrictEqual({ a: true });
    expect({ a: 1 }).not.toStrictEqual({ a: "1" });
    expect({ a: 1 }).not.toStrictEqual({ a: 1, b: 2 });
    expect({ a: 1, b: 2 }).not.toStrictEqual({ a: 1 });
    expect({ a: 1 }).toStrictEqual({ a: 1 });

    expect([1, undefined, 3]).toEqual([1, undefined, 3]);
    expect([1, undefined, 3]).toStrictEqual([1, undefined, 3]);
    expect([1, undefined, 3]).not.toEqual([1, 2, 3]);
    expect([1, undefined, 3]).not.toStrictEqual([1, 2, 3]);
    expect([1, undefined, 3]).not.toEqual([1, 2]);
    expect([1, undefined, 3]).not.toStrictEqual([1, 2]);
    expect([1, undefined, 3]).not.toEqual([1]);
    expect([1, undefined, 3]).not.toStrictEqual([1]);
    expect([1, undefined, 3]).not.toEqual([]);
    expect([1, undefined, 3]).not.toStrictEqual([]);
    expect([1, undefined, 3]).not.toEqual([1, 3]);
    expect([1, undefined, 3]).not.toStrictEqual([1, 3]);

    expect([1, null, 3]).toEqual([1, null, 3]);
    expect([1, null, 3]).toStrictEqual([1, null, 3]);
    expect([1, null, 3]).not.toEqual([1, 2, 3]);
    expect([1, null, 3]).not.toStrictEqual([1, 2, 3]);
    expect([1, null, 3]).not.toEqual([1, 2]);
    expect([1, null, 3]).not.toStrictEqual([1, 2]);
    expect([1, null, 3]).not.toEqual([1]);
    expect([1, null, 3]).not.toStrictEqual([1]);
    expect([1, null, 3]).not.toEqual([]);
    expect([1, null, 3]).not.toStrictEqual([]);
    expect([1, null, 3]).not.toEqual([1, 3]);
    expect([1, null, 3]).not.toStrictEqual([1, 3]);

    expect([, 1]).toEqual([, 1]);
    expect([, 1]).toStrictEqual([, 1]);
    expect([, 1]).not.toEqual([1]);
    expect([1]).not.toEqual([, 1]);
    expect([, 1]).not.toStrictEqual([1]);
    expect([1]).not.toStrictEqual([, 1]);
    expect([, 1]).toEqual([undefined, 1]);
    expect([, 1]).not.toStrictEqual([undefined, 1]);
    expect([, 1]).not.toEqual([null, 1]);
    expect([, 1]).not.toStrictEqual([null, 1]);
    expect([undefined, 1]).toEqual([, 1]);
    expect([undefined, 1]).not.toStrictEqual([, 1]);
    expect([null, 1]).not.toEqual([, 1]);
    expect([null, 1]).not.toStrictEqual([, 1]);
    expect([undefined, 1]).toEqual([undefined, 1]);
    expect([undefined, 1]).toStrictEqual([undefined, 1]);

    expect([0, , 2]).toEqual([0, undefined, 2]);
    expect([, "boo2"]).toEqual([undefined, "boo2"]);
    expect([, "boo"]).toEqual([, "boo"]);
    expect([, 1]).toEqual([undefined, 1]);

    const s1 = Symbol("test1");
    const s2 = Symbol("test2");

    let a = { a: 1, b: 2 };
    let b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = null;
    expect(a).not.toEqual(b);
    class F extends String {
      constructor() {
        super();
      }
    }

    let f = new F("hello");
    let j = new String("hello");
    expect(f).not.toEqual(j);
    class LaCroix {
      constructor(flavor) {
        this.flavor = flavor;
      }
    }
    expect(new LaCroix("pamplemousse")).not.toStrictEqual({
      flavor: "pamplemousse",
    });
    expect(new LaCroix("pamplemousse")).toEqual({ flavor: "pamplemousse" });

    expect([, 1]).not.toStrictEqual([undefined, 1]);

    expect([0, , 2]).toEqual([0, undefined, 2]);
    expect([, "boo2"]).toEqual([undefined, "boo2"]);
    expect([, "boo"]).toEqual([, "boo"]);
    expect([, 1]).toEqual([undefined, 1]);
  });

  describe("BigInt", () => {
    it("compares correctly (literal)", () => {
      expect(42n).toBe(42n);
    });

    it("compares correctly (object)", () => {
      expect(BigInt(42n)).toBe(BigInt(42n));
      expect(42n).toBe(BigInt(42n));
      if (isBun) expect(BigInt(Bun.inspect(42n).substring(0, 2))).toBe(BigInt(42n));
      expect(BigInt(42n).valueOf()).toBe(BigInt(42n));
    });
  });

  function f1() {
    return "hello!";
  }
  function f2() {
    return "hey!";
  }
  test("deepEquals regex", () => {
    expect(/a/imu).toEqual(/a/imu);
    expect(/a/imu).not.toEqual(/ab/imu);

    expect(new RegExp("s", "g")).toEqual(new RegExp("s", "g"));
    expect(new RegExp("s", "g")).not.toEqual(new RegExp("s", "i"));
  });

  test("deepEquals works with accessors", () => {
    {
      let l1 = [1, undefined, 2];
      let l2 = [1, undefined, 2];
      Object.defineProperty(l1, 6, { get: () => 1 });
      Object.defineProperty(l2, 6, { get: () => 1 });
      expect(l1).toEqual(l2);
      expect(l1).toStrictEqual(l2);
    }
    {
      let l1 = [1, , 2];
      let l2 = [1, undefined, 2];
      Object.defineProperty(l1, 6, { get: () => 1 });
      Object.defineProperty(l2, 6, { get: () => 2 });
      expect(l1).toEqual(l2);
      expect(l1).not.toStrictEqual(l2);
    }
    {
      let l1 = [1, , 2];
      let l2 = [1, , 2];
      Object.defineProperty(l1, "hi", { get: () => 4 });
      Object.defineProperty(l2, "hi", { get: () => 5 });
      expect(l1).toEqual(l2);
      expect(l1).toStrictEqual(l2);
    }

    {
      let l1 = [1, , 2];
      let l2 = [1, , 2];
      Object.defineProperty(l1, "hi", { set: () => 4 });
      Object.defineProperty(l2, "hi", { set: () => 5 });
      expect(l1).toEqual(l2);
      expect(l1).toStrictEqual(l2);
    }

    {
      let o1 = { a: 1, c: undefined, b: 2 };
      let o2 = { a: 1, c: undefined, b: 2 };
      Object.defineProperty(o1, 6, { get: () => 1 });
      Object.defineProperty(o2, 6, { get: () => 1 });
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { a: 1, c: undefined, b: 2 };
      let o2 = { a: 1, c: undefined, b: 2 };
      Object.defineProperty(o1, 6, { get: () => 1 });
      Object.defineProperty(o2, 6, { get: () => 2 });
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { a: 1, c: undefined, b: 2 };
      let o2 = { a: 1, c: undefined, b: 2 };
      Object.defineProperty(o1, "hi", { get: () => 4 });
      Object.defineProperty(o2, "hi", { get: () => 5 });
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }

    {
      let o1 = { a: 1, c: undefined, b: 2 };
      let o2 = { a: 1, c: undefined, b: 2 };
      Object.defineProperty(o1, "hi", { set: () => 4 });
      Object.defineProperty(o2, "hi", { set: () => 5 });
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
  });

  // Doesn't work on jest because of https://github.com/jestjs/jest/issues/10788
  if (isBun) {
    test("deepEquals works with proxies", () => {
      {
        let p1 = new Proxy({ a: 1, b: 2 }, {});
        let p2 = new Proxy({ a: 1, b: 2 }, {});
        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);
        let p3 = new Proxy({ a: 1, b: 2 }, {});
        let p4 = new Proxy({ a: 1, b: 3 }, {});
        expect(p3).not.toEqual(p4);
        expect(p3).not.toStrictEqual(p4);
      }
      {
        let t1 = { a: 1, b: 2 };
        let h1 = { get: (t, k) => t[k] };
        let p1 = new Proxy(t1, h1);
        let t2 = { a: 1, b: 2 };
        let h2 = { get: (t, k) => 0 };
        let p2 = new Proxy(t2, h2);
        expect(p1).not.toEqual(p2);
        expect(p1).not.toStrictEqual(p2);
      }
      {
        let t1 = { a: 1, b: 2 };
        let h1 = { get: (t, k) => t[k] + 2 };
        let p1 = new Proxy(t1, h1);
        let t2 = { a: 1, b: 2 };
        let h2 = { get: (t, k) => t[k] + 2 };
        let p2 = new Proxy(t2, h2);
        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);
      }
      {
        let t1 = { a: 1, b: 2 };
        let h1 = { get: (t, k) => t[k] + 2 };
        let p1 = new Proxy(t1, h1);
        let t2 = { a: 1, b: 2 };
        let h2 = { get: (t, k) => t[k] + 3 };
        let p2 = new Proxy(t2, h2);
        expect(p1).not.toEqual(p2);
        expect(p1).not.toStrictEqual(p2);
      }
      {
        // same handlers, different targets
        let t1 = { a: 1, b: 2 };
        let t2 = { a: 1, b: 2 };
        let h1 = { get: (t, k) => t[k] + 2 };
        let p1 = new Proxy(t1, h1);
        let p2 = new Proxy(t2, h1);
        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);
      }
      {
        // same targets, different handlers
        let t1 = { a: 1, b: 2 };
        let h1 = { get: (t, k) => t[k] + 2 };
        let h2 = { get: (t, k) => t[k] + 3 };
        let p1 = new Proxy(t1, h1);
        let p2 = new Proxy(t1, h2);
        expect(p1).not.toEqual(p2);
        expect(p1).not.toStrictEqual(p2);
      }
      {
        // property with object
        let t1 = { a: { b: 3 } };
        let h1 = { get: (t, k) => t[k] };
        let p1 = new Proxy(t1, h1);

        let t2 = { a: { b: 3 } };
        let h2 = { get: (t, k) => t[k] };
        let p2 = new Proxy(t2, h2);

        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);

        let t3 = { a: { b: 3 } };
        let h3 = { get: (t, k) => t[k] };
        let p3 = new Proxy(t3, h3);

        let t4 = { a: { b: 4 } };
        let h4 = { get: (t, k) => t[k] };
        let p4 = new Proxy(t4, h4);

        expect(p3).not.toEqual(p4);
        expect(p3).not.toStrictEqual(p4);
      }
      {
        // proxy object equals itself
        let t1 = { a: 1, b: 2 };
        let h1 = { get: (t, k) => t[k] + 2 };
        let p1 = new Proxy(t1, h1);
        expect(p1).toEqual(p1);
        expect(p1).toStrictEqual(p1);
      }
      {
        let t1 = { a: 1, b: 2 };
        let h1 = { get: (t, k) => k };
        let p1 = new Proxy(t1, h1);

        let t2 = { a: 1, b: 2 };
        let h2 = { get: (t, k) => k };
        let p2 = new Proxy(t2, h2);

        expect(p1).toEqual(p2);
        expect(p1).toStrictEqual(p2);
      }
    });
  }

  test("deepEquals works with sets/maps/dates/strings", () => {
    const f = Symbol.for("foo");

    let a = new Set();
    a.add([1, 2, 3]);
    a.add("hello");
    a.add({ a: 1 });
    a.add(89);

    let b = new Set();
    b.add(89);
    b.add({ a: 1 });
    b.add("hello");
    b.add([1, 2, 3]);

    expect(a).toEqual(b);
    expect(b).toEqual(a);
    expect(b).toEqual(b);

    let obj = {};
    var c = new Set();
    obj.c = c;
    obj.x = obj;
    c.add(obj);
    expect(obj).toEqual(obj);

    let o1 = { a: new Set() };
    o1.a.add(o1);
    expect(o1).toEqual(o1);

    let o2 = new Set();
    let o3 = {};
    o3.x = o3;
    o2.add(o3);
    expect(o2).toEqual(o2);

    var d = new Date();
    var e = new Date(d);
    e[f] = "hello";

    expect(d).toEqual(e);
    expect(e).toEqual(d);

    class Date2 extends Date {
      constructor() {
        super(...arguments);
      }
    }

    class Date3 extends Date2 {
      constructor() {
        super(...arguments);
      }
    }

    let d2 = new Date2();
    let e2 = new Date(d2);
    d2[f] = "hello";
    expect(d2).toEqual(e2);
    expect(e2).toEqual(d2);

    let d3 = new Date3();
    let e3 = new Date(d3);
    d3[f] = "hello";
    expect(d3).toEqual(e3);
    expect(e3).toEqual(d3);

    let d4 = new Date();
    let e4 = new Date3(d4);
    d4[f] = "hello";
    expect(d4).toEqual(e4);
    expect(e4).toEqual(d4);

    let d5 = new Date2();
    let e5 = new Date3(d5);
    d5[f] = "hello";
    expect(d5).toEqual(e5);
    expect(e5).toEqual(d5);

    expect(new String("a")).not.toEqual(new String("b"));

    var s1 = new String("a");
    var s2 = new String("a");
    s1[f] = "hello";
    expect(s1).toEqual(s2);

    class String2 extends String {
      constructor() {
        super(...arguments);
      }
    }

    class String3 extends String2 {
      constructor() {
        super(...arguments);
      }
    }

    let string4 = {};
    string4.__proto__ = String3.prototype;

    var s3 = new String2("a");
    var s4 = new String2("a");
    s3[f] = "hello";
    expect(s3).toEqual(s4);

    var s5 = new String("a");
    var s6 = new String3("a");
    expect(s6).not.toEqual(s5);
    expect(s5).not.toEqual(s6);

    var s7 = new String2("a");
    var s8 = new String3("a");
    expect(s7).not.toEqual(s8);
    expect(s8).not.toEqual(s7);

    var s9 = new String2("a");
    var s10 = new string4.constructor("a");
    expect(s9).not.toEqual(s10);
    expect(s10).not.toEqual(s9);

    class F2 extends Function {}
    class F3 extends F2 {}

    var f1 = new Function();
    var f2 = new F2();
    var f3 = new F3();
    expect(f1).not.toEqual(f2);
    expect(f2).not.toEqual(f1);
    expect(f2).not.toEqual(f3);
    expect(f3).not.toEqual(f2);
  });

  describe("deepEquals with asymmetric matchers", () => {
    it("should accept any string", () => {
      expect({ name: "alice" }).toEqual({ name: expect.any(String) });
      expect({ name: "bob" }).toEqual({ name: expect.any(String) });
      expect({ name: "charlie" }).toEqual({ name: expect.any(String) });
    });

    it("should accept any number", () => {
      expect({ age: 42 }).toEqual({ age: expect.any(Number) });
      expect({ age: 69 }).toEqual({ age: expect.any(Number) });
      expect({ age: 73 }).toEqual({ age: expect.any(Number) });
    });

    it("should accept any boolean", () => {
      expect({ active: false }).toEqual({ active: expect.any(Boolean) });
      expect({ active: true }).toEqual({ active: expect.any(Boolean) });
    });

    it("should not match the wrong constructors", () => {
      function f() {
        return 32;
      }
      Object.defineProperty(f, "name", { value: "String" });
      expect({ a: "123" }).toEqual({ a: expect.any(String) });
      expect({ a: "123" }).not.toEqual({ a: expect.any(f) });

      function g() {
        return 32;
      }
      Object.defineProperty(g, "name", { value: "BigInt" });
      expect({ a: 123n }).toEqual({ a: expect.any(BigInt) });
      expect({ a: 123n }).not.toEqual({ a: expect.any(g) });
    });
  });

  test("toThrow", () => {
    expect(() => {
      throw new Error("hello");
    }).toThrow("hello");

    var err = new Error("bad");
    expect(() => {
      throw err;
    }).toThrow(err);

    expect(() => {
      throw new Error("good");
    }).toThrow();

    expect(() => {
      throw new Error("foo");
    }).toThrow(/oo/);

    expect(() =>
      expect(() => {
        throw new Error("bar");
      }).toThrow(/baz/),
    ).toThrow("/baz/");

    expect(() => {
      return true;
    }).not.toThrow();

    expect(() => {
      return true;
    }).not.toThrow(err);

    const weirdThings = [
      /watttt/g,
      BigInt(123),
      -42,
      NaN,
      Infinity,
      -Infinity,
      undefined,
      null,
      true,
      false,
      0,
      1,
      "",
      "hello",
      {},
      [],
      new Date(),
      new Error(),
      new RegExp("foo"),
      new Map(),
      new Set(),
      Promise.resolve(),
      Promise.reject(Symbol("123")).finally(() => {}),
      Symbol("123"),
    ];
    for (const weirdThing of weirdThings) {
      expect(() => {
        throw weirdThing;
      }).toThrow();
    }

    err.message = "null";
    expect(() => {
      throw null;
    }).toThrow(err);
  });

  test("deepEquals derived strings and strings", () => {
    let a = new String("hello");
    let b = "hello";
    expect(a).toEqual(a);
    expect(b).toEqual(b);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    class F extends String {
      constructor() {
        super();
      }
    }

    let f = new F("hello");
    expect(f).toEqual(f);
    expect(f).not.toEqual(b);
    expect(b).not.toEqual(f);

    let j = new String("hello");
    expect(f).not.toEqual(j);

    class G extends String {
      constructor() {
        super();
        this.x = 0;
      }
    }

    let g = new G("hello");
    expect(g).not.toEqual(f);
    expect(f).not.toEqual(g);
    expect(g).toEqual(g);
    expect(g).not.toEqual(b);
    expect(b).not.toEqual(g);
    expect(g).not.toEqual(a);
  });

  test("deepEquals throw getters", () => {
    let a = {
      get x() {
        throw new Error("a");
      },
    };

    let b = {
      get x() {
        return 3;
      },
    };

    try {
      expect(a).not.toEqual(b);
    } catch (e) {
      expect(e.message).toContain("a");
    }

    class B {
      get x() {
        throw new Error("b");
      }
    }

    class C {
      get x() {
        return 3;
      }
    }

    expect(() => {
      expect(new B()).not.toEqual(new C());
    }).toThrow();

    let o = [
      {
        get x() {
          throw new Error("c");
        },
      },
    ];

    let p = [
      {
        get x() {
          return 3;
        },
      },
    ];

    try {
      expect(o).not.toEqual(p);
    } catch (e) {
      expect(e.message).toContain("c");
    }

    const s = Symbol("s");
    let q = {
      get x() {
        throw new Error("d");
      },
    };
    q[s] = 3;

    let r = {
      get x() {
        return 3;
      },
    };
    r[s] = 3;

    try {
      expect(q).not.toEqual(r);
    } catch (e) {
      expect(e.message).toContain("d");
    }
  });

  test("deepEquals large object", () => {
    let o = {};
    for (let i = 0; i < 65; i++) {
      o["bun" + i] = i;
    }
    expect(o).toEqual(o);
    let b = {};
    for (let i = 0; i < 63; i++) {
      b["bun" + i] = i;
    }
    expect(b).toEqual(b);
    expect(o).not.toEqual(b);
    expect(b).not.toEqual(o);

    let c = { d: [Array(o)] };
    let d = { d: [Array(b)] };
    expect(c).toEqual(c);
    expect(d).toEqual(d);
    expect(c).not.toEqual(d);
    expect(d).not.toEqual(c);

    let e = { d: [Array(o), Array(o)] };
    let f = { d: [Array(b), Array(b)] };
    expect(e).toEqual(e);
    expect(f).toEqual(f);
    expect(e).not.toEqual(f);
    expect(f).not.toEqual(e);

    let p = [];
    p[0] = {};
    for (let i = 0; i < 1000; i++) {
      p[0]["bun" + i] = i;
    }
    let q = [];
    q[0] = {};
    for (let i = 0; i < 1000; i++) {
      q[0]["bun" + i] = i;
    }
    expect(p).toEqual(p);
    expect(q).toEqual(q);

    q[0].bun789 = 788;
    expect(p).not.toEqual(q);
    expect(q).not.toEqual(p);

    let r = { d: {} };
    let s = { d: {} };
    for (let i = 0; i < 1000; i++) {
      r.d["bun" + i] = i;
      s.d["bun" + i] = i;
    }

    expect(r).toEqual(r);
    expect(s).toEqual(s);

    r.d.bun790 = 791;
    expect(r).not.toEqual(s);
    expect(s).not.toEqual(r);

    let t = [];
    t[5] = {};
    let u = [];
    u[5] = {};
    for (let i = 0; i < 1000; i++) {
      t[5]["bun" + i] = i;
    }
    for (let i = 0; i < 30; i++) {
      u[5]["bun" + i] = i;
    }
    expect(t).toEqual(t);
    expect(u).toEqual(u);
    expect(t).not.toEqual(u);
    expect(u).not.toEqual(t);

    let v = { j: {} };
    let w = { j: {} };
    for (let i = 0; i < 1000; i++) {
      v.j["bun" + i] = i;
      w.j["bun" + i] = i;
    }

    expect(v).toEqual(v);
    expect(w).toEqual(w);

    v.j.bun999 = 1000;
    expect(v).not.toEqual(w);
    expect(w).not.toEqual(v);
    expect(v).toEqual(v);

    v.j.bun999 = 999;
    w.j.bun0 = 1;
    expect(v).not.toEqual(w);
    expect(w).not.toEqual(v);
    expect(v).toEqual(v);
    expect(w).toEqual(w);
  });

  test("deepEquals - Date", () => {
    let d = new Date();
    expect(d).toEqual(d);
    let b = d;
    expect(b).toEqual(d);
    d.setFullYear(1998);
    expect(b).toEqual(d);
    expect(b).not.toEqual(new Date());

    var date = new Date();
    date.setFullYear(1995);
    expect(new Date()).not.toEqual(date);
  });

  test("deepEquals toString and functions", () => {
    expect({ toString: f1 }).toEqual({
      toString: f1,
    });
    expect({ toString: f1 }).not.toEqual({
      toString: f2,
    });

    expect(f1).toEqual(f1);
    expect(f1).not.toEqual(f2);
  });

  test("deepEquals set and map", () => {
    let e = new Map();
    e.set("a", 1);
    e.set("b", 2);
    e.set("c", 3);
    e.set(8, 6);

    let d = new Map();
    d.set("a", 1);
    d.set("b", 2);
    d.set("c", 3);
    d.set(8, 6);

    expect(e).toEqual(d);
    expect(d).toEqual(e);

    let f = new Map();
    f.set("a", 1);
    f.set("b", 2);
    f.set("c", 3);
    f.set(8, 7);
    expect(e).not.toEqual(f);

    let g = new Map();
    g.set({ a: { b: { c: 89 } } }, 1);

    let h = new Map();
    h.set({ a: { b: { c: 89 } } }, 1);
    expect(g).toEqual(h);

    let i = new Map();
    i.set({ a: { b: { c: 89 } } }, 1);
    i.set({ a: { b: { c: 89 } } }, 1);
    expect(g).not.toEqual(i);

    let j = new Map();
    j.set({ a: { b: { c: 89 } } }, 1);
    j.set({ a: { b: { c: 89 } } }, 1);
    expect(i).toEqual(j);

    let p = new Map();
    p.set({ a: { b: { c: 90 } } }, 1);
    expect(p).not.toEqual(g);

    let q = new Map();
    q.set({ a: { b: { c: 90 } } }, { a: { b: 45 } });

    let r = new Map();
    r.set({ a: { b: { c: 90 } } }, { a: { b: 45 } });
    expect(q).toEqual(r);

    let s = new Map();
    s.set({ a: { b: { c: 90 } } }, { a: { b: 49 } });
    expect(q).not.toEqual(s);

    const u = { a: 1, b: 2 };

    let a = new Set();
    a.add({ a: 1 });
    a.add([1, 2, 3]);
    a.add("hello");
    a.add(89);

    let b = new Set();
    b.add({ a: 1 });
    b.add("hello");
    b.add([1, 2, 3]);
    b.add(89);
    expect(a).toEqual(b);
    expect(b).toEqual(a);
    let c = new Set();
    c.add(89);
    c.add("hello");
    c.add({ a: 1 });
    c.add([1, 2, 3, 4]);
    expect(a).not.toEqual(c);
  });

  test("deepEquals - symbols", () => {
    const x = [5, 6];
    x[99] = 7;

    const y = [5, 6];
    y[99] = 7;

    expect(x).toEqual(y);

    const s1 = Symbol("test1");
    const s2 = Symbol("test2");

    const o = { a: 1 };
    o[s1] = 45;
    o[99] = 99;
    o[s2] = 3;

    const k = { a: 1 };
    k[99] = 99;
    k[s2] = 3;
    k[s1] = 45;

    expect(o).toEqual(k);
  });

  test("deepEquals should not segfault", () => {
    const obj = { ...Object.fromEntries(Object.entries([1, 2, 3, 4])), length: 4 };
    expect(() => {
      expect(obj).toEqual([1, 2, 3, 4]);
    }).toThrow();
    expect(() => {
      expect([1, 2, 3, 4]).toEqual(obj);
    }).toThrow();
  });

  test("toEqual objects and arrays", () => {
    {
      let obj = { 0: 4, 1: 3, length: 2 };
      expect(Array.from(obj)).toEqual([4, 3]);
      expect(Array.from(obj)).toStrictEqual([4, 3]);
    }
    {
      let obj = { 0: 4, 1: 3, length: 4 };
      expect(Array.from(obj)).toEqual([4, 3]);
      expect(Array.from(obj)).not.toStrictEqual([4, 3]);
      expect(Array.from(obj)).toEqual([4, 3, undefined, undefined]);
      expect(Array.from(obj)).toStrictEqual([4, 3, undefined, undefined]);
      expect(Array.from(obj)).toEqual([4, 3, , ,]);
      expect(Array.from(obj)).not.toStrictEqual([4, 3, , ,]);
    }
    {
      let a1 = [1, undefined, 3, , 4, null];
      let a2 = [1, undefined, 3, , 4, null, , ,];
      expect(a1).toEqual(a2);
      expect(a1).not.toStrictEqual(a2);
      expect(a2).toEqual(a1);
      expect(a2).not.toStrictEqual(a1);
    }
    {
      let a1 = [, , , , , , , , , , , ,];
      let a2 = [undefined];
      expect(a1).toEqual(a2);
      expect(a1).not.toStrictEqual(a2);
      expect(a2).toEqual(a1);
      expect(a2).not.toStrictEqual(a1);
    }
    {
      const a = [1];
      const b = [1];
      expect(a).toEqual(b);
      Object.preventExtensions(b);
      expect(a).toEqual(b);
      Object.preventExtensions(a);
      expect(a).toEqual(b);
    }
    {
      let o1 = { 1: 4, 6: 3 };
      let o2 = { 1: 4, 6: 3 };
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { 1: 4, 6: 2 };
      let o2 = { 1: 4, 6: 3 };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }

    {
      let o1 = { a: 1, 3: 0 };
      let o2 = { a: 1, 3: 0 };
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { a: 1, 3: 0 };
      let o2 = { a: 1, 3: 1 };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }
    {
      let o1 = { a: {}, 4: { b: 3, c: { 9: 2 } } };
      let o2 = { a: {}, 4: { b: 3, c: { 9: 2 } } };
      expect(o1).toEqual(o2);
      expect(o1).toStrictEqual(o2);
    }
    {
      let o1 = { a: {}, 4: { b: 3, c: { 9: 2 } } };
      let o2 = { a: {}, 4: { b: 3, c: { 9: 3 } } };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }

    {
      let o1 = { a: 1, b: 2, c: 3 };
      let o2 = { a: 1, b: 2, c: 3, 0: 1 };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }

    {
      let o1 = { a: 1, b: 2, c: 3, 0: 1 };
      let o2 = { a: 1, b: 2, c: 3 };
      expect(o1).not.toEqual(o2);
      expect(o1).not.toStrictEqual(o2);
    }

    expect("hello").toEqual("hello");
    const s1 = Symbol("test1");
    const s2 = Symbol("test2");

    expect({ a: 1, b: 2 }).toEqual({ b: 2, a: 1 });
    expect([1, 2, 3]).toEqual([1, 2, 3]);
    expect({ a: 1, b: 2 }).not.toEqual({ b: 2, a: 1, c: 3 });
    expect([1, 2, 3]).not.toEqual([1, 2, 3, 4]);
    expect({ a: 1, b: 2, c: 3 }).not.toEqual({ a: 1, b: 2 });
    expect([1, 2, 3, 4]).not.toEqual([1, 2, 3]);

    let a = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    let b = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    expect(a).toEqual(b);
    expect(b).toEqual(a);
    a[0].a = 2;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    let c = { [Symbol("test")]: 1 };
    let d = { [Symbol("test")]: 1 };
    expect(c).not.toEqual(d);
    expect(d).not.toEqual(c);

    a = { [s1]: 1 };
    a[s1] = 1;
    b = { [s2]: 1 };
    b[s2] = 1;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    a = {};
    b = {};
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = {};
    b = {};
    a[s1] = 1;
    b[s1] = 2;
    expect(a).not.toEqual(b);

    a = {};
    b = {};
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 2;
    expect(a).toEqual(b);

    a = {};
    b = {};
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 3;
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = { a: 2, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    expect(a).not.toEqual(b);

    // do the same tests for arrays
    a = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    b = [{ a: 1 }, { b: 2, c: 3, d: 4 }, { e: 5, f: 6 }];
    expect(a).toEqual(b);
    expect(b).toEqual(a);
    a[0].a = 2;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 2;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 2;
    expect(a).toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 3;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = [2, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    expect(a).not.toEqual(b);

    // do the same tests for objects and arrays with null and undefined
    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = null;
    b[s2] = undefined;
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = null;
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = null;
    b[s2] = null;
    expect(a).toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = undefined;
    expect(a).toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = null;
    b[s2] = undefined;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = null;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = null;
    b[s2] = null;
    expect(a).toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3];
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = undefined;
    b[s2] = undefined;
    expect(a).toEqual(b);

    // similar tests for indexed objects
    a = { 0: 1, 1: 2, 2: 3 };
    b = { 0: 1, 1: 2, 2: 3 };
    a[s1] = 1;
    b[s1] = 1;
    expect(a).toEqual(b);

    a = { 0: 1, 1: 2, 2: 3 };
    b = { 0: 1, 1: 2, 2: 3 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 3;
    expect(a).not.toEqual(b);

    a = { 0: 1, 1: 3, 2: 3 };
    b = { 0: 1, 1: 2, 2: 3 };
    a[s1] = 1;
    b[s1] = 1;
    a[s2] = 2;
    b[s2] = 2;
    expect(a).not.toEqual(b);

    a = [1, 2, 3];
    b = [1, 2, 3, 4];
    expect(a).not.toEqual(b);

    a = [1, 2, 3, 4];
    b = [1, 2, 3];
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2 };
    b = { a: 1, b: 2, c: 3 };
    expect(a).not.toEqual(b);

    a = { a: 1, b: 2, c: 3 };
    b = { a: 1, b: 2 };
    expect(a).not.toEqual(b);
  });

  test("symbol based keys in arrays are processed correctly", () => {
    const mySymbol = Symbol("test");

    const actual1 = [];
    actual1[mySymbol] = 3;

    const actual2 = [];
    actual2[mySymbol] = 4;

    const expected = [];
    expected[mySymbol] = 3;

    expect(actual2).not.toEqual(expected);
    expect(actual1).toEqual(expected);
  });

  test("non-enumerable members should be skipped during equal", () => {
    const actual = {
      x: 3,
    };
    Object.defineProperty(actual, "test", {
      enumerable: false,
      value: 5,
    });
    expect(actual).toEqual({ x: 3 });
  });

  test("non-enumerable symbolic members should be skipped during equal", () => {
    const actual = {
      x: 3,
    };
    const mySymbol = Symbol("test");
    Object.defineProperty(actual, mySymbol, {
      enumerable: false,
      value: 5,
    });
    expect(actual).toEqual({ x: 3 });
  });

  test("properties with the same circularity are equal", () => {
    const a = {};
    a.x = a;
    const b = {};
    b.x = b;
    expect(a).toEqual(b);
    expect(b).toEqual(a);

    const c = {
      x: a,
    };
    const d = {
      x: b,
    };

    expect(d).toEqual(c);
    expect(c).toEqual(d);
  });

  test("toEqual() - arrays", () => {
    expect([1, 2, 3]).toEqual([1, 2, 3]);
    expect([1, 2, 3, 4]).not.toEqual([1, 2, 3]);
  });

  test("properties with different circularity are not equal", () => {
    const a = {};
    a.x = { y: a };
    const b = {};
    const bx = {};
    b.x = bx;
    bx.y = bx;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    const c = {};
    c.x = a;
    const d = {};
    d.x = b;
    expect(c).not.toEqual(d);
    expect(d).not.toEqual(c);
  });

  test("are not equal if circularity is not on the same property", () => {
    const a = {};
    const b = {};
    a.a1 = a;
    b.a1 = {};
    b.a1.a1 = a;

    expect(a).not.toEqual(b);
    expect(b).not.toEqual(a);

    const c = {};
    c.x = { x: c };
    const d = {};
    d.x = d;

    expect(d).not.toEqual(c);
    expect(c).not.toEqual(d);
  });

  test("random isEqual tests", () => {
    expect(1).toEqual(1);
    expect(1).not.toEqual(2);
    expect(1).not.toEqual("1");
    expect(1).not.toEqual(true);
    expect(1).not.toEqual(false);
    expect(1).not.toEqual(null);
    expect(1).not.toEqual(undefined);
    expect(1).not.toEqual({});
    expect(1).not.toEqual([]);
    expect(1).not.toEqual([1]);
    expect(1).not.toEqual([1, 2]);
    expect(1).not.toEqual([1, 2, 3]);
    expect(1).not.toEqual([1, 2, 3, 4]);
    expect(1).not.toEqual([1, 2, 3, 4, 5]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(1).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // test toEquals for objects with getters and setters

    expect([]).toEqual([]);
    expect([1]).toEqual([1]);
    expect([1, 2]).toEqual([1, 2]);
    expect([1, 2, 3]).toEqual([1, 2, 3]);
    expect({}).toEqual({});
    expect({}).not.toEqual([]);
    expect([]).not.toEqual({});

    const obj = {
      get a() {
        return 1;
      },
    };
    expect(obj).toEqual({ a: 1 });
    expect({ a: 1 }).toEqual(obj);
    expect(obj).not.toEqual({ a: 2 });
    expect({ a: 2 }).not.toEqual(obj);

    let a = new Set();
    a.add([1, 2, 3]);
    a.add("hello");
    a.add({ a: 1 });
    a.add(89);
    let b = new Set();
    b.add(89);
    b.add({ a: 1 });
    b.add("hello");
    b.add([1, 2, 3]);
    expect(a).toEqual(b);
    expect(b).toEqual(a);
    let c = new Set();
    c.add(89);
    c.add("helo");
    c.add({ a: 1 });
    c.add([1, 2, 3]);
    expect(a).not.toEqual(c);

    a = new Map();
    a.set(1, 89);
    a.set("hello", 2);
    a.set({ a: 1 }, 3);
    a.set([1, 2, 3], 4);
    b = new Map();
    b.set(1, 89);
    b.set("hello", 2);
    b.set({ a: 1 }, 3);
    b.set([1, 2, 3], 4);
    expect(a).toEqual(b);
    expect(b).toEqual(a);
    c = new Map();
    c.set({ a: 1 }, 3);
    c.set(1, 80);
    c.set([1, 2, 3], 4);
    c.set("hello", 2);
    expect(a).not.toEqual(c);

    a = new Set();
    a.add(89);
    a.add("hello");
    a.add({ a: 1 });
    a.add([1, 2, 3]);
    a.add(a);
    b = new Set();
    b.add(89);
    b.add("hello");
    b.add(b);
    b.add({ a: 1 });
    b.add([1, 2, 3]);
    expect(a).toEqual(b);
    expect(b).toEqual(a);
  });
  test("toHaveProperty() - emojis", () => {
    expect({ "👍": "thumbs up" }).toHaveProperty("👍", "thumbs up");
    expect({ "👩‍👩‍👧‍👧": "family" }).toHaveProperty("👩‍👩‍👧‍👧", "family");
    expect({ "😶‍🌫️": "fog" }).toHaveProperty("😶‍🌫️", "fog");
    expect({ "👩‍❤️‍👨": "couple" }).toHaveProperty("👩‍❤️‍👨", "couple");
    expect({ "👩‍❤️‍👨‍👨‍👧‍👧": "family" }).toHaveProperty("👩‍❤️‍👨‍👨‍👧‍👧", "family");
    expect({ "👩‍❤️‍👨‍👨‍👧": "family" }).toHaveProperty("👩‍❤️‍👨‍👨‍👧", "family");
    expect({ "👩‍❤️‍👨‍👨‍👧": "family" }).not.toHaveProperty("👩‍❤️‍👨‍👨‍👧‍👧", "family");

    // emojis in array
    expect(["👍", "👎"]).toHaveProperty("0", "👍");
    expect(["👍", "👎"]).toHaveProperty("1", "👎");
    expect(["👍", "👎"]).not.toHaveProperty("0", "👎");
    expect(["👍", "👎"]).not.toHaveProperty("1", "👍");
    expect(["👩‍❤️‍👨‍👨‍👧‍👧"]).toHaveProperty("0", "👩‍❤️‍👨‍👨‍👧‍👧");
    expect(["👩‍❤️‍👨‍👨‍👧‍👧"]).toHaveProperty([0], "👩‍❤️‍👨‍👨‍👧‍👧");
    expect(["😶‍🌫️"]).toHaveProperty([0], "😶‍🌫️");
  });

  test("toHaveProperty() - dot and bracket notation edge cases", () => {
    expect({ a: 1 }).not.toHaveProperty(".");
    expect({ a: 1 }).not.toHaveProperty("]");
    expect({ a: 1 }).not.toHaveProperty("[");
    expect({ a: 1 }).not.toHaveProperty("[]");
    expect({ a: 1 }).not.toHaveProperty("[[]]");
    expect({ a: 1 }).not.toHaveProperty("[[");
    expect({ a: 1 }).not.toHaveProperty("]]");
    expect({ a: 1 }).not.toHaveProperty("[]]");
    expect({ a: 1 }).not.toHaveProperty("[[]");
    expect({ a: 1 }).not.toHaveProperty(".]");
    expect({ a: 1 }).not.toHaveProperty(".[");
    expect({ "": 1 }).toHaveProperty("[.", 1);
    expect({ a: 1 }).not.toHaveProperty("[.");
    expect({ a: 1 }).not.toHaveProperty("].");
    expect({ a: 1 }).not.toHaveProperty("].[");
    expect({ a: 1 }).not.toHaveProperty("].]");
    expect({ a: 1 }).not.toHaveProperty("[.]");
    expect({ a: 1 }).not.toHaveProperty("[.[");

    expect([1]).toHaveProperty("[0]", 1);
    expect([1]).toHaveProperty("[0][", 1);
    expect([1]).toHaveProperty("[0]]", 1);
    expect([1]).toHaveProperty("[0][[", 1);
    expect([1]).toHaveProperty("[][[[0]", 1);
    expect([1]).toHaveProperty("[][[[]][[][][.0", 1);
    expect([1]).toHaveProperty("[][[[]][[][][.[][[][[[][][0", 1);
    expect([1]).not.toHaveProperty("......1.............", 1);
    expect([1]).not.toHaveProperty("......0.............", 1);
    expect([1]).not.toHaveProperty(".0", 1);
    expect([1]).not.toHaveProperty("0.", 1);
    expect([{ "": 1 }]).toHaveProperty("0.", 1);
    expect({ "": { "": 1 } }).toHaveProperty(".", 1);
    expect({ "": { "": { "": 1 } } }).toHaveProperty("..", 1);
    expect({ "": { "": { "": 1 } } }).not.toHaveProperty(".", 1);
    expect({ "": { "": { "": 1 } } }).not.toHaveProperty("...", 1);
    expect({ "": { "": { "": 1 } } }).not.toHaveProperty("....", 1);
    expect([1]).toHaveProperty("0.[[[][][]][[[][[]]]]", 1);
    expect([1]).not.toHaveProperty("[0].", 1);
    expect([1]).toHaveProperty("0", 1);
    expect([1]).toHaveProperty("[].0", 1);
    expect([1]).toHaveProperty("[.0", 1);
    expect([1]).toHaveProperty("].0", 1);
    expect([1]).toHaveProperty("0[]][[[]", 1);
    expect([1]).toHaveProperty("[[]][[[][][0", 1);
    expect([1]).toHaveProperty("0", 1);
    expect([1]).toHaveProperty("0.[", 1);
    expect([1]).not.toHaveProperty("0........[", 1);
    expect([1]).not.toHaveProperty("0..[", 1);
    expect([1]).not.toHaveProperty(".0", 1);
    expect([1]).toHaveProperty("[].0", 1);
    expect([1]).not.toHaveProperty("[]..0", 1);
    expect([1]).toHaveProperty("[.][.[[.]]]]].[.[].].]]]]].].].0", 1);
    expect([1]).not.toHaveProperty("[.][.[[.]]]]].[.[].].]]0]]].].].", 1);
    expect([1]).toHaveProperty("[.][.[[.]]]]].[.[].].]]0]]].].]", 1);
    expect([1]).not.toHaveProperty("[.][.[[..]]]]].[.[].].]]0]]].].]", 1);
    expect([1]).toHaveProperty("[.][.[[.]]]]].[.[].].0.]]]]].].]", 1);
    expect([1]).not.toHaveProperty("[.][.[[.]]]]].[.[].].0.]]] ]].].]", 1);
    expect([1]).not.toHaveProperty("0      ", 1);
    expect([1]).not.toHaveProperty("   0      ", 1);
    expect([1]).not.toHaveProperty("   0[]      ", 1);
    expect([1]).not.toHaveProperty("   0]      ", 1);
    expect([1]).not.toHaveProperty(" .[0]", 1);

    expect({ "": 1 }).not.toHaveProperty(".", 1);
    expect({ "": 1 }).not.toHaveProperty("]", 1);
    expect({ "": 1 }).not.toHaveProperty("[", 1);
    expect({ "": 1 }).toHaveProperty("", 1);

    expect({ "": 1 }).not.toHaveProperty("..", 1);
    expect({ "": { "": 1 } }).not.toHaveProperty("..", 1);
    expect([{ "": 1 }]).toHaveProperty("0.", 1);
    expect([{ "": 1 }]).not.toHaveProperty(".0.", 1);
    expect({ "": [1] }).toHaveProperty(".0", 1);
    expect({ "": [1] }).not.toHaveProperty("..0", 1);
    expect([{ "": 1 }]).not.toHaveProperty("0..", 1);
    expect([{ "": { "": 1 } }]).toHaveProperty("0..", 1);

    expect([1]).not.toHaveProperty("[0].", 1);
    expect([1]).not.toHaveProperty("[0][0]", 1);
    expect({ a: [1] }).toHaveProperty("a[[[[[[[[[0]]]", 1);
    expect({ "[[[": 0 }).not.toHaveProperty("[[[", 0);
  });

  test("toHaveProperty() - with string or array", () => {
    const a = new Array(["a", "b", "c"]);
    expect(a).toHaveProperty("0.1", "b");
    const b = new Array("a", "b", "c");
    expect({ a: { b: { c: 1 } } }).toHaveProperty(b);
    const c = {
      a: { b: 1 },
      "a.b": 2,
    };
    const d = new Array("a.b");
    expect(c).toHaveProperty(d, 2);
    const houseForSale = {
      bath: true,
      bedrooms: 4,
      kitchen: {
        amenities: ["oven", "stove", "washer"],
        area: 20,
        wallColor: "white",
        "nice.oven": true,
      },
      livingroom: {
        amenities: [
          {
            couch: [
              ["large", { dimensions: [20, 20] }],
              ["small", { dimensions: [10, 10] }],
            ],
          },
        ],
      },
      sunroom: "yes",
      "ceiling.height": 20,
      "entrance.window": 3,
      entrance: { window: 5 },
    };
    expect(houseForSale).toHaveProperty("entrance.window", 5);
    expect(houseForSale).toHaveProperty(["entrance", "window"], 5);
    expect(houseForSale).toHaveProperty(["entrance.window"], 3);
    expect(houseForSale).toHaveProperty("bath");
    expect(houseForSale).not.toHaveProperty("jacuzzi");
    // expect(houseForSale).toHaveProperty("jacuzzi");
    // expect(houseForSale).not.toHaveProperty("bath");
    expect(houseForSale).toHaveProperty("bath", true);
    expect(houseForSale).not.toHaveProperty("bath", false);
    // expect(houseForSale).toHaveProperty("bath", false);
    // expect(houseForSale).not.toHaveProperty("bath", true);
    expect(houseForSale).toHaveProperty("bedrooms", 4);
    expect(houseForSale).toHaveProperty(["sunroom"], "yes");
    expect(houseForSale).toHaveProperty("kitchen.area", 20);
    expect(houseForSale).toHaveProperty("kitchen.amenities", ["oven", "stove", "washer"]);
    expect(houseForSale).not.toHaveProperty(["kitchen", "area"], 21);
    expect(houseForSale).toHaveProperty(["kitchen", "area"], 20);
    expect(houseForSale).not.toHaveProperty(["kitchen", "area"], 29);
    expect(houseForSale).toHaveProperty(["kitchen", "amenities"], ["oven", "stove", "washer"]);
    expect(houseForSale).toHaveProperty("kitchen.amenities[2]", "washer");
    expect(houseForSale).toHaveProperty(["kitchen", "amenities", 1], "stove");
    expect(houseForSale).toHaveProperty(["kitchen", "amenities", 0], "oven");
    expect(houseForSale).toHaveProperty("livingroom.amenities[0].couch[0][1].dimensions[0]", 20);
    expect(houseForSale).toHaveProperty(["kitchen", "nice.oven"]);
    expect(houseForSale).not.toHaveProperty(["kitchen", "open"]);
    expect(houseForSale).toHaveProperty(["ceiling.height"], 20);
    expect({ a: { b: 1 } }).toHaveProperty("a.b");
    expect({ a: [2, 3, 4] }).toHaveProperty("a.0");
    expect({ a: [2, 3, 4] }).toHaveProperty("a.1");
    expect({ a: [2, 3, 4] }).toHaveProperty("a.2");
    expect({ a: [2, 3, 4] }).toHaveProperty("a[1]");
    expect([2, 3, 4]).toHaveProperty("1");
    expect([2, 3, 4]).toHaveProperty("[1]");
    expect([2, [6, 9], 4]).toHaveProperty("1.1");
    expect([2, [6, 9], 4]).toHaveProperty("1[1]");
    expect([2, [6, 9], 4]).toHaveProperty("[1].1");
    expect([2, [6, 9], 4]).toHaveProperty("[1][1]");
    expect([2, [6, 9], 4]).toHaveProperty([0], 2);
    expect({ a: { b: 1 } }).toHaveProperty("a.b");
    expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a.2.1.b");
    expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a");
    expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a[2][1].b");
    expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a[2][1]");
    expect({ a: [1, 2, [3, { b: 1 }]] }).not.toHaveProperty("a[2][1].c");
    expect("test").toHaveProperty("length");
    expect({}).toHaveProperty("constructor");
    expect({}).toHaveProperty("constructor.name");
    expect({}).toHaveProperty("constructor.name", "Object");
    expect(new Date()).toHaveProperty("getTime");
  });

  test("toHaveProperty() - all", () => {
    expect({ a: 1 }).toHaveProperty("a");
    expect({ a: 1 }).toHaveProperty("a", 1);
    expect({ a: 1 }).not.toHaveProperty("b");
    expect({ a: 1 }).not.toHaveProperty("a", 2);

    // test with object with property "a" with all types of values (including undefined)
    expect({ a: undefined }).toHaveProperty("a");
    expect({ a: null }).toHaveProperty("a");
    expect({ a: 0 }).toHaveProperty("a");
    expect({ a: false }).toHaveProperty("a");
    expect({ a: "" }).toHaveProperty("a");
    expect({ a: {} }).toHaveProperty("a");
    expect({ a: [] }).toHaveProperty("a");
    expect({ a: () => {} }).toHaveProperty("a");

    // test with object with property "a" with all types of values (including undefined)
    expect({ a: undefined }).toHaveProperty("a", undefined);
    expect({ a: null }).toHaveProperty("a", null);
    expect({ a: 0 }).toHaveProperty("a", 0);
    expect({ a: false }).toHaveProperty("a", false);
    expect({ a: "" }).toHaveProperty("a", "");
    expect({ a: {} }).toHaveProperty("a", {});
    expect({ a: [] }).toHaveProperty("a", []);
    expect({ a: () => {} }).not.toHaveProperty("a", () => {});

    // test with object with property "a" with all types of values (including undefined)

    expect({ a: undefined }).not.toHaveProperty("a", null);
    expect({ a: null }).not.toHaveProperty("a", undefined);
    expect({ a: 0 }).not.toHaveProperty("a", null);
    expect({ a: false }).not.toHaveProperty("a", null);
    expect({ a: "" }).not.toHaveProperty("a", null);
    expect({ a: {} }).not.toHaveProperty("a", null);
    expect({ a: [] }).not.toHaveProperty("a", null);
    expect({ a: () => {} }).not.toHaveProperty("a", null);

    expect({ a: undefined }).not.toHaveProperty("a", 0);
    expect({ a: null }).not.toHaveProperty("a", 0);
    expect({ a: 0 }).not.toHaveProperty("a", 1);
    expect({ a: false }).not.toHaveProperty("a", 0);
    expect({ a: "" }).not.toHaveProperty("a", 0);
    expect({ a: {} }).not.toHaveProperty("a", 0);
    expect({ a: [] }).not.toHaveProperty("a", 0);
    expect({ a: () => {} }).not.toHaveProperty("a", 0);

    expect({ a: undefined }).not.toHaveProperty("a", false);
    expect({ a: null }).not.toHaveProperty("a", false);
    expect({ a: 0 }).not.toHaveProperty("a", false);
    expect({ a: false }).not.toHaveProperty("a", true);
    expect({ a: "" }).not.toHaveProperty("a", false);
    expect({ a: {} }).not.toHaveProperty("a", false);
    expect({ a: [] }).not.toHaveProperty("a", false);
    expect({ a: () => {} }).not.toHaveProperty("a", false);

    expect({ a: undefined }).not.toHaveProperty("a", "");
    expect({ a: null }).not.toHaveProperty("a", "");
    expect({ a: 0 }).not.toHaveProperty("a", "");
    expect({ a: false }).not.toHaveProperty("a", "");
    expect({ a: "" }).not.toHaveProperty("a", "a");
    expect({ a: {} }).not.toHaveProperty("a", "");
    expect({ a: [] }).not.toHaveProperty("a", "");
    expect({ a: () => {} }).not.toHaveProperty("a", "");

    expect({ a: undefined }).not.toHaveProperty("a", {});
    expect({ a: null }).not.toHaveProperty("a", {});
    expect({ a: 0 }).not.toHaveProperty("a", {});
    expect({ a: false }).not.toHaveProperty("a", {});
    expect({ a: "" }).not.toHaveProperty("a", {});
    expect({ a: {} }).not.toHaveProperty("a", { a: 1 });
    expect({ a: [] }).not.toHaveProperty("a", {});
    expect({ a: () => {} }).not.toHaveProperty("a", {});

    // test object with property "a" with value set, map, string
    expect({ a: new Set([1, 2, 3]) }).toHaveProperty("a", new Set([3, 2, 1]));
    expect({ a: new Map([{ a: 1 }, { b: 2 }, { c: 3 }]) }).toHaveProperty("a", new Map([{ c: 3 }, { b: 2 }, { a: 1 }]));
    expect({ a: new String("a") }).toHaveProperty("a", new String("a"));
    expect({ a: new String("a") }).not.toHaveProperty("a", "a");
    expect({ a: new String("a") }).not.toHaveProperty("a", "b");
    expect({ a: new String("a") }).not.toHaveProperty("a", new String("b"));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Number(1));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Boolean(true));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Boolean(false));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Object());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Function());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Date());
    expect({ a: new String("a") }).not.toHaveProperty("a", new RegExp());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Error());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Promise(() => {}));
    expect({ a: new String("a") }).not.toHaveProperty("a", new WeakSet());
    expect({ a: new String("a") }).not.toHaveProperty("a", new WeakMap());
    expect({ a: new String("a") }).not.toHaveProperty("a", Symbol("a"));
    expect({ a: new String("a") }).not.toHaveProperty("a", new Int8Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Uint8Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Uint8ClampedArray());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Int16Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Uint16Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Int32Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Uint32Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Float32Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new Float64Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new BigInt64Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new BigUint64Array());
    expect({ a: new String("a") }).not.toHaveProperty("a", new ArrayBuffer());
    expect({ a: new String("a") }).not.toHaveProperty("a", new SharedArrayBuffer());
    expect({ a: new String("a") }).not.toHaveProperty("a", new DataView(new ArrayBuffer(1)));

    // test property equality with sets, maps, objects, arrays, and String
    expect({ a: new Set([1, 2, 3]) }).toHaveProperty("a", new Set([1, 2, 3]));
    expect({ a: new Map([{ a: 1 }, { b: 2 }, { c: 3 }]) }).toHaveProperty("a", new Map([{ a: 1 }, { b: 2 }, { c: 3 }]));
    expect({ a: { a: 1, b: 2, c: 3 } }).toHaveProperty("a", { a: 1, b: 2, c: 3 });
    expect({ a: [1, 2, 3] }).toHaveProperty("a", [1, 2, 3]);
    expect({ a: "a" }).toHaveProperty("a", "a");
    expect({ a: new String("a") }).toHaveProperty("a", new String("a"));
    expect({ a: new String("a") }).not.toHaveProperty("a", "a");
  });

  test.todo("toHaveProperty() - null or undefined", () => {
    expect(() => expect(null).toHaveProperty("length")).toThrow();
    expect(() => expect(null).not.toHaveProperty("length")).toThrow();
    expect(() => expect(undefined).toHaveProperty("length")).toThrow();
    expect(() => expect(undefined).not.toHaveProperty("length")).toThrow();
  });

  test("toBe()", () => {
    const a = 1;
    const b = 1;
    expect(a).toBe(a);
    expect(a).toBe(b);
    expect(a).toBe(1);
    expect(1).toBe(a);
    expect(b).toBe(a);

    const c = { a: 1 };
    const d = { a: 1 };
    expect(c).toBe(c);
    expect(c).not.toBe(d);
    expect(c).not.toBe({ a: 1 });
    expect({ a: 1 }).not.toBe(c);
    expect(d).not.toBe(c);

    expect(1).toBe(1);
    // expect(1).not.toBe(1);

    expect(1).not.toBe(2);
    expect(1).not.toBe("1");
    expect("hello test").toBe("hello test");
    expect("hello test").not.toBe("hello test2");
  });

  test("toHaveLength()", () => {
    expect({ length: Number.MAX_SAFE_INTEGER }).toHaveLength(Number.MAX_SAFE_INTEGER);
    expect("123").toHaveLength(3);
    expect([1, 2, 3]).toHaveLength(3);
    expect([1, 2, 3]).not.toHaveLength(2);
    expect("123").not.toHaveLength(2);
    expect({ length: 3 }).toHaveLength(3);
    expect({ length: 3 }).not.toHaveLength(2);
    expect({ length: 3 }).not.toHaveLength(Number.MAX_SAFE_INTEGER);
    expect({ length: Number.MAX_SAFE_INTEGER }).not.toHaveLength(Number.MAX_SAFE_INTEGER - 1);
    expect({ length: 3.3 }).not.toHaveLength(3);
    expect("123").not.toHaveLength(-0);
  });

  if (isBun) {
    test("toHaveLength() extended", () => {
      // Headers
      expect(new Headers()).toHaveLength(0);
      expect(new Headers({ a: "1" })).toHaveLength(1);

      // FormData
      const form = new FormData();
      expect(form).toHaveLength(0);
      form.append("a", "1");
      expect(form).toHaveLength(1);

      // URLSearchParams
      expect(new URLSearchParams()).toHaveLength(0);
      expect(new URLSearchParams("a=1")).toHaveLength(1);
      expect(new URLSearchParams([["a", "1"]])).toHaveLength(1);

      // files
      const thisFile = Bun.file(__filename);
      const thisFileSize = thisFile.size;

      expect(thisFile).toHaveLength(thisFileSize);
      expect(thisFile).toHaveLength(Bun.file(__filename).size);

      // empty file should have length 0
      require("fs").writeFileSync("/tmp/empty.txt", "");
      expect(Bun.file("/tmp/empty.txt")).toHaveLength(0);

      // if a file doesn't exist, it should throw (not return 0 size)
      expect(() => expect(Bun.file("/does-not-exist/file.txt")).toHaveLength(0)).toThrow();

      // Blob
      expect(new Blob([1, 2, 3])).toHaveLength(3);
      expect(new Blob()).toHaveLength(0);

      // Set
      expect(new Set()).toHaveLength(0);
      expect(new Set([1, 2, 3])).toHaveLength(3);

      // Map
      expect(new Map()).toHaveLength(0);
      expect(new Map([["a", 1]])).toHaveLength(1);

      // WeakMap
      expect(new WeakMap([[globalThis, 1]])).toHaveLength(1);
    });
  }

  test("toContain()", () => {
    const s1 = new String("123");
    expect(s1).not.toContain("12");
    const s2 = "123";
    expect(s2).toContain("12");

    expect("test").toContain("es");
    expect("test").toContain("est");
    // expect("test").not.toContain("test");
    expect(["test", "es"]).toContain("es");
    expect("").toContain("");
    expect([""]).toContain("");

    expect(["lemon", "lime"]).not.toContain("orange");
    expect("citrus fruits").toContain("fruit");

    const a = new Uint16Array([1, 2, 3]);
    expect(a).toContain(2);
    expect(a).not.toContain(4);
    expect([2, "2335", 5, true, false, null, undefined]).toContain(5);
    expect([2, "2335", 5, true, false, null, undefined]).toContain("2335");
    expect([2, "2335", 5, true, false, null, undefined]).toContain(true);
    expect([2, "2335", 5, true, false, null, undefined]).toContain(false);
    expect([2, "2335", 5, true, false, null, undefined]).toContain(null);
    expect([2, "2335", 5, true, false, null, undefined]).toContain(undefined);
    expect([2, "2335", 5, true, false, null, undefined]).not.toContain(3);

    // expect([4, 5, 6]).not.toContain(5);

    expect([]).not.toContain([]);
  });

  test("toBeTruthy()", () => {
    expect("test").toBeTruthy();
    expect(true).toBeTruthy();
    expect(1).toBeTruthy();
    expect({}).toBeTruthy();
    expect([]).toBeTruthy();
    expect(() => {}).toBeTruthy();
    // expect(() => {}).not.toBeTruthy();
    expect(0.5).toBeTruthy();
    expect(new Map()).toBeTruthy();

    expect("").not.toBeTruthy();
    expect(0).not.toBeTruthy();
    expect(-0).not.toBeTruthy();
    expect(NaN).not.toBeTruthy();
    expect(0n).not.toBeTruthy();
    expect(0.0e1).not.toBeTruthy();
    expect(false).not.toBeTruthy();
    expect(null).not.toBeTruthy();
    expect(undefined).not.toBeTruthy();
  });

  test("toBeUndefined()", () => {
    expect(undefined).toBeUndefined();
    expect(() => expect(undefined).not.toBeUndefined()).toThrow();
    expect(null).not.toBeUndefined();
    expect(0).not.toBeUndefined();
    expect("hello defined").not.toBeUndefined();
  });

  test("toBeNull()", () => {
    expect(null).toBeNull();
    // expect(null).not.toBeNull();

    expect(undefined).not.toBeNull();
    expect(0).not.toBeNull();
    expect("hello not null").not.toBeNull();
  });

  test("toBeDefined()", () => {
    expect(0).toBeDefined();
    expect("hello defined").toBeDefined();
    expect(null).toBeDefined();
    // expect(null).not.toBeDefined();

    expect(undefined).not.toBeDefined();
  });

  test("toBeFalsy()", () => {
    expect("").toBeFalsy();
    expect(0).toBeFalsy();
    expect(-0).toBeFalsy();
    expect(NaN).toBeFalsy();
    expect(0n).toBeFalsy();
    expect(false).toBeFalsy();
    expect(null).toBeFalsy();
    expect(undefined).toBeFalsy();
    expect(() => expect("").not.toBeFalsy()).toThrow();
    expect(() => expect(0).not.toBeFalsy()).toThrow();
    expect(() => expect(-0).not.toBeFalsy()).toThrow();
    expect(() => expect(NaN).not.toBeFalsy()).toThrow();
    expect(() => expect(0n).not.toBeFalsy()).toThrow();
    expect(() => expect(false).not.toBeFalsy()).toThrow();
    expect(() => expect(null).not.toBeFalsy()).toThrow();
    expect(() => expect(undefined).not.toBeFalsy()).toThrow();

    expect("hello not falsy").not.toBeFalsy();
    expect(1).not.toBeFalsy();
    expect(true).not.toBeFalsy();
    expect({}).not.toBeFalsy();
    expect([]).not.toBeFalsy();
    expect(() => {}).not.toBeFalsy();
    expect(() => expect("hello not falsy").toBeFalsy()).toThrow();
    expect(() => expect(1).toBeFalsy()).toThrow();
    expect(() => expect(true).toBeFalsy()).toThrow();
    expect(() => expect({}).toBeFalsy()).toThrow();
    expect(() => expect([]).toBeFalsy()).toThrow();
    expect(() => expect(() => {}).toBeFalsy()).toThrow();
  });

  test("toBeGreaterThan()", () => {
    expect(3n).toBeGreaterThan(2);
    expect(Number.MAX_VALUE).not.toBeGreaterThan(Number.MAX_VALUE);
    expect(1).not.toBeGreaterThan(BigInt(Number.MAX_VALUE));
    expect(1).not.toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(1).not.toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(Number.MAX_SAFE_INTEGER).not.toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    expect(Infinity).toBeGreaterThan(-Infinity);
    expect(-Infinity).not.toBeGreaterThan(Infinity);

    expect(NaN).not.toBeGreaterThan(NaN);
    expect(NaN).not.toBeGreaterThan(-Infinity);

    expect(10).toBeGreaterThan(9);
    expect(10).not.toBeGreaterThan(10);
    expect(10).not.toBeGreaterThan(11);
    expect(10).not.toBeGreaterThan(Infinity);
    expect(10).toBeGreaterThan(-Infinity);
    expect(10).not.toBeGreaterThan(NaN);
    expect(10).toBeGreaterThan(0);
    expect(10).toBeGreaterThan(-0);
    expect(10).toBeGreaterThan(0.1);
    expect(10).toBeGreaterThan(-0.1);
    expect(10).toBeGreaterThan(0.9);
    expect(10).toBeGreaterThan(-0.9);
    expect(10).toBeGreaterThan(1);
    expect(10).toBeGreaterThan(-1);
    // switch the order
    expect(9).not.toBeGreaterThan(10);
    expect(10).not.toBeGreaterThan(10);
    expect(11).toBeGreaterThan(10);
    expect(Infinity).toBeGreaterThan(10);
    expect(-Infinity).not.toBeGreaterThan(10);
    expect(NaN).not.toBeGreaterThan(10);
    expect(0).not.toBeGreaterThan(10);
    expect(-0).not.toBeGreaterThan(10);
    expect(0.1).not.toBeGreaterThan(10);
    expect(-0.1).not.toBeGreaterThan(10);
    expect(0.9).not.toBeGreaterThan(10);
    expect(-0.9).not.toBeGreaterThan(10);
    expect(1).not.toBeGreaterThan(10);
    expect(-1).not.toBeGreaterThan(10);

    // same tests but use bigints
    expect(10n).toBeGreaterThan(9n);
    expect(10n).not.toBeGreaterThan(10n);
    expect(10n).not.toBeGreaterThan(11n);
    expect(10n).not.toBeGreaterThan(Infinity);
    expect(10n).toBeGreaterThan(-Infinity);
    expect(10n).not.toBeGreaterThan(NaN);
    expect(10n).toBeGreaterThan(0n);
    expect(10n).toBeGreaterThan(-0n);
    expect(10n).toBeGreaterThan(1n);
    expect(10n).toBeGreaterThan(-1n);
    // switch the order
    expect(9n).not.toBeGreaterThan(10n);
    expect(10n).not.toBeGreaterThan(10n);
    expect(11n).toBeGreaterThan(10n);
    expect(Infinity).toBeGreaterThan(10n);
    expect(-Infinity).not.toBeGreaterThan(10n);
    expect(NaN).not.toBeGreaterThan(10n);
    expect(0n).not.toBeGreaterThan(10n);
    expect(-0n).not.toBeGreaterThan(10n);
    expect(1n).not.toBeGreaterThan(10n);
    expect(-1n).not.toBeGreaterThan(10n);

    // use bigints and numbers
    expect(10n).toBeGreaterThan(9);
    expect(10n).not.toBeGreaterThan(10);
    expect(10n).not.toBeGreaterThan(11);
    expect(10n).not.toBeGreaterThan(Infinity);
    expect(10n).toBeGreaterThan(-Infinity);
    expect(10n).not.toBeGreaterThan(NaN);
    expect(10n).toBeGreaterThan(0);
    expect(10n).toBeGreaterThan(-0);
    expect(10n).toBeGreaterThan(0.1);
    expect(10n).toBeGreaterThan(-0.1);
    expect(10n).toBeGreaterThan(0.9);
    expect(10n).toBeGreaterThan(-0.9);
    expect(10n).toBeGreaterThan(1);
    expect(10n).toBeGreaterThan(-1);
    // switch the order
    expect(9n).not.toBeGreaterThan(10);
    expect(10n).not.toBeGreaterThan(10);
    expect(11n).toBeGreaterThan(10);
    expect(Infinity).toBeGreaterThan(10n);
    expect(-Infinity).not.toBeGreaterThan(10n);
    expect(NaN).not.toBeGreaterThan(10n);
    expect(0n).not.toBeGreaterThan(10);
    expect(-0n).not.toBeGreaterThan(10);
    expect(1n).not.toBeGreaterThan(10);
    expect(-1n).not.toBeGreaterThan(10);

    expect(1n).not.toBeGreaterThan(1);
    expect(1n).not.toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(1n).not.toBeGreaterThan(Number.MAX_VALUE);
    expect(1).not.toBeGreaterThan(1n);
    expect(Number.MAX_SAFE_INTEGER).toBeGreaterThan(1n);
    expect(Number.MAX_VALUE).toBeGreaterThan(1n);

    expect(BigInt(Number.MAX_SAFE_INTEGER)).toBeGreaterThan(1n);
    expect(BigInt(Number.MAX_VALUE)).toBeGreaterThan(1n);
    expect(1n).not.toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(1n).not.toBeGreaterThan(BigInt(Number.MAX_VALUE));

    expect(BigInt(Number.MAX_SAFE_INTEGER)).toBeGreaterThan(1);
    expect(BigInt(Number.MAX_VALUE)).toBeGreaterThan(1);
    expect(1).not.toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });

  test("toBeGreaterThanOrEqual()", () => {
    expect(Number.MAX_VALUE).toBeGreaterThanOrEqual(Number.MAX_VALUE);
    expect(1).not.toBeGreaterThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(1).not.toBeGreaterThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
    expect(1).not.toBeGreaterThanOrEqual(BigInt(Number.MAX_VALUE));
    expect(Number.MAX_SAFE_INTEGER).toBeGreaterThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(BigInt(Number.MAX_SAFE_INTEGER)).toBeGreaterThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));

    expect(Infinity).toBeGreaterThanOrEqual(-Infinity);
    expect(-Infinity).not.toBeGreaterThanOrEqual(Infinity);

    expect(NaN).not.toBeGreaterThanOrEqual(NaN);
    expect(NaN).not.toBeGreaterThanOrEqual(-Infinity);

    expect(10).toBeGreaterThanOrEqual(9);
    expect(10).toBeGreaterThanOrEqual(10);
    expect(10).not.toBeGreaterThanOrEqual(11);
    expect(10).not.toBeGreaterThanOrEqual(Infinity);
    expect(10).toBeGreaterThanOrEqual(-Infinity);
    expect(10).not.toBeGreaterThanOrEqual(NaN);
    expect(10).toBeGreaterThanOrEqual(0);
    expect(10).toBeGreaterThanOrEqual(-0);
    expect(10).toBeGreaterThanOrEqual(0.1);
    expect(10).toBeGreaterThanOrEqual(-0.1);
    expect(10).toBeGreaterThanOrEqual(0.9);
    expect(10).toBeGreaterThanOrEqual(-0.9);
    expect(10).toBeGreaterThanOrEqual(1);
    expect(10).toBeGreaterThanOrEqual(-1);
    // switch the order
    expect(9).not.toBeGreaterThanOrEqual(10);
    expect(10).toBeGreaterThanOrEqual(10);
    expect(11).toBeGreaterThanOrEqual(10);
    expect(Infinity).toBeGreaterThanOrEqual(10);
    expect(-Infinity).not.toBeGreaterThanOrEqual(10);
    expect(NaN).not.toBeGreaterThanOrEqual(10);
    expect(0).not.toBeGreaterThanOrEqual(10);
    expect(-0).not.toBeGreaterThanOrEqual(10);
    expect(0.1).not.toBeGreaterThanOrEqual(10);
    expect(-0.1).not.toBeGreaterThanOrEqual(10);
    expect(0.9).not.toBeGreaterThanOrEqual(10);
    expect(-0.9).not.toBeGreaterThanOrEqual(10);
    expect(1).not.toBeGreaterThanOrEqual(10);
    expect(-1).not.toBeGreaterThanOrEqual(10);

    // same tests but use bigints
    expect(10n).toBeGreaterThanOrEqual(9n);
    expect(10n).toBeGreaterThanOrEqual(10n);
    expect(10n).not.toBeGreaterThanOrEqual(11n);
    expect(10n).not.toBeGreaterThanOrEqual(Infinity);
    expect(10n).toBeGreaterThanOrEqual(-Infinity);
    expect(10n).not.toBeGreaterThanOrEqual(NaN);
    expect(10n).toBeGreaterThanOrEqual(0n);
    expect(10n).toBeGreaterThanOrEqual(-0n);
    expect(10n).toBeGreaterThanOrEqual(1n);
    expect(10n).toBeGreaterThanOrEqual(-1n);
    // switch the order
    expect(9n).not.toBeGreaterThanOrEqual(10n);
    expect(10n).toBeGreaterThanOrEqual(10n);
    expect(11n).toBeGreaterThanOrEqual(10n);
    expect(Infinity).toBeGreaterThanOrEqual(10n);
    expect(-Infinity).not.toBeGreaterThanOrEqual(10n);
    expect(NaN).not.toBeGreaterThanOrEqual(10n);
    expect(0n).not.toBeGreaterThanOrEqual(10n);
    expect(-0n).not.toBeGreaterThanOrEqual(10n);
    expect(1n).not.toBeGreaterThanOrEqual(10n);
    expect(-1n).not.toBeGreaterThanOrEqual(10n);

    // use bigints and numbers
    expect(10n).toBeGreaterThanOrEqual(9);
    expect(10n).toBeGreaterThanOrEqual(10);
    expect(10n).not.toBeGreaterThanOrEqual(11);
    expect(10n).not.toBeGreaterThanOrEqual(Infinity);
    expect(10n).toBeGreaterThanOrEqual(-Infinity);
    expect(10n).not.toBeGreaterThanOrEqual(NaN);
    expect(10n).toBeGreaterThanOrEqual(0);
    expect(10n).toBeGreaterThanOrEqual(-0);
    expect(10n).toBeGreaterThanOrEqual(0.1);
    expect(10n).toBeGreaterThanOrEqual(-0.1);
    expect(10n).toBeGreaterThanOrEqual(0.9);
    expect(10n).toBeGreaterThanOrEqual(-0.9);
    expect(10n).toBeGreaterThanOrEqual(1);
    expect(10n).toBeGreaterThanOrEqual(-1);
    // switch the order
    expect(9n).not.toBeGreaterThanOrEqual(10);
    expect(10n).toBeGreaterThanOrEqual(10);
    expect(11n).toBeGreaterThanOrEqual(10);
    expect(Infinity).toBeGreaterThanOrEqual(10n);
    expect(-Infinity).not.toBeGreaterThanOrEqual(10n);
    expect(NaN).not.toBeGreaterThanOrEqual(10n);
    expect(0n).not.toBeGreaterThanOrEqual(10);
    expect(-0n).not.toBeGreaterThanOrEqual(10);
    expect(1n).not.toBeGreaterThanOrEqual(10);
    expect(-1n).not.toBeGreaterThanOrEqual(10);

    expect(1n).toBeGreaterThanOrEqual(1);
    expect(1n).not.toBeGreaterThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(1n).not.toBeGreaterThanOrEqual(Number.MAX_VALUE);
    expect(1).toBeGreaterThanOrEqual(1n);
    expect(Number.MAX_SAFE_INTEGER).toBeGreaterThanOrEqual(1n);
    expect(Number.MAX_VALUE).toBeGreaterThanOrEqual(1n);

    expect(1).not.toBeGreaterThanOrEqual(BigInt(Number.MAX_VALUE));
  });

  test("toBeLessThan()", () => {
    expect(3n).not.toBeLessThan(2);
    expect(Number.MAX_VALUE).not.toBeLessThan(Number.MAX_VALUE);
    expect(1).toBeLessThan(BigInt(Number.MAX_VALUE));
    expect(1).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(1).toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(Number.MAX_SAFE_INTEGER).not.toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));

    expect(Number.MAX_VALUE).not.toBeLessThan(BigInt(Number.MAX_VALUE));

    expect(NaN).not.toBeLessThan(NaN);
    expect(NaN).not.toBeLessThan(-Infinity);

    expect(10).not.toBeLessThan(9);
    expect(10).not.toBeLessThan(10);
    expect(10).toBeLessThan(11);
    expect(10).toBeLessThan(Infinity);
    expect(10).not.toBeLessThan(-Infinity);
    expect(10).not.toBeLessThan(NaN);
    expect(10).not.toBeLessThan(0);
    expect(10).not.toBeLessThan(-0);
    expect(10).not.toBeLessThan(0.1);
    expect(10).not.toBeLessThan(-0.1);
    expect(10).not.toBeLessThan(0.9);
    expect(10).not.toBeLessThan(-0.9);
    expect(10).not.toBeLessThan(1);
    expect(10).not.toBeLessThan(-1);
    // switch the order
    expect(9).toBeLessThan(10);
    expect(10).not.toBeLessThan(10);
    expect(11).not.toBeLessThan(10);
    expect(Infinity).not.toBeLessThan(10);
    expect(-Infinity).toBeLessThan(10);
    expect(NaN).not.toBeLessThan(10);
    expect(0).toBeLessThan(10);
    expect(-0).toBeLessThan(10);
    expect(0.1).toBeLessThan(10);
    expect(-0.1).toBeLessThan(10);
    expect(0.9).toBeLessThan(10);
    expect(-0.9).toBeLessThan(10);
    expect(1).toBeLessThan(10);
    expect(-1).toBeLessThan(10);

    // same tests but use bigints
    expect(10n).not.toBeLessThan(9n);
    expect(10n).not.toBeLessThan(10n);
    expect(10n).toBeLessThan(11n);
    expect(10n).toBeLessThan(Infinity);
    expect(10n).not.toBeLessThan(-Infinity);
    expect(10n).not.toBeLessThan(NaN);
    expect(10n).not.toBeLessThan(0n);
    expect(10n).not.toBeLessThan(-0n);
    expect(10n).not.toBeLessThan(1n);
    expect(10n).not.toBeLessThan(-1n);
    // switch the order
    expect(9n).toBeLessThan(10n);
    expect(10n).not.toBeLessThan(10n);
    expect(11n).not.toBeLessThan(10n);
    expect(Infinity).not.toBeLessThan(10n);
    expect(-Infinity).toBeLessThan(10n);
    expect(NaN).not.toBeLessThan(10n);
    expect(0n).toBeLessThan(10n);
    expect(-0n).toBeLessThan(10n);
    expect(1n).toBeLessThan(10n);
    expect(-1n).toBeLessThan(10n);

    // use bigints and numbers
    expect(10n).not.toBeLessThan(9);
    expect(10n).not.toBeLessThan(10);
    expect(10n).toBeLessThan(11);
    expect(10n).toBeLessThan(Infinity);
    expect(10n).not.toBeLessThan(-Infinity);
    expect(10n).not.toBeLessThan(NaN);
    expect(10n).not.toBeLessThan(0);
    expect(10n).not.toBeLessThan(-0);
    expect(10n).not.toBeLessThan(0.1);
    expect(10n).not.toBeLessThan(-0.1);
    expect(10n).not.toBeLessThan(0.9);
    expect(10n).not.toBeLessThan(-0.9);
    expect(10n).not.toBeLessThan(1);
    expect(10n).not.toBeLessThan(-1);
    // switch the order
    expect(9n).toBeLessThan(10);
    expect(10n).not.toBeLessThan(10);
    expect(11n).not.toBeLessThan(10);
    expect(Infinity).not.toBeLessThan(10n);
    expect(-Infinity).toBeLessThan(10n);
    expect(NaN).not.toBeLessThan(10n);
    expect(0n).toBeLessThan(10);
    expect(-0n).toBeLessThan(10);
    expect(1n).toBeLessThan(10);
    expect(-1n).toBeLessThan(10);

    expect(1n).not.toBeLessThan(1);
    expect(1n).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(1n).toBeLessThan(Number.MAX_VALUE);
    expect(1).not.toBeLessThan(1n);
    expect(Number.MAX_SAFE_INTEGER).not.toBeLessThan(1n);
    expect(Number.MAX_VALUE).not.toBeLessThan(1n);

    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThan(1n);
    expect(BigInt(Number.MAX_VALUE)).not.toBeLessThan(1n);
    expect(1n).toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(1n).toBeLessThan(BigInt(Number.MAX_VALUE));

    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThan(1);
    expect(BigInt(Number.MAX_VALUE)).not.toBeLessThan(1);
    expect(1).toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));
  });

  test("toBeLessThanOrEqual()", () => {
    expect(3n).not.toBeLessThanOrEqual(2);
    expect(Number.MAX_VALUE).toBeLessThanOrEqual(Number.MAX_VALUE);
    expect(1).toBeLessThanOrEqual(BigInt(Number.MAX_VALUE));
    expect(1).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(1).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
    expect(Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(BigInt(Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));

    expect(Number.MAX_VALUE).toBeLessThanOrEqual(BigInt(Number.MAX_VALUE));
    expect(BigInt(Number.MAX_VALUE)).toBeLessThanOrEqual(Number.MAX_VALUE);

    expect(NaN).not.toBeLessThanOrEqual(NaN);
    expect(NaN).not.toBeLessThanOrEqual(-Infinity);

    expect(10).not.toBeLessThanOrEqual(9);
    expect(10).toBeLessThanOrEqual(10);
    expect(10).toBeLessThanOrEqual(11);
    expect(10).toBeLessThanOrEqual(Infinity);
    expect(10).not.toBeLessThanOrEqual(-Infinity);
    expect(10).not.toBeLessThanOrEqual(NaN);
    expect(10).not.toBeLessThanOrEqual(0);
    expect(10).not.toBeLessThanOrEqual(-0);
    expect(10).not.toBeLessThanOrEqual(0.1);
    expect(10).not.toBeLessThanOrEqual(-0.1);
    expect(10).not.toBeLessThanOrEqual(0.9);
    expect(10).not.toBeLessThanOrEqual(-0.9);
    expect(10).not.toBeLessThanOrEqual(1);
    expect(10).not.toBeLessThanOrEqual(-1);
    // switch the order
    expect(9).toBeLessThanOrEqual(10);
    expect(10).toBeLessThanOrEqual(10);
    expect(11).not.toBeLessThanOrEqual(10);
    expect(Infinity).not.toBeLessThanOrEqual(10);
    expect(-Infinity).toBeLessThanOrEqual(10);
    expect(NaN).not.toBeLessThanOrEqual(10);
    expect(0).toBeLessThanOrEqual(10);
    expect(-0).toBeLessThanOrEqual(10);
    expect(0.1).toBeLessThanOrEqual(10);
    expect(-0.1).toBeLessThanOrEqual(10);
    expect(0.9).toBeLessThanOrEqual(10);
    expect(-0.9).toBeLessThanOrEqual(10);
    expect(1).toBeLessThanOrEqual(10);
    expect(-1).toBeLessThanOrEqual(10);

    // same tests but use bigints
    expect(10n).not.toBeLessThanOrEqual(9n);
    expect(10n).toBeLessThanOrEqual(10n);
    expect(10n).toBeLessThanOrEqual(11n);
    expect(10n).toBeLessThanOrEqual(Infinity);
    expect(10n).not.toBeLessThanOrEqual(-Infinity);
    expect(10n).not.toBeLessThanOrEqual(NaN);
    expect(10n).not.toBeLessThanOrEqual(0n);
    expect(10n).not.toBeLessThanOrEqual(-0n);
    expect(10n).not.toBeLessThanOrEqual(1n);
    expect(10n).not.toBeLessThanOrEqual(-1n);
    // switch the order
    expect(9n).toBeLessThanOrEqual(10n);
    expect(10n).toBeLessThanOrEqual(10n);
    expect(11n).not.toBeLessThanOrEqual(10n);
    expect(Infinity).not.toBeLessThanOrEqual(10n);
    expect(-Infinity).toBeLessThanOrEqual(10n);
    expect(NaN).not.toBeLessThanOrEqual(10n);
    expect(0n).toBeLessThanOrEqual(10n);
    expect(-0n).toBeLessThanOrEqual(10n);
    expect(1n).toBeLessThanOrEqual(10n);
    expect(-1n).toBeLessThanOrEqual(10n);

    // use bigints and numbers
    expect(10n).not.toBeLessThanOrEqual(9);
    expect(10n).toBeLessThanOrEqual(10);
    expect(10n).toBeLessThanOrEqual(11);
    expect(10n).toBeLessThanOrEqual(Infinity);
    expect(10n).not.toBeLessThanOrEqual(-Infinity);
    expect(10n).not.toBeLessThanOrEqual(NaN);
    expect(10n).not.toBeLessThanOrEqual(0);
    expect(10n).not.toBeLessThanOrEqual(-0);
    expect(10n).not.toBeLessThanOrEqual(0.1);
    expect(10n).not.toBeLessThanOrEqual(-0.1);
    expect(10n).not.toBeLessThanOrEqual(0.9);
    expect(10n).not.toBeLessThanOrEqual(-0.9);
    expect(10n).not.toBeLessThanOrEqual(1);
    expect(10n).not.toBeLessThanOrEqual(-1);
    // switch the order
    expect(9n).toBeLessThanOrEqual(10);
    expect(10n).toBeLessThanOrEqual(10);
    expect(11n).not.toBeLessThanOrEqual(10);
    expect(Infinity).not.toBeLessThanOrEqual(10n);
    expect(-Infinity).toBeLessThanOrEqual(10n);
    expect(NaN).not.toBeLessThanOrEqual(10n);
    expect(0n).toBeLessThanOrEqual(10);
    expect(-0n).toBeLessThanOrEqual(10);
    expect(1n).toBeLessThanOrEqual(10);
    expect(-1n).toBeLessThanOrEqual(10);

    expect(1n).toBeLessThanOrEqual(1);
    expect(1n).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(1n).toBeLessThanOrEqual(Number.MAX_VALUE);
    expect(1).toBeLessThanOrEqual(1n);
    expect(Number.MAX_SAFE_INTEGER).not.toBeLessThanOrEqual(1n);
    expect(Number.MAX_VALUE).not.toBeLessThanOrEqual(1n);

    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThanOrEqual(1n);
    expect(BigInt(Number.MAX_VALUE)).not.toBeLessThanOrEqual(1n);
    expect(1n).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
    expect(1n).toBeLessThanOrEqual(BigInt(Number.MAX_VALUE));

    expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeLessThanOrEqual(1);
    expect(BigInt(Number.MAX_VALUE)).not.toBeLessThanOrEqual(1);
    expect(1).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
  });

  describe("toMatchObject", () => {
    if (isBun) {
      test("with Bun.deepMatch", () => {
        expect(Bun.deepMatch({ a: 1, b: 2 }, { a: 1 })).toBe(false);
        expect(Bun.deepMatch({ a: 1 }, { a: 1, b: 2 })).toBe(true);
      });
    }
    test("with expect matcher", () => {
      const f = Symbol.for("foo");
      const b = Symbol.for("bar");

      class Number2 extends Number {
        constructor(value) {
          super(value);
        }
      }
      class Number3 extends Number2 {
        constructor(value) {
          super(value);
        }
      }

      class Boolean2 extends Boolean {
        constructor(value) {
          super(value);
        }
      }
      expect({ [f]: 2 }).toMatchObject({ [f]: 2 });
      expect({ [f]: 2 }).toMatchObject({ [f]: expect.anything() });
      expect({ [f]: new Date() }).toMatchObject({ [f]: expect.any(Date) });
      expect({ [f]: new Date() }).not.toMatchObject({ [f]: expect.any(RegExp) });
      expect({ [f]: 3 }).not.toMatchObject({ [f]: 5 });
      expect({ [f]: 3 }).not.toMatchObject({ [b]: 3 });
      expect({}).toMatchObject({});
      expect([5]).toMatchObject([5]);
      expect([5]).not.toMatchObject([4]);
      expect(() => {
        expect({}).toMatchObject();
      }).toThrow();
      expect(() => {
        expect(true).toMatchObject(true);
      }).toThrow();
      expect(() => {
        expect(true).toMatchObject(true);
      }).toThrow();
      expect(() => {
        expect(1).toMatchObject(1);
      }).toThrow();
      expect(() => {
        expect("a").toMatchObject("a");
      }).toThrow();
      expect(() => {
        expect(null).toMatchObject(null);
      }).toThrow();
      expect(() => {
        expect(undefined).toMatchObject(undefined);
      }).toThrow();
      expect(() => {
        expect(Symbol()).toMatchObject(Symbol());
      }).toThrow();
      expect(() => {
        expect(BigInt(1)).toMatchObject(BigInt(1));
      }).toThrow();
      expect([]).toMatchObject([]);
      expect([1]).toMatchObject([1]);
      expect([1, 2]).toMatchObject([1, 2]);
      expect(() => {
        expect([1]).toMatchObject([1, 2]);
      }).toThrow();
      expect(() => {
        expect([1, 2]).toMatchObject([1]);
      }).toThrow();
      expect([]).toMatchObject({});
      expect([1]).toMatchObject({});
      expect([1, 2]).toMatchObject({ 0: 1, 1: 2 });
      expect([1, 2]).not.toMatchObject({ 0: 2 });
      expect(() => {
        expect({}).toMatchObject([]);
      }).toThrow();
      expect({ a: 1 }).toMatchObject({});
      expect({ a: 1 }).toMatchObject({ a: expect.anything() });
      expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
      expect({ a: 1, b: 2 }).toMatchObject({ a: 1, b: 2 });
      expect({ a: 1, b: 2 }).toMatchObject({ b: 2 });
      expect({ a: 1, b: 2 }).toMatchObject({ b: 2, a: 1 });
      expect({ a: 1, b: 2 }).toMatchObject({ a: 1, b: 2 });
      expect({}).not.toMatchObject({ a: 1 });
      expect({ a: 89 }).not.toMatchObject({ b: 90 });
      expect({ a: 1, b: 2 }).not.toMatchObject({ a: 1, b: 3 });
      expect({ a: 1, b: 2 }).not.toMatchObject({ a: 1, b: 2, c: 4 });
      expect({ a: new Date(), b: "jj" }).not.toMatchObject({ b: expect.any(Number) });
      expect({ a: "123" }).not.toMatchObject({ a: expect.stringContaining("4") });
      class DString extends String {
        constructor(str) {
          super(str);
        }
      }
      expect({ a: "hello world" }).toMatchObject({ a: expect.stringContaining("wor") });
      expect({ a: "hello world" }).not.toMatchObject({ a: expect.stringContaining("wol") });
      expect({ a: "hello String" }).toMatchObject({ a: expect.stringContaining(new String("Str")) });
      expect({ a: "hello String" }).not.toMatchObject({ a: expect.stringContaining(new String("Strs")) });
      expect({ a: "hello derived String" }).toMatchObject({ a: expect.stringContaining(new DString("riv")) });
      expect({ a: "hello derived String" }).not.toMatchObject({ a: expect.stringContaining(new DString("rivd")) });
      expect({ a: "hello world" }).toMatchObject({ a: expect.stringMatching("wor") });
      expect({ a: "hello world" }).not.toMatchObject({ a: expect.stringMatching("word") });
      expect({ a: "hello world" }).toMatchObject({ a: "hello world" });
      expect({ a: "hello world" }).toMatchObject({ a: expect.stringMatching(/wor/) });
      expect({ a: "hello world" }).not.toMatchObject({ a: expect.stringMatching(/word/) });
      expect({ a: expect.stringMatching("wor") }).toMatchObject({ a: "hello world" });
      expect({ a: expect.stringMatching("word") }).not.toMatchObject({ a: "hello world" });
      expect({ a: expect.stringMatching(/wor/) }).toMatchObject({ a: "hello world" });
      expect({ a: expect.stringMatching(/word/) }).not.toMatchObject({ a: "hello world" });
      expect({ a: expect.stringMatching(/word/) }).toMatchObject({ a: "hello word" });
      expect({ a: [1, 2, 3] }).toMatchObject({ a: [1, 2, 3] });
      expect({ a: [1, 2, 3] }).toMatchObject({ a: [1, 2, 3] });
      expect({ a: [1, 2, 4] }).not.toMatchObject({ a: [1, 2, 3] });

      expect([]).toMatchObject([]);
      expect([]).toMatchObject({});
      expect({}).not.toMatchObject([]);
      expect({ a: 1 }).toMatchObject({});
      expect({ a: 1 }).toMatchObject({ a: 1 });

      expect({ a: 1 }).toMatchObject({ a: expect.anything() });
      expect({ a: null }).not.toMatchObject({ a: expect.anything() });
      expect({ a: undefined }).not.toMatchObject({ a: expect.anything() });

      expect({ a: new Date() }).toMatchObject({ a: expect.any(Date) });
      expect({ a: new Date() }).not.toMatchObject({ a: expect.any(RegExp) });
      expect({ a: new RegExp("a", "g") }).toMatchObject({ a: expect.any(RegExp) });
      expect({ a: /a/g }).toMatchObject({ a: expect.any(RegExp) });

      expect({
        first: new Boolean2(false),
        a: {
          4: [3, 2, 2],
          j: new Date(),
          b: {
            c: {
              num: 1,
              d: {
                e: {
                  bigint: 123n,
                  f: {
                    g: {
                      h: {
                        i: new Number3(2),
                        bool: true,
                      },
                      compare: "compare",
                    },
                  },
                  ignore1: 234,
                  ignore2: {
                    ignore3: 23421,
                    ignore4: {
                      ignore5: {
                        ignore6: "hello",
                        ignore7: "done",
                      },
                    },
                  },
                },
              },
              string1: "hello",
              string2: "hello",
              string3: "hello",
            },
          },
        },
      }).toMatchObject({
        first: expect.any(Boolean2),
        a: {
          4: [3, 2, expect.any(Number)],

          j: expect.any(Date),
          b: {
            c: {
              num: expect.any(Number),
              string1: expect.anything(),
              string2: expect.stringContaining("ll"),
              string3: expect.stringMatching(/ll/),
              d: {
                e: {
                  bigint: expect.any(BigInt),
                  f: {
                    g: {
                      compare: "compare",
                      h: {
                        i: expect.any(Number3),
                        bool: expect.any(Boolean),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      var a1 = [1];
      a1[f] = 99;
      expect(a1).not.toMatchObject([1]);
      expect([1]).not.toMatchObject(a1);
      expect({ 1: 1 }).not.toMatchObject(a1);
      expect(a1).not.toMatchObject({ 1: 1 });
      expect(a1).toMatchObject(a1);
    });
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

  test("toBeNaN()", () => {
    expect(NaN).toBeNaN();
    expect(() => expect(NaN).not.toBeNaN()).toThrow();
    expect(0).not.toBeNaN();
    expect("hello not NaN").not.toBeNaN();
  });

  describe("toBeEmpty()", () => {
    const values = [
      {
        label: `""`,
        value: "",
      },
      {
        label: `[]`,
        value: [],
      },
      {
        label: `{}`,
        value: {},
      },
      {
        label: `new Set()`,
        value: new Set(),
      },
      {
        label: `new Map()`,
        value: new Map(),
      },
      {
        label: `new String()`,
        value: new String(),
      },
      {
        label: `new Array()`,
        value: new Array(),
      },
      {
        label: `new Uint8Array()`,
        value: new Uint8Array(),
      },
      {
        label: `new Object()`,
        value: new Object(),
      },
      {
        label: `Buffer.from("")`,
        value: Buffer.from(""),
      },
      {
        label: `new Headers()`,
        value: new Headers(),
      },
      {
        label: `new URLSearchParams()`,
        value: new URLSearchParams(),
      },
      {
        label: `new FormData()`,
        value: new FormData(),
      },
      {
        label: `(function* () {})()`,
        value: (function* () {})(),
      },
    ];
    if (isBun) {
      values.push({
        label: `Bun.file()`,
        value: Bun.file("/tmp/empty.txt"),
      });
    }
    for (const { label, value } of values) {
      test(label, () => {
        if (value instanceof Blob) {
          require("fs").writeFileSync("/tmp/empty.txt", "");
        }
        expect(value).toBeEmpty();
      });
    }
  });

  describe("not.toBeEmpty()", () => {
    const values = [
      {
        label: `" "`,
        value: " ",
      },
      {
        label: `[""]`,
        value: [""],
      },
      {
        label: `[undefined]`,
        value: [undefined],
      },
      {
        label: `{ "": "" }`,
        value: { "": "" },
      },
      {
        label: `new Set([""])`,
        value: new Set([""]),
      },
      {
        label: `new Map([["", ""]])`,
        value: new Map([["", ""]]),
      },
      {
        label: `new String(" ")`,
        value: new String(" "),
      },
      {
        label: `new Array(1)`,
        value: new Array(1),
      },
      {
        label: `new Uint8Array(1)`,
        value: new Uint8Array(1),
      },
      {
        label: `Buffer.from(" ")`,
        value: Buffer.from(" "),
      },
      {
        label: `new Headers({...})`,
        value: new Headers({
          a: "b",
          c: "d",
        }),
      },
      {
        label: `URL.searchParams`,
        value: new URL("https://example.com?d=e&f=g").searchParams,
      },
      {
        label: `FormData`,
        value: (() => {
          var a = new FormData();
          a.append("a", "b");
          a.append("c", "d");
          return a;
        })(),
      },
      {
        label: `generator function`,
        value: (function* () {
          yield "123";
        })(),
      },
    ];
    if (isBun) {
      values.push({
        label: `Bun.file()`,
        value: Bun.file(__filename),
      });
    }
    for (const { label, value } of values) {
      test(label, () => {
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

  test("toBeArray()", () => {
    expect([]).toBeArray();
    expect([1, 2, 3, "🫓"]).toBeArray();
    expect(new Array()).toBeArray();
    expect(new Array(1, 2, 3)).toBeArray();
    expect({}).not.toBeArray();
    expect("🫓").not.toBeArray();
    expect(0).not.toBeArray();
    expect(true).not.toBeArray();
    expect(null).not.toBeArray();
  });

  test("toBeArrayOfSize()", () => {
    expect([]).toBeArrayOfSize(0);
    expect(new Array()).toBeArrayOfSize(0);
    expect([1, 2, 3, "🫓"]).toBeArrayOfSize(4);
    expect(new Array(1, 2, 3, "🫓")).toBeArrayOfSize(4);
    expect({}).not.toBeArrayOfSize(1);
    expect("").not.toBeArrayOfSize(1);
    expect(0).not.toBeArrayOfSize(1);
  });

  test("toBeTypeOf()", () => {
    expect("Bun! 🫓").toBeTypeOf("string");
    expect(0).toBeTypeOf("number");
    expect(true).toBeTypeOf("boolean");
    expect([]).toBeTypeOf("object");
    expect({}).toBeTypeOf("object");
    expect(null).toBeTypeOf("object");
    expect(undefined).toBeTypeOf("undefined");
    expect(() => {}).toBeTypeOf("function");
    expect(function () {}).toBeTypeOf("function");
    expect(async () => {}).toBeTypeOf("function");
    expect(async function () {}).toBeTypeOf("function");
    expect(function* () {}).toBeTypeOf("function");
    expect(class {}).toBeTypeOf("function");
    expect(new Array()).toBeTypeOf("object");
    expect(BigInt(5)).toBeTypeOf("bigint");
    expect(/(foo|bar)/g).toBeTypeOf("object");
    expect(new RegExp("(foo|bar)", "g")).toBeTypeOf("object");
    expect(new Date()).toBeTypeOf("object");

    expect("Bun!").not.toBeTypeOf("number");
    expect(0).not.toBeTypeOf("string");
    expect(true).not.toBeTypeOf("number");
    expect([]).not.toBeTypeOf("string");
    expect({}).not.toBeTypeOf("number");
    expect(null).not.toBeTypeOf("string");
    expect(undefined).not.toBeTypeOf("boolean");
    expect(() => {}).not.toBeTypeOf("string");
    expect(function () {}).not.toBeTypeOf("boolean");
    expect(async () => {}).not.toBeTypeOf("object");
    expect(class {}).not.toBeTypeOf("bigint");
    expect(/(foo|bar)/g).not.toBeTypeOf("string");
    expect(new RegExp("(foo|bar)", "g")).not.toBeTypeOf("number");
    expect(new Date()).not.toBeTypeOf("string");
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
    // expect("").not.toBeWithin(0, 1);
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
    expect(new Date(-1)).toBeValidDate();
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
