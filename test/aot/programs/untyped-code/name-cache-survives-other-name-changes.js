// What the engine has cached about one name on a prototype chain outlives changes to other names of the prototypes, and ends with a change to its own.
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
const keys = ["key0", "key1", "value", "method"].map(k => k.slice(0, 3) + k.slice(3));
function read(o) { return o.method() + o.value + (o.missing === undefined ? 0 : o.missing) + o.shared; }
function has(o) { let n = 0; for (const key of keys) if (key in o) n++; return n; }
function store(o) { try { o.added = 1; } catch (error) { return error instanceof TypeError ? 2 : 3; } return Object.hasOwn(o, "added") ? 1 : 0; }
function round() { let sum = 0; for (const o of objects) sum += read(o) + 100 * has(o); for (const o of make()) sum += 10000 * store(o); return sum; }
for (let i = 0; i < 30; i++) round();
const before = entered();
let sums = new Set();
for (let i = 0; i < 60; i++) {
  Base.prototype["unrelated" + i] = i;
  if (i % 3 === 0) Middle.prototype["other" + i] = i;
  sums.add(round());
}
const each = entered().map((n, i) => n - before[i]);
const times = each.reduce((a, b) => a + b);
console.log([...sums].join(), times < 500 ? "and the run time was entered under 500 times" : "entered: " + each.join(" "));

const say = what => console.log(what + ": " + round());
Middle.prototype.value = 20; say("a nearer value");
Base.prototype.missing = 5; say("what was missing is there");
delete Middle.prototype.value; say("the nearer value is gone");
Object.defineProperty(Base.prototype, "value", { get() { return 1000; }, configurable: true }); say("the value is an accessor");
Middle.prototype.key1 = 1; say("a key is there");
Base.prototype["key" + 0] = 1; say("another key is there");
delete Middle.prototype.key1; say("the first key is gone");
let stored = 0;
Object.defineProperty(Base.prototype, "added", { set(v) { stored += v; }, configurable: true }); say("a setter is in the way"); console.log(stored);
delete Base.prototype.added; say("the setter is gone");
Object.defineProperty(Middle.prototype, "added", { value: 0, writable: false, configurable: true }); say("a read-only property is in the way");
delete Middle.prototype.added; say("it is gone");
Object.setPrototypeOf(Middle.prototype, { method() { return 2; }, value: 3 }); say("another prototype behind the prototype");
Object.freeze(Middle.prototype); say("the prototype is frozen");
