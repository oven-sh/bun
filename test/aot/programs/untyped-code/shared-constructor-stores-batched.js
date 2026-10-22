// A constructor function that many classes share gives `this` its properties; each class has its own prototype.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
function Emitter() { this.events = undefined; this.count = 0; this.limit = undefined; }
Emitter.prototype.on = function () { return this; };
const classes = [];
for (let i = 0; i < 24; i++) {
  const C = function (name) { Emitter.call(this); this.name = name; this.state = i; };
  C.prototype = Object.create(Emitter.prototype, { constructor: { value: C, writable: true, configurable: true }, destroyed: { get() { return this.state < 0; }, set(v) { this.state = v ? -1 : 0; }, configurable: true } });
  classes.push(C);
}
const show = o => Object.keys(o).join() + ":" + o.events + o.count + o.limit + o.name + o.state;
const round = () => { const seen = new Set(); for (const C of classes) seen.add(show(new C("n"))); return seen.size + " " + [...seen][5]; };
for (let i = 0; i < 40; i++) round();
const before = count("operationAOTTryPutProperties");
const said = new Set();
for (let i = 0; i < 100; i++) said.add(round());
const times = count("operationAOTTryPutProperties") - before;
console.log([...said].join(" | "), times < 200 ? "and the operation went the long way under 200 times" : "and the operation went the long way " + times + " times");
collect();
console.log(round());
// What gets in the way of one of the names is seen at once.
let seen = 0;
Object.defineProperty(classes[5].prototype, "count", { set(v) { seen++; }, get() { return "got"; }, configurable: true });
console.log(round(), seen);
delete classes[5].prototype.count;
console.log(round(), seen);
Object.defineProperty(Emitter.prototype, "limit", { value: "fixed", writable: false, configurable: true });
let thrown = 0;
try { round(); } catch (error) { thrown += error instanceof TypeError ? 1 : 100; }
console.log(thrown, show(Object.assign(Object.create(classes[5].prototype), { name: "n" })));
delete Emitter.prototype.limit;
console.log(round());
Object.setPrototypeOf(classes[5].prototype, { set events(v) { seen += 10; } });
console.log(round(), seen);
Object.setPrototypeOf(classes[5].prototype, Emitter.prototype);
Object.freeze(Emitter.prototype);
console.log(round(), seen);
