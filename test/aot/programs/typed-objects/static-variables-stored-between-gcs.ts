// Variables of a module that are stored to one after the other, with collections in between, hold what was stored: the collector looks again at the neighborhood of each store.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Box = { id: number; label: string; inner: { n: number[] } };
function make(id: number): Box {
  return { id, label: "box" + id, inner: { n: [id, id + 1, id + 2] } };
}
function churn(n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += make(i).label.length;
  return t;
}
const a0 = make(0);
collect(false);
const a1 = make(1);
const a2 = make(2);
collect(false);
const t0 = churn(4000);
const a3 = make(3);
collect(true);
const a4 = make(4);
collect(false);
const a5 = make(5);
const a6 = make(6);
const a7 = make(7);
collect(false);
const t1 = churn(4000);
const a8 = make(8);
collect(false);
collect(false);
const a9 = make(9);
const b0 = [make(10), make(11)];
collect(false);
const b1 = new Map<string, Box>([["k", make(12)]]);
collect(true);
const b2 = () => make(13).id + a9.id;
collect(false);
const b3 = "text " + a8.label + churn(10);
collect(false);
let later: Box = make(14);
let laterList: Box[] = [];
function replace(round: number): void {
  later = make(100 + round);
  laterList = [later, make(200 + round)];
}
const lines: string[] = [];
for (let round = 0; round < 10; round++) {
  replace(round);
  const t = churn(3000);
  collect(round % 4 === 3);
  lines.push(round + " " + t + " " + later.label + " " + laterList.map((b) => b.inner.n.join("+")).join(","));
}
const all = [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, ...b0, b1.get("k")!];
console.log(all.map((b) => b.label + ":" + b.inner.n.join("+")).join(" "));
console.log(t0, t1, b2(), b3);
console.log(lines.join("\n"));
