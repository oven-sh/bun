// Translated from CPython 3.15's Lib/test/datetimetester.py: of TestTimeDelta and TestDate, the tests named below. (The file
// has some 600 tests; there each runs with the module written in C and with the one written in Python.)
// The arithmetic and the comparisons are written with the operators of JavaScript. It has no `//`: floordiv(). Its unary `+`
// makes a number: pos().
import { float, kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  OverflowError,
  TypeError as PyTypeError,
  ValueError,
  ZeroDivisionError,
  abs,
  bool,
  dict,
  divmod,
  eval as pyeval,
  hash,
  len,
  range,
  repr,
  round,
  str,
} from "python:builtins";
import copy from "python:copy";
import { MAXYEAR, MINYEAR, date, datetime, timedelta, timezone } from "python:datetime";
import operator, { floordiv, getitem, mod, pos, setitem, truediv } from "python:operator";
import { py, t } from "./helpers";

const OTHERSTUFF = [10, 34.5, "abc", dict(), [], t()];

const eq = (actual: any, expected: any) => expect(actual).toEqual(expected);

describe("TestTimeDelta", () => {
  const td = timedelta;

  test("test_constructor", () => {
    // Check keyword args to constructor
    eq(td(), td(kwargs({ weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0, microseconds: 0 })));
    eq(td(1), td(kwargs({ days: 1 })));
    eq(td(0, 1), td(kwargs({ seconds: 1 })));
    eq(td(0, 0, 1), td(kwargs({ microseconds: 1 })));
    eq(td(kwargs({ weeks: 1 })), td(kwargs({ days: 7 })));
    eq(td(kwargs({ days: 1 })), td(kwargs({ hours: 24 })));
    eq(td(kwargs({ hours: 1 })), td(kwargs({ minutes: 60 })));
    eq(td(kwargs({ minutes: 1 })), td(kwargs({ seconds: 60 })));
    eq(td(kwargs({ seconds: 1 })), td(kwargs({ milliseconds: 1000 })));
    eq(td(kwargs({ milliseconds: 1 })), td(kwargs({ microseconds: 1000 })));

    // Check float args to constructor
    eq(td(kwargs({ weeks: 1.0 / 7 })), td(kwargs({ days: 1 })));
    eq(td(kwargs({ days: 1.0 / 24 })), td(kwargs({ hours: 1 })));
    eq(td(kwargs({ hours: 1.0 / 60 })), td(kwargs({ minutes: 1 })));
    eq(td(kwargs({ minutes: 1.0 / 60 })), td(kwargs({ seconds: 1 })));
    eq(td(kwargs({ seconds: 0.001 })), td(kwargs({ milliseconds: 1 })));
    eq(td(kwargs({ milliseconds: 0.001 })), td(kwargs({ microseconds: 1 })));

    // Check type of args to constructor
    for (const unit of ["weeks", "days", "hours", "minutes", "seconds", "milliseconds", "microseconds"])
      expect(() => td(kwargs({ [unit]: "1" }))).toThrow(PyTypeError);
  });

  test("test_computations", () => {
    const a = td(7); // One week
    const b = td(0, 60); // One minute
    const c = td(0, 0, 1000); // One millisecond
    eq(a + b + c, td(7, 60, 1000));
    eq(a - b, td(6, 24 * 3600 - 60));
    eq(b.__rsub__(a), td(6, 24 * 3600 - 60));
    eq(-a, td(-7));
    eq(pos(a), td(7));
    eq(-b, td(-1, 24 * 3600 - 60));
    eq(-c, td(-1, 24 * 3600 - 1, 999000));
    eq(abs(a), a);
    eq(abs(-a), a);
    eq(td(6, 24 * 3600), a);
    eq(td(0, 0, 60 * 1000000), b);
    eq(a * 10, td(70));
    eq(a * 10, 10 * a);
    eq(b * 10, td(0, 600));
    eq(10 * b, td(0, 600));
    eq(c * 10, td(0, 0, 10000));
    eq(10 * c, td(0, 0, 10000));
    eq(a * -1, -a);
    eq(b * -2, -b - b);
    eq(c * -2, -c + -c);
    eq(b * (60 * 24), b * 60 * 24);
    eq(b * (60 * 24), 60 * b * 24);
    eq(c * 1000, td(0, 1));
    eq(1000 * c, td(0, 1));
    eq(floordiv(a, 7), td(1));
    eq(floordiv(b, 10), td(0, 6));
    eq(floordiv(c, 1000), td(0, 0, 1));
    eq(floordiv(a, 10), td(0, 7 * 24 * 360));
    eq(floordiv(a, 3600000), td(0, 0, 7 * 24 * 1000));
    eq(a / 0.5, td(14));
    eq(b / 0.5, td(0, 120));
    eq(a / 7, td(1));
    eq(b / 10, td(0, 6));
    eq(c / 1000, td(0, 0, 1));
    eq(a / 10, td(0, 7 * 24 * 360));
    eq(a / 3600000, td(0, 0, 7 * 24 * 1000));

    // Multiplication by float
    const us = td(kwargs({ microseconds: 1 }));
    eq(3 * us * 0.5, 2 * us);
    eq(5 * us * 0.5, 2 * us);
    eq(0.5 * (3 * us), 2 * us);
    eq(0.5 * (5 * us), 2 * us);
    eq(-3 * us * 0.5, -2 * us);
    eq(-5 * us * 0.5, -2 * us);

    // Issue #23521
    eq(td(kwargs({ seconds: 1 })) * 0.123456, td(kwargs({ microseconds: 123456 })));
    eq(td(kwargs({ seconds: 1 })) * 0.6112295, td(kwargs({ microseconds: 611229 })));

    // Division by int and float
    eq((3 * us) / 2, 2 * us);
    eq((5 * us) / 2, 2 * us);
    eq((-3 * us) / float(2), -2 * us);
    eq((-5 * us) / float(2), -2 * us);
    eq((3 * us) / -2, -2 * us);
    eq((5 * us) / -2, -2 * us);
    eq((3 * us) / float(-2), -2 * us);
    eq((5 * us) / float(-2), -2 * us);
    for (let i = -10; i < 10; i++) eq(floordiv((i * us) / 3, us), round(i / 3));
    for (let i = -10; i < 10; i++) eq(floordiv((i * us) / -3, us), round(truediv(i, -3)));

    // Issue #23521
    eq(td(kwargs({ seconds: 1 })) / (1 / 0.6112295), td(kwargs({ microseconds: 611229 })));

    // Issue #11576
    eq(td(999999999, 86399, 999999) - td(999999999, 86399, 999998), td(0, 0, 1));
    eq(td(999999999, 1, 1) - td(999999999, 1, 0), td(0, 0, 1));
  });

  test("test_disallowed_computations", () => {
    const a = timedelta(42);

    // Add/sub ints or floats should be illegal
    for (const i of [1, float(1)]) {
      expect(() => operator.add(a, i)).toThrow(PyTypeError);
      expect(() => operator.sub(a, i)).toThrow(PyTypeError);
      expect(() => operator.add(i, a)).toThrow(PyTypeError);
      expect(() => operator.sub(i, a)).toThrow(PyTypeError);
    }

    // Division of int by timedelta doesn't make sense.
    // Division by zero doesn't make sense.
    const zero = 0;
    expect(() => floordiv(zero, a)).toThrow(PyTypeError);
    expect(() => floordiv(a, zero)).toThrow(ZeroDivisionError);
    expect(() => a / zero).toThrow(ZeroDivisionError);
    expect(() => a / float(0)).toThrow(ZeroDivisionError);
    expect(() => truediv(a, "")).toThrow(PyTypeError);
  });

  test("where neither class has an answer, the operators of JavaScript raise what those of Python raise", () => {
    const a = timedelta(42);
    expect(() => a + 1).toThrow(PyTypeError);
    expect(() => a - 1).toThrow(PyTypeError);
    expect(() => a / "").toThrow(PyTypeError);
    expect(() => a < 10).toThrow(PyTypeError);
    expect(() => a >= 10).toThrow(PyTypeError);
    expect(a + "!").toBe("42 days, 0:00:00!");
  });

  test("test_disallowed_special", () => {
    const a = timedelta(42);
    expect(() => a.__mul__(NaN)).toThrow(ValueError);
    expect(() => a.__truediv__(NaN)).toThrow(ValueError);
    expect(() => a * NaN).toThrow(ValueError);
  });

  test("test_basic_attributes", () => {
    const [days, seconds, us] = [1, 7, 31];
    const td = timedelta(days, seconds, us);
    expect(td.days).toBe(days);
    expect(td.seconds).toBe(seconds);
    expect(td.microseconds).toBe(us);
  });

  test("test_total_seconds", () => {
    let td = timedelta(kwargs({ days: 365 }));
    expect(td.total_seconds()).toBe(31536000.0);
    for (const total_seconds of [123456.789012, -123456.789012, 0.123456, 0, 1e6]) {
      td = timedelta(kwargs({ seconds: total_seconds }));
      expect(td.total_seconds()).toBe(total_seconds);
    }
    // Issue8644: Test that td.total_seconds() has the same
    // accuracy as td / timedelta(seconds=1).
    for (const ms of [-1, -2, -123]) {
      td = timedelta(kwargs({ microseconds: ms }));
      expect(td.total_seconds()).toBe(td / timedelta(kwargs({ seconds: 1 })));
    }
  });

  test("test_carries", () => {
    const t1 = timedelta(
      kwargs({
        days: 100,
        weeks: -7,
        hours: -24 * (100 - 49),
        minutes: -3,
        seconds: 12,
        microseconds: (3 * 60 - 12) * 1e6 + 1,
      }),
    );
    const t2 = timedelta(kwargs({ microseconds: 1 }));
    eq(t1, t2);
  });

  test("test_hash_equality", () => {
    let t1 = timedelta(
      kwargs({
        days: 100,
        weeks: -7,
        hours: -24 * (100 - 49),
        minutes: -3,
        seconds: 12,
        microseconds: (3 * 60 - 12) * 1000000,
      }),
    );
    let t2 = timedelta();
    expect(hash(t1)).toBe(hash(t2));

    t1 += timedelta(kwargs({ weeks: 7 }));
    t2 += timedelta(kwargs({ days: 7 * 7 }));
    eq(t1, t2);
    expect(hash(t1)).toBe(hash(t2));

    const d = dict([[t1, 1]]);
    setitem(d, t2, 2);
    expect(len(d)).toBe(1);
    expect(getitem(d, t1)).toBe(2);
  });

  test("test_compare", () => {
    const t1 = timedelta(2, 3, 4);
    let t2 = timedelta(2, 3, 4);
    eq(t1, t2);
    expect(t1 <= t2).toBe(true);
    expect(t1 >= t2).toBe(true);
    expect(t1 != t2).toBe(false);
    expect(t1 < t2).toBe(false);
    expect(t1 > t2).toBe(false);

    for (const args of [
      [3, 3, 3],
      [2, 4, 4],
      [2, 3, 5],
    ]) {
      t2 = timedelta(...args); // this is larger than t1
      expect(t1 < t2).toBe(true);
      expect(t2 > t1).toBe(true);
      expect(t1 <= t2).toBe(true);
      expect(t2 >= t1).toBe(true);
      expect(t1 != t2).toBe(true);
      expect(t2 != t1).toBe(true);
      expect(t1 == t2).toBe(false);
      expect(t2 == t1).toBe(false);
      expect(t1 > t2).toBe(false);
      expect(t2 < t1).toBe(false);
      expect(t1 >= t2).toBe(false);
      expect(t2 <= t1).toBe(false);
    }

    for (const badarg of OTHERSTUFF) {
      expect(t1 == badarg).toBe(false);
      expect(t1 != badarg).toBe(true);
      expect(badarg == t1).toBe(false);
      expect(badarg != t1).toBe(true);

      for (const compare of [operator.le, operator.lt, operator.gt, operator.ge]) {
        expect(() => compare(t1, badarg)).toThrow(PyTypeError);
        expect(() => compare(badarg, t1)).toThrow(PyTypeError);
      }
    }
  });

  test("test_str", () => {
    eq(str(td(1)), "1 day, 0:00:00");
    eq(str(td(-1)), "-1 day, 0:00:00");
    eq(str(td(2)), "2 days, 0:00:00");
    eq(str(td(-2)), "-2 days, 0:00:00");

    eq(str(td(kwargs({ hours: 12, minutes: 58, seconds: 59 }))), "12:58:59");
    eq(str(td(kwargs({ hours: 2, minutes: 3, seconds: 4 }))), "2:03:04");
    eq(str(td(kwargs({ weeks: -30, hours: 23, minutes: 12, seconds: 34 }))), "-210 days, 23:12:34");

    eq(str(td(kwargs({ milliseconds: 1 }))), "0:00:00.001000");
    eq(str(td(kwargs({ microseconds: 3 }))), "0:00:00.000003");

    eq(
      str(td(kwargs({ days: 999999999, hours: 23, minutes: 59, seconds: 59, microseconds: 999999 }))),
      "999999999 days, 23:59:59.999999",
    );

    // test the Doc/library/datetime.rst recipe
    eq(`-(${-td(kwargs({ hours: -1 }))})`, "-(1:00:00)");
  });

  test("test_repr", () => {
    const name = "datetime." + timedelta.__name__;
    eq(repr(timedelta(1)), `${name}(days=1)`);
    eq(repr(timedelta(10, 2)), `${name}(days=10, seconds=2)`);
    eq(repr(timedelta(-10, 2, 400000)), `${name}(days=-10, seconds=2, microseconds=400000)`);
    eq(repr(timedelta(kwargs({ seconds: 60 }))), `${name}(seconds=60)`);
    eq(repr(timedelta()), `${name}(0)`);
    eq(repr(timedelta(kwargs({ microseconds: 100 }))), `${name}(microseconds=100)`);
    eq(repr(timedelta(kwargs({ days: 1, microseconds: 100 }))), `${name}(days=1, microseconds=100)`);
    eq(repr(timedelta(kwargs({ seconds: 1, microseconds: 100 }))), `${name}(seconds=1, microseconds=100)`);
  });

  test("test_roundtrip", () => {
    for (const td of [
      timedelta(kwargs({ days: 999999999, hours: 23, minutes: 59, seconds: 59, microseconds: 999999 })),
      timedelta(kwargs({ days: -999999999 })),
      timedelta(kwargs({ days: -999999999, seconds: 1 })),
      timedelta(kwargs({ days: 1, seconds: 2, microseconds: 3 })),
    ]) {
      // Verify td -> string -> td identity.
      let s = repr(td);
      expect(s).toStartWith("datetime.");
      s = s.slice(9);
      let td2 = pyeval(s, py({ timedelta }));
      eq(td, td2);

      // Verify identity via reconstructing from pieces.
      td2 = timedelta(td.days, td.seconds, td.microseconds);
      eq(td, td2);
    }
  });

  test("test_bool", () => {
    expect(bool(timedelta(1))).toBe(true);
    expect(bool(timedelta(0, 1))).toBe(true);
    expect(bool(timedelta(0, 0, 1))).toBe(true);
    expect(bool(timedelta(kwargs({ microseconds: 1 })))).toBe(true);
    expect(bool(timedelta(0))).toBe(false);
    // To JavaScript every object is true.
    expect(!!timedelta(0)).toBe(true);
  });

  test("test_division", () => {
    let t = timedelta(kwargs({ hours: 1, minutes: 24, seconds: 19 }));
    const second = timedelta(kwargs({ seconds: 1 }));
    expect(t / second).toBe(5059.0);
    expect(floordiv(t, second)).toBe(5059);

    t = timedelta(kwargs({ minutes: 2, seconds: 30 }));
    const minute = timedelta(kwargs({ minutes: 1 }));
    expect(t / minute).toBe(2.5);
    expect(floordiv(t, minute)).toBe(2);

    const zerotd = timedelta(0);
    expect(() => truediv(t, zerotd)).toThrow(ZeroDivisionError);
    expect(() => floordiv(t, zerotd)).toThrow(ZeroDivisionError);
  });

  test("test_remainder", () => {
    let t = timedelta(kwargs({ minutes: 2, seconds: 30 }));
    const minute = timedelta(kwargs({ minutes: 1 }));
    let r = t % minute;
    eq(r, timedelta(kwargs({ seconds: 30 })));

    t = timedelta(kwargs({ minutes: -2, seconds: 30 }));
    r = t % minute;
    eq(r, timedelta(kwargs({ seconds: 30 })));

    const zerotd = timedelta(0);
    expect(() => mod(t, zerotd)).toThrow(ZeroDivisionError);

    expect(() => mod(t, 10)).toThrow(PyTypeError);
  });

  test("test_divmod", () => {
    let t = timedelta(kwargs({ minutes: 2, seconds: 30 }));
    const minute = timedelta(kwargs({ minutes: 1 }));
    let [q, r] = divmod(t, minute);
    expect(q).toBe(2);
    eq(r, timedelta(kwargs({ seconds: 30 })));

    t = timedelta(kwargs({ minutes: -2, seconds: 30 }));
    [q, r] = divmod(t, minute);
    expect(q).toBe(-2);
    eq(r, timedelta(kwargs({ seconds: 30 })));

    const zerotd = timedelta(0);
    expect(() => divmod(t, zerotd)).toThrow(ZeroDivisionError);

    expect(() => divmod(t, 10)).toThrow(PyTypeError);
  });
});

describe("TestDate", () => {
  const theclass = date;

  test("test_basic_attributes", () => {
    const dt = theclass(2002, 3, 1);
    expect(dt.year).toBe(2002);
    expect(dt.month).toBe(3);
    expect(dt.day).toBe(1);
  });

  test("test_roundtrip", () => {
    for (const dt of [theclass(1, 2, 3), theclass.today()]) {
      // Verify dt -> string -> date identity.
      let s = repr(dt);
      expect(s).toStartWith("datetime.");
      s = s.slice(9);
      let dt2 = pyeval(s, py({ date }));
      eq(dt, dt2);

      // Verify identity via reconstructing from pieces.
      dt2 = theclass(dt.year, dt.month, dt.day);
      eq(dt, dt2);
    }
  });

  test("test_bad_constructor_arguments", () => {
    // bad years
    theclass(MINYEAR, 1, 1); // no exception
    theclass(MAXYEAR, 1, 1); // no exception
    expect(() => theclass(MINYEAR - 1, 1, 1)).toThrow(ValueError);
    expect(() => theclass(MAXYEAR + 1, 1, 1)).toThrow(ValueError);
    // bad months
    theclass(2000, 1, 1); // no exception
    theclass(2000, 12, 1); // no exception
    expect(() => theclass(2000, 0, 1)).toThrow(ValueError);
    expect(() => theclass(2000, 13, 1)).toThrow(ValueError);
    // bad days
    theclass(2000, 2, 29); // no exception
    theclass(2004, 2, 29); // no exception
    theclass(2400, 2, 29); // no exception
    expect(() => theclass(2000, 2, 30)).toThrow(ValueError);
    expect(() => theclass(2001, 2, 29)).toThrow(ValueError);
    expect(() => theclass(2100, 2, 29)).toThrow(ValueError);
    expect(() => theclass(1900, 2, 29)).toThrow(ValueError);
    expect(() => theclass(2000, 1, 0)).toThrow(ValueError);
    expect(() => theclass(2000, 1, 32)).toThrow(ValueError);
  });

  test("test_hash_equality", () => {
    for (const args of [
      [2000, 12, 31],
      [2001, 1, 1],
    ]) {
      const d = theclass(...args);
      // same thing
      const e = theclass(...args);
      eq(d, e);
      expect(hash(d)).toBe(hash(e));

      const dic = dict([[d, 1]]);
      setitem(dic, e, 2);
      expect(len(dic)).toBe(1);
      expect(getitem(dic, d)).toBe(2);
      expect(getitem(dic, e)).toBe(2);
    }
  });

  test("test_computations", () => {
    let a = theclass(2002, 1, 31);
    const b = theclass(1956, 1, 31);
    const c = theclass(2001, 2, 1);

    const diff = a - b;
    expect(diff.days).toBe(46 * 365 + len(range(1956, 2002, 4)));
    expect(diff.seconds).toBe(0);
    expect(diff.microseconds).toBe(0);

    const day = timedelta(1);
    const week = timedelta(7);
    a = theclass(2002, 3, 2);
    eq(a + day, theclass(2002, 3, 3));
    eq(day + a, theclass(2002, 3, 3));
    eq(a - day, theclass(2002, 3, 1));
    eq(-day + a, theclass(2002, 3, 1));
    eq(a + week, theclass(2002, 3, 9));
    eq(a - week, theclass(2002, 2, 23));
    eq(a + 52 * week, theclass(2003, 3, 1));
    eq(a - 52 * week, theclass(2001, 3, 3));
    eq(a + week - a, week);
    eq(a + day - a, day);
    eq(a - week - a, -week);
    eq(a - day - a, -day);
    eq(a - (a + week), -week);
    eq(a - (a + day), -day);
    eq(a - (a - week), week);
    eq(a - (a - day), day);
    eq(c - (c - day), day);

    // Add/sub ints or floats should be illegal
    for (const i of [1, float(1)]) {
      expect(() => operator.add(a, i)).toThrow(PyTypeError);
      expect(() => operator.sub(a, i)).toThrow(PyTypeError);
      expect(() => operator.add(i, a)).toThrow(PyTypeError);
      expect(() => operator.sub(i, a)).toThrow(PyTypeError);
    }

    // delta - date is senseless.
    expect(() => operator.sub(day, a)).toThrow(PyTypeError);
    // mixing date and (delta or date) via * or // is senseless
    expect(() => operator.mul(day, a)).toThrow(PyTypeError);
    expect(() => operator.mul(a, day)).toThrow(PyTypeError);
    expect(() => floordiv(day, a)).toThrow(PyTypeError);
    expect(() => floordiv(a, day)).toThrow(PyTypeError);
    expect(() => operator.mul(a, a)).toThrow(PyTypeError);
    expect(() => floordiv(a, a)).toThrow(PyTypeError);
    // date + date is senseless
    expect(() => operator.add(a, a)).toThrow(PyTypeError);
  });

  test("test_overflow", () => {
    const tiny = theclass.resolution;

    for (const delta of [tiny, timedelta(1), timedelta(2)]) {
      let dt = theclass.min + delta;
      dt -= delta; // no problem
      expect(() => dt.__sub__(delta)).toThrow(OverflowError);
      expect(() => dt.__add__(-delta)).toThrow(OverflowError);
      expect(() => dt - delta).toThrow(OverflowError);

      dt = theclass.max - delta;
      dt += delta; // no problem
      expect(() => dt.__add__(delta)).toThrow(OverflowError);
      expect(() => dt.__sub__(-delta)).toThrow(OverflowError);
      expect(() => dt + delta).toThrow(OverflowError);
    }
  });

  test("test_weekday", () => {
    for (let i = 0; i < 7; i++) {
      // March 4, 2002 is a Monday
      expect(theclass(2002, 3, 4 + i).weekday()).toBe(i);
      expect(theclass(2002, 3, 4 + i).isoweekday()).toBe(i + 1);
      // January 2, 1956 is a Monday
      expect(theclass(1956, 1, 2 + i).weekday()).toBe(i);
      expect(theclass(1956, 1, 2 + i).isoweekday()).toBe(i + 1);
    }
  });

  test("test_isoformat", () => {
    const t = theclass(2, 3, 2);
    expect(t.isoformat()).toBe("0002-03-02");
  });

  test("test_ctime", () => {
    const t = theclass(2002, 3, 2);
    expect(t.ctime()).toBe("Sat Mar  2 00:00:00 2002");
  });

  test("test_compare", () => {
    const t1 = theclass(2, 3, 4);
    let t2 = theclass(2, 3, 4);
    eq(t1, t2);
    expect(t1 <= t2).toBe(true);
    expect(t1 >= t2).toBe(true);
    expect(t1 != t2).toBe(false);
    expect(t1 < t2).toBe(false);
    expect(t1 > t2).toBe(false);

    for (const args of [
      [3, 3, 3],
      [2, 4, 4],
      [2, 3, 5],
    ]) {
      t2 = theclass(...args); // this is larger than t1
      expect(t1 < t2).toBe(true);
      expect(t2 > t1).toBe(true);
      expect(t1 <= t2).toBe(true);
      expect(t2 >= t1).toBe(true);
      expect(t1 != t2).toBe(true);
      expect(t2 != t1).toBe(true);
      expect(t1 == t2).toBe(false);
      expect(t2 == t1).toBe(false);
      expect(t1 > t2).toBe(false);
      expect(t2 < t1).toBe(false);
      expect(t1 >= t2).toBe(false);
      expect(t2 <= t1).toBe(false);
    }

    for (const badarg of OTHERSTUFF) {
      expect(t1 == badarg).toBe(false);
      expect(t1 != badarg).toBe(true);
      expect(badarg == t1).toBe(false);
      expect(badarg != t1).toBe(true);

      for (const compare of [operator.le, operator.lt, operator.gt, operator.ge]) {
        expect(() => compare(t1, badarg)).toThrow(PyTypeError);
        expect(() => compare(badarg, t1)).toThrow(PyTypeError);
      }
    }
  });

  test("test_replace", () => {
    const cls = theclass;
    const args = [1, 2, 3];
    let base = cls(...args);
    eq(base.replace(), base);
    eq(copy.replace(base), base);

    const changes: [string, number][] = [
      ["year", 2],
      ["month", 3],
      ["day", 4],
    ];
    for (const [i, [name, newval]] of changes.entries()) {
      const newargs = args.slice();
      newargs[i] = newval;
      const expected = cls(...newargs);
      eq(base.replace(kwargs({ [name]: newval })), expected);
      eq(copy.replace(base, kwargs({ [name]: newval })), expected);
    }

    // Out of bounds.
    base = cls(2000, 2, 29);
    expect(() => base.replace(kwargs({ year: 2001 }))).toThrow(ValueError);
    expect(() => copy.replace(base, kwargs({ year: 2001 }))).toThrow(ValueError);
  });
});

describe("between the languages", () => {
  test("a Date and a datetime", () => {
    const js = new Date(Date.UTC(2002, 2, 1, 12, 30, 15, 250));
    const py = datetime.fromtimestamp(js.getTime() / 1000, kwargs({ tz: timezone.utc }));
    expect(py.isoformat()).toBe("2002-03-01T12:30:15.250000+00:00");
    expect(new Date(py.timestamp() * 1000)).toEqual(js);
    expect(new Date(py.isoformat())).toEqual(js);
    expect(datetime.fromisoformat(js.toISOString())).toEqual(py);
    // There is no conversion: a Date is an object of JavaScript to Python.
    expect(() => operator.sub(py, js)).toThrow(PyTypeError);
  });

  test("sorting", () => {
    const dates = [date(2002, 3, 1), date(2001, 1, 1), date(2002, 1, 31)];
    // The comparison function of JavaScript, with the operators.
    expect(dates.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(String)).toEqual([
      "2001-01-01",
      "2002-01-31",
      "2002-03-01",
    ]);
    // Without one, JavaScript sorts by what String() gives, which for dates in ISO format happens to be right.
    expect(dates.toSorted().map(String)).toEqual(["2001-01-01", "2002-01-31", "2002-03-01"]);
    // array.map() passes the index and the array too, and str() takes them for an encoding and what to do about errors.
    expect(() => dates.map(str)).toThrow(PyTypeError);
  });
});
