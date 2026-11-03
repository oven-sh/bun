// Translated from CPython 3.15's Lib/test/test_functools.py: of TestPartial, TestReduce, TestCmpToKey, TestLRU and
// TestSingleDispatch, the tests named below. There most classes run twice, with and without the accelerator module; here once.
// The functions that are wrapped, cached, compared with and dispatched to are functions of JavaScript.
// Not translated: placeholders, repr, pickling, copying and __setstate__ of partial objects, partialmethod, update_wrapper and
// wraps, total_ordering, cached_property (they are about classes and functions written in Python), threads, signatures,
// annotations, the abstract base classes in singledispatch.
import { float, kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import _js from "python:_js";
import {
  AttributeError,
  IndexError,
  RuntimeError,
  TypeError as PyTypeError,
  ValueError,
  ZeroDivisionError,
  callable,
  dict,
  float as pyfloat,
  getattr,
  hash,
  int,
  list,
  map,
  object,
  range,
  repr,
  sorted,
  str,
  tuple,
  type,
} from "python:builtins";
import abc from "python:collections.abc";
import functools, { cmp_to_key, lru_cache, partial, reduce, singledispatch } from "python:functools";
import operator, { getitem, truediv } from "python:operator";
import { choice } from "python:random";
import { call, makeClass, py, raises, t } from "./helpers";

/**
 * capture all positional and keyword arguments
 *
 * There `def capture(*args, **kw): return args, kw`. A function of JavaScript gets the keywords, if there are any, as an object
 * after the arguments: captured([1, 2], { a: 1 }) is what it gets for capture(1, 2, a=1).
 */
const capture = (...args: any[]) => args;
const captured = (args: any[], kw: Record<string, any> = {}) => (Object.keys(kw).length ? [...args, kw] : args);

/** return the signature of a partial object */
const signature = (part: any) => [part.func, part.args, part.keywords, part.__dict__];

describe("TestPartial", () => {
  test("test_basic_examples", () => {
    let p = partial(capture, 1, 2, kwargs({ a: 10, b: 20 }));
    expect(callable(p)).toBe(true);
    expect(typeof p).toBe("function");
    expect(p(3, 4, kwargs({ b: 30, c: 40 }))).toEqual(captured([1, 2, 3, 4], { a: 10, b: 30, c: 40 }));
    p = partial(map, (x: number) => x * 10);
    expect(list(p([1, 2, 3, 4]))).toEqual([10, 20, 30, 40]);
  });

  test("test_attributes", () => {
    const p = partial(capture, 1, 2, kwargs({ a: 10, b: 20 }));
    // attributes should be readable
    expect(p.func).toBe(capture);
    expect(p.args).toEqual(t(1, 2));
    expect(p.keywords).toEqual(dict(kwargs({ a: 10, b: 20 })));
  });

  test("test_argument_checking", () => {
    expect(() => partial()).toThrow(PyTypeError); // need at least a func arg
    expect(() => partial(2)()).toThrow(PyTypeError);
  });

  test("test_protection_of_callers_dict_argument", () => {
    // a caller's dictionary should not be altered by partial
    const func = ({ a = 10 }: { a?: number; b?: number } = {}) => a;
    const d = py({ a: 3 });
    const p = partial(func, kwargs({ a: 5 }));
    expect(call(p, [], d)).toBe(3);
    expect(d).toEqual(py({ a: 3 }));
    p(kwargs({ b: 7 }));
    expect(d).toEqual(py({ a: 3 }));
  });

  test("test_kwargs_copy", () => {
    // Issue #29532: Altering a kwarg dictionary passed to a constructor
    // should not affect a partial object after creation
    const d = { a: 3 };
    const p = partial(capture, kwargs(d));
    expect(p()).toEqual(captured([], { a: 3 }));
    d["a"] = 5;
    expect(p()).toEqual(captured([], { a: 3 }));
  });

  test("test_arg_combinations", () => {
    // exercise special code paths for zero args in either partial
    // object or the caller
    let p = partial(capture);
    expect(p()).toEqual(captured([]));
    expect(p(1, 2)).toEqual(captured([1, 2]));
    p = partial(capture, 1, 2);
    expect(p()).toEqual(captured([1, 2]));
    expect(p(3, 4)).toEqual(captured([1, 2, 3, 4]));
  });

  test("test_kw_combinations", () => {
    // exercise special code paths for no keyword args in
    // either the partial object or the caller
    let p = partial(capture);
    expect(p.keywords).toEqual(dict());
    expect(p()).toEqual(captured([]));
    expect(p(kwargs({ a: 1 }))).toEqual(captured([], { a: 1 }));
    p = partial(capture, kwargs({ a: 1 }));
    expect(p.keywords).toEqual(py({ a: 1 }));
    expect(p()).toEqual(captured([], { a: 1 }));
    expect(p(kwargs({ b: 2 }))).toEqual(captured([], { a: 1, b: 2 }));
    // keyword args in the call override those in the partial object
    expect(p(kwargs({ a: 3, b: 2 }))).toEqual(captured([], { a: 3, b: 2 }));
  });

  test("test_positional", () => {
    // make sure positional arguments are captured correctly
    for (const args of [[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3]]) {
      const p = partial(capture, ...args);
      expect(p("x")).toEqual([...args, "x"]);
    }
  });

  test("test_keyword", () => {
    // make sure keyword arguments are captured correctly
    for (const a of ["a", 0, undefined, 3.5]) {
      const p = partial(capture, kwargs({ a }));
      const got = p(kwargs({ x: undefined }));
      expect(got).toHaveLength(1);
      expect(Object.keys(got[0])).toEqual(["a", "x"]);
      expect(got[0]).toEqual({ a, x: undefined });
    }
  });

  test("test_no_side_effects", () => {
    // make sure there are no side effects that affect subsequent calls
    const p = partial(capture, 0, kwargs({ a: 1 }));
    expect(p(1, kwargs({ b: 2 }))).toEqual(captured([0, 1], { a: 1, b: 2 }));
    expect(p()).toEqual(captured([0], { a: 1 }));
  });

  test("test_error_propagation", () => {
    const f = (x: number, y: number | { y: number }) => {
      truediv(x, typeof y == "object" ? y.y : y);
    };
    expect(partial(f, 1, 0)).toThrow(ZeroDivisionError);
    expect(() => partial(f, 1)(0)).toThrow(ZeroDivisionError);
    expect(() => partial(f)(1, 0)).toThrow(ZeroDivisionError);
    expect(() => partial(f, kwargs({ y: 0 }))(1)).toThrow(ZeroDivisionError);
  });

  test("test_with_bound_and_unbound_methods", () => {
    const data = list(map(str, range(10)));
    let join = partial(str.join, "");
    expect(join(data)).toBe("0123456789");
    // A string has the methods of JavaScript: "".join is undefined.
    join = partial(getattr("", "join"));
    expect(join(data)).toBe("0123456789");
  });

  test("test_nested_optimization", () => {
    const inner = partial(signature, "asdf");
    const nested = partial(inner, kwargs({ bar: true }));
    const flat = partial(signature, "asdf", kwargs({ bar: true }));
    expect(signature(nested)).toEqual(signature(flat));
  });
});

describe("TestReduce", () => {
  const add = (x: any, y: any) => x + y;

  test("test_reduce", () => {
    const Squares = makeClass("Squares", [], {
      __init__(max: number) {
        this.max = max;
        this.sofar = [];
      },

      __len__() {
        return this.sofar.length;
      },

      __getitem__(i: number) {
        if (!(0 <= i && i < this.max)) throw new IndexError();
        let n = this.sofar.length;
        while (n <= i) {
          this.sofar.push(n * n);
          n += 1;
        }
        return this.sofar[i];
      },
    });
    expect(reduce(add, ["a", "b", "c"], "")).toBe("abc");
    // Two arrays are not added by the + of JavaScript.
    expect(reduce(operator.add, [["a", "c"], [], ["d", "w"]], [])).toEqual(["a", "c", "d", "w"]);
    expect(reduce((x: any[], y: any[]) => x.concat(y), [["a", "c"], [], ["d", "w"]], [])).toEqual(["a", "c", "d", "w"]);
    expect(reduce((x: number, y: number) => x * y, range(2, 8), 1)).toBe(5040);
    expect(reduce(operator.mul, range(2, 21), 1)).toBe(2432902008176640000n);
    expect(reduce(add, Squares(10))).toBe(285);
    expect(reduce(add, Squares(10), 0)).toBe(285);
    expect(reduce(add, Squares(0), 0)).toBe(0);
    expect(() => reduce()).toThrow(PyTypeError);
    expect(() => reduce(42, 42)).toThrow(PyTypeError);
    expect(() => reduce(42, 42, 42)).toThrow(PyTypeError);
    expect(reduce(42, "1")).toBe("1"); // func is never called with one item
    expect(reduce(42, "", "1")).toBe("1"); // func is never called with one item
    expect(() => reduce(42, t(42, 42))).toThrow(PyTypeError);
    expect(() => reduce(add, [])).toThrow(PyTypeError); // arg 2 must not be empty sequence with no initial value
    expect(() => reduce(add, "")).toThrow(PyTypeError);
    expect(() => reduce(add, t())).toThrow(PyTypeError);
    expect(() => reduce(add, object())).toThrow(PyTypeError);

    const TestFailingIter = makeClass("TestFailingIter", [], {
      __iter__() {
        throw new RuntimeError();
      },
    });
    expect(() => reduce(add, TestFailingIter())).toThrow(RuntimeError);

    expect(reduce(add, [], undefined)).toBeUndefined();
    expect(reduce(add, [], 42)).toBe(42);

    const BadSeq = makeClass("BadSeq", [], {
      __getitem__() {
        throw new ValueError();
      },
    });
    expect(() => reduce(42, BadSeq())).toThrow(ValueError);
  });

  test("the numbers of JavaScript do not grow into big ints", () => {
    // 20! is more than 2**53. As a number it is a float to Python.
    const product = reduce((x: number, y: number) => x * y, range(2, 21), 1);
    expect(product).toBe(2432902008176640000);
    expect(type(product)).toBe(pyfloat);
  });

  // Test reduce()'s use of iterators.
  test("test_iterator_usage", () => {
    const SequenceClass = makeClass("SequenceClass", [], {
      __init__(n: number) {
        this.n = n;
      },
      __getitem__(i: number) {
        if (0 <= i && i < this.n) return i;
        throw new IndexError();
      },
    });

    const { add } = operator;
    expect(reduce(add, SequenceClass(5))).toBe(10);
    expect(reduce(add, SequenceClass(5), 42)).toBe(52);
    expect(() => reduce(add, SequenceClass(0))).toThrow(PyTypeError);
    expect(reduce(add, SequenceClass(0), 42)).toBe(42);
    expect(reduce(add, SequenceClass(1))).toBe(0);
    expect(reduce(add, SequenceClass(1), 42)).toBe(42);

    const d = py({ one: 1, two: 2, three: 3 });
    expect(reduce(add, d)).toBe(str.join("", d.keys()));
    // An object of JavaScript is iterated over as a dict is, a Map as JavaScript does.
    expect(reduce(add, { one: 1, two: 2, three: 3 })).toBe("onetwothree");
  });

  // test correctness of keyword usage of `initial` in `reduce`
  test("test_initial_keyword", () => {
    expect(reduce(add, ["a", "b", "c"], "")).toBe(reduce(add, ["a", "b", "c"], kwargs({ initial: "" })));
    expect(reduce(operator.add, [["a", "c"], [], ["d", "w"]], [])).toEqual(
      reduce(operator.add, [["a", "c"], [], ["d", "w"]], kwargs({ initial: [] })),
    );
    const mul = (x: number, y: number) => x * y;
    expect(reduce(mul, range(2, 8), 1)).toBe(reduce(mul, range(2, 8), kwargs({ initial: 1 })));
    expect(reduce(operator.mul, range(2, 21), 1)).toBe(reduce(operator.mul, range(2, 21), kwargs({ initial: 1 })));
    expect(() => reduce(operator.add, [0, 1], kwargs({ initial: "" }))).toThrow(PyTypeError);
    // "" + 0 is no error in JavaScript.
    expect(reduce(add, [0, 1], kwargs({ initial: "" }))).toBe("01");
    expect(reduce(42, "", kwargs({ initial: "1" }))).toBe("1"); // func is never called with one item
  });
});

describe("TestCmpToKey", () => {
  const cmp1 = (x: any, y: any) => Number(x > y) - Number(x < y);

  test("test_cmp_to_key", () => {
    let key = cmp_to_key(cmp1);
    expect(key(3)).toEqual(key(3));
    expect(key(3) > key(1)).toBe(true);
    expect(key(3) >= key(3)).toBe(true);

    const cmp2 = (x: any, y: any) => int(x) - int(y);
    key = cmp_to_key(cmp2);
    expect(key(float(4))).toEqual(key("4"));
    expect(key(2) < key("35")).toBe(true);
    expect(key(2) <= key("35")).toBe(true);
    expect(key(2)).not.toEqual(key("35"));
  });

  test("test_cmp_to_key_arguments", () => {
    let key = cmp_to_key(kwargs({ mycmp: cmp1 }));
    expect(key(kwargs({ obj: 3 }))).toEqual(key(kwargs({ obj: 3 })));
    expect(key(kwargs({ obj: 3 })) > key(kwargs({ obj: 1 }))).toBe(true);
    raises([PyTypeError, AttributeError], () => key(3) > 1); // rhs is not a K object
    raises([PyTypeError, AttributeError], () => 1 < key(3)); // lhs is not a K object
    expect(() => cmp_to_key()).toThrow(PyTypeError); // too few args
    expect(() => cmp_to_key(cmp1, undefined)).toThrow(PyTypeError); // too many args
    key = cmp_to_key(cmp1);
    expect(() => key()).toThrow(PyTypeError); // too few args
    expect(() => key(undefined, undefined)).toThrow(PyTypeError); // too many args
  });

  test("test_bad_cmp", () => {
    const key = cmp_to_key(() => {
      throw new ZeroDivisionError();
    });
    expect(() => key(3) > key(1)).toThrow(ZeroDivisionError);

    const BadCmp = makeClass("BadCmp", [], {
      __lt__() {
        throw new ZeroDivisionError();
      },
    });
    // There the function that returns a BadCmp() is defined and not used. With it, it is `<` that asks __lt__.
    expect(() => key(3) > key(1)).toThrow(ZeroDivisionError);
    const key2 = cmp_to_key(() => BadCmp());
    expect(() => key2(3) < key2(1)).toThrow(ZeroDivisionError);
  });

  test("test_obj_field", () => {
    const key = cmp_to_key(kwargs({ mycmp: cmp1 }));
    expect(key(50).obj).toBe(50);
  });

  test("test_sort_int", () => {
    const mycmp = (x: number, y: number) => y - x;
    expect(sorted(range(5), kwargs({ key: cmp_to_key(mycmp) }))).toEqual([4, 3, 2, 1, 0]);
  });

  test("test_sort_int_str", () => {
    const mycmp = (x: any, y: any) => cmp1(int(x), int(y));
    let values: any[] = [5, "3", 7, 2, "0", "1", 4, "10", 1];
    values = sorted(values, kwargs({ key: cmp_to_key(mycmp) }));
    expect(values.map(value => int(value))).toEqual([0, 1, 1, 2, 3, 4, 5, 7, 10]);
  });

  test("test_hash", () => {
    const mycmp = (x: number, y: number) => y - x;
    const key = cmp_to_key(mycmp);
    const k = key(10);
    expect(() => hash(k)).toThrow(PyTypeError);
    expect(k).not.toBeInstanceOf(abc.Hashable);
  });
});

describe("TestLRU", () => {
  const _CacheInfo = functools._CacheInfo;

  test("test_lru", () => {
    const orig = (x: number, y: number) => 3 * x + y;
    let f = lru_cache(kwargs({ maxsize: 20 }))(orig);
    let [hits, misses, maxsize, currsize] = f.cache_info();
    expect(maxsize).toBe(20);
    expect(currsize).toBe(0);
    expect(hits).toBe(0);
    expect(misses).toBe(0);

    const domain = range(5);
    let x = 0;
    let y = 0;
    for (let i = 0; i < 1000; i++) {
      [x, y] = [choice(domain), choice(domain)];
      const actual = f(x, y);
      const expected = orig(x, y);
      expect(actual).toBe(expected);
    }
    [hits, misses, maxsize, currsize] = f.cache_info();
    expect(hits > misses).toBe(true);
    expect(hits + misses).toBe(1000);
    expect(currsize).toBe(20);

    f.cache_clear(); // test clearing
    [hits, misses, maxsize, currsize] = f.cache_info();
    expect(hits).toBe(0);
    expect(misses).toBe(0);
    expect(currsize).toBe(0);
    f(x, y);
    [hits, misses, maxsize, currsize] = f.cache_info();
    expect(hits).toBe(0);
    expect(misses).toBe(1);
    expect(currsize).toBe(1);

    // Test bypassing the cache
    expect(f.__wrapped__).toBe(orig);
    f.__wrapped__(x, y);
    [hits, misses, maxsize, currsize] = f.cache_info();
    expect(hits).toBe(0);
    expect(misses).toBe(1);
    expect(currsize).toBe(1);

    // test size zero (which means "never-cache")
    let f_cnt = 0;
    f = lru_cache(0)(() => {
      f_cnt += 1;
      return 20;
    });
    expect(f.cache_info().maxsize).toBe(0);
    f_cnt = 0;
    for (let i = 0; i < 5; i++) expect(f()).toBe(20);
    expect(f_cnt).toBe(5);
    [hits, misses, maxsize, currsize] = f.cache_info();
    expect(hits).toBe(0);
    expect(misses).toBe(5);
    expect(currsize).toBe(0);

    // test size one
    f = lru_cache(1)(() => {
      f_cnt += 1;
      return 20;
    });
    expect(f.cache_info().maxsize).toBe(1);
    f_cnt = 0;
    for (let i = 0; i < 5; i++) expect(f()).toBe(20);
    expect(f_cnt).toBe(1);
    [hits, misses, maxsize, currsize] = f.cache_info();
    expect(hits).toBe(4);
    expect(misses).toBe(1);
    expect(currsize).toBe(1);

    // test size two
    f = lru_cache(2)((x: number) => {
      f_cnt += 1;
      return x * 10;
    });
    expect(f.cache_info().maxsize).toBe(2);
    f_cnt = 0;
    //               *  *              *                          *
    for (const x of [7, 9, 7, 9, 7, 9, 8, 8, 8, 9, 9, 9, 8, 8, 8, 7]) expect(f(x)).toBe(x * 10);
    expect(f_cnt).toBe(4);
    [hits, misses, maxsize, currsize] = f.cache_info();
    expect(hits).toBe(12);
    expect(misses).toBe(4);
    expect(currsize).toBe(2);
  });

  test("test_lru_no_args", () => {
    const square = lru_cache((x: number) => x ** 2);

    expect(list(map(square, [10, 20, 10]))).toEqual([100, 400, 100]);
    expect(square.cache_info().hits).toBe(1);
    expect(square.cache_info().misses).toBe(2);
    expect(square.cache_info().maxsize).toBe(128);
    expect(square.cache_info().currsize).toBe(2);
    // array.map() passes the index and the array too. What takes *args takes them all, and an array cannot be hashed.
    expect(() => [10, 20].map(square)).toThrow(PyTypeError);
    expect([10, 20].map(x => square(x))).toEqual([100, 400]);
  });

  test("test_lru_with_maxsize_none", () => {
    const fib = lru_cache(kwargs({ maxsize: undefined }))((n: number): number => {
      if (n < 2) return n;
      return fib(n - 1) + fib(n - 2);
    });
    expect(Array.from({ length: 16 }, (_, n) => fib(n))).toEqual([
      0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610,
    ]);
    expect(fib.cache_info()).toEqual(_CacheInfo(kwargs({ hits: 28, misses: 16, maxsize: undefined, currsize: 16 })));
    fib.cache_clear();
    expect(fib.cache_info()).toEqual(_CacheInfo(kwargs({ hits: 0, misses: 0, maxsize: undefined, currsize: 0 })));
  });

  test("test_lru_with_maxsize_negative", () => {
    const eq = lru_cache(kwargs({ maxsize: -10 }))((n: number) => n);
    for (const _ of [0, 1]) expect(Array.from({ length: 150 }, (_, n) => eq(n))).toEqual(list(range(150)));
    expect(eq.cache_info()).toEqual(_CacheInfo(kwargs({ hits: 0, misses: 300, maxsize: 0, currsize: 0 })));
  });

  test("test_lru_with_exceptions", () => {
    // Verify that user_function exceptions get passed through without
    // creating a hard-to-read chained exception.
    // http://bugs.python.org/issue13177
    for (const maxsize of [undefined, 128]) {
      const func = lru_cache(maxsize)((i: number) => getitem("abc", i));
      expect(func(0)).toBe("a");
      expect(raises(IndexError, () => func(15)).__context__).toBeUndefined();
      // Verify that the previous exception did not result in a cached entry
      expect(() => func(15)).toThrow(IndexError);
    }
  });

  test("test_lru_with_types", () => {
    for (const maxsize of [undefined, 128]) {
      const square = lru_cache(kwargs({ maxsize, typed: true }))((x: number | { x: number }) => {
        const value = typeof x == "object" ? x.x : x;
        return value * value;
      });
      expect(square(3)).toBe(9);
      expect(square(float(3))).toBe(9.0);
      expect(square(kwargs({ x: 3 }))).toBe(9);
      expect(square(kwargs({ x: float(3) }))).toBe(9.0);
      // There each is asked for again to look at its type, which for 3.0 is float. Here 3.0 reaches the function as the number 3.
      expect(square(3)).toBe(9);
      expect(square(float(3))).toBe(9.0);
      expect(square(kwargs({ x: 3 }))).toBe(9);
      expect(square(kwargs({ x: float(3) }))).toBe(9.0);
      expect(square.cache_info().hits).toBe(4);
      expect(square.cache_info().misses).toBe(4);
    }
  });

  test("test_lru_cache_typed_is_not_recursive", () => {
    const cached = lru_cache(kwargs({ typed: true }))(repr);

    expect(cached(1)).toBe("1");
    expect(cached(true)).toBe("True");
    expect(cached(float(1))).toBe("1.0");
    expect(cached(0)).toBe("0");
    expect(cached(false)).toBe("False");
    expect(cached(float(0))).toBe("0.0");

    expect(cached(t(1))).toBe("(1,)");
    expect(cached(t(true))).toBe("(1,)");
    expect(cached(t(float(1)))).toBe("(1,)");
    expect(cached(t(0))).toBe("(0,)");
    expect(cached(t(false))).toBe("(0,)");
    expect(cached(t(float(0)))).toBe("(0,)");

    const T = makeClass("T", [tuple], {});

    expect(cached(T(t(1)))).toBe("(1,)");
    expect(cached(T(t(true)))).toBe("(1,)");
    expect(cached(T(t(float(1))))).toBe("(1,)");
    expect(cached(T(t(0)))).toBe("(0,)");
    expect(cached(T(t(false)))).toBe("(0,)");
    expect(cached(T(t(float(0))))).toBe("(0,)");
  });

  test.each([
    ["test_lru_with_keyword_args", lru_cache(), 128],
    ["test_lru_with_keyword_args_maxsize_none", lru_cache(kwargs({ maxsize: undefined })), undefined],
  ])("%s", (_, decorator, maxsize) => {
    const fib = decorator(({ n }: { n: number }): number => {
      if (n < 2) return n;
      return fib(kwargs({ n: n - 1 })) + fib(kwargs({ n: n - 2 }));
    });
    expect(Array.from({ length: 16 }, (_, number) => fib(kwargs({ n: number })))).toEqual([
      0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610,
    ]);
    expect(fib.cache_info()).toEqual(_CacheInfo(kwargs({ hits: 28, misses: 16, maxsize, currsize: 16 })));
    fib.cache_clear();
    expect(fib.cache_info()).toEqual(_CacheInfo(kwargs({ hits: 0, misses: 0, maxsize, currsize: 0 })));
  });

  test("test_kwargs_order", () => {
    // PEP 468: Preserving Keyword Argument Order
    const f = lru_cache(kwargs({ maxsize: 10 }))((kwargs: Record<string, number>) => Object.entries(kwargs));
    expect(f(kwargs({ a: 1, b: 2 }))).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(f(kwargs({ b: 2, a: 1 }))).toEqual([
      ["b", 2],
      ["a", 1],
    ]);
    expect(f.cache_info()).toEqual(_CacheInfo(kwargs({ hits: 0, misses: 2, maxsize: 10, currsize: 2 })));
  });

  test("test_lru_cache_decoration (of what a function of JavaScript has)", () => {
    function f() {
      return 42;
    }
    const g = lru_cache()(f);
    expect(g.__name__).toBe("f");
    expect(g.__qualname__).toBe("f");
    expect(g.__wrapped__).toBe(f);
  });
});

describe("TestSingleDispatch", () => {
  test("test_simple_overloads", () => {
    const g = singledispatch(() => "base");
    const g_int = () => "integer";
    g.register(int, g_int);
    expect(g("str")).toBe("base");
    expect(g(1)).toBe("integer");
    expect(g([1, 2, 3])).toBe("base");
  });

  test("test_mro", () => {
    const g = singledispatch(() => "base");
    const A = makeClass("A", [], {});
    const C = makeClass("C", [A], {});
    const B = makeClass("B", [A], {});
    const D = makeClass("D", [C, B], {});
    g.register(A, () => "A");
    g.register(B, () => "B");
    expect(g(A())).toBe("A");
    expect(g(B())).toBe("B");
    expect(g(C())).toBe("A");
    expect(g(D())).toBe("B");
  });

  test("test_register_decorator", () => {
    const g = singledispatch(() => "base");
    const g_int = g.register(int)((i: number) => `int ${i}`);
    expect(g("")).toBe("base");
    expect(g(12)).toBe("int 12");
    expect(g.dispatch(int)).toBe(g_int);
    expect(g.dispatch(object)).toBe(g.dispatch(str));
    // Note: in the assert above this is not g.
    // @singledispatch returns the wrapper.
  });

  test("test_wrapping_attributes", () => {
    const g = singledispatch(function g() {
      return "Test";
    });
    expect(g.__name__).toBe("g");
  });

  test("the values of JavaScript have types to dispatch on", () => {
    const kind = singledispatch(() => "object");
    kind.register(int, () => "int");
    kind.register(pyfloat, () => "float");
    kind.register(str, () => "str");
    kind.register(list, () => "list");
    kind.register(dict, () => "dict");
    kind.register(type(undefined), () => "None");
    kind.register(_js.JSObject, () => "JSObject");
    kind.register(_js.JSFunction, () => "JSFunction");
    expect(
      [1, 2n ** 70n, 1.5, "s", [], dict(), undefined, null, {}, new Map(), () => 0, class {}, t()].map(value =>
        kind(value),
      ),
    ).toEqual([
      "int",
      "int",
      "float",
      "str",
      "list",
      "dict",
      "None",
      "None",
      "JSObject",
      "JSObject",
      "JSFunction",
      "JSFunction",
      "object",
    ]);
  });
});
