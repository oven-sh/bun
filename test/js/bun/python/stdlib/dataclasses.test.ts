// Translated from CPython 3.15's Lib/test/test_dataclasses/__init__.py: TestMakeDataclass, TestReplace (the first four tests) and,
// of TestCase, the basic tests of asdict() and astuple().
// JavaScript has no way to write `@dataclass class C: x: int`. What it has is make_dataclass(), which is what TestMakeDataclass
// tests; in the other tests `dataclassOf("C", { x: int })` stands for the class statement. The rest of the file (some 600 tests)
// is about what the class statement and its annotations may say.
// Not translated of TestMakeDataclass: test_no_types_no_typing_import (takes modules out of sys.modules), test_module_attr,
// test_pickle_support and test_cannot_be_pickled (classes of the module of the test: see "the module of a class" below).
import { kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import annotationlib from "python:annotationlib";
import { TypeError as PyTypeError, dict, float as pyfloat, int, len, repr, tuple, type, vars } from "python:builtins";
import {
  FrozenInstanceError,
  InitVar,
  asdict,
  astuple,
  dataclass,
  field,
  fields,
  make_dataclass,
  replace,
} from "python:dataclasses";
import { contains, getitem, methodcaller } from "python:operator";
import typing, { ClassVar } from "python:typing";
import { makeClass, method, py, raises, t } from "./helpers";

/** `@dataclass(**keywords) class name: field: type [= default]` */
const dataclassOf = (name: string, annotations: Record<string, any>, keywords: Record<string, any> = {}) =>
  make_dataclass(
    name,
    Object.entries(annotations).map(([name, type]) => (Array.isArray(type) ? [name, ...type] : [name, type])),
    kwargs(keywords),
  );

describe("TestMakeDataclass", () => {
  test("test_simple", () => {
    const C = make_dataclass(
      "C",
      [
        ["x", int],
        ["y", int, field(kwargs({ default: 5 }))],
      ],
      kwargs({
        namespace: py({
          add_one: method(function (this: any) {
            return this.x + 1;
          }),
        }),
      }),
    );
    const c = C(10);
    expect([c.x, c.y]).toEqual([10, 5]);
    expect(c.add_one()).toBe(11);
  });

  test("test_no_mutate_namespace", () => {
    // Make sure a provided namespace isn't mutated.
    const ns = dict();
    make_dataclass(
      "C",
      [
        ["x", int],
        ["y", int, field(kwargs({ default: 5 }))],
      ],
      kwargs({ namespace: ns }),
    );
    expect(ns).toEqual(dict());
  });

  test("test_base", () => {
    const Base1 = makeClass("Base1", [], {});
    const Base2 = makeClass("Base2", [], {});
    const C = make_dataclass("C", [["x", int]], kwargs({ bases: t(Base1, Base2) }));
    const c = C(2);
    expect(c).toBeInstanceOf(C);
    expect(c).toBeInstanceOf(Base1);
    expect(c).toBeInstanceOf(Base2);
  });

  test("test_base_dataclass", () => {
    const Base1 = dataclassOf("Base1", { x: int });
    const Base2 = makeClass("Base2", [], {});
    const C = make_dataclass("C", [["y", int]], kwargs({ bases: t(Base1, Base2) }));
    raises(PyTypeError, () => C(2), /required positional/);
    const c = C(1, 2);
    expect(c).toBeInstanceOf(C);
    expect(c).toBeInstanceOf(Base1);
    expect(c).toBeInstanceOf(Base2);

    expect([c.x, c.y]).toEqual([1, 2]);
  });

  test("test_init_var", () => {
    const post_init = method(function (this: any, y: number) {
      this.x *= y;
    });

    const C = make_dataclass(
      "C",
      [
        ["x", int],
        ["y", getitem(InitVar, int)],
      ],
      kwargs({ namespace: py({ __post_init__: post_init }) }),
    );
    const c = C(2, 3);
    expect(vars(c)).toEqual(py({ x: 6 }));
    expect(len(fields(c))).toBe(1);
  });

  test("test_class_var", () => {
    const C = make_dataclass("C", [
      ["x", int],
      ["y", getitem(ClassVar, int), 10],
      ["z", getitem(ClassVar, int), field(kwargs({ default: 20 }))],
    ]);
    const c = C(1);
    expect(vars(c)).toEqual(py({ x: 1 }));
    expect(len(fields(c))).toBe(1);
    expect(C.y).toBe(10);
    expect(C.z).toBe(20);
  });

  test("test_other_params", () => {
    const C = make_dataclass(
      "C",
      [
        ["x", int],
        ["y", getitem(ClassVar, int), 10],
        ["z", getitem(ClassVar, int), field(kwargs({ default: 20 }))],
      ],
      kwargs({ init: false }),
    );
    // Make sure we have a repr, but no init.
    expect(contains(vars(C), "__init__")).toBe(false);
    expect(contains(vars(C), "__repr__")).toBe(true);

    // Make sure random other params don't work.
    raises(PyTypeError, () => make_dataclass("C", [], kwargs({ xxinit: false })), /unexpected keyword argument/);
  });

  test("test_no_types", () => {
    let C = make_dataclass("Point", ["x", "y", "z"]);
    let c = C(1, 2, 3);
    expect(vars(c)).toEqual(py({ x: 1, y: 2, z: 3 }));
    expect(C.__annotations__).toEqual(py({ x: typing.Any, y: typing.Any, z: typing.Any }));

    C = make_dataclass("Point", ["x", ["y", int], "z"]);
    c = C(1, 2, 3);
    expect(vars(c)).toEqual(py({ x: 1, y: 2, z: 3 }));
    expect(C.__annotations__).toEqual(py({ x: typing.Any, y: int, z: typing.Any }));
  });

  test("test_no_types_get_annotations", () => {
    const C = make_dataclass("C", ["x", ["y", int], "z"]);

    expect(annotationlib.get_annotations(C, kwargs({ format: annotationlib.Format.VALUE }))).toEqual(
      py({ x: typing.Any, y: int, z: typing.Any }),
    );
    expect(annotationlib.get_annotations(C, kwargs({ format: annotationlib.Format.FORWARDREF }))).toEqual(
      py({ x: typing.Any, y: int, z: typing.Any }),
    );
    expect(annotationlib.get_annotations(C, kwargs({ format: annotationlib.Format.STRING }))).toEqual(
      py({ x: "typing.Any", y: "int", z: "typing.Any" }),
    );
  });

  test("test_invalid_type_specification", () => {
    for (const bad_field of [t(), t(1, 2, 3, 4), [], [1, 2, 3, 4]])
      raises(PyTypeError, () => make_dataclass("C", ["a", bad_field]), /Invalid field: /);

    // And test for things with no len().
    raises(PyTypeError, () => make_dataclass("C", ["a", pyfloat]), /has no len\(\)/);
    // There the other is a lambda. A function of JavaScript has a length, the number of its parameters.
    raises(PyTypeError, () => make_dataclass("C", ["a", (x: any) => x]), /Invalid field: /);
  });

  test("test_duplicate_field_names", () => {
    for (const field of ["a", "ab"])
      raises(PyTypeError, () => make_dataclass("C", [field, "a", field]), /Field name duplicated/);
  });

  test("test_keyword_field_names", () => {
    for (const field of ["for", "async", "await", "as"]) {
      raises(PyTypeError, () => make_dataclass("C", ["a", field]), /must not be keywords/);
      raises(PyTypeError, () => make_dataclass("C", [field]), /must not be keywords/);
      raises(PyTypeError, () => make_dataclass("C", [field, "a"]), /must not be keywords/);
    }
  });

  test("test_non_identifier_field_names", () => {
    for (const field of ["()", "x,y", "*", "2@3", "", "little johnny tables"]) {
      raises(PyTypeError, () => make_dataclass("C", ["a", field]), /must be valid identifiers/);
      raises(PyTypeError, () => make_dataclass("C", [field]), /must be valid identifiers/);
      raises(PyTypeError, () => make_dataclass("C", [field, "a"]), /must be valid identifiers/);
    }
  });

  test("test_underscore_field_names", () => {
    // Unlike namedtuple, it's okay if dataclass field names have
    // an underscore.
    make_dataclass("C", ["_", "_a", "a_a", "a_"]);
  });

  test("test_funny_class_names_names", () => {
    // No reason to prevent weird class names, since
    // types.new_class allows them.
    for (const classname of ["()", "x,y", "*", "2@3", ""]) {
      const C = make_dataclass(classname, ["a", "b"]);
      expect(C.__name__).toBe(classname);
    }
  });

  test("test_dataclass_decorator_default", () => {
    const C = make_dataclass("C", [["x", int]], kwargs({ decorator: dataclass }));
    const c = C(10);
    expect(c.x).toBe(10);
  });

  test("test_dataclass_custom_decorator", () => {
    function custom_dataclass(cls: any, keywords: Record<string, any>) {
      const dc = dataclass(cls, kwargs(keywords));
      dc.__custom__ = true;
      return dc;
    }

    const C = make_dataclass("C", [["x", int]], kwargs({ decorator: custom_dataclass }));
    const c = C(10);
    expect(c.x).toBe(10);
    expect(c.__custom__).toBe(true);
  });
});

describe("TestReplace", () => {
  test("test", () => {
    const C = dataclassOf("C", { x: int, y: int }, { frozen: true });

    const c = C(1, 2);
    const c1 = replace(c, kwargs({ x: 3 }));
    expect(c1.x).toBe(3);
    expect(c1.y).toBe(2);
  });

  test("test_frozen", () => {
    const C = dataclassOf(
      "C",
      {
        x: int,
        y: int,
        z: [int, field(kwargs({ init: false, default: 10 }))],
        t: [int, field(kwargs({ init: false, default: 100 }))],
      },
      { frozen: true },
    );

    const c = C(1, 2);
    const c1 = replace(c, kwargs({ x: 3 }));
    expect([c.x, c.y, c.z, c.t]).toEqual([1, 2, 10, 100]);
    expect([c1.x, c1.y, c1.z, c1.t]).toEqual([3, 2, 10, 100]);

    raises(PyTypeError, () => replace(c, kwargs({ x: 3, z: 20, t: 50 })), /init=False/);
    raises(PyTypeError, () => replace(c, kwargs({ z: 20 })), /init=False/);

    // Make sure the result is still frozen.
    raises(
      FrozenInstanceError,
      () => {
        c1.x = 3;
      },
      /cannot assign to field 'x'/,
    );

    // Make sure we can't replace an attribute that doesn't exist,
    //  if we're also replacing one that does exist.  Test this
    //  here, because setting attributes on frozen instances is
    //  handled slightly differently from non-frozen ones.
    raises(
      PyTypeError,
      () => replace(c, kwargs({ x: 20, a: 5 })),
      /__init__\(\) got an unexpected keyword argument 'a'/,
    );
  });

  test("test_invalid_field_name", () => {
    const C = dataclassOf("C", { x: int, y: int }, { frozen: true });

    const c = C(1, 2);
    raises(PyTypeError, () => replace(c, kwargs({ z: 3 })), /__init__\(\) got an unexpected keyword argument 'z'/);
  });

  test("test_invalid_object", () => {
    const C = dataclassOf("C", { x: int, y: int }, { frozen: true });

    raises(PyTypeError, () => replace(C, kwargs({ x: 3 })), /dataclass instance/);
  });
});

describe("TestCase", () => {
  test("test_helper_asdict", () => {
    // Basic tests for asdict(), it should return a new dictionary.
    const C = dataclassOf("C", { x: int, y: int });
    const c = C(1, 2);

    expect(asdict(c)).toEqual(py({ x: 1, y: 2 }));
    expect(asdict(c)).toEqual(asdict(c));
    expect(asdict(c)).not.toBe(asdict(c));
    c.x = 42;
    expect(asdict(c)).toEqual(py({ x: 42, y: 2 }));
    expect(type(asdict(c))).toBe(dict);
  });

  test("test_helper_asdict_raises_on_classes", () => {
    // asdict() should raise on a class object.
    const C = dataclassOf("C", { x: int, y: int });
    raises(PyTypeError, () => asdict(C), /dataclass instance/);
  });

  test("test_helper_astuple", () => {
    // Basic tests for astuple(), it should return a new tuple.
    const C = dataclassOf("C", { x: int, y: [int, 0] });
    const c = C(1);

    expect(astuple(c)).toEqual(t(1, 0));
    expect(astuple(c)).toEqual(astuple(c));
    expect(astuple(c)).not.toBe(astuple(c));
    c.y = 42;
    expect(astuple(c)).toEqual(t(1, 42));
    expect(type(astuple(c))).toBe(tuple);
  });

  test("test_helper_astuple_raises_on_classes", () => {
    // astuple() should raise on a class object.
    const C = dataclassOf("C", { x: int, y: int });
    raises(PyTypeError, () => astuple(C), /dataclass instance/);
  });
});

describe("between the languages", () => {
  const Point = dataclassOf("Point", { x: int, y: [int, 0] }, { order: true });

  test("an instance is an object with its fields", () => {
    const p = new Point(1, 2);
    const { x, y } = p;
    expect([x, y]).toEqual([1, 2]);
    expect(Object.keys(p)).toEqual(["x", "y"]);
    expect({ ...p }).toEqual({ x: 1, y: 2 });
    expect(JSON.stringify(p)).toBe('{"x":1,"y":2}');
    expect(p).toEqual({ x: 1, y: 2 });
    expect(String(p)).toEqual(repr(p));
    expect(Bun.inspect(p)).toEndWith("Point(x=1, y=2)");
    expect(Point(kwargs({ y: 5, x: 4 }))).toEqual(Point(4, 5));
  });

  test("the operators are those the decorator made", () => {
    expect(Point(1, 2) == Point(1, 2)).toBe(true);
    expect(Point(1, 2) === Point(1, 2)).toBe(false);
    expect(Point(1, 2) != Point(1, 3)).toBe(true);
    expect(Point(1, 2) < Point(1, 3)).toBe(true);
    expect(Point(2, 0) >= Point(1, 3)).toBe(true);
    expect([Point(2), Point(1, 5), Point(1)].sort((a, b) => (a < b ? -1 : 1)).map(String)).toEqual(
      [Point(1), Point(1, 5), Point(2)].map(String),
    );
  });

  test("a default_factory of JavaScript", () => {
    const C = make_dataclass("C", [["items", typing.Any, field(kwargs({ default_factory: () => [] }))]]);
    const [a, b] = [C(), C()];
    a.items.push(1);
    expect(a.items).toEqual([1]);
    expect(b.items).toEqual([]);
  });

  test("a function of JavaScript in a class is not a method", () => {
    const C = make_dataclass(
      "C",
      ["x"],
      kwargs({
        namespace: py({
          plain(...args: any[]) {
            return [this, args];
          },
        }),
      }),
    );
    const c = C(1);
    // Called by Python, neither `this` nor the first argument is the instance.
    expect(methodcaller("plain", "a")(c)).toEqual([undefined, ["a"]]);
    // Called by JavaScript, `this` is what is left of the dot, as for any function.
    expect(c.plain("a")[0]).toBe(c);
  });

  test("a class of Python cannot be extended by `class`", () => {
    expect(() => class extends Point {}).toThrow(TypeError);
    // type() does it.
    const Point3 = makeClass("Point3", [Point], {
      norm() {
        return Math.hypot(this.x, this.y);
      },
    });
    expect(Point3(3, 4).norm()).toBe(5);
    expect(Point3(3, 4)).toBeInstanceOf(Point);
  });

  test("the module of a class", () => {
    // make_dataclass(), namedtuple() and Enum() take it from the frame of their caller, which is not Python's here.
    expect(make_dataclass("Nested", []).__module__).toBe("__main__");
    expect(make_dataclass("Nested", [], kwargs({ module: "mine" })).__module__).toBe("mine");
  });
});
