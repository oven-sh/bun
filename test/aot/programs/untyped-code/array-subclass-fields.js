// Public fields of a class that extends Array: each is defined on the new array as on any object: in order, enumerable, writable and
// configurable, past setters and read-only properties of the prototypes; `length` and names that are indexes keep the meaning an array
// gives them; an array that takes no more properties refuses; and the elements stay what they were when the storage grows.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function counted() { return count("operationAOTPutByIdAndCache") > 0; }
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

class Four extends Array { first; second = 2; third = "three"; fourth = null; }
class One extends Array { only = 1; }
class Nine extends Array { a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; h = 8; i = 9; }
class Deeper extends Four { fifth = 5; sixth = this.second + this.length; }
class Twenty extends Nine { j = 10; k = 11; l = 12; m = 13; n = 14; o = 15; p = 16; q = 17; r = 18; s = 19; t = 20; }
for (var Class of [Four, One, Nine, Deeper, Twenty]) {
  attempt(Class.name + " empty", function () { return describe(new Class); });
  attempt(Class.name + " of a length", function () { return describe(new Class(3)); });
  attempt(Class.name + " of integers", function () { return describe(new Class(1, 2, 3)); });
  attempt(Class.name + " of doubles", function () { return describe(new Class(1.5, 2.5)); });
  attempt(Class.name + " of values", function () { return describe(new Class("a", {}, null, undefined)); });
  attempt(Class.name + " from", function () { return describe(Class.from([1, 2, 3, 4, 5, 6, 7, 8, 9])); });
  attempt(Class.name + " of", function () { return describe(Class.of(7)); });
  attempt(Class.name + " mapped", function () { return describe(new Class(1, 2, 3).map(function (x) { return x * 2; })); });
  attempt(Class.name + " keys", function () { var keys = []; for (var key in new Class(1, 2)) keys.push(key); return keys.join(" ") + " | " + JSON.stringify(new Class(1, 2)) + " | " + Array.isArray(new Class) + " " + (new Class instanceof Class); });
  attempt(Class.name + " grows behind", function () { var o = new Class(1, 2); for (var i = 0; i < 40; i++) o.push(i); o.later = "later"; o[100] = "far"; return o.length + " " + o[0] + " " + o[41] + " " + o.later + " " + Object.keys(o).length; });
}

class Sparse extends Array { constructor() { super(); this[5000000] = "far"; } }
class SparseWithFields extends Sparse { a = 1; b = 2; }
attempt("sparse", function () { var o = new SparseWithFields; return o.length + " " + o[5000000] + " " + o.a + o.b + " " + Object.keys(o).join(" "); });
class Holes extends Array { a = 1; b = 2; c = 3; d = 4; e = 5; }
attempt("holes", function () { var o = new Holes(1, 2, 3); delete o[1]; return describe(o); });

class NamedLength extends Array { length = 2; after = "after"; }
attempt("a field named length", function () { return describe(new NamedLength(1, 2, 3, 4)); });
class BadLength extends Array { length = -1; }
attempt("a field named length that is no length", function () { return describe(new BadLength(1)); });
class Indexes extends Array { 0 = "zero"; "1" = "one"; 7 = "seven"; name = "name"; }
attempt("fields that are indexes", function () { return describe(new Indexes("a", "b", "c")); });
var computed = "computed", symbol = Symbol("symbol");
class Computed extends Array { [computed] = 1; [symbol] = 2; ["3"] = 3; ["length"] = 5; }
attempt("computed names", function () { return describe(new Computed); });
class Proto extends Array { __proto__ = "a field"; constructor_ = 1; }
attempt("a field named __proto__", function () { var o = new Proto; return describe(o) + " | " + (Object.getPrototypeOf(o) === Proto.prototype); });

class WithSetters extends Array { set guarded(value) { throw new Error("the setter ran"); } get guarded() { return "from the getter"; } }
class PastSetters extends WithSetters { guarded = "defined"; }
attempt("past a setter of the prototype", function () { return describe(new PastSetters); });
class ReadOnlyAbove extends Array {}
Object.defineProperty(ReadOnlyAbove.prototype, "fixed", { value: "above", writable: false });
class PastReadOnly extends ReadOnlyAbove { fixed = "own"; }
attempt("past a read-only property of the prototype", function () { return describe(new PastReadOnly); });

class Closed extends Array { constructor() { super(); Object.preventExtensions(this); } }
class FieldsOnClosed extends Closed { a = 1; }
attempt("an array that takes no more", function () { return describe(new FieldsOnClosed); });
class Frozen extends Array { constructor() { super(1, 2); Object.freeze(this); } }
class FieldsOnFrozen extends Frozen { a = 1; }
attempt("a frozen array", function () { return describe(new FieldsOnFrozen); });
class Has extends Array { constructor(descriptor) { super(); Object.defineProperty(this, "a", descriptor); } }
class Again extends Has { a = "again"; b = "b"; }
attempt("there already, plain", function () { return describe(new Again({ value: 1, writable: true, enumerable: true, configurable: true })); });
attempt("there already, hidden", function () { return describe(new Again({ value: 1, writable: true, enumerable: false, configurable: true })); });
attempt("there already, read-only", function () { return describe(new Again({ value: 1, writable: false, enumerable: true, configurable: true })); });
attempt("there already, an accessor", function () { return describe(new Again({ get() { return 1; }, configurable: true })); });
attempt("there already, fixed", function () { return describe(new Again({ value: 1, writable: true, enumerable: true, configurable: false })); });
attempt("there already, fixed and read-only", function () { return describe(new Again({ value: 1 })); });

class Returns extends Array { constructor(other) { super(); return other; } }
class FieldsOnReturned extends Returns { a = 1; b = 2; }
attempt("the constructor returns a plain object", function () { return describe(new FieldsOnReturned({ x: 0 })); });
attempt("the constructor returns a plain array", function () { return describe(new FieldsOnReturned([1, 2])); });
attempt("the constructor returns an array literal of doubles", function () { return describe(new FieldsOnReturned([1.5])); });
attempt("the constructor returns a function", function () { return describe(new FieldsOnReturned(function f() {})).replace(/prototype=\S+ /, ""); });
attempt("the constructor returns a proxy", function () { var log = []; var o = new FieldsOnReturned(new Proxy([], { defineProperty(t, key, d) { log.push("define " + String(key) + " " + JSON.stringify(d)); return Reflect.defineProperty(t, key, d); } })); return log.join(" ; ") + " | " + describe(o); });
attempt("the constructor returns a proxy that refuses", function () { return describe(new FieldsOnReturned(new Proxy([], { defineProperty() { return false; } }))); });
attempt("the constructor returns a typed array", function () { return describe(new FieldsOnReturned(new Uint8Array(2))); });
attempt("the constructor returns the prototype of another class", function () { class Other extends Array {} var o = new FieldsOnReturned(Other.prototype); return describe(o).replace(/constructor=\S+ /, "") + " | " + new Other().a; });

// The same literal twice: what is added to one is not seen on the other.
function literal() { return [1, 2, 3]; }
attempt("array literals", function () { var one = new FieldsOnReturned(literal()), two = literal(); one.push(4); return describe(one) + " | " + describe(two); });

// Only the first field of each array, which needs new storage, reaches the runtime.
var made = [];
var visits = count("operationAOTPutByIdAndCache");
for (var i = 0; i < 300; i++) made.push(new Four(i, i + 1));
visits = count("operationAOTPutByIdAndCache") - visits;
console.log(made.length, made[299].second, made[299][1], !counted() || visits === 300);
