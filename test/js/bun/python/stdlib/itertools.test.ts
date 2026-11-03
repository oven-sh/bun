// Translated from CPython 3.15's Lib/test/test_itertools.py: of TestBasicOps the tests named below, and all of TestExamples.
// Not translated: the combinatoric functions' own tests (combinations, permutations, product: they compare with versions
// written in Python), count with a step, tee, the tests of reentrancy, threads, overflow, reuse of tuples and the collector,
// TestPurePythonRoughEquivalents, TestGC, TestVariousIteratorArgs, RegressionTests, the subclasses and sizes, the doctests.
// Left out of test_islice: that the source is let go of when the slice is exhausted (a weak reference and a collection).
import { float, kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  Exception,
  StopIteration,
  TypeError as PyTypeError,
  ValueError,
  bool,
  chr,
  complex,
  filter,
  float as pyfloat,
  id,
  int,
  iter,
  len,
  list,
  map,
  max,
  min,
  next,
  object,
  pow,
  range,
  repr,
  set,
  sorted,
  str,
  tuple,
  type,
  zip,
} from "python:builtins";
import copy from "python:copy";
import { Decimal } from "python:decimal";
import { Fraction } from "python:fractions";
import {
  accumulate,
  batched,
  chain,
  combinations,
  combinations_with_replacement,
  compress,
  count,
  cycle,
  dropwhile,
  filterfalse,
  groupby,
  islice,
  pairwise,
  permutations,
  product,
  repeat,
  starmap,
  takewhile,
  tee,
  zip_longest,
} from "python:itertools";
import operator, { getitem, mul } from "python:operator";
import sys from "python:sys";
import { makeClass, t } from "./helpers";

const maxsize: bigint = sys.maxsize;

const lzip = (...args: any[]) => list(zip(...args));

/** Test function of one argument */
const onearg = (x: number) => 2 * x;

/** Test function that raises an error */
const errfunc = () => {
  throw new ValueError();
};

/** Non-restartable source sequence */
function* gen3() {
  for (const i of [0, 1, 2]) yield i;
}

/** Test predicate */
const isEven = (x: number) => x % 2 == 0;

const tupleize = (...args: any[]) => t(...args);

/** Class emulating an empty iterable. */
class StopNow extends object {
  __iter__() {
    return this;
  }
  __next__() {
    throw new StopIteration();
  }
}

/** Convenience function for partially consuming a long of infinite iterable */
const take = (n: number, seq: any) => list(islice(seq, n));

const testR = (r: any) => r[0];
const testR2 = (r: any) => r[2];
const underten = (x: number) => x < 10;

describe("TestBasicOps", () => {
  test("test_accumulate", () => {
    expect(list(accumulate(range(10)))).toEqual([0, 1, 3, 6, 10, 15, 21, 28, 36, 45]); // one positional arg
    expect(list(accumulate(kwargs({ iterable: range(10) })))).toEqual([0, 1, 3, 6, 10, 15, 21, 28, 36, 45]); // kw arg
    // multiple types
    for (const typ of [int, complex, Decimal, Fraction])
      expect(list(accumulate(map(typ, range(10))))).toEqual(list(map(typ, [0, 1, 3, 6, 10, 15, 21, 28, 36, 45])));
    expect(list(accumulate("abc"))).toEqual(["a", "ab", "abc"]); // works with non-numeric
    expect(list(accumulate([]))).toEqual([]); // empty iterable
    expect(list(accumulate([7]))).toEqual([7]); // iterable of length one
    expect(() => accumulate(range(10), 5, 6)).toThrow(PyTypeError); // too many args
    expect(() => accumulate()).toThrow(PyTypeError); // too few args
    expect(() => accumulate(kwargs({ x: range(10) }))).toThrow(PyTypeError); // unexpected kwd arg
    expect(() => list(accumulate([1, []]))).toThrow(PyTypeError); // args that don't add

    const s = [2, 8, 9, 5, 7, 0, 3, 4, 1, 6];
    expect(list(accumulate(s, min))).toEqual([2, 2, 2, 2, 2, 0, 0, 0, 0, 0]);
    expect(list(accumulate(s, max))).toEqual([2, 8, 9, 9, 9, 9, 9, 9, 9, 9]);
    expect(list(accumulate(s, Math.max))).toEqual([2, 8, 9, 9, 9, 9, 9, 9, 9, 9]);
    expect(list(accumulate(s, operator.mul))).toEqual([2, 16, 144, 720, 5040, 0, 0, 0, 0, 0]);
    expect(list(accumulate(s, (a: number, b: number) => a * b))).toEqual([2, 16, 144, 720, 5040, 0, 0, 0, 0, 0]);
    expect(() => list(accumulate(s, chr))).toThrow(PyTypeError); // unary-operation
    expect(list(accumulate([10, 5, 1], kwargs({ initial: undefined })))).toEqual([10, 15, 16]);
    expect(list(accumulate([10, 5, 1], kwargs({ initial: 100 })))).toEqual([100, 110, 115, 116]);
    expect(list(accumulate([], kwargs({ initial: 100 })))).toEqual([100]);
    expect(() => list(accumulate([10, 20], 100))).toThrow(PyTypeError);
  });

  test("test_batched", () => {
    expect(list(batched("ABCDEFG", 3))).toEqual([t("A", "B", "C"), t("D", "E", "F"), t("G")]);
    expect(list(batched("ABCDEFG", 2))).toEqual([t("A", "B"), t("C", "D"), t("E", "F"), t("G")]);
    expect(list(batched("ABCDEFG", 1))).toEqual([t("A"), t("B"), t("C"), t("D"), t("E"), t("F"), t("G")]);
    expect(list(batched("ABCDEF", 2, kwargs({ strict: true })))).toEqual([t("A", "B"), t("C", "D"), t("E", "F")]);

    expect(() => list(batched("ABCDEFG", 3, kwargs({ strict: true })))).toThrow(ValueError); // Incomplete batch when strict
    expect(() => list(batched("ABCDEFG"))).toThrow(PyTypeError); // Too few arguments
    expect(() => list(batched("ABCDEFG", 3, undefined))).toThrow(PyTypeError); // Too many arguments
    expect(() => list(batched(undefined, 3))).toThrow(PyTypeError); // Non-iterable input
    expect(() => list(batched("ABCDEFG", "hello"))).toThrow(PyTypeError); // n is a string
    expect(() => list(batched("ABCDEFG", 0))).toThrow(ValueError); // n is zero
    expect(() => list(batched("ABCDEFG", -1))).toThrow(ValueError); // n is negative

    const data = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let n = 1; n < 6; n++) {
      for (let i = 0; i < data.length; i++) {
        const s = data.slice(0, i);
        const batches = list(batched(s, n));
        // Order is preserved and no data is lost
        expect(str.join("", chain(...batches))).toBe(s);
        // Each batch is an exact tuple
        expect(batches.every((batch: any) => type(batch) === tuple)).toBe(true);
        // All but the last batch is of size n
        if (batches.length) {
          const last_batch = batches.pop();
          expect(batches.every((batch: any) => batch.length == n)).toBe(true);
          expect(last_batch.length <= n).toBe(true);
          batches.push(last_batch);
        }
      }
    }
  });

  test("test_chain", () => {
    /** Pure python version in the docs */
    function* chain2(...iterables: Iterable<any>[]) {
      for (const it of iterables) for (const element of it) yield element;
    }

    for (const c of [chain, chain2]) {
      expect(list(c("abc", "def"))).toEqual(list("abcdef"));
      expect(list(c("abc"))).toEqual(list("abc"));
      expect(list(c(""))).toEqual([]);
      expect(take(4, c("abc", "def"))).toEqual(list("abcd"));
      // What JavaScript throws goes through Python as it is, and its TypeError is not Python's.
      expect(() => list(c(2, 3))).toThrow(c === chain ? PyTypeError : TypeError);
    }
  });

  test("test_chain_from_iterable", () => {
    expect(list(chain.from_iterable(["abc", "def"]))).toEqual(list("abcdef"));
    expect(list(chain.from_iterable(["abc"]))).toEqual(list("abc"));
    expect(list(chain.from_iterable([""]))).toEqual([]);
    expect(take(4, chain.from_iterable(["abc", "def"]))).toEqual(list("abcd"));
    expect(() => list(chain.from_iterable([2, 3]))).toThrow(PyTypeError);
    expect(list(islice(chain.from_iterable(repeat(range(5))), 2))).toEqual([0, 1]);
  });

  test("test_compress", () => {
    expect(list(compress(kwargs({ data: "ABCDEF", selectors: [1, 0, 1, 0, 1, 1] })))).toEqual(list("ACEF"));
    expect(list(compress("ABCDEF", [1, 0, 1, 0, 1, 1]))).toEqual(list("ACEF"));
    expect(list(compress("ABCDEF", [0, 0, 0, 0, 0, 0]))).toEqual(list(""));
    expect(list(compress("ABCDEF", [1, 1, 1, 1, 1, 1]))).toEqual(list("ABCDEF"));
    expect(list(compress("ABCDEF", [1, 0, 1]))).toEqual(list("AC"));
    expect(list(compress("ABC", [0, 1, 1, 1, 1, 1]))).toEqual(list("BC"));
    const n = 10000;
    const data = chain.from_iterable(repeat(range(6), n));
    const selectors = chain.from_iterable(repeat(t(0, 1)));
    expect(list(compress(data, selectors))).toEqual(mul([1, 3, 5], n));
    expect(() => compress(undefined, range(6))).toThrow(PyTypeError); // 1st arg not iterable
    expect(() => compress(range(6), undefined)).toThrow(PyTypeError); // 2nd arg not iterable
    expect(() => compress(range(6))).toThrow(PyTypeError); // too few args
    expect(() => compress(range(6), undefined)).toThrow(PyTypeError); // too many args
  });

  test("test_count", () => {
    expect(lzip("abc", count())).toEqual([t("a", 0), t("b", 1), t("c", 2)]);
    expect(lzip("abc", count(3))).toEqual([t("a", 3), t("b", 4), t("c", 5)]);
    expect(take(2, lzip("abc", count(3)))).toEqual([t("a", 3), t("b", 4)]);
    expect(take(2, zip("abc", count(-1)))).toEqual([t("a", -1), t("b", 0)]);
    expect(take(2, zip("abc", count(-3)))).toEqual([t("a", -3), t("b", -2)]);
    expect(() => count(2, 3, 4)).toThrow(PyTypeError);
    expect(() => count("a")).toThrow(PyTypeError);
    expect(take(3, count(maxsize))).toEqual([maxsize, maxsize + 1n, maxsize + 2n]);
    expect(take(10, count(maxsize - 5n))).toEqual(list(range(maxsize - 5n, maxsize + 5n)));
    expect(take(10, count(-maxsize - 5n))).toEqual(list(range(-maxsize - 5n, -maxsize + 5n)));
    expect(take(3, count(3.25))).toEqual([3.25, 4.25, 5.25]);
    expect(take(3, count(complex(3.25, -4)))).toEqual([complex(3.25, -4), complex(4.25, -4), complex(5.25, -4)]);
    expect(take(3, count(Decimal("1.1")))).toEqual([Decimal("1.1"), Decimal("2.1"), Decimal("3.1")]);
    expect(take(3, count(Fraction(2, 3)))).toEqual([Fraction(2, 3), Fraction(5, 3), Fraction(8, 3)]);
    const BIGINT = 1n << 1000n;
    expect(take(3, count(BIGINT))).toEqual([BIGINT, BIGINT + 1n, BIGINT + 2n]);
    let c = count(3);
    expect(repr(c)).toBe("count(3)");
    next(c);
    expect(repr(c)).toBe("count(4)");
    c = count(-9);
    expect(repr(c)).toBe("count(-9)");
    next(c);
    expect(next(c)).toBe(-8);
    expect(repr(count(10.25))).toBe("count(10.25)");
    expect(repr(count(float(10)))).toBe("count(10.0)");

    expect(repr(count(maxsize))).toBe(`count(${maxsize})`);
    c = count(maxsize - 1n);
    expect(repr(c)).toBe(`count(${maxsize - 1n})`);
    next(c); // c is now at masize
    expect(repr(c)).toBe(`count(${maxsize})`);
    next(c);
    expect(repr(c)).toBe(`count(${maxsize + 1n})`);

    expect(type(take(1, count(float(10)))[0])).toBe(pyfloat);
    for (const i of [-maxsize - 5n, -maxsize + 5n, -10, -1, 0, 10, maxsize - 5n, maxsize + 5n]) {
      // Test repr
      const r1 = repr(count(i));
      const r2 = str.__mod__("count(%r)", i);
      expect(r1).toBe(r2);
    }

    // check proper internal error handling for large "step' sizes
    count(1, maxsize + 5n);
    sys.exc_info();
  });

  // A whole float that is returned to JavaScript is a number, and a whole number is an int when it goes back.
  test.failing("test_count: next(count(10.0)) is a float", () => {
    expect(type(next(count(float(10))))).toBe(pyfloat);
  });

  test("test_cycle", () => {
    expect(take(10, cycle("abc"))).toEqual(list("abcabcabca"));
    expect(list(cycle(""))).toEqual([]);
    expect(() => cycle()).toThrow(PyTypeError);
    expect(() => cycle(5)).toThrow(PyTypeError);
    expect(list(islice(cycle(gen3()), 10))).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
  });

  test("test_groupby", () => {
    // Check whether it accepts arguments correctly
    expect(list(groupby([]))).toEqual([]);
    expect(list(groupby([], kwargs({ key: id })))).toEqual([]);
    expect(() => list(groupby("abc", []))).toThrow(PyTypeError);
    expect(() => groupby(undefined)).toThrow(PyTypeError);
    expect(() => groupby("abc", (x: any) => x, 10)).toThrow(PyTypeError);

    // Check normal input
    let s: any = [
      t(0, 10, 20),
      t(0, 11, 21),
      t(0, 12, 21),
      t(1, 13, 21),
      t(1, 14, 22),
      t(2, 15, 22),
      t(3, 16, 23),
      t(3, 17, 23),
    ];
    let dup: any[] = [];
    for (const [k, g] of groupby(s, (r: any) => r[0])) {
      for (const elem of g) {
        expect(k).toBe(elem[0]);
        dup.push(elem);
      }
    }
    expect(s).toEqual(dup);

    // Check nested case
    dup = [];
    for (const [k, g] of groupby(s, testR)) {
      for (const [ik, ig] of groupby(g, testR2)) {
        for (const elem of ig) {
          expect(k).toBe(elem[0]);
          expect(ik).toBe(elem[2]);
          dup.push(elem);
        }
      }
    }
    expect(s).toEqual(dup);

    // Check case where inner iterator is not used
    const keys = Array.from(groupby(s, testR), ([k]: any) => k);
    const expectedkeys = set(s.map((r: any) => r[0]));
    expect(set(keys)).toEqual(expectedkeys);
    expect(len(keys)).toBe(len(expectedkeys));

    // Check case where inner iterator is used after advancing the groupby
    // iterator
    s = list(zip("AABBBAAAA", range(9)));
    const it = groupby(s, testR);
    const [, g1] = next(it);
    const [, g2] = next(it);
    const [, g3] = next(it);
    expect(list(g1)).toEqual([]);
    expect(list(g2)).toEqual([]);
    expect(next(g3)).toEqual(t("A", 5));
    list(it); // exhaust the groupby iterator
    expect(list(g3)).toEqual([]);

    // Exercise pipes and filters style
    s = "abracadabra";
    // sort s | uniq
    let r: any[] = Array.from(groupby(sorted(s)), ([k]: any) => k);
    expect(r).toEqual(["a", "b", "c", "d", "r"]);
    // sort s | uniq -d
    r = [];
    for (const [k, g] of groupby(sorted(s))) if (list(islice(g, 1, 2)).length) r.push(k);
    expect(r).toEqual(["a", "b", "r"]);
    // sort s | uniq -c
    r = Array.from(groupby(sorted(s)), ([k, g]: any) => t(len(list(g)), k));
    expect(r).toEqual([t(5, "a"), t(2, "b"), t(1, "c"), t(1, "d"), t(2, "r")]);
    // sort s | uniq -c | sort -rn | head -3
    r = sorted(
      Array.from(groupby(sorted(s)), ([k, g]: any) => t(len(list(g)), k)),
      kwargs({ reverse: true }),
    ).slice(0, 3);
    expect(r).toEqual([t(5, "a"), t(2, "r"), t(2, "b")]);

    // iter.__next__ failure
    class ExpectedError extends Exception {}
    function* delayed_raise(n = 0) {
      for (let i = 0; i < n; i++) yield "yo";
      throw new ExpectedError();
    }
    const gulp = (iterable: any, keyp: any = undefined, func: any = list) =>
      Array.from(groupby(iterable, keyp), ([, g]: any) => func(g));

    // iter.__next__ failure on outer object
    expect(() => gulp(delayed_raise(0))).toThrow(ExpectedError);
    // iter.__next__ failure on inner object
    expect(() => gulp(delayed_raise(1))).toThrow(ExpectedError);

    // __eq__ failure
    class DummyCmp extends object {
      __eq__() {
        throw new ExpectedError();
      }
    }
    s = [DummyCmp(), DummyCmp(), undefined];

    // __eq__ failure on outer object
    expect(() => gulp(s, undefined, id)).toThrow(ExpectedError);
    // __eq__ failure on inner object
    expect(() => gulp(s)).toThrow(ExpectedError);

    // keyfunc failure
    const keyfunc = (obj: any) => {
      if (keyfunc.skip > 0) {
        keyfunc.skip -= 1;
        return obj;
      }
      throw new ExpectedError();
    };

    // keyfunc failure on outer object
    keyfunc.skip = 0;
    expect(() => gulp([undefined], keyfunc)).toThrow(ExpectedError);
    keyfunc.skip = 1;
    expect(() => gulp([undefined, undefined], keyfunc)).toThrow(ExpectedError);
  });

  test("test_filter", () => {
    expect(list(filter(isEven, range(6)))).toEqual([0, 2, 4]);
    expect(list(filter(undefined, [0, 1, 0, 2, 0]))).toEqual([1, 2]);
    expect(list(filter(bool, [0, 1, 0, 2, 0]))).toEqual([1, 2]);
    expect(take(4, filter(isEven, count()))).toEqual([0, 2, 4, 6]);
    expect(() => filter()).toThrow(PyTypeError);
    expect(() => filter((x: any) => x)).toThrow(PyTypeError);
    expect(() => filter((x: any) => x, range(6), 7)).toThrow(PyTypeError);
    expect(() => filter(isEven, 3)).toThrow(PyTypeError);
    expect(() => next(filter(range(6), range(6)))).toThrow(PyTypeError);

    // check copy (there: deepcopy and pickle too, which a function of JavaScript does not take part in)
    const ans = [0, 2, 4];

    const c = filter(isEven, range(6));
    expect(list(copy.copy(c))).toEqual(ans);
  });

  test("test_filterfalse", () => {
    expect(list(filterfalse(isEven, range(6)))).toEqual([1, 3, 5]);
    expect(list(filterfalse(undefined, [0, 1, 0, 2, 0]))).toEqual([0, 0, 0]);
    expect(list(filterfalse(bool, [0, 1, 0, 2, 0]))).toEqual([0, 0, 0]);
    expect(take(4, filterfalse(isEven, count()))).toEqual([1, 3, 5, 7]);
    expect(() => filterfalse()).toThrow(PyTypeError);
    expect(() => filterfalse((x: any) => x)).toThrow(PyTypeError);
    expect(() => filterfalse((x: any) => x, range(6), 7)).toThrow(PyTypeError);
    expect(() => filterfalse(isEven, 3)).toThrow(PyTypeError);
    expect(() => next(filterfalse(range(6), range(6)))).toThrow(PyTypeError);
  });

  test("test_zip", () => {
    // XXX This is rather silly now that builtin zip() calls zip()...
    const ans = Array.from(zip("abc", count()), ([x, y]: any) => t(x, y));
    expect(ans).toEqual([t("a", 0), t("b", 1), t("c", 2)]);
    expect(list(zip("abc", range(6)))).toEqual(lzip("abc", range(6)));
    expect(list(zip("abcdef", range(3)))).toEqual(lzip("abcdef", range(3)));
    expect(take(3, zip("abcdef", count()))).toEqual(lzip("abcdef", range(3)));
    expect(list(zip("abcdef"))).toEqual(lzip("abcdef"));
    expect(list(zip())).toEqual(lzip());
    expect(() => zip(3)).toThrow(PyTypeError);
    expect(() => zip(range(3), 3)).toThrow(PyTypeError);
    expect(Array.from(zip("abc", "def"), (pair: any) => tuple(list(pair)))).toEqual(lzip("abc", "def"));
    expect([...zip("abc", "def")]).toEqual(lzip("abc", "def"));
  });

  test("test_ziplongest", () => {
    for (const args of [
      ["abc", range(6)],
      [range(6), "abc"],
      [range(1000), range(2000, 2100), range(3000, 3050)],
      [range(1000), range(0), range(3000, 3050), range(1200), range(1500)],
      [range(1000), range(0), range(3000, 3050), range(1200), range(1500), range(0)],
    ]) {
      let target = Array.from({ length: max(map(len, args)) }, (_, i) =>
        tuple(args.map(arg => (i < len(arg) ? getitem(arg, i) : undefined))),
      );
      expect(list(zip_longest(...args))).toEqual(target);
      expect(list(zip_longest(...args, kwargs({})))).toEqual(target);
      target = target.map(row => tuple(Array.from(row, e => (e === undefined ? "X" : e)))); // Replace None fills with 'X'
      expect(list(zip_longest(...args, kwargs({ fillvalue: "X" })))).toEqual(target);
    }

    expect(take(3, zip_longest("abcdef", count()))).toEqual(list(zip("abcdef", range(3)))); // take 3 from infinite input

    expect(list(zip_longest())).toEqual(list(zip()));
    expect(list(zip_longest([]))).toEqual(list(zip([])));
    expect(list(zip_longest("abcdef"))).toEqual(list(zip("abcdef")));

    expect(list(zip_longest("abc", "defg", kwargs({})))).toEqual(list(zip([...list("abc"), undefined], "defg"))); // empty keyword dict
    expect(() => zip_longest(3)).toThrow(PyTypeError);
    expect(() => zip_longest(range(3), 3)).toThrow(PyTypeError);

    expect(() => zip_longest("abc", kwargs({ fv: 1 }))).toThrow(PyTypeError);
    expect(() => zip_longest("abc", kwargs({ fillvalue: 1, bogus_keyword: undefined }))).toThrow(PyTypeError);

    expect(Array.from(zip_longest("abc", "def"), (pair: any) => tuple(list(pair)))).toEqual(list(zip("abc", "def")));
    expect([...zip_longest("abc", "def")]).toEqual(list(zip("abc", "def")));
  });

  test("test_pairwise", () => {
    expect(list(pairwise(""))).toEqual([]);
    expect(list(pairwise("a"))).toEqual([]);
    expect(list(pairwise("ab"))).toEqual([t("a", "b")]);
    expect(list(pairwise("abcde"))).toEqual([t("a", "b"), t("b", "c"), t("c", "d"), t("d", "e")]);
    expect(list(pairwise(range(10_000)))).toEqual(list(zip(range(10_000), range(1, 10_000))));

    expect(() => pairwise()).toThrow(PyTypeError); // too few arguments
    expect(() => pairwise("abc", 10)).toThrow(PyTypeError); // too many arguments
    expect(() => pairwise(kwargs({ iterable: "abc" }))).toThrow(PyTypeError); // keyword arguments
    expect(() => pairwise(undefined)).toThrow(PyTypeError); // non-iterable argument
  });

  test("test_repeat", () => {
    expect(list(repeat(kwargs({ object: "a", times: 3 })))).toEqual(["a", "a", "a"]);
    expect(lzip(range(3), repeat("a"))).toEqual([t(0, "a"), t(1, "a"), t(2, "a")]);
    expect(list(repeat("a", 3))).toEqual(["a", "a", "a"]);
    expect(take(3, repeat("a"))).toEqual(["a", "a", "a"]);
    expect(list(repeat("a", 0))).toEqual([]);
    expect(list(repeat("a", -3))).toEqual([]);
    expect(() => repeat()).toThrow(PyTypeError);
    expect(() => repeat(undefined, 3, 4)).toThrow(PyTypeError);
    expect(() => repeat(undefined, "a")).toThrow(PyTypeError);
    let r = repeat(complex(1, 0));
    expect(repr(r)).toBe("repeat((1+0j))");
    r = repeat(complex(1, 0), 5);
    expect(repr(r)).toBe("repeat((1+0j), 5)");
    list(r);
    expect(repr(r)).toBe("repeat((1+0j), 0)");
  });

  test("test_repeat_with_negative_times", () => {
    expect(repr(repeat("a", -1))).toBe("repeat('a', 0)");
    expect(repr(repeat("a", -2))).toBe("repeat('a', 0)");
    expect(repr(repeat("a", kwargs({ times: -1 })))).toBe("repeat('a', 0)");
    expect(repr(repeat("a", kwargs({ times: -2 })))).toBe("repeat('a', 0)");
  });

  test("test_map", () => {
    expect(list(map(operator.pow, range(3), range(1, 7)))).toEqual([0 ** 1, 1 ** 2, 2 ** 3]);
    expect(list(map(tupleize, "abc", range(5)))).toEqual([t("a", 0), t("b", 1), t("c", 2)]);
    expect(list(map(tupleize, "abc", count()))).toEqual([t("a", 0), t("b", 1), t("c", 2)]);
    expect(take(2, map(tupleize, "abc", count()))).toEqual([t("a", 0), t("b", 1)]);
    expect(list(map(operator.pow, []))).toEqual([]);
    expect(() => map()).toThrow(PyTypeError);
    expect(() => list(map(undefined, range(3), range(3)))).toThrow(PyTypeError);
    expect(() => map(operator.neg)).toThrow(PyTypeError);
    expect(() => next(map(10, range(5)))).toThrow(PyTypeError);
    expect(() => next(map(errfunc, [4], [5]))).toThrow(ValueError);
    // There a TypeError: onearg() takes one argument. A function of JavaScript takes what it is given.
    expect(next(map(onearg, [4], [5]))).toBe(8);
    expect(() => next(map(operator.neg, [4], [5]))).toThrow(PyTypeError);
  });

  test("test_starmap", () => {
    expect(list(starmap(operator.pow, zip(range(3), range(1, 7))))).toEqual([0 ** 1, 1 ** 2, 2 ** 3]);
    expect(take(3, starmap(operator.pow, zip(count(), count(1))))).toEqual([0 ** 1, 1 ** 2, 2 ** 3]);
    expect(list(starmap(operator.pow, []))).toEqual([]);
    expect(list(starmap(operator.pow, [iter([4, 5])]))).toEqual([4 ** 5]);
    expect(() => list(starmap(operator.pow, [undefined]))).toThrow(PyTypeError);
    expect(() => starmap()).toThrow(PyTypeError);
    expect(() => starmap(operator.pow, [t(4, 5)], "extra")).toThrow(PyTypeError);
    expect(() => next(starmap(10, [t(4, 5)]))).toThrow(PyTypeError);
    expect(() => next(starmap(errfunc, [t(4, 5)]))).toThrow(ValueError);
    // As in test_map.
    expect(next(starmap(onearg, [t(4, 5)]))).toBe(8);
    // An array is as good as a tuple where something is unpacked.
    expect(list(starmap(Math.pow, [[2, 5], t(3, 2)]))).toEqual([32, 9]);
  });

  test("test_islice", () => {
    // islice(args) should agree with range(args)
    for (const args of [[10, 20, 3], [10, 3, 20], [10, 20], [10, 10], [10, 3], [20]])
      expect(list(islice(range(100), ...args))).toEqual(list(range(...args)));

    // Stop when seqn is exhausted
    for (const [args, tgtargs] of [
      [
        [10, 110, 3],
        [10, 100, 3],
      ],
      [
        [10, 110],
        [10, 100],
      ],
      [[110], [100]],
    ])
      expect(list(islice(range(100), ...args))).toEqual(list(range(...tgtargs)));

    // Test stop=None
    expect(list(islice(range(10), undefined))).toEqual(list(range(10)));
    expect(list(islice(range(10), undefined, undefined))).toEqual(list(range(10)));
    expect(list(islice(range(10), undefined, undefined, undefined))).toEqual(list(range(10)));
    expect(list(islice(range(10), 2, undefined))).toEqual(list(range(2, 10)));
    expect(list(islice(range(10), 1, undefined, 2))).toEqual(list(range(1, 10, 2)));

    // Test number of items consumed     SF #1171417
    let it = iter(range(10));
    expect(list(islice(it, 3))).toEqual(list(range(3)));
    expect(list(it)).toEqual(list(range(3, 10)));

    it = iter(range(10));
    expect(list(islice(it, 3, 3))).toEqual([]);
    expect(list(it)).toEqual(list(range(3, 10)));

    // Test invalid arguments
    const ra = range(10);
    expect(() => islice(ra)).toThrow(PyTypeError);
    expect(() => islice(ra, 1, 2, 3, 4)).toThrow(PyTypeError);
    expect(() => islice(ra, -5, 10, 1)).toThrow(ValueError);
    expect(() => islice(ra, 1, -5, -1)).toThrow(ValueError);
    expect(() => islice(ra, 1, 10, -1)).toThrow(ValueError);
    expect(() => islice(ra, 1, 10, 0)).toThrow(ValueError);
    expect(() => islice(ra, "a")).toThrow(ValueError);
    expect(() => islice(ra, "a", 1)).toThrow(ValueError);
    expect(() => islice(ra, 1, "a")).toThrow(ValueError);
    expect(() => islice(ra, "a", 1, 1)).toThrow(ValueError);
    expect(() => islice(ra, 1, "a", 1)).toThrow(ValueError);
    expect(len(list(islice(count(), 1, 10, maxsize)))).toBe(1);

    // Issue #10323:  Less islice in a predictable state
    const c = count();
    expect(list(islice(c, 1, 3, 50))).toEqual([1]);
    expect(next(c)).toBe(3);

    // Issue #30537: islice can accept integer-like objects as
    // arguments
    class IntLike extends object {
      __init__(val: number) {
        this.val = val;
      }
      __index__() {
        return this.val;
      }
    }
    expect(list(islice(range(100), IntLike(10)))).toEqual(list(range(10)));
    expect(list(islice(range(100), IntLike(10), IntLike(50)))).toEqual(list(range(10, 50)));
    expect(list(islice(range(100), IntLike(10), IntLike(50), IntLike(5)))).toEqual(list(range(10, 50, 5)));
  });

  test("test_takewhile", () => {
    const data = [1, 3, 5, 20, 2, 4, 6, 8];
    expect(list(takewhile(underten, data))).toEqual([1, 3, 5]);
    expect(list(takewhile(underten, []))).toEqual([]);
    expect(() => takewhile()).toThrow(PyTypeError);
    expect(() => takewhile(operator.pow)).toThrow(PyTypeError);
    expect(() => takewhile(operator.pow, [t(4, 5)], "extra")).toThrow(PyTypeError);
    expect(() => next(takewhile(10, [t(4, 5)]))).toThrow(PyTypeError);
    expect(() => next(takewhile(errfunc, [t(4, 5)]))).toThrow(ValueError);
    const taken = takewhile(bool, [1, 1, 1, 0, 0, 0]);
    expect(list(taken)).toEqual([1, 1, 1]);
    expect(() => next(taken)).toThrow(StopIteration);
    expect(taken.next()).toEqual({ value: undefined, done: true });
  });

  test("test_dropwhile", () => {
    const data = [1, 3, 5, 20, 2, 4, 6, 8];
    expect(list(dropwhile(underten, data))).toEqual([20, 2, 4, 6, 8]);
    expect(list(dropwhile(underten, []))).toEqual([]);
    expect(() => dropwhile()).toThrow(PyTypeError);
    expect(() => dropwhile(operator.pow)).toThrow(PyTypeError);
    expect(() => dropwhile(operator.pow, [t(4, 5)], "extra")).toThrow(PyTypeError);
    expect(() => next(dropwhile(10, [t(4, 5)]))).toThrow(PyTypeError);
    expect(() => next(dropwhile(errfunc, [t(4, 5)]))).toThrow(ValueError);
  });

  test("test_StopIteration", () => {
    expect(() => next(zip())).toThrow(StopIteration);

    for (const f of [chain, cycle, zip, groupby]) {
      expect(() => next(f([]))).toThrow(StopIteration);
      expect(() => next(f(StopNow()))).toThrow(StopIteration);
    }

    expect(() => next(islice([], undefined))).toThrow(StopIteration);
    expect(() => next(islice(StopNow(), undefined))).toThrow(StopIteration);

    let [p, q] = tee([]);
    expect(() => next(p)).toThrow(StopIteration);
    expect(() => next(q)).toThrow(StopIteration);
    [p, q] = tee(StopNow());
    expect(() => next(p)).toThrow(StopIteration);
    expect(() => next(q)).toThrow(StopIteration);

    expect(() => next(repeat(undefined, 0))).toThrow(StopIteration);

    for (const f of [filter, filterfalse, map, takewhile, dropwhile, starmap]) {
      expect(() => next(f((x: any) => x, []))).toThrow(StopIteration);
      expect(() => next(f((x: any) => x, StopNow()))).toThrow(StopIteration);
    }
  });
});

describe("TestExamples", () => {
  test("test_accumulate", () => {
    expect(list(accumulate([1, 2, 3, 4, 5]))).toEqual([1, 3, 6, 10, 15]);
  });

  test("test_chain", () => {
    expect(str.join("", chain("ABC", "DEF"))).toBe("ABCDEF");
    expect([...chain("ABC", "DEF")].join("")).toBe("ABCDEF");
  });

  test("test_chain_from_iterable", () => {
    expect(str.join("", chain.from_iterable(["ABC", "DEF"]))).toBe("ABCDEF");
  });

  test("test_combinations", () => {
    expect(list(combinations("ABCD", 2))).toEqual([
      t("A", "B"),
      t("A", "C"),
      t("A", "D"),
      t("B", "C"),
      t("B", "D"),
      t("C", "D"),
    ]);
    expect(list(combinations(range(4), 3))).toEqual([t(0, 1, 2), t(0, 1, 3), t(0, 2, 3), t(1, 2, 3)]);
  });

  test("test_combinations_with_replacement", () => {
    expect(list(combinations_with_replacement("ABC", 2))).toEqual([
      t("A", "A"),
      t("A", "B"),
      t("A", "C"),
      t("B", "B"),
      t("B", "C"),
      t("C", "C"),
    ]);
  });

  test("test_compress", () => {
    expect(list(compress("ABCDEF", [1, 0, 1, 0, 1, 1]))).toEqual(list("ACEF"));
  });

  test("test_count", () => {
    expect(list(islice(count(10), 5))).toEqual([10, 11, 12, 13, 14]);
  });

  test("test_cycle", () => {
    expect(list(islice(cycle("ABCD"), 12))).toEqual(list("ABCDABCDABCD"));
  });

  test("test_dropwhile", () => {
    expect(list(dropwhile((x: number) => x < 5, [1, 4, 6, 4, 1]))).toEqual([6, 4, 1]);
  });

  test("test_groupby", () => {
    expect(Array.from(groupby("AAAABBBCCDAABBB"), ([k]: any) => k)).toEqual(list("ABCDAB"));
    expect(Array.from(groupby("AAAABBBCCD"), ([, g]: any) => list(g))).toEqual([
      list("AAAA"),
      list("BBB"),
      list("CC"),
      list("D"),
    ]);
  });

  test("test_filter", () => {
    expect(list(filter((x: number) => x % 2, range(10)))).toEqual([1, 3, 5, 7, 9]);
  });

  test("test_filterfalse", () => {
    expect(list(filterfalse((x: number) => x % 2, range(10)))).toEqual([0, 2, 4, 6, 8]);
  });

  test("test_map", () => {
    expect(list(map(pow, t(2, 3, 10), t(5, 2, 3)))).toEqual([32, 9, 1000]);
  });

  test("test_islice", () => {
    expect(list(islice("ABCDEFG", 2))).toEqual(list("AB"));
    expect(list(islice("ABCDEFG", 2, 4))).toEqual(list("CD"));
    expect(list(islice("ABCDEFG", 2, undefined))).toEqual(list("CDEFG"));
    expect(list(islice("ABCDEFG", 0, undefined, 2))).toEqual(list("ACEG"));
  });

  test("test_zip", () => {
    expect(list(zip("ABCD", "xy"))).toEqual([t("A", "x"), t("B", "y")]);
  });

  test("test_zip_longest", () => {
    expect(list(zip_longest("ABCD", "xy", kwargs({ fillvalue: "-" })))).toEqual([
      t("A", "x"),
      t("B", "y"),
      t("C", "-"),
      t("D", "-"),
    ]);
  });

  test("test_permutations", () => {
    expect(list(permutations("ABCD", 2))).toEqual(list(map(tuple, "AB AC AD BA BC BD CA CB CD DA DB DC".split(" "))));
    expect(list(permutations(range(3)))).toEqual([
      t(0, 1, 2),
      t(0, 2, 1),
      t(1, 0, 2),
      t(1, 2, 0),
      t(2, 0, 1),
      t(2, 1, 0),
    ]);
  });

  test("test_product", () => {
    expect(list(product("ABCD", "xy"))).toEqual(list(map(tuple, "Ax Ay Bx By Cx Cy Dx Dy".split(" "))));
    expect(list(product(range(2), kwargs({ repeat: 3 })))).toEqual([
      t(0, 0, 0),
      t(0, 0, 1),
      t(0, 1, 0),
      t(0, 1, 1),
      t(1, 0, 0),
      t(1, 0, 1),
      t(1, 1, 0),
      t(1, 1, 1),
    ]);
  });

  test("test_repeat", () => {
    expect(list(repeat(10, 3))).toEqual([10, 10, 10]);
  });

  test("test_stapmap", () => {
    expect(list(starmap(pow, [t(2, 5), t(3, 2), t(10, 3)]))).toEqual([32, 9, 1000]);
  });

  test("test_takewhile", () => {
    expect(list(takewhile((x: number) => x < 5, [1, 4, 6, 4, 1]))).toEqual([1, 4]);
  });
});
