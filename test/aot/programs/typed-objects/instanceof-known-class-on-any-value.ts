// `v instanceof Known`, where Known is a class the compiler knows and v is anything: objects of the class, of its heirs, of other classes, objects that no typed code made, and values that are no objects.
const count = (globalThis as any).aotOperationCount ?? (() => 0);
class Known {
  x = 1;
}
class Heir extends Known {
  y = 2;
}
class Leaf extends Heir {
  w = 4;
}
class Other {
  z = 3;
}
const isKnown = [(v: any) => v instanceof Known][0]!;
const isHeir = [(v: any) => v instanceof Heir][0]!;
const isLeaf = [(v: any) => v instanceof Leaf][0]!;
const isOther = [(v: any) => v instanceof Other][0]!;
function inLoop(values: any[]) {
  let known = 0, leaf = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] instanceof Known) known++;
    if (values[i] instanceof Leaf) leaf++;
  }
  return known + "/" + leaf;
}
let traps = 0;
const named: [string, any][] = [
  ["Known", new Known()],
  ["Heir", new Heir()],
  ["Leaf", new Leaf()],
  ["Other", new Other()],
  ["parsed", JSON.parse('{"x":1}')],
  ["made from Known.prototype", Object.create(Known.prototype)],
  ["made from Heir.prototype", Object.create(Heir.prototype)],
  ["made from Leaf.prototype", Object.create(Leaf.prototype)],
  ["two levels under Leaf.prototype", Object.create(Object.create(Leaf.prototype))],
  ["made from an object of Heir", Object.create(new Heir())],
  ["without a prototype", Object.create(null)],
  ["under one without a prototype", Object.create(Object.create(null))],
  ["Known.prototype", Known.prototype],
  ["Heir.prototype", Heir.prototype],
  ["the class Known", Known],
  ["an array", [1]],
  ["a function", () => 1],
  ["a map", new Map()],
  ["an error", new Error("e")],
  ["a date", new Date(0)],
  ["a proxy of a Heir", new Proxy(new Heir(), {})],
  ["a proxy that answers Leaf.prototype", new Proxy({}, { getPrototypeOf() { traps++; return Leaf.prototype; } })],
  ["under a proxy of a Heir", Object.create(new Proxy(new Heir(), { getPrototypeOf(target) { traps++; return Reflect.getPrototypeOf(target); } }))],
  ["a string", "text"],
  ["an empty string", ""],
  ["a long string", "x".repeat(300) + 1],
  ["a symbol", Symbol.iterator],
  ["a big integer", 12345678901234567890n],
  ["a number", 1.5],
  ["an integer", 7],
  ["true", true],
  ["null", null],
  ["undefined", undefined],
];
for (const [name, value] of named) console.log(name + ": " + [isKnown(value), isHeir(value), isLeaf(value), isOther(value)].join(" "));
console.log("traps", traps);
const values = named.map(pair => pair[1]);
console.log("in a loop", inLoop(values), traps);
const quiet = values.filter((_, i) => !named[i]![0].includes("proxy"));
let yes = 0;
const turn = () => {
  for (let i = 0; i < quiet.length; i++) {
    if (isKnown(quiet[i])) yes++;
    if (isLeaf(quiet[i])) yes++;
    if (isOther(quiet[i])) yes++;
  }
};
turn();
const before = count("operationAOTInstanceOfClass");
for (let i = 0; i < 300; i++) turn();
for (let i = 0; i < 300; i++) inLoop(quiet);
console.log("many", yes, count("operationAOTInstanceOfClass") - before < 100);
const changed: any = Object.create(Leaf.prototype);
console.log("before", isKnown(changed), isLeaf(changed));
Object.setPrototypeOf(changed, Other.prototype);
console.log("after", isKnown(changed), isLeaf(changed), isOther(changed));
Object.setPrototypeOf(changed, null);
console.log("at last", isKnown(changed), isLeaf(changed), isOther(changed));
