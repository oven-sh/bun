// A constructor that gives `this` properties under symbols, one store after the other, as Node's streams do: what the objects have, and that the stores are learnt as one step.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const kState = Symbol("state"), kBuffer = Symbol("buffer"), kEnded = Symbol("ended"), kOwner = Symbol("owner");
function Reader(owner) {
  this[kState] = 1;
  this[kBuffer] = [];
  this[kEnded] = false;
  this[kOwner] = owner;
}
Reader.prototype.show = function () { return [this[kState], this[kBuffer].length, this[kEnded], this[kOwner], Reflect.ownKeys(this).map(String).join()].join(" "); };
const said = new Set();
const before = count("operationAOTTryPutProperties");
for (let i = 0; i < 2000; i++) said.add(new Reader(i & 1).show());
const calls = count("operationAOTTryPutProperties") - before;
console.log([...said].join(" | "), calls <= 4 ? "and the run time was asked at most 4 times" : "and the run time was asked " + calls + " times");
collect();
console.log(new Reader(2).show());
// What stands in the way of one of the symbols is seen at once.
let seen = 0;
Object.defineProperty(Reader.prototype, kEnded, { set(value) { seen++; }, get() { return "inherited"; }, configurable: true });
console.log(new Reader(3).show(), seen);
delete Reader.prototype[kEnded];
console.log(new Reader(4).show(), seen);
const above = {};
Object.setPrototypeOf(Reader.prototype, above);
console.log(new Reader(5).show());
Object.defineProperty(above, kOwner, { value: "fixed", writable: false, configurable: true });
let thrown = "nothing";
try { new Reader(5); } catch (error) { thrown = error.constructor.name; }
console.log(thrown);
delete above[kOwner];
console.log(new Reader(7).show());
// The same symbol twice, and an object that has one of them already.
function Twice(key) { this[kState] = 1; this[key] = 2; this[kEnded] = 3; }
console.log(Reflect.ownKeys(new Twice(kState)).length, new Twice(kState)[kState], Reflect.ownKeys(new Twice(kBuffer)).length);
const copies = new Set();
for (let i = 0; i < 500; i++) {
  const source = { a: i & 1, b: "b", c: [1], [kState]: 4 };
  const copy = Object.assign({ first: 0 }, source), spread = { first: 0, ...source };
  copies.add(JSON.stringify(copy) + Reflect.ownKeys(copy).length + JSON.stringify(spread) + Reflect.ownKeys(spread).length);
}
console.log([...copies].join(" | "));
