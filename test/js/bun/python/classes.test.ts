// `class X extends PythonClass`, and functions of JavaScript as methods of Python's classes.
import { kwargs, method } from "bun:python";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import _js from "python:_js";
import {
  AttributeError,
  KeyError,
  TypeError as PyTypeError,
  ValueError,
  bool,
  callable,
  classmethod,
  dict,
  exec,
  getattr,
  hash,
  int,
  isinstance,
  issubclass,
  iter,
  len,
  list,
  next,
  object,
  property,
  repr,
  setattr,
  str,
  tuple,
  type,
  vars,
} from "python:builtins";
import abc from "python:collections.abc";
import copy from "python:copy";
import json from "python:json";
import types from "python:types";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

/** The globals of a piece of Python. */
function python(code: string) {
  const globals = dict([["__name__", "fixture"]]);
  exec(code, globals);
  return globals;
}

const {
  Base,
  derive,
  describe: describeClass,
  call,
  passOn,
  Shape,
  Meta,
  WithMeta,
  Slotted,
  raises,
  catches,
} = python(`
import abc

class Base:
    registry = []
    def __init_subclass__(cls, **keywords):
        Base.registry.append(cls.__name__)
    def __init__(self, a, b=2):
        self.a = a
        self.b = b
    def describe(self):
        return f"{type(self).__name__}({self.a}, {self.b}) {self.extra()}"
    def extra(self):
        return "base"
    @classmethod
    def make(cls, *args, **keywords):
        return cls(*args, **keywords)
    @staticmethod
    def static(x):
        return x + 1
    @property
    def total(self):
        return self.a + self.b

def derive(cls):
    class Derived(cls):
        def extra(self):
            return "py+" + super().extra() + "+" + cls.extra(self)
    return Derived

def describe(cls):
    return [cls.__name__, cls.__qualname__, cls.__module__, [c.__name__ for c in cls.__mro__], repr(cls)]

def call(function, *args, **keywords):
    return function(*args, **keywords)

def passOn(function, last, ignored):
    return function(1, last)

class Shape(abc.ABC):
    @abc.abstractmethod
    def area(self): ...
    def double(self):
        return self.area() * 2

class Meta(type):
    made = []
    def __new__(meta, name, bases, namespace):
        Meta.made.append((name, sorted(key for key in namespace if not key.startswith("__"))))
        return super().__new__(meta, name, bases, namespace)
    def __call__(cls, *args):
        instance = super().__call__(*args)
        instance.by_meta = True
        return instance

class WithMeta(metaclass=Meta):
    pass

class Slotted:
    __slots__ = ("x",)

def raises(cls, *args):
    raise cls(*args)

def catches(cls, function):
    try:
        function()
    except cls as exception:
        return exception
`);

const Expression = class extends Base {};

describe("class extends", () => {
  class X extends Base {
    z = 5;
    #secret = 7;
    static count = 0;
    static who(n: number) {
      return [this.__name__, n];
    }
    static get label() {
      return "label of " + this.__name__;
    }
    static #hidden() {
      return "hidden";
    }
    static reveal() {
      return X.#hidden();
    }
    constructor(a: number) {
      super(a, kwargs({ b: 10 }));
      this.c = a * 2;
      X.count++;
    }
    extra() {
      return `js+${super.extra()}+${this.c}+${this.#secret}`;
    }
    get twice() {
      return this.total * 2;
    }
    set twice(value) {
      this.a = value;
    }
    *[Symbol.iterator]() {
      yield this.a;
      yield this.b;
    }
  }

  test("makes a class of Python's", () => {
    expect(describeClass(X)).toEqual(["X", "X", "js", ["X", "Base", "object"], "<class 'js.X'>"]);
    expect(isinstance(X, type)).toBe(true);
    expect(issubclass(X, Base)).toBe(true);
    expect(X.name).toBe("X");
    expect(X.__bases__).toEqual(tuple([Base]));
    expect(Base.registry).toContain("X");
  });

  test("the constructor makes the instance, and super() is the base's __new__ and __init__", () => {
    const before = X.count;
    const x = new X(1);
    expect([x.a, x.b, x.c, x.z]).toEqual([1, 10, 2, 5]);
    expect(X.count).toBe(before + 1);
    expect(x).toBeInstanceOf(X);
    expect(x).toBeInstanceOf(Base);
    expect(isinstance(x, X)).toBe(true);
    expect(type(x)).toBe(X);
    expect(x.constructor).toBe(X);
    expect(vars(x)).toEqual(
      dict([
        ["a", 1],
        ["b", 10],
        ["z", 5],
        ["c", 2],
      ]),
    );
  });

  test("Python makes instances too", () => {
    expect(call(X, 3).describe()).toBe("X(3, 10) js+base+6+7");
    expect(X.make(4)).toBeInstanceOf(X);
    expect(X(5).c).toBe(10);
  });

  test("Python finds the methods, and they find the base's", () => {
    const x = new X(1);
    expect(x.describe()).toBe("X(1, 10) js+base+2+7");
    expect(getattr(x, "extra")()).toBe("js+base+2+7");
    expect(X.extra(x)).toBe("js+base+2+7");
    expect(call(X.extra, x)).toBe("js+base+2+7");
    expect(type(x.extra)).toBe(types.MethodType);
    expect(x.extra.__self__).toBe(x);
    expect(x.extra.__name__).toBe("extra");
    expect(type(vars(X).extra)).toBe(_js.JSMethod);
  });

  test("accessors are properties", () => {
    const x = new X(1);
    expect(x.total).toBe(11);
    expect(x.twice).toBe(22);
    x.twice = 100;
    expect(x.a).toBe(100);
    setattr(x, "twice", 200);
    expect(getattr(x, "twice")).toBe(420);
    expect(type(vars(X).twice)).toBe(property);
  });

  test("static members belong to the class they are called on", () => {
    class Y extends X {}
    expect(X.who(1)).toEqual(["X", 1]);
    expect(Y.who(2)).toEqual(["Y", 2]);
    expect(call(Y.who, 3)).toEqual(["Y", 3]);
    expect(new Y(1).who(4)).toEqual(["Y", 4]);
    expect(type(vars(X).who)).toBe(classmethod);
    expect(X.label).toBe("label of X");
    expect(Y.label).toBe("label of Y");
    expect(X.reveal()).toBe("hidden");
    expect(X.static(1)).toBe(2);
    expect(vars(X).count).toBe(X.count);
  });

  test("methods whose keys are symbols are for JavaScript", () => {
    expect([...new X(1)]).toEqual([1, 10]);
    class Money extends object {
      constructor(public cents: number) {
        super();
      }
      [Symbol.toPrimitive](hint: string) {
        return hint === "number" ? this.cents : `$${this.cents / 100}`;
      }
    }
    expect(`${new Money(250)}`).toBe("$2.5");
    expect(+new Money(250)).toBe(250);
  });

  test("of a class made so, and of one made of that in Python", () => {
    class Y extends X {
      constructor() {
        super(9);
      }
      extra() {
        return "Y:" + super.extra();
      }
    }
    expect(new Y().describe()).toBe("Y(9, 10) Y:js+base+18+7");
    expect(Object.getPrototypeOf(Y.prototype)).toBe(X.prototype);
    expect(Y.prototype.constructor).toBe(Y);

    const Derived = derive(X);
    const derived = Derived(7);
    expect(derived.describe()).toBe("Derived(7, 10) py+js+base+14+7+js+base+14+7");
    expect(derived).toBeInstanceOf(X);
    expect(describeClass(Derived)[3]).toEqual(["Derived", "X", "Base", "object"]);

    class Z extends Derived {
      extra() {
        return "Z:" + super.extra();
      }
    }
    expect(new Z(1).extra()).toBe("Z:py+js+base+2+7+js+base+2+7");
  });

  test("without a constructor the arguments go to the base", () => {
    class Plain extends Base {}
    expect(new Plain(1, 3).total).toBe(4);
    expect(new Plain(1, kwargs({ b: 5 })).total).toBe(6);
    expect(call(Plain, 1, kwargs({ b: 7 })).total).toBe(8);
    expect(() => new Plain()).toThrow(PyTypeError);
  });

  test("keyword arguments reach a constructor as an object", () => {
    class Options extends object {
      constructor(first: number, { second = 0 } = {}) {
        super();
        this.sum = first + second;
      }
    }
    expect(call(Options, 1, kwargs({ second: 2 })).sum).toBe(3);
    expect(new Options(1, { second: 4 }).sum).toBe(5);
  });

  test("keyword arguments that are passed on are keyword arguments again", () => {
    class Passing extends Base {
      constructor(...args: unknown[]) {
        super(...args);
      }
      static make(...args: unknown[]) {
        return super.make(...args);
      }
    }
    expect(call(Passing, 1, kwargs({ b: 7 })).total).toBe(8);
    expect(call(Passing.make, kwargs({ a: 1, b: 8 })).total).toBe(9);

    const seen: any[] = [];
    const keywords = call((...args: unknown[]) => (seen.push(...args), args.at(-1)), 1, kwargs({ b: 2 }));
    // A plain object, to JavaScript.
    expect(seen).toEqual([1, { b: 2 }]);
    expect(Object.getPrototypeOf(keywords)).toBe(Object.prototype);
    expect(Reflect.ownKeys(keywords)).toEqual(["b"]);
    expect(JSON.stringify(keywords)).toBe('{"b":2}');
    expect(Base(1, keywords).b).toBe(2);
    keywords.b = 3;
    expect(Base(1, keywords).b).toBe(3);
    // A copy is an object like any other, and so is the object anywhere but last, or when it is Python that passes it.
    expect(Base(1, { ...keywords }).b).toEqual({ b: 3 });
    expect(Base(keywords, 1).a).toBe(keywords);
    expect(call((first: unknown) => call(Base, 1, first), keywords, 0).b).toBe(3);
    expect(passOn(Base, keywords, 0).b).toBe(keywords);
  });

  test("new.target is the class", () => {
    let seen: unknown;
    class Target extends Base {
      constructor() {
        super(0);
        seen = new.target;
      }
    }
    new Target();
    expect(seen).toBe(Target);
    const Derived = derive(Target);
    Derived();
    expect(seen).toBe(Derived);
  });

  test("a class expression, and one without a name", () => {
    expect(Expression.__name__).toBe("Expression");
    expect((() => class extends Base {})().__name__).toBe("");
    const key = "Computed";
    expect({ [key]: class extends Base {} }.Computed.__name__).toBe("Computed");
    expect(repr({ [key]: class extends Base {} }.Computed)).toBe("<class 'js.Computed'>");
  });

  test("the special methods of Python can be written in JavaScript", () => {
    class Vector extends object {
      constructor(...items: number[]) {
        super();
        this.items = items;
      }
      __len__() {
        return this.items.length;
      }
      __getitem__(index: number) {
        if (index >= this.items.length) throw new KeyError(index);
        return this.items[index];
      }
      *__iter__() {
        yield* this.items;
      }
      __add__(other: any) {
        return new Vector(...this.items.map((item: number, index: number) => item + other.items[index]));
      }
      __eq__(other: any) {
        return other instanceof Vector && this.items.join() === other.items.join();
      }
      __hash__() {
        return hash(tuple(this.items));
      }
      __repr__() {
        return `Vector(${this.items.join(", ")})`;
      }
      __bool__() {
        return this.items.some((item: number) => item !== 0);
      }
      __call__(scale: number) {
        return new Vector(...this.items.map((item: number) => item * scale));
      }
      __contains__(item: number) {
        return this.items.includes(item);
      }
    }
    const v = new Vector(1, 2);
    expect(len(v)).toBe(2);
    expect(v.length).toBe(2);
    expect(v[1]).toBe(2);
    expect(list(v)).toEqual([1, 2]);
    expect([...v]).toEqual([1, 2]);
    expect(repr(v + new Vector(10, 20))).toBe("Vector(11, 22)");
    expect(v == new Vector(1, 2)).toBe(true);
    expect(v == new Vector(1, 3)).toBe(false);
    expect(dict([[v, "found"]]).get(new Vector(1, 2))).toBe("found");
    expect(str(v)).toBe("Vector(1, 2)");
    expect(`${v}`).toBe("Vector(1, 2)");
    expect(bool(new Vector(0, 0))).toBe(false);
    expect(repr(v(3))).toBe("Vector(3, 6)");
    expect(callable(v)).toBe(true);
    expect(next(iter(v))).toBe(1);
  });

  test("abstract classes", () => {
    class Nothing extends Shape {}
    expect(() => new Nothing()).toThrow(
      "Can't instantiate abstract class Nothing without an implementation for abstract method 'area'",
    );
    class Square extends Shape {
      constructor(public side: number) {
        super();
      }
      area() {
        return this.side ** 2;
      }
    }
    expect(new Square(3).double()).toBe(18);

    class Lookup extends abc.Mapping {
      __getitem__(key: string) {
        if (key.length > 3) throw new KeyError(key);
        return key.toUpperCase();
      }
      __len__() {
        return 2;
      }
      __iter__() {
        return iter(["a", "b"]);
      }
    }
    const lookup = new Lookup();
    expect(getattr(lookup, "get")("abcd", "no")).toBe("no");
    expect(list(getattr(lookup, "items")())).toEqual([tuple(["a", "A"]), tuple(["b", "B"])]);
    expect(dict(lookup)).toEqual(
      dict([
        ["a", "A"],
        ["b", "B"],
      ]),
    );
    expect(lookup.a).toBe("A");
  });

  test("metaclasses", () => {
    class Made extends WithMeta {
      hello() {}
      static there() {}
    }
    expect(type(Made)).toBe(Meta);
    expect(Meta.made.at(-1)).toEqual(tuple(["Made", ["hello", "there"]]));
    expect(new Made().by_meta).toBe(true);

    class Registry extends type {
      constructor(name: string, bases: any, namespace: any) {
        super(name.toUpperCase(), bases, namespace);
      }
    }
    expect(issubclass(Registry, type)).toBe(true);
    const made = new Registry("lower", tuple([]), dict());
    expect(type(made)).toBe(Registry);
    expect(made.__name__).toBe("LOWER");
  });

  test("exceptions", () => {
    class Failure extends ValueError {
      constructor(message: string, code = 42) {
        super(message);
        this.code = code;
      }
    }
    let caught: any;
    try {
      throw new Failure("boom");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Failure);
    expect(caught).toBeInstanceOf(ValueError);
    expect(caught).toBeInstanceOf(Error);
    expect([caught.name, caught.message, caught.code, caught.args]).toEqual(["Failure", "boom", 42, tuple(["boom"])]);
    expect(() => raises(Failure, "from Python", 7)).toThrow(Failure);
    const failure = new Failure("thrown by JavaScript");
    expect(catches(ValueError, () => { throw failure; })).toBe(failure); // prettier-ignore
    expect(catches(Failure, () => raises(Failure, "both")).code).toBe(42);
    expect(() => catches(Failure, () => raises(ValueError, "other"))).toThrow(ValueError);
  });

  test("the built-in types", () => {
    class Defaults extends dict {
      __missing__(key: string) {
        return `no ${key}`;
      }
      either(key: string) {
        return this.get(key, "neither");
      }
    }
    const defaults = new Defaults([["a", 1]]);
    expect(getattr(defaults, "__getitem__")("a")).toBe(1);
    expect(getattr(defaults, "__getitem__")("b")).toBe("no b");
    expect(defaults.either("c")).toBe("neither");
    expect(repr(defaults)).toBe("{'a': 1}");

    class Stack extends list {
      top() {
        return this[this.length - 1];
      }
    }
    const stack = new Stack([1, 2, 3]);
    expect(stack.top()).toBe(3);
    expect(Array.isArray(stack)).toBe(true);
    expect(stack.map((item: number) => item * 2)).toEqual([2, 4, 6]);
    expect(type(stack)).toBe(Stack);

    class Even extends int {
      constructor(value: number) {
        super(value - (value % 2));
      }
      half() {
        return this / 2;
      }
    }
    expect(new Even(7) + 1).toBe(7);
    expect(new Even(7).half()).toBe(3);
    expect(repr(new Even(9))).toBe("8");

    class Shout extends str {
      constructor(text: string) {
        super(text.toUpperCase());
      }
    }
    expect(`${new Shout("hey")}!`).toBe("HEY!");
    expect(new Shout("hey").lower()).toBe("hey");

    class Pair extends tuple {
      constructor(a: unknown, b: unknown) {
        super([a, b]);
      }
      get first() {
        return this[0];
      }
    }
    expect(new Pair(1, 2).first).toBe(1);
    expect(new Pair(1, 2)).toEqual(tuple([1, 2]));
    expect(() => class extends bool {}).toThrow("type 'bool' is not an acceptable base type");
  });

  test("the standard library calls what JavaScript overrides", () => {
    class Encoder extends json.JSONEncoder {
      default(value: unknown) {
        return value instanceof Date ? value.toISOString() : super.default(value);
      }
    }
    expect(json.dumps([new Date(0)], kwargs({ cls: Encoder }))).toBe('["1970-01-01T00:00:00.000Z"]');
    expect(() => json.dumps([Symbol("x")], kwargs({ cls: Encoder }))).toThrow(PyTypeError);
  });

  test("async and generator methods", async () => {
    class Worker extends Base {
      async work() {
        await Promise.resolve();
        return this.a;
      }
      *count() {
        yield this.a;
        yield this.b;
      }
    }
    const worker = new Worker(1);
    expect(await worker.work()).toBe(1);
    expect(list(worker.count())).toEqual([1, 2]);
  });

  test("__slots__ of the base hold", () => {
    class Free extends Slotted {}
    const free = new Free();
    free.x = 1;
    free.y = 2;
    expect([free.x, free.y]).toEqual([1, 2]);
    expect(vars(free)).toEqual(dict([["y", 2]]));
  });

  test("copies are made by the constructor, as for any class with a __new__", () => {
    class Point extends object {
      constructor(x = 0) {
        super();
        this.x = x;
      }
    }
    const point = new Point(3);
    const copied = copy.copy(point);
    expect(copied).toBeInstanceOf(Point);
    expect(copied).not.toBe(point);
    expect(copied.x).toBe(3);
  });

  test("a constructor that does not call super()", () => {
    class Never extends Base {
      constructor() {
        // @ts-expect-error
        return;
      }
    }
    expect(() => new Never()).toThrow(ReferenceError);
  });

  test("what is not a class of Python's is left alone", () => {
    class MyMap extends Map {}
    class MyError extends Error {}
    class MyPromise extends Promise<unknown> {}
    expect(new MyMap([[1, 2]]).get(1)).toBe(2);
    expect(new MyError("x")).toBeInstanceOf(Error);
    expect(typeof MyMap).toBe("function");
    expect(Object.getPrototypeOf(MyPromise)).toBe(Promise);
    expect(isinstance(MyMap, type)).toBe(false);
  });
});

describe("Class.prototype", () => {
  test("has the methods, which take the instance as this", () => {
    const base = Base(1);
    expect(Base.prototype.extra.call(base)).toBe("base");
    expect(Base.prototype.describe.call(base)).toBe("Base(1, 2) base");
    expect(Base.prototype.constructor).toBe(Base);
    expect(Base.prototype).toBe(Base.prototype);
    expect(Base.prototype.nothing).toBeUndefined();
    expect(list.prototype.index.call([1, 2, 3], 3)).toBe(2);
    expect(str.prototype.upper.call("a")).toBe("A");
    expect(Object.getOwnPropertyNames(Base.prototype)).toContain("describe");
    expect(Object.keys(Base.prototype)).toEqual([]);
    expect(Reflect.get(Base.prototype, "total", base)).toBe(3);
  });

  test("what is assigned to it is a method of the class", () => {
    const { C } = python("class C:\n    v = 21");
    C.prototype.twice = function () {
      return this.v * 2;
    };
    Object.defineProperty(C.prototype, "thrice", {
      get() {
        return this.v * 3;
      },
    });
    const c = C();
    expect(c.twice()).toBe(42);
    expect(C.twice(c)).toBe(42);
    expect(c.thrice).toBe(63);
    delete C.prototype.twice;
    expect(c.twice).toBeUndefined();
  });
});

describe("a function of JavaScript in a class", () => {
  const C = type(
    "C",
    tuple([]),
    dict([
      ["v", 21],
      ["ordinary", function (this: any, a: unknown) { return [this.v, a]; }], // prettier-ignore
      ["arrow", (self: any, a: unknown) => [self.v, a]],
      ["bound", function (this: any) { return this; }.bind("bound already")], // prettier-ignore
      ["native", Math.max],
      ["Class", class {}],
      ["twice", property(method(function (this: any) { return this.v * 2; }))], // prettier-ignore
    ]),
  );

  test("is a method: the instance is `this`", () => {
    const c = C();
    expect(c.ordinary(1)).toEqual([21, 1]);
    expect(getattr(c, "ordinary")(2)).toEqual([21, 2]);
    expect(type(c.ordinary)).toBe(types.MethodType);
    expect(c.ordinary.__self__).toBe(c);
  });

  test("an arrow function takes it first, as a lambda does", () => {
    expect(C().arrow(1)).toEqual([21, 1]);
  });

  test("a bound function, one written in C++ and a class are not methods", () => {
    const c = C();
    expect(c.bound()).toBe("bound already");
    expect(c.native(1, 2)).toBe(2);
    expect(c.Class).toBe(C.Class);
  });

  test("taken from the class it is the function", () => {
    expect(typeof C.ordinary).toBe("function");
    expect(C.ordinary.call({ v: 1 }, 2)).toEqual([1, 2]);
  });

  test("assigned later", () => {
    C.late = function () {
      return "late " + this.v;
    };
    expect(C().late()).toBe("late 21");
  });

  test("types.MethodType binds one", () => {
    const bound = types.MethodType(function (this: any, a: number) { return this.n + a; }, { n: 1 }); // prettier-ignore
    expect(bound(2)).toBe(3);
  });

  test("method() makes a function that takes `this` first", () => {
    const c = C();
    expect(c.twice).toBe(42);
    const area = method(function (this: any, scale: number) {
      return this.v * scale;
    });
    expect(area(c, 2)).toBe(42);
    expect(call(area, c, 3)).toBe(63);
    expect(area.__wrapped__.call(c, 1)).toBe(21);
    expect(() => area()).toThrow(PyTypeError);
    expect(() => method(5)).toThrow(PyTypeError);
    expect(() => method(len)).toThrow(PyTypeError);
  });

  test("attributes of a method() are those of the function", () => {
    function named() {}
    const wrapped = method(named);
    expect(wrapped.__name__).toBe("named");
    setattr(wrapped, "__isabstractmethod__", true);
    expect((named as any).__isabstractmethod__).toBe(true);
    expect(() => getattr(wrapped, "nothing")).toThrow(AttributeError);
  });
});
