// Constructors that give `this` many properties where the prototype chain holds accessors and read-only properties of OTHER names, as Node's streams and HTTP messages do: what the objects have, that the stores are learnt (also those that need more storage), and that an accessor or a read-only property of the SAME name is seen the moment it appears anywhere on the chain.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t"];
const log = [];
function Root() {}
Object.defineProperty(Root.prototype, "destroyed", { get() { return this._destroyed === true; }, set(value) { this._destroyed = value; }, configurable: true });
Object.defineProperty(Root.prototype, "kind", { value: "root", writable: false, configurable: true });
function Middle() {}
Middle.prototype = Object.create(Root.prototype, { constructor: { value: Middle, writable: true, configurable: true } });
Object.defineProperty(Middle.prototype, "length", { get() { return Object.keys(this).length; }, configurable: true });
function Message(seed) {
  this.a = seed; this.b = 1; this.c = "c"; this.d = null; this.e = undefined; this.f = false; this.g = seed + 1;
  this.destroyed = false;
  this.h = 2; this.i = 3; this.j = 4; this.k = 5; this.l = 6; this.m = 7; this.n = 8; this.o = 9; this.p = 10; this.q = 11; this.r = 12; this.s = 13; this.t = seed + 2;
}
Message.prototype = Object.create(Middle.prototype, { constructor: { value: Message, writable: true, configurable: true } });
class Reply extends Message {
  constructor(seed) {
    super(seed);
    this.u = seed; this.v = 1; this.w = 2; this.x = 3; this.y = 4; this.z = 5;
  }
  get status() { return this.u; }
}
function show(object) {
  return Object.keys(object).join("") + " " + names.map(name => String(object[name])).join(",") + " " + object.length + " " + object.destroyed + " " + object.kind;
}
function make(constructor, seed) {
  try {
    return show(new constructor(seed));
  } catch (error) {
    return error.constructor.name;
  }
}
function both(what) {
  console.log(what + ": " + make(Message, 1) + " | " + make(Reply, 2) + (log.length ? " | " + log.splice(0).join() : ""));
}

const said = new Set();
const kept = [new Message(0), new Reply(0)];
for (let round = 0; round < 200; round++) said.add(make(Message, round & 1)).add(make(Reply, round & 1));
const before = count("operationAOTPutByIdAndCache");
for (let round = 0; round < 2000; round++) said.add(make(Message, round & 1)).add(make(Reply, round & 1));
const entries = count("operationAOTPutByIdAndCache") - before;
console.log([...said].join("\n"));
console.log(entries <= 200 ? "the run time was asked at most 200 times" : "the run time was asked " + entries + " times", kept.length);
collect();
both("after a collection");

for (const [where, holder] of [["its prototype", Message.prototype], ["the middle", Middle.prototype], ["the root", Root.prototype]]) {
  Object.defineProperty(holder, "m", { set(value) { log.push("m=" + value); }, get() { return "got"; }, configurable: true });
  both("a setter for m on " + where);
  delete holder.m;
  both("deleted");
  Object.defineProperty(holder, "h", { value: "held", writable: false, configurable: true });
  both("a read-only h on " + where);
  Object.defineProperty(holder, "h", { value: "held", writable: true, configurable: true });
  both("h is writable");
  Object.defineProperty(holder, "h", { get() { return "no setter"; }, configurable: true });
  both("h is a getter alone");
  delete holder.h;
  both("deleted");
  holder.t = "plain";
  both("a plain t on " + where);
  Object.defineProperty(holder, "t", { writable: false });
  both("t is read-only");
  delete holder.t;
  both("deleted");
}

Middle.prototype.q = "inherited";
both("a plain q");
Object.freeze(Middle.prototype);
both("the middle is frozen");
const thawed = Object.create(Root.prototype, { length: { get() { return -Object.keys(this).length; }, configurable: true } });
Object.setPrototypeOf(Message.prototype, thawed);
both("another middle");
const between = { set c(value) { log.push("c=" + value); } };
Object.setPrototypeOf(between, Root.prototype);
Object.setPrototypeOf(thawed, between);
both("a prototype with a setter for c is put in between");
Object.setPrototypeOf(thawed, Root.prototype);
both("taken out");
const trapped = new Proxy(Object.create(Root.prototype), { set(target, key, value, receiver) { log.push(String(key)); return Reflect.set(target, key, value, receiver); } });
Object.setPrototypeOf(thawed, trapped);
console.log("a proxy in between: " + make(Message, 1).length + " " + log.splice(0).length);
Object.setPrototypeOf(thawed, Root.prototype);
both("taken out");

const sealedFirst = new Message(5);
Object.preventExtensions(sealedFirst);
try {
  sealedFirst.extra = 1;
  console.log("stored");
} catch (error) {
  console.log("not extensible: " + error.constructor.name);
}
function fill(object) {
  for (let step = 0; step < 3; step++) {
    object.one = step; object.two = step; object.three = step; object.four = step; object.five = step; object.six = step; object.seven = step; object.eight = step; object.nine = step;
  }
  return Object.keys(object).length;
}
let filled = 0;
for (let round = 0; round < 300; round++) filled += fill(Object.create(Message.prototype)) + fill(new Message(round)) + fill(Object.create(null)) + fill({});
console.log(filled);
