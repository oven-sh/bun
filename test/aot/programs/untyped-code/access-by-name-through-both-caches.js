// One read site and one store site by name run in loops over receivers with one structure, two, and forty, then over every receiver whose answer must not come from a cache: accessors, proxies, primitives, null, read-only and frozen objects, and objects and prototypes that changed since the last turn. Then the names with a read or a store of their own: length, call, apply, bind, lastIndex, and names that look like numbers. A nullish receiver prints the error's name only: its message differs from plain Bun's.
const lines = [];
const say = (...words) => lines.push(words.join(" "));
const parsed = text => JSON.parse(text);
const rounds = 300;

function show(value) {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (Object.is(value, -0)) return "-0";
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (value !== null && typeof value === "object") return "object";
  return String(value);
}

// Every round must give what the first round gave.
function inRounds(seen, width) {
  const first = seen.slice(0, width).map(show).join(",");
  for (let start = width; start < seen.length; start += width) {
    const round = seen.slice(start, start + width).map(show).join(",");
    if (round !== first) return first + " but in round " + start / width + ": " + round;
  }
  return first + " in " + seen.length / width + " rounds";
}

function attempt(label, action) {
  try {
    say(label, action());
  } catch (error) {
    say(label, error.constructor.name);
  }
}

function readEach(receivers, count) {
  const seen = [];
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < receivers.length; i++) seen.push(receivers[i].x);
  }
  return seen;
}

function readEachInTry(receivers, count) {
  const seen = [];
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < receivers.length; i++) {
      try {
        seen.push(receivers[i].x);
      } catch (error) {
        seen.push(error.constructor.name);
      }
    }
  }
  return seen;
}

function readWhileChanging(receiver, change, count) {
  const seen = [];
  for (let round = 0; round < count; round++) {
    if (round === count >> 1) change(receiver);
    seen.push(receiver.x);
  }
  const last = seen[count - 1];
  return show(seen[0]) + " then " + show(last) + " from round " + seen.indexOf(last);
}

function storeEachStrict(receivers, value, count) {
  "use strict";
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < receivers.length; i++) receivers[i].x = value + round;
  }
}

function storeEachSloppy(receivers, value, count) {
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < receivers.length; i++) receivers[i].x = value + round;
  }
}

function storeEachStrictInTry(receivers, value, count) {
  "use strict";
  const outcomes = [];
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < receivers.length; i++) {
      try {
        receivers[i].x = value;
        outcomes.push("no error");
      } catch (error) {
        outcomes.push(error.constructor.name);
      }
    }
  }
  return outcomes;
}

function storeEachSloppyInTry(receivers, value, count) {
  const outcomes = [];
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < receivers.length; i++) {
      try {
        receivers[i].x = value;
        outcomes.push("no error");
      } catch (error) {
        outcomes.push(error.constructor.name);
      }
    }
  }
  return outcomes;
}

const bothStores = [
  ["strict", storeEachStrict, storeEachStrictInTry],
  ["sloppy", storeEachSloppy, storeEachSloppyInTry],
];

class Point {
  constructor(x) {
    this.x = x;
  }
}

say("== reads");
const oneStructure = () => [parsed('{"x":1}'), parsed('{"x":2}'), parsed('{"x":3}')];
const twoStructures = () => [parsed('{"x":1}'), parsed('{"y":0,"x":2}')];
const fortyStructures = () => Array.from({ length: 40 }, (_, k) => parsed(`{"p${k}":${k},"x":${k * 2}}`));
const outOfLine = () => parsed('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"x":"out of line"}');
say("one structure:", inRounds(readEach(oneStructure(), rounds), 3));
say("two structures:", inRounds(readEach(twoStructures(), rounds), 2));
say("forty structures:", inRounds(readEach(fortyStructures(), rounds), 40));
say("out of line:", inRounds(readEach([outOfLine(), parsed('{"x":"inline"}')], rounds), 2));
say("literals and instances:", inRounds(readEach([{ x: "a" }, { y: 0, x: "b" }, { x: 1.5, z: null }, new Point(7), new Point("seven")], rounds), 5));

const parent = parsed('{"x":"inherited"}');
say("inherited and absent:", inRounds(readEach([Object.create(parent), Object.create(Object.create(parent)), parsed('{"y":1}'), Object.create(null), []], rounds), 5));

let getterCalls = 0;
const getter = {
  get() {
    getterCalls++;
    return "getter sees " + this.a;
  },
  configurable: true,
};
const withGetter = Object.defineProperty(parsed('{"a":"own a"}'), "x", getter);
const inheritsGetter = Object.assign(Object.create(withGetter), { a: "a of the child" });
const literalWithGetter = {
  a: "a of the literal",
  get x() {
    getterCalls++;
    return "getter sees " + this.a;
  },
};
say("getters:", inRounds(readEach([withGetter, inheritsGetter, literalWithGetter], rounds), 3), "calls:", getterCalls);

const traps = [];
const handler = {
  get(target, key, receiver) {
    traps.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    traps.push("set " + String(key));
    return Reflect.set(target, key, value, receiver);
  },
};
const proxy = new Proxy(parsed('{"x":"target"}'), handler);
say("proxy:", inRounds(readEach([proxy, Object.create(proxy)], rounds), 2), "traps:", traps.length, traps[0]);
say("primitives:", inRounds(readEach([5, 1.5, "text", true, 10n, Symbol.iterator], rounds), 6));
attempt("null:", () => readEach([parsed('{"x":1}'), null], 1).length);
attempt("undefined:", () => readEach([parsed('{"x":1}'), undefined], 1).length);

const throwing = Object.defineProperty(parsed("{}"), "x", {
  get() {
    throw new RangeError("from the getter");
  },
});
const everything = [...oneStructure(), null, ...twoStructures(), undefined, withGetter, throwing, proxy, 5, "text", new Point(1), Object.create(parent), ...fortyStructures()];
say("everything in try:", inRounds(readEachInTry(everything, rounds), everything.length));

say("== reads after a change");
const changing = parsed('{"x":"own","y":1}');
say("before delete:", inRounds(readEach([changing], rounds), 1));
delete changing.x;
say("after delete:", inRounds(readEach([changing], rounds), 1));
changing.x = "added again";
say("added again:", inRounds(readEach([changing], rounds), 1));
Object.defineProperty(changing, "x", { get: () => "now a getter", configurable: true });
say("now a getter:", inRounds(readEach([changing], rounds), 1));

const firstParent = parsed('{"x":"first parent"}');
const secondParent = parsed('{"x":"second parent"}');
const child = Object.create(firstParent);
say("first parent:", inRounds(readEach([child], rounds), 1));
Object.setPrototypeOf(child, secondParent);
say("second parent:", inRounds(readEach([child], rounds), 1));
secondParent.x = "another value";
say("another value:", inRounds(readEach([child], rounds), 1));
delete secondParent.x;
say("deleted from the parent:", inRounds(readEach([child], rounds), 1));
secondParent.x = "back on the parent";
say("back on the parent:", inRounds(readEach([child], rounds), 1));
Object.setPrototypeOf(child, null);
say("no parent:", inRounds(readEach([child], rounds), 1));

const grandparent = parsed('{"x":"grandparent"}');
const between = Object.create(grandparent);
const grandchild = Object.create(between);
say("grandparent:", inRounds(readEach([grandchild], rounds), 1));
between.x = "between";
say("between:", inRounds(readEach([grandchild], rounds), 1));
Object.defineProperty(between, "x", { get: () => "getter between", configurable: true });
say("getter between:", inRounds(readEach([grandchild], rounds), 1));
delete between.x;
say("grandparent again:", inRounds(readEach([grandchild], rounds), 1));

say("delete in the loop:", readWhileChanging(parsed('{"x":"own"}'), o => delete o.x, rounds));
say("shadow in the loop:", readWhileChanging(Object.create(parent), o => (o.x = "own now"), rounds));
say("other prototype in the loop:", readWhileChanging(Object.create(firstParent), o => Object.setPrototypeOf(o, parent), rounds));
say("instance in the loop:", readWhileChanging(new Point("field"), o => delete o.x, rounds));
const parentChangedInLoop = parsed('{"y":1}');
say("parent gains the name in the loop:", readWhileChanging(Object.create(parentChangedInLoop), () => (parentChangedInLoop.x = "gained"), rounds));

say("== stores");
for (const [mode, storeEach, storeEachInTry] of bothStores) {
  for (const [label, create] of [["one structure", oneStructure], ["two structures", twoStructures], ["forty structures", fortyStructures]]) {
    const receivers = create();
    storeEach(receivers, 100, rounds);
    say(mode, label + ":", new Set(receivers.map(o => o.x)).size, receivers[0].x, Object.keys(receivers[receivers.length - 1]).join());
  }

  const added = Array.from({ length: rounds }, () => parsed('{"a":1}'));
  storeEach(added, "added", 1);
  say(mode, "added:", new Set(added.map(o => JSON.stringify(o))).size, JSON.stringify(added[0]));
  const addedOutOfLine = Array.from({ length: rounds }, () => parsed('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9}'));
  storeEach(addedOutOfLine, "added", 1);
  say(mode, "added out of line:", new Set(addedOutOfLine.map(o => JSON.stringify(o))).size, Object.keys(addedOutOfLine[0]).join(""), addedOutOfLine[0].x);
  const compiled = [{ x: "a" }, { y: 0 }, new Point(1), {}];
  storeEach(compiled, "stored", rounds);
  say(mode, "literals and instances:", compiled.map(o => JSON.stringify(o)).join(" "));

  const received = [];
  const setter = {
    set(value) {
      received.push(this.a + " got " + value);
    },
    configurable: true,
  };
  const withSetter = Object.defineProperty(parsed('{"a":"owner"}'), "x", setter);
  const inheritsSetter = Object.assign(Object.create(withSetter), { a: "child" });
  storeEach([withSetter, inheritsSetter], "v", rounds);
  say(mode, "setters:", received.length, received[0], "|", received[1], "|", Object.keys(inheritsSetter).join());

  const readOnly = Object.defineProperty(parsed('{"a":1}'), "x", { value: "fixed", writable: false, configurable: true });
  const onlyGetter = Object.defineProperty(parsed('{"a":1}'), "x", { get: () => "computed", configurable: true });
  const rejecting = [
    readOnly,
    Object.create(readOnly),
    onlyGetter,
    Object.freeze(parsed('{"x":"frozen"}')),
    Object.freeze({ x: "frozen literal" }),
    Object.freeze(new Point("frozen instance")),
    Object.preventExtensions(parsed('{"a":1}')),
    Object.seal(parsed('{"x":"sealed"}')),
    5,
    "text",
    Symbol.iterator,
    null,
    undefined,
    parsed('{"x":"writable"}'),
  ];
  say(mode, "rejecting:", inRounds(storeEachInTry(rejecting, "replaced", rounds), rejecting.length));
  say(mode, "afterwards:", inRounds(readEachInTry(rejecting, 1), rejecting.length));

  traps.length = 0;
  const target = parsed('{"x":"target"}');
  storeEach([new Proxy(target, handler)], "through the proxy ", 3);
  say(mode, "proxy:", traps.join(), target.x);

  const storeParent = parsed('{"a":0}');
  const createChildren = () => Array.from({ length: rounds }, () => Object.create(storeParent));
  let children = createChildren();
  storeEach(children, "own", 1);
  say(mode, "children get the name:", children.every(o => Object.hasOwn(o, "x")));
  received.length = 0;
  Object.defineProperty(storeParent, "x", setter);
  children = createChildren();
  storeEach(children, "to the setter", 1);
  say(mode, "the parent has a setter:", children.some(o => Object.hasOwn(o, "x")), received.length);
  Object.defineProperty(storeParent, "x", { value: "fixed", writable: false, configurable: true });
  children = createChildren();
  say(mode, "the parent's is read-only:", inRounds(storeEachInTry(children, "rejected", 1), rounds).slice(0, 12), children.some(o => Object.hasOwn(o, "x")));
  delete storeParent.x;
  children = createChildren();
  storeEach(children, "own again", 1);
  say(mode, "the parent lost the name:", children.every(o => Object.hasOwn(o, "x")));

  const frozenLater = parsed('{"x":"start"}');
  storeEach([frozenLater], "before ", rounds);
  Object.freeze(frozenLater);
  say(mode, "frozen later:", inRounds(storeEachInTry([frozenLater], "after", rounds), 1), frozenLater.x);
}

say("== in and delete");
function hasEach(receivers, count) {
  const seen = [];
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < receivers.length; i++) seen.push("x" in receivers[i]);
  }
  return seen;
}
function deleteEachStrict(receivers) {
  "use strict";
  const outcomes = [];
  for (let i = 0; i < receivers.length; i++) {
    try {
      outcomes.push(delete receivers[i].x);
    } catch (error) {
      outcomes.push(error.constructor.name);
    }
  }
  return outcomes;
}
function deleteEachSloppy(receivers) {
  const outcomes = [];
  for (let i = 0; i < receivers.length; i++) {
    try {
      outcomes.push(delete receivers[i].x);
    } catch (error) {
      outcomes.push(error.constructor.name);
    }
  }
  return outcomes;
}
const deletable = () => [parsed('{"x":1}'), parsed('{"y":1}'), Object.create(parent), { x: 1 }, new Point(1), Object.freeze(parsed('{"x":1}')), Object.defineProperty({}, "x", { value: 1 }), withGetter, [], 5, "text", null, undefined];
say("in:", inRounds(hasEach(deletable().slice(0, 9), rounds), 9));
attempt("in a number:", () => hasEach([5], 1).length);
attempt("in null:", () => hasEach([null], 1).length);
for (const [mode, deleteEach] of [["strict", deleteEachStrict], ["sloppy", deleteEachSloppy]]) {
  const receivers = deletable().filter(o => o !== withGetter);
  say(mode, "delete:", deleteEach(receivers).map(show).join(","));
  say(mode, "in afterwards:", hasEach(receivers.slice(0, 8), 1).join(","));
}

say("== length");
function lengthOfEach(values, count) {
  const seen = [];
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < values.length; i++) seen.push(values[i].length);
  }
  return seen;
}
function setLengthOfEachStrict(values, length) {
  "use strict";
  const outcomes = [];
  for (let i = 0; i < values.length; i++) {
    try {
      values[i].length = length;
      outcomes.push(show(values[i].length));
    } catch (error) {
      outcomes.push(error.constructor.name);
    }
  }
  return outcomes;
}
function setLengthOfEachSloppy(values, length) {
  const outcomes = [];
  for (let i = 0; i < values.length; i++) {
    try {
      values[i].length = length;
      outcomes.push(show(values[i].length));
    } catch (error) {
      outcomes.push(error.constructor.name);
    }
  }
  return outcomes;
}
function argumentsOf() {
  return arguments;
}
const withLength = () => [
  [],
  [1, 2, 3],
  new Array(5),
  [1.5, 2.5],
  "",
  "text",
  "\u{1F600}",
  "rope".repeat(3) + lines.length,
  function (a, b) {},
  () => {},
  class {
    constructor(a) {}
  },
  function (a, b, c) {}.bind(null, 1),
  { length: "own" },
  parsed('{"length":-1}'),
  {},
  new Uint8Array(4),
  new Float64Array(2),
  argumentsOf(1, 2),
  Object.create([1, 2]),
  new (class extends Array {})(3),
  5,
  true,
];
say("length:", inRounds(lengthOfEach(withLength(), rounds), withLength().length));
attempt("length of null:", () => lengthOfEach([null], 1).length);
say("strict length = 1:", setLengthOfEachStrict(withLength(), 1).join(","));
say("sloppy length = 1:", setLengthOfEachSloppy(withLength(), 1).join(","));
say("strict length = -1:", setLengthOfEachStrict([[1, 2], { length: 0 }], -1).join(","));

say("== call, apply, bind");
function nameOfMethod(method) {
  if (method === Function.prototype.call) return "call";
  if (method === Function.prototype.apply) return "apply";
  if (method === Function.prototype.bind) return "bind";
  return show(method);
}
function methodsOfEach(values, count) {
  const seen = [];
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      seen.push(nameOfMethod(value.call) + "/" + nameOfMethod(value.apply) + "/" + nameOfMethod(value.bind));
    }
  }
  return seen;
}
function returnsThis(suffix) {
  return String(this) + suffix;
}
const withMethods = [
  returnsThis,
  () => {},
  class {},
  async function () {},
  function* () {},
  Math.max,
  returnsThis.bind("bound"),
  { call: 1, apply: "own", bind: null },
  parsed('{"call":2}'),
  Object.assign(function () {}, { call: "replaced" }),
  Object.setPrototypeOf(function () {}, null),
  Object.setPrototypeOf(function () {}, { call: "another prototype" }),
  new Proxy(function () {}, {}),
  {},
  5,
  "text",
];
say("methods:", inRounds(methodsOfEach(withMethods, rounds), withMethods.length));
attempt("call of undefined:", () => methodsOfEach([undefined], 1).length);
const readCall = returnsThis.call;
const readApply = returnsThis.apply;
const readBind = returnsThis.bind;
say("called:", Reflect.apply(readCall, returnsThis, ["a", "!"]), Reflect.apply(readApply, returnsThis, ["b", ["?"]]), Reflect.apply(readBind, returnsThis, ["c", "."])());

say("== lastIndex");
function lastIndexOfEach(values, count) {
  const seen = [];
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < values.length; i++) seen.push(values[i].lastIndex);
  }
  return seen;
}
function setLastIndexOfEachStrict(values, index) {
  "use strict";
  const outcomes = [];
  for (let i = 0; i < values.length; i++) {
    try {
      values[i].lastIndex = index;
      outcomes.push(show(values[i].lastIndex));
    } catch (error) {
      outcomes.push(error.constructor.name);
    }
  }
  return outcomes;
}
function setLastIndexOfEachSloppy(values, index) {
  const outcomes = [];
  for (let i = 0; i < values.length; i++) {
    try {
      values[i].lastIndex = index;
      outcomes.push(show(values[i].lastIndex));
    } catch (error) {
      outcomes.push(error.constructor.name);
    }
  }
  return outcomes;
}
const advanced = /a/g;
advanced.exec("aaa");
const withLastIndex = () => [/a/g, /a/y, new RegExp("b"), new (class extends RegExp {})("c", "g"), Object.freeze(/d/g), Object.create(/e/g), { lastIndex: "own" }, parsed('{"lastIndex":null}'), {}, 5, "text"];
say("lastIndex:", inRounds(lastIndexOfEach([advanced, ...withLastIndex()], rounds), withLastIndex().length + 1));
attempt("lastIndex of null:", () => lastIndexOfEach([null], 1).length);
say("strict lastIndex = 2:", setLastIndexOfEachStrict(withLastIndex(), 2).join(","));
say("sloppy lastIndex = 2:", setLastIndexOfEachSloppy(withLastIndex(), 2).join(","));
say("lastIndex = an object:", setLastIndexOfEachStrict([/a/g], { valueOf: () => 1 }).join(","));
const resumed = /a/g;
setLastIndexOfEachStrict([resumed], 2);
say("exec from lastIndex:", resumed.exec("aaaa").index, resumed.lastIndex);

say("== names that look like numbers");
function readNumericNames(values, count) {
  const seen = [];
  for (let round = 0; round < count; round++) {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      seen.push(show(value["0"]) + "/" + show(value["1.5"]) + "/" + show(value["-0"]));
    }
  }
  return seen;
}
function storeNumericNames(values) {
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    value["0"] = "zero";
    value["1.5"] = "fraction";
    value["-0"] = "negative zero";
  }
}
function hasNumericNames(values) {
  const seen = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    seen.push(("0" in value) + "/" + ("1.5" in value) + "/" + ("-0" in value));
  }
  return seen;
}
function deleteNumericNames(values) {
  const seen = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    seen.push(delete value["0"] + "/" + delete value["1.5"] + "/" + delete value["-0"]);
  }
  return seen;
}
const withNumericNames = [
  ["a", "b"],
  [],
  new Uint8Array([7, 8]),
  new Float64Array(2),
  { 0: "own 0", 1.5: "own 1.5", "-0": "own -0" },
  parsed('{"0":"parsed 0","1.5":"parsed 1.5","-0":"parsed -0"}'),
  {},
  argumentsOf("argument"),
  new String("text"),
  Object.create(["inherited"]),
];
say("read:", inRounds(readNumericNames([...withNumericNames, "text", 5], rounds), withNumericNames.length + 2));
say("in:", hasNumericNames(withNumericNames).join(" "));
storeNumericNames([...withNumericNames, "text", 5]);
say("stored:", readNumericNames(withNumericNames, 1).join(" "));
say("keys:", withNumericNames.map(value => Object.keys(value).join()).join(" "));
say("deleted:", deleteNumericNames(withNumericNames).join(" "));
say("afterwards:", readNumericNames(withNumericNames, 1).join(" "));

console.log(lines.join("\n"));

module.exports = {};
