// Translated from CPython 3.15's Lib/test/test_defaultdict.py, all of it.
import { kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  KeyError,
  TypeError as PyTypeError,
  delattr,
  dict,
  eval as pyeval,
  frozendict,
  int,
  list,
  repr,
  setattr,
  str,
  type,
} from "python:builtins";
import { defaultdict } from "python:collections";
import copy from "python:copy";
import { contains, getitem, ior, or_, setitem } from "python:operator";
import pickle from "python:pickle";
import { makeClass, py, raises, t } from "./helpers";

const foobar = () => list;

/** A dict with keys that are no strings. */
const d = (...items: [any, any][]) => dict(items);

describe("TestDefaultDict", () => {
  test("test_basic", () => {
    const d1 = defaultdict();
    expect(d1.default_factory).toBeUndefined();
    // d1.default_factory = list would be d1["default_factory"] = list: what is assigned to a property of a mapping is an item.
    setattr(d1, "default_factory", list);
    // d1[12] in JavaScript looks and does not call __missing__: what is not there is undefined.
    expect(d1[12]).toBeUndefined();
    getitem(d1, 12).push(42);
    expect(d1).toEqual(d([12, [42]]));
    d1[12].push(24);
    expect(d1).toEqual(d([12, [42, 24]]));
    getitem(d1, 13);
    getitem(d1, 14);
    expect(d1).toEqual(d([12, [42, 24]], [13, []], [14, []]));
    expect(d1[12] !== d1[13] && d1[13] !== d1[14]).toBe(true);
    const d2 = defaultdict(list, kwargs({ foo: 1, bar: 2 }));
    expect(d2.default_factory).toBe(list);
    expect(d2).toEqual(py({ foo: 1, bar: 2 }));
    expect(d2).toEqual({ foo: 1, bar: 2 });
    expect(d2["foo"]).toBe(1);
    expect(d2.bar).toBe(2);
    expect(getitem(d2, 42)).toEqual([]);
    expect(contains(d2, "foo")).toBe(true);
    expect(contains(d2.keys(), "foo")).toBe(true);
    expect(contains(d2, "bar")).toBe(true);
    expect(contains(d2.keys(), "bar")).toBe(true);
    expect(contains(d2, 42)).toBe(true);
    expect(contains(d2.keys(), 42)).toBe(true);
    expect(contains(d2, 12)).toBe(false);
    expect(contains(d2.keys(), 12)).toBe(false);
    expect("foo" in d2 && 42 in d2 && !(12 in d2)).toBe(true);
    setattr(d2, "default_factory", list);
    delattr(d2, "default_factory");
    expect(d2.default_factory).toBeUndefined();
    setattr(d2, "default_factory", undefined);
    expect(d2.default_factory).toBeUndefined();
    expect(raises(KeyError, () => getitem(d2, 15)).args).toEqual(t(15));
    expect(() => defaultdict(1)).toThrow(PyTypeError);
  });

  test("test_missing", () => {
    const d1 = defaultdict();
    expect(() => d1.__missing__(42)).toThrow(KeyError);
    setattr(d1, "default_factory", list);
    expect(d1.__missing__(42)).toEqual([]);
  });

  test("test_repr", () => {
    const d1 = defaultdict();
    expect(d1.default_factory).toBeUndefined();
    expect(repr(d1)).toBe("defaultdict(None, {})");
    expect(pyeval(repr(d1), py({ defaultdict }))).toEqual(d1);
    d1[11] = 41;
    expect(repr(d1)).toBe("defaultdict(None, {11: 41})");
    const d2 = defaultdict(int);
    expect(d2.default_factory).toBe(int);
    d2[12] = 42;
    expect(repr(d2)).toBe("defaultdict(<class 'int'>, {12: 42})");
    const foo = () => 43;
    const d3 = defaultdict(foo);
    expect(d3.default_factory).toBe(foo);
    getitem(d3, 13);
    expect(repr(d3)).toBe(`defaultdict(${repr(foo)}, {13: 43})`);
  });

  test("test_copy", () => {
    const d1 = defaultdict();
    const d2 = d1.copy();
    expect(type(d2)).toBe(defaultdict);
    expect(d2.default_factory).toBeUndefined();
    expect(d2).toEqual(dict());
    setattr(d1, "default_factory", list);
    const d3 = d1.copy();
    expect(type(d3)).toBe(defaultdict);
    expect(d3.default_factory).toBe(list);
    expect(d3).toEqual(dict());
    getitem(d1, 42);
    const d4 = d1.copy();
    expect(type(d4)).toBe(defaultdict);
    expect(d4.default_factory).toBe(list);
    expect(d4).toEqual(d([42, []]));
    getitem(d4, 12);
    expect(d4).toEqual(d([42, []], [12, []]));

    // Issue 6637: Copy fails for empty default dict
    const dd = defaultdict();
    dd["a"] = 42;
    const e = dd.copy();
    expect(e["a"]).toBe(42);
  });

  test("test_shallow_copy", () => {
    const d1 = defaultdict(foobar, d([1, 1]));
    let d2 = copy.copy(d1);
    expect(d2.default_factory).toBe(foobar);
    expect(d2).toEqual(d1);
    setattr(d1, "default_factory", list);
    d2 = copy.copy(d1);
    expect(d2.default_factory).toBe(list);
    expect(d2).toEqual(d1);
  });

  test("test_deep_copy", () => {
    const d1 = defaultdict(foobar, d([1, [1]]));
    let d2 = copy.deepcopy(d1);
    expect(d2.default_factory).toBe(foobar);
    expect(d2).toEqual(d1);
    expect(d1[1]).not.toBe(d2[1]);
    setattr(d1, "default_factory", list);
    d2 = copy.deepcopy(d1);
    expect(d2.default_factory).toBe(list);
    expect(d2).toEqual(d1);
  });

  test("test_keyerror_without_factory", () => {
    const d1 = defaultdict();
    expect(raises(KeyError, () => getitem(d1, t(1))).args[0]).toEqual(t(1));
  });

  test("test_recursive_repr", () => {
    // Issue2045: stack overflow when default_factory is a bound method
    const sub = makeClass("sub", [defaultdict], {
      __init__() {
        setattr(this, "default_factory", this._factory);
      },
      _factory() {
        return [];
      },
    });
    const dd = sub();
    expect(repr(dd)).toMatch(/sub\(<bound method .*sub\._factory of sub\(\.\.\., \{\}\)>, \{\}\)/);
  });

  test("test_callable_arg", () => {
    expect(() => defaultdict(dict())).toThrow(PyTypeError);
    expect(() => defaultdict({})).toThrow(PyTypeError);
  });

  test("test_pickling", () => {
    const dd = defaultdict(int);
    getitem(dd, 1);
    for (let proto = 0; proto <= pickle.HIGHEST_PROTOCOL; proto++) {
      const s = pickle.dumps(dd, proto);
      const o = pickle.loads(s);
      expect(dd).toEqual(o);
    }
  });

  test("test_union", () => {
    let i = defaultdict(int, d([1, 1], [2, 2]));
    const s = defaultdict(str, d([0, "zero"], [1, "one"]));

    const i_s = i | s;
    expect(i_s.default_factory).toBe(int);
    expect(i_s).toEqual(d([1, "one"], [2, 2], [0, "zero"]));
    expect(list(i_s)).toEqual([1, 2, 0]);

    const s_i = s | i;
    expect(s_i.default_factory).toBe(str);
    expect(s_i).toEqual(d([0, "zero"], [1, 1], [2, 2]));
    expect(list(s_i)).toEqual([0, 1, 2]);

    const i_ds = i | dict(s);
    expect(i_ds.default_factory).toBe(int);
    expect(i_ds).toEqual(d([1, "one"], [2, 2], [0, "zero"]));
    expect(list(i_ds)).toEqual([1, 2, 0]);

    const ds_i = dict(s) | i;
    expect(ds_i.default_factory).toBe(int);
    expect(ds_i).toEqual(d([0, "zero"], [1, 1], [2, 2]));
    expect(list(ds_i)).toEqual([0, 1, 2]);

    expect(() => or_(i, list(s.items()))).toThrow(PyTypeError);
    expect(() => or_(list(s.items()), i)).toThrow(PyTypeError);

    // We inherit a fine |= from dict, so just a few sanity checks here:
    i = ior(i, list(s.items()));
    expect(i.default_factory).toBe(int);
    expect(i).toEqual(d([1, "one"], [2, 2], [0, "zero"]));
    expect(list(i)).toEqual([1, 2, 0]);

    expect(() => ior(i, undefined)).toThrow(PyTypeError);

    // frozendict
    const i_fd = i | frozendict(s);
    expect(type(i_fd)).toBe(defaultdict);
    expect(i_fd.default_factory).toBe(int);
    expect(i_fd).toEqual(d([1, "one"], [2, 2], [0, "zero"]));
    expect(list(i_fd)).toEqual([1, 2, 0]);

    const fd_i = frozendict(s) | i;
    expect(type(fd_i)).toBe(frozendict);
    expect(fd_i).toEqual(d([1, "one"], [2, 2], [0, "zero"]));
    expect(list(fd_i)).toEqual([0, 1, 2]);
  });

  test("test_factory_conflict_with_set_value", () => {
    const key = "conflict_test";
    let count = 0;

    const default_factory = () => {
      count += 1;
      const local_count = count;
      if (count == 1) getitem(test_dict, key);
      return local_count;
    };

    const test_dict = defaultdict(default_factory);

    expect(count).toBe(0);
    expect(getitem(test_dict, key)).toBe(2);
    expect(count).toBe(2);
  });

  test("test_repr_recursive_factory", () => {
    // gh-145492: defaultdict.__repr__ should not cause infinite recursion
    // when the factory's __repr__ calls repr() on the defaultdict.
    const ProblematicFactory = makeClass("ProblematicFactory", [], {
      __call__() {
        return dict();
      },
      __repr__() {
        repr(dd);
        return `ProblematicFactory for ${dd}`;
      },
    });

    const dd = defaultdict(ProblematicFactory());
    // Should not raise RecursionError
    const r = repr(dd);
    expect(r).toContain("ProblematicFactory for");
  });
});
