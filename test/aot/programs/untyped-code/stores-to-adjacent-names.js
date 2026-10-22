// A class declares its fields and its constructor stores to them in the same order; a function sets an object back to its first state. The names are there already, one behind the other.
// What the objects hold afterwards, whatever has been done to them in between. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const kFlags = Symbol("kFlags");
class State {
  highWaterMark;
  buffer;
  bufferIndex;
  length;
  pipes;
  flags;
  constructor(options) {
    const mark = options ? options.mark : 16;
    this.highWaterMark = mark;
    this.buffer = [];
    this.bufferIndex = 0;
    this.length = 0;
    this.pipes = [];
    this.flags = mark > 16 ? "large" : "small";
  }
}
function reset(object, value) {
  object.first = value;
  object.second = null;
  object[kFlags] = 0;
  object.third = "";
  object.fourth = false;
}
function resetNames(object, value) {
  object.first = value;
  object.second = null;
  object.third = "";
  object.fourth = false;
}
// Two functions are stored under the name: the callee is not known at the call and is not copied into the loop.
const holder = { resetNames: function Unused() {} };
holder.resetNames = resetNames;
function Made() {
  this.zero = 0;
  this.first = 1;
  this.second = 2;
  this.third = 3;
  this.fourth = 4;
  this.last = 5;
}
function describe(object) {
  if (Object(object) !== object) return String(object);
  return Reflect.ownKeys(object).map(key => String(key) + "=" + JSON.stringify(object[key])).join(" ");
}
function fresh() {
  return { zero: 0, first: 1, second: 2, [kFlags]: 3, third: 4, fourth: 5, last: 6 };
}

const said = new Set();
const counts = typeof aotOperationCount === "function";
for (let i = 0; i < 3000; i++) {
  said.add(describe(new State(i & 1 ? { mark: 32 } : null)));
  const object = fresh();
  reset(object, "set");
  said.add(describe(object));
  const literal = { zero: 0, first: 1, second: 2, third: 4, fourth: 5, last: 6 };
  holder.resetNames(literal, "set");
  said.add(describe(literal));
  const made = new Made();
  holder.resetNames(made, i & 1);
  said.add(describe(made));
}
const learnt = count("operationAOTTryPutProperties");
console.log([...said].join("\n"));
console.log(!counts || (learnt >= 1 && learnt <= 300) ? "the stores were learnt together" : "stores to names that lie in a row were learnt " + learnt + " times");

// The same function on objects that only look alike.
const log = [];
function tried(name, object) {
  let thrown = "";
  try {
    reset(object, name);
  } catch (error) {
    thrown = " " + error.constructor.name;
  }
  console.log(name + ": " + describe(object) + thrown + (log.length ? " | " + log.splice(0).join() : ""));
}
tried("another order", { zero: 0, second: 2, first: 1, [kFlags]: 3, third: 4, fourth: 5 });
tried("one is missing", { zero: 0, first: 1, second: 2, third: 4, fourth: 5 });
tried("none is there", {});
tried("something lies between", { first: 1, between: true, second: 2, [kFlags]: 3, third: 4, fourth: 5 });
const withSetter = fresh();
Object.defineProperty(withSetter, "second", { get() { return "got"; }, set(value) { log.push("second was set behind " + this.first + " and ahead of " + this.third); }, enumerable: true, configurable: true });
tried("a setter of its own", withSetter);
const readOnly = fresh();
Object.defineProperty(readOnly, "third", { writable: false });
tried("read-only", readOnly);
tried("frozen", Object.freeze(fresh()));
tried("sealed", Object.seal(fresh()));
tried("not extensible", Object.preventExtensions(fresh()));
const hidden = fresh();
Object.defineProperty(hidden, "fourth", { enumerable: false });
tried("not enumerable", hidden);
console.log(Object.keys(hidden).join());
const deleted = fresh();
delete deleted.second;
deleted.second = "again";
tried("deleted and added again", deleted);
const many = fresh();
for (let i = 0; i < 200; i++) many["more" + i] = i;
for (let i = 0; i < 200; i++) delete many["more" + i];
tried("a dictionary", many);
const parent = fresh();
tried("a prototype", parent);
const child = Object.create(parent);
tried("inherits them", child);
console.log(describe(parent));
const inheritsSetter = Object.create({ set third(value) { log.push("inherited setter " + value); } });
Object.assign(inheritsSetter, { first: 1, second: 2, [kFlags]: 3 });
tried("inherits a setter for one that is missing", inheritsSetter);
const shadows = Object.create({ set third(value) { log.push("never called"); } });
Object.defineProperties(shadows, Object.getOwnPropertyDescriptors(fresh()));
tried("shadows an inherited setter", shadows);
tried("an array", Object.assign([], fresh()));
tried("a function", Object.assign(function () {}, fresh()));
tried("a proxy", new Proxy(fresh(), { set(target, key, value) { log.push("set " + String(key)); target[key] = value; return true; } }));
for (const primitive of [1, "text", true, kFlags]) tried("a primitive", primitive);
for (const nothing of [null, undefined]) {
  try {
    reset(nothing, 1);
  } catch (error) {
    console.log(error.constructor.name);
  }
}

// A field that is defined twice is defined anew; a private name that is there already is refused.
class Returns {
  constructor(object) { return object; }
}
class Stamps extends Returns {
  a = 1;
  b = 2;
  c = 3;
}
class StampsPrivately extends Returns {
  #a = 1;
  #b = 2;
  #c = 3;
  static sum(object) { return object.#a + object.#b + object.#c; }
}
const stamped = {};
for (let i = 0; i < 40; i++) {
  new Stamps(stamped);
  stamped.b = "changed";
}
new Stamps(stamped);
console.log(describe(stamped));
const fixed = Object.defineProperty({ a: 0, b: 0, c: 0 }, "b", { writable: false, configurable: false });
try {
  new Stamps(fixed);
} catch (error) {
  console.log(error.constructor.name, describe(fixed));
}
let refused = 0;
for (let i = 0; i < 40; i++) {
  try {
    new StampsPrivately(stamped);
  } catch (error) {
    refused += error instanceof TypeError;
  }
}
console.log(refused, StampsPrivately.sum(stamped));
