// Object.freeze() and Object.assign() on a prototype object invalidate the cached lookups of the names they touch, and no others.
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
  Kind.prototype.label = "kind";
  kinds.push(Kind);
}
function visit(object) {
  object.extra = object.double();
  return object.extra + object.label.length + (object.absent === undefined ? 1 : 0);
}
function pass() {
  let sum = 0;
  for (const Kind of kinds) sum += visit(new Kind(2));
  return sum;
}
function Unrelated() {}
Unrelated.prototype.first = 1;
const unrelated = new Unrelated();
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
}
function storeShadow(object, value) {
  object.shadowed = value;
  return object.shadowed;
}
function readLate(object) {
  return object.late;
}
function callLate(object) {
  return typeof object.lateMethod === "function" ? object.lateMethod() : "none";
}
console.log(pass(), pass(), unrelated.first);
const events = {
  "Object.assign on an unrelated prototype": () => Object.assign(Unrelated.prototype, { second: 2, third: 3 }),
  "Object.freeze on an unrelated prototype": () => Object.freeze(Unrelated.prototype),
  "Object.seal on an unrelated prototype": () => Object.seal(Object.getPrototypeOf(Object.create({ sealed: 1 }))),
};
let most = 0;
let worst = "";
for (const name of Object.keys(events)) {
  events[name]();
  const before = misses();
  const sum = pass();
  const repeated = misses() - before;
  if (repeated > most) {
    most = repeated;
    worst = name;
  }
  console.log(name, sum, unrelated.second, unrelated.third);
}
console.log(most === 0 ? "no unrelated lookup was repeated" : most + " unrelated lookups were repeated after " + worst);

function Parent() {}
Parent.prototype.shadowed = "inherited";
const children = () => [new Parent(), new Parent(), Object.create(Parent.prototype)];
console.log(children().map(child => attempt(() => storeShadow(child, 1))).join(" "), children().map(readLate).join(" "), children().map(callLate).join(" "));
Object.assign(Parent.prototype, { late: "arrived", lateMethod() { return "called"; } });
console.log(children().map(child => attempt(() => storeShadow(child, 2))).join(" "), children().map(readLate).join(" "), children().map(callLate).join(" "));
Object.freeze(Parent.prototype);
console.log(children().map(child => attempt(() => storeShadow(child, 3))).join(" "), children().map(readLate).join(" "), children().map(callLate).join(" "));
console.log(children().map(child => attempt(() => { child.other = 4; return child.other; })).join(" "), attempt(() => { Parent.prototype.more = 1; return "stored"; }), Object.isFrozen(Parent.prototype));
