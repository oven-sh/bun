// @ts-nocheck
import { spawn, spawnSync } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync, copyFileSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join, dirname } from "path";

const tmp = realpathSync(tmpdir());

it("shouldn't crash when async test runner callback throws", async () => {
  const code = `
  beforeEach(async () => {
    await 1;
    throw "##123##";
  });

  afterEach(async () => {
    await 1;
    console.error("#[Test passed successfully]");
  });

  it("current", async () => {
    await 1;
    throw "##456##";
  })
`;

  const test_dir = realpathSync(await mkdtemp(join(tmpdir(), "test")));
  try {
    await writeFile(join(test_dir, "bad.test.js"), code);
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test", "bad.test.js"],
      cwd: test_dir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const err = await new Response(stderr).text();
    expect(err).toContain("Test passed successfully");
    expect(err).toContain("error: ##123##");
    expect(err).toContain("error: ##456##");
    expect(stdout).toBeDefined();
    expect(await new Response(stdout).text()).toBe("");
    expect(await exited).toBe(1);
  } finally {
    await rm(test_dir, { force: true, recursive: true });
  }
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

test("testing Bun.deepEquals() using isEqual()", () => {
  const t = new Uint8Array([1, 2, 3, 4, 5]);
  expect(t).toEqual(t.slice());

  expect(t.subarray(1)).toEqual(t.slice(1));
  expect(t.subarray(1, 9)).toEqual(t.slice().subarray(1, 9));

  var a = { foo: 1, bar: 2, baz: null };
  var b = { foo: 1, bar: 2, baz: null };
  a.baz = a;
  b.baz = b;
  expect(a).toEqual(b);

  var a = { car: 1, cdr: { car: 2, cdr: null } };
  var b = { car: 1, cdr: { car: 2, cdr: null } };
  a.cdr.cdr = a;
  b.cdr.cdr = b.cdr;
  expect(a).not.toEqual(b);

  expect(1n).not.toEqual(1);
  expect(1).not.toEqual(1n);
  expect(1n).toEqual(1n);
  expect(undefined).not.toEqual([]);

  var a = [1, 2, 3, null];
  var b = [1, 2, 3, null];
  a[3] = b;
  b[3] = a;
  expect(a).toEqual(b);

  var a = [1, 2, 3, null];
  var b = [1, 2, 3, null];
  a[3] = a;
  b[3] = a;
  expect(a).toEqual(b);

  var a = [1, [2, [3, null]]];
  var b = [1, [2, [3, null]]];
  a[1][1][1] = a;
  b[1][1][1] = b[1][1];
  expect(a).not.toEqual(b);

  const foo = [1];
  foo[1] = foo;

  expect(foo).toEqual([1, foo]);

  expect(1).toEqual(1);
  expect([1]).toEqual([1]);

  // expect(a).toEqual(a);
  expect([1, 2, 3]).toEqual([1, 2, 3]);

  let o = { a: 1, b: 2 };
  expect(o).toEqual(o);
  expect(o).toEqual({ a: 1, b: 2 });
  expect(o).toEqual({ b: 2, a: 1 });
  expect({ a: 1, b: 2 }).toEqual(o);
  expect({ b: 2, a: 1 }).toEqual(o);
  expect(o).not.toEqual({ a: 1, b: 2, c: 3 });
  expect({ a: 1, b: 2, c: 3, d: 4 }).not.toEqual(o);
  expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 });
  expect({ a: 1, b: 2 }).not.toEqual({ a: 1 });

  expect("a").toEqual("a");
  expect("aaaa").toEqual("aaaa");
  expect("aaaa").not.toEqual("aaaaa");
  expect("aaaa").not.toEqual("aaba");
  expect("a").not.toEqual("b");

  expect(undefined).not.toEqual(null);
  expect(null).not.toEqual(undefined);
  expect(undefined).not.toEqual(0);
  expect(0).not.toEqual(undefined);
  expect(null).not.toEqual(0);
  expect(0).not.toEqual(null);
  expect(undefined).not.toEqual("");
  expect("").not.toEqual(undefined);
  expect(null).not.toEqual("");
  expect("").not.toEqual(null);
  expect(undefined).not.toEqual(false);
  expect(false).not.toEqual(undefined);
  expect(null).not.toEqual(false);
  expect(false).not.toEqual(null);
  expect(undefined).not.toEqual(true);
  expect(true).not.toEqual(undefined);
  expect(null).not.toEqual(true);
  expect(true).not.toEqual(null);
  expect([]).not.toEqual(undefined);
  expect(null).not.toEqual([]);
  expect([]).not.toEqual(null);

  expect(0).toEqual(0);
  expect(-0).toEqual(-0);
  expect(0).not.toEqual(-0);
  expect(-0).not.toEqual(0);

  expect(NaN).toEqual(NaN);

  expect(null).toEqual(null);
  expect(undefined).toEqual(undefined);

  expect(1).toEqual(1);
  expect(1).not.toEqual(2);

  expect(NaN).toEqual(NaN);
  expect(NaN).toEqual(0 / 0);
  expect(Infinity).toEqual(Infinity);
  expect(Infinity).toEqual(1 / 0);
  expect(-Infinity).toEqual(-Infinity);
  expect(-Infinity).toEqual(-1 / 0);
});

try {
  test("test this doesnt crash");
} catch (e) {}

try {
  test();
} catch (e) {}

describe("throw in describe scope doesn't enqueue tests after thrown", () => {
  it("test enqueued before a describe scope throws is never run", () => {
    throw new Error("This test failed");
  });

  throw "This test passed. Ignore the error message";

  it("test enqueued after a describe scope throws is never run", () => {
    throw new Error("This test failed");
  });
});

it("a describe scope throwing doesn't cause all other tests in the file to fail", () => {
  expect(true).toBe(true);
});

test("test async exceptions fail tests", () => {
  const code = `
  import {test, expect} from 'bun:test';
  import {EventEmitter} from 'events';
  test('test throwing inside an EventEmitter fails the test', () => {
    const emitter = new EventEmitter();
    emitter.on('event', () => {
      throw new Error('test throwing inside an EventEmitter #FAIL001');
    });
    emitter.emit('event');
  });

  test('test throwing inside a queueMicrotask callback fails', async () => {

    queueMicrotask(() => {
      throw new Error('test throwing inside an EventEmitter #FAIL002');
    });

    await 1;
  });

  test('test throwing inside a process.nextTick callback fails', async () => {

    process.nextTick(() => {
      throw new Error('test throwing inside an EventEmitter #FAIL003');
    });

    await 1;
  });

  test('test throwing inside a setTimeout', async () => {
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve();
        throw new Error('test throwing inside an EventEmitter #FAIL004');
      }, 0);
    });
  });

  test('test throwing inside an async setTimeout', async () => {
    await new Promise((resolve, reject) => {
      setTimeout(async () => {
        await 1;
        resolve();
        throw new Error('test throwing inside an EventEmitter #FAIL005');
      }, 0);
    });
  });


  test('test throwing inside an async setTimeout no await' , async () => {
    await new Promise((resolve, reject) => {
      setTimeout(async () => {
        resolve();
        throw new Error('test throwing inside an EventEmitter #FAIL006');
      }, 0);
    });
  });

  `;
  const dir = join(tmpdir(), "test-throwing-bun");
  const filepath = join(dir, "test-throwing-eventemitter.test.js");
  rmSync(filepath, {
    force: true,
  });

  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {}
  writeFileSync(filepath, code);

  const { stderr, exitCode } = spawnSync([bunExe(), "test", "test-throwing-eventemitter"], {
    cwd: realpathSync(dir),
    env: bunEnv,
  });

  const str = stderr!.toString();
  expect(str).toContain("#FAIL001");
  expect(str).toContain("#FAIL002");
  expect(str).toContain("#FAIL003");
  expect(str).toContain("#FAIL004");
  expect(str).toContain("#FAIL005");
  expect(str).toContain("#FAIL006");
  expect(str).toContain("6 fail");
  expect(str).toContain("0 pass");

  expect(exitCode).toBe(1);
});

it("should return non-zero exit code for invalid syntax", async () => {
  const test_dir = realpathSync(await mkdtemp(join(tmpdir(), "test")));
  try {
    await writeFile(join(test_dir, "bad.test.js"), "!!!");
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test", "bad.test.js"],
      cwd: test_dir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const err = await new Response(stderr).text();
    expect(err).toContain("error: Unexpected end of file");
    expect(err).toContain(" 0 pass");
    expect(err).toContain(" 1 fail");
    expect(err).toContain("Ran 1 tests across 1 files");
    expect(stdout).toBeDefined();
    expect(await new Response(stdout).text()).toBe("");
    expect(await exited).toBe(1);
  } finally {
    await rm(test_dir, { force: true, recursive: true });
  }
});

describe("skip test inner", () => {
  it("should pass", () => {
    expect(2 + 2).toBe(4);
  });

  describe.skip("skip", () => {
    it("should throw", () => {
      throw new Error("This should not throw. `.skip` is broken");
    });

    describe("skip non-skipped inner", () => {
      it("should throw", () => {
        throw new Error("This should not throw. `.skip` is broken");
      });
    });
  });
});

describe.skip("skip test outer", () => {
  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });

  describe("skip non-skipped inner", () => {
    it("should throw", () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });

  describe("skip nested non-skipped inner", () => {
    describe("skip", () => {
      it("should throw", () => {
        throw new Error("This should not throw. `.skip` is broken");
      });
    });
  });
});

describe("skip test inner 2", () => {
  it("should pass", () => {
    expect(2 + 2).toBe(4);
  });

  describe.skip("skip", () => {
    it("should throw", () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });
});

describe.skip("skip beforeEach", () => {
  beforeEach(() => {
    throw new Error("should not run `beforeEach`");
  });

  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

describe("nested beforeEach and afterEach", () => {
  let value = 0;

  beforeEach(() => {
    value += 1;
  });

  afterEach(() => {
    value += 1;
  });

  describe("runs beforeEach", () => {
    it("should update value", () => {
      expect(value).toBe(1);
    });
  });

  describe.skip("skips", () => {
    it("should throw", async () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });

  describe.skip("skips async", () => {
    it("should throw", async () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });

  describe("runs beforeEach again", () => {
    it("should have value as 3", () => {
      expect(value).toBe(3);
    });
  });
});

describe.skip("skip afterEach", () => {
  afterEach(() => {
    throw new Error("should not run `afterEach`");
  });

  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

describe.skip("skip beforeAll", () => {
  beforeAll(() => {
    throw new Error("should not run `beforeAll`");
  });

  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

describe.skip("skip afterAll", () => {
  afterAll(() => {
    throw new Error("should not run `afterAll`");
  });

  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

// no labels

describe.skip(() => {
  it("should throw", () => {
    throw new Error("This should not throw. `.skip` is broken");
  });
});

describe(() => {
  it("should pass", () => {
    expect(2 + 2).toBe(4);
  });

  describe.skip("skip", () => {
    it("should throw", () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });
});

it("test.todo", () => {
  const path = join(tmp, "todo-test.test.js");
  copyFileSync(join(import.meta.dir, "todo-test-fixture.js"), path);
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "test", path, "--todo"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: realpathSync(dirname(path)),
  });
  const err = stderr!.toString();
  expect(err).toContain("this test is marked as todo but passes");
  expect(err).toContain("this async error is shown");
  expect(err).toContain("this async error with an await is shown");
  expect(err).toContain("this error is shown");
  expect(err).toContain("4 todo");
  expect(err).toContain("0 pass");
  expect(err).toContain("3 fail");
  expect(exitCode).toBe(1);
});

it("test.todo doesnt cause exit code 1", () => {
  const path = join(tmp, "todo-test.test.js");
  copyFileSync(join(import.meta.dir, "todo-test-fixture-2.js"), path);
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "test", path, "--todo"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: realpathSync(dirname(path)),
  });

  const err = stderr!.toString();
  expect(exitCode).toBe(0);
});

it("test timeouts when expected", () => {
  const path = join(tmp, "test-timeout.test.js");
  copyFileSync(join(import.meta.dir, "timeout-test-fixture.js"), path);
  const { stdout, stderr, exited } = spawnSync({
    cmd: [bunExe(), "test", path],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: realpathSync(dirname(path)),
  });

  const err = stderr!.toString();
  expect(err).toContain("timed out after 10ms");
  expect(err).not.toContain("unreachable code");
});

it("expect().toEqual() on objects with property indices doesn't print undefined", () => {
  const path = join(tmp, "test-fixture-diff-indexed-properties.test.js");
  copyFileSync(join(import.meta.dir, "test-fixture-diff-indexed-properties.js"), path);
  const { stderr } = spawnSync({
    cmd: [bunExe(), "test", path],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: realpathSync(dirname(path)),
  });

  let err = stderr!.toString();
  err = err.substring(err.indexOf("expect(received).toEqual(expected)"), err.indexOf("at "));

  expect(err).toMatchSnapshot();
  expect(err).not.toContain("undefined");
});

it("test --preload supports global lifecycle hooks", () => {
  const preloadedPath = join(tmp, "test-fixture-preload-global-lifecycle-hook-preloaded.js");
  const path = join(tmp, "test-fixture-preload-global-lifecycle-hook-test.test.js");
  copyFileSync(join(import.meta.dir, "test-fixture-preload-global-lifecycle-hook-test.js"), path);
  copyFileSync(join(import.meta.dir, "test-fixture-preload-global-lifecycle-hook-preloaded.js"), preloadedPath);
  const { stdout } = spawnSync({
    cmd: [bunExe(), "test", "--preload=" + preloadedPath, path],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: realpathSync(dirname(path)),
  });
  expect(stdout.toString().trim()).toBe(
    `
beforeAll: #1
beforeAll: #2
beforeAll: TEST-FILE
beforeAll: one describe scope
beforeEach: #1
beforeEach: #2
beforeEach: TEST-FILE
beforeEach: one describe scope
-- inside one describe scope --
afterEach: #1
afterEach: #2
afterEach: TEST-FILE
afterEach: one describe scope
afterAll: one describe scope
beforeEach: #1
beforeEach: #2
beforeEach: TEST-FILE
-- the top-level test --
afterEach: #1
afterEach: #2
afterEach: TEST-FILE
afterAll: TEST-FILE
afterAll: #1
afterAll: #2
`.trim(),
  );
});

it("skip() and skipIf()", () => {
  const path = join(tmp, "skip-test-fixture.test.js");
  copyFileSync(join(import.meta.dir, "skip-test-fixture.js"), path);
  const { stdout } = spawnSync({
    cmd: [bunExe(), "test", path],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
    cwd: realpathSync(dirname(path)),
  });
  const result = stdout!.toString();
  expect(result).not.toContain("unreachable");
  expect(result).toMatch(/reachable/);
  expect(result.match(/reachable/g)).toHaveLength(6);
});
