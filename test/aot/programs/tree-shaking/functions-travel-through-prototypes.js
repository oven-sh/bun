// Each function is named once, where it is put on an object that later stands in the prototype chain of another. The call is made on the object at the bottom.
function a() { return "Object.create"; } function b() { return "setPrototypeOf"; } function c() { return "__proto__ in a literal"; } function d() { return "a store into a class's prototype"; }
function e() { return "Object.assign into a prototype"; } function f() { return "two levels up"; } function g() { return "a prototype that is swapped"; } function h() { return "the prototype of a function"; }
function i() { return "read off getPrototypeOf"; } function j() { return "a static inherited by a subclass"; } function k() { return "a store to __proto__"; }

console.log(Object.create({ m: a }).m());
console.log(Object.setPrototypeOf({}, { m: b }).m());
console.log({ __proto__: { m: c } }.m());
class Klass {}
Klass.prototype.m = d;
Object.assign(Klass.prototype, { n: e });
console.log(new Klass().m(), new Klass().n());
console.log(Object.create(Object.create({ m: f })).m());
const swapped = Object.create({ m: () => "before the swap" });
Object.setPrototypeOf(swapped, { m: g });
console.log(swapped.m());
function Old() {}
Old.prototype = { m: h };
console.log(new Old().m());
console.log(Object.getPrototypeOf(Object.create({ m: i })).m());
class Base {}
Base.s = j;
class Derived extends Base {}
console.log(Derived.s());
const stored = {};
stored.__proto__ = { m: k };
console.log(stored.m());
