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
  const thisFile = Bun.file(import.meta.path);
  const thisFileSize = thisFile.size;

  expect(thisFile).toHaveLength(thisFileSize);
  expect(thisFile).toHaveLength(Bun.file(import.meta.path).size);

  // empty file should have length 0
  writeFileSync("/tmp/empty.txt", "");
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
  expect([2, "2335", 5, true, false, null, undefined]).not.not.not.toContain(3);

  // expect([4, 5, 6]).not.toContain(5);

  expect([]).not.toContain([]);
});

test("toBeEven()", () => {
  expect(1).not.toBeEven();
  expect(2).toBeEven();
  expect(3).not.toBeEven();
  expect(3.1).not.toBeEven();
  expect(2.1).not.toBeEven();
  expect(4).toBeEven();
  expect(5).not.toBeEven();
  expect(6).toBeEven();
  expect(0).toBeEven();
  expect(-8).toBeEven();
  expect(-0).toBeEven();
  expect(NaN).not.toBeEven();
  expect([]).not.toBeEven();
  expect([1, 2]).not.toBeEven();
  expect({}).not.toBeEven();
  expect(() => {}).not.toBeEven();
  expect("").not.toBeEven();
  expect("string").not.toBeEven();
  expect(undefined).not.toBeEven();
  expect(Math.floor(Date.now() / 1000) * 2).toBeEven(); // Slight fuzz by using timestamp times 2
  expect(Math.floor(Date.now() / 1000) * 4 - 1).not.toBeEven();
  expect(4.0e1).toBeEven();
  expect(6.2e1).toBeEven();
  expect(6.3e1).not.toBeEven();
  expect(6.33e1).not.toBeEven();
  expect(3.3e-1).not.toBeEven(); //throw
  expect(0.3).not.toBeEven(); //throw
  expect(0.4).not.toBeEven();
  expect(1).not.toBeEven();
  expect(0).toBeEven();
  expect(2.0).toBeEven();
  expect(NaN).not.toBeEven();
  expect(2n).toBeEven(); // BigInt at this time not supported in jest-extended
  expect(3n).not.toBeEven();
  expect(9007199254740990).toBeEven(); // manual typical max safe -1 // not int?
  expect(9007199254740990n).toBeEven(); // manual typical max safe -1 as bigint
  expect(Number.MAX_SAFE_INTEGER - 1).toBeEven(); // not int?
  expect(Number.MAX_SAFE_INTEGER).not.toBeEven();
  expect(BigInt(Number.MAX_SAFE_INTEGER) - 1n).toBeEven();
  expect(BigInt(Number.MAX_SAFE_INTEGER)).not.toBeEven();
  expect(BigInt(Number.MAX_VALUE - 1)).toBeEven();
  expect(Number.MIN_SAFE_INTEGER + 1).toBeEven(); // not int?
  expect(Number.MIN_SAFE_INTEGER).not.toBeEven();
  expect(BigInt(Number.MIN_SAFE_INTEGER) + 1n).toBeEven();
  expect(BigInt(Number.MIN_SAFE_INTEGER)).not.toBeEven();
  expect(4 / Number.NEGATIVE_INFINITY).toBeEven(); // as in IEEE-754: + / -inf => neg zero
  expect(5 / Number.NEGATIVE_INFINITY).toBeEven();
  expect(-7 / Number.NEGATIVE_INFINITY).toBeEven(); // as in IEEE-754: - / -inf => zero
  expect(-8 / Number.NEGATIVE_INFINITY).toBeEven();
  expect(new WebAssembly.Global({ value: "i32", mutable: false }, 4).value).toBeEven();
  expect(new WebAssembly.Global({ value: "i32", mutable: false }, 3).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "i32", mutable: true }, 2).value).toBeEven();
  expect(new WebAssembly.Global({ value: "i32", mutable: true }, 1).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "i64", mutable: true }, -9223372036854775808n).value).toBeEven();
  expect(new WebAssembly.Global({ value: "i64", mutable: false }, -9223372036854775808n).value).toBeEven();
  expect(new WebAssembly.Global({ value: "i64", mutable: true }, 9223372036854775807n).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "i64", mutable: false }, 9223372036854775807n).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "f32", mutable: true }, 42.0).value).toBeEven();
  expect(new WebAssembly.Global({ value: "f32", mutable: false }, 42.0).value).toBeEven();
  expect(new WebAssembly.Global({ value: "f64", mutable: true }, 42.0).value).toBeEven();
  expect(new WebAssembly.Global({ value: "f64", mutable: false }, 42.0).value).toBeEven();
  expect(new WebAssembly.Global({ value: "f32", mutable: true }, 43.0).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "f32", mutable: false }, 43.0).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "f64", mutable: true }, 43.0).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "f64", mutable: false }, 43.0).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "f32", mutable: true }, 4.3).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "f32", mutable: false }, 4.3).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "f64", mutable: true }, 4.3).value).not.toBeEven();
  expect(new WebAssembly.Global({ value: "f64", mutable: false }, 4.3).value).not.toBeEven();
  // did not seem to support SIMD v128 type yet (which is not in W3C specs for JS but is a valid global type)
  // FUTURE: expect(new WebAssembly.Global({value:'v128', mutable:false}, -170141183460469231731687303715884105728n).value).toBeEven();
  // FUTURE: expect(new WebAssembly.Global({value:'v128', mutable:true}, -170141183460469231731687303715884105728n).value).toBeEven();
  // FUTURE: expect(new WebAssembly.Global({value:'v128', mutable:true}, 170141183460469231731687303715884105727n).value).not.toBeEven();
  // FUTURE: expect(new WebAssembly.Global({value:'v128', mutable:false}, 170141183460469231731687303715884105727n).value).not.toBeEven();
  // FUTURE: with uintv128: expect(new WebAssembly.Global({value:'v128', mutable:false}, 340282366920938463463374607431768211456n).value).toThrow();
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
  // expect(undefined).not.toBeUndefined();

  expect(null).not.toBeUndefined();
  expect(null).not.not.not.toBeUndefined();
  expect(0).not.toBeUndefined();
  expect("hello defined").not.toBeUndefined();
});

test("toBeNaN()", () => {
  expect(NaN).toBeNaN();
  // expect(NaN).not.toBeNaN();

  expect(0).not.toBeNaN();
  expect("hello not NaN").not.toBeNaN();
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
  // expect(undefined).not.toBeFalsy();

  expect("hello not falsy").not.toBeFalsy();
  expect("hello not falsy").not.not.not.toBeFalsy();
  expect(1).not.toBeFalsy();
  expect(true).not.toBeFalsy();
  expect({}).not.toBeFalsy();
  expect([]).not.toBeFalsy();
  expect(() => {}).not.toBeFalsy();
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

test("toBeOdd()", () => {
  expect(1).toBeOdd();
  expect(2).not.toBeOdd();
  expect(3).toBeOdd();
  expect(3.1).not.toBeOdd();
  expect(2.1).not.toBeOdd();
  expect(4).not.toBeOdd();
  expect(5).toBeOdd();
  expect(6).not.toBeOdd();
  expect(0).not.toBeOdd();
  expect(-8).not.toBeOdd();
  expect(-0).not.toBeOdd();
  expect(NaN).not.toBeOdd();
  expect([]).not.toBeOdd();
  // SHOULD FAIL: expect([]).toBeOdd();
  expect([1, 2]).not.toBeOdd();
  expect({}).not.toBeOdd();
  expect(() => {}).not.toBeOdd();
  expect("").not.toBeOdd();
  expect("string").not.toBeOdd();
  expect(undefined).not.toBeOdd();
  expect(Math.floor(Date.now() / 1000) * 2 - 1).toBeOdd(); // Slight fuzz by using timestamp times 2
  expect(Math.floor(Date.now() / 1000) * 4 - 1).toBeOdd();
  expect(4.0e1).not.toBeOdd();
  expect(6.2e1).not.toBeOdd();
  expect(6.3e1).toBeOdd();
  expect(6.33e1).not.toBeOdd();
  expect(3.2e-3).not.toBeOdd();
  expect(0.3).not.toBeOdd();
  expect(0.4).not.toBeOdd();
  expect(1).toBeOdd();
  expect(0).not.toBeOdd();
  expect(2.0).not.toBeOdd();
  expect(NaN).not.toBeOdd();
  expect(2n).not.toBeOdd(); // BigInt at this time not supported in jest-extended
  expect(3n).toBeOdd();
  expect(9007199254740990).not.toBeOdd(); // manual typical max safe -1
  expect(9007199254740991).toBeOdd();
  expect(9007199254740990n).not.toBeOdd(); // manual typical max safe -1 as bigint
  expect(9007199254740991n).toBeOdd();
  expect(Number.MAX_SAFE_INTEGER - 1).not.toBeOdd();
  expect(Number.MAX_SAFE_INTEGER).toBeOdd();
  expect(BigInt(Number.MAX_SAFE_INTEGER) - 1n).not.toBeOdd();
  expect(BigInt(Number.MAX_SAFE_INTEGER)).toBeOdd();
  expect(Number.MIN_SAFE_INTEGER + 1).not.toBeOdd();
  expect(Number.MIN_SAFE_INTEGER).toBeOdd();
  expect(BigInt(Number.MIN_SAFE_INTEGER) + 1n).not.toBeOdd();
  expect(BigInt(Number.MIN_SAFE_INTEGER)).toBeOdd();
  expect(4 / Number.NEGATIVE_INFINITY).not.toBeOdd(); // in IEEE-754: + / -inf => neg zero
  expect(5 / Number.NEGATIVE_INFINITY).not.toBeOdd();
  expect(-7 / Number.NEGATIVE_INFINITY).not.toBeOdd(); // in IEEE-754: - / -inf => zero
  expect(-8 / Number.NEGATIVE_INFINITY).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "i32", mutable: false }, 4).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "i32", mutable: false }, 3).value).toBeOdd();
  expect(new WebAssembly.Global({ value: "i32", mutable: true }, 2).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "i32", mutable: true }, 1).value).toBeOdd();
  expect(new WebAssembly.Global({ value: "i64", mutable: true }, -9223372036854775808n).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "i64", mutable: false }, -9223372036854775808n).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "i64", mutable: true }, 9223372036854775807n).value).toBeOdd();
  expect(new WebAssembly.Global({ value: "i64", mutable: false }, 9223372036854775807n).value).toBeOdd();
  expect(new WebAssembly.Global({ value: "f32", mutable: true }, 42.0).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "f32", mutable: false }, 42.0).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "f64", mutable: true }, 42.0).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "f64", mutable: false }, 42.0).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "f32", mutable: true }, 43.0).value).toBeOdd();
  expect(new WebAssembly.Global({ value: "f32", mutable: false }, 43.0).value).toBeOdd();
  expect(new WebAssembly.Global({ value: "f64", mutable: true }, 43.0).value).toBeOdd();
  expect(new WebAssembly.Global({ value: "f64", mutable: false }, 43.0).value).toBeOdd();
  expect(new WebAssembly.Global({ value: "f32", mutable: true }, 4.3).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "f32", mutable: false }, 4.3).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "f64", mutable: true }, 4.3).value).not.toBeOdd();
  expect(new WebAssembly.Global({ value: "f64", mutable: false }, 4.3).value).not.toBeOdd();
  // did not seem to support SIMD v128 type yet
  // FUTURE: expect(new WebAssembly.Global({value:'v128', mutable:false}, 42).value).not.toBeOdd();
  // FUTURE: expect(new WebAssembly.Global({value:'v128', mutable:true}, 42).value).not.toBeOdd();
  // FUTURE: expect(new WebAssembly.Global({value:'v128', mutable:true}, 43).value).toBeOdd();
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

  class TestPass extends Error {
    constructor(message) {
      super(message);
      this.name = "TestPass";
    }
  }

  throw new TestPass("This test passed. Ignore the error message");

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
    cmd: [bunExe(), "test", path],
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
    cmd: [bunExe(), "test", path],
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
