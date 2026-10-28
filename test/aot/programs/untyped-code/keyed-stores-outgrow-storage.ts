// `o[key] = v` that adds property after property until the storage out of line is outgrown, again and again: by names chosen when it runs and by symbols, on young and on old objects, with values of every kind. Everything is read back, in order. The last line counts that the stores that outgrow the storage are served without the general road.
declare const aotOperationCount: undefined | ((name: string) => number);
function put(o: any, k: any, v: any) { o[k] = v; }
function get(o: any, k: any) { return o[k]; }
const names: string[] = [], symbols: symbol[] = [];
for (let i = 0; i < 70; i++) { names.push("n" + i); symbols.push(Symbol("s" + i)); }
const six = '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6}';
const kinds = (i: number, k: number): unknown => { switch ((i + k) % 7) { case 0: return i * 100 + k; case 1: return k + 0.5; case 2: return "t" + k; case 3: return (k & 1) === 0; case 4: return null; case 5: return undefined; default: return names; } };
function fill(o: any, keys: readonly (string | symbol)[], from: number, to: number, i: number) { for (let k = from; k < to; k++) put(o, keys[k], kinds(i, k)); return o; }
function wrong(o: any, keys: readonly (string | symbol)[], to: number, i: number) { let n = 0; for (let k = 0; k < to; k++) if (get(o, keys[k]) !== kinds(i, k)) n++; return n + (o.a + o.f === 7 ? 0 : 1); }
function garbage(rounds: number) { let n = 0; for (let r = 0; r < rounds; r++) for (let i = 0; i < 4000; i++) n += Object.keys(fill(JSON.parse(six), names, 0, 5 + (i & 31), i)).length + Object.getOwnPropertySymbols(fill(JSON.parse(six), symbols, 0, 5 + (i & 31), i)).length; return n; }
for (const to of [4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 36, 37, 68, 69]) {
  let bad = 0, keys = "";
  for (let i = 0; i < 40; i++) {
    const byName = fill(JSON.parse(six), names, 0, to, i), bySymbol = fill(JSON.parse(six), symbols, 0, to, i), mixed = fill(fill(JSON.parse(six), names, 0, to >> 1, i), symbols, 0, to - (to >> 1), i);
    bad += wrong(byName, names, to, i) + wrong(bySymbol, symbols, to, i) + wrong(mixed, names, to >> 1, i) + wrong(mixed, symbols, to - (to >> 1), i);
    keys = Object.keys(byName).length + "," + Object.getOwnPropertySymbols(bySymbol).length + "," + Reflect.ownKeys(mixed).length + "," + (Object.keys(byName).join() === "a,b,c,d,e,f," + names.slice(0, to).join());
  }
  console.log(to, bad, keys);
}
const old: any[] = [], oldBySymbol: any[] = [];
for (let i = 0; i < 3000; i++) { old.push(fill(JSON.parse(six), names, 0, 4, i)); oldBySymbol.push(fill(JSON.parse(six), symbols, 0, 8, i)); }
console.log(garbage(6) > 0);
for (let i = 0; i < 3000; i++) { fill(old[i], names, 4, 5, i); fill(oldBySymbol[i], symbols, 8, 9, i); }
console.log(garbage(6) > 0);
let lost = 0;
for (let i = 0; i < 3000; i++) lost += wrong(old[i], names, 5, i) + wrong(oldBySymbol[i], symbols, 9, i);
console.log("old objects", lost);
const indexed = fill(JSON.parse(six), names, 0, 4, 1); indexed[0] = "zero"; indexed[1] = "one"; fill(indexed, names, 4, 10, 1);
console.log("with indices", wrong(indexed, names, 10, 1), indexed[0], indexed[1], Object.keys(indexed).length);
const list: any = [1, 2, 3]; fill(list, names, 0, 10, 2);
console.log("an array", wrong({ a: 1, f: 6, ...list }, names, 10, 2), list.length, list.join());
const closed = Object.preventExtensions(fill(JSON.parse(six), names, 0, 4, 3));
console.log("closed", (() => { try { put(closed, names[4], 1); return "stored"; } catch (e) { return (e as Error).name; } })(), Object.keys(closed).length);
const heir = fill(Object.create(fill(JSON.parse(six), names, 0, 9, 4)), names, 0, 9, 5);
console.log("an heir", (() => { let n = 0; for (let k = 0; k < 9; k++) if (get(heir, names[k]) !== kinds(5, k)) n++; return n; })(), Object.keys(heir).length);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const entered = () => counted("operationAOTPutByValGeneric") + counted("operationAOTPutByValAndCache") + counted("operationAOTPutByValAndCacheSloppy");
const before = entered();
let total = 0;
for (let i = 0; i < 2000; i++) total += wrong(fill(JSON.parse(six), symbols, 0, 17, i), symbols, 17, i);
console.log(total, entered() - before < 200);
