// Two constructors, alike line for line, each called on `this` by an heir. Each stores to nine names in a row, and the heir's objects inherit a setter for the fifth. Of the first the text says which name has a setter; of the second it does not.
// What the objects have, and that the four stores on either side of the setter are learnt together where the name is known. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const counts = typeof aotOperationCount === "function";
const count = counts ? aotOperationCount : () => 0;
let calls = 0;
function Known(value) {
  this.a = value;
  this.b = 1;
  this.c = null;
  this.d = "";
  this.guarded = value;
  this.e = false;
  this.f = 2;
  this.g = undefined;
  this.h = value;
}
function Unknown(value) {
  this.a = value;
  this.b = 1;
  this.c = null;
  this.d = "";
  this.veiled = value;
  this.e = false;
  this.f = 2;
  this.g = undefined;
  this.h = value;
}
const library = { Known: function Unused() {}, Unknown: function Unused() {} };
library.Known = Known;
library.Unknown = Unknown;
function HeirOfKnown(value) { library.Known.call(this, value); }
function HeirOfUnknown(value) { library.Unknown.call(this, value); }
function prototypeOf(constructor) { return Object.getPrototypeOf(Object.create(constructor.prototype)); }
Object.defineProperty(prototypeOf(HeirOfKnown), "guarded", { get() { return "got"; }, set(value) { calls++; this.kept = Object.keys(this).join(""); } });
Object.defineProperty(prototypeOf(HeirOfUnknown), ["vei", "led"].join(""), { get() { return "got"; }, set(value) { calls++; this.kept = Object.keys(this).join(""); } });
function describe(object) { return object.constructor.name + " " + Object.keys(object).map(key => key + "=" + object[key]).join() + " " + object.guarded + " " + object.veiled; }
function asked(make) {
  const before = count("operationAOTTryPutProperties");
  const said = new Set();
  for (let i = 0; i < 2000; i++) said.add(describe(make(i & 1)));
  console.log([...said].join("\n"));
  return count("operationAOTTryPutProperties") - before;
}
const known = asked(value => new HeirOfKnown(value));
const unknown = asked(value => new HeirOfUnknown(value));
console.log(calls, !counts || known > unknown ? "the stores around the setter were learnt together" : "the run time was asked " + known + " times, and " + unknown + " times where the name is not known");
