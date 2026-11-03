// Translated from CPython 3.15's Lib/test/test_heapq.py.
// There TestHeap and TestErrorHandling run twice, with and without the accelerator module; here once, with the `heapq` a
// program gets. Left out: TestModules (which module a function says it is from) and the doctests.
// Sizes marked "there:" are smaller here, for the sake of debug builds.
import { float, kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  AttributeError,
  IndexError,
  NotImplemented,
  RuntimeError,
  StopIteration,
  TypeError as PyTypeError,
  ZeroDivisionError,
  float as pyfloat,
  int,
  len,
  list,
  map,
  range,
  sorted,
  type,
} from "python:builtins";
import heapq from "python:heapq";
import { chain } from "python:itertools";
import { floordiv, getitem, itemgetter } from "python:operator";
import random from "python:random";
import { makeClass, raises, t } from "./helpers";

const times = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

describe("TestHeap", () => {
  function check_invariant(heap: any[]) {
    // Check the heap invariant.
    for (const [pos, item] of heap.entries()) {
      if (pos) {
        // pos 0 has no parent
        const parentpos = (pos - 1) >> 1;
        expect(heap[parentpos] <= item).toBe(true);
      }
    }
  }

  function check_max_invariant(heap: any[]) {
    for (let pos = 1; pos < heap.length; pos++) {
      const parentpos = (pos - 1) >> 1;
      expect(heap[parentpos]).toBeGreaterThanOrEqual(heap[pos]);
    }
  }

  test("test_push_pop", () => {
    // 1) Push 256 random numbers and pop them off, verifying all's OK.
    const heap: number[] = [];
    const data: number[] = [];
    check_invariant(heap);
    for (let i = 0; i < 256; i++) {
      const item = random.random();
      data.push(item);
      heapq.heappush(heap, item);
      check_invariant(heap);
    }
    const results: number[] = [];
    while (heap.length) {
      const item = heapq.heappop(heap);
      check_invariant(heap);
      results.push(item);
    }
    const data_sorted = data.slice();
    list.sort(data_sorted);
    expect(data_sorted).toEqual(results);
    // 2) Check that the invariant holds for a sorted array
    check_invariant(results);

    expect(() => heapq.heappush([])).toThrow(PyTypeError);
    expect(() => heapq.heappush(undefined, undefined)).toThrow(PyTypeError);
    expect(() => heapq.heappop(undefined)).toThrow(PyTypeError);
  });

  test("test_max_push_pop", () => {
    // 1) Push 256 random numbers and pop them off, verifying all's OK.
    const heap: number[] = [];
    const data: number[] = [];
    check_max_invariant(heap);
    for (let i = 0; i < 256; i++) {
      const item = random.random();
      data.push(item);
      heapq.heappush_max(heap, item);
      check_max_invariant(heap);
    }
    const results: number[] = [];
    while (heap.length) {
      const item = heapq.heappop_max(heap);
      check_max_invariant(heap);
      results.push(item);
    }
    const data_sorted = data.slice();
    list.sort(data_sorted, kwargs({ reverse: true }));

    expect(data_sorted).toEqual(results);
    // 2) Check that the invariant holds for a sorted array
    check_max_invariant(results);

    expect(() => heapq.heappush_max([])).toThrow(PyTypeError);

    const exc_types = [AttributeError, PyTypeError];
    raises(exc_types, () => heapq.heappush_max(undefined, undefined));
    raises(exc_types, () => heapq.heappop_max(undefined));
  });

  test("test_heapify", () => {
    // there: 20000
    for (const size of [...range(30), 2000]) {
      const heap = times(size, () => random.random());
      heapq.heapify(heap);
      check_invariant(heap);
    }

    expect(() => heapq.heapify(undefined)).toThrow(PyTypeError);
  });

  test("test_heapify_max", () => {
    // there: 20000
    for (const size of [...range(30), 2000]) {
      const heap = times(size, () => random.random());
      heapq.heapify_max(heap);
      check_max_invariant(heap);
    }

    expect(() => heapq.heapify_max(undefined)).toThrow(PyTypeError);
  });

  test("test_naive_nbest", () => {
    const data = times(1000, () => random.randrange(2000));
    const heap: number[] = [];
    for (const item of data) {
      heapq.heappush(heap, item);
      if (heap.length > 10) heapq.heappop(heap);
    }
    list.sort(heap);
    expect(heap).toEqual(sorted(data).slice(-10));
  });

  function* heapiter(heap: any[]) {
    // An iterator returning a heap's elements, smallest-first.
    try {
      while (1) yield heapq.heappop(heap);
    } catch (error) {
      if (!(error instanceof IndexError)) throw error;
    }
  }

  test("test_nbest", () => {
    // Less-naive "N-best" algorithm, much faster (if len(data) is big
    // enough <wink>) than sorting all of data.
    const data = times(1000, () => random.randrange(2000));
    const heap = data.slice(0, 10);
    heapq.heapify(heap);
    for (const item of data.slice(10)) {
      // this gets rarer the longer we run
      if (item > heap[0]) heapq.heapreplace(heap, item);
    }
    expect(list(heapiter(heap))).toEqual(sorted(data).slice(-10));

    expect(() => heapq.heapreplace(undefined)).toThrow(PyTypeError);
    expect(() => heapq.heapreplace(undefined, undefined)).toThrow(PyTypeError);
    expect(() => heapq.heapreplace([], undefined)).toThrow(IndexError);
  });

  test("test_nbest_maxheap", () => {
    // With a max heap instead of a min heap, the "N-best" algorithm can
    // go even faster still via heapify'ing all of data (linear time), then
    // doing 10 heappops (10 log-time steps).
    const data = times(1000, () => random.randrange(2000));
    const heap = data.slice();
    heapq.heapify_max(heap);
    const result = times(10, () => heapq.heappop_max(heap));
    result.reverse();
    expect(result).toEqual(sorted(data).slice(-10));
  });

  test("test_nbest_with_pushpop", () => {
    const data = times(1000, () => random.randrange(2000));
    const heap = data.slice(0, 10);
    heapq.heapify(heap);
    for (const item of data.slice(10)) heapq.heappushpop(heap, item);
    expect(list(heapiter(heap))).toEqual(sorted(data).slice(-10));
    expect(heapq.heappushpop([], "x")).toBe("x");
  });

  test("test_naive_nworst", () => {
    // Max-heap variant of "test_naive_nbest"
    const data = times(1000, () => random.randrange(2000));
    const heap: number[] = [];
    for (const item of data) {
      heapq.heappush_max(heap, item);
      if (heap.length > 10) heapq.heappop_max(heap);
    }
    list.sort(heap);
    const expected = sorted(data).slice(0, 10);
    expect(heap).toEqual(expected);
  });

  function* heapiter_max(heap: any[]) {
    // An iterator returning a max-heap's elements, largest-first.
    try {
      while (1) yield heapq.heappop_max(heap);
    } catch (error) {
      if (!(error instanceof IndexError)) throw error;
    }
  }

  test("test_nworst", () => {
    // Max-heap variant of "test_nbest"
    const data = times(1000, () => random.randrange(2000));
    const heap = data.slice(0, 10);
    heapq.heapify_max(heap);
    for (const item of data.slice(10)) {
      // this gets rarer the longer we run
      if (item < heap[0]) heapq.heapreplace_max(heap, item);
    }
    const expected = sorted(data, kwargs({ reverse: true })).slice(-10);
    expect(list(heapiter_max(heap))).toEqual(expected);

    expect(() => heapq.heapreplace_max(undefined)).toThrow(PyTypeError);
    expect(() => heapq.heapreplace_max(undefined, undefined)).toThrow(PyTypeError);
    expect(() => heapq.heapreplace_max([], undefined)).toThrow(IndexError);
  });

  test("test_nworst_minheap", () => {
    // Min-heap variant of "test_nbest_maxheap"
    const data = times(1000, () => random.randrange(2000));
    const heap = data.slice();
    heapq.heapify(heap);
    const result = times(10, () => heapq.heappop(heap));
    result.reverse();
    const expected = sorted(data, kwargs({ reverse: true })).slice(-10);
    expect(result).toEqual(expected);
  });

  test("test_nworst_with_pushpop", () => {
    // Max-heap variant of "test_nbest_with_pushpop"
    const data = times(1000, () => random.randrange(2000));
    const heap = data.slice(0, 10);
    heapq.heapify_max(heap);
    for (const item of data.slice(10)) heapq.heappushpop_max(heap, item);
    const expected = sorted(data, kwargs({ reverse: true })).slice(-10);
    expect(list(heapiter_max(heap))).toEqual(expected);
    expect(heapq.heappushpop_max([], "x")).toBe("x");
  });

  test("test_heappushpop", () => {
    let h: number[] = [];
    let x = heapq.heappushpop(h, 10);
    expect([h, x]).toEqual([[], 10]);

    h = [10];
    x = heapq.heappushpop(h, float(10));
    expect([h, x]).toEqual([[10], 10.0]);
    expect(type(h[0])).toBe(int);

    h = [10];
    x = heapq.heappushpop(h, 9);
    expect([h, x]).toEqual([[10], 9]);

    h = [10];
    x = heapq.heappushpop(h, 11);
    expect([h, x]).toEqual([[11], 10]);
  });

  // A whole float that is returned to JavaScript is a number, and a whole number is an int when it goes back.
  test.failing("test_heappushpop: the float that comes back is a float", () => {
    expect(type(heapq.heappushpop([10], float(10)))).toBe(pyfloat);
  });

  test("test_heappushpop_max", () => {
    let h: number[] = [];
    let x = heapq.heappushpop_max(h, 10);
    expect([h, x]).toEqual([[], 10]);

    h = [10];
    x = heapq.heappushpop_max(h, float(10));
    expect([h, x]).toEqual([[10], 10.0]);
    expect(h[0]).toBeInstanceOf(int);

    h = [10];
    x = heapq.heappushpop_max(h, 11);
    expect([h, x]).toEqual([[10], 11]);

    h = [10];
    x = heapq.heappushpop_max(h, 9);
    expect([h, x]).toEqual([[9], 10]);
  });

  test("test_heappop_max", () => {
    // heapop_max has an optimization for one-item lists which isn't
    // covered in other tests, so test that case explicitly here
    const h = [3, 2];
    expect(heapq.heappop_max(h)).toBe(3);
    expect(heapq.heappop_max(h)).toBe(2);
  });

  test("test_heapsort", () => {
    // Exercise everything with repeated heapsort checks
    for (let trial = 0; trial < 100; trial++) {
      const size = random.randrange(50);
      const data = times(size, () => random.randrange(25));
      let heap: number[];
      if (trial & 1) {
        // Half of the time, use heapify
        heap = data.slice();
        heapq.heapify(heap);
      } else {
        // The rest of the time, use heappush
        heap = [];
        for (const item of data) heapq.heappush(heap, item);
      }
      const heap_sorted = times(size, () => heapq.heappop(heap));
      expect(heap_sorted).toEqual(sorted(data));
    }
  });

  test("test_heapsort_max", () => {
    for (let trial = 0; trial < 100; trial++) {
      const size = random.randrange(50);
      const data = times(size, () => random.randrange(25));
      let heap: number[];
      if (trial & 1) {
        // Half of the time, use heapify_max
        heap = data.slice();
        heapq.heapify_max(heap);
      } else {
        // The rest of the time, use heappush_max
        heap = [];
        for (const item of data) heapq.heappush_max(heap, item);
      }
      const heap_sorted = times(size, () => heapq.heappop_max(heap));
      expect(heap_sorted).toEqual(sorted(data, kwargs({ reverse: true })));
    }
  });

  test("test_merge", () => {
    const inputs: any[][] = [];
    for (let i = random.randrange(25); i > 0; i--) {
      const row: any[] = [];
      for (let j = random.randrange(100); j > 0; j--) row.push(t(random.choice("ABC"), random.randrange(-500, 500)));
      inputs.push(row);
    }

    for (const key of [undefined, itemgetter(0), itemgetter(1), itemgetter(1, 0)]) {
      for (const reverse of [false, true]) {
        const seqs = inputs.map(seq => sorted(seq, kwargs({ key, reverse })));
        expect(sorted(chain(...inputs), kwargs({ key, reverse }))).toEqual(
          list(heapq.merge(...seqs, kwargs({ key, reverse }))),
        );
        expect(list(heapq.merge())).toEqual([]);
      }
    }
  });

  test("test_empty_merges", () => {
    // Merging two empty lists (with or without a key) should produce
    // another empty list.
    expect(list(heapq.merge([], []))).toEqual([]);
    expect(list(heapq.merge([], [], kwargs({ key: () => 6 })))).toEqual([]);
  });

  test("test_merge_does_not_suppress_index_error", () => {
    // Issue 19018: Heapq.merge suppresses IndexError from user generator
    function* iterable() {
      const s = list(range(10));
      for (let i = 0; i < 20; i++) yield getitem(s, i); // IndexError when i > 10
    }
    expect(() => list(heapq.merge(iterable(), iterable()))).toThrow(IndexError);
  });

  test("test_merge_stability", () => {
    const Int = makeClass("Int", [int], {});
    const inputs: any[][] = [[], [], [], []];
    // there: 20000
    for (let i = 0; i < 2000; i++) {
      const stream = random.randrange(4);
      const x = random.randrange(500);
      const obj = Int(x);
      obj.pair = t(x, stream);
      inputs[stream].push(obj);
    }
    for (const stream of inputs) list.sort(stream);
    const result = Array.from(heapq.merge(...inputs), (i: any) => i.pair);
    expect(result).toEqual(sorted(result));
  });

  test("test_nsmallest", () => {
    const data = times(1000, i => t(random.randrange(2000), i));
    for (const f of [undefined, (x: any) => (x[0] * 547) % 2000]) {
      for (const n of [0, 1, 2, 10, 100, 400, 999, 1000, 1100]) {
        expect(list(heapq.nsmallest(n, data))).toEqual(sorted(data).slice(0, n));
        expect(list(heapq.nsmallest(n, data, kwargs({ key: f })))).toEqual(sorted(data, kwargs({ key: f })).slice(0, n));
      }
    }
  });

  test("test_nlargest", () => {
    const data = times(1000, i => t(random.randrange(2000), i));
    for (const f of [undefined, (x: any) => (x[0] * 547) % 2000]) {
      for (const n of [0, 1, 2, 10, 100, 400, 999, 1000, 1100]) {
        expect(list(heapq.nlargest(n, data))).toEqual(sorted(data, kwargs({ reverse: true })).slice(0, n));
        expect(list(heapq.nlargest(n, data, kwargs({ key: f })))).toEqual(
          sorted(data, kwargs({ key: f, reverse: true })).slice(0, n),
        );
      }
    }
  });

  test("test_comparison_operator", () => {
    // Issue 3051: Make sure heapq works with both __lt__
    // For python 3.0, __le__ alone is not enough
    const hsort = (data: any[], comp: any) => {
      data = data.map(x => comp(x));
      heapq.heapify(data);
      return times(data.length, () => heapq.heappop(data).x);
    };
    const LT = makeClass("LT", [], {
      __init__(x: number) {
        this.x = x;
      },
      __lt__(other: any) {
        return this.x > other.x;
      },
    });
    const LE = makeClass("LE", [], {
      __init__(x: number) {
        this.x = x;
      },
      __le__(other: any) {
        return this.x >= other.x;
      },
    });
    const data = times(100, () => random.random());
    const target = sorted(data, kwargs({ reverse: true }));
    expect(hsort(data, LT)).toEqual(target);
    // There: assertRaises(TypeError, data, LE), which calls the list. What was meant:
    expect(() => hsort(data, LE)).toThrow(PyTypeError);
  });
});

// ==============================================================================

/** Dummy sequence class defining __len__ but not __getitem__. */
const LenOnly = makeClass("LenOnly", [], {
  __len__() {
    return 10;
  },
});

function raiseZeroDivisionError() {
  throw new ZeroDivisionError();
}
/** Dummy element that always raises an error during comparison */
const CmpErr = makeClass("CmpErr", [], {
  __eq__: raiseZeroDivisionError,
  __ne__: raiseZeroDivisionError,
  __lt__: raiseZeroDivisionError,
  __le__: raiseZeroDivisionError,
  __gt__: raiseZeroDivisionError,
  __ge__: raiseZeroDivisionError,
});

/** Regular generator */
function* R(seqn: Iterable<any>) {
  for (const i of seqn) yield i;
}

function init(this: any, seqn: any) {
  this.seqn = seqn;
  this.i = 0;
}
function self(this: any) {
  return this;
}
function next(this: any) {
  if (this.i >= len(this.seqn)) throw new StopIteration();
  const v = getitem(this.seqn, this.i);
  this.i += 1;
  return v;
}

/** Sequence using __getitem__ */
const G = makeClass("G", [], {
  __init__(seqn: any) {
    this.seqn = seqn;
  },
  __getitem__(i: number) {
    // Not this.seqn[i]: past the end that is undefined in JavaScript, and the IndexError is what ends the iteration.
    return getitem(this.seqn, i);
  },
});

/** Sequence using iterator protocol */
const I = makeClass("I", [], { __init__: init, __iter__: self, __next__: next });

/** Sequence using iterator protocol defined with a generator */
const Ig = makeClass("Ig", [], {
  __init__: init,
  *__iter__() {
    for (const val of this.seqn) yield val;
  },
});

/** Missing __getitem__ and __iter__ */
const X = makeClass("X", [], { __init__: init, __next__: next });

/** Iterator missing __next__() */
const N = makeClass("N", [], { __init__: init, __iter__: self });

/** Test propagation of exceptions */
const E = makeClass("E", [], {
  __init__: init,
  __iter__: self,
  __next__() {
    floordiv(3, 0);
  },
});

/** Test immediate stop */
const S = makeClass("S", [], {
  __init__() {},
  __iter__: self,
  __next__() {
    throw new StopIteration();
  },
});

/** Test multiple tiers of iterators */
const L = (seqn: any) => chain(map((x: any) => x, R(Ig(G(seqn)))));

const SideEffectLT = makeClass("SideEffectLT", [], {
  __init__(value: number, heap: any[]) {
    this.value = value;
    this.heap = heap;
  },
  __lt__(other: any) {
    this.heap.length = 0;
    return this.value < other.value;
  },
});

describe("TestErrorHandling", () => {
  test("test_non_sequence", () => {
    for (const f of [heapq.heapify, heapq.heappop, heapq.heapify_max, heapq.heappop_max])
      raises([PyTypeError, AttributeError], () => f(10));
    for (const f of [
      heapq.heappush,
      heapq.heapreplace,
      heapq.heappush_max,
      heapq.heapreplace_max,
      heapq.nlargest,
      heapq.nsmallest,
    ])
      raises([PyTypeError, AttributeError], () => f(10, 10));
  });

  test("test_len_only", () => {
    for (const f of [heapq.heapify, heapq.heappop, heapq.heapify_max, heapq.heappop_max])
      raises([PyTypeError, AttributeError], () => f(LenOnly()));
    for (const f of [heapq.heappush, heapq.heapreplace, heapq.heappush_max, heapq.heapreplace_max])
      raises([PyTypeError, AttributeError], () => f(LenOnly(), 10));
    for (const f of [heapq.nlargest, heapq.nsmallest]) expect(() => f(2, LenOnly())).toThrow(PyTypeError);
  });

  test("test_cmp_err", () => {
    const seq = [CmpErr(), CmpErr(), CmpErr()];
    for (const f of [heapq.heapify, heapq.heappop]) expect(() => f(seq)).toThrow(ZeroDivisionError);
    for (const f of [heapq.heappush, heapq.heapreplace, heapq.heappush_max, heapq.heapreplace_max])
      expect(() => f(seq, 10)).toThrow(ZeroDivisionError);
    for (const f of [heapq.nlargest, heapq.nsmallest]) expect(() => f(2, seq)).toThrow(ZeroDivisionError);
  });

  test("test_arg_parsing", () => {
    for (const f of [
      heapq.heapify,
      heapq.heappop,
      heapq.heappush,
      heapq.heapreplace,
      heapq.heapify_max,
      heapq.heappop_max,
      heapq.heappush_max,
      heapq.heapreplace_max,
      heapq.nlargest,
      heapq.nsmallest,
    ])
      raises([PyTypeError, AttributeError], () => f(10));
  });

  test("test_iterable_args", () => {
    for (const f of [heapq.nlargest, heapq.nsmallest]) {
      // there: range(1000)
      for (const s of ["123", "", range(100), t(1, 1.2), range(2000, 2200, 5)]) {
        for (const g of [G, I, Ig, L, R]) expect(list(f(2, g(s)))).toEqual(list(f(2, s)));
        expect(list(f(2, S(s)))).toEqual([]);
        expect(() => f(2, X(s))).toThrow(PyTypeError);
        expect(() => f(2, N(s))).toThrow(PyTypeError);
        expect(() => f(2, E(s))).toThrow(ZeroDivisionError);
      }
    }
  });

  // Issue #17278: the heap may change size while it's being walked.

  test("test_heappush_mutating_heap", () => {
    let heap: any[] = [];
    heap.push(...times(200, i => SideEffectLT(i, heap)));
    // Python version raises IndexError, C version RuntimeError
    raises([IndexError, RuntimeError], () => heapq.heappush(heap, SideEffectLT(5, heap)));
    heap = [];
    heap.push(...times(200, i => SideEffectLT(i, heap)));
    raises([IndexError, RuntimeError], () => heapq.heappush_max(heap, SideEffectLT(5, heap)));
  });

  test("test_heappop_mutating_heap", () => {
    let heap: any[] = [];
    heap.push(...times(200, i => SideEffectLT(i, heap)));
    // Python version raises IndexError, C version RuntimeError
    raises([IndexError, RuntimeError], () => heapq.heappop(heap));
    heap = [];
    heap.push(...times(200, i => SideEffectLT(i, heap)));
    raises([IndexError, RuntimeError], () => heapq.heappop_max(heap));
  });

  test("test_comparison_operator_modifying_heap", () => {
    // See bpo-39421: Strong references need to be taken
    // when comparing objects as they can alter the heap
    const heap: any[] = [];
    const EvilClass = makeClass("EvilClass", [int], {
      __lt__() {
        heap.length = 0;
        return NotImplemented;
      },
    });

    heapq.heappush(heap, EvilClass(0));
    expect(() => heapq.heappushpop(heap, 1)).toThrow(IndexError);
  });

  test("test_comparison_operator_modifying_heap_two_heaps", () => {
    let list1: any[] = [];
    let list2: any[] = [];
    const h = makeClass("h", [int], {
      __lt__() {
        list2.length = 0;
        return NotImplemented;
      },
    });
    const g = makeClass("g", [int], {
      __lt__() {
        list1.length = 0;
        return NotImplemented;
      },
    });

    heapq.heappush(list1, h(0));
    heapq.heappush(list2, g(0));

    raises([IndexError, RuntimeError], () => heapq.heappush(list1, g(1)));
    raises([IndexError, RuntimeError], () => heapq.heappush(list2, h(1)));

    list1 = [];
    list2 = [];

    heapq.heappush_max(list1, h(0));
    heapq.heappush_max(list2, g(0));
    heapq.heappush_max(list1, g(1));
    heapq.heappush_max(list2, h(1));

    raises([IndexError, RuntimeError], () => heapq.heappush_max(list1, g(1)));
    raises([IndexError, RuntimeError], () => heapq.heappush_max(list2, h(1)));
  });
});
