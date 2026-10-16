// Functions made at run time read properties that are not there, over and over, while the objects and their prototype chains change under them.
const lines = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const readers = Object.create(null);
const reader = name => (readers[name] ??= new Function("value", "return value." + name + ";"));
const numeric = new Function("value", "return value['0.5'];"), negativeZero = new Function("value", "return value['-0'];");
const defaults = new Function("{ first = 'one', second, third = second } = {}", "return first + ' ' + second + ' ' + third;");
const show = value => (typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const say = (label, run) => {
  const seen = [];
  for (let turn = 0; turn < 6; turn++) {
    try {
      seen.push(show(run()));
    } catch (error) {
      seen.push("throws " + error.constructor.name);
    }
  }
  lines.push(label + ": " + seen.join(" "));
};

say("an empty object", () => reader("absent")({}));
say("defaults", () => defaults());
say("defaults of an empty object", () => defaults({}));
say("defaults given", () => defaults({ second: 2 }));

const plain = { a: 1 };
say("before it is added", () => reader("later")(plain));
plain.later = "added";
say("after it is added", () => reader("later")(plain));
delete plain.later;
say("after it is deleted", () => reader("later")(plain));

const root = {}, make = () => Object.create(root);
say("before the root has it", () => reader("onTheRoot")(make()));
root.onTheRoot = "inherited";
say("while it has it", () => reader("onTheRoot")(make()));
delete root.onTheRoot;
say("after it lost it", () => reader("onTheRoot")(make()));
Object.defineProperty(root, "onTheRoot", { get() { return "got by " + typeof this; }, configurable: true });
say("while it has a getter", () => reader("onTheRoot")(make()));
delete root.onTheRoot;
say("after the getter went", () => reader("onTheRoot")(make()));

class Base {}
class Derived extends Base {}
const instance = new Derived();
say("an instance", () => reader("method")(instance));
Base.prototype.method = "of the base";
say("the base class has it", () => reader("method")(instance));
Derived.prototype.method = "of the derived";
say("the derived class has it", () => reader("method")(instance));
delete Derived.prototype.method;
delete Base.prototype.method;
say("neither has it", () => reader("method")(instance));
Object.setPrototypeOf(Derived.prototype, { method: "of a new parent" });
say("the chain is another", () => reader("method")(instance));
Object.setPrototypeOf(instance, null);
say("no chain at all", () => reader("method")(instance));

const bare = Object.create(null);
say("no prototype", () => reader("toString")(bare));
const behindProxy = Object.create(new Proxy({}, { get: (target, key) => "trapped " + String(key), has: () => true }));
say("a proxy in the chain", () => reader("anything")(behindProxy));
let traps = 0;
const counting = Object.create(new Proxy({}, { get() { traps++; return undefined; } }));
say("a proxy that answers undefined", () => reader("counted")(counting));
lines.push("traps " + traps);
say("a proxy itself", () => reader("absent")(new Proxy({}, {})));

say("a string", () => reader("absent")("text"));
say("a number", () => reader("absent")(5));
say("a boolean", () => reader("absent")(true));
say("a symbol", () => reader("absent")(Symbol.iterator));
say("a bigint", () => reader("absent")(5n));
say("undefined", () => reader("absent")(undefined));
say("null", () => reader("absent")(null));

say("an array", () => reader("absent")([1, 2]));
say("a function", () => reader("absent")(() => 1));
say("arguments", () => reader("absent")((function () { return arguments; })(1)));
say("a typed array", () => reader("absent")(new Uint8Array(2)));
say("a typed array and a number as a name", () => numeric(new Uint8Array(2)));
class Bytes extends Uint8Array {}
Bytes.prototype["0.5"] = "half";
Bytes.prototype["-0"] = "negative zero";
Bytes.prototype.named = "a name";
say("a typed array stops the search for a number", () => numeric(new Bytes(2)) + " " + negativeZero(new Bytes(2)) + " " + reader("named")(new Bytes(2)));
say("an object does not", () => numeric(Object.create(Bytes.prototype)) + " " + negativeZero(Object.create(Bytes.prototype)));
say("a map", () => reader("absent")(new Map()));
say("a regular expression", () => reader("absent")(/x/));
say("a date", () => reader("absent")(new Date(0)));
say("the global object", () => reader("absentFromTheGlobalObject")(globalThis));
globalThis.absentFromTheGlobalObject = "now a global";
say("the global object has it", () => reader("absentFromTheGlobalObject")(globalThis));
delete globalThis.absentFromTheGlobalObject;
say("the global object lost it", () => reader("absentFromTheGlobalObject")(globalThis));

const dictionary = {};
for (let i = 0; i < 200; i++) dictionary["key" + i] = i;
for (let i = 0; i < 200; i += 2) delete dictionary["key" + i];
say("a dictionary", () => reader("key2")(dictionary) + " " + reader("key3")(dictionary));
dictionary.key2 = "back";
say("a dictionary gets it back", () => reader("key2")(dictionary));
const dictionaryParent = {};
for (let i = 0; i < 200; i++) dictionaryParent["key" + i] = i;
for (let i = 0; i < 200; i++) delete dictionaryParent["key" + i];
const child = Object.create(dictionaryParent);
say("a dictionary in the chain", () => reader("inParent")(child));
dictionaryParent.inParent = "found";
say("it gets the name", () => reader("inParent")(child));
delete dictionaryParent.inParent;
say("it loses the name", () => reader("inParent")(child));

const shapes = [{}, { a: 1 }, { b: 2 }, { a: 1, b: 2 }, { wanted: "here" }, Object.create({ wanted: "inherited" }), [], () => 1, "s"];
for (let round = 0; round < 4; round++) lines.push("many shapes: " + shapes.map(shape => show(reader("wanted")(shape))).join(" "));

let total = 0;
for (let turn = 0; turn < 40000; turn++) {
  const value = turn % 100 === 99 ? { seldom: turn } : make();
  const seen = reader("seldom")(value);
  total += seen === undefined ? 1 : seen;
  if (turn === 20000) {
    collect();
    root.seldom = 1000000;
  }
  if (turn === 20010) delete root.seldom;
}
lines.push("total " + total);
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 50; i++) {
    const once = new Function("value", "return value.absent" + i + ";");
    const shape = { ["own" + i + "x" + round]: 1 };
    for (let turn = 0; turn < 5; turn++) total += once(shape) === undefined ? 1 : 0;
  }
  collect();
}
lines.push("total " + total);
console.log(lines.join("\n"));
