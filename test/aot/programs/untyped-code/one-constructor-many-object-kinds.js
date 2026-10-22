// One constructor at the root of many: every kind of object that inherits from it comes to the same stores with a shape of its own, as every stream and every server comes to EventEmitter.
// What the objects have, also once something stands in the way for one kind alone. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function Root(limit) {
  this.events = null;
  this.eventsCount = 0;
  this.maxListeners = limit;
  this.captures = false;
}
Root.prototype.show = function () { return this.constructor.name + ": " + Object.keys(this).map(key => key + "=" + this[key]).join(); };
const kinds = [];
for (let i = 0; i < 12; i++) {
  const Kind = { ["Kind" + i]: function (limit) { if (i & 1) this.early = i; Root.call(this, limit); this.late = i; } }["Kind" + i];
  Object.setPrototypeOf(Kind.prototype, Root.prototype);
  kinds.push(Kind);
}
const said = new Set();
const before = count("operationAOTTryPutProperties");
for (let turn = 0; turn < 2000; turn++) {
  for (const Kind of kinds) said.add(new Kind(10).show());
}
const inRunTime = count("operationAOTTryPutProperties") - before;
console.log([...said].join("\n"));
console.log(inRunTime <= 200 ? "the run time stored for at most 200 of them" : "the run time stored for " + inRunTime + " of them");

const log = [];
function define(object, name, descriptor) { Object.defineProperty(object, name, descriptor); }
function remove(object, name) { delete object[name]; }
const parentOfThird = Object.getPrototypeOf(new kinds[3](0));
const parentOfAll = Object.getPrototypeOf(parentOfThird);
const names = ["max" + "Listeners", "cap" + "tures"];
define(parentOfThird, names[0], { get() { return "by getter"; }, set(value) { log.push("set " + value + " behind " + Object.keys(this).join()); }, configurable: true });
for (const Kind of kinds.slice(2, 5)) console.log(new Kind(11).show());
console.log(log.splice(0).join(" | "));
define(parentOfAll, names[1], { value: "fixed", writable: false, configurable: true });
for (const Kind of kinds.slice(2, 5)) {
  try {
    console.log(new Kind(12).show());
  } catch (error) {
    console.log(error.constructor.name);
  }
}
console.log(log.splice(0).join(" | "));
remove(parentOfAll, names[1]);
remove(parentOfThird, names[0]);
for (let turn = 0; turn < 40; turn++) {
  for (const Kind of kinds) said.add(new Kind(13).show());
}
console.log(said.size, new kinds[3](14).show(), log.length);
const bare = Object.create(null);
Root.call(bare, 15);
console.log(Object.keys(bare).join(), bare.maxListeners);
const filled = { eventsCount: "there", other: 1 };
Root.call(filled, 16);
console.log(Object.keys(filled).join(), filled.eventsCount);
