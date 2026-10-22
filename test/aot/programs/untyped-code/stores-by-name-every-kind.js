// Stores by name (`o.p = v` in strict and in sloppy code) and definitions by name (a class field `p`), each from one site, on every kind of receiver the property caches tell apart; then on receivers where the store must throw, do nothing or call a setter.
function putStrict(o, v) {
  "use strict";
  o.p = v;
}
function putSloppy(o, v) {
  o.p = v;
}
class ReturnsTarget {
  constructor(target) {
    return target;
  }
}
let fieldValue;
class DefinesP extends ReturnsTarget {
  p = fieldValue;
}
function define(o, v) {
  fieldValue = v;
  new DefinesP(o);
}
const ways = [
  ["strict", putStrict],
  ["sloppy", putSloppy],
  ["define", define],
];
const values = [1, -0, 2.5, 2 ** 31, true, "text", { tag: "young" }, undefined, null];
const setterCalls = [];

function show(v) {
  if (Object.is(v, -0)) return "-0";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "function") return "function";
  if (typeof v === "object" && v !== null) return "{" + v.tag + "}";
  return String(v);
}
function attempt(action) {
  try {
    action();
    return "";
  } catch (error) {
    return error.constructor.name + " ";
  }
}
function state(o) {
  const calls = setterCalls.length ? " setter(" + setterCalls.splice(0).map(show).join() + ")" : "";
  const descriptor = Object.getOwnPropertyDescriptor(o, "p");
  if (!descriptor) return "inherits " + show(o.p) + calls;
  const attributes = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
  const keys = Object.keys(o);
  return ("value" in descriptor ? show(descriptor.value) : "accessor") + " " + attributes + " " + keys.indexOf("p") + "/" + keys.length + calls;
}
function run(label, createReceiver) {
  for (const [way, put] of ways) {
    const results = [];
    for (const v of values) {
      const o = createReceiver();
      results.push(attempt(() => put(o, v)) + state(o));
    }
    console.log(label + ", " + way + ": " + results.join(" | "));
  }
}
function plain(count, hasP) {
  const members = [];
  for (let i = 0; i < count; i++) members.push('"k' + i + '":' + i);
  if (hasP) members.push('"p":"old"');
  return JSON.parse("{" + members.join() + "}");
}
function sameInEveryRound(rounds) {
  return new Set(rounds).size === 1 ? rounds[0] : "ROUNDS DIFFER: " + rounds.join(" || ");
}

run("replace inline", () => plain(2, true));
run("replace out of line", () => plain(70, true));
run("replace after a delete", () => {
  const o = plain(5, true);
  delete o.k1;
  return o;
});
run("add after a delete", () => {
  const o = plain(5, false);
  delete o.k1;
  return o;
});

for (const [way, put] of ways) {
  const wrong = [];
  for (let round = 0; round < 4; round++) {
    for (let count = 0; count <= 40; count++) {
      const o = plain(count, false);
      const v = round % 2 ? { tag: count } : count + round;
      put(o, v);
      const keys = Object.keys(o);
      let sum = 0;
      for (let i = 0; i < count; i++) sum += o["k" + i];
      if (o.p !== v || keys.length !== count + 1 || keys[count] !== "p" || sum !== (count * (count - 1)) / 2) wrong.push(round + ":" + count);
    }
  }
  console.log("add after 0 to 40 properties, " + way + ": " + (wrong.length ? "wrong at " + wrong.join() : "all stored"));
}

function putFiveStrict(o) {
  "use strict";
  o.p = 1;
  o.q = 2.5;
  o.r = "three";
  o.s = { tag: 4 };
  o.t = o;
}
function putFiveSloppy(o) {
  o.p = 1;
  o.q = 2.5;
  o.r = "three";
  o.s = { tag: 4 };
  o.t = o;
}
class HasNoP {
  a = 1;
  b = 2;
}
const receiversOfFive = [
  ["plain function", () => function () {}],
  ["arrow function", () => () => {}],
  ["bound function", () => function () {}.bind(null)],
  ["class", () => class {}],
  ["object without a prototype", () => Object.create(null)],
  ["instance", () => new HasNoP()],
];
for (const [label, createReceiver] of receiversOfFive) {
  for (const putFive of [putFiveStrict, putFiveSloppy]) {
    const rounds = [];
    for (let round = 0; round < 4; round++) {
      const o = createReceiver();
      putFive(o);
      rounds.push(Object.keys(o).join() + " " + [o.p, o.q, o.r, o.s].map(show).join() + " " + (o.t === o) + " " + typeof o);
    }
    console.log("five properties, " + label + ", " + putFive.name + ": " + sameInEveryRound(rounds));
  }
}

const setterPrototype = {
  set p(v) {
    setterCalls.push(v);
  },
  get p() {
    return "from the getter";
  },
};
class HasSetter {
  a = 1;
  set p(v) {
    setterCalls.push(v);
  }
}
class InheritsSetter extends HasSetter {
  b = 2;
}
run("own setter", () => ({
  a: 1,
  set p(v) {
    setterCalls.push(v);
  },
}));
run("own setter out of line", () => Object.defineProperty(plain(70, false), "p", { set: v => void setterCalls.push(v), enumerable: true, configurable: true }));
run("inherited setter", () => Object.create(setterPrototype));
run("setter two prototypes up", () => Object.create(Object.create(setterPrototype)));
run("setter of a class", () => new HasSetter());
run("setter of a base class", () => new InheritsSetter());
run("setter that is a bound function", () => Object.defineProperty({}, "p", { set: setterCalls.push.bind(setterCalls), configurable: true }));

function setLengthStrict(a, n) {
  "use strict";
  a.length = n;
}
function setLengthSloppy(a, n) {
  a.length = n;
}
class DefinesLength extends ReturnsTarget {
  length = fieldValue;
}
function defineLength(a, n) {
  fieldValue = n;
  new DefinesLength(a);
}
const arrayKinds = [
  ["integers", i => i],
  ["doubles", i => i + 0.5],
  ["objects", i => ({ tag: i })],
];
const lengths = [97, 99, 100, 20, 21, 5000, 3, 0, 2, 2.5, -1, "4", 2 ** 32, { valueOf: () => 1 }, 1];
function describeArray(a) {
  return a.length + ":" + Object.keys(a).length + ":" + show(a[a.length - 1]) + ":" + show(a[0]);
}
for (const [label, element] of arrayKinds) {
  for (const setLength of [setLengthStrict, setLengthSloppy, defineLength]) {
    const rounds = [];
    for (let round = 0; round < 3; round++) {
      const a = Array.from({ length: 100 }, (_, i) => element(i));
      rounds.push(lengths.map(n => attempt(() => setLength(a, n)) + describeArray(a)).join(" | "));
    }
    console.log("length of an array of " + label + ", " + setLength.name + ": " + sameInEveryRound(rounds));
  }
}
for (const setLength of [setLengthStrict, setLengthSloppy, defineLength]) {
  const results = [];
  for (let round = 0; round < 3; round++) {
    const fixed = Object.defineProperty([1, 2, 3], "length", { writable: false });
    const frozen = Object.freeze([1, 2, 3]);
    for (const a of [fixed, frozen]) for (const n of [1, 3, 5]) results.push(attempt(() => setLength(a, n)) + describeArray(a));
  }
  console.log("length that is read-only, " + setLength.name + ": " + results.join(" | "));
}

class HoldsObject {
  p = { tag: "first" };
  a = 1;
}
class HoldsInteger {
  p = 7;
  a = 1;
}
class HoldsDouble {
  p = 0.5;
  a = 1;
}
class HoldsBoolean {
  p = true;
  a = 1;
}
class HoldsString {
  p = "first";
  a = 1;
}
class HoldsAnything {
  constructor(v) {
    this.a = 1;
    this.p = v;
  }
}
class MayHoldBoolean {
  constructor(hasP) {
    this.a = 1;
    if (hasP) this.p = false;
    this.b = 2;
  }
}
run("field with an object", () => new HoldsObject());
run("field with an integer", () => new HoldsInteger());
run("field with a double", () => new HoldsDouble());
run("field with a boolean", () => new HoldsBoolean());
run("field with a string", () => new HoldsString());
let numberOfInstances = 0;
run("field with anything", () => new HoldsAnything(values[numberOfInstances++ % values.length]));
run("optional field that is present", () => new MayHoldBoolean(true));
run("optional field that is absent", () => new MayHoldBoolean(false));
run("extra property added", () => new HasNoP());
run("extra property replaced", () => {
  const o = new HasNoP();
  o.p = "old";
  return o;
});

run("read-only", () => Object.defineProperty(plain(2, false), "p", { value: "fixed", enumerable: true, configurable: true }));
run("read-only and not configurable", () => Object.defineProperty(plain(2, false), "p", { value: "fixed", enumerable: true }));
run("read-only out of line", () => Object.defineProperty(plain(70, false), "p", { value: "fixed", configurable: true }));
run("inherited read-only", () => Object.create(Object.freeze({ p: "fixed" })));
run("frozen with p", () => Object.freeze(plain(2, true)));
run("frozen without p", () => Object.freeze(plain(2, false)));
run("sealed with p", () => Object.seal(plain(2, true)));
run("getter without setter", () => ({
  get p() {
    return "from the getter";
  },
}));
run("inherited getter without setter", () =>
  Object.create({
    get p() {
      return "from the getter";
    },
  }),
);
run("not extensible without p", () => Object.preventExtensions(plain(2, false)));
run("not extensible with p", () => Object.preventExtensions(plain(2, true)));
run("frozen instance", () => Object.freeze(new HoldsInteger()));
run("instance with a read-only field", () => Object.defineProperty(new HoldsObject(), "p", { writable: false }));
run("instance that is not extensible, field absent", () => Object.preventExtensions(new MayHoldBoolean(false)));
run("instance that is not extensible, no such field", () => Object.preventExtensions(new HasNoP()));
run("proxy", () =>
  new Proxy(
    {},
    {
      set(target, key, v) {
        setterCalls.push(v);
        return typeof v !== "boolean";
      },
      defineProperty(target, key, descriptor) {
        setterCalls.push("defined");
        return Reflect.defineProperty(target, key, descriptor);
      },
    },
  ),
);

class GainsSetter {
  a = 1;
}
const familiesWithPrototype = [
  ["object", { a: 1 }, prototype => Object.create(prototype)],
  ["instance", GainsSetter.prototype, () => new GainsSetter()],
];
for (const [label, prototype, createReceiver] of familiesWithPrototype) {
  for (const [way, put] of ways) {
    const stored = createReceiver(prototype);
    put(stored, "own");
    const storeToThree = step => {
      const results = [];
      for (let i = 0; i < 3; i++) {
        const o = createReceiver(prototype);
        results.push(attempt(() => put(o, i)) + state(o));
      }
      results.push("already own: " + attempt(() => put(stored, step)) + state(stored));
      console.log(label + " whose prototype " + step + ", " + way + ": " + results.join(" | "));
    };
    storeToThree("is as created");
    Object.defineProperty(prototype, "p", { set: v => void setterCalls.push(v), configurable: true });
    storeToThree("gains a setter");
    delete prototype.p;
    storeToThree("loses the setter");
    Object.defineProperty(prototype, "p", { value: "fixed", configurable: true });
    storeToThree("gains a read-only property");
    Object.defineProperty(prototype, "p", { get: () => "from the getter", configurable: true });
    storeToThree("gains a getter without setter");
    delete prototype.p;
    storeToThree("is as created again");
  }
}

for (const [way, put] of ways.slice(0, 2)) {
  const rounds = [];
  for (let round = 0; round < 3; round++) rounds.push([1, 1.5, "text", true, Symbol.iterator, 10n, null, undefined].map(receiver => attempt(() => put(receiver, round)) || "ignored ").join(""));
  console.log("receivers that are not objects, " + way + ": " + sameInEveryRound(rounds));
}

module.exports = {};
