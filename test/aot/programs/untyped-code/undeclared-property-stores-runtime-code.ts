// Code made at run time stores to a property that a typed object has and its type does not declare, many times at one place, so that what the interpreter remembers of the object is used.
declare const gc: undefined | (() => void);
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
interface Box {
  w: number;
  h: number;
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}
function hide(value: unknown): any {
  return value;
}
const makeBox = (): Box => ({ w: 3, h: 4 });
const show = (v: unknown) => JSON.stringify(v, (_k, x) => (x === undefined ? "undefined" : x));
let texts = 0;
const makeLoop = (name: string) => new Function("o", "values", "turns", "let n = " + texts++ + "; for (let i = 0; i < turns; i++) o." + name + " = values[i & 3]; return n * 0;") as (o: unknown, values: unknown[], turns: number) => number;
const writers: Record<string, (o: unknown, v: unknown) => unknown> = {};
for (const name of ["extra", "more", "w", "sum", "last"]) writers[name] = new Function("o", "v", "o." + name + " = v; return o." + name + ";") as (o: unknown, v: unknown) => unknown;

function measure(label: string, run: () => unknown) {
  const result = run();
  console.log(label + ":", show(result));
}
measure("one more property on a record", () => {
  const box = makeBox();
  makeLoop("extra")(box, [1, "two", null, { three: 3 }], 500);
  return [hide(box).extra, box.w, Object.keys(box).join()];
});
measure("the second of two", () => {
  const box = makeBox();
  hide(box).extra = 0;
  makeLoop("more")(box, [1.5, 2, 3, 4], 500);
  return [hide(box).extra, hide(box).more, Object.keys(box).join()];
});
measure("on an instance of a class", () => {
  const point = new Point(1, 2);
  makeLoop("extra")(point, ["a", "b", "c", "d"], 500);
  return [hide(point).extra, point.sum(), Object.keys(point).join()];
});
measure("many objects that got the same property", () => {
  const loop = makeLoop("extra");
  const boxes = Array.from({ length: 50 }, makeBox);
  for (const box of boxes) loop(box, [1, 2, 3, 4], 10);
  return boxes.every(box => hide(box).extra === 2);
});

{
  const several: unknown[] = [makeBox(), new Point(1, 2), JSON.parse('{"w":1}'), makeBox(), { extra: "own" }];
  console.log("objects of several kinds at one place:", show([0, 1, 2, 3, 4, 0, 1, 2, 3, 4].map(i => writers.extra(several[i], i))), show(several));
}
{
  const box = makeBox();
  for (let i = 0; i < 20; i++) writers.extra(box, i);
  console.log("another comes behind it:", show([writers.more(box, "m"), writers.extra(box, 21), hide(box).more, Object.keys(box).join()]));
  console.log("it goes and comes again:", show([delete hide(box).extra, hide(box).extra, writers.extra(box, 22), Object.keys(box).join()]));
  Object.defineProperty(box, "extra", { value: 23, writable: false, enumerable: true, configurable: true });
  console.log("it can no longer be written:", show([writers.extra(box, 24), hide(box).extra]));
  let seen: unknown[] = [];
  Object.defineProperty(box, "extra", { get: () => "got", set: v => void seen.push(v), enumerable: true, configurable: true });
  console.log("it is an accessor:", show([writers.extra(box, 25), seen]));
}
{
  const box = makeBox();
  for (let i = 0; i < 20; i++) writers.extra(box, i);
  Object.freeze(box);
  console.log("a frozen object takes nothing:", show([writers.extra(box, 99), writers.w(box, 99), box]));
  const sealed = makeBox();
  for (let i = 0; i < 20; i++) writers.extra(sealed, i);
  Object.seal(sealed);
  console.log("a sealed one takes what it has:", show([writers.extra(sealed, 99), writers.last(sealed, 1), sealed]));
}
{
  const old = Array.from({ length: 50 }, makeBox);
  for (const box of old) writers.extra(box, 0);
  collect();
  collect();
  for (let turn = 0; turn < 6; turn++) {
    for (let i = 0; i < 50; i++) writers.extra(old[i], { turn, i, text: "young " + turn + " " + i });
    for (let i = 0; i < 2000; i++) [i, "garbage " + i];
    collect();
  }
  console.log("old objects keep young values:", old.every((box, i) => show(hide(box).extra) === show({ turn: 5, i, text: "young 5 " + i })));
}
