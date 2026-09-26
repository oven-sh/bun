// Run by llint-get-by-id-caches.test.ts. What a property read returns must not depend on what the interpreter's
// inline cache of that read holds: a cached "no such property", a cached value of the prototype chain, or the
// length of a string. Each block warms one read up, changes what the read must return, and reads again.

// A JIT policy above 1 is what a compiled executable starts with (--compile-jit-policy). A function that the
// interpreter sends to the Baseline JIT for its cache misses does not wait for it.
if (process.env.LLINT_FIXTURE_JIT_POLICY) Bun.unsafe.setJITPolicy(Number(process.env.LLINT_FIXTURE_JIT_POLICY));

function shouldBe(actual, expected, message) {
  if (actual !== expected)
    throw new Error((message ? message + ": " : "") + "expected " + String(expected) + " but got " + String(actual));
}

const warmUp = 20;

// Functions of the same source share their code, and so their caches. Each one gets its own source.
let sources = 0;
const makeGetter = name => new Function("o", "return o." + name + "; // " + sources++);

// The prototype of each class gets a structure of its own, so that the engine can watch it.
let classes = 0;
function makeClass() {
  class Unique {
    constructor() {
      this.a = 1;
    }
  }
  Unique.prototype["unique" + classes++] = true;
  return Unique;
}

function warm(get, receiver, expected) {
  for (let i = 0; i < warmUp; ++i) shouldBe(get(receiver), expected, "warm up");
}

// --- A property that does not exist.

{
  const C = makeClass();
  const get = makeGetter("missing");
  const o = new C();
  warm(get, o, undefined);
  C.prototype.missing = 1;
  shouldBe(get(o), 1, "added on the prototype");
  delete C.prototype.missing;
  warm(get, o, undefined);
  Object.prototype.missing = 2;
  shouldBe(get(o), 2, "added on Object.prototype");
  delete Object.prototype.missing;
  warm(get, o, undefined);
  Object.defineProperty(C.prototype, "missing", {
    get() {
      return this.a + 2;
    },
    configurable: true,
  });
  shouldBe(get(o), 3, "getter added on the prototype");
  delete C.prototype.missing;
  warm(get, o, undefined);
  o.missing = 4;
  shouldBe(get(o), 4, "added on the receiver");
  delete o.missing;
  warm(get, o, undefined);
  Object.setPrototypeOf(C.prototype, { missing: 5 });
  shouldBe(get(o), 5, "prototype of the prototype replaced");
  Object.setPrototypeOf(o, { missing: 6 });
  shouldBe(get(o), 6, "prototype of the receiver replaced");
}

{
  const get = makeGetter("missing");
  const o = Object.create(null);
  o.a = 1;
  warm(get, o, undefined);
  o.missing = 7;
  shouldBe(get(o), 7, "receiver with no prototype");
}

{
  // An object that lost properties keeps them in a table of its own, and can get a property with no new shape.
  const get = makeGetter("missing");
  const o = {};
  for (let i = 0; i < 300; ++i) o["p" + i] = i;
  for (let i = 0; i < 300; i += 2) delete o["p" + i];
  for (let round = 0; round < 3; ++round) {
    warm(get, o, undefined);
    o.missing = 8 + round;
    shouldBe(get(o), 8 + round, "dictionary receiver, round " + round);
    delete o.missing;
  }
  const child = Object.create(o);
  child.a = 1;
  for (let round = 0; round < 3; ++round) {
    warm(get, child, undefined);
    o.missing = 11 + round;
    shouldBe(get(child), 11 + round, "dictionary prototype, round " + round);
    delete o.missing;
  }
}

{
  let answer;
  const proxy = new Proxy({}, { get: (target, key) => (key === "missing" ? answer : undefined) });
  const o = Object.create(proxy);
  o.a = 1;
  const get = makeGetter("missing");
  warm(get, o, undefined);
  warm(get, proxy, undefined);
  answer = 14;
  shouldBe(get(o), 14, "proxy on the chain");
  shouldBe(get(proxy), 14, "proxy receiver");
}

for (const [receiver, prototype] of [
  ["string", String.prototype],
  [Symbol(), Symbol.prototype],
  [1n << 70n, BigInt.prototype],
  [5, Number.prototype],
  [true, Boolean.prototype],
  [[1, 2], Array.prototype],
  [new Uint8Array(2), Uint8Array.prototype],
  [function () {}, Function.prototype],
  [() => {}, Function.prototype],
  [new Map(), Map.prototype],
  [new Error("e"), Error.prototype],
  [/x/, RegExp.prototype],
  [Promise.resolve(), Promise.prototype],
  [globalThis, Object.prototype],
  [process, Object.getPrototypeOf(process)],
  [Buffer.alloc(1), Buffer.prototype],
  [new URL("http://localhost/"), URL.prototype],
  [new Request("http://localhost/"), Request.prototype],
  [new Headers(), Headers.prototype],
]) {
  const get = makeGetter("missing");
  warm(get, receiver, undefined);
  prototype.missing = 15;
  shouldBe(get(receiver), 15, "added on the prototype of " + Object.prototype.toString.call(receiver));
  delete prototype.missing;
  warm(get, receiver, undefined);
  Object.prototype.missing = 16;
  shouldBe(get(receiver), 16, "added on Object.prototype, for " + Object.prototype.toString.call(receiver));
  delete Object.prototype.missing;
  shouldBe(get(receiver), undefined);
}

{
  // Properties that an object makes when they are first read.
  const error = new Error("lazy");
  const getStack = makeGetter("stack");
  shouldBe(typeof getStack(error), "string");
  const getPrototype = makeGetter("prototype");
  const arrow = () => {};
  warm(getPrototype, arrow, undefined);
  function ordinary() {}
  shouldBe(getPrototype(ordinary), ordinary.prototype);
  const getName = makeGetter("name");
  warm(getName, ordinary, "ordinary");
  const getCode = makeGetter("code");
  warm(getCode, error, undefined);
  error.code = "E";
  shouldBe(getCode(error), "E");
}

{
  // Objects that get a property of their own from native code.
  const getVariable = makeGetter("LLINT_FIXTURE_NOT_SET");
  warm(getVariable, process.env, undefined);
  process.env.LLINT_FIXTURE_NOT_SET = "set";
  shouldBe(getVariable(process.env), "set", "process.env");
  delete process.env.LLINT_FIXTURE_NOT_SET;
  shouldBe(getVariable(process.env), undefined);

  const vm = require("node:vm");
  for (const [how, add] of [
    ["an assignment in the context", context => vm.runInContext("globalThis.late = 'late'", context)],
    [
      "a definition in the context",
      context => vm.runInContext("Object.defineProperty(globalThis, 'late', { value: 'late' })", context),
    ],
    ["an assignment from outside", context => void (context.late = "late")],
  ]) {
    for (const context of [vm.createContext(vm.constants.DONT_CONTEXTIFY), vm.createContext({})]) {
      const get = makeGetter("late");
      warm(get, context, undefined);
      add(context);
      shouldBe(get(context), "late", "the object of a context after " + how);
    }
  }
}

// A variable of a later script is a property of the global object, and the global object keeps its structure. The
// interpreter does not cache "no such property" for a global object. An inline cache of the JIT does, and keeps it
// after the declaration. So this is for a function that is still in the interpreter after 4 reads.
if (process.env.BUN_JSC_useJIT === "0" || Number(process.env.BUN_JSC_missCountForLLIntTierUp ?? 12) > 4) {
  const get = new Function("return globalThis.llintFixtureVariable; // " + sources++);
  for (let i = 0; i < 4; ++i) shouldBe(get(), undefined);
  require("node:vm").runInThisContext("var llintFixtureVariable = 'variable';");
  shouldBe(globalThis.llintFixtureVariable, "variable");
  shouldBe(get(), "variable", "variable of a later script");
}

{
  // One read that sees the property, then does not, then does.
  const get = makeGetter("missing");
  const present = { missing: 1 };
  const absent = { other: 1 };
  const C = makeClass();
  C.prototype.missing = "proto";
  const inherited = new C();
  for (let round = 0; round < 100; ++round) {
    for (let i = 0; i < 3; ++i) shouldBe(get(present), 1);
    for (let i = 0; i < 3; ++i) shouldBe(get(absent), undefined);
    for (let i = 0; i < 3; ++i) shouldBe(get(inherited), "proto");
  }
  Object.prototype.missing = 17;
  shouldBe(get(absent), 17);
  shouldBe(get(present), 1);
  shouldBe(get(inherited), "proto");
  delete Object.prototype.missing;
  delete C.prototype.missing;
  shouldBe(get(inherited), undefined);
}

// --- A value of the prototype chain.

{
  const C = makeClass();
  C.prototype.value = "proto";
  const get = makeGetter("value");
  const o = new C();
  warm(get, o, "proto");
  o.b = 2; // The receiver gets a new shape.
  warm(get, o, "proto");
  o.c = 3;
  warm(get, o, "proto");
  C.prototype.value = "replaced";
  shouldBe(get(o), "replaced");
  delete C.prototype.value;
  shouldBe(get(o), undefined, "deleted from the prototype");
  C.prototype.value = "back";
  warm(get, o, "back");
  o.value = "own";
  warm(get, o, "own");
  delete o.value;
  warm(get, o, "back");
}

{
  const top = { value: "top" };
  const middle = Object.create(top);
  middle.m = 1;
  const o = Object.create(middle);
  o.a = 1;
  const get = makeGetter("value");
  shouldBe(get({ value: "own" }), "own");
  for (let round = 0; round < 6; ++round) {
    warm(get, o, "top");
    Object.setPrototypeOf(middle, { value: "other top" });
    shouldBe(get(o), "other top", "round " + round);
    Object.setPrototypeOf(middle, top);
  }
  middle.value = "middle";
  shouldBe(get(o), "middle", "shadowed in the middle of the chain");
  delete middle.value;
  warm(get, o, "top");
}

{
  const get = makeGetter("indexOf");
  const arrays = [[], [1, 2], [1.5, 2.5], ["a", {}], [, 1]];
  for (let round = 0; round < 5; ++round) for (const array of arrays) warm(get, array, Array.prototype.indexOf);
  const original = Array.prototype.indexOf;
  const replacement = function () {};
  Array.prototype.indexOf = replacement;
  for (const array of arrays) shouldBe(get(array), replacement, "Array.prototype.indexOf replaced");
  Array.prototype.indexOf = original;
  for (const array of arrays) {
    array.indexOf = replacement;
    shouldBe(get(array), replacement, "own indexOf");
    delete array.indexOf;
    shouldBe(get(array), original);
  }
}

{
  // The objects of the cache die, and the read is used again.
  const get = makeGetter("value");
  for (let round = 0; round < 4; ++round) {
    (function () {
      const proto = { value: round };
      const o = Object.create(proto);
      o.a = round;
      warm(get, o, round);
      const bare = Object.create(null);
      bare["b" + round] = 1;
      warm(get, bare, undefined);
    })();
    Bun.gc(true);
  }
  const proto = { value: "last" };
  const o = Object.create(proto);
  o.a = 1;
  warm(get, o, "last");
  delete proto.value;
  shouldBe(get(o), undefined);
}

{
  // for-of reads "next" of the iterator, and "done" and "value" of each result. instanceof reads Symbol.hasInstance
  // and "prototype".
  class Result {
    constructor(value, done) {
      this.value = value;
      this.done = done;
    }
  }
  class ResultWithProtoDone {
    constructor(value) {
      this.value = value;
    }
  }
  ResultWithProtoDone.prototype.done = false;
  class RangeIterator {
    constructor(n) {
      this.n = n;
      this.i = 0;
    }
    next() {
      if (this.i >= this.n) return new Result(undefined, true);
      return this.i & 1 ? new ResultWithProtoDone(this.i++) : new Result(this.i++, false);
    }
  }
  const range = n => ({ [Symbol.iterator]: () => new RangeIterator(n) });
  function sum(iterable) {
    let total = 0;
    for (const value of iterable) total += value;
    return total;
  }
  for (let round = 0; round < warmUp; ++round) shouldBe(sum(range(10)), 45);
  ResultWithProtoDone.prototype.done = true;
  shouldBe(sum(range(10)), 0, "done from the prototype");
  ResultWithProtoDone.prototype.done = false;
  shouldBe(sum(range(10)), 45);

  const check = (value, constructor) => value instanceof constructor;
  class A {}
  class B extends A {}
  class C {}
  const b = new B();
  for (let round = 0; round < warmUp; ++round) {
    shouldBe(check(b, A), true);
    shouldBe(check(b, B), true);
    shouldBe(check(b, C), false);
  }
  Object.defineProperty(C, Symbol.hasInstance, { value: () => true, configurable: true });
  shouldBe(check(b, C), true, "own Symbol.hasInstance");
  delete C[Symbol.hasInstance];
  shouldBe(check(b, C), false);
}

// --- The length of a string.

{
  const length = makeGetter("length");
  const rope = n => "a".repeat((n % 7) + 1) + n + ("\u4e16".repeat((n % 5) + 1) + n);
  for (let i = 0; i < 100; ++i) {
    const expected = (i % 7) + 1 + ((i % 5) + 1) + 2 * String(i).length;
    const s = rope(i);
    shouldBe(length(s), expected, "rope");
    shouldBe(s.charCodeAt(0), 97);
    shouldBe(length(s), expected, "resolved rope");
  }
  shouldBe(length(""), 0);
  shouldBe(length("h\u00e9llo \u4e16\u754c"), 8);
  shouldBe(length("0123456789".repeat(20).substring(3, 150)), 147);
  shouldBe(length("ab".repeat(1 << 20) + "cd".repeat(1 << 20)), 1 << 22);
  shouldBe(length(Buffer.from("from a buffer").toString()), 13);
}

{
  const length = makeGetter("length");
  const values = [
    ["abc", 3],
    [[1, 2], 2],
    ["", 0],
    [[], 0],
    [[1.5, 2.5, 3.5], 3],
    ["x".repeat(3) + "y".repeat(40), 43],
    [{ length: "own" }, "own"],
    [new String("wrapped"), 7],
    [function (a, b, c) {}, 3],
    [new Uint8Array(9), 9],
    [Buffer.alloc(5), 5],
    [
      (function () {
        return arguments;
      })(1, 2, 3, 4),
      4,
    ],
    [{}, undefined],
    [5, undefined],
    [Symbol(), undefined],
  ];
  for (let round = 0; round < warmUp; ++round)
    for (const [value, expected] of values) shouldBe(length(value), expected, "mixed read, round " + round);
  const array = [1, 2, 3];
  warm(length, array, 3);
  warm(length, "four", 4);
  array.push(4);
  shouldBe(length(array), 4);
  array.length = 0x80000000;
  shouldBe(length(array), 0x80000000);
  shouldBe(length("abc"), 3);
  for (const value of [null, undefined]) {
    let threw = false;
    try {
      length(value);
    } catch (error) {
      threw = error instanceof TypeError;
    }
    shouldBe(threw, true, "length of " + value);
  }
  Object.defineProperty(Object.prototype, "length", { get: () => "object prototype", configurable: true });
  shouldBe(length("abc"), 3);
  shouldBe(length({}), "object prototype");
  delete Object.prototype.length;
}

// --- Writes, and reads that miss on purpose, in functions that run often enough for every tier.

{
  const objects = [];
  for (let i = 0; i < 16; ++i) {
    const o = {};
    for (let j = 0; j < i; ++j) o["pad" + j] = j;
    o.tag = i;
    objects.push(o);
  }
  const readTag = makeGetter("tag");
  const writeTag = new Function("o", "value", "o.tag = value; // " + sources++);
  class WithAccessors {
    #tag = 0;
    get tag() {
      return this.#tag;
    }
    set tag(value) {
      this.#tag = value + 1;
    }
  }
  const withAccessors = new WithAccessors();
  let total = 0;
  for (let i = 0; i < 3000; ++i) {
    const o = objects[i % objects.length];
    writeTag(o, i);
    total += readTag(o);
    writeTag(withAccessors, i);
    total += readTag(withAccessors);
  }
  shouldBe(total, 2 * ((2999 * 3000) / 2) + 3000);
}

console.log("ok");
