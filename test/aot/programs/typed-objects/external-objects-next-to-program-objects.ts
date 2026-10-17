// Two receivers of one type that admits objects from outside are read and stored to in one stretch of code. Either may be an object of the
// program or one from outside (parsed data, an object with accessors, one that lacks what is optional, a proxy): every pairing answers as the
// language says, whichever way the stretch is compiled for the pairing.
declare const console: { log(...values: unknown[]): void };
declare const JSON: { parse(text: string): any };
declare const Object: { defineProperty(o: any, k: string, d: any): any; keys(o: object): string[] };
declare const Proxy: new (target: object, handler: object) => any;
interface Item { count: number; total: number; name?: string; next?: Item; flag?: boolean; n?: number; u?: string | number; a1?: number; a2?: number; a3?: number; a4?: number; a5?: number; a6?: number; a7?: number; a8?: number; late?: string }
const log: string[] = [];
function member(i: number): Item { return { count: i, total: 0, name: "m" + i, flag: (i & 1) === 0, n: i + 0.5, u: i & 1 ? "u" + i : i } }
function bare(i: number): Item { return { count: i, total: 0 } }
function parsed(i: number): Item { return JSON.parse('{"count":' + i + ',"total":0,"name":"p' + i + '","flag":true,"n":' + i + '.25,"u":"text"}') as Item }
function parsedBare(i: number): Item { return JSON.parse('{"total":0,"count":' + i + '}') as Item }
function withAccessors(i: number): Item {
  const o: any = { total: 0, name: "g" + i, flag: false };
  let held = i;
  Object.defineProperty(o, "count", { get() { log.push("get count"); return held }, set(v: number) { log.push("set count"); held = v }, enumerable: true, configurable: true });
  Object.defineProperty(o, "n", { get() { log.push("get n"); return 7.5 }, enumerable: true, configurable: true });
  return o as Item;
}
function behindProxy(i: number): Item { return new Proxy({ count: i, total: 0, u: 3 }, { get(t: any, k: string) { log.push("proxy get " + k); return t[k] }, set(t: any, k: string, v: unknown) { log.push("proxy set " + k); t[k] = v; return true } }) as Item }
function both(a: Item, b: Item): string {
  const sum = a.count + b.count;
  a.total = sum;
  b.total = sum + 1;
  a.count = a.count + 1;
  b.late = "late" + sum;
  return sum + " " + a.name + " " + b.name + " " + a.flag + " " + b.flag + " " + a.n + " " + b.n + " " + a.u + " " + b.u + " " + a.total + " " + b.total + " " + a.count + " " + a.late + " " + b.late + " " + a.a8;
}
function chain(a: Item, b: Item): string {
  a.next = b;
  const next = a.next;
  return (next === b) + " " + (next ? next.count + a.count : -1) + " " + (b.next === undefined);
}
const makers: ((i: number) => Item)[] = [member, bare, parsed, parsedBare, withAccessors, behindProxy];
const names = ["member", "bare", "parsed", "parsed bare", "accessors", "proxy"];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < makers.length; i++) {
    for (let j = 0; j < makers.length; j++) {
      const a = makers[i](10 * round + i), b = makers[j](20 * round + j);
      log.length = 0;
      const said = both(a, b), chained = chain(a, b);
      if (round === 2) console.log(names[i] + " | " + names[j] + ": " + said + " | " + chained + " | " + log.length + " " + Object.keys(a).join() + " | " + Object.keys(b).join());
    }
  }
}
const same = member(5);
console.log(both(same, same), chain(same, same));
const sameFromOutside = parsed(6);
console.log(both(sameFromOutside, sameFromOutside), chain(sameFromOutside, sameFromOutside));
