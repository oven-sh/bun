// Two objects are read through one type in one stretch of code. The second is an object made by untyped code whose
// accessor changes the first: stores, deletes, redefines, gives it another parent, always so that it still has what its type says. What is read of the first behind that is
// what the language says, however many tests of its shape the stretch shares.
declare const console: { log(...values: unknown[]): void };
declare const globalThis: { kept?: unknown };
declare const JSON: { parse(text: string): any };
declare const Object: { defineProperty(o: any, k: string, d: any): any; setPrototypeOf(o: any, p: any): any };
interface Item { count: number; total: number; name?: string; n?: number; a1?: number; a2?: number; a3?: number; a4?: number; a5?: number; a6?: number }
let victim: any;
let deed = 0;
function doDeed(): void {
  switch (deed) {
    case 1: victim.total = 4.5; break;
    case 2: Object.defineProperty(victim, "total", { get() { return 777 }, configurable: true }); break;
    case 3: delete victim.total; Object.setPrototypeOf(victim, { total: 555 }); break;
    case 4: delete victim.name; break;
    case 5: victim.name = "changed"; victim.count = victim.count + 100; break;
    case 6: Object.defineProperty(victim, "count", { value: 99, writable: true, enumerable: false, configurable: true }); break;
    case 7: victim.extra = 1; victim.total = -1; break;
  }
}
function member(i: number): Item { return { count: i, total: i * 10, name: "m" + i, n: i + 0.5 } }
function parsed(i: number): Item { return JSON.parse('{"count":' + i + ',"total":' + i * 10 + ',"name":"p' + i + '"}') as Item }
function meddler(i: number): Item {
  const o: any = { total: i * 10, name: "g" + i };
  Object.defineProperty(o, "count", { get() { doDeed(); return i }, set(v: number) { doDeed() }, enumerable: true, configurable: true });
  return o as Item;
}
function around(a: Item, b: Item): string {
  const first = a.total;
  const between = b.count;
  return first + " " + between + " " + a.total + " " + a.name + " " + a.count;
}
function aroundStore(a: Item, b: Item): string {
  const first = a.total + a.count;
  b.count = 3;
  return first + " " + a.total + " " + a.name + " " + a.count;
}
function three(a: Item, b: Item, c: Item): string {
  const sum = a.total + c.total + a.count + c.count;
  const between = b.count;
  return sum + " " + between + " " + a.total + " " + c.total + " " + a.count + " " + c.count;
}
function inLoop(a: Item, b: Item): string {
  let said = "";
  for (let i = 0; i < 3; i++) {
    const before = a.total;
    const between = i === 1 ? b.count : b.total;
    said += before + ":" + between + ":" + a.total + ":" + a.count + " ";
  }
  return said;
}
function twice(a: Item, b: Item): string {
  return a.total + " " + a.count + " " + b.count + " " + b.total + " " + a.total + " " + a.count + " " + b.count + " " + a.total;
}
globalThis.kept = [around, aroundStore, three, inLoop, twice];
for (deed = 0; deed <= 7; deed++) {
  for (const make of [member, parsed]) {
    victim = make(1); console.log(deed, "around", around(victim, meddler(2)));
    victim = make(2); console.log(deed, "store", aroundStore(victim, meddler(3)));
    victim = make(3); console.log(deed, "three", three(victim, meddler(4), member(5)));
    victim = make(4); console.log(deed, "third", three(member(6), meddler(7), victim));
    victim = make(5); console.log(deed, "loop", inLoop(victim, meddler(8)));
    victim = make(6); console.log(deed, "twice", twice(victim, meddler(9)));
    victim = make(7); console.log(deed, "members", around(victim, member(8)), three(victim, member(9), member(10)));
  }
}
