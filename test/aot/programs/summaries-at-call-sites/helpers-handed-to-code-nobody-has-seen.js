// The same helpers are also entered by callers that the compiler does not see: built-ins that take callbacks, timers, promises, JSON's reviver and replacer, a sort, a getter on a host object's options.
function double(x) {
  return typeof x === "number" ? x * 2 : x;
}
function nameOf(thing) {
  return thing.name;
}
function compare(a, b) {
  return a.rank - b.rank;
}
class Player {
  constructor(name, rank) {
    this.name = name;
    this.rank = rank;
  }
}
const players = [new Player("c", 3), new Player("a", 1), new Player("b", 2)];
const lines = [];
lines.push(double(4), double("s"), nameOf(players[0]), compare(players[0], players[1]));
lines.push([1, 2, 3].map(double).join(), ["x", 2].map(double).join());
lines.push(players.map(nameOf).join(), [{ name: 5 }, function named() {}, new Error("e")].map(nameOf).join());
lines.push([...players].sort(compare).map(nameOf).join(), [{ rank: 2, name: "p" }, { rank: 1, name: "q" }].sort(compare).map(nameOf).join());
lines.push(JSON.stringify({ a: 1, b: "t", c: [2] }, (key, value) => double(value)));
lines.push(JSON.stringify(JSON.parse('{"a":1,"b":{"c":2}}', (key, value) => double(value))));
lines.push(Array.from({ length: 3 }, (_, i) => double(i)).join(), Array.from(new Set(players), nameOf).join());
lines.push(new Map(players.map(p => [nameOf(p), p])).get("b").rank);
lines.push("abc".replace(/b/, double), [3, 1, 2].reduce((sum, x) => sum + double(x), 0), players.find(p => nameOf(p) === "a").rank);
globalThis.helpers = { double, nameOf, compare };
lines.push(globalThis.helpers.double(21), globalThis.helpers.nameOf({ name: "from outside" }));
Promise.resolve(8).then(double).then(x => console.log("then " + x));
Promise.all([players[1]].map(async p => nameOf(p))).then(x => console.log("all " + x.join()));
queueMicrotask(() => console.log("microtask " + double(1)));
setTimeout((a, b) => console.log("timer " + compare(a, b)), 0, players[0], players[2]);
console.log(lines.join("\n"));
