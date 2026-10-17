// `o[key] = v`, v a number, a boolean, undefined or null, that gives an OLD object its first storage out of line, or another Structure alone: the storage is young, and a young collection looks at an old object again only if it has been told of it. Everything stored must still be there after many young collections whose garbage is of the same size.
declare const edenGC: undefined | (() => void);
const collectTheYoung = typeof edenGC === "function" ? edenGC : () => {};
function put(o: any, k: any, v: any) { o[k] = v; }
function get(o: any, k: any) { return o[k]; }
function putNamed(o: any, v: any) { o.g = v; }
const symbols = [Symbol("s"), Symbol("t")], names = ["g", "h"];
const six = '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6}', five = '{"a":1,"b":2,"c":3,"d":4,"e":5}';
const count = 10000;
function churn(rounds: number) {
  let kept = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 20000; i++) {
      const o = JSON.parse(six), p = JSON.parse(six), q = JSON.parse(six), n = JSON.parse(five);
      put(o, names[i & 1], -1 - i); put(o, names[1 - (i & 1)], -2 - i);
      put(p, symbols[i & 1], -3 - i); put(p, symbols[1 - (i & 1)], -4.5);
      putNamed(q, -5 - i);
      put(n, symbols[i & 1], -6);
      kept += get(o, names[0]) + get(p, symbols[0]) + q.g + get(n, symbols[i & 1]);
    }
    collectTheYoung();
  }
  return kept;
}
function check(name: string, list: any[], read: (o: any, i: number) => unknown, expected: (i: number) => unknown) {
  let wrong = 0, first = -1;
  for (let i = 0; i < list.length; i++) if (read(list[i], i) !== expected(i)) { wrong++; if (first < 0) first = i; }
  console.log(name, wrong, first);
}
const values = [true, undefined, null, false];
const byKey: any[] = [], bySymbol: any[] = [], byName: any[] = [], others: any[] = [], inObject: any[] = [];
for (let i = 0; i < count; i++) { byKey.push(JSON.parse(six)); bySymbol.push(JSON.parse(six)); byName.push(JSON.parse(six)); others.push(JSON.parse(six)); inObject.push(JSON.parse(five)); }
console.log(churn(4) < 0);
for (let i = 0; i < count; i++) { put(byKey[i], names[i & 1], i); put(bySymbol[i], symbols[i & 1], i + 0.5); putNamed(byName[i], i); put(others[i], symbols[i & 1], values[i & 3]); put(inObject[i], symbols[i & 1], i); }
console.log(churn(6) < 0);
check("by a name that is looked at when it runs", byKey, (o, i) => get(o, names[i & 1]), i => i);
check("by a symbol", bySymbol, (o, i) => get(o, symbols[i & 1]), i => i + 0.5);
check("by a name in the text", byName, o => o.g, i => i);
check("true, undefined, null, false", others, (o, i) => get(o, symbols[i & 1]), i => values[i & 3]);
check("there is room in the object", inObject, (o, i) => get(o, symbols[i & 1]), i => i);
check("what was there", bySymbol, o => o.a + o.f, () => 7);
check("the keys", byKey, (o, i) => Object.keys(o).join(""), i => "abcdef" + names[i & 1]);
