// An object literal in which some keys are array indices. The named properties and the indexed ones must come out as in any engine: indices first in ascending order, then names in source order.
function small() {
  return { b: 1, 7: "seven", a: 2, 0: "zero", c: 3 };
}
function onlyOneName() {
  return { 3: "three", name: "n", 1: "one" };
}
function onlyIndices() {
  return { 2: "two", 1: "one", 10: "ten" };
}
function notQuiteIndices() {
  return { "01": "a", "-1": "b", "1.5": "c", 4294967294: "d", 4294967295: "e", "1e3": "f", 5: "g", x: "h" };
}
function large(seed) {
  return {
    k00: seed, k01: seed + 1, k02: seed + 2, k03: seed + 3, k04: seed + 4, k05: seed + 5, k06: seed + 6, k07: seed + 7, k08: seed + 8, k09: seed + 9,
    100: "hundred",
    k10: seed, k11: seed + 1, k12: seed + 2, k13: seed + 3, k14: seed + 4, k15: seed + 5, k16: seed + 6, k17: seed + 7, k18: seed + 8, k19: seed + 9,
    k20: seed, k21: seed + 1, k22: seed + 2, k23: seed + 3, k24: seed + 4, k25: seed + 5, k26: seed + 6, k27: seed + 7, k28: seed + 8, k29: seed + 9,
    1234: "digits",
    k30: seed, k31: seed + 1, k32: seed + 2, k33: seed + 3, k34: seed + 4, k35: seed + 5, k36: seed + 6, k37: seed + 7, k38: seed + 8, k39: seed + 9,
    k40: seed, k41: seed + 1, k42: seed + 2, k43: seed + 3, k44: seed + 4, k45: seed + 5, k46: seed + 6, k47: seed + 7, k48: seed + 8, k49: seed + 9,
    k50: seed, k51: seed + 1, k52: seed + 2, k53: seed + 3, k54: seed + 4, k55: seed + 5, k56: seed + 6, k57: seed + 7, k58: seed + 8, k59: seed + 9,
    k60: seed, k61: seed + 1, k62: seed + 2, k63: seed + 3, k64: seed + 4, k65: seed + 5, k66: seed + 6, k67: seed + 7, k68: seed + 8, k69: seed + 9,
    0: "zero",
  };
}
function quoted(seed) {
  return {
    q00: seed, q01: seed + 1, q02: seed + 2, q03: seed + 3, q04: seed + 4, q05: seed + 5, q06: seed + 6, q07: seed + 7, q08: seed + 8, q09: seed + 9,
    "100": "hundred",
    q10: seed, q11: seed + 1, q12: seed + 2, q13: seed + 3, q14: seed + 4, q15: seed + 5, q16: seed + 6, q17: seed + 7, q18: seed + 8, q19: seed + 9,
    q20: seed, q21: seed + 1, q22: seed + 2, q23: seed + 3, q24: seed + 4, q25: seed + 5, q26: seed + 6, q27: seed + 7, q28: seed + 8, q29: seed + 9,
    "7": "seven", "007": "not an index",
    q30: seed, q31: seed + 1, q32: seed + 2, q33: seed + 3, q34: seed + 4, q35: seed + 5, q36: seed + 6, q37: seed + 7, q38: seed + 8, q39: seed + 9,
  };
}
function quotedSmall() {
  return { b: 1, "7": "seven", a: 2, "0": "zero" };
}
function show(object) {
  console.log(JSON.stringify(object), Object.keys(object).join(), Object.getOwnPropertyNames(object).length);
}
for (let round = 0; round < 3; round++) {
  show(small());
  show(onlyOneName());
  show(onlyIndices());
  show(notQuiteIndices());
  show(large(round));
  show(quoted(round));
  show(quotedSmall());
}
const first = large(1);
const second = large(2);
first.extra = true;
delete second.k33;
second[100] = "changed";
second[5] = "added";
console.log(Object.keys(first).length, Object.keys(second).length, first[100], second[100], second[5], first.k69, second.k69, "k33" in second, "extra" in second);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(first, "100")), JSON.stringify(Object.getOwnPropertyDescriptor(first, "k10")));
Object.freeze(first);
console.log(Object.isFrozen(first), Reflect.set(first, "100", 1), Reflect.set(first, "k00", 1), first[100], first.k00);
