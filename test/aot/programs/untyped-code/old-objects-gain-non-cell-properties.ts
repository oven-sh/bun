// OLD objects get NEW PROPERTIES whose values are no cells, by every way there is to add one: what is young is the storage, and the Structure.
declare const edenGC: undefined | (() => void);
const collectTheYoung = typeof edenGC === "function" ? edenGC : () => {};
const N = 4000, six = '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6}';
const kA = Symbol("a"), kB = Symbol("b"), kC = Symbol("c");
function single(o: any, i: number) { o.g = i; }
function assign(o: any, i: number) { Object.assign(o, { g: i, h: i + 0.5, i: true }); }
function assignGiven(o: any, from: any) { Object.assign(o, from); }
function define(o: any, i: number) { Object.defineProperty(o, "g", { value: i, writable: true, enumerable: true, configurable: true }); }
function defineMany(o: any, i: number) { Object.defineProperties(o, { g: { value: i, enumerable: true }, h: { value: -i, enumerable: true } }); }
function bySymbols(o: any, i: number) { o[kA] = i; o[kB] = i + 0.5; o[kC] = false; }
function again(o: any, i: number) { o.g = 0; delete o.g; o.g = i; o.h = i; }
function reflect(o: any, i: number) { Reflect.set(o, "g", i); Reflect.defineProperty(o, "h", { value: i, enumerable: true }); }
function onFunction(f: any, i: number) { f.g = i; f.h = i + 0.5; f.i = null; f.j = i; f.k = i; f.l = i; f.m = i; }
function onArray(a: any, i: number) { a.g = i; a.h = i + 0.5; a.i = undefined; a.j = i; a.k = i; }
function Made(this: any) { this.a = 1; this.b = 2; }
function fillLater(o: any, i: number) { o.c = i; o.d = i; o.e = i; o.f = i; o.g = i; o.h = i; o.i = i; o.j = i; o.k = i; o.l = i; o.m = i; o.n = i; }
class Plain { a = 1; [key: string]: unknown }
let sink = 0;
function churn(rounds: number) {
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 12000; i++) {
      const o = JSON.parse(six), p = JSON.parse(six), q = JSON.parse(six), s = JSON.parse(six), t = JSON.parse(six), u = JSON.parse(six), v = JSON.parse(six), w = JSON.parse(six);
      single(o, -i); assign(p, -i); define(q, -i); bySymbols(s, -i); again(t, -i); reflect(u, -i); defineMany(v, -i); assignGiven(w, JSON.parse('{"g":-1,"h":-2,"i":-3,"j":-4,"k":-5}'));
      const f = function () {}, a = [1, 2], m = new (Made as any)(), c = new Plain();
      onFunction(f, -i); onArray(a, -i); fillLater(m, -i); fillLater(c, -i);
      sink += o.g + p.g + q.g + s[kA] + t.g + u.g + v.g + w.g + (f as any).g + (a as any).g + m.n + (c.n as number);
    }
    collectTheYoung();
  }
}
const lists: any[][] = [];
for (let k = 0; k < 12; k++) lists.push([]);
for (let i = 0; i < N; i++) {
  for (let k = 0; k < 8; k++) lists[k].push(JSON.parse(six));
  lists[8].push(function () {}); lists[9].push([1, 2]); lists[10].push(new (Made as any)()); lists[11].push(new Plain());
}
churn(3);
for (let i = 0; i < N; i++) {
  single(lists[0][i], i); assign(lists[1][i], i); define(lists[2][i], i); bySymbols(lists[3][i], i); again(lists[4][i], i); reflect(lists[5][i], i); defineMany(lists[6][i], i); assignGiven(lists[7][i], JSON.parse('{"g":' + i + ',"h":2,"i":3,"j":4,"k":' + i + '}'));
  onFunction(lists[8][i], i); onArray(lists[9][i], i); fillLater(lists[10][i], i); fillLater(lists[11][i], i);
}
churn(4);
function check(name: string, k: number, right: (o: any, i: number) => boolean) { let wrong = 0, first = -1; for (let i = 0; i < N; i++) { let ok = false; try { ok = right(lists[k][i], i); } catch { ok = false; } if (!ok) { wrong++; if (first < 0) first = i; } } console.log(name + ": " + wrong + (wrong ? " first " + first : "")); }
check("one store by name", 0, (o, i) => o.g === i && o.f === 6);
check("Object.assign of a literal", 1, (o, i) => o.g === i && o.h === i + 0.5 && o.i === true);
check("Object.defineProperty", 2, (o, i) => o.g === i);
check("stores under symbols that are constants", 3, (o, i) => o[kA] === i && o[kB] === i + 0.5 && o[kC] === false);
check("stored, deleted, stored again", 4, (o, i) => o.g === i && o.h === i);
check("Reflect.set and Reflect.defineProperty", 5, (o, i) => o.g === i && o.h === i);
check("Object.defineProperties", 6, (o, i) => o.g === i && o.h === -i);
check("Object.assign of what was parsed", 7, (o, i) => o.g === i && o.k === i && o.j === 4);
check("a function", 8, (f, i) => f.g === i && f.h === i + 0.5 && f.i === null && f.m === i);
check("an array", 9, (a, i) => a.g === i && a.h === i + 0.5 && a.k === i && a[1] === 2);
check("what a function made with new", 10, (o, i) => o.a === 1 && o.c === i && o.n === i && o.h === i);
check("an instance that takes any name", 11, (o, i) => o.a === 1 && o.c === i && o.n === i && o.h === i);
console.log(sink !== 0);
