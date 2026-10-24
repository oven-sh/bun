// `for..in` over objects that have nothing to list, before and after they or their prototypes get something.
function keysOf(value) { const found = []; for (const key in value) found.push(key); return found.join(); }
function count(value, times) { let turns = 0; for (let i = 0; i < times; i++) for (const key in value) turns++; return turns; }
function Plain() {}
class Empty {}
class Heir extends Empty {}
const hidden = Object.defineProperty({}, "hidden", { value: 1, enumerable: false });
const bare = Object.create(null);
const cases = [["literal", {}], ["bare", bare], ["function prototype", Plain.prototype], ["class prototype", Empty.prototype], ["instance", new Empty()], ["heir", new Heir()], ["hidden", hidden], ["null", null], ["undefined", undefined], ["number", 5], ["empty string", ""], ["string", "ab"], ["empty array", []], ["array", [7, 8]], ["map", new Map([[1, 2]])], ["function", Plain], ["symbol key", { [Symbol("s")]: 1 }], ["date", new Date(0)], ["regexp", /x/]];
for (const [name, value] of cases) console.log(name, "[" + keysOf(value) + "]", count(value, 100));
console.log("alternating", [{}, { a: 1 }, {}, { b: 2, c: 3 }, bare, [1], {}].map(keysOf).join("|"));
const grows = {};
console.log("before", keysOf(grows), count(grows, 1000));
grows.late = 1;
console.log("after own", keysOf(grows), count(grows, 1000));
delete grows.late;
console.log("after delete", "[" + keysOf(grows) + "]", count(grows, 1000));
const instance = new Heir();
console.log("instance before", "[" + keysOf(instance) + "]", count(instance, 1000));
Empty.prototype.inherited = 1;
console.log("instance after its second prototype grew", keysOf(instance), count(instance, 1000), keysOf(Heir.prototype), keysOf(Empty.prototype));
delete Empty.prototype.inherited;
console.log("and back", "[" + keysOf(instance) + "]");
Plain.prototype.method = function () {};
console.log("function prototype grew", keysOf(Plain.prototype), keysOf(new Plain()));
const asked = [];
const proxy = new Proxy({}, { ownKeys() { asked.push("ownKeys"); return []; }, getPrototypeOf() { asked.push("getPrototypeOf"); return null; } });
console.log("proxy", "[" + keysOf(proxy) + "]", asked.join());
function* across(value) { for (const key in value) yield key; yield "end"; }
console.log("generator", [...across({})].join(), [...across({ x: 1 })].join(), [...across(null)].join());
function nested(a, b) { let n = 0; for (const x in a) for (const y in b) n++; for (const y in b) for (const x in a) n += 10; return n; }
console.log("nested", nested({}, { p: 1, q: 2 }), nested({ p: 1 }, {}), nested({}, {}), nested({ p: 1 }, { q: 1 }));
function addsWhileListing(value) { let n = 0; for (const key in value) { n++; } value.added = 1; for (const key in value) { n += 10; value["more" + n] = 1; } return n; }
console.log("adds", addsWhileListing({}), addsWhileListing(Object.create(null)));
