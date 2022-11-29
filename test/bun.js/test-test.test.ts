import { expect, test } from "bun:test";
import { OnigurumaRegExp } from "bun";

function f1() {
  return "hello!";
}
function f2() {
  return "hey!";
}
test("deepEquals regex", () => {
  expect(new OnigurumaRegExp("s", "g")).toEqual(new OnigurumaRegExp("s", "g"));
  expect(new OnigurumaRegExp("s", "g")).not.toEqual(
    new OnigurumaRegExp("s", "i"),
  );
  expect(/a/imu).toEqual(/a/imu);
  expect(/a/imu).not.toEqual(/ab/imu);

  expect(new RegExp("s", "g")).toEqual(new RegExp("s", "g"));
  expect(new RegExp("s", "g")).not.toEqual(new RegExp("s", "i"));
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

  try {
    expect(new B()).not.toEqual(new C());
  } catch (e) {
    expect(e.message).toContain("b");
  }

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

test("toEqual objects and arrays", () => {
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
  expect(houseForSale).toHaveProperty("kitchen.amenities", [
    "oven",
    "stove",
    "washer",
  ]);
  expect(houseForSale).not.toHaveProperty(["kitchen", "area"], 21);
  expect(houseForSale).toHaveProperty(["kitchen", "area"], 20);
  expect(houseForSale).not.toHaveProperty(["kitchen", "area"], 29);
  expect(houseForSale).toHaveProperty(
    ["kitchen", "amenities"],
    ["oven", "stove", "washer"],
  );
  expect(houseForSale).toHaveProperty("kitchen.amenities[2]", "washer");
  expect(houseForSale).toHaveProperty(["kitchen", "amenities", 1], "stove");
  expect(houseForSale).toHaveProperty(["kitchen", "amenities", 0], "oven");
  expect(houseForSale).toHaveProperty(
    "livingroom.amenities[0].couch[0][1].dimensions[0]",
    20,
  );
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
  expect({ a: new Map([{ a: 1 }, { b: 2 }, { c: 3 }]) }).toHaveProperty(
    "a",
    new Map([{ c: 3 }, { b: 2 }, { a: 1 }]),
  );
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
  expect({ a: new String("a") }).not.toHaveProperty(
    "a",
    new Uint8ClampedArray(),
  );
  expect({ a: new String("a") }).not.toHaveProperty("a", new Int16Array());
  expect({ a: new String("a") }).not.toHaveProperty("a", new Uint16Array());
  expect({ a: new String("a") }).not.toHaveProperty("a", new Int32Array());
  expect({ a: new String("a") }).not.toHaveProperty("a", new Uint32Array());
  expect({ a: new String("a") }).not.toHaveProperty("a", new Float32Array());
  expect({ a: new String("a") }).not.toHaveProperty("a", new Float64Array());
  expect({ a: new String("a") }).not.toHaveProperty("a", new BigInt64Array());
  expect({ a: new String("a") }).not.toHaveProperty("a", new BigUint64Array());
  expect({ a: new String("a") }).not.toHaveProperty("a", new ArrayBuffer());
  expect({ a: new String("a") }).not.toHaveProperty(
    "a",
    new SharedArrayBuffer(),
  );
  expect({ a: new String("a") }).not.toHaveProperty(
    "a",
    new DataView(new ArrayBuffer(1)),
  );

  // test property equality with sets, maps, objects, arrays, and String
  expect({ a: new Set([1, 2, 3]) }).toHaveProperty("a", new Set([1, 2, 3]));
  expect({ a: new Map([{ a: 1 }, { b: 2 }, { c: 3 }]) }).toHaveProperty(
    "a",
    new Map([{ a: 1 }, { b: 2 }, { c: 3 }]),
  );
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
  expect({ length: Number.MAX_SAFE_INTEGER }).toHaveLength(
    Number.MAX_SAFE_INTEGER,
  );
  expect("123").toHaveLength(3);
  expect([1, 2, 3]).toHaveLength(3);
  expect([1, 2, 3]).not.toHaveLength(2);
  expect("123").not.toHaveLength(2);
  expect({ length: 3 }).toHaveLength(3);
  expect({ length: 3 }).not.toHaveLength(2);
  expect({ length: 3 }).not.toHaveLength(Number.MAX_SAFE_INTEGER);
  expect({ length: Number.MAX_SAFE_INTEGER }).not.toHaveLength(
    Number.MAX_SAFE_INTEGER - 1,
  );
  expect({ length: 3.3 }).not.toHaveLength(3);
  expect("123").not.toHaveLength(-0);
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

test("toBeTruthy()", () => {
  expect("test").toBeTruthy();
  expect(true).toBeTruthy();
  expect(1).toBeTruthy();
  expect({}).toBeTruthy();
  expect([]).toBeTruthy();
  expect(() => {}).toBeTruthy();
  // expect(() => {}).not.toBeTruthy();

  expect("").not.toBeTruthy();
  expect(0).not.toBeTruthy();
  expect(-0).not.toBeTruthy();
  expect(NaN).not.toBeTruthy();
  expect(0n).not.toBeTruthy();
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
