// @ts-nocheck
// What the code that translate.py writes calls: see README.md. Everything there that is not syntax of JavaScript is `$.name`.
import python from "bun:python";
import { afterAll, beforeAll, describe, test } from "bun:test";
import { appendFileSync } from "node:fs";
import builtins from "python:builtins";
import operator from "python:operator";
import py from "./support.py";

export { builtins };

// ---- What kind of value it is ----

const objectPrototype = Object.getPrototypeOf(builtins.object());
const functionPrototype = Object.getPrototypeOf(builtins.len);
const exceptionPrototype = Object.getPrototypeOf(builtins.ValueError());
const { type: typeOf, getattr, list: listType, tuple: tupleType } = builtins;

const enum Kind {
  Attributes = 1, // Its properties are its attributes.
  Indices = 2, // x[0] is x[0], and to ask twice does no harm.
}
const kindOfType = new Map();
const indexed = new Set([tupleType, builtins.bytes, builtins.bytearray, builtins.range]);

/** 0 for what is not an object of Python's: numbers, strings, arrays, functions and objects of JavaScript. */
function kindOf(x): number {
  const t = typeof x;
  if ((t !== "object" && t !== "function") || x === null) return 0;
  const prototype = Object.getPrototypeOf(x);
  if (prototype !== objectPrototype && prototype !== functionPrototype && prototype !== exceptionPrototype) return 0;
  const type = typeOf(x);
  let kind = kindOfType.get(type);
  if (kind === undefined) {
    kind = (py.is_mapping_type(type) ? 0 : Kind.Attributes) | (indexed.has(type) ? Kind.Indices : 0);
    kindOfType.set(type, kind);
  }
  return kind;
}

const isList = x => Array.isArray(x) && typeOf(x) === listType;

// ---- Attributes ----

// What an object of Python's has for JavaScript when it has no attribute of the name, where Python raises AttributeError.
const namesOfJavaScript = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  ...Object.getOwnPropertyNames(Function.prototype),
  ...Object.getOwnPropertyNames(Error.prototype),
  ..."length then next return throw toJSON constructor name message cause stack prototype".split(" "),
]);

/** `x.name` */
export function attr(x, name: string) {
  if (kindOf(x) & Kind.Attributes && !namesOfJavaScript.has(name)) {
    const value = x[name];
    if (value !== undefined) return value;
  }
  return getattr(x, name);
}

/** `x.name = value` */
export function setattr(x, name: string, value) {
  if (kindOf(x) & Kind.Attributes) x[name] = value;
  else builtins.setattr(x, name, value);
}

// ---- Items ----

const isIndex = k => typeof k === "number" && k >= 0 && Number.isInteger(k) && !Object.is(k, -0);

/** `x[key]` */
export function getitem(x, key) {
  if (isIndex(key)) {
    if (Array.isArray(x)) {
      if (key < x.length && typeOf(x) === listType) return x[key];
    } else if (kindOf(x) & Kind.Indices) {
      const value = x[key];
      if (value !== undefined) return value;
    }
  }
  return operator.getitem(x, key);
}

/** `x[key] = value` */
export function setitem(x, key, value) {
  if (isIndex(key) && Array.isArray(x) && key < x.length && typeOf(x) === listType) x[key] = value;
  else operator.setitem(x, key, value);
}

export const delitem = operator.delitem;
export const slice = builtins.slice;

// ---- Operators ----

export const {
  floordiv, matmul, pos,
  iadd, isub, imul, itruediv, ifloordiv, imod, ipow, imatmul, ilshift, irshift, iand, ior, ixor,
} = operator; // prettier-ignore

function isObjectOfPython(x): boolean {
  const t = typeof x;
  if ((t !== "object" && t !== "function") || x === null) return false;
  const prototype = Object.getPrototypeOf(x);
  return prototype === objectPrototype || prototype === functionPrototype || prototype === exceptionPrototype;
}

// The operators of JavaScript ask the classes of the objects of Python's among their operands. On numbers, strings and arrays
// they are JavaScript's own, which is something else. They are used only if that is asked for, because there are known
// differences: a comparison gives true or false, and where neither class has an answer there is no TypeError.
const usesOperatorsOfJavaScript = process.env.STDLIB_SUITE_NATIVE === "1";
// The class of a string or an array on the left is not asked (`"%s" % (1,)` is NaN): STDLIB_SUITE_NATIVE_LEFT=0 leaves those to Python.
const isAsked =
  usesOperatorsOfJavaScript && process.env.STDLIB_SUITE_NATIVE_LEFT !== "0"
    ? () => true
    : a => typeof a !== "string" && !Array.isArray(a);
const binary = (ofPython, ofJavaScript) =>
  usesOperatorsOfJavaScript
    ? (a, b) => (isObjectOfPython(a) || (isObjectOfPython(b) && isAsked(a)) ? ofJavaScript(a, b) : ofPython(a, b))
    : ofPython;
const unary = (ofPython, ofJavaScript) =>
  usesOperatorsOfJavaScript ? a => (isObjectOfPython(a) ? ofJavaScript(a) : ofPython(a)) : ofPython;

export const add = binary(operator.add, (a, b) => a + b);
export const sub = binary(operator.sub, (a, b) => a - b);
export const mul = binary(operator.mul, (a, b) => a * b);
export const truediv = binary(operator.truediv, (a, b) => a / b);
export const mod = binary(operator.mod, (a, b) => a % b);
export const pow = binary(operator.pow, (a, b) => a ** b);
export const lshift = binary(operator.lshift, (a, b) => a << b);
export const rshift = binary(operator.rshift, (a, b) => a >> b);
export const and_ = binary(operator.and_, (a, b) => a & b);
export const or_ = binary(operator.or_, (a, b) => a | b);
export const xor = binary(operator.xor, (a, b) => a ^ b);
export const eq = binary(operator.eq, (a, b) => a == b);
export const ne = binary(operator.ne, (a, b) => a != b);
export const lt = binary(operator.lt, (a, b) => a < b);
export const le = binary(operator.le, (a, b) => a <= b);
export const gt = binary(operator.gt, (a, b) => a > b);
export const ge = binary(operator.ge, (a, b) => a >= b);
export const neg = unary(operator.neg, a => -a);
export const invert = unary(operator.invert, a => ~a);

/** `a is b` */
export const is = Object.is;
/** `a in b` */
export const in_ = (a, b): boolean => operator.contains(b, a);

/** `bool(x)`, as `if x:` asks. */
export function bool(x): boolean {
  switch (typeof x) {
    case "boolean":
      return x;
    case "undefined":
      return false;
    case "number":
      return x !== 0; // A NaN is true.
    case "string":
      return x.length !== 0;
    case "bigint":
      return x !== 0n;
  }
  return x !== null && builtins.bool(x);
}

// ---- Literals ----

export const float = python.float;
/** `(a, b)` */
export const t = (...items) => tupleType(items);
/** `{a, b}` */
export const s = (...items) => builtins.set(items);
/** `{k: v, **m}`: `d([k, v], [m])` */
export const d = (...parts) => py.build_dict(parts);
/** `b"..."`: a byte for each character */
export const b = (text: string) => builtins.bytes(text, "latin-1");

// ---- Iteration ----

/**
 * What `for x in iterable` goes over. A dict gives its keys. To leave a loop of Python's early closes nothing, so there is no
 * `return()` here.
 */
export function iter(iterable) {
  if (typeof iterable === "string" || isList(iterable)) return iterable;
  const iterator = builtins.iter(iterable);
  return {
    next: () => iterator.next(),
    [Symbol.iterator]() {
      return this;
    },
  };
}

/** The same for `async for`. */
export function aiter(iterable) {
  const iterator = builtins.aiter(iterable)[Symbol.asyncIterator]();
  return {
    next: () => iterator.next(),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/** What `yield from iterable` delegates to. */
export function delegate(iterable) {
  if (typeof iterable === "string" || isList(iterable)) return iterable;
  return builtins.iter(iterable);
}

/** `*iterable` in a call or a display */
export const spread = iterable => (isList(iterable) ? iterable : listType(iterable));

/** `a, b = iterable`; with `after`, `a, *b, c = iterable` */
export function unpack(iterable, before: number, after = -1) {
  if (after < 0 && isList(iterable) && iterable.length === before) return iterable;
  return py.unpack(iterable, before, after);
}

// ---- Calls ----

const keywordsOf = new WeakMap();

/** `f(a=1)`: `f(kw({ a: 1 }))` */
export function kw(keywords) {
  const marker = python.kwargs(keywords);
  keywordsOf.set(marker, keywords);
  return marker;
}

/** `f(x, a=1, **m)`: `call(f, [x], { a: 1 }, m)` */
export const call = (f, args, ...mappings) => py.call(f, args, mappings)[0];

/**
 * `f(...args)`, called by Python. What it returns is what JavaScript gets: a coroutine, where to call the function would give a
 * promise of what it returns.
 */
export function rawFor(module: string) {
  const call = py.boxed_caller(module);
  return (f, ...args) => call(f, ...args)[0];
}

interface Signature {
  name: string;
  /** The parameters that take positional arguments. */
  pos: string[];
  /** How many of them take nothing else. */
  only?: number;
  /** The defaults of the last of them. */
  defaults?: unknown[];
  /** `*args` */
  rest?: boolean;
  /** The parameters after `*`, and the defaults of those that have one. */
  kwonly?: string[];
  kwdefaults?: Record<string, unknown>;
  /** `**kwargs` */
  kwrest?: boolean;
}

const plural = (n: number, word = "argument") => `${n} ${word}${n === 1 ? "" : "s"}`;
const quoted = (names: string[]) =>
  names.length < 3
    ? names.map(n => `'${n}'`).join(" and ")
    : names.slice(0, -1).map(n => `'${n}'`).join(", ") + `, and '${names.at(-1)}'`; // prettier-ignore

function bind(given: unknown[], signature: Signature): unknown[] {
  const { name, pos, only = 0, defaults = [], rest, kwonly = [], kwdefaults = {}, kwrest } = signature;
  let count = given.length;
  let keywords;
  const last = given[count - 1];
  if (count && typeof last === "object" && last !== null) {
    // From JavaScript, what kw() made; from Python, an object.
    keywords = keywordsOf.get(last) ?? (Object.getPrototypeOf(last) === Object.prototype ? last : undefined);
    if (keywords) count--;
  }
  const values = new Array(pos.length);
  const isSet = new Array(pos.length).fill(false);
  for (let i = 0; i < count && i < pos.length; i++) {
    values[i] = given[i];
    isSet[i] = true;
  }
  if (count > pos.length && !rest) {
    const least = pos.length - defaults.length;
    const takes = defaults.length ? `from ${least} to ${pos.length}` : `${pos.length}`;
    throw builtins.TypeError(
      `${name}() takes ${takes} positional argument${pos.length === 1 && !defaults.length ? "" : "s"} but ${count} ${count === 1 ? "was" : "were"} given`,
    );
  }
  const others = [];
  const keywordOnly = {};
  for (const key in keywords) {
    const index = pos.indexOf(key);
    if (index >= only) {
      if (isSet[index]) throw builtins.TypeError(`${name}() got multiple values for argument '${key}'`);
      values[index] = keywords[key];
      isSet[index] = true;
    } else if (kwonly.includes(key)) keywordOnly[key] = keywords[key];
    else if (kwrest) others.push([key, keywords[key]]);
    else if (index >= 0)
      throw builtins.TypeError(`${name}() got some positional-only arguments passed as keyword arguments: '${key}'`);
    else throw builtins.TypeError(`${name}() got an unexpected keyword argument '${key}'`);
  }
  const missing = [];
  for (let i = 0; i < pos.length; i++) {
    if (isSet[i]) continue;
    const index = i - (pos.length - defaults.length);
    if (index >= 0) values[i] = defaults[index];
    else missing.push(pos[i]);
  }
  if (missing.length)
    throw builtins.TypeError(`${name}() missing ${plural(missing.length, "required positional argument")}: ${quoted(missing)}`); // prettier-ignore
  if (rest) values.push(tupleType(given.slice(pos.length, Math.max(count, pos.length))));
  const missingKeywords = [];
  for (const key of kwonly) {
    if (key in keywordOnly) values.push(keywordOnly[key]);
    else if (key in kwdefaults) values.push(kwdefaults[key]);
    else missingKeywords.push(key);
  }
  if (missingKeywords.length)
    throw builtins.TypeError(`${name}() missing ${plural(missingKeywords.length, "required keyword-only argument")}: ${quoted(missingKeywords)}`); // prettier-ignore
  if (kwrest) values.push(builtins.dict(others));
  return values;
}

/** `def name(a, b=1, *args, c, **kwargs)`: the implementation takes them all, in that order. */
export function fn(signature: Signature, implementation: Function) {
  const f = (...given) => implementation(...bind(given, signature));
  Object.defineProperty(f, "name", { value: signature.name });
  return f;
}

/** What `def` gives a function besides its code, for whoever looks: decorators do. */
export function named(f, name: string, qualname: string, module: string, doc?: string) {
  Object.defineProperty(f, "name", { value: name });
  f.__qualname__ = qualname;
  f.__module__ = module;
  f.__doc__ = doc;
  return f;
}

// ---- Statements ----

/** `with manager as value: body(value)`, where the body is a block that nothing leaves but by its end or an exception. */
export const with_ = python.with;
export const enter = py.enter;
export const exit = (manager, ...thrown) => py.exit(manager, thrown[0], thrown.length !== 0);
export const aenter = py.aenter;
export const aexit = (manager, ...thrown) => py.aexit(manager, thrown[0], thrown.length !== 0);

/** What stands for a part of the original that translate.py left out. To use it is not a failure of the test. */
export class Untranslated extends Error {
  name = "Untranslated";
}
export const untranslated = (what: string, reason: string) => () => {
  throw new Untranslated(`${what}: ${reason}`);
};

const isException = x => typeof x === "object" && x !== null && Object.getPrototypeOf(x) === exceptionPrototype;

/**
 * `except types:`. What is not an exception of Python's comes from a mistake, of the translation or of the runtime, since the
 * original raises nothing else: no clause catches it.
 */
export const matches = (thrown, types): boolean => isException(thrown) && py.matches(thrown, types);
/** `except:` */
export const matchesAny = isException;
/** What `raise x` and `raise x from y` throw. */
export const exception = py.exception;

export function nameError(name: string): never {
  throw builtins.NameError(`name '${name}' is not defined`);
}

/** A name that nothing in the file binds and that is no built-in, unless the program has made it one. */
export function unbound(name: string, module) {
  // The file has no statement that binds it, but exec() or globals()[name] = ... may have.
  const found = py.namespace_get(builtins.vars(module), name);
  return found ? found[0] : builtins.hasattr(builtins, name) ? getattr(builtins, name) : nameError(name);
}

/** `globals()`: the variables of the file are variables of JavaScript, and the namespace of the module is told of them here. */
export function globals(module, variables: Record<string, unknown>, stars = []) {
  const bound = Object.entries(variables).filter(([, value]) => value !== undefined);
  return py.module_namespace(
    module,
    bound.map(([name]) => name),
    bound.map(([, value]) => value),
    stars,
  );
}

export const newType = py.new_type;

/** `locals()` in a function. */
export const locals = (variables: Record<string, unknown>) => builtins.dict(Object.entries(variables));

/** A name that `from x import *` may have bound. */
export function star(modules, name: string) {
  for (let i = modules.length - 1; i >= 0; i--) {
    const found = py.namespace_get(modules[i], name);
    if (found) return found[0];
  }
  if (builtins.hasattr(builtins, name)) return getattr(builtins, name);
  nameError(name);
}

/** A name in the body of a class that the body binds: the namespace has it, or else it is what it is outside. */
export function lookup(namespace, name: string, outside: () => unknown) {
  const found = py.namespace_get(namespace, name);
  return found ? found[0] : outside();
}

/** `class name(*bases, **keywords)`, whose body is a function of the namespace. */
export const class_ = (name, qualname, module, bases, keywords, body, needsCell = false) =>
  py.make_class(name, bases, Object.entries(keywords), body, module, qualname, needsCell);

/** `def` in the body of a class. */
export const def =
  process.env.STDLIB_SUITE_RAW_METHODS === "1"
    ? named
    : (implementation, name, qualname, module, doc) => py.function(implementation, name, qualname, module, doc);

export const defAsync = (implementation, name, qualname, module, doc) =>
  py.async_function(implementation, name, qualname, module, doc);
export const annotate = py.annotate;
export const annotator = py.annotator;
export const annotated = py.annotated;

// ---- Coroutines whose bodies are generators of JavaScript ----

/** `async def`: the implementation returns the generator. */
export const coroutine = py.coroutine;
/** `async def` with a `yield` in it, which is `yield yielded(value)`. */
export const asyncGenerator = py.async_generator;
export const asyncGeneratorObject = generator => py.AsyncGenerator(generator);
export const yielded = py.Yielded;

/** `await awaitable` is `yield* await_(awaitable)`. */
export function* await_(awaitable) {
  const iterator = py.await_iterator(awaitable)[0];
  let isDone = false;
  try {
    let result = py.step(iterator, undefined);
    while (!result[0]) {
      let sent;
      try {
        sent = yield result[1];
      } catch (thrown) {
        result = py.step_throw(iterator, thrown);
        continue;
      }
      result = py.step(iterator, sent);
    }
    isDone = true;
    return result[1];
  } catch (thrown) {
    isDone = true;
    throw thrown;
  } finally {
    if (!isDone) py.close_iterator(iterator);
  }
}

export const aenterRaw = manager => py.aenter_raw(manager)[0];
export const aexitRaw = (manager, ...thrown) => py.aexit_raw(manager, thrown[0], thrown.length !== 0)[0];
export const aiterRaw = iterable => py.aiter_raw(iterable)[0];
export const anextRaw = iterator => py.anext_raw(iterator)[0];

export const importModule = py.import_module;
export const importFrom = py.import_from;
export const importStar = py.import_star;

// ---- The module, and its tests ----

const logPath = process.env.STDLIB_SUITE_LOG;
const alreadyRun = new Set((process.env.STDLIB_SUITE_SKIP ?? "").split("\n"));
const log = record => {
  if (logPath) appendFileSync(logPath, JSON.stringify(record) + "\n");
};

export function module(name: string, isPackage: boolean) {
  py.prepare();
  return py.module(name, isPackage);
}

function report(id: string, [status, detail]) {
  if (detail?.[0] === "JS Untranslated") status = "untranslated";
  log({ t: "end", id, status, detail });
  if (status === "fail" || status === "error") {
    const error = new Error(`${detail[0]}: ${detail[1]}`);
    error.stack = `${detail[0]}: ${detail[1]}\n${detail[2]}`;
    throw error;
  }
}

/** The end of a translated file: its names become those of the module, and its test cases tests. */
export function finish(module, namespace: Record<string, unknown>, isLibrary = false) {
  const names = Object.keys(namespace);
  const values = Object.values(namespace);
  py.export(module, names, values);
  if (isLibrary) return;
  for (const [name, value] of py.new_names(module, names)) {
    names.push(name);
    values.push(value);
  }
  let forAll;
  if (namespace.setUpModule) beforeAll(() => void (forAll = py.call_fixture(namespace.setUpModule)));
  for (const [qualname, cls, tests] of py.test_classes(names, values, module.__name__)) {
    describe(qualname, () => {
      let forClass;
      beforeAll(() => void (forClass = forAll ?? py.set_up_class(cls)));
      for (const name of tests) {
        const id = `${qualname}.${name}`;
        if (alreadyRun.has(id)) continue;
        test(name, () => {
          log({ t: "start", id });
          report(id, forClass ?? py.run_test(cls, name));
        });
      }
      afterAll(() => {
        if (!forClass) py.tear_down_class(cls);
      });
    });
  }
  afterAll(() => {
    if (!forAll) py.tear_down_module(namespace.tearDownModule);
    log({ t: "done" });
  });
}

/** The file as a whole raised this while it was loaded. */
export function failedToLoad(thrown, name: string, isLibrary = false) {
  if (isLibrary) {
    // Who imports it gets the original.
    py.forget_module(name);
    log({ t: "library", module: name, detail: [String(thrown?.name), String(thrown?.message), String(thrown?.stack)] });
    return;
  }
  const isSkip = isException(thrown) && thrown instanceof python.import("unittest").SkipTest;
  const detail = isException(thrown)
    ? [typeOf(thrown).__name__, builtins.str(thrown), String(thrown.stack)]
    : [`JS ${thrown?.name}`, String(thrown?.message), String(thrown?.stack)];
  const status = isSkip ? "skip" : thrown instanceof Untranslated ? "untranslated" : "error";
  log({ t: "file", status, detail });
  test("the module loads", () => {
    if (status === "error") throw thrown;
  });
}
