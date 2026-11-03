// Translated from CPython 3.15's Lib/test/test_deque.py: TestBasic, and of TestVariousIteratorArgs what needs no
// test.seq_tests.
// Left out of TestBasic: test_container_iterator and test_sizeof, which are about CPython's collector and its memory.
// Not translated: TestSubclass, TestSubclassWithKwargs, TestSequence (test.seq_tests), the doctests.
// Sizes marked "there:" are smaller here, for the sake of debug builds.
import { kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  ArithmeticError,
  AttributeError,
  IndexError,
  NotImplemented,
  RuntimeError,
  StopIteration,
  SyntaxError as PySyntaxError,
  TypeError as PyTypeError,
  ValueError,
  eval as pyeval,
  hash,
  id,
  iter,
  len,
  list,
  map,
  next,
  range,
  repr,
  reversed,
  str,
  tuple,
  type,
} from "python:builtins";
import { deque } from "python:collections";
import copy from "python:copy";
import gc from "python:gc";
import { add, contains, delitem, eq, ge, getitem, gt, iadd, imul, le, lt, ne, setitem } from "python:operator";
import pickle from "python:pickle";
import random from "python:random";
import { makeClass, py, t } from "./helpers";

// there: 100000
const BIG = 2000;

function* fail() {
  throw new PySyntaxError();
  yield 1;
}

const BadCmp = makeClass("BadCmp", [], {
  __eq__() {
    throw new RuntimeError();
  },
});

const MutateCmp = makeClass("MutateCmp", [], {
  __init__(deque: any, result: boolean) {
    this.deque = deque;
    this.result = result;
  },
  __eq__() {
    this.deque.clear();
    return this.result;
  },
});

const times = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

describe("TestBasic", () => {
  test("test_basics", () => {
    const d = deque(range(-5125, -5000));
    d.__init__(range(200));
    for (let i = 200; i < 400; i++) d.append(i);
    for (const i of reversed(range(-200, 0))) d.appendleft(i);
    expect(list(d)).toEqual(list(range(-200, 400)));
    expect(len(d)).toBe(600);
    expect(d.length).toBe(600);

    const left = times(250, () => d.popleft());
    expect(left).toEqual(list(range(-200, 50)));
    expect(list(d)).toEqual(list(range(50, 400)));

    const right = times(250, () => d.pop());
    right.reverse();
    expect(right).toEqual(list(range(150, 400)));
    expect(list(d)).toEqual(list(range(50, 150)));
    expect([...d]).toEqual([...range(50, 150)]);
  });

  test("test_maxlen", () => {
    expect(() => deque("abc", -1)).toThrow(ValueError);
    expect(() => deque("abc", -2)).toThrow(ValueError);
    const it = iter(range(10));
    let d = deque(it, kwargs({ maxlen: 3 }));
    expect(list(it)).toEqual([]);
    expect(repr(d)).toBe("deque([7, 8, 9], maxlen=3)");
    expect(list(d)).toEqual([7, 8, 9]);
    expect(d).toEqual(deque(range(10), 3));
    d.append(10);
    expect(list(d)).toEqual([8, 9, 10]);
    d.appendleft(7);
    expect(list(d)).toEqual([7, 8, 9]);
    d.extend([10, 11]);
    expect(list(d)).toEqual([9, 10, 11]);
    d.extendleft([8, 7]);
    expect(list(d)).toEqual([7, 8, 9]);
    d = deque(range(200), kwargs({ maxlen: 10 }));
    d.append(d);
    expect(repr(d).slice(-30)).toBe(", 198, 199, [...]], maxlen=10)");
    d = deque(range(10), kwargs({ maxlen: undefined }));
    expect(repr(d)).toBe("deque([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])");
  });

  test("test_maxlen_zero", () => {
    let it = iter(range(100));
    deque(it, kwargs({ maxlen: 0 }));
    expect(list(it)).toEqual([]);

    it = iter(range(100));
    let d = deque(kwargs({ maxlen: 0 }));
    d.extend(it);
    expect(list(it)).toEqual([]);

    it = iter(range(100));
    d = deque(kwargs({ maxlen: 0 }));
    d.extendleft(it);
    expect(list(it)).toEqual([]);
  });

  test("test_maxlen_attribute", () => {
    expect(deque().maxlen).toBeUndefined();
    expect(deque("abc").maxlen).toBeUndefined();
    expect(deque("abc", kwargs({ maxlen: 4 })).maxlen).toBe(4);
    expect(deque("abc", kwargs({ maxlen: 2 })).maxlen).toBe(2);
    expect(deque("abc", kwargs({ maxlen: 0 })).maxlen).toBe(0);
    expect(() => {
      const d = deque("abc");
      d.maxlen = 10;
    }).toThrow(AttributeError);
  });

  test("test_count", () => {
    let d: any;
    for (const text of ["", "abracadabra", "simsalabim".repeat(500) + "abc"]) {
      const s = list(text);
      d = deque(s);
      for (const letter of "abcdefghijklmnopqrstuvwxyz") expect(list.count(s, letter)).toBe(d.count(letter));
    }
    expect(() => d.count()).toThrow(PyTypeError); // too few args
    expect(() => d.count(1, 2)).toThrow(PyTypeError); // too many args
    const BadCompare = makeClass("BadCompare", [], {
      __eq__() {
        throw new ArithmeticError();
      },
    });
    d = deque([1, 2, BadCompare(), 3]);
    expect(() => d.count(2)).toThrow(ArithmeticError);
    d = deque([1, 2, 3]);
    expect(() => d.count(BadCompare())).toThrow(ArithmeticError);
    const MutatingCompare = makeClass("MutatingCompare", [], {
      __eq__() {
        this.d.pop();
        return true;
      },
    });
    const m = MutatingCompare();
    d = deque([1, 2, 3, m, 4, 5]);
    m.d = d;
    expect(() => d.count(3)).toThrow(RuntimeError);

    // test issue11004
    // block advance failed after rotation aligned elements on right side of block
    d = deque(new Array(16).fill(undefined));
    for (let i = 0; i < len(d); i++) d.rotate(-1);
    d.rotate(1);
    expect(d.count(1)).toBe(0);
    expect(d.count(undefined)).toBe(16);
    expect(d.count(null)).toBe(16);
  });

  test("test_comparisons", () => {
    const d = deque("xabc");
    d.popleft();
    for (const e of [d, deque("abc"), deque("ab"), deque(), list(d)]) {
      expect(d == e).toBe(type(d) === type(e) && eq(list(d), list(e)));
      expect(d != e).toBe(!(type(d) === type(e) && eq(list(d), list(e))));
    }

    // The iterator is used up by the first round of the inner loop, there as here.
    const args = map(deque, t("", "a", "b", "ab", "ba", "abc", "xba", "xabc", "cba"));
    let rounds = 0;
    for (const x of args) {
      for (const y of args) {
        rounds++;
        expect(x == y).toBe(eq(list(x), list(y)));
        expect(x != y).toBe(ne(list(x), list(y)));
        expect(x < y).toBe(lt(list(x), list(y)));
        expect(x <= y).toBe(le(list(x), list(y)));
        expect(x > y).toBe(gt(list(x), list(y)));
        expect(x >= y).toBe(ge(list(x), list(y)));
      }
    }
    expect(rounds).toBe(8);
  });

  test("test_contains", () => {
    const n = 200;

    let d = deque(range(n));
    for (let i = 0; i < n; i++) expect(contains(d, i)).toBe(true);
    expect(contains(d, n + 1)).toBe(false);

    // Test detection of mutation during iteration
    d = deque(range(n));
    d[n / 2] = MutateCmp(d, false);
    expect(() => contains(d, n)).toThrow(RuntimeError);

    // Test detection of comparison exceptions
    d = deque(range(n));
    d[n / 2] = BadCmp();
    expect(() => contains(d, n)).toThrow(RuntimeError);
  });

  test("test_contains_count_index_stop_crashes", () => {
    let d: any;
    const A = makeClass("A", [], {
      __eq__() {
        d.clear();
        return NotImplemented;
      },
    });
    d = deque([A(), A()]);
    expect(() => contains(d, 3)).toThrow(RuntimeError);
    d = deque([A(), A()]);
    expect(() => d.count(3)).toThrow(RuntimeError);

    d = deque([A()]);
    expect(() => d.index(0)).toThrow(RuntimeError);
  });

  test("test_extend", () => {
    const d = deque("a");
    expect(() => d.extend(1)).toThrow(PyTypeError);
    d.extend("bcd");
    expect(list(d)).toEqual(list("abcd"));
    d.extend(d);
    expect(list(d)).toEqual(list("abcdabcd"));
  });

  test("test_add", () => {
    const d = deque();
    const e = deque("abc");
    const f = deque("def");
    expect(d + d).toEqual(deque());
    expect(e + f).toEqual(deque("abcdef"));
    expect(e + e).toEqual(deque("abcabc"));
    expect(e + d).toEqual(deque("abc"));
    expect(d + e).toEqual(deque("abc"));
    expect(d + d).not.toBe(deque());
    expect(e + d).not.toBe(deque("abc"));
    expect(d + e).not.toBe(deque("abc"));

    const g = deque("abcdef", kwargs({ maxlen: 4 }));
    const h = deque("gh");
    expect(g + h).toEqual(deque("efgh"));

    expect(() => add(deque("abc"), "def")).toThrow(PyTypeError);
    expect(() => deque("abc") + "def").toThrow(PyTypeError);
  });

  test("test_iadd", () => {
    // `d += x` in JavaScript is `d = d + x`: __add__, which a deque does not have for a str.
    let d = deque("a");
    d = iadd(d, "bcd");
    expect(list(d)).toEqual(list("abcd"));
    d = iadd(d, d);
    expect(list(d)).toEqual(list("abcdabcd"));
    const same = d;
    d += deque("e");
    expect(list(d)).toEqual(list("abcdabcde"));
    expect(d).not.toBe(same);
  });

  test("test_extendleft", () => {
    let d = deque("a");
    expect(() => d.extendleft(1)).toThrow(PyTypeError);
    d.extendleft("bcd");
    expect(list(d)).toEqual(list(reversed("abcd")));
    d.extendleft(d);
    expect(list(d)).toEqual(list("abcddcba"));
    d = deque();
    d.extendleft(range(1000));
    expect(list(d)).toEqual(list(reversed(range(1000))));
    expect(() => d.extendleft(fail())).toThrow(PySyntaxError);
  });

  test("test_getitem", () => {
    // there: 200
    const n = 50;
    let d = deque(range(n));
    const l = list(range(n));
    for (let i = 0; i < n; i++) {
      d.popleft();
      l.shift();
      if (random.random() < 0.5) {
        d.append(i);
        l.push(i);
      }
      for (let j = 1 - l.length; j < l.length; j++) expect(getitem(d, j)).toBe(getitem(l, j));
      for (let j = 0; j < l.length; j++) expect(d[j]).toBe(l[j]);
    }

    d = deque("superman");
    expect(d[0]).toBe("s");
    expect(getitem(d, -1)).toBe("n");
    // As with an array: a property whose name is a negative number is no index.
    expect(d[-1]).toBeUndefined();
    d = deque();
    expect(() => d.__getitem__(0)).toThrow(IndexError);
    expect(() => d.__getitem__(-1)).toThrow(IndexError);
    expect(d[0]).toBeUndefined();
  });

  test("test_index", () => {
    let d: any;
    for (const n of [1, 2, 30, 40, 200]) {
      d = deque(range(n));
      for (let i = 0; i < n; i++) expect(d.index(i)).toBe(i);

      expect(() => d.index(n + 1)).toThrow(ValueError);

      // Test detection of mutation during iteration
      d = deque(range(n));
      d[n >> 1] = MutateCmp(d, false);
      expect(() => d.index(n)).toThrow(RuntimeError);

      // Test detection of comparison exceptions
      d = deque(range(n));
      d[n >> 1] = BadCmp();
      expect(() => d.index(n)).toThrow(RuntimeError);
    }

    // Test start and stop arguments behavior matches list.index()
    const elements = "ABCDEFGHI";
    d = deque(elements.repeat(2));
    const s = list(elements.repeat(2));
    // there: every start and stop
    for (let start = -5 - s.length * 2; start < 5 + s.length * 2; start += 5) {
      for (let stop = -5 - s.length * 2; stop < 5 + s.length * 2; stop += 3) {
        for (const element of elements + "Z") {
          let target: number;
          try {
            target = list.index(s, element, start, stop);
          } catch (error) {
            expect(error).toBeInstanceOf(ValueError);
            expect(() => d.index(element, start, stop)).toThrow(ValueError);
            continue;
          }
          expect(d.index(element, start, stop)).toBe(target);
        }
      }
    }

    // Test stop argument
    for (const elem of d) {
      const index = d.index(elem);
      expect(index).toBe(d.index(elem, 0));
      expect(index).toBe(d.index(elem, 0, len(d)));
      expect(index).toBe(d.index(elem, 0, len(d) + 100));
    }

    // Test large start argument
    d = deque(range(0, 10000, 10));
    for (let step = 0; step < 100; step++) {
      const i = d.index(8500, 700);
      expect(d[i]).toBe(8500);
      // Repeat test with a different internal offset
      d.rotate();
    }
  });

  test("test_index_bug_24913", () => {
    const d = deque("A".repeat(3));
    expect(() => d.index("Hello world", 0, 4)).toThrow(ValueError);
  });

  test("test_insert", () => {
    // Test to make sure insert behaves like lists
    const elements = "ABCDEFGHI";
    for (let i = -5 - elements.length * 2; i < 5 + elements.length * 2; i++) {
      const d = deque("ABCDEFGHI");
      const s = list("ABCDEFGHI");
      d.insert(i, "Z");
      list.insert(s, i, "Z");
      expect(list(d)).toEqual(s);
    }
  });

  test("test_insert_bug_26194", () => {
    const data = "ABC";
    let d = deque(data, kwargs({ maxlen: data.length }));
    expect(() => d.insert(2, undefined)).toThrow(IndexError);

    const elements = "ABCDEFGHI";
    for (let i = -elements.length; i < elements.length; i++) {
      d = deque(elements, kwargs({ maxlen: elements.length + 1 }));
      d.insert(i, "Z");
      if (i >= 0) expect(d[i]).toBe("Z");
      else expect(getitem(d, i - 1)).toBe("Z");
    }
  });

  test("test_imul", () => {
    for (const n of [-10, -1, 0, 1, 2, 10, 1000]) {
      let d = deque();
      d = imul(d, n);
      expect(d).toEqual(deque());
      expect(d.maxlen).toBeUndefined();
    }

    for (const n of [-10, -1, 0, 1, 2, 10, 1000]) {
      let d = deque("a");
      d = imul(d, n);
      expect(d).toEqual(deque("a".repeat(Math.max(n, 0))));
      expect(d.maxlen).toBeUndefined();
    }

    for (const n of [-10, -1, 0, 1, 2, 10, 499, 500, 501, 1000]) {
      let d = deque("a", 500);
      d = imul(d, n);
      expect(d).toEqual(deque("a".repeat(Math.max(Math.min(n, 500), 0))));
      expect(d.maxlen).toBe(500);
    }

    for (const n of [-10, -1, 0, 1, 2, 10, 1000]) {
      let d = deque("abcdef");
      d = imul(d, n);
      expect(d).toEqual(deque("abcdef".repeat(Math.max(n, 0))));
      expect(d.maxlen).toBeUndefined();
    }

    for (const n of [-10, -1, 0, 1, 2, 10, 499, 500, 501, 1000]) {
      let d = deque("abcdef", 500);
      d = imul(d, n);
      expect(d).toEqual(deque("abcdef".repeat(Math.max(n, 0)).slice(-500)));
      expect(d.maxlen).toBe(500);
    }

    // `d *= n` in JavaScript is `d = d * n`: the same items in another deque.
    let d = deque("ab", 3);
    const same = d;
    d *= 2;
    expect(d).toEqual(deque("bab"));
    expect(d.maxlen).toBe(3);
    expect(d).not.toBe(same);
    expect(imul(same, 2)).toBe(same);
  });

  test("test_mul", () => {
    let d = deque("abc");
    expect(d * -5).toEqual(deque());
    expect(d * 0).toEqual(deque());
    expect(d * 1).toEqual(deque("abc"));
    expect(d * 2).toEqual(deque("abcabc"));
    expect(d * 3).toEqual(deque("abcabcabc"));
    expect(d * 1).not.toBe(d);

    expect(deque() * 0).toEqual(deque());
    expect(deque() * 1).toEqual(deque());
    expect(deque() * 5).toEqual(deque());

    expect(-5 * d).toEqual(deque());
    expect(0 * d).toEqual(deque());
    expect(1 * d).toEqual(deque("abc"));
    expect(2 * d).toEqual(deque("abcabc"));
    expect(3 * d).toEqual(deque("abcabcabc"));

    d = deque("abc", kwargs({ maxlen: 5 }));
    expect(d * -5).toEqual(deque());
    expect(d * 0).toEqual(deque());
    expect(d * 1).toEqual(deque("abc"));
    expect(d * 2).toEqual(deque("bcabc"));
    expect(d * 30).toEqual(deque("bcabc"));
  });

  test("test_setitem", () => {
    const n = 200;
    const d = deque(range(n));
    for (let i = 0; i < n; i++) d[i] = 10 * i;
    expect(list(d)).toEqual(times(n, i => 10 * i));
    const l = list(d);
    for (let i = 1 - n; i < 0; i++) {
      setitem(d, i, 7 * i);
      setitem(l, i, 7 * i);
    }
    expect(list(d)).toEqual(l);
  });

  test("test_delitem", () => {
    // there: 500
    const n = 100; // O(n**2) test, don't make this too big
    const d = deque(range(n));
    expect(() => d.__delitem__(-n - 1)).toThrow(IndexError);
    expect(() => d.__delitem__(n)).toThrow(IndexError);
    for (let i = 0; i < n; i++) {
      expect(len(d)).toBe(n - i);
      const j = random.randrange(-len(d), len(d));
      const val = getitem(d, j);
      expect(contains(d, val)).toBe(true);
      if (j >= 0) delete d[j];
      else delitem(d, j);
      expect(contains(d, val)).toBe(false);
    }
    expect(len(d)).toBe(0);
  });

  test("test_reverse", () => {
    // there: 500
    const n = 100; // O(n**2) test, don't make this too big
    const data = times(n, () => random.random());
    let d: any;
    for (let i = 0; i < n; i++) {
      d = deque(data.slice(0, i));
      const r = d.reverse();
      expect(list(d)).toEqual(list(reversed(data.slice(0, i))));
      expect(r).toBeUndefined();
      d.reverse();
      expect(list(d)).toEqual(data.slice(0, i));
    }
    expect(() => d.reverse(1)).toThrow(PyTypeError); // Arity is zero
  });

  test("test_rotate", () => {
    const s = tuple("abcde");
    const n = len(s);

    let d = deque(s);
    d.rotate(1); // verify rot(1)
    expect(str.join("", d)).toBe("eabcd");

    d = deque(s);
    d.rotate(-1); // verify rot(-1)
    expect(str.join("", d)).toBe("bcdea");
    d.rotate(); // check default to 1
    expect(tuple(d)).toEqual(s);

    for (let i = 0; i < n * 3; i++) {
      d = deque(s);
      const e = deque(d);
      d.rotate(i); // check vs. rot(1) n times
      for (let j = 0; j < i; j++) e.rotate(1);
      expect(tuple(d)).toEqual(tuple(e));
      // Not -i: for 0 that is -0 in JavaScript, which is a float to Python.
      d.rotate(0 - i); // check that it works in reverse
      expect(tuple(d)).toEqual(s);
      e.rotate(n - i); // check that it wraps forward
      expect(tuple(e)).toEqual(s);
    }

    for (let i = 0; i < n * 3; i++) {
      d = deque(s);
      const e = deque(d);
      d.rotate(0 - i);
      for (let j = 0; j < i; j++) e.rotate(-1); // check vs. rot(-1) n times
      expect(tuple(d)).toEqual(tuple(e));
      d.rotate(i); // check that it works in reverse
      expect(tuple(d)).toEqual(s);
      e.rotate(i - n); // check that it wraps backaround
      expect(tuple(e)).toEqual(s);
    }

    d = deque(s);
    const e = deque(s);
    e.rotate(BIG + 17); // verify on long series of rotates
    const dr = d.rotate;
    for (let i = 0; i < BIG + 17; i++) dr();
    expect(tuple(d)).toEqual(tuple(e));

    expect(() => d.rotate("x")).toThrow(PyTypeError); // Wrong arg type
    expect(() => d.rotate(-0)).toThrow(PyTypeError);
    expect(() => d.rotate(1, 10)).toThrow(PyTypeError); // Too many args

    d = deque();
    d.rotate(); // rotate an empty deque
    expect(d).toEqual(deque());
  });

  test("test_len", () => {
    const d = deque("ab");
    expect(len(d)).toBe(2);
    d.popleft();
    expect(len(d)).toBe(1);
    d.pop();
    expect(len(d)).toBe(0);
    expect(() => d.pop()).toThrow(IndexError);
    expect(len(d)).toBe(0);
    d.append("c");
    expect(len(d)).toBe(1);
    d.appendleft("d");
    expect(len(d)).toBe(2);
    d.clear();
    expect(len(d)).toBe(0);
  });

  test("test_underflow", () => {
    const d = deque();
    expect(() => d.pop()).toThrow(IndexError);
    expect(() => d.popleft()).toThrow(IndexError);
    // A method taken off its object stays bound, as in Python.
    expect(d.pop).toThrow(IndexError);
  });

  test("test_clear", () => {
    const d = deque(range(100));
    expect(len(d)).toBe(100);
    d.clear();
    expect(len(d)).toBe(0);
    expect(list(d)).toEqual([]);
    d.clear(); // clear an empty deque
    expect(list(d)).toEqual([]);
  });

  test("test_remove", () => {
    let d = deque("abcdefghcij");
    d.remove("c");
    expect(d).toEqual(deque("abdefghcij"));
    d.remove("c");
    expect(d).toEqual(deque("abdefghij"));
    expect(() => d.remove("c")).toThrow(ValueError);
    expect(d).toEqual(deque("abdefghij"));

    // Handle comparison errors
    d = deque(["a", "b", BadCmp(), "c"]);
    const e = deque(d);
    expect(() => d.remove("c")).toThrow(RuntimeError);
    // verify that original order and values are retained.
    for (const [i, x] of [...d].entries()) expect(x).toBe(e[i]);

    // Handle evil mutator
    for (const match of [true, false]) {
      d = deque(["ab"]);
      d.extend([MutateCmp(d, match), "c"]);
      expect(() => d.remove("c")).toThrow(IndexError);
      expect(d).toEqual(deque());
    }
  });

  test("test_repr", () => {
    const d = deque(range(200));
    const e = pyeval(repr(d), py({ deque }));
    expect(list(d)).toEqual(list(e));
    d.append(d);
    expect(repr(d).slice(-20)).toBe("7, 198, 199, [...]])");
    expect(Bun.inspect(d)).toBe(repr(d));
    expect(String(d)).toBe(repr(d));
  });

  test("test_init", () => {
    expect(() => deque("abc", 2, 3)).toThrow(PyTypeError);
    expect(() => deque(1)).toThrow(PyTypeError);
  });

  test("test_hash", () => {
    expect(() => hash(deque("abc"))).toThrow(PyTypeError);
  });

  test("test_long_steadystate_queue_popleft", () => {
    for (const size of [0, 1, 2, 100, 1000]) {
      const d = deque(range(size));
      const [append, pop] = [d.append, d.popleft];
      for (let i = size; i < BIG; i++) {
        append(i);
        const x = pop();
        if (x != i - size) expect(x).toBe(i - size);
      }
      expect(list(d)).toEqual(list(range(BIG - size, BIG)));
    }
  });

  test("test_long_steadystate_queue_popright", () => {
    for (const size of [0, 1, 2, 100, 1000]) {
      const d = deque(reversed(range(size)));
      const [append, pop] = [d.appendleft, d.pop];
      for (let i = size; i < BIG; i++) {
        append(i);
        const x = pop();
        if (x != i - size) expect(x).toBe(i - size);
      }
      expect(list(reversed(list(d)))).toEqual(list(range(BIG - size, BIG)));
    }
  });

  test("test_big_queue_popleft", () => {
    const d = deque();
    const [append, pop] = [d.append, d.popleft];
    for (let i = 0; i < BIG; i++) append(i);
    for (let i = 0; i < BIG; i++) {
      const x = pop();
      if (x != i) expect(x).toBe(i);
    }
  });

  test("test_big_queue_popright", () => {
    const d = deque();
    const [append, pop] = [d.appendleft, d.pop];
    for (let i = 0; i < BIG; i++) append(i);
    for (let i = 0; i < BIG; i++) {
      const x = pop();
      if (x != i) expect(x).toBe(i);
    }
  });

  test("test_big_stack_right", () => {
    const d = deque();
    const [append, pop] = [d.append, d.pop];
    for (let i = 0; i < BIG; i++) append(i);
    for (let i = BIG - 1; i >= 0; i--) {
      const x = pop();
      if (x != i) expect(x).toBe(i);
    }
    expect(len(d)).toBe(0);
  });

  test("test_big_stack_left", () => {
    const d = deque();
    const [append, pop] = [d.appendleft, d.popleft];
    for (let i = 0; i < BIG; i++) append(i);
    for (let i = BIG - 1; i >= 0; i--) {
      const x = pop();
      if (x != i) expect(x).toBe(i);
    }
    expect(len(d)).toBe(0);
  });

  test("test_roundtrip_iter_init", () => {
    const d = deque(range(200));
    const e = deque(d);
    expect(id(d)).not.toBe(id(e));
    expect(list(d)).toEqual(list(e));
  });

  test("test_pickle", () => {
    for (const d of [deque(range(200)), deque(range(200), 100)]) {
      for (let i = 0; i <= pickle.HIGHEST_PROTOCOL; i++) {
        const s = pickle.dumps(d, i);
        const e = pickle.loads(s);
        expect(id(e)).not.toBe(id(d));
        expect(list(e)).toEqual(list(d));
        expect(e.maxlen).toBe(d.maxlen);
      }
    }
  });

  test("test_pickle_recursive", () => {
    for (const d of [deque("abc"), deque("abc", 3)]) {
      d.append(d);
      for (let i = 0; i <= pickle.HIGHEST_PROTOCOL; i++) {
        const e = pickle.loads(pickle.dumps(d, i));
        expect(id(e)).not.toBe(id(d));
        expect(id(getitem(e, -1))).toBe(id(e));
        expect(getitem(e, -1)).toBe(e);
        expect(e.maxlen).toBe(d.maxlen);
      }
    }
  });

  test("test_iterator_pickle", () => {
    const orig = deque(range(200));
    const data = Array.from(orig, (i: any) => i * 1.01);
    for (let proto = 0; proto <= pickle.HIGHEST_PROTOCOL; proto++) {
      const check = (itorg: any, expected: number[]) => {
        const dump = pickle.dumps(t(itorg, orig), proto);
        const [it, d] = pickle.loads(dump);
        for (const [i, x] of data.entries()) d[i] = x;
        expect(type(it)).toBe(type(itorg));
        expect(list(it)).toEqual(expected);
      };

      // initial iterator
      const itorg = iter(orig);
      check(itorg, data);

      // running iterator
      next(itorg);
      check(itorg, data.slice(1));

      // empty iterator
      for (let i = 1; i < data.length; i++) next(itorg);
      check(itorg, []);

      // exhausted iterator
      expect(() => next(itorg)).toThrow(StopIteration);
      check(itorg, []);
    }
  });

  test("test_deepcopy", () => {
    const mut = [10];
    const d = deque([mut]);
    const e = copy.deepcopy(d);
    expect(list(d)).toEqual(list(e));
    mut[0] = 11;
    expect(id(d)).not.toBe(id(e));
    expect(list(d)).not.toEqual(list(e));
  });

  test("test_copy", () => {
    const mut = [10];
    let d = deque([mut]);
    let e = copy.copy(d);
    expect(list(d)).toEqual(list(e));
    mut[0] = 11;
    expect(id(d)).not.toBe(id(e));
    expect(list(d)).toEqual(list(e));

    for (let i = 0; i < 5; i++) {
      for (let maxlen = -1; maxlen < 6; maxlen++) {
        const s = times(i, () => random.random());
        d = maxlen == -1 ? deque(s) : deque(s, maxlen);
        e = d.copy();
        expect(d).toEqual(e);
        expect(d.maxlen).toBe(e.maxlen);
        expect([...d].every((x, i) => x === e[i])).toBe(true);
      }
    }
  });

  test("test_copy_method", () => {
    const mut = [10];
    const d = deque([mut]);
    const e = d.copy();
    expect(list(d)).toEqual(list(e));
    mut[0] = 11;
    expect(id(d)).not.toBe(id(e));
    expect(list(d)).toEqual(list(e));
  });

  test("test_reversed", () => {
    for (const s of ["abcd", range(2000)]) expect(list(reversed(deque(s)))).toEqual(list(reversed(s)));
  });

  test("test_reversed_new", () => {
    const klass = type(reversed(deque()));
    for (const s of ["abcd", range(2000)]) expect(list(klass(deque(s)))).toEqual(list(reversed(s)));
  });

  test("test_gc_doesnt_blowup", () => {
    // This used to assert-fail in deque_traverse() under a debug
    // build, or run wild with a NULL pointer in a release build.
    const d = deque();
    // there: 100
    for (let i = 0; i < 5; i++) {
      d.append(1);
      gc.collect();
    }
  });
});

describe("TestVariousIteratorArgs", () => {
  test("test_iter_with_altered_data", () => {
    const d = deque("abcdefg");
    const it = iter(d);
    d.pop();
    expect(() => next(it)).toThrow(RuntimeError);
    // The iterator of JavaScript is that of Python.
    const js = d[Symbol.iterator]();
    d.pop();
    expect(() => js.next()).toThrow(RuntimeError);
  });

  test("test_runtime_error_on_empty_deque", () => {
    const d = deque();
    const it = iter(d);
    d.append(10);
    expect(() => next(it)).toThrow(RuntimeError);
  });
});
