// The first use of a lazily created built-in class does not invalidate cached property lookups that have nothing to do with it.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const misses = () => count("operationAOTGetByIdAndCache") + count("operationAOTPutByIdAndCache");
const kinds = [];
for (let k = 0; k < 40; k++) {
  function Kind(value) {
    this.value = value;
    this["own" + k] = k;
  }
  Kind.prototype.double = function () { return this.value * 2; };
  Kind.prototype.triple = function () { return this.value * 3; };
  Kind.prototype.label = "kind";
  kinds.push(Kind);
}
function visit(object) {
  object.extra = object.double() + object.triple();
  return object.extra + object.label.length + (object.absent === undefined ? 1 : 0) + (object.toString === Object.prototype.toString ? 1 : 0);
}
function pass() {
  let sum = 0;
  for (const Kind of kinds) sum += visit(new Kind(2));
  return sum;
}
const first = pass();
const settled = misses();
const second = pass();
const repeatedWhenNothingHappened = misses() - settled;
const uses = {
  "Intl.NumberFormat": () => new Intl.NumberFormat("en-US").format(1234.5),
  "Intl.DateTimeFormat": () => typeof new Intl.DateTimeFormat("en-US").format,
  "Intl.Collator": () => new Intl.Collator("en-US").compare("a", "b"),
  "Intl.PluralRules": () => new Intl.PluralRules("en-US").select(1),
  "Intl.ListFormat": () => new Intl.ListFormat("en-US").format(["a", "b"]),
  "Intl.RelativeTimeFormat": () => new Intl.RelativeTimeFormat("en-US").format(1, "day"),
  "Intl.Segmenter": () => [...new Intl.Segmenter("en-US").segment("ab")].length,
  WeakRef: () => typeof new WeakRef({}).deref(),
  FinalizationRegistry: () => typeof new FinalizationRegistry(() => {}).register,
  SharedArrayBuffer: () => new SharedArrayBuffer(8).byteLength,
  DataView: () => new DataView(new ArrayBuffer(8)).byteLength,
  BigInt64Array: () => new BigInt64Array(2).length,
};
console.log(first, second, repeatedWhenNothingHappened === 0 ? "the second pass misses nothing" : "the second pass misses " + repeatedWhenNothingHappened);
let most = 0;
let worst = "";
for (const name of Object.keys(uses)) {
  const result = uses[name]();
  const before = misses();
  const sum = pass();
  const repeated = misses() - before;
  if (repeated > most) {
    most = repeated;
    worst = name;
  }
  console.log(name, result, sum);
}
console.log(most === 0 ? "no lookup was repeated after the first use of a built-in class" : most + " lookups were repeated after the first use of " + worst);
class Money extends Intl.NumberFormat {}
const money = new Money("en-US");
function shadow(object, value) {
  "use strict";
  try {
    object.format = value;
    return typeof object.format;
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(shadow(money, 1), shadow(new Money("en-US"), 2), shadow(Object.create(Intl.NumberFormat.prototype), 3), typeof Intl.NumberFormat.prototype.formatToParts);
