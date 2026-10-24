// A run of stores by name, `o.g = 1; o.h = 2.5; o.i = true`, none of them a cell, that gives an OLD object its first storage out of line, or more of it.
declare const edenGC: undefined | (() => void);
const collectTheYoung = typeof edenGC === "function" ? edenGC : () => {};
function three(o: any, i: number) { o.g = i; o.h = i + 0.5; o.i = (i & 1) === 0; }
function two(o: any, i: number) { o.j = i; o.k = -i; }
function four(o: any, i: number) { o.l = i; o.m = null; o.n = undefined; o.p = i + 1; }
const six = '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6}';
const count = 10000;
function churn(rounds: number) {
  let kept = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 20000; i++) {
      const o = JSON.parse(six), p = JSON.parse(six);
      three(o, -i); two(o, -i); four(o, -i);
      three(p, -1 - i);
      kept += o.g + o.j + o.l + p.g;
    }
    collectTheYoung();
  }
  return kept;
}
function check(name: string, list: any[], read: (o: any) => unknown, expected: (i: number) => unknown) {
  let wrong = 0, first = -1;
  for (let i = 0; i < list.length; i++) if (read(list[i]) !== expected(i)) { wrong++; if (first < 0) first = i; }
  console.log(name, wrong, first);
}
const first: any[] = [], more: any[] = [];
for (let i = 0; i < count; i++) { first.push(JSON.parse(six)); const o = JSON.parse(six); three(o, i); more.push(o); }
console.log(churn(4) <= 0);
for (let i = 0; i < count; i++) { three(first[i], i); two(more[i], i); }
console.log(churn(4) <= 0);
for (let i = 0; i < count; i++) four(more[i], i);
console.log(churn(4) <= 0);
check("the first storage", first, o => o.g + "," + o.h + "," + o.i, i => i + "," + (i + 0.5) + "," + ((i & 1) === 0));
check("more of it", more, o => [o.g, o.h, o.i, o.j, o.k, o.l, o.m, o.n, o.p].join(), i => [i, i + 0.5, (i & 1) === 0, i, -i, i, null, undefined, i + 1].join());
check("what was there", first, o => o.a + o.f, () => 7);
