// One untyped function, read(o) { return o.p }, meets every kind of holder a read by name can find: own and inherited data in line and out of line, absent names, getters,
// each field representation of a class instance, extra properties, a module namespace, a host object, primitives and proxies. Three more functions read length, status and
// constructor. After each round every holder changes (a store, a delete, another prototype, another getter), and the next round must print the new values.
import * as self from "./reads-by-name-every-kind.js";

function read(o) { return o.p; }
function readLength(o) { return o.length; }
function readStatus(o) { return o.status; }
function readConstructor(o) { return o.constructor; }

function describeError(error) { return "throws " + error.constructor.name; }
function tryRead(o) { try { return read(o); } catch (error) { return describeError(error); } }
function tryReadLength(o) { try { return readLength(o); } catch (error) { return describeError(error); } }
function tryReadStatus(o) { try { return readStatus(o); } catch (error) { return describeError(error); } }
function tryReadConstructor(o) { try { return readConstructor(o); } catch (error) { return describeError(error); } }

function show(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return Object.is(value, -0) ? "-0" : String(value);
}

const lines = [];
lines.push("module namespace before initialization: " + show(tryRead(self)));
export let p = "export";

const pCases = [], lengthCases = [], statusCases = [], constructorCases = [];
function createCase(name, receiver, changes) { return { name, receiver, changes, seen: undefined, isStable: true }; }
function pCase(name, receiver, ...changes) { pCases.push(createCase(name, receiver, changes)); }
function lengthCase(name, receiver, ...changes) { lengthCases.push(createCase("length of " + name, receiver, changes)); }
function statusCase(name, receiver, ...changes) { statusCases.push(createCase("status of " + name, receiver, changes)); }
function constructorCase(name, receiver, ...changes) { constructorCases.push(createCase("constructor of " + name, receiver, changes)); }

// Ordinary objects come from JSON.parse, so that no allocation site in this file gives them a layout.
function parsed(fillers, value) {
  const parts = [];
  for (let i = 0; i < fillers; i++) parts.push('"filler' + i + '":' + i);
  if (value !== undefined) parts.push('"p":' + JSON.stringify(value));
  return JSON.parse("{" + parts.join(",") + "}");
}

// Own data.
const ownInline = parsed(0, "own inline");
pCase("own inline", ownInline, () => { ownInline.p = "own inline, stored"; }, () => { delete ownInline.p; });
const ownInLiteral = { p: "own in a literal" };
pCase("own in a literal", ownInLiteral, () => { ownInLiteral.p = 17; }, () => { delete ownInLiteral.p; });
const ownOutOfLine = parsed(20, "own out of line");
pCase("own out of line", ownOutOfLine, () => { ownOutOfLine.p = "own out of line, stored"; }, () => { delete ownOutOfLine.p; });
const ownAmongSeventy = parsed(70, "own among 70");
pCase("own among 70", ownAmongSeventy, () => { delete ownAmongSeventy.filler3; ownAmongSeventy.p = "own among 69"; }, () => { delete ownAmongSeventy.p; });

// Inherited data.
const inlineHolder = parsed(0, "inherited inline");
const inheritsInline = Object.create(inlineHolder);
pCase("inherited inline", inheritsInline, () => { inlineHolder.p = "inherited inline, stored"; }, () => { Object.setPrototypeOf(inheritsInline, parsed(0, "from another prototype")); });
const outOfLineHolder = parsed(20, "inherited out of line");
pCase("inherited out of line", Object.create(outOfLineHolder), () => { delete outOfLineHolder.p; }, () => { outOfLineHolder.p = "added to the prototype again"; });
const farHolder = parsed(140, "inherited far out of line");
const inheritsFar = Object.create(farHolder);
pCase("inherited far out of line", inheritsFar, () => { farHolder.p = "inherited far out of line, stored"; }, () => { Object.defineProperty(inheritsFar, "p", { value: "an own value hides it", configurable: true }); });
const topHolder = parsed(0, "two levels up");
const middleHolder = Object.create(topHolder);
pCase("inherited from two levels up", Object.create(middleHolder), () => { middleHolder.p = "one level up"; }, () => { delete middleHolder.p; });

// Absent names.
const holderWithoutName = parsed(2);
pCase("absent", Object.create(holderWithoutName), () => { holderWithoutName.p = "the prototype has it now"; }, () => { delete holderWithoutName.p; });
const withoutPrototype = Object.create(null);
pCase("absent without a prototype", withoutPrototype, () => { withoutPrototype.p = "own now"; }, () => { delete withoutPrototype.p; });

// Getters.
let getterCalls = 0;
const ownGetter = { tag: "own", get p() { getterCalls++; return "getter of " + this.tag; } };
pCase("own getter", ownGetter,
  () => { Object.defineProperty(ownGetter, "p", { get() { getterCalls++; return "second getter of " + this.tag; } }); },
  () => { Object.defineProperty(ownGetter, "p", { value: "a value now" }); });
const definedGetter = Object.defineProperty(parsed(1), "p", { get() { getterCalls++; return "defined getter"; }, configurable: true });
pCase("own getter, defined later", definedGetter, () => { delete definedGetter.p; }, () => { definedGetter.p = "a value now"; });
const getterHolder = { get p() { getterCalls++; return "inherited getter of " + this.tag; } };
const inheritsGetter = Object.create(getterHolder);
inheritsGetter.tag = "the receiver";
pCase("inherited getter", inheritsGetter,
  () => { Object.defineProperty(getterHolder, "p", { get() { getterCalls++; return "second inherited getter of " + this.tag; } }); },
  () => { delete getterHolder.p; });
const setterOnly = { set p(value) {} };
pCase("setter without a getter", setterOnly, () => { Object.defineProperty(setterOnly, "p", { get() { getterCalls++; return "a getter joined the setter"; } }); }, () => { delete setterOnly.p; });
class HasGetter { tag = "the instance"; get p() { getterCalls++; return "class getter of " + this.tag; } }
const hasGetter = new HasGetter();
pCase("class getter", hasGetter,
  () => { Object.defineProperty(HasGetter.prototype, "p", { get() { getterCalls++; return "second class getter of " + this.tag; }, configurable: true }); },
  () => { Object.defineProperty(hasGetter, "p", { value: "an own value hides it", configurable: true }); });
const throwingGetter = { get p() { getterCalls++; throw new RangeError("from the getter"); } };
pCase("getter that throws", throwingGetter, () => { Object.defineProperty(throwingGetter, "p", { get() { getterCalls++; return "no longer throws"; } }); });

// Fields of class instances. Every store to one of these fields keeps to the kind of value its class starts with, and names its receiver directly.
function fieldCase(name, instance, ...changes) {
  pCase(name, instance, ...changes);
  pCase(name + ", with the instance as the prototype", Object.create(instance));
}
const firstObject = { tag: 1 }, secondObject = { tag: 2 };
class ObjectField { p = firstObject; }
const objectField = new ObjectField();
fieldCase("object field", objectField, () => { objectField.p = secondObject; }, () => { objectField.p = null; });
class StringField { p = "first"; }
const stringField = new StringField();
fieldCase("string field", stringField, () => { stringField.p = "second"; }, () => { stringField.p = ""; });
class IntegerField { p = 7; }
const integerField = new IntegerField();
fieldCase("integer field", integerField, () => { integerField.p = -7; }, () => { integerField.p = 2147483647; });
class SmallestIntegerField { constructor(value) { this.p = value; } }
const smallestIntegers = new SmallestIntegerField(-2147483648), nextSmallestIntegers = new SmallestIntegerField(-2147483645);
fieldCase("smallest integers", smallestIntegers, () => { smallestIntegers.p = -2147483647; }, () => { smallestIntegers.p = -2147483646; });
fieldCase("next smallest integers", nextSmallestIntegers, () => { nextSmallestIntegers.p = -2147483644; }, () => { nextSmallestIntegers.p = -2147483643; });
class DoubleField { p = 1.5; }
const doubleField = new DoubleField();
fieldCase("double field", doubleField, () => { doubleField.p = -0; }, () => { doubleField.p = NaN; });
class WideNumberField { p = 2 ** 31; }
const wideNumberField = new WideNumberField();
fieldCase("integer or double field", wideNumberField, () => { wideNumberField.p = 5; }, () => { wideNumberField.p = -(2 ** 31) - 1; });
class OptionalNumberField { p = undefined; }
const optionalNumberField = new OptionalNumberField();
fieldCase("optional number field", optionalNumberField, () => { optionalNumberField.p = 3; }, () => { optionalNumberField.p = null; });
class BooleanField { p = true; }
const booleanField = new BooleanField();
fieldCase("boolean field", booleanField, () => { booleanField.p = false; }, () => { booleanField.p = true; });
class OptionalBooleanField { p = undefined; }
const optionalBooleanField = new OptionalBooleanField(), otherOptionalBooleanField = new OptionalBooleanField();
fieldCase("optional boolean field", optionalBooleanField, () => { optionalBooleanField.p = true; }, () => { optionalBooleanField.p = false; });
fieldCase("other optional boolean field", otherOptionalBooleanField, () => { otherOptionalBooleanField.p = null; }, () => { otherOptionalBooleanField.p = undefined; });
class MixedField { p = 1; }
const mixedField = new MixedField();
fieldCase("mixed field", mixedField, () => { mixedField.p = "text"; }, () => { mixedField.p = firstObject; });
class ClosureField { tag = "closure"; p = () => this.tag; }
const closureField = new ClosureField();
fieldCase("closure field", closureField, () => { closureField.tag = "closure, renamed"; });
class BaseField { p = "field of the base class"; }
class DerivedField extends BaseField { q = 1; }
const derivedField = new DerivedField();
fieldCase("field of a base class", derivedField, () => { derivedField.p = "field of the base class, stored"; });

// Fields whose objects stop being what their class created.
class DeletedField { p = 1; }
const deletedField = new DeletedField();
pCase("field, then deleted", deletedField, () => { delete deletedField.p; }, () => { Object.setPrototypeOf(deletedField, { p: "from a new prototype" }); });
class RedefinedField { p = 1; tag = "the instance"; }
const redefinedField = new RedefinedField();
pCase("field, then a getter", redefinedField,
  () => { Object.defineProperty(redefinedField, "p", { get() { getterCalls++; return "getter of " + this.tag; }, configurable: true }); },
  () => { Object.defineProperty(redefinedField, "p", { value: 2.5, writable: true }); });
class HasPrototypeValue {}
HasPrototypeValue.prototype.p = "on the class prototype";
pCase("value on a class prototype", new HasPrototypeValue(), () => { HasPrototypeValue.prototype.p = "on the class prototype, stored"; }, () => { delete HasPrototypeValue.prototype.p; });

// Properties beyond the fields of the class.
function storeByKey(o, key, value) { o[key] = value; }
class NoSuchField { q = 1; }
const extraProperty = new NoSuchField();
storeByKey(extraProperty, "p", "extra property");
pCase("extra property", extraProperty, () => { storeByKey(extraProperty, "p", "extra property, stored"); }, () => { delete extraProperty.p; });
const manyExtraProperties = new NoSuchField();
for (let i = 0; i < 12; i++) storeByKey(manyExtraProperties, "extra" + i, i);
storeByKey(manyExtraProperties, "p", "thirteenth extra property");
pCase("extra property among many", manyExtraProperties, () => { storeByKey(manyExtraProperties, "p", "thirteenth extra property, stored"); }, () => { delete manyExtraProperties.p; });
const extraGetter = new NoSuchField();
Object.defineProperty(extraGetter, "p", { get() { getterCalls++; return "extra getter, q is " + this.q; }, configurable: true });
pCase("extra getter", extraGetter, () => { extraGetter.q = 2; }, () => { Object.defineProperty(extraGetter, "p", { value: "a value now" }); });
const otherExtraProperty = new NoSuchField();
storeByKey(otherExtraProperty, "other", 1);
pCase("extra properties without the name", otherExtraProperty, () => { storeByKey(otherExtraProperty, "p", "added"); }, () => { delete otherExtraProperty.p; });

// The namespace of this module.
pCase("module namespace", self, () => { p = "export, stored"; }, () => { p = 42; });
pCase("module namespace as the prototype", Object.create(self));

// Functions, arrays and classes as receivers.
function callee() {}
callee.p = "on a function";
pCase("function", callee, () => { callee.p = "on a function, stored"; }, () => { delete callee.p; });
const list = [1, 2, 3];
list.p = "on an array";
pCase("array", list, () => { list.p = "on an array, stored"; }, () => { delete list.p; });
class HasStatic { static p = "static"; }
class InheritsStatic extends HasStatic {}
pCase("class with a static", HasStatic, () => { HasStatic.p = "static, stored"; }, () => { delete HasStatic.p; });
pCase("class that inherits a static", InheritsStatic);

// A host object and its native getter. The jsc shell has no Response: an object with a getter stands in and prints the same.
function respond(status) { return typeof Response === "function" ? new Response("body", { status }) : { get status() { return status; } }; }
const created = respond(201);
pCase("host object", created, () => { created.p = "own on a host object"; }, () => { delete created.p; });
statusCase("a response", created, c => { c.receiver = respond(404); }, c => { c.receiver = { status: "plain" }; });
const plainStatus = parsed(3);
plainStatus.status = "plain from the start";
statusCase("a plain object", plainStatus, c => { c.receiver = respond(500); }, () => {});
statusCase("a number", 5);

// Primitives. Their prototypes are locked, so nothing about them can change.
for (const primitive of ["text", "", 1, 1.5, true, false, Symbol("s"), 10n]) {
  pCase("primitive " + show(primitive), primitive);
  constructorCase(show(primitive), primitive);
}
pCase("null", null);
pCase("undefined", undefined);
const ownConstructor = parsed(0);
constructorCase("a plain object", ownConstructor, () => { ownConstructor.constructor = IntegerField; }, () => { delete ownConstructor.constructor; });
constructorCase("a class instance", integerField);
constructorCase("an object without a prototype", withoutPrototype);
constructorCase("null", null);

// Proxies.
const handler = { get(target, key) { return "trap for " + String(key); } };
pCase("proxy with a get trap", new Proxy({ p: "target" }, handler), () => { handler.get = (target, key) => "second trap for " + String(key); }, () => { delete handler.get; });
const target = { p: "target of a proxy without traps" };
pCase("proxy without traps", new Proxy(target, {}), () => { target.p = "target, stored"; }, () => { delete target.p; });
const revocable = Proxy.revocable({ p: "not revoked" }, {});
pCase("revocable proxy", revocable.proxy, () => { revocable.revoke(); });
const inheritsProxy = Object.create(new Proxy({}, { get(target, key, receiver) { return receiver === inheritsProxy ? "the trap gets the receiver" : "the trap gets another receiver"; } }));
pCase("proxy as the prototype", inheritsProxy, () => { inheritsProxy.p = "an own value hides the trap"; }, () => { delete inheritsProxy.p; });

// length.
const grown = [1, 2, 3];
lengthCase("an array", grown, () => { grown.push(4, 5); }, () => { grown.length = 0; });
lengthCase("an array of doubles", [0.5, 1.5]);
lengthCase("an array subclass", new (class extends Array {})(7));
lengthCase("a string", "four");
lengthCase("a typed array", new Uint8Array(5));
lengthCase("a function", function (a, b) {});
lengthCase("an arguments object", (function () { return arguments; })(1, 2, 3, 4));
const ownLength = parsed(0);
ownLength.length = "own";
lengthCase("a plain object", ownLength, () => { ownLength.length = 9; }, () => { delete ownLength.length; });
class HasLength { length = 6; }
const hasLength = new HasLength();
lengthCase("a class instance", hasLength, () => { hasLength.length = 8; });
lengthCase("a number", 5);
lengthCase("undefined", undefined);

function observe(c, value, turn) {
  if (turn && !Object.is(value, c.seen)) c.isStable = false;
  c.seen = value;
}

const allCases = [...pCases, ...lengthCases, ...statusCases, ...constructorCases];
for (let round = 0; round < 3; round++) {
  getterCalls = 0;
  for (const c of allCases) c.isStable = true;
  for (let turn = 0; turn < 50; turn++) {
    for (const c of pCases) observe(c, tryRead(c.receiver), turn);
    for (const c of lengthCases) observe(c, tryReadLength(c.receiver), turn);
    for (const c of statusCases) observe(c, tryReadStatus(c.receiver), turn);
    for (const c of constructorCases) observe(c, tryReadConstructor(c.receiver), turn);
  }
  for (const c of allCases) lines.push("round " + round + ", " + c.name + ": " + show(c.seen) + (c.isStable ? "" : " (changed within the round)"));
  lines.push("round " + round + ", getter calls: " + getterCalls);
  lines.push("round " + round + ", closure field called: " + read(closureField)());
  for (const c of allCases) if (round < c.changes.length) c.changes[round](c);
}
console.log(lines.join("\n"));
