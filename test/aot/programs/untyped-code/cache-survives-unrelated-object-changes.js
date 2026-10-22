// What the engine has cached through a prototype chain outlives changes to objects that are not on it, whatever their names, and ends with a change to one that is.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const counted = ["operationAOTGetById", "operationAOTGetByIdAndCache", "operationAOTPutById", "operationAOTPutByIdAndCache", "operationAOTGetByValAndCache"];
const entered = () => counted.map(count);
function Base() {}
Base.prototype.method = function () { return 1; };
Base.prototype.value = 10;
function Middle() {}
Middle.prototype = Object.create(Base.prototype);
// More structures than a site keeps for itself.
const make = () => { const all = []; for (let i = 0; i < 48; i++) { const o = new Middle(); o["own" + i] = i; o.shared = i; all.push(o); } return all; };
const objects = make();
function read(o) { return o.method() + o.value + (o.missing === undefined ? 0 : o.missing) + o.shared; }
function store(o) { try { o.added = 1; } catch (error) { return error instanceof TypeError ? 2 : 3; } return Object.hasOwn(o, "added") ? 1 : 0; }
function round() { let sum = 0; for (const o of objects) sum += read(o); for (const o of make()) sum += 10000 * store(o); return sum; }
for (let i = 0; i < 30; i++) round();
const before = entered();
let sums = new Set(), others = 0;
for (let i = 0; i < 60; i++) {
  // Prototypes of other families, under the very names that are cached.
  const parent = { method() { return 7; }, value: 1 };
  const child = Object.create(parent);
  const heir = Object.create(child);
  parent.missing = i; parent.added = i; child.value = i; child.method = parent.method;
  Object.defineProperty(parent, "value", { get() { return i; }, configurable: true });
  delete parent.missing;
  Object.setPrototypeOf(child, i % 2 ? null : { value: 3 });
  Object.setPrototypeOf(parent, Array.prototype);
  if (i % 3 === 0) Object.freeze(parent);
  class Fresh extends Base { method() { return 9; } get missing() { return 1; } }
  others += heir.value + new Fresh().method();
  sums.add(round());
}
const each = entered().map((n, i) => n - before[i]);
const times = each.reduce((a, b) => a + b);
console.log([...sums].join(), others, times < 1500 ? "and the run time was entered under 1,500 times" : "entered: " + each.join(" "));

const say = what => console.log(what + ": " + round());
Middle.prototype.value = 20; say("a nearer value");
Base.prototype.missing = 5; say("what was missing is there");
delete Middle.prototype.value; say("the nearer value is gone");
Object.defineProperty(Base.prototype, "value", { get() { return 1000; }, configurable: true }); say("the value is an accessor");
let stored = 0;
Object.defineProperty(Base.prototype, "added", { set(v) { stored += v; }, configurable: true }); say("a setter is in the way"); console.log(stored);
delete Base.prototype.added; say("the setter is gone");
const between = { method() { return 2; }, value: 3 };
Object.setPrototypeOf(Middle.prototype, between); say("another prototype behind the prototype");
between.missing = 50; say("which gets what was missing");
Object.setPrototypeOf(between, { added: 0, set added(v) { stored += 100; } }); say("and a prototype of its own with a setter"); console.log(stored);
Object.setPrototypeOf(between, null); say("and none");
Object.freeze(Middle.prototype); say("the prototype is frozen");
