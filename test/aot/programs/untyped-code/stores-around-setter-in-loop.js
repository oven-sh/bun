// Two loops, alike line for line. Each stores to nine names of a new object in a row, and the object inherits a setter for the fifth. Of the first the text says which name has a setter; of the second it does not.
// What the objects have, and that the four stores on either side of the setter are learnt together where the name is known, in a loop as elsewhere. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const counts = typeof aotOperationCount === "function";
const count = counts ? aotOperationCount : () => 0;
let calls = 0;
const known = {};
const unknown = {};
Object.defineProperty(known, "guarded", { get() { return "got"; }, set(value) { calls++; this.kept = Object.keys(this).join(""); } });
Object.defineProperty(unknown, ["vei", "led"].join(""), { get() { return "got"; }, set(value) { calls++; this.kept = Object.keys(this).join(""); } });
// Two functions are stored under the name: what the call yields is not known.
const holder = { heirOf: function Unused() {} };
holder.heirOf = function heirOf(parent) { return Object.create(parent); };
function describe(object) { return Object.keys(object).map(key => key + "=" + object[key]).join() + " " + object.guarded + " " + object.veiled; }
const said = new Set();
let before = count("operationAOTTryPutProperties");
for (let i = 0; i < 2000; i++) {
  const object = holder.heirOf(known);
  object.a = i & 1;
  object.b = 1;
  object.c = null;
  object.d = "";
  object.guarded = i & 1;
  object.e = false;
  object.f = 2;
  object.g = undefined;
  object.h = i & 1;
  said.add(describe(object));
}
const askedWhereKnown = count("operationAOTTryPutProperties") - before;
before = count("operationAOTTryPutProperties");
for (let i = 0; i < 2000; i++) {
  const object = holder.heirOf(unknown);
  object.a = i & 1;
  object.b = 1;
  object.c = null;
  object.d = "";
  object.veiled = i & 1;
  object.e = false;
  object.f = 2;
  object.g = undefined;
  object.h = i & 1;
  said.add(describe(object));
}
const askedWhereUnknown = count("operationAOTTryPutProperties") - before;
console.log([...said].join("\n"));
console.log(calls, !counts || askedWhereKnown >= askedWhereUnknown + 2 ? "the stores around the setter were learnt together" : "the run time was asked " + askedWhereKnown + " times, and " + askedWhereUnknown + " times where the name is not known");
