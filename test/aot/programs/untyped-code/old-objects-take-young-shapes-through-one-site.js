// Stores by name of values that are no cells, on OLD objects, through ONE place in the program that sees hundreds of shapes between two collections: what the place remembers of the first shapes is long overwritten when the collector comes, and the shapes that the old objects were given are young and held by them alone.
let kept = 0;
const garbage = typeof edenGC === "function" ? 3000 : 400000;
function churn() { for (let i = 0; i < garbage; i++) kept += JSON.parse('{"a":1,"b":2,"c":3}').c + [i, i + 1, i + 2, i + 3].length; if (typeof edenGC === "function") edenGC(); }
function one(o) { o.g = 7; }
function three(o) { o.g = 1; o.h = 2.5; o.i = true; }
function numbers(o, n) { n = n | 0; o.g = n; o.h = n + 1; }
function given(o, v) { o.g = v; }
function assigned(o) { Object.assign(o, { g: 1, h: 2 }); }
function defined(o) { Object.defineProperty(o, "g", { value: 1, writable: true, enumerable: true, configurable: true }); }
const roads = [
  [one, o => o.g === 7], [three, o => o.g === 1 && o.h === 2.5 && o.i === true], [numbers, (o, i) => o.g === i && o.h === i + 1], [given, (o, i) => o.g === i],
  [assigned, o => o.g === 1 && o.h === 2], [defined, o => o.g === 1],
];
const batches = 6, inBatch = 150, count = batches * inBatch;
const text = (road, i) => '{"r' + road + "_" + i + '":0,"s":1}';
const old = roads.map((_, road) => { const list = []; for (let i = 0; i < count; i++) list.push(JSON.parse(text(road, i))); return list; });
churn();
churn();
for (let batch = 0; batch < batches; batch++) {
  roads.forEach(([go], road) => {
    for (let i = batch * inBatch; i < (batch + 1) * inBatch; i++) {
      for (let turn = 0; turn < 4; turn++) go(JSON.parse(text(road, i)), i);
      go(old[road][i], i);
    }
  });
  churn();
}
roads.forEach(([go, right], road) => {
  let wrong = 0;
  for (let i = 0; i < count; i++) { let ok = false; try { ok = right(old[road][i], i) && old[road][i].s === 1 && Object.keys(old[road][i])[0] === "r" + road + "_" + i; } catch { ok = false; } if (!ok) wrong++; }
  console.log(go.name + ": " + wrong);
});
console.log(kept > 0);
