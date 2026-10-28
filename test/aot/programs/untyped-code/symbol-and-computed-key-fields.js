// Fields whose names are symbols or computed: `[key] = value` in a class, on instances of every kind of base class. Each is defined in
// order, with the plain attributes; where the storage of the object has to grow, what was there stays; and an object whose storage holds
// more than properties (an array its elements, a typed array its buffer) keeps that too.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function counted() { return count("operationAOTDefineField") > 0; }
function show(value) { return typeof value === "function" ? "function" : typeof value === "symbol" ? String(value) : value === undefined ? "undefined" : JSON.stringify(value); }
function describe(o) {
  var parts = [];
  for (var key of Reflect.ownKeys(o)) {
    var d = Object.getOwnPropertyDescriptor(o, key);
    parts.push(String(key) + "=" + ("value" in d ? show(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""));
  }
  return parts.join(" ");
}
function attempt(label, work) { var answer; try { answer = work(); } catch (error) { answer = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + answer); }
var s = []; for (var i = 0; i < 20; i++) s.push(Symbol("s" + i));
var t = []; for (var i = 0; i < 20; i++) t.push("t" + i);
function withFields(Base, keys, howMany) {
  // One class text for each number of fields, so that each has sites of its own.
  if (howMany === 1) return class extends Base { [keys[0]] = 0; };
  if (howMany === 4) return class extends Base { [keys[0]] = 0; [keys[1]] = 1; [keys[2]] = 2; [keys[3]] = 3; };
  if (howMany === 5) return class extends Base { [keys[0]] = 0; [keys[1]] = 1; [keys[2]] = 2; [keys[3]] = 3; [keys[4]] = 4; };
  if (howMany === 10) return class extends Base { [keys[0]] = 0; [keys[1]] = 1; [keys[2]] = 2; [keys[3]] = 3; [keys[4]] = 4; [keys[5]] = 5; [keys[6]] = 6; [keys[7]] = 7; [keys[8]] = 8; [keys[9]] = 9; };
  return class extends Base { [keys[0]] = 0; [keys[1]] = 1; [keys[2]] = 2; [keys[3]] = 3; [keys[4]] = 4; [keys[5]] = 5; [keys[6]] = 6; [keys[7]] = 7; [keys[8]] = 8; [keys[9]] = 9; [keys[10]] = 10; [keys[11]] = 11; [keys[12]] = 12; [keys[13]] = 13; [keys[14]] = 14; [keys[15]] = 15; [keys[16]] = 16; [keys[17]] = 17; [keys[18]] = 18; [keys[19]] = 19; };
}
class Plain {}
class WithOwn { a = "a"; b = "b"; c = "c"; }
function Old() { this.x = 1; }
var bases = {
  "Object": [Object, function (C) { return new C; }],
  "a class": [Plain, function (C) { return new C; }],
  "a class with fields": [WithOwn, function (C) { return new C; }],
  "a function": [Old, function (C) { return new C; }],
  "Promise": [Promise, function (C) { return new C(function () {}); }],
  "Map": [Map, function (C) { return new C([[1, 2]]); }],
  "Set": [Set, function (C) { return new C([1]); }],
  "Array": [Array, function (C) { return new C(1, 2, 3); }],
  "Uint8Array": [Uint8Array, function (C) { return new C(new ArrayBuffer(4)); }],
  "Uint8Array of a length": [Uint8Array, function (C) { return new C(2); }],
  "RegExp": [RegExp, function (C) { return new C("a", "g"); }],
  "Date": [Date, function (C) { return new C(0); }],
  "Boolean": [Boolean, function (C) { return new C(true); }],
  "String": [String, function (C) { return new C("ab"); }],
  "ArrayBuffer": [ArrayBuffer, function (C) { return new C(8); }],
  "WeakMap": [WeakMap, function (C) { return new C; }],
};
for (var label in bases) {
  for (var keys of [s, t]) {
    for (var howMany of [1, 4, 5, 10, 20]) {
      let C = withFields(bases[label][0], keys, howMany), make = bases[label][1];
      attempt(label + " " + howMany + (keys === s ? " symbols" : " texts"), function () { make(C); make(C); var o = make(C); return describe(o).replace(/prototype=\S+ ?/, ""); });
    }
  }
}
attempt("the elements stay", function () { var C = withFields(Array, s, 20), o = new C(1, 2.5, "three"); o.push(4); return o.join() + " " + o.length + " " + o[s[19]]; });
attempt("the buffer stays", function () { var C = withFields(Uint8Array, s, 20), buffer = new ArrayBuffer(8), o = new C(buffer, 2, 4); o[0] = 7; return (o.buffer === buffer) + " " + o.byteOffset + " " + o.length + " " + new Uint8Array(buffer)[2] + " " + o[s[19]]; });
attempt("the buffer made later stays", function () { var C = withFields(Uint8Array, t, 10), o = new C(4), buffer = o.buffer; var D = withFields(Uint8Array, s, 20), p = new D(4); p[1] = 9; return (o.buffer === buffer) + " " + p.buffer.byteLength + " " + new Uint8Array(p.buffer)[1]; });
attempt("the promise settles", function () { var C = withFields(Promise, s, 10), resolve, o = new C(function (r) { resolve = r; }); resolve(5); return o[s[9]] + " " + (o instanceof Promise); });
attempt("the map holds", function () { var C = withFields(Map, s, 10), o = new C([["k", "v"]]); return o.get("k") + " " + o.size + " " + o[s[4]]; });

class Closed { constructor() { Object.preventExtensions(this); } }
attempt("no more properties", function () { return describe(new (withFields(Closed, s, 1))); });
class Has { constructor() { Object.defineProperty(this, s[1], { value: "fixed" }); } }
attempt("there already and fixed", function () { return describe(new (withFields(Has, s, 4))); });
class HasPlain { constructor() { this[s[1]] = "plain"; } }
attempt("there already and plain", function () { return describe(new (withFields(HasPlain, s, 4))); });
class Guarded { set [s[0]](value) { throw new Error("the setter ran"); } }
attempt("past a setter above", function () { return describe(new (withFields(Guarded, s, 4))); });
attempt("keys that are indexes", function () { return describe(new (withFields(Array, ["0", "5", "length2", 7], 4))(9, 9)); });
attempt("a key named length on an array", function () { return describe(new (withFields(Array, ["length"], 1))(9, 9)); });
attempt("keys that are objects", function () { var asked = []; var key = { toString() { asked.push("asked"); return "made"; } }; var C = withFields(Plain, [key], 1); new C; return describe(new C) + " " + asked.length; });

var Ten = withFields(Promise, s, 10), Twenty = withFields(Plain, t, 20), made = [];
// The table is full of what the classes above left there, and a full set takes a newcomer now and then.
for (var i = 0; i < 60; i++) { new Ten(function () {}); new Twenty; }
var visits = count("operationAOTDefineField");
// Some 1,800 of these 9,000 definitions make or double the storage. The operation is visited where the allocator has nothing at hand.
for (var i = 0; i < 300; i++) { made.push(new Ten(function () {})); made.push(new Twenty); }
console.log(made.length, made[598][s[9]], made[599].t19, !counted() || count("operationAOTDefineField") - visits < 100);
