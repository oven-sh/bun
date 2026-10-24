// One constructor at the root of many kinds of objects stores in a row, once under a symbol that is held in a variable which is stored to twice: what the key is has to be looked at each time.
// What the objects have. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
var kMode = Symbol("first");
if (count.length > 5) kMode = Symbol("never");
function Root(limit) {
  this.events = null;
  this.eventsCount = 0;
  this[kMode] = false;
  this.maxListeners = limit;
}
Root.prototype.show = function () { return this.constructor.name + ": " + Reflect.ownKeys(this).map(key => String(key) + "=" + String(this[key])).join(); };
const library = { Root: function Unused() {} };
library.Root = Root;
const kinds = [];
for (let i = 0; i < 12; i++) {
  const Kind = { ["Kind" + i]: function (limit) { if (i & 1) this.early = i; library.Root.call(this, limit); this.late = i; } }["Kind" + i];
  Object.setPrototypeOf(Kind.prototype, Root.prototype);
  kinds.push(Kind);
}
const said = new Set();
const before = count("operationAOTTryPutProperties");
for (let turn = 0; turn < 2000; turn++) {
  for (const Kind of kinds) said.add(new Kind(10).show());
}
const asked = count("operationAOTTryPutProperties") - before;
console.log([...said].join("\n"));
console.log(asked <= 400 ? "the run time was asked at most 400 times" : "the run time was asked " + asked + " times");
kMode = Symbol("second");
console.log(new kinds[0](11).show(), new kinds[1](11).show());
